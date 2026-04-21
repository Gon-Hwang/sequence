'use strict';

// ── Board Layout ──────────────────────────────────────────────────────────────
// Each non-jack card appears exactly twice. Corners = FREE.
// Generated with seeded shuffle (seed=7777) for consistent layout.

const SUITS = ['S', 'H', 'D', 'C'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Q', 'K', 'A'];

function buildCardList() {
  const cards = [];
  for (const s of SUITS) for (const v of VALUES) cards.push(v + s);
  return cards; // 48 cards
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed | 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBoard() {
  const cards48 = buildCardList();
  const shuffled = seededShuffle([...cards48, ...cards48], 7777); // 96 cards
  const board = Array.from({ length: 10 }, () => Array(10).fill(null));
  board[0][0] = board[0][9] = board[9][0] = board[9][9] = 'FREE';
  let idx = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      if (board[r][c] === 'FREE') continue;
      board[r][c] = shuffled[idx++];
    }
  }
  return board;
}

const BOARD_LAYOUT = buildBoard(); // fixed for all games

// Jack classification
// One-eyed: JS (J of Spades), JH (J of Hearts) → remove opponent chip
// Two-eyed: JD (J of Diamonds), JC (J of Clubs) → wild placement
const ONE_EYE_JACKS = new Set(['JS', 'JH']);
const TWO_EYE_JACKS = new Set(['JD', 'JC']);
function isJack(card) { return card[0] === 'J' || card.startsWith('J'); }
function isOneEyeJack(card) { return ONE_EYE_JACKS.has(card); }
function isTwoEyeJack(card) { return TWO_EYE_JACKS.has(card); }

// Build card→positions lookup
function buildCardPositions() {
  const map = {};
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const card = BOARD_LAYOUT[r][c];
      if (card === 'FREE') continue;
      if (!map[card]) map[card] = [];
      map[card].push([r, c]);
    }
  }
  return map;
}
const CARD_POSITIONS = buildCardPositions();

// ── Sequence Detection ─────────────────────────────────────────────────────────
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];

function findNewSequences(chips, existingSeqCells, lastR, lastC) {
  const owner = chips[lastR][lastC];
  if (!owner) return [];
  const newSeqs = [];

  for (const [dr, dc] of DIRS) {
    const line = [];
    for (let k = -4; k <= 4; k++) {
      const r = lastR + dr * k, c = lastC + dc * k;
      if (r < 0 || r > 9 || c < 0 || c > 9) { line.push(null); continue; }
      line.push({ r, c, owner: chips[r][c] });
    }
    // Find runs of 5+ same owner (FREE corners count for owner)
    let run = [];
    for (const cell of line) {
      if (!cell) { run = []; continue; }
      const cellOwner = chips[cell.r][cell.c];
      const isFree = BOARD_LAYOUT[cell.r][cell.c] === 'FREE';
      // free corner = neutral, can be used by anyone
      if (cellOwner === owner || isFree) {
        run.push(cell);
        if (run.length >= 5) {
          const cells = run.slice(-5).map(x => `${x.r},${x.c}`);
          const key = cells.sort().join('|');
          const alreadyUsed = existingSeqCells.has(key);
          if (!alreadyUsed) {
            newSeqs.push({ owner, cells: run.slice(-5), key });
          }
        }
      } else {
        run = [];
      }
    }
  }
  return newSeqs;
}

// ── Deck ───────────────────────────────────────────────────────────────────────
function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const v of [...VALUES, 'J']) {
      deck.push(v + s);
      deck.push(v + s); // 2 full decks
    }
  }
  return deck; // 104 cards × 2 = wait, 13 × 4 × 2 = 104
}

function shuffleDeck(deck, seed) {
  return seededShuffle(deck, seed);
}

// ── Hand size rules ────────────────────────────────────────────────────────────
function handSize(numPlayers) {
  if (numPlayers === 2) return 7;
  return 6;
}

/** 전체 플레이어가 번갈아 둔 총 수(한 번의 놓기/버리기 = 1). 무한 장기전 방지용 */
const MAX_GAME_PLIES = 1000;

