const socket = io();

const nameInput = document.getElementById('nameInput');
const humanCountInput = document.getElementById('humanCountInput');
const aiCountInput = document.getElementById('aiCountInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const postGameBar = document.getElementById('postGameBar');
const rematchBtn = document.getElementById('rematchBtn');
const backToLobbyBtn = document.getElementById('backToLobbyBtn');
const lobbyHintEl = document.getElementById('lobbyHint');
const lobbyControlsEl = document.getElementById('lobbyControls');

const roomCodeEl = document.getElementById('roomCode');
const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const handEl = document.getElementById('hand');
const handToolbarEl = document.getElementById('handToolbar');
const turnSpotlightEl = document.getElementById('turnSpotlight');
const pwaInstallBtn = document.getElementById('pwaInstallBtn');
const boardEl = document.getElementById('board');
const logEl = document.getElementById('log');
const selectedCardInfo = document.getElementById('selectedCardInfo');
const spectatorsEl = document.getElementById('spectators');
const resultBannerEl = document.getElementById('resultBanner');
const resultBannerTextEl = document.getElementById('resultBannerText');
const resultBannerCloseEl = document.getElementById('resultBannerClose');
const handSectionEl = document.getElementById('handSection');

let state = null;
let myIndex = -1;
let selectedCardIndex = null;
let hoverCard = null;
let handHoverGlobalsBound = false;
let lastResultNotifyKey = '';
let resultBannerDismissedForKey = '';
let deferredInstallPrompt = null;
let chipAudioCtx = null;
let fanfareAudioCtx = null;
let fanfarePlayedForKey = '';

function playChipPlaceSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!chipAudioCtx) chipAudioCtx = new Ctx();
    const ctx = chipAudioCtx;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.2, t0);
    master.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    master.connect(ctx.destination);

    // 딱딱한 칩 접촉음을 위해 저역 충격 + 고역 클릭 + 짧은 잔향 노이즈를 합성
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(430, t0);
    body.frequency.exponentialRampToValueAtTime(170, t0 + 0.05);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.5, t0);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
    body.connect(bodyGain);
    bodyGain.connect(master);

    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.setValueAtTime(2200, t0);
    click.frequency.exponentialRampToValueAtTime(800, t0 + 0.02);
    const clickBp = ctx.createBiquadFilter();
    clickBp.type = 'bandpass';
    clickBp.frequency.setValueAtTime(1900, t0);
    clickBp.Q.setValueAtTime(1.1, t0);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.11, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    click.connect(clickBp);
    clickBp.connect(clickGain);
    clickGain.connect(master);

    const dur = 0.06;
    const nSamples = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, nSamples, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < nSamples; i++) {
      const decay = 1 - i / nSamples;
      data[i] = (Math.random() * 2 - 1) * decay * decay * 0.42;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(900, t0);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t0);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    noise.connect(hp);
    hp.connect(lp);
    lp.connect(ng);
    ng.connect(master);

    body.start(t0);
    body.stop(t0 + 0.13);
    click.start(t0);
    click.stop(t0 + 0.06);
    noise.start(t0);
    noise.stop(t0 + dur);
  } catch (_) {
    /* ignore */
  }
}

function playVictoryFanfare() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!fanfareAudioCtx) fanfareAudioCtx = new Ctx();
    const ctx = fanfareAudioCtx;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.34, t0);
    master.connect(ctx.destination);

    const chord = [523.25, 659.25, 783.99];
    chord.forEach((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.09, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.72);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.78);
    });

    const leadFreqs = [783.99, 987.77, 1174.66, 1318.51, 1567.98];
    const step = 0.11;
    leadFreqs.forEach((f, i) => {
      const t = t0 + i * step;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.19, t + 0.018);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.3);
    });

    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(130.81, t0);
    bass.frequency.exponentialRampToValueAtTime(196, t0 + 0.48);
    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.12, t0);
    bassGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.62);
    bass.connect(bassGain);
    bassGain.connect(master);
    bass.start(t0);
    bass.stop(t0 + 0.68);

    // 마지막 강조 히트
    const hit = ctx.createOscillator();
    hit.type = 'square';
    hit.frequency.setValueAtTime(1567.98, t0 + 0.5);
    const hitGain = ctx.createGain();
    hitGain.gain.setValueAtTime(0, t0 + 0.5);
    hitGain.gain.linearRampToValueAtTime(0.2, t0 + 0.515);
    hitGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.74);
    hit.connect(hitGain);
    hitGain.connect(master);
    hit.start(t0 + 0.5);
    hit.stop(t0 + 0.78);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-18, t0);
    limiter.knee.setValueAtTime(12, t0);
    limiter.ratio.setValueAtTime(4, t0);
    limiter.attack.setValueAtTime(0.003, t0);
    limiter.release.setValueAtTime(0.15, t0);
    master.disconnect();
    master.connect(limiter);
    limiter.connect(ctx.destination);
  } catch (_) {
    /* ignore */
  }
}

