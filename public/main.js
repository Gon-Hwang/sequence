const socket = io();

const nameInput = document.getElementById('nameInput');
const humanCountInput = document.getElementById('humanCountInput');
const aiCountInput = document.getElementById('aiCountInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');

const roomCodeEl = document.getElementById('roomCode');
const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const handEl = document.getElementById('hand');
const boardEl = document.getElementById('board');
const logEl = document.getElementById('log');
const selectedCardInfo = document.getElementById('selectedCardInfo');
const spectatorsEl = document.getElementById('spectators');

let state = null;
let myIndex = -1;
let selectedCardIndex = null;

function syncAiSelectToHuman() {
  const h = Number(humanCountInput.value);
  aiCountInput.value = String(Math.max(0, 3 - h));
}

function syncHumanSelectToAi() {
  const a = Number(aiCountInput.value);
  humanCountInput.value = String(Math.max(0, 3 - a));
}

function readLobbyComposition() {
  return {
    humanCount: Number(humanCountInput.value),
    aiCount: Number(aiCountInput.value),
  };
}

function validateComposition(h, a) {
  return h >= 0 && h <= 3 && a >= 0 && a <= 3 && h + a === 3;
}

syncAiSelectToHuman();

createBtn.onclick = () => {
  const { humanCount, aiCount } = readLobbyComposition();
  if (!validateComposition(humanCount, aiCount)) {
    alert('사람과 AI 합계가 3이어야 합니다');
    return;
  }
  socket.emit('createGame', {
    name: nameInput.value,
    humanCount,
    aiCount,
  });
};

joinBtn.onclick = () => {
  socket.emit('joinGame', {
    name: nameInput.value,
    code: roomCodeInput.value.trim().toUpperCase(),
  });
};

startBtn.onclick = () => socket.emit('startGame');

humanCountInput.onchange = () => {
  syncAiSelectToHuman();
  if (state && state.status === 'lobby' && state.viewer && state.viewer.isHost) {
    const { humanCount, aiCount } = readLobbyComposition();
    socket.emit('updateLobbyComposition', { humanCount, aiCount });
  }
};

aiCountInput.onchange = () => {
  syncHumanSelectToAi();
  if (state && state.status === 'lobby' && state.viewer && state.viewer.isHost) {
    const { humanCount, aiCount } = readLobbyComposition();
    socket.emit('updateLobbyComposition', { humanCount, aiCount });
  }
};

function isMyTurn() {
  return state && state.status === 'playing' && state.currentPlayer === myIndex;
}

function renderPlayers() {
  playersEl.innerHTML = '';
  state.players.forEach((p, idx) => {
    const el = document.createElement('div');
    el.className = 'player' + (state.currentPlayer === idx ? ' my-turn' : '');
    const meTag = idx === myIndex ? ' (나)' : '';
    const aiTag = p.isAI ? ' [AI]' : '';
    const turnTag = state.currentPlayer === idx ? ' <- 현재 턴' : '';
    const disconnectTag = p.disconnected ? ' (연결 끊김)' : '';
    el.textContent = `${p.name}${meTag}${aiTag}${disconnectTag} | 손패 ${p.handSize}장${turnTag}`;
    el.style.borderLeft = `6px solid ${p.color}`;
    playersEl.appendChild(el);
  });

  const specs = state.spectators || [];
  if (specs.length === 0) {
    spectatorsEl.textContent = '관전자 없음';
    return;
  }
  spectatorsEl.textContent = `관전자: ${specs
    .map((s) => `${s.name}${s.isHost ? '(방장)' : ''}${s.disconnected ? '(끊김)' : ''}`)
    .join(', ')}`;
  if (state.status === 'lobby') {
    const humans = state.players.filter((p) => !p.isAI).length;
    const target = state.targetHumanCount ?? 3;
    const targetAi = state.numAI ?? 0;
    spectatorsEl.textContent += ` | 사람 ${humans}/${target}, AI ${targetAi}명`;
  }
}

function renderHand() {
  handEl.innerHTML = '';
  const me = state.players[myIndex];
  const cards = (me && me.hand) || [];
  cards.forEach((card, idx) => {
    const btn = document.createElement('button');
    btn.textContent = card;
    if (selectedCardIndex === idx) btn.classList.add('selected');
    btn.onclick = () => {
      selectedCardIndex = idx;
      renderHand();
      selectedCardInfo.textContent = `선택 카드: ${card} / 보드를 클릭해 플레이 또는 데드카드 버리기`;
    };
    handEl.appendChild(btn);
  });

  const discardBtn = document.createElement('button');
  discardBtn.textContent = '선택 카드 데드카드 버리기';
  discardBtn.disabled = selectedCardIndex === null || !isMyTurn();
  discardBtn.onclick = () => {
    socket.emit('discardDeadCard', { cardIndex: selectedCardIndex });
  };
  handEl.appendChild(discardBtn);
}

function renderBoard() {
  boardEl.innerHTML = '';
  const board = state.board;
  const chips = state.chips;

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const cell = document.createElement('div');
      const card = board[r][c];
      cell.className = 'cell' + (card === 'FREE' ? ' free' : '');
      cell.textContent = card;

      const owner = chips[r][c];
      if (owner !== null) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.background = state.players[owner].color;
        cell.appendChild(chip);
      }

      cell.onclick = () => {
        if (!isMyTurn()) return;
        if (selectedCardIndex === null) return;
        socket.emit('playCard', { cardIndex: selectedCardIndex, row: r, col: c });
      };
      boardEl.appendChild(cell);
    }
  }
}

function renderLog() {
  logEl.innerHTML = '';
  (state.log || []).slice().reverse().forEach((item) => {
    const div = document.createElement('div');
    div.textContent = item.msg;
    logEl.appendChild(div);
  });
}

function renderState() {
  if (!state) return;
  myIndex = state.players.findIndex((p) => p.id === socket.id);
  roomCodeEl.textContent = state.code || '-';
  statusEl.textContent = state.status;
  startBtn.disabled = !(state.status === 'lobby' && state.viewer && state.viewer.isHost);
  if (state.status !== 'playing') selectedCardIndex = null;
  renderPlayers();
  renderHand();
  renderBoard();
  renderLog();
}

socket.on('state', (s) => {
  state = s;
  if (s.status === 'lobby') {
    humanCountInput.value = String(s.targetHumanCount ?? 3);
    aiCountInput.value = String(s.numAI ?? 0);
  }
  renderState();
});

socket.on('errorMsg', (msg) => {
  alert(msg);
});