// ── GameState class ────────────────────────────────────────────────────────────
class GameState {
  constructor(code, maxPlayers, numAI) {
    this.code = code;
    this.maxPlayers = maxPlayers; // human + AI total
    this.numAI = numAI;
    this.status = 'lobby'; // lobby | playing | finished
    this.players = []; // { id, name, isHost, isAI, color, hand, team }
    this.chips = Array.from({ length: 10 }, () => Array(10).fill(null)); // chip owner index
    this.sequences = []; // [{owner, cells, key}]
    this.seqCellsUsed = new Set();
    this.deck = [];
    this.discardPile = [];
    this.currentPlayer = 0;
    this.winner = null; // player index or team
    this.log = []; // game log messages
    this.createdAt = Date.now();
    this.plyCount = 0;
  }

  addPlayer(id, name, isHost) {
    const colors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
    const idx = this.players.length;
    this.players.push({
      id,
      name,
      isHost,
      isAI: false,
      color: colors[idx],
      hand: [],
      team: idx % 2, // 0 or 1 for team mode
      disconnected: false,
    });
  }

  addAI(name) {
    const colors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
    const idx = this.players.length;
    this.players.push({
      id: `ai_${idx}`,
      name: name || `AI ${idx}`,
      isHost: false,
      isAI: true,
      color: colors[idx],
      hand: [],
      team: idx % 2,
      disconnected: false,
    });
  }

  startGame() {
    // Add AI players
    const aiNames = ['강한 AI', '보통 AI', '약한 AI', '전략 AI'];
    for (let i = 0; i < this.numAI; i++) {
      this.addAI(aiNames[i] || `AI ${i + 1}`);
    }

    this.status = 'playing';
    this.plyCount = 0;
    this.deck = shuffleDeck(buildDeck(), Date.now());
    this.currentPlayer = 0;

    const hs = handSize(this.players.length);
    for (const p of this.players) {
      p.hand = this.drawCards(hs);
    }
    this.logMsg('게임이 시작되었습니다!');
  }

  drawCards(n) {
    const cards = [];
    for (let i = 0; i < n; i++) {
      if (this.deck.length === 0) {
        this.deck = shuffleDeck([...this.discardPile], Date.now());
        this.discardPile = [];
      }
      if (this.deck.length > 0) cards.push(this.deck.pop());
    }
    return cards;
  }

  // Returns { success, error }
  playCard(playerIdx, cardIndex, row, col) {
    const player = this.players[playerIdx];
    if (!player) return { success: false, error: 'Invalid player' };
    const card = player.hand[cardIndex];
    if (!card) return { success: false, error: 'Invalid card' };

    const boardCard = BOARD_LAYOUT[row]?.[col];
    if (boardCard === undefined) return { success: false, error: 'Invalid position' };

    if (isTwoEyeJack(card)) {
      // Wild: place on any empty cell (not FREE corner chips though)
      if (this.chips[row][col] !== null) return { success: false, error: '이미 칩이 있는 자리입니다' };
      if (boardCard === 'FREE') return { success: false, error: '코너는 자동으로 채워집니다' };
      this.placeChip(playerIdx, row, col);
    } else if (isOneEyeJack(card)) {
      // Remove any opponent chip
      const chipOwner = this.chips[row][col];
      if (chipOwner === null) return { success: false, error: '제거할 칩이 없습니다' };
      if (chipOwner === playerIdx) return { success: false, error: '자신의 칩은 제거할 수 없습니다' };
      // Cannot remove chip that's part of a completed sequence
      const cellKey = `${row},${col}`;
      const inSeq = this.sequences.some(seq => seq.cells.some(c => `${c.r},${c.c}` === cellKey));
      if (inSeq) return { success: false, error: '완성된 시퀀스의 칩은 제거할 수 없습니다' };
      this.chips[row][col] = null;
      this.logMsg(`${player.name}이(가) 잭으로 (${row},${col}) 칩을 제거했습니다`);
    } else {
      // Normal card
      if (boardCard !== card) return { success: false, error: '카드가 보드 위치와 맞지 않습니다' };
      if (this.chips[row][col] !== null) return { success: false, error: '이미 칩이 있는 자리입니다' };
      this.placeChip(playerIdx, row, col);
    }

    // Remove card from hand, draw new one
    this.discardPile.push(card);
    player.hand.splice(cardIndex, 1);
    const newCards = this.drawCards(1);
    player.hand.push(...newCards);

    this.checkWin();
    if (this.status === 'playing') this.nextTurn();
    this.bumpPly();
    return { success: true };
  }