/** @param {unknown[][] | null | undefined} prev @param {unknown[][] | null | undefined} next */
function detectNewChipPlaced(prev, next) {
  if (!prev || !next || prev.length !== 10 || next.length !== 10) return false;
  for (let r = 0; r < 10; r++) {
    const pr = prev[r];
    const nr = next[r];
    if (!pr || !nr || pr.length !== 10 || nr.length !== 10) continue;
    for (let c = 0; c < 10; c++) {
      if (pr[c] == null && nr[c] != null) return true;
    }
  }
  return false;
}

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

function resetLocalClientState() {
  state = null;
  myIndex = -1;
  selectedCardIndex = null;
  hoverCard = null;
  lastResultNotifyKey = '';
  resultBannerDismissedForKey = '';
  fanfarePlayedForKey = '';
  resultBannerEl.hidden = true;
  roomCodeEl.textContent = '-';
  statusEl.textContent = '대기';
  lobbyHintEl.textContent = '';
  playersEl.innerHTML = '';
  handEl.innerHTML = '';
  if (handToolbarEl) handToolbarEl.innerHTML = '';
  if (turnSpotlightEl) turnSpotlightEl.replaceChildren();
  boardEl.innerHTML = '';
  logEl.innerHTML = '';
  spectatorsEl.textContent = '';
  selectedCardInfo.textContent = '';
  lobbyControlsEl.style.opacity = '1';
  lobbyControlsEl.style.pointerEvents = 'auto';
  startBtn.textContent = '게임 시작';
  startBtn.disabled = true;
  startBtn.title = '';
  postGameBar.hidden = true;
}

rematchBtn.onclick = () => socket.emit('rematch');

backToLobbyBtn.onclick = () => {
  if (!state) return;
  if (state.viewer && state.viewer.isHost) socket.emit('backToLobby');
  else socket.emit('leaveRoom');
};

const ONE_EYE_JACKS = new Set(['JS', 'JH']);
const TWO_EYE_JACKS = new Set(['JD', 'JC']);

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** @returns {{ rank: string, suit: string, symbol: string, isRed: boolean } | null} */
function parsePlayingCard(code) {
  if (!code || typeof code !== 'string' || code === 'FREE') return null;
  const suit = code.slice(-1);
  if (!SUIT_SYMBOL[suit]) return null;
  const rank = code.slice(0, -1);
  if (!rank) return null;
  return {
    rank,
    suit,
    symbol: SUIT_SYMBOL[suit],
    isRed: suit === 'H' || suit === 'D',
  };
}

function isOneEyeJack(card) {
  return ONE_EYE_JACKS.has(card);
}

function isTwoEyeJack(card) {
  return TWO_EYE_JACKS.has(card);
}

function cellKey(r, c) {
  return `${r},${c}`;
}

function buildSequenceHighlightMap(st) {
  const map = new Map();
  if (!st || !Array.isArray(st.sequences)) return map;

  let seqId = 0;
  for (const seq of st.sequences) {
    const raw = seq.cells || [];
    if (raw.length === 0) {
      seqId += 1;
      continue;
    }
    for (const cell of raw) {
      map.set(cellKey(cell.r, cell.c), { owner: seq.owner, seqId });
    }
    seqId += 1;
  }

  return map;
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

function readLobbyComposition() {
  return {
    humanCount: Number(humanCountInput.value),
    aiCount: Number(aiCountInput.value),
  };
}

function validateComposition(h, a) {
  const total = h + a;
  return h >= 0 && h <= 3 && a >= 0 && a <= 3 && (total === 2 || total === 3);
}

createBtn.onclick = () => {
  const { humanCount, aiCount } = readLobbyComposition();
  if (!validateComposition(humanCount, aiCount)) {
    alert('사람과 AI 합계는 2명 또는 3명이어야 합니다');
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
    code: roomCodeInput.value.replace(/\D/g, '').slice(0, 6),
  });
};

