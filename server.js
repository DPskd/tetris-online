// server.js
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Error loading index.html');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
let waitingPlayer = null;

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sendToOpponent(room, sender, data) {
  const opponent = room.players.find(p => p !== sender);
  if (opponent && opponent.readyState === WebSocket.OPEN) {
    opponent.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
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
        if (waitingPlayer && waitingPlayer !== ws && waitingPlayer.readyState === WebSocket.OPEN) {
          const roomId = generateRoomId();
          rooms.set(roomId, { players: [waitingPlayer, ws] });
          
          waitingPlayer.send(JSON.stringify({ type: 'room_created', roomId }));
          ws.send(JSON.stringify({ type: 'room_created', roomId }));
          
          playerRoomId = roomId;
          
          setTimeout(() => {
            waitingPlayer.send(JSON.stringify({ type: 'game_start' }));
            ws.send(JSON.stringify({ type: 'game_start' }));
          }, 200);
          
          waitingPlayer = null;
        } else {
          waitingPlayer = ws;
          ws.send(JSON.stringify({ type: 'room_created', roomId: null }));
        }
        break;

      case 'create_room':
        const newRoomId = generateRoomId();
        rooms.set(newRoomId, { players: [ws] });
        playerRoomId = newRoomId;
        ws.send(JSON.stringify({ type: 'room_created', roomId: newRoomId }));
        break;

      case 'join_room':
        const joinRoomId = data.roomId;
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
        
        room.players.forEach(p => {
          if (p.readyState === WebSocket.OPEN) {
            p.send(JSON.stringify({ type: 'game_start' }));
          }
        });
        break;

      case 'state':
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          sendToOpponent(currentRoom, ws, {
            type: 'opponent_state',
            board: data.board,
            score: data.score,
            currentPiece: data.currentPiece,
            gameOver: data.gameOver
          });
        }
        break;

      case 'game_over':
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          sendToOpponent(currentRoom, ws, {
            type: 'opponent_game_over'
          });
        }
        break;

      case 'leave':
        if (playerRoomId && rooms.has(playerRoomId)) {
          const currentRoom = rooms.get(playerRoomId);
          sendToOpponent(currentRoom, ws, { type: 'player_left' });
          rooms.delete(playerRoomId);
          playerRoomId = null;
        }
        break;
    }
  });

  ws.on('close', () => {
    if (waitingPlayer === ws) {
      waitingPlayer = null;
    }
    if (playerRoomId && rooms.has(playerRoomId)) {
      const currentRoom = rooms.get(playerRoomId);
      sendToOpponent(currentRoom, ws, { type: 'player_left' });
      rooms.delete(playerRoomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Тетрис сервер запущен на http://localhost:${PORT}`);
});