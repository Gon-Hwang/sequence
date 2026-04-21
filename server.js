const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  GameState,
  CARD_POSITIONS,
  isOneEyeJack,
  isTwoEyeJack,
} = require('./src/gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const games = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createUniqueCode() {
  let code = randomCode();
  while (games.has(code)) {
    code = randomCode();
  }
  return code;
}

function emitState(game) {
  const recipients = new Set();
  for (const p of game.players) {
    if (!p.isAI) recipients.add(p.id);
  }
  for (const s of game.spectators || []) {
    recipients.add(s.id);
  }

  for (const socketId of recipients) {
    const publicState = game.getPublicState(socketId);
    publicState.viewer = {
      isHost: game.hostId === socketId,
      isSpectator: (game.spectators || []).some((s) => s.id === socketId),
    };
    publicState.spectators = (game.spectators || []).map((s) => ({
      id: s.id,
      name: s.name,
      isHost: s.id === game.hostId,
      disconnected: !!s.disconnected,
    }));
    io.to(socketId).emit('state', publicState);
  }
}

function findGameBySocketId(socketId) {
  for (const game of games.values()) {
    const idx = game.players.findIndex((p) => p.id === socketId);
    if (idx !== -1) return { game, idx, role: 'player' };
    const spectatorIdx = (game.spectators || []).findIndex((s) => s.id === socketId);
    if (spectatorIdx !== -1) return { game, spectatorIdx, role: 'spectator' };
  }
  return null;
}

function chooseMove(game, playerIdx) {
  const player = game.players[playerIdx];
  if (!player) return null;

  const me = game.chips;
  const hand = player.hand;
  const board = game.getFullState().board;

  const normalMoves = [];
  const removeMoves = [];
  const wildMoves = [];
  const deadCandidates = [];

  for (let cardIndex = 0; cardIndex < hand.length; cardIndex++) {
    const card = hand[cardIndex];
    if (isTwoEyeJack(card)) {
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          if (board[r][c] !== 'FREE' && me[r][c] === null) {
            wildMoves.push({ type: 'play', cardIndex, row: r, col: c });
          }
        }
      }
      continue;
    }

    if (isOneEyeJack(card)) {
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          const owner = me[r][c];
          if (owner === null || owner === playerIdx) continue;
          removeMoves.push({ type: 'play', cardIndex, row: r, col: c });
        }
      }
      continue;
    }

    const positions = CARD_POSITIONS[card] || [];
    let hasPlayable = false;
    for (const [r, c] of positions) {
      if (me[r][c] === null) {
        hasPlayable = true;
        normalMoves.push({ type: 'play', cardIndex, row: r, col: c });
      }
    }
    if (!hasPlayable) deadCandidates.push({ type: 'discard', cardIndex });
  }

  if (normalMoves.length > 0) {
    return normalMoves[Math.floor(Math.random() * normalMoves.length)];
  }
  if (wildMoves.length > 0) {
    return wildMoves[Math.floor(Math.random() * wildMoves.length)];
  }
  if (removeMoves.length > 0) {
    return removeMoves[Math.floor(Math.random() * removeMoves.length)];
  }
  if (deadCandidates.length > 0) {
    return deadCandidates[0];
  }
  return null;
}

function runAiTurns(game, delayMs = 600) {
  if (game.status !== 'playing') return;
  const current = game.players[game.currentPlayer];
  if (!current || !current.isAI) return;

  setTimeout(() => {
    if (game.status !== 'playing') return;
    const cp = game.currentPlayer;
    const p = game.players[cp];
    if (!p || !p.isAI) return;

    const move = chooseMove(game, cp);
    if (!move) return;

    if (move.type === 'play') {
      game.playCard(cp, move.cardIndex, move.row, move.col);
    } else if (move.type === 'discard') {
      game.discardDeadCard(cp, move.cardIndex);
    }

    emitState(game);
    runAiTurns(game, delayMs);
  }, delayMs);
}