startBtn.onclick = () => {
  if (startBtn.disabled) {
    if (state && state.status === 'lobby' && state.viewer && state.viewer.isHost) {
      const targetHumans = state.targetHumanCount ?? state.maxPlayers ?? 3;
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
  if (state && state.status === 'lobby' && state.viewer && state.viewer.isHost) {
    const { humanCount, aiCount } = readLobbyComposition();
    if (!validateComposition(humanCount, aiCount)) return;
    socket.emit('updateLobbyComposition', { humanCount, aiCount });
  }
};

aiCountInput.onchange = () => {
  if (state && state.status === 'lobby' && state.viewer && state.viewer.isHost) {
    const { humanCount, aiCount } = readLobbyComposition();
    if (!validateComposition(humanCount, aiCount)) return;
    socket.emit('updateLobbyComposition', { humanCount, aiCount });
  }
};

function isMyTurn() {
  return state && state.status === 'playing' && state.currentPlayer === myIndex;
}

/** @returns {{ labelText: string, headline: string, subText: string, accent: string, variant: string }} */
function buildFinishedSpotlightContent() {
  const subHost = '방장은 다시 하기 또는 로비로 이동할 수 있습니다.';
  const w = state.winner;

  if (!w) {
    return {
      labelText: '게임 종료',
      headline: '게임이 끝났습니다',
      subText: subHost,
      accent: '#94a3b8',
      variant: 'turn-spotlight--finished',
    };
  }

  if (w.type === 'draw') {
    let headline = '무승부';
    let subText = `모두 멋진 플레이였습니다. ${subHost}`;
    if (Array.isArray(w.tiedTeams) && w.tiedTeams.length) {
      headline = '팀 동점 무승부';
      subText = `양 팀이 팽팽한 승부였습니다. ${subHost}`;
    } else {
      const names = (w.tied || [])
        .map((idx) => {
          const p = state.players[idx];
          return p ? `${p.name}${p.isAI ? ' (AI)' : ''}` : `#${idx}`;
        })
        .join(', ');
      if (names) headline = `${names} — 동점으로 무승부`;
    }
    return {
      labelText: '게임 종료',
      headline,
      subText,
      accent: '#fcd34d',
      variant: 'turn-spotlight--finished',
    };
  }

  if (w.type === 'player') {
    const p = state.players[w.playerIdx];
    const name = p ? `${p.name}${p.isAI ? ' (AI)' : ''}` : '승자';
    const accent = p?.color ?? '#fbbf24';
    return {
      labelText: '게임 종료',
      headline: `${name} 님, 우승을 축하합니다!`,
      subText: `최종 승자에게 박수를 보냅니다. ${subHost}`,
      accent,
      variant: 'turn-spotlight--finished turn-spotlight--winner-celebrate',
    };
  }

  if (w.type === 'team') {
    const teamNum = Number(w.team) + 1;
    const names = (w.players || [])
      .map((idx) => {
        const p = state.players[idx];
        return p ? `${p.name}${p.isAI ? ' (AI)' : ''}` : `#${idx}`;
      })
      .join(', ');
    const p0 = state.players[w.players?.[0]];
    const accent = p0?.color ?? '#fbbf24';
    return {
      labelText: '게임 종료',
      headline: `팀 ${teamNum} 승리! 축하합니다!`,
      subText: names ? `${names} — 훌륭한 팀 플레이였습니다. ${subHost}` : subHost,
      accent,
      variant: 'turn-spotlight--finished turn-spotlight--winner-celebrate',
    };
  }

  return {
    labelText: '게임 종료',
    headline: '게임이 끝났습니다',
    subText: subHost,
    accent: '#94a3b8',
    variant: 'turn-spotlight--finished',
  };
}

function renderTurnSpotlight() {
  if (!turnSpotlightEl) return;
  turnSpotlightEl.replaceChildren();

  if (!state) return;

  const addBlock = (labelText, nameText, opts = {}) => {
    const { subText = '', accent = null, variant = '' } = opts;
    if (variant) turnSpotlightEl.className = `turn-spotlight ${variant}`;
    else turnSpotlightEl.className = 'turn-spotlight';

    const label = document.createElement('div');
    label.className = 'turn-spotlight__label';
    label.textContent = labelText;
    turnSpotlightEl.appendChild(label);

    const nameEl = document.createElement('div');
    nameEl.className = 'turn-spotlight__name';
    nameEl.textContent = nameText;
    if (accent) nameEl.style.setProperty('--turn-accent', accent);
    turnSpotlightEl.appendChild(nameEl);

    if (subText) {
      const sub = document.createElement('div');
      sub.className = 'turn-spotlight__sub';
      sub.textContent = subText;
      turnSpotlightEl.appendChild(sub);
    }
  };

  if (state.status === 'lobby') {
    addBlock('턴', '시작 후 표시', {
      subText: '방장이 게임 시작을 누르면 여기에 현재 차례가 나타납니다.',
      variant: 'turn-spotlight--idle',
    });
    return;
  }

  if (state.status === 'finished') {
    const fin = buildFinishedSpotlightContent();
    addBlock(fin.labelText, fin.headline, {
      subText: fin.subText,
      variant: fin.variant,
      accent: fin.accent,
    });
    return;
  }

  if (state.status !== 'playing') return;

  const cp = state.currentPlayer;
  const p = state.players[cp];
  if (!p) return;

  const isMe = cp === myIndex && myIndex >= 0;
  const aiNote = p.isAI ? ' · AI' : '';
  let subText = '상대가 두는 중…';
  if (myIndex < 0) subText = '관전 중 — 지금 말을 둘 차례인 플레이어입니다.';
  else if (isMe) subText = '당신의 차례입니다 — 카드를 고르고 보드를 누르세요.';
  addBlock('현재 턴', `${p.name}${aiNote}`, {
    accent: p.color || '#22c55e',
    subText,
    variant: isMe ? 'turn-spotlight--yours' : 'turn-spotlight--theirs',
  });
}

function createPlayingCardButton(card, idx) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'playing-card';
  btn.dataset.cardIndex = String(idx);
  if (state && state.status !== 'playing') {
    btn.disabled = true;
    btn.classList.add('playing-card--inactive');
  }

  const parsed = parsePlayingCard(card);
  if (parsed) {
    btn.classList.add(parsed.isRed ? 'playing-card--red' : 'playing-card--black');
  }
  if (isOneEyeJack(card)) btn.classList.add('playing-card--jack', 'playing-card--one-eye');
  if (isTwoEyeJack(card)) btn.classList.add('playing-card--jack', 'playing-card--two-eye');

  const inner = document.createElement('span');
  inner.className = 'playing-card__face';

  const corner = (extra) => {
    const wrap = document.createElement('span');
    wrap.className = `playing-card__corner ${extra}`;
    const r = document.createElement('span');
    r.className = 'playing-card__rank';
    r.textContent = parsed ? parsed.rank : card;
    const s = document.createElement('span');
    s.className = 'playing-card__suit';
    s.textContent = parsed ? parsed.symbol : '';
    wrap.append(r, s);
    return wrap;
  };

  if (parsed) {
    inner.appendChild(corner('playing-card__corner--tl'));
    const mid = document.createElement('span');
    mid.className = 'playing-card__center';
    mid.textContent = parsed.symbol;
    inner.appendChild(mid);
    inner.appendChild(corner('playing-card__corner--br'));
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'playing-card__fallback';
    fallback.textContent = card;
    inner.appendChild(fallback);
  }

  btn.appendChild(inner);

  if (selectedCardIndex === idx) btn.classList.add('selected');

  btn.addEventListener('pointerenter', () => {
    hoverCard = card;
    if (state && state.status === 'playing') renderBoard();
  });
  btn.addEventListener('pointerdown', () => {
    hoverCard = card;
    if (state && state.status === 'playing') renderBoard();
  });
  btn.addEventListener('click', () => {
    if (state && state.status !== 'playing') return;
    selectedCardIndex = idx;
    renderHand();
    selectedCardInfo.textContent =
      `선택: ${card} — 보드에서 위치가 강조됩니다. 실제 두기는 내 턴에만 가능합니다. 데드카드는 아래 버튼으로 버립니다.`;
  });

  return btn;
}

function renderPlayers() {
  playersEl.innerHTML = '';
  const neededSeq = Number(state.seqsToWin || 1);
  const seqCounts = state.players.map((_, i) =>
    (state.sequences || []).filter((s) => s.owner === i).length,
  );
  state.players.forEach((p, idx) => {
    const el = document.createElement('div');
    el.className = 'player' + (state.currentPlayer === idx ? ' my-turn' : '');
    const meTag = idx === myIndex ? ' (나)' : '';
    const aiTag = p.isAI ? ' [AI]' : '';
    const turnTag = state.currentPlayer === idx ? ' <- 현재 턴' : '';
    const disconnectTag = p.disconnected ? ' (연결 끊김)' : '';
    const mySeq = seqCounts[idx] || 0;
    const seqTag = `시퀀스 ${mySeq}/${neededSeq}`;
    el.textContent = `${p.name}${meTag}${aiTag}${disconnectTag} | 손패 ${p.handSize}장 | ${seqTag}${turnTag}`;
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
    const target = state.targetHumanCount ?? state.maxPlayers ?? 3;
    const targetAi = state.numAI ?? 0;
    spectatorsEl.textContent += ` | 사람 ${humans}/${target}, AI ${targetAi}명`;
  }
}

function renderHand() {
  handEl.innerHTML = '';
  if (handToolbarEl) handToolbarEl.innerHTML = '';
  bindHandHoverGlobalsOnce();
  const me = state.players[myIndex];
  const cards = (me && me.hand) || [];
  cards.forEach((card, idx) => {
    handEl.appendChild(createPlayingCardButton(card, idx));
  });

  if (state.status === 'playing') {
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'hand-discard-btn';
    discardBtn.textContent = '선택 카드 데드카드 버리기';
    discardBtn.disabled = selectedCardIndex === null || !isMyTurn();
    discardBtn.addEventListener('click', () => {
      socket.emit('discardDeadCard', { cardIndex: selectedCardIndex });
    });
    if (handToolbarEl) handToolbarEl.appendChild(discardBtn);
  } else if (state.status === 'finished' && cards.length > 0) {
    selectedCardInfo.textContent = `게임 종료 — 남은 손패 ${cards.length}장을 확인할 수 있습니다.`;
  }

  handEl.onmouseleave = () => {
    clearHandHoverPreview();
  };
}

function renderBoard() {
  boardEl.innerHTML = '';
  const board = state.board;
  const chips = state.chips;
  const selectedCard = getSelectedCard();
  const seqMap = buildSequenceHighlightMap(state);

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

      const seqMeta = seqMap.get(cellKey(r, c));
      const owner = chips[r][c];
      if (owner !== null) {
        cell.classList.add('has-chip');
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.background = state.players[owner]?.color || '#94a3b8';
        cell.appendChild(chip);
      }

      const label = document.createElement('span');
      label.className = 'cell-label';
      label.textContent = card;
      cell.appendChild(label);

      if (seqMeta) {
        const tone = state.players[seqMeta.owner]?.color || '#fbbf24';
        cell.style.setProperty('--seq-tone', tone);
        cell.style.setProperty('--seq-sparkle-delay', `${(seqMeta.seqId % 4) * 0.09}s`);
        cell.classList.add('seq-line');
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
        !seqMeta &&
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

function didLocalViewerWin(winner) {
  if (!winner || winner.type === 'draw' || myIndex < 0) return false;
  if (winner.type === 'player') return winner.playerIdx === myIndex;
  if (winner.type === 'team') {
    const myTeam = state.players[myIndex]?.team;
    return myTeam === winner.team;
  }
  return false;
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
  } else if (w.type === 'draw') {
    if (Array.isArray(w.tiedTeams) && w.tiedTeams.length) {
      winnerLabel = '팀 동점 무승부';
    } else {
      const names = (w.tied || [])
        .map((idx) => {
          const p = state.players[idx];
          return p ? `${p.name}${p.isAI ? ' (AI)' : ''}` : `#${idx}`;
        })
        .join(', ');
      winnerLabel = names ? `동점 무승부 (${names})` : '무승부';
    }
  } else {
    winnerLabel = '승자';
  }

  let body = '';
  if (w.type === 'draw') {
    if (Array.isArray(w.tiedTeams) && w.tiedTeams.length) {
      body =
        '최대 수에 도달했습니다. 팀 시퀀스 수·칩 수까지 동점이라 무승부로 끝났습니다.';
    } else if (myIndex >= 0 && (w.tied || []).includes(myIndex)) {
      body = `최대 수에 도달했습니다. 완성 시퀀스·칩 수가 같아 ${winnerLabel}입니다.`;
    } else {
      body = `최대 수에 도달했습니다. ${winnerLabel}`;
    }
  } else if (state.viewer && state.viewer.isSpectator) {
    body = `게임 종료! 우승: ${winnerLabel} — 멋진 한 판이었습니다!`;
  } else if (myIndex < 0) {
    body = `게임 종료! 우승: ${winnerLabel} — 수고하셨습니다!`;
  } else if (w.type === 'player') {
    if (w.playerIdx === myIndex) {
      body =
        w.reason === 'ply_limit'
          ? '최대 수에 도달했습니다. 완성 시퀀스·놓인 칩 수로 이겼습니다!'
          : '승리했습니다! 축하합니다! 당신이 시퀀스를 먼저 완성했습니다.';
    } else {
      body =
        w.reason === 'ply_limit'
          ? `최대 수에 도달했습니다. 우승: ${winnerLabel}(시퀀스·칩 연장 전)`
          : `아쉽게도 패배입니다. 우승: ${winnerLabel} — 다음 판도 화이팅!`;
    }
  } else if (w.type === 'team') {
    const myTeam = state.players[myIndex]?.team;
    if (myTeam === w.team) {
      body =
        w.reason === 'ply_limit'
          ? '최대 수에 도달했습니다. 팀 시퀀스·칩 수로 이겼습니다!'
          : '팀 승리! 축하합니다! 팀이 시퀀스 목표를 먼저 달성했습니다.';
    } else {
      body =
        w.reason === 'ply_limit'
          ? `최대 수에 도달했습니다. 우승: ${winnerLabel}(시퀀스·칩 연장 전)`
          : `패배입니다. 우승: ${winnerLabel} — 다음엔 역전해요!`;
    }
  } else {
    body = `게임 종료! 우승: ${winnerLabel}`;
  }

  if (didLocalViewerWin(w) && fanfarePlayedForKey !== key) {
    fanfarePlayedForKey = key;
    playVictoryFanfare();
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
  const targetHumans = state.targetHumanCount ?? state.maxPlayers ?? 3;
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
    lobbyHintEl.textContent =
      '게임이 종료되었습니다. 방장: 게임 다시하기 또는 로비로 나가기 / 참가자: 방 나가기';
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
  if (handSectionEl) {
    handSectionEl.classList.toggle('hand-section--finished', state.status === 'finished');
  }
  renderPlayers();
  renderTurnSpotlight();
  renderHand();
  renderBoard();
  renderLog();
  maybeShowGameResultBanner();
  if (state.status !== 'finished' && !resultBannerEl.hidden) {
    resultBannerEl.hidden = true;
  }

  if (state.status === 'finished' && state.viewer) {
    postGameBar.hidden = false;
    const isHost = state.viewer.isHost;
    rematchBtn.disabled = !isHost;
    rematchBtn.title = isHost ? '' : '방장만 사용할 수 있습니다';
    backToLobbyBtn.textContent = isHost ? '로비로 나가기' : '방 나가기';
  } else {
    postGameBar.hidden = true;
  }
}

socket.on('state', (s) => {
  const prev = state;
  if (
    prev &&
    prev.status === 'playing' &&
    s.status === 'playing' &&
    prev.chips &&
    s.chips &&
    detectNewChipPlaced(prev.chips, s.chips)
  ) {
    playChipPlaceSound();
  }
  state = s;
  if (s.status === 'lobby') {
    humanCountInput.value = String(s.targetHumanCount ?? s.maxPlayers ?? 3);
    aiCountInput.value = String(s.numAI ?? 0);
  }
  renderState();
});

socket.on('errorMsg', (msg) => {
  alert(msg);
});

socket.on('leftRoom', () => {
  resetLocalClientState();
});

function setupPwaUi() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  if (!pwaInstallBtn) return;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    /** @type {Navigator & { standalone?: boolean }} */ (window.navigator).standalone === true;
  if (isStandalone) {
    pwaInstallBtn.hidden = true;
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    pwaInstallBtn.hidden = false;
    pwaInstallBtn.textContent = '앱 설치';
    pwaInstallBtn.removeAttribute('title');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    pwaInstallBtn.hidden = true;
  });

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    pwaInstallBtn.hidden = false;
    pwaInstallBtn.textContent = '홈 화면에 추가';
    pwaInstallBtn.title = 'Safari 공유 버튼 → 홈 화면에 추가';
  }

  pwaInstallBtn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      pwaInstallBtn.hidden = true;
      return;
    }
    if (isIOS) {
      alert(
        'Safari 하단의 공유(□↑)를 누른 뒤 「홈 화면에 추가」를 선택하면 앱처럼 설치할 수 있습니다.',
      );
      return;
    }
    alert(
      '브라우저 메뉴(Chrome ⋮ 등)에서 이 사이트 설치·앱 설치 항목을 찾거나, 주소창 오른쪽의 설치 아이콘을 눌러 주세요.',
    );
  });
}

setupPwaUi();