  placeChip(playerIdx, row, col) {
    this.chips[row][col] = playerIdx;
    this.logMsg(`${this.players[playerIdx].name}이(가) (${row},${col})에 칩을 놓았습니다`);
    // Check sequences at this position
    const newSeqs = findNewSequences(this.chips, this.seqCellsUsed, row, col);
    for (const seq of newSeqs) {
      seq.owner = playerIdx;
      seq.cells.forEach(c => this.seqCellsUsed.add(`${c.r},${c.c}`));
      this.sequences.push(seq);
      this.logMsg(`🎉 ${this.players[playerIdx].name}이(가) 시퀀스 완성!`);
    }
  }

  discardDeadCard(playerIdx, cardIndex) {
    const player = this.players[playerIdx];
    const card = player.hand[cardIndex];
    if (!card) return { success: false, error: 'Invalid card' };
    if (isOneEyeJack(card) || isTwoEyeJack(card)) return { success: false, error: '잭은 데드카드가 아닙니다' };

    const positions = CARD_POSITIONS[card] || [];
    const allOccupied = positions.every(([r, c]) => this.chips[r][c] !== null);
    if (!allOccupied) return { success: false, error: '이 카드는 아직 놓을 수 있는 자리가 있습니다' };

    this.discardPile.push(card);
    player.hand.splice(cardIndex, 1);
    const newCards = this.drawCards(1);
    player.hand.push(...newCards);
    this.logMsg(`${player.name}이(가) 데드카드 ${card}를 버렸습니다`);
    this.nextTurn();
    this.bumpPly();
    return { success: true };
  }

  // AI 전용 비상 탈출: 교착(예: 한눈 잭만 있는데 제거할 상대 칩이 없음)일 때 턴이 멈추지 않게 처리
  aiForceDiscardAnyCard(playerIdx, cardIndex) {
    const player = this.players[playerIdx];
    const card = player.hand[cardIndex];
    if (!card) return { success: false, error: 'Invalid card' };
    this.discardPile.push(card);
    player.hand.splice(cardIndex, 1);
    const newCards = this.drawCards(1);
    player.hand.push(...newCards);
    this.logMsg(`${player.name}이(가) ${card}를 강제로 버렸습니다(AI)`);
    this.nextTurn();
    this.bumpPly();
    return { success: true };
  }

  bumpPly() {
    this.plyCount += 1;
    if (this.status !== 'playing') return;
    if (this.plyCount < MAX_GAME_PLIES) return;
    this.endGameByPlyLimit();
  }

