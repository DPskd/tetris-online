const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// Создаем WebSocket сервер
const wss = new WebSocket.Server({ port: PORT });

let waitingPlayer = null;
const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

console.log(`WebSocket сервер запущен на порту ${PORT}`);

wss.on('connection', (ws) => {
  console.log('Новое подключение');
  let playerRoomId = null;

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    switch (data.type) {
      case 'quick_match':
        // Если есть ожидающий игрок - создаем комнату
        if (waitingPlayer && waitingPlayer !== ws && waitingPlayer.readyState === WebSocket.OPEN) {
          const roomId = generateRoomId();
          rooms.set(roomId, { 
            players: [waitingPlayer, ws],
            createdAt: Date.now()
          });
          
          waitingPlayer.send(JSON.stringify({ type: 'room_created', roomId }));
          ws.send(JSON.stringify({ type: 'room_created', roomId }));
          
          playerRoomId = roomId;
          
          // Запускаем игру для обоих
          setTimeout(() => {
            if (rooms.has(roomId)) {
              waitingPlayer.send(JSON.stringify({ type: 'game_start' }));
              ws.send(JSON.stringify({ type: 'game_start' }));
            }
          }, 200);
          
          waitingPlayer = null;
          console.log(`Создана комната ${roomId}`);
        } else {
          // Становимся в очередь
          waitingPlayer = ws;
          ws.send(JSON.stringify({ type: 'waiting', message: 'Ожидание соперника...' }));
          console.log('Игрок ожидает соперника');
        }
        break;

      case 'create_room':
        const newRoomId = generateRoomId();
        rooms.set(newRoomId, { 
          players: [ws],
          createdAt: Date.now()
        });
        playerRoomId = newRoomId;
        ws.send(JSON.stringify({ type: 'room_created', roomId: newRoomId }));
        console.log(`Создана комната ${newRoomId}`);
        break;

      case 'join_room':
        const joinRoomId = data.roomId ? data.roomId.toUpperCase() : null;
        
        if (!joinRoomId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Укажите код комнаты' }));
          return;
        }
        
        const room = rooms.get(joinRoomId);
        
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
          return;
        }
        
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Комната заполнена' }));
          return;
        }
        
        if (room.players.includes(ws)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Вы уже в этой комнате' }));
          return;
        }
        
        room.players.push(ws);
        playerRoomId = joinRoomId;
        
        ws.send(JSON.stringify({ type: 'room_created', roomId: joinRoomId }));
        console.log(`Игрок присоединился к комнате ${joinRoomId}`);
        
        // Уведомляем обоих о старте игры
        room.players.forEach(p => {
          if (p.readyState === WebSocket.OPEN) {
            p.send(JSON.stringify({ type: 'game_start' }));
          }
        });
        break;

      case 'state':
        // Передаем состояние игры сопернику
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          const opponent = currentRoom.players.find(p => p !== ws);
          if (opponent && opponent.readyState === WebSocket.OPEN) {
            opponent.send(JSON.stringify({
              type: 'opponent_state',
              board: data.board,
              score: data.score,
              currentPiece: data.currentPiece,
              gameOver: data.gameOver || false
            }));
          }
        }
        break;

      case 'game_over':
        // Уведомляем о конце игры
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          const opponent = currentRoom.players.find(p => p !== ws);
          if (opponent && opponent.readyState === WebSocket.OPEN) {
            opponent.send(JSON.stringify({ type: 'opponent_game_over' }));
          }
        }
        break;

      case 'leave':
        // Выход из комнаты
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          const opponent = currentRoom.players.find(p => p !== ws);
          if (opponent && opponent.readyState === WebSocket.OPEN) {
            opponent.send(JSON.stringify({ type: 'player_left' }));
          }
          rooms.delete(playerRoomId);
          playerRoomId = null;
          console.log('Игрок покинул комнату');
        }
        break;

      case 'ping':
        // Для поддержания соединения
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        console.log('Неизвестный тип сообщения:', data.type);
    }
  });

  ws.on('close', () => {
    console.log('Игрок отключился');
    
    // Убираем из очереди ожидания
    if (waitingPlayer === ws) {
      waitingPlayer = null;
    }
    
    // Уведомляем соперника
    if (playerRoomId && rooms.has(playerRoomId)) {
      const currentRoom = rooms.get(playerRoomId);
      const opponent = currentRoom.players.find(p => p !== ws);
      if (opponent && opponent.readyState === WebSocket.OPEN) {
        opponent.send(JSON.stringify({ type: 'player_left' }));
      }
      rooms.delete(playerRoomId);
    }
  });

  ws.on('error', (error) => {
    console.error('Ошибка WebSocket:', error.message);
  });
});

// Очистка старых комнат каждые 30 минут
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.createdAt > 30 * 60 * 1000) {
      room.players.forEach(p => {
        if (p.readyState === WebSocket.OPEN) {
          p.send(JSON.stringify({ type: 'room_timeout' }));
        }
      });
      rooms.delete(roomId);
      console.log(`Комната ${roomId} удалена по таймауту`);
    }
  }
}, 5 * 60 * 1000);

console.log('Сервер готов к работе');
