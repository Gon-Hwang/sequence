const socket = io();

const nameInput = document.getElementById('nameInput');
const humanCountInput = document.getElementById('humanCountInput');
const aiCountInput = document.getElementById('aiCountInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const lobbyHintEl = document.getElementById('lobbyHint');
const lobbyControlsEl = document.getElementById('lobbyControls');

const roomCodeEl = document.getElementById('roomCode');
const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const handEl = document.getElementById('hand');
const boardEl = document.getElementById('board');
const logEl = document.getElementById('log');
const selectedCardInfo = document.getElementById('selectedCardInfo');
const spectatorsEl = document.getElementById('spectators');
const resultBannerEl = document.getElementById('resultBanner');
const resultBannerTextEl = document.getElementById('resultBannerText');
const resultBannerCloseEl = document.getElementById('resultBannerClose');

let state = null;
let myIndex = -1;
let selectedCardIndex = null;
let hoverCard = null;
let handHoverGlobalsBound = false;
let lastResultNotifyKey = '';
let resultBannerDismissedForKey = '';

function clearHandHoverPreview() {
  hoverCard = null;
  if (state && state.status === 'playing') renderBoard();
}

function bindHandHoverGlobalsOnce() {
  if (handHoverGlobalsBound) return;
  handHoverGlobalsBound = true;
  window.addEventListener('pointerup', clearHandHoverPreview);
  window.addEventListener('pointercancel', clearHandHoverPreview);
}

resultBannerCloseEl.addEventListener('click', () => {
  resultBannerEl.hidden = true;
  if (lastResultNotifyKey) resultBannerDismissedForKey = lastResultNotifyKey;
});

const ONE_EYE_JACKS = new Set(['JS', 'JH']);
const TWO_EYE_JACKS = new Set(['JD', 'JC']);

function isOneEyeJack(card) {
  return ONE_EYE_JACKS.has(card);
}

function isTwoEyeJack(card) {
  return TWO_EYE_JACKS.has(card);
}

function cellKey(r, c) {
  return `${r},${c}`;
}

function isCellInCompletedSequence(r, c) {
  const key = cellKey(r, c);
  return (state.sequences || []).some((seq) =>
    seq.cells.some((cell) => cellKey(cell.r, cell.c) === key),
  );
}

function getSelectedCard() {
  if (selectedCardIndex === null) return null;
  const me = state.players[myIndex];
  const hand = (me && me.hand) || [];
  return hand[selectedCardIndex] || null;
}

function hintForCell(r, c, selectedCard) {
  if (!state || state.status !== 'playing') return null;
  if (myIndex < 0) return null;
  if (!selectedCard) return null;

  const boardCard = state.board[r][c];
  const owner = state.chips[r][c];

  if (isTwoEyeJack(selectedCard)) {
    if (boardCard === 'FREE') return null;
    if (owner === null) return 'wild';
    return null;
  }

  if (isOneEyeJack(selectedCard)) {
    if (owner === null || owner === myIndex) return null;
    if (isCellInCompletedSequence(r, c)) return null;
    return 'remove';
  }

  if (boardCard === selectedCard && owner === null) return 'play';
  return null;
}

/** 보드에서 카드 위치 찾기(턴/빈칸과 무관). 손패 호버용 */
function hoverLocateHintForCell(r, c, card) {
  if (!state || state.status !== 'playing') return null;
  if (myIndex < 0) return null;
  if (!card) return null;

  const boardCard = state.board[r][c];
  const owner = state.chips[r][c];

  if (isTwoEyeJack(card)) {
    if (boardCard === 'FREE') return null;
    if (owner === null) return 'wild-empty';
    return 'wild-occupied';
  }

  if (isOneEyeJack(card)) {
    if (owner === null || owner === myIndex) return null;
    if (isCellInCompletedSequence(r, c)) return null;
    return 'remove';
  }

  if (boardCard === card) return owner === null ? 'locate-empty' : 'locate-occupied';
  return null;
}

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

startBtn.onclick = () => {
  if (startBtn.disabled) {
    if (state && state.status === 'lobby' && state.viewer && state.viewer.isHost) {
      const targetHumans = state.targetHumanCount ?? 3;
      const joinedHumans = (state.players || []).filter((p) => !p.isAI).length;
      if (targetHumans > 0 && joinedHumans < targetHumans) {
        alert(
          `참가자가 부족합니다. (현재 ${joinedHumans}/${targetHumans})\n방장은 플레이어에 포함되지 않습니다. 친구를 초대하거나 사람/AI 구성을 바꿔 주세요.`,
        );
      }
    }
    return;
  }
  socket.emit('startGame');
};

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
  bindHandHoverGlobalsOnce();
  const me = state.players[myIndex];
  const cards = (me && me.hand) || [];
  cards.forEach((card, idx) => {
    const btn = document.createElement('button');
    btn.textContent = card;
    if (selectedCardIndex === idx) btn.classList.add('selected');
    btn.addEventListener('pointerenter', () => {
      hoverCard = card;
      if (state && state.status === 'playing') renderBoard();
    });
    btn.addEventListener('pointerdown', () => {
      hoverCard = card;
      if (state && state.status === 'playing') renderBoard();
    });
    btn.onclick = () => {
      selectedCardIndex = idx;
      renderHand();
      selectedCardInfo.textContent =
        `선택 카드: ${card} / 보드에서 해당 위치가 강조됩니다 (실제 두기는 내 턴에만 가능, 데드카드는 아래 버튼)`;
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

  handEl.onmouseleave = () => {
    clearHandHoverPreview();
  };
}

function renderBoard() {
  boardEl.innerHTML = '';
  const board = state.board;
  const chips = state.chips;
  const selectedCard = getSelectedCard();

  function tryPlayAt(r, c) {
    if (!state) return;
    if (state.status !== 'playing') {
      selectedCardInfo.textContent = '아직 게임이 시작되지 않았습니다. 방장이 게임 시작을 눌러주세요.';
      return;
    }
    if (myIndex < 0) {
      selectedCardInfo.textContent =
        '지금은 관전(또는 플레이어로 인식되지 않음) 상태입니다. 플레이어로 방에 참가해야 말을 둘 수 있습니다.';
      return;
    }
    if (!isMyTurn()) {
      selectedCardInfo.textContent = '지금은 당신의 턴이 아닙니다. 플레이어 목록에서 현재 턴을 확인하세요.';
      return;
    }
    if (selectedCardIndex === null) {
      selectedCardInfo.textContent = '먼저 아래 손패에서 카드를 선택한 뒤, 보드 칸을 눌러주세요.';
      return;
    }
    socket.emit('playCard', { cardIndex: selectedCardIndex, row: r, col: c });
  }

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const cell = document.createElement('div');
      const card = board[r][c];
      cell.className = 'cell' + (card === 'FREE' ? ' free' : '');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.textContent = card;

      const owner = chips[r][c];
      if (owner !== null) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.background = state.players[owner].color;
        cell.appendChild(chip);
      }

      const hint = hintForCell(r, c, selectedCard);
      if (hint === 'play' || hint === 'wild') {
        cell.classList.add('hint-playable');
      } else if (hint === 'remove') {
        cell.classList.add('hint-removable');
      }

      const hov = hoverCard ? hoverLocateHintForCell(r, c, hoverCard) : null;
      if (hov === 'locate-empty') cell.classList.add('hint-locate-empty');
      else if (hov === 'locate-occupied') cell.classList.add('hint-locate-occupied');
      else if (hov === 'wild-empty') cell.classList.add('hint-hover-wild');
      else if (hov === 'wild-occupied') cell.classList.add('hint-hover-wild-occupied');
      else if (hov === 'remove') cell.classList.add('hint-hover-remove');

      const keepVisibleForHover =
        hov === 'locate-empty' ||
        hov === 'locate-occupied' ||
        hov === 'wild-empty' ||
        hov === 'wild-occupied' ||
        hov === 'remove';

      if (
        selectedCard &&
        state.status === 'playing' &&
        isMyTurn() &&
        !keepVisibleForHover &&
        hint !== 'play' &&
        hint !== 'wild' &&
        hint !== 'remove'
      ) {
        cell.classList.add('hint-dim');
      }

      cell.addEventListener('pointerup', (e) => {
        if (e.button === 2) return;
        tryPlayAt(r, c);
      });
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

function stableStringifyWinner(winner) {
  if (!winner) return 'none';
  try {
    return JSON.stringify(winner);
  } catch {
    return String(winner);
  }
}

function maybeShowGameResultBanner() {
  if (!state || state.status !== 'finished') return;
  const w = state.winner;
  if (!w) return;

  const key = `${state.code || 'room'}|${stableStringifyWinner(w)}`;
  if (key === lastResultNotifyKey && resultBannerDismissedForKey === key) return;
  if (key !== lastResultNotifyKey) {
    lastResultNotifyKey = key;
    resultBannerDismissedForKey = '';
  }
  if (resultBannerDismissedForKey === key) return;

  let winnerLabel = '';
  if (w.type === 'player') {
    const p = state.players[w.playerIdx];
    winnerLabel = p ? `${p.name}${p.isAI ? ' (AI)' : ''}` : '승자';
  } else if (w.type === 'team') {
    const names = (w.players || [])
      .map((idx) => {
        const p = state.players[idx];
        return p ? `${p.name}${p.isAI ? ' (AI)' : ''}` : `#${idx}`;
      })
      .join(', ');
    winnerLabel = `팀 ${Number(w.team) + 1} (${names})`;
  } else {
    winnerLabel = '승자';
  }

  let body = '';
  if (state.viewer && state.viewer.isSpectator) {
    body = `게임 종료! 우승: ${winnerLabel} — 멋진 한 판이었습니다!`;
  } else if (myIndex < 0) {
    body = `게임 종료! 우승: ${winnerLabel} — 수고하셨습니다!`;
  } else if (w.type === 'player') {
    if (w.playerIdx === myIndex) {
      body = `승리했습니다! 축하합니다! 당신이 시퀀스를 먼저 완성했습니다.`;
    } else {
      body = `아쉽게도 패배입니다. 우승: ${winnerLabel} — 다음 판도 화이팅!`;
    }
  } else if (w.type === 'team') {
    const myTeam = state.players[myIndex]?.team;
    if (myTeam === w.team) {
      body = `팀 승리! 축하합니다! 팀이 시퀀스 목표를 먼저 달성했습니다.`;
    } else {
      body = `패배입니다. 우승: ${winnerLabel} — 다음엔 역전해요!`;
    }
  } else {
    body = `게임 종료! 우승: ${winnerLabel}`;
  }

  resultBannerTextEl.textContent = body;
  resultBannerEl.hidden = false;
}

function renderState() {
  if (!state) return;
  myIndex = state.players.findIndex((p) => p.id === socket.id);
  roomCodeEl.textContent = state.code || '-';
  const statusLabel =
    state.status === 'lobby'
      ? '대기(로비)'
      : state.status === 'playing'
        ? '진행 중'
        : state.status === 'finished'
          ? '종료'
          : state.status;
  statusEl.textContent = statusLabel;
  const targetHumans = state.targetHumanCount ?? 3;
  const joinedHumans = (state.players || []).filter((p) => !p.isAI).length;
  const canStartLobby =
    state.status === 'lobby' &&
    state.viewer &&
    state.viewer.isHost &&
    (targetHumans === 0 || joinedHumans >= targetHumans);
  startBtn.disabled = !canStartLobby || state.status !== 'lobby';
  startBtn.title =
    state.status === 'lobby' && targetHumans > 0 && joinedHumans < targetHumans
      ? `참가자 ${joinedHumans}/${targetHumans} — 인원이 맞아야 시작할 수 있습니다`
      : '';
  if (state.status === 'lobby') {
    startBtn.textContent = '게임 시작';
    const targetAi = state.numAI ?? 0;
    if (targetHumans === 0) {
      lobbyHintEl.textContent = `전원 AI(${targetAi}명) 구성: 준비되면 방장이 “게임 시작”을 눌러주세요.`;
    } else if (state.viewer && state.viewer.isHost) {
      lobbyHintEl.textContent = `참가자(사람) ${joinedHumans}/${targetHumans} · AI ${targetAi}명 — 방장은 관전이며 플레이어 수에 포함되지 않습니다.`;
    } else {
      lobbyHintEl.textContent = `참가자(사람) ${joinedHumans}/${targetHumans} · AI ${targetAi}명`;
    }
    lobbyControlsEl.style.opacity = '1';
    lobbyControlsEl.style.pointerEvents = 'auto';
  } else if (state.status === 'playing') {
    startBtn.textContent = '진행 중';
    if (state.viewer && state.viewer.isSpectator) {
      lobbyHintEl.textContent =
        '이미 게임이 시작되었습니다. 아래로 내려 “보드/플레이어/로그”를 확인하세요. (방장은 관전)';
    } else {
      lobbyHintEl.textContent = '이미 게임이 시작되었습니다. 아래 보드에서 진행하세요.';
    }
    lobbyControlsEl.style.opacity = '0.45';
    lobbyControlsEl.style.pointerEvents = 'none';
  } else if (state.status === 'finished') {
    startBtn.textContent = '종료됨';
    lobbyHintEl.textContent = '게임이 종료되었습니다. 새 방을 만들어 다시 플레이할 수 있습니다.';
    lobbyControlsEl.style.opacity = '0.45';
    lobbyControlsEl.style.pointerEvents = 'none';
  } else {
    lobbyHintEl.textContent = '';
    lobbyControlsEl.style.opacity = '1';
    lobbyControlsEl.style.pointerEvents = 'auto';
  }
  if (state.status !== 'playing') {
    selectedCardIndex = null;
    hoverCard = null;
  }
  renderPlayers();
  renderHand();
  renderBoard();
  renderLog();
  maybeShowGameResultBanner();
  if (state.status !== 'finished' && !resultBannerEl.hidden) {
    resultBannerEl.hidden = true;
  }
}

socket.on('state', (s) => {
  state = s;
  if (s.status === 'lobby') {
    humanCountInput.value = String(s.targetHumanCount ?? 3);
    aiCountInput.value = String(s.numAI ?? 0);
    syncAiSelectToHuman();
  }
  renderState();
});

socket.on('errorMsg', (msg) => {
  alert(msg);
});