  endGameByPlyLimit() {
    if (this.status !== 'playing') return;
    const np = this.players.length;

    if (np === 4) {
      let t0Seq = 0;
      let t1Seq = 0;
      for (const s of this.sequences) {
        const team = this.players[s.owner].team;
        if (team === 0) t0Seq += 1;
        else t1Seq += 1;
      }
      if (t0Seq > t1Seq) {
        const teamPlayers = this.players.map((p, i) => i).filter((i) => this.players[i].team === 0);
        this.winner = { type: 'team', team: 0, players: teamPlayers, reason: 'ply_limit' };
      } else if (t1Seq > t0Seq) {
        const teamPlayers = this.players.map((p, i) => i).filter((i) => this.players[i].team === 1);
        this.winner = { type: 'team', team: 1, players: teamPlayers, reason: 'ply_limit' };
      } else {
        let t0Chips = 0;
        let t1Chips = 0;
        for (let r = 0; r < 10; r++) {
          for (let c = 0; c < 10; c++) {
            const o = this.chips[r][c];
            if (o === null) continue;
            const team = this.players[o].team;
            if (team === 0) t0Chips += 1;
            else t1Chips += 1;
          }
        }
        if (t0Chips > t1Chips) {
          const teamPlayers = this.players.map((p, i) => i).filter((i) => this.players[i].team === 0);
          this.winner = { type: 'team', team: 0, players: teamPlayers, reason: 'ply_limit' };
        } else if (t1Chips > t0Chips) {
          const teamPlayers = this.players.map((p, i) => i).filter((i) => this.players[i].team === 1);
          this.winner = { type: 'team', team: 1, players: teamPlayers, reason: 'ply_limit' };
        } else {
          this.winner = { type: 'draw', tiedTeams: [0, 1], reason: 'ply_limit' };
        }
      }
    } else {
      const seqCounts = this.players.map((_, i) => this.sequences.filter((s) => s.owner === i).length);
      const maxSeq = Math.max(...seqCounts);
      const leaders = seqCounts.map((c, i) => (c === maxSeq ? i : -1)).filter((i) => i >= 0);
      if (leaders.length === 1) {
        this.winner = { type: 'player', playerIdx: leaders[0], reason: 'ply_limit' };
      } else {
        const chipCounts = leaders.map((i) => ({
          i,
          n: this.chips.flat().filter((o) => o === i).length,
        }));
        chipCounts.sort((a, b) => b.n - a.n);
        const topN = chipCounts[0].n;
        const topLeaders = chipCounts.filter((c) => c.n === topN).map((c) => c.i);
        if (topLeaders.length === 1) {
          this.winner = { type: 'player', playerIdx: topLeaders[0], reason: 'ply_limit' };
        } else {
          this.winner = { type: 'draw', tied: topLeaders, reason: 'ply_limit' };
        }
      }
    }

    this.status = 'finished';
    this.logMsg(`최대 수(${this.plyCount}수)에 도달해 게임을 종료했습니다.`);
  }

  seqsToWin() {
    if (this.players.length <= 2) return 2;
    if (this.players.length === 3) return 1;
    return 2; // 4 players team mode
  }

  checkWin() {
    const needed = this.seqsToWin();
    const np = this.players.length;

    if (np === 4) {
      // Team mode: teams 0 and 1
      for (let team = 0; team < 2; team++) {
        const teamPlayers = this.players.map((p, i) => i).filter(i => this.players[i].team === team);
        const teamSeqs = this.sequences.filter(s => teamPlayers.includes(s.owner)).length;
        if (teamSeqs >= needed) {
          this.status = 'finished';
          this.winner = { type: 'team', team, players: teamPlayers };
          this.logMsg(`팀 ${team + 1} 승리!`);
          return;
        }
      }
    } else {
      for (let i = 0; i < np; i++) {
        const mySeqs = this.sequences.filter(s => s.owner === i).length;
        if (mySeqs >= needed) {
          this.status = 'finished';
          this.winner = { type: 'player', playerIdx: i };
          this.logMsg(`🏆 ${this.players[i].name} 승리!`);
          return;
        }
      }
    }
  }

  nextTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
  }

  logMsg(msg) {
    this.log.push({ msg, time: Date.now() });
    if (this.log.length > 50) this.log.shift();
  }

  // Returns state visible to all (hides other players' hands)
  getPublicState(forSocketId) {
    const myIdx = forSocketId ? this.players.findIndex(p => p.id === forSocketId) : -1;
    return {
      code: this.code,
      status: this.status,
      maxPlayers: this.maxPlayers,
      numAI: this.numAI,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        isAI: p.isAI,
        color: p.color,
        team: p.team,
        handSize: p.hand.length,
        hand: i === myIdx ? p.hand : undefined,
        disconnected: p.disconnected,
      })),
      board: BOARD_LAYOUT,
      chips: this.chips,
      sequences: this.sequences.map(s => ({ owner: s.owner, cells: s.cells })),
      currentPlayer: this.currentPlayer,
      winner: this.winner,
      deckSize: this.deck.length,
      log: this.log.slice(-20),
      seqsToWin: this.seqsToWin(),
      targetHumanCount: this.targetHumanCount ?? this.maxPlayers,
    };
  }

  // Full state for AI (sees all hands)
  getFullState() {
    return {
      players: this.players,
      board: BOARD_LAYOUT,
      chips: this.chips,
      sequences: this.sequences,
      currentPlayer: this.currentPlayer,
      cardPositions: CARD_POSITIONS,
    };
  }
}

module.exports = { GameState, BOARD_LAYOUT, CARD_POSITIONS, isOneEyeJack, isTwoEyeJack, isJack };
