const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
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

    console.log('Получено сообщение:', data.type);

    switch (data.type) {
      case 'quick_match':
        if (waitingPlayer && waitingPlayer !== ws && waitingPlayer.readyState === WebSocket.OPEN) {
          const roomId = generateRoomId();
          rooms.set(roomId, { 
            players: [waitingPlayer, ws],
            createdAt: Date.now()
          });
          
          console.log(`Создана комната ${roomId}, отправка game_start обоим`);
          
          // Отправляем room_created
          waitingPlayer.send(JSON.stringify({ type: 'room_created', roomId }));
          ws.send(JSON.stringify({ type: 'room_created', roomId }));
          
          playerRoomId = roomId;
          
          // Сразу отправляем game_start обоим
          waitingPlayer.send(JSON.stringify({ type: 'game_start' }));
          ws.send(JSON.stringify({ type: 'game_start' }));
          
          waitingPlayer = null;
        } else {
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
        
        room.players.push(ws);
        playerRoomId = joinRoomId;
        
        console.log(`Игрок присоединился к комнате ${joinRoomId}, отправка game_start обоим`);
        
        // Отправляем game_start обоим игрокам
        room.players.forEach(p => {
          if (p.readyState === WebSocket.OPEN) {
            p.send(JSON.stringify({ type: 'room_created', roomId: joinRoomId }));
            p.send(JSON.stringify({ type: 'game_start' }));
          }
        });
        break;

      case 'state':
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
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          const opponent = currentRoom.players.find(p => p !== ws);
          if (opponent && opponent.readyState === WebSocket.OPEN) {
            opponent.send(JSON.stringify({ 
              type: 'opponent_game_over',
              score: data.score
            }));
          }
        }
        break;

      case 'final_result':
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          const opponent = currentRoom.players.find(p => p !== ws);
          if (opponent && opponent.readyState === WebSocket.OPEN) {
            opponent.send(JSON.stringify({
              type: 'game_result',
              myScore: data.myScore,
              opponentScore: data.opponentScore,
              winner: data.winner
            }));
          }
        }
        break;

      case 'leave':
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
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });

  ws.on('close', () => {
    console.log('Игрок отключился');
    if (waitingPlayer === ws) waitingPlayer = null;
    if (playerRoomId && rooms.has(playerRoomId)) {
      const currentRoom = rooms.get(playerRoomId);
      const opponent = currentRoom.players.find(p => p !== ws);
      if (opponent && opponent.readyState === WebSocket.OPEN) {
        opponent.send(JSON.stringify({ type: 'player_left' }));
      }
      rooms.delete(playerRoomId);
    }
  });
});

console.log('Сервер готов к работе');
