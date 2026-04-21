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
const ALLOWED_TOTALS = new Set([2, 3]);

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }),
);

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

function cellInCompletedSequence(game, r, c) {
  const key = `${r},${c}`;
  return game.sequences.some((seq) => seq.cells.some((cell) => `${cell.r},${cell.c}` === key));
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

function validateLobbyStart(game) {
  const humans = game.players.filter((p) => !p.isAI).length;
  const targetHumans = game.targetHumanCount ?? game.maxPlayers;
  if (humans !== targetHumans) {
    return {
      ok: false,
      error: `사람 플레이어 ${targetHumans}명이 되어야 시작할 수 있습니다`,
    };
  }
  const targetAi = game.numAI;
  if (humans + targetAi !== game.maxPlayers) {
    return {
      ok: false,
      error: '사람과 AI 합계는 2명 또는 3명이어야 시작할 수 있습니다',
    };
  }
  return { ok: true };
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
          if (cellInCompletedSequence(game, r, c)) continue;
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
    if (!move) {
      const handSize = game.players[cp].hand.length;
      if (handSize > 0) {
        game.aiForceDiscardAnyCard(cp, 0);
      }
    } else if (move.type === 'play') {
      const result = game.playCard(cp, move.cardIndex, move.row, move.col);
      if (
        !result.success &&
        game.status === 'playing' &&
        game.players[cp].hand.length > 0
      ) {
        game.aiForceDiscardAnyCard(cp, move.cardIndex);
      }
    } else if (move.type === 'discard') {
      game.discardDeadCard(cp, move.cardIndex);
    }

    emitState(game);
    runAiTurns(game, delayMs);
  }, delayMs);
}