io.on('connection', (socket) => {
  socket.on('createGame', ({ name, humanCount }) => {
    const safeName = String(name || '').trim().slice(0, 20) || '방장';
    const safeMax = 3;
    const safeHumans = Math.max(0, Math.min(Number(humanCount) || 0, safeMax));
    const safeAi = safeMax - safeHumans;

    const code = createUniqueCode();
    const game = new GameState(code, safeMax, safeAi);
    game.hostId = socket.id;
    game.spectators = [{ id: socket.id, name: safeName, disconnected: false }];
    game.targetHumanCount = safeHumans;
    games.set(code, game);
    socket.join(code);
    emitState(game);
  });

  socket.on('joinGame', ({ code, name }) => {
    const game = games.get(String(code || '').toUpperCase());
    if (!game) {
      socket.emit('errorMsg', '존재하지 않는 방 코드입니다');
      return;
    }
    if (game.status !== 'lobby') {
      socket.emit('errorMsg', '이미 시작된 게임입니다');
      return;
    }
    const humans = game.players.filter((p) => !p.isAI).length;
    const targetHumans = game.targetHumanCount ?? game.maxPlayers;
    if (humans >= targetHumans) {
      socket.emit('errorMsg', '방 정원이 가득 찼습니다');
      return;
    }
    const safeName = String(name || '').trim().slice(0, 20) || '플레이어';
    game.addPlayer(socket.id, safeName, false);
    socket.join(game.code);
    emitState(game);
  });

  socket.on('startGame', () => {
    const found = findGameBySocketId(socket.id);
    if (!found) return;
    const { game } = found;
    if (game.status !== 'lobby') return;
    if (game.hostId !== socket.id) {
      socket.emit('errorMsg', '방장만 시작할 수 있습니다');
      return;
    }

    const humans = game.players.filter((p) => !p.isAI).length;
    const targetHumans = game.targetHumanCount ?? game.maxPlayers;
    if (humans !== targetHumans) {
      socket.emit('errorMsg', `사람 플레이어 ${targetHumans}명이 되어야 시작할 수 있습니다`);
      return;
    }
    game.numAI = Math.max(0, game.maxPlayers - humans);

    game.startGame();
    emitState(game);
    runAiTurns(game);
  });

  socket.on('playCard', ({ cardIndex, row, col }) => {
    const found = findGameBySocketId(socket.id);
    if (!found) return;
    const { game, idx } = found;
    if (game.status !== 'playing') return;
    if (game.currentPlayer !== idx) return;
    const result = game.playCard(idx, Number(cardIndex), Number(row), Number(col));
    if (!result.success) {
      socket.emit('errorMsg', result.error || '수를 둘 수 없습니다');
    }
    emitState(game);
    runAiTurns(game);
  });

  socket.on('discardDeadCard', ({ cardIndex }) => {
    const found = findGameBySocketId(socket.id);
    if (!found) return;
    const { game, idx } = found;
    if (game.status !== 'playing') return;
    if (game.currentPlayer !== idx) return;
    const result = game.discardDeadCard(idx, Number(cardIndex));
    if (!result.success) {
      socket.emit('errorMsg', result.error || '버릴 수 없습니다');
    }
    emitState(game);
    runAiTurns(game);
  });

  socket.on('disconnect', () => {
    const found = findGameBySocketId(socket.id);
    if (!found) return;
    const { game, idx, role } = found;
    if (role === 'player') {
      game.players[idx].disconnected = true;
      game.logMsg(`${game.players[idx].name} 연결이 종료되었습니다`);
    } else {
      game.spectators[idx].disconnected = true;
      game.logMsg(`${game.spectators[idx].name}(관전자) 연결이 종료되었습니다`);
    }
    emitState(game);
  });
});

server.listen(PORT, () => {
  console.log(`Sequence server listening on ${PORT}`);
});