io.on('connection', (socket) => {
  socket.on('createGame', ({ name, humanCount, aiCount }) => {
    const safeName = String(name || '').trim().slice(0, 20) || '방장';
    const h = Math.max(0, Math.min(Number(humanCount) || 0, 3));
    const a = Math.max(0, Math.min(Number(aiCount) || 0, 3));
    const total = h + a;
    if (!ALLOWED_TOTALS.has(total)) {
      socket.emit('errorMsg', '사람과 AI 합계는 2명 또는 3명이어야 합니다');
      return;
    }

    const code = createUniqueCode();
    const game = new GameState(code, total, a);
    game.hostId = socket.id;
    game.spectators = [{ id: socket.id, name: safeName, disconnected: false }];
    game.targetHumanCount = h;
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
    if (!found) {
      socket.emit('errorMsg', '방 정보를 찾을 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요');
      return;
    }
    const { game } = found;
    if (game.status !== 'lobby') return;
    if (game.hostId !== socket.id) {
      socket.emit('errorMsg', '방장만 시작할 수 있습니다');
      return;
    }

    const check = validateLobbyStart(game);
    if (!check.ok) {
      socket.emit('errorMsg', check.error);
      return;
    }

    game.startGame();
    emitState(game);
    runAiTurns(game);
  });

  socket.on('updateLobbyComposition', ({ humanCount, aiCount }) => {
    const found = findGameBySocketId(socket.id);
    if (!found) return;
    const { game } = found;
    if (game.status !== 'lobby') return;
    if (game.hostId !== socket.id) return;

    const h = Math.max(0, Math.min(Number(humanCount) || 0, 3));
    const a = Math.max(0, Math.min(Number(aiCount) || 0, 3));
    const total = h + a;
    if (!ALLOWED_TOTALS.has(total)) {
      socket.emit('errorMsg', '사람과 AI 합계는 2명 또는 3명이어야 합니다');
      return;
    }
    const joinedHumans = game.players.filter((p) => !p.isAI).length;
    if (joinedHumans > h) {
      socket.emit('errorMsg', '이미 들어온 사람 플레이어보다 적게 설정할 수 없습니다');
      return;
    }
    game.targetHumanCount = h;
    game.numAI = a;
    game.maxPlayers = total;
    emitState(game);
  });

  socket.on('backToLobby', () => {
    const found = findGameBySocketId(socket.id);
    if (!found) {
      socket.emit('errorMsg', '방 정보를 찾을 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요');
      return;
    }
    const { game } = found;
    if (game.hostId !== socket.id) {
      socket.emit('errorMsg', '방장만 로비로 돌아갈 수 있습니다');
      return;
    }
    if (game.status !== 'finished') {
      socket.emit('errorMsg', '게임이 끝난 뒤에만 로비로 갈 수 있습니다');
      return;
    }
    game.resetToLobby();
    game.logMsg('로비로 돌아왔습니다. 방장이 게임 시작을 눌러주세요.');
    emitState(game);
  });

  socket.on('rematch', () => {
    const found = findGameBySocketId(socket.id);
    if (!found) {
      socket.emit('errorMsg', '방 정보를 찾을 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요');
      return;
    }
    const { game } = found;
    if (game.hostId !== socket.id) {
      socket.emit('errorMsg', '방장만 바로 다시 시작할 수 있습니다');
      return;
    }
    if (game.status !== 'finished') {
      socket.emit('errorMsg', '게임이 끝난 뒤에만 다시 시작할 수 있습니다');
      return;
    }
    game.resetToLobby();
    const check = validateLobbyStart(game);
    if (!check.ok) {
      game.logMsg(`다시 시작 불가: ${check.error}`);
      emitState(game);
      socket.emit('errorMsg', check.error);
      return;
    }
    game.startGame();
    emitState(game);
    runAiTurns(game);
  });

  socket.on('leaveRoom', () => {
    const found = findGameBySocketId(socket.id);
    if (!found) {
      socket.emit('leftRoom');
      return;
    }
    const { game, idx, role } = found;
    const code = game.code;

    if (role === 'spectator') {
      const wasHost = game.hostId === socket.id;
      game.spectators = (game.spectators || []).filter((s) => s.id !== socket.id);
      socket.leave(code);
      if (wasHost) {
        const nextSpec =
          (game.spectators || []).find((s) => !s.disconnected) || game.spectators[0];
        if (nextSpec) {
          game.hostId = nextSpec.id;
          game.logMsg(`${nextSpec.name}(이)가 방장이 되었습니다`);
        } else {
          const nextHuman =
            game.players.find((p) => !p.isAI && !p.disconnected) ||
            game.players.find((p) => !p.isAI);
          if (nextHuman) {
            game.hostId = nextHuman.id;
            game.logMsg(`${nextHuman.name}(이)가 방장이 되었습니다`);
          } else {
            games.delete(code);
            socket.emit('leftRoom');
            return;
          }
        }
        emitState(game);
      } else {
        emitState(game);
      }
      socket.emit('leftRoom');
      return;
    }

    if (game.status === 'playing') {
      socket.emit('errorMsg', '진행 중에는 방을 나갈 수 없습니다');
      return;
    }
    game.players.splice(idx, 1);
    socket.leave(code);
    const humanLeft = game.players.filter((p) => !p.isAI).length;
    const specCount = (game.spectators || []).length;
    if (humanLeft === 0 && specCount === 0) {
      games.delete(code);
    } else {
      emitState(game);
    }
    socket.emit('leftRoom');
  });

  socket.on('playCard', ({ cardIndex, row, col }) => {
    const found = findGameBySocketId(socket.id);
    if (!found) {
      socket.emit('errorMsg', '방 정보를 찾을 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요');
      return;
    }
    const { game, idx, role } = found;
    if (role !== 'player') {
      socket.emit('errorMsg', '관전자는 말을 둘 수 없습니다');
      return;
    }
    if (game.status !== 'playing') {
      socket.emit('errorMsg', '지금은 플레이 중이 아닙니다');
      return;
    }
    if (game.currentPlayer !== idx) {
      socket.emit('errorMsg', '지금은 당신의 턴이 아닙니다');
      return;
    }
    const result = game.playCard(idx, Number(cardIndex), Number(row), Number(col));
    if (!result.success) {
      socket.emit('errorMsg', result.error || '수를 둘 수 없습니다');
    }
    emitState(game);
    runAiTurns(game);
  });

  socket.on('discardDeadCard', ({ cardIndex }) => {
    const found = findGameBySocketId(socket.id);
    if (!found) {
      socket.emit('errorMsg', '방 정보를 찾을 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요');
      return;
    }
    const { game, idx, role } = found;
    if (role !== 'player') {
      socket.emit('errorMsg', '관전자는 카드를 버릴 수 없습니다');
      return;
    }
    if (game.status !== 'playing') {
      socket.emit('errorMsg', '지금은 플레이 중이 아닙니다');
      return;
    }
    if (game.currentPlayer !== idx) {
      socket.emit('errorMsg', '지금은 당신의 턴이 아닙니다');
      return;
    }
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
