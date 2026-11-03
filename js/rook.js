// Rook (games/rook.html): online play and the table. The rules are in js/rook-engine.js.
(function () {
  const isLocalFile = location.protocol === 'file:';
  const gamePath = isLocalFile ? location.pathname : location.pathname.replace(/\.html$/i, '');
  function updateAddress(url) {
    if (isLocalFile) return;
    try { window.history.replaceState(null, '', url); } catch { /* URL cleanup must never prevent play. */ }
  }
  if (gamePath !== location.pathname) updateAddress(gamePath + location.search + (location.hash || ''));
  const {
    SUITS, SUIT_NAMES, DECK, MAX_BID, sumPoints, teamOf, effSuit, cardName, shuffle, legalPlays, minBid,
    newGame, applyAction, collectTrick, viewFor, currentGame, handsCsv, tricksCsv
  } = RookEngine;

  // ---------- Page ----------
  const PEER_PREFIX = 'jace-rook-';
  const TRICK_PAUSE = 1600;
  const SHUFFLE_MS = 1000;   // deal animation: shuffle, then one card to each player every DEAL_MS
  const DEAL_MS = 500;
  const POS = ['bottom', 'left', 'top', 'right'];   // where each seat sits, counting from you

  const $ = id => document.getElementById(id);
  const reportPreview = new URLSearchParams(location.search).get('preview') === 'reports';
  let reportPreviewLog = null;
  let reportPreviewSource = 'Completed sample game';
  const nameInput = $('nameInput');
  const nameError = $('nameError');
  const joinInput = $('joinInput');
  const onlinePanel = $('onlinePanel');
  const onlineMsg = $('onlineMsg');
  const copyBtn = $('copyBtn');
  const copyPracticeSeedBtn = $('copyPracticeSeedBtn');
  const rejoinBtn = $('rejoinBtn');
  const leaveBtn = $('leaveBtn');
  const optionBoxes = document.querySelectorAll('[data-option]');

  // Shared by host and guests
  let role = null;       // null (not in a game), 'host', or 'guest'
  let myName = '';
  let gameCode = '';
  let shareLink = '';
  let view = null;       // latest view of the game from the host
  let picked = [];       // cards selected to bury
  let pickedTrump = null;
  let dropConfirmed = false;
  let showWidowCards = false;
  let separateByColorHand = storage('rook-separate-by-color-hand') === 'true' || storage('rook-group-bury-hand') === 'true';
  let handDirection = storage('rook-hand-direction') || 'ltr';
  let confirmCardBeforePlay = storage('rook-confirm-card-before-play') === 'true';
  let pendingPlayCard = null;
  let paperScore = storage('rook-paper-score') === 'true';
  let paperScorePage = 0;
  let paperScoreGameNo = null;
  let paperScoreTearTimer = null;
  const paperScoreTapedPages = new Map();
  let celebratedHand = '';
  let scoreDialogDismissal = null;
  let peer = null;
  const voice = new GameVoice({ onChange: () => renderVoice() });
  let deal = null;       // { order, step, shuffling, timer } while the deal animation plays
  let dealtKey = '';     // the hand that was last animated, so each deal only plays once

  // Host only
  let G = null;          // full game state, null while in the lobby
  let lobby = [null, null, null, null];   // { id, name, connected } per seat
  let conns = new Map(); // peer id -> connection
  let swapFrom = null;   // lobby seat the host clicked first
  let trickTimer = null;
  let botTimer = null;
  let practiceMode = false;
  let practiceSeed = '';
  let practiceGrandSlam = false;
  let practiceGrandSlamSuit = 'r';
  let options = { live: false, log: false };   // host settings: live hand scores, trick-by-trick game log

  // Guest only
  let conn = null;
  let rejected = false;

  const esc = s => String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const cardImg = (c, cls = '') =>
    `<img class="rook-cardimg ${cls}" src="../img/rook/${c}.jpg" alt="${cardName(c)}" draggable="false">`;
  const suitChip = s => `<span class="rook-suit ${s}">${SUIT_NAMES[s]}</span>`;

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key) || '';
      localStorage.setItem(key, value);
    } catch (e) { return ''; }
  }

  // ---------- Host ----------

  const seatsNow = () => (G ? G.seats : lobby);
  const seatOfId = id => seatsNow().findIndex(s => s && s.id === id);

  function lobbyView(seat) {
    return {
      phase: 'lobby', mySeat: seat,
      seats: lobby.map(s => s && { name: s.name, connected: s.connected, voice: s.voice || null, pid: s.pid || null })
    };
  }

  // Sends every player their own view of the game, then redraws the host's screen
  function broadcast() {
    if (botTimer !== null) {
      clearTimeout(botTimer);
      botTimer = null;
    }
    for (const [id, c] of conns) {
      const seat = seatOfId(id);
      if (seat < 0 || !c.open) continue;
      c.send({ type: 'view', view: G ? viewFor(G, seat, options) : lobbyView(seat) });
    }
    view = G ? viewFor(G, seatOfId('host'), options) : lobbyView(seatOfId('host'));
    render();
    scheduleBotAction();
  }

  function hostAct(id, action) {
    const seat = seatOfId(id);
    if (!G || seat < 0 || !applyAction(G, seat, action)) return;
    if (practiceMode && practiceGrandSlam && action.type === 'again') setGrandSlamTestHand(G, practiceGrandSlamSuit);
    if (G.trickDone) {
      clearTimeout(trickTimer);
      trickTimer = setTimeout(() => { collectTrick(G); broadcast(); }, TRICK_PAUSE);
    }
    broadcast();
  }

  function hostGame() {
    if (!peerAvailable()) return;
    role = 'host';
    practiceMode = false;
    practiceGrandSlam = false;
    $('gameGoalMode').value = 'points500';
    updateGameGoalControls();
    gameCode = randomCode();
    G = null;
    options = { live: false, log: false };
    optionBoxes.forEach(box => { box.checked = false; });
    lobby = [{ id: 'host', pid: PEER_PREFIX + gameCode, name: myName, connected: true }, null, null, null];
    showOnline('Creating game…');
    peer = new Peer(PEER_PREFIX + gameCode);
    voice.attach(peer);
    peer.on('open', () => {
      shareLink = isLocalFile ? gameCode : `${location.origin}${gamePath}?join=${gameCode}`;
      broadcast();
    });
    peer.on('connection', c => {
      c.on('data', msg => onHostData(c, msg));
      c.on('close', () => onGuestLeft(c));
    });
    peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
    peer.on('error', onPeerError);
  }

  function startPractice() {
    if (!requireName()) return;
    role = 'host';
    practiceMode = true;
    practiceGrandSlam = $('practiceGrandSlam').checked;
    practiceGrandSlamSuit = $('practiceGrandSlamSuit').value;
    dropConfirmed = false;
    showWidowCards = false;
    picked = [];
    pickedTrump = null;
    gameCode = '';
    shareLink = '';
    practiceSeed = $('practiceSeedInput').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
      || Math.floor(Math.random() * 0x100000000).toString(36);
    $('practiceLog').checked = false;
    options = { live: false, log: false };
    optionBoxes.forEach(box => { box.checked = false; });
    lobby = [
      { id: 'host', name: myName, connected: true },
      ...[1, 2, 3].map(n => ({ id: `bot-${n}`, name: `Rook Bot ${n}`, connected: true }))
    ];
    const random = Math.random;
    Math.random = seededRandom(practiceSeed);
    try {
      G = newGame(lobby.map(s => ({ ...s })));
      if ($('practiceGrandSlam').checked) setGrandSlamTestHand(G, $('practiceGrandSlamSuit').value);
    }
    finally { Math.random = random; }
    swapFrom = null;
    broadcast();
  }

  function seededRandom(seed) {
    let state = parseInt(seed, 36) >>> 0;
    if (!state) state = 0x6d2b79f5;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function setGrandSlamTestHand(game, suit) {
    const testHand = ['rk', `${suit}1`, ...Array.from({ length: 11 }, (_, i) => `${suit}${14 - i}`)];
    const rest = shuffle(DECK.filter(card => !testHand.includes(card)));
    const widow = rest.filter(card => card[0] !== suit).slice(0, 5);
    const botCards = shuffle(rest.filter(card => !widow.includes(card)));
    game.hands = [testHand, ...[0, 1, 2].map(i => botCards.slice(i * 13, (i + 1) * 13))];
    game.widow = widow;
  }

  function reject(c, reason) {
    c.send({ type: 'reject', reason });
    setTimeout(() => c.close(), 500);
  }

  function onHostData(c, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'act') { hostAct(c.peer, msg.action); return; }
    if (msg.type === 'voice') { setVoiceState(c.peer, msg.state); return; }
    if (msg.type !== 'hello') return;

    const name = cleanName(msg.name);
    if (!name) return reject(c, 'Enter a name to join.');
    const seats = seatsNow();
    const seat = seats.findIndex(s => s && sameName(s.name, name));
    if (seat >= 0) {
      // Same name = same person coming back (a refresh can beat the old connection timing out)
      if (seats[seat].id === 'host') return reject(c, `The host is already called ${esc(name)}. Pick another name and join again.`);
      const old = conns.get(seats[seat].id);
      conns.delete(seats[seat].id);
      if (old) old.close();
      seats[seat].id = seats[seat].pid = c.peer;
      seats[seat].connected = true;
      seats[seat].voice = null;
    } else if (G) {
      return reject(c, 'That game has already started. To rejoin, use the same name you played with.');
    } else {
      const free = lobby.indexOf(null);
      if (free < 0) return reject(c, 'That game already has four players.');
      lobby[free] = { id: c.peer, pid: c.peer, name, connected: true };
    }
    conns.set(c.peer, c);
    broadcast();
  }

  function onGuestLeft(c) {
    if (conns.get(c.peer) !== c) return;
    conns.delete(c.peer);
    const seat = seatOfId(c.peer);
    if (seat >= 0) {
      if (G) Object.assign(G.seats[seat], { connected: false, voice: null });
      else lobby[seat] = null;
    }
    if (role === 'host') broadcast();
  }

  // Who's in voice lives on the seat, so every player can see it and call the others
  function setVoiceState(id, state) {
    const seat = seatOfId(id);
    if (seat < 0) return;
    seatsNow()[seat].voice = state === 'on' || state === 'muted' ? state : null;
    broadcast();
  }

  function startGame() {
    if (role !== 'host' || G || lobby.includes(null)) return;
    const gameType = selectedGameType();
    if (!gameType) { $('gameGoalValue').focus(); return; }
    G = newGame(lobby.map(s => ({ ...s })), [], gameType);
    swapFrom = null;
    broadcast();
  }

  function selectedGameType() {
    const mode = $('gameGoalMode').value;
    if (mode === 'points500') return { mode: 'points', value: 500 };
    const input = $('gameGoalValue');
    const value = Number(input.value);
    const min = mode === 'hands' ? 1 : 100;
    const max = mode === 'hands' ? 100 : 5000;
    if (!Number.isInteger(value) || value < min || value > max || (mode === 'points' && value % 5 !== 0)) return null;
    return { mode, value };
  }

  function updateGameGoalControls() {
    const mode = $('gameGoalMode').value;
    const fixed = mode !== 'points500';
    $('gameGoalValueRow').hidden = !fixed;
    $('gameGoalValueLabel').textContent = mode === 'hands' ? 'Number of hands' : 'Point total';
    const input = $('gameGoalValue');
    input.min = mode === 'hands' ? '1' : '100';
    input.max = mode === 'hands' ? '100' : '5000';
    input.step = mode === 'hands' ? '1' : '5';
    input.value = mode === 'hands' ? '10' : '750';
  }

  function swapSeats(a, b) {
    [lobby[a], lobby[b]] = [lobby[b], lobby[a]];
    broadcast();
  }

  // ---------- Guest ----------

  function joinGame(code) {
    if (!code || !peerAvailable()) return;
    role = 'guest';
    gameCode = code;
    rejected = false;
    showOnline('Connecting…');
    peer = new Peer();
    voice.attach(peer);
    peer.on('open', () => {
      conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      conn.on('open', () => conn.send({ type: 'hello', name: myName }));
      conn.on('data', onGuestData);
      conn.on('close', onHostLost);
    });
    peer.on('error', onPeerError);
  }

  function onGuestData(msg) {
    if (msg.type === 'view') {
      view = msg.view;
      render();
    } else if (msg.type === 'reject') {
      rejected = true;
      showOnline(msg.reason);
    }
  }

  function onHostLost() {
    conn = null;
    if (role !== 'guest') return;
    voice.leave();
    if (rejected) {
      // Keep the host's reason on screen and go back to the start
      teardown();
      leaveBtn.hidden = true;
      render();
      return;
    }
    showOnline('Lost connection to the game. If the host still has it open, you can rejoin.', { rejoin: true });
  }

  // ---------- Both ----------

  function act(action) {
    if (role === 'host') hostAct('host', action);
    else if (conn && conn.open) conn.send({ type: 'act', action });
  }

  function showOnline(html, { link = false, rejoin = false } = {}) {
    onlinePanel.hidden = false;
    onlineMsg.innerHTML = html;
    copyBtn.hidden = !link;
    copyPracticeSeedBtn.hidden = !practiceMode;
    rejoinBtn.hidden = !rejoin;
    leaveBtn.hidden = role === null;
    $('practiceOptions').hidden = !practiceMode;
    $('hostOptions').hidden = role !== 'host' || practiceMode;
    $('gameGoalMode').disabled = !!G;
    $('gameGoalValue').disabled = !!G;
  }

  function randomCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // Accepts a bare code or a pasted invite link
  function parseCode(text) {
    text = text.trim();
    const m = text.match(/[?&]join=([a-z0-9]+)/i);
    return (m ? m[1] : text).toLowerCase();
  }

  function peerAvailable() {
    if (typeof Peer !== 'undefined') return true;
    showOnline("Online play couldn't load. Check your connection or ad blocker and refresh.");
    return false;
  }

  function onPeerError(err) {
    if (err.type === 'unavailable-id' && role === 'host' && !G) { teardown(); hostGame(); return; }  // code collision, try another
    if (err.type === 'peer-unavailable' && (role === 'host' || (conn && conn.open))) return;
    if (err.type === 'peer-unavailable') {
      rejected = true;
      showOnline("Couldn't find that game. Double-check the code, or ask the host for a new link.", { rejoin: !!gameCode });
      return;
    }
    showOnline(`Connection problem (${esc(err.type)}). Try again in a moment.`, { rejoin: role === 'guest' });
  }

  // Drops every connection without touching the URL or panel
  function teardown() {
    clearTimeout(trickTimer);
    clearTimeout(botTimer);
    botTimer = null;
    stopDeal();
    voice.leave();
    const p = peer;
    peer = conn = null;
    for (const c of conns.values()) c.close();
    conns = new Map();
    if (p) p.destroy();
    G = null;
    view = null;
    role = null;
    practiceMode = false;
  }

  function leave() {
    teardown();
    gameCode = '';
    onlinePanel.hidden = true;
    updateAddress(gamePath);  // drop ?join= so a refresh doesn't rejoin
    render();
  }

  // ---------- Rendering ----------

  function nameOf(seat, { you = true } = {}) {
    if (seat === view.mySeat && you) return 'You';
    const s = view.seats[seat];
    return s ? esc(s.name) : 'Open seat';
  }

  const teamNames = t => [t, t + 2].map(i => esc(view.seats[i].name)).join(' &amp; ');
  const teamLabel = t => `<span class="t${t}-text">Team ${t + 1}</span>`;
  const gameTypeText = type => type.mode === 'hands' ? `${type.value} hands` : `first to ${type.value} points`;
  const posOf = seat => POS[(seat - view.mySeat + 4) % 4];

  function render() {
    const inGame = view && view.phase !== 'lobby';
    $('idle').hidden = role !== null;
    $('lobby').hidden = !(view && view.phase === 'lobby');
    $('table').hidden = !inGame;
    if (!view) { renderVoice(); return; }
    if (!reportPreview && view.phase === 'gameover' && Array.isArray(view.log)) {
      storage('rook-last-completed-game', JSON.stringify(view));
    }
    $('voiceControls').hidden = practiceMode;
    if (view.phase !== 'widow') { picked = []; pickedTrump = null; dropConfirmed = false; showWidowCards = false; }
    if (view.phase === 'lobby') renderLobby();
    else {
      syncDeal();
      renderTable();
    }
    renderOnline();
    scheduleBotAction();
    // Call (or hang up on) whoever else is in voice
    voice.sync(view.seats.filter((s, i) => s && i !== view.mySeat && s.connected && s.voice).map(s => s.pid));
    renderVoice();
  }

  const voiceIcon = s => (s && s.voice === 'muted' ? ' <span class="rook-voice-icon" title="In voice, muted">🔇</span>'
    : s && s.voice ? ' <span class="rook-voice-icon" title="In voice">🎙️</span>' : '');

  // Voice buttons, plus a glow on the seat of whoever is talking (cheap, so it can run often)
  function renderVoice() {
    const inGame = !!view && (role === 'host' || !!conn) && !practiceMode;
    $('voiceControls').hidden = !inGame;
    $('voiceJoinBtn').hidden = voice.joined;
    $('voiceMuteBtn').hidden = $('voiceLeaveBtn').hidden = !voice.joined;
    $('voiceMuteBtn').textContent = voice.muted ? '🔇 Unmute' : 'Mute';
    if (!view) return;
    document.querySelectorAll('.rook-seat[data-seat], .rook-lobby-seat[data-seat]').forEach(el => {
      const i = Number(el.dataset.seat);
      const s = view.seats[i];
      const talking = !!s && (i === view.mySeat ? voice.isSpeaking() : voice.isSpeaking(s.pid));
      el.classList.toggle('speaking', talking);
    });
  }

  // Tells the host whether we're in voice (and muted), so the others can call us
  function sendVoiceState() {
    const state = voice.joined ? (voice.muted ? 'muted' : 'on') : null;
    if (role === 'host') setVoiceState('host', state);
    else if (conn && conn.open) conn.send({ type: 'voice', state });
  }

  function showVoiceError(message) {
    $('voiceMsg').textContent = message;
    $('voiceMsg').hidden = !message;
  }

  // ---------- Deal animation (purely visual; the host has already dealt) ----------

  // Starts the animation for a freshly dealt hand, or cuts it short once bidding is underway
  function syncDeal() {
    const v = view;
    const fresh = v.phase === 'bidding' && v.bids.every(b => b === null) && v.hand.length === 13;
    if (!fresh) { stopDeal(); return; }
    const key = v.hand.join();
    if (key === dealtKey) return;
    dealtKey = key;
    stopDeal();
    deal = { order: shuffle(v.hand.slice()), step: 0, shuffling: true };
    deal.timer = setTimeout(dealNext, practiceMode ? 250 : SHUFFLE_MS);
  }

  function stopDeal() {
    if (deal) clearTimeout(deal.timer);
    deal = null;
  }

  function dealNext() {
    if (!deal || !view) return;
    deal.shuffling = false;
    deal.step++;
    renderTable();
    flyCards();
    // After the 13th card lands, sort the hand and open the bidding
    deal.timer = setTimeout(deal.step < 13 ? dealNext : () => { deal = null; render(); }, practiceMode ? 90 : DEAL_MS);
  }

  // One card back flies from the deck to each seat, going around from the dealer's left
  function flyCards() {
    const felt = $('felt');
    const deck = felt.querySelector('.rook-deck');
    if (!deck) return;
    const box = felt.getBoundingClientRect();
    const from = deck.getBoundingClientRect();
    const x = from.left + from.width / 2;
    const y = from.top + from.height / 2;
    felt.querySelectorAll('.rook-seat').forEach(seatEl => {
      const seat = Number(seatEl.dataset.seat);
      const to = seatEl.getBoundingClientRect();
      const card = document.createElement('img');
      card.className = 'rook-fly';
      card.src = '../img/rook/back.jpg';
      card.alt = '';
      card.style.left = `${x - box.left}px`;
      card.style.top = `${y - box.top}px`;
      card.style.setProperty('--dx', `${to.left + to.width / 2 - x}px`);
      card.style.setProperty('--dy', `${to.top + to.height / 2 - y}px`);
      card.style.animationDelay = `${((seat - view.dealer + 3) % 4) * 90}ms`;
      card.addEventListener('animationend', () => card.remove());
      felt.appendChild(card);
    });
  }

  function renderOnline() {
    if (rejected || (role === 'guest' && !conn)) return;
    const away = view.phase !== 'lobby' ? view.seats.filter(s => !s.connected).map(s => esc(s.name)) : [];
    let msg = practiceMode
      ? `${reportPreview ? `${reportPreviewSource} · ` : ''}Practice mode · Three computer players${practiceGrandSlam ? ` · Grand slam test hand (${SUIT_NAMES[practiceGrandSlamSuit]})` : ''} · Deal code <strong>${esc(practiceSeed)}</strong>`
      : role === 'host'
      ? `Game code <strong>${gameCode}</strong>. You're hosting, so keep this tab open.`
      : `Connected as <strong>${esc(view.seats[view.mySeat] ? view.seats[view.mySeat].name : myName)}</strong> (game <strong>${gameCode}</strong>).`;
    if (away.length) msg += ` <strong>${away.join(', ')}</strong> dropped. They can rejoin with the same link and name.`;
    showOnline(msg, { link: role === 'host' && !!shareLink });
  }

  function scheduleBotAction() {
    if (!practiceMode || !G || deal || botTimer !== null) return;
    let seat = null;
    if (G.phase === 'bidding' && G.turn !== 0) seat = G.turn;
    else if (G.phase === 'raise' && G.bidWinner !== 0) seat = G.bidWinner;
    else if (G.phase === 'reveal') seat = [1, 2, 3].find(s => !G.widowSeen[s]);
    else if (G.phase === 'widow' && G.bidWinner !== 0) seat = G.bidWinner;
    else if (G.phase === 'play' && !G.trickDone && G.turn !== 0) seat = G.turn;
    else if (G.phase === 'score-review') seat = [1, 2, 3].find(s => !G.scoreSeen[s]);
    if (seat === undefined || seat === null) return;
    botTimer = setTimeout(() => {
      botTimer = null;
      if (!practiceMode || !G) return;
      const action = botAction(seat);
      if (action) hostAct(G.seats[seat].id, action);
    }, 350);
  }

  function botAction(seat) {
    if (G.phase === 'bidding') {
      if (practiceGrandSlam) return { type: 'bid', amount: 'pass' };
      const target = botBidTarget(G.hands[seat]);
      const minimum = minBid(G);
      return { type: 'bid', amount: target >= minimum ? target : 'pass' };
    }
    if (G.phase === 'raise') return { type: 'raise', amount: null };
    if (G.phase === 'reveal') return { type: 'seen' };
    if (G.phase === 'score-review') return { type: 'score-seen' };
    if (G.phase === 'widow') {
      const hand = G.hands[seat];
      const bury = hand.slice().sort((a, b) => cardBurialValue(a) - cardBurialValue(b)).slice(0, 5);
      const trump = SUITS.slice().sort((a, b) => botSuitStrength(hand, b) - botSuitStrength(hand, a))[0];
      return { type: 'widow', discards: bury, trump };
    }
    if (G.phase === 'play') {
      const legal = legalPlays(G.hands[seat], G.trick, G.trump);
      const card = legal.slice().sort((a, b) => cardBurialValue(a) - cardBurialValue(b))[0];
      return card ? { type: 'play', card } : null;
    }
    return null;
  }

  function botBidTarget(hand) {
    const strength = Math.max(...SUITS.map(s => botSuitStrength(hand, s)));
    if (strength < 6.5) return 0;
    return Math.min(MAX_BID, 100 + Math.floor((strength - 6.5) / 0.55) * 5);
  }

  function botSuitStrength(hand, suit) {
    const cards = hand.filter(c => c !== 'rk' && c[0] === suit);
    const honors = cards.filter(c => Number(c.slice(1)) >= 11 || c.endsWith('1')).length;
    const aces = cards.filter(c => c.endsWith('1')).length;
    return cards.length + honors * 0.65 + aces * 0.8;
  }

  function cardBurialValue(card) {
    if (card === 'rk') return 100;
    const rank = Number(card.slice(1));
    return (rank === 1 ? 15 : rank) + sumPoints([card]) * 2;
  }

  function renderLobby() {
    const count = view.seats.filter(Boolean).length;
    const isHost = role === 'host';
    $('lobbyStatus').textContent = count < 4
      ? `Waiting for players (${count}/4)…`
      : isHost ? "Everyone's here! Set the teams and start." : 'Waiting for the host to start the game…';

    $('lobbyTeams').innerHTML = [0, 1].map(t => `
      <div class="rook-lobby-team">
        <h3>${teamLabel(t)}</h3>
        ${[t, t + 2].map(i => {
      const s = view.seats[i];
      const tag = isHost ? 'button type="button"' : 'div';
      const cls = 'rook-lobby-seat' + (s ? '' : ' empty') + (swapFrom === i ? ' picked' : '');
      const label = s ? `${esc(s.name)}${i === view.mySeat ? ' (you)' : ''}${voiceIcon(s)}` : 'Waiting for a player…';
      return `<${tag} class="${cls}" data-seat="${i}">${label}<small>Seat ${i + 1}</small></${tag.split(' ')[0]}>`;
    }).join('')}
      </div>`).join('');

    $('lobbyHint').textContent = isHost
      ? 'Click two seats to swap them. Partners sit across, and play goes Seat 1 → 2 → 3 → 4.'
      : 'Partners sit across from each other. The host can move people around.';
    $('lobbyActions').hidden = !isHost;
    $('startBtn').disabled = count < 4 || !selectedGameType();
    $('shuffleBtn').disabled = count < 2;
  }

  function renderTable() {
    const v = view;
    const me = v.mySeat;
    $('scoreDialogOpen').disabled = !v.history.length;
    $('logDialogOpen').hidden = !v.log;
    $('droppedCardList').innerHTML = v.droppedCards
      ? v.droppedCards.map(c => `<figure>${cardImg(c)}<figcaption>${cardName(c)}</figcaption></figure>`).join('')
      : '';

    // Scoreboard
    let info = `Game: <strong>${gameTypeText(v.gameType)}</strong><br>Hand <strong>${v.handNo}</strong> · Dealer <strong>${nameOf(v.dealer)}</strong>`;
    if (v.bidWinner !== null) info += `<br>Bid <strong>${v.bid}</strong> by <strong>${nameOf(v.bidWinner)}</strong>`;
    else if (v.highBid) info += `<br>High bid <strong>${v.highBid}</strong>`;
    if (v.trump) info += `<br>Trump ${suitChip(v.trump)}`;
    $('scoreboard').innerHTML = [0, 1].map(t => `
      <div class="rook-team t${t}">
        <span class="rook-team-label">Team ${t + 1}${teamOf(me) === t ? ' (you)' : ''}</span>
        <span class="rook-team-names">${teamNames(t)}</span>
        <span class="rook-team-score">${v.scores[t]}</span>
        ${v.live && v.phase === 'play' ? `<span class="rook-team-taken">${liveScore(t)}</span>` : ''}
      </div>`).join('<div class="rook-handinfo">' + info + '</div>');

    $('status').innerHTML = statusText();

    // Seats around the table
    let felt = '';
    for (let s = 0; s < 4; s++) {
      const seat = v.seats[s];
      const cls = ['rook-seat', 'pos-' + posOf(s), 't' + teamOf(s)];
      const waiting = ['bidding', 'play'].includes(v.phase) && !v.trickDone && !deal && v.turn === s;
      const deciding = ['raise', 'widow'].includes(v.phase) && v.bidWinner === s;
      const looking = v.phase === 'reveal' && !v.widowSeen[s];
      if (waiting || deciding || looking) cls.push('turn');
      if (!seat.connected) cls.push('away');

      let badge = '';
      if (v.phase === 'bidding' && v.bids[s] !== null) {
        badge = v.bids[s] === 'pass' ? '<span class="rook-badge pass">Pass</span>' : `<span class="rook-badge">${v.bids[s]}</span>`;
      } else if (v.phase === 'reveal' && v.widowSeen[s]) {
        badge = '<span class="rook-badge pass">Seen ✓</span>';
      } else if (v.bidWinner === s) {
        badge = `<span class="rook-badge">Bid ${v.bid}</span>`;
      }
      const meta = [`${deal ? deal.step : v.counts[s]} cards`];
      if (v.dealer === s) meta.push('dealer');
      if (!seat.connected) meta.push('disconnected');
      felt += `<div class="${cls.join(' ')}" data-seat="${s}">
        <div class="rook-seat-name">${s === me ? 'You' : esc(seat.name)}${voiceIcon(seat)}</div>
        <div class="rook-seat-meta">${meta.join(' · ')}</div>
        ${badge}
      </div>`;
    }

    // Cards in the middle
    let mid = '';
    const back = '<img src="../img/rook/back.jpg" alt="" draggable="false">';
    if (deal) mid = `<div class="rook-deck${deal.shuffling ? ' shuffling' : ''}" aria-hidden="true">${back.repeat(3)}</div>`;
    else if (v.phase === 'bidding') mid = v.highBid ? `High bid<br><strong>${v.highBid}</strong>` : 'Bidding<br>starts at 100';
    else if (v.phase === 'raise') mid = 'Widow<br>5 cards';
    else if (v.phase === 'reveal') mid = 'Widow<br>face up';
    else if (v.phase === 'widow') mid = 'Widow<br>picked up';
    else if (v.phase === 'play' && !v.trick.length) mid = `Trick ${v.trickNo + 1}<br>of 13`;
    const winnerSeat = v.trickDone && v.lastTrick ? v.lastTrick.winner : null;
    felt += `<div class="rook-center">
      ${v.trick.map(p => `<div class="slot-${posOf(p.seat)}">${cardImg(p.card, p.seat === winnerSeat ? 'winner' : '')}</div>`).join('')}
      <div class="rook-mid">${mid}</div>
    </div>`;
    if (v.droppedCards && v.droppedCards.length === 5) {
      felt += '<button type="button" class="btn btn-outline btn-sm rook-dropped-felt-button" id="droppedCardsDialogOpen">Dropped Widow</button>';
    }
    $('felt').innerHTML = felt;

    renderActions();
    renderHand();

    // Last trick, so nobody misses what happened
    const lt = v.lastTrick;
    $('lastTrick').innerHTML = lt && !v.trickDone && v.phase === 'play'
      ? `Last trick: <span class="rook-mini-cards">${lt.plays.map(p => cardImg(p.card)).join('')}</span>
         <strong>${nameOf(lt.winner)}</strong> took ${lt.points} pts`
      : '';

    renderLog();
    renderHistory();
    const scoreDialog = $('scoreDialog');
    scoreDialogDismissal?.update();
    const scorecardReview = v.phase === 'score-review' || (v.phase === 'gameover' && paperScore);
    if (scorecardReview && !scoreDialog.open) scoreDialog.showModal();
    if (!scorecardReview && scoreDialog.open) scoreDialog.close();
  }

  // Points taken so far this hand (host's Live scores option); the widow isn't counted until the last trick
  function liveScore(t) {
    const v = view;
    const taken = v.taken[t];
    if (teamOf(v.bidWinner) !== t) return `${taken} pts this hand`;
    return taken >= v.bid ? `${taken} of ${v.bid}, bid made!` : `${taken} of ${v.bid} (${v.bid - taken} to go)`;
  }

  const listNames = seats => {
    const names = seats.map(s => nameOf(s));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  };

  function statusText() {
    const v = view;
    const me = v.mySeat;
    const myTurn = v.turn === me;
    if (deal) {
      if (!deal.shuffling) return `${nameOf(v.dealer)} ${v.dealer === me ? 'are' : 'is'} dealing…`;
      return `${nameOf(v.dealer)} ${v.dealer === me ? 'are' : 'is'} shuffling…`;
    }
    switch (v.phase) {
      case 'bidding': {
        const min = minBid(v);
        if (!myTurn) return `Waiting for ${nameOf(v.turn)} to bid…`;
        return min > MAX_BID ? 'The bid is maxed out at 180. You have to pass.' : `Your bid. Bid at least ${min}, or pass.`;
      }
      case 'raise':
        return v.bidWinner === me
          ? `You won the bid at ${v.bid}! Raise it before you see the widow, or keep it.`
          : `${nameOf(v.bidWinner)} won the bid at ${v.bid}…`;
      case 'reveal': {
        if (!v.widowSeen[me]) return "Here's the widow. Take a look, then click Got It.";
        const left = [0, 1, 2, 3].filter(s => !v.widowSeen[s]);
        return `Waiting for ${listNames(left)} to look at the widow…`;
      }
      case 'widow':
        return v.bidWinner === me
          ? dropConfirmed ? 'Dropped cards confirmed. Choose trump for your remaining hand.' : 'Select five cards to drop, then confirm your drops.'
          : `${nameOf(v.bidWinner)} is choosing cards to drop and naming trump…`;
      case 'play': {
        if (v.trickDone) {
          const lt = v.lastTrick;
          return `${nameOf(lt.winner)} ${lt.winner === me ? 'take' : 'takes'} the trick (${lt.points} pts)`;
        }
        if (!myTurn) return `Waiting for ${nameOf(v.turn)} to play…`;
        if (!v.trick.length) return 'Your lead. Play any card.';
        const lead = effSuit(v.trick[0].card, v.trump);
        const leadName = lead === 'trump' ? `trump (${SUIT_NAMES[v.trump]})` : SUIT_NAMES[lead];
        const legal = legalPlays(v.hand, v.trick, v.trump);
        if (legal.length && legal.every(c => effSuit(c, v.trump) === lead)) return `Your turn. Follow ${leadName}.`;
        if (legal.length < v.hand.length) return `Your turn. You're out of ${leadName}, so you have to trump.`;
        return `Your turn. You're out of ${leadName} and trump, so play anything.`;
      }
      case 'score-review': {
        const left = [0, 1, 2, 3].filter(s => !v.scoreSeen[s]);
        return v.scoreSeen[me] ? `Scorecard acknowledged. Waiting for ${listNames(left)}…` : `Hand ${v.handNo} is done. Review the scorecard and acknowledge it to continue.`;
      }
      case 'gameover':
        return v.winner === null ? `The game is tied after ${v.gameType.value} hands.` : `Team ${v.winner + 1} wins the game! 🎉`;
    }
    return '';
  }

  function renderActions() {
    const v = view;
    const me = v.mySeat;
    const el = $('actions');
    let html = '';

    if (pendingPlayCard && (v.phase !== 'play' || v.turn !== me || v.trickDone ||
      !legalPlays(v.hand, v.trick, v.trump).includes(pendingPlayCard))) pendingPlayCard = null;

    if (deal) {
      // Nobody bids until the cards are out
    } else if (v.phase === 'bidding' && v.turn === me) {
      const min = minBid(v);
      if (min <= MAX_BID) {
        let opts = '';
        for (let b = min; b <= MAX_BID; b += 5) opts += `<option value="${b}">${b}</option>`;
        html += `<select id="bidSelect" aria-label="Bid amount">${opts}</select>
          <button type="button" class="btn btn-primary btn-sm" data-act="bid">Bid</button>`;
      }
      html += `<button type="button" class="btn btn-outline btn-sm" data-act="pass">Pass</button>`;
    } else if (v.phase === 'raise' && v.bidWinner === me) {
      let opts = '';
      for (let b = v.bid + 5; b <= MAX_BID; b += 5) opts += `<option value="${b}">${b}</option>`;
      html = `<select id="raiseSelect" aria-label="Raise to">${opts}</select>
        <button type="button" class="btn btn-outline btn-sm" data-act="raise">Raise</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="keep">Keep ${v.bid}</button>`;
    } else if (v.phase === 'reveal') {
      const taker = v.bidWinner === me ? 'You pick' : `${nameOf(v.bidWinner)} picks`;
      html = `<div class="rook-summary">
        <h3>The Widow</h3>
        <div class="rook-widow-cards">${v.widow.map(c => cardImg(c)).join('')}</div>
        <p>${sumPoints(v.widow)} points. ${taker} it up once everyone has seen it.</p>
        ${v.widowSeen[me]
          ? '<p><strong>Got it ✓</strong></p>'
          : '<button type="button" class="btn btn-primary btn-sm" data-act="seen">Got It</button>'}
      </div>`;
    } else if (v.phase === 'widow' && v.bidWinner === me) {
      html = `<span class="rook-count">${picked.length}/5 cards selected to drop</span>
        <label class="rook-toggle rook-widow-toggle"><input type="checkbox" data-toggle="widow-cards" ${showWidowCards ? 'checked' : ''}> Show cards received from widow</label>
        ${!dropConfirmed ? `
          <span class="rook-step">Select five cards to drop</span>
          <button type="button" class="btn btn-primary btn-sm" data-act="confirm-drops" ${picked.length === 5 ? '' : 'disabled'}>Confirm drops</button>` : `
          <span class="rook-step">Now choose trump</span>
          <span class="rook-trumps" role="group" aria-label="Choose trump suit">
            ${SUITS.map(s => {
              const count = v.hand.filter(c => !picked.includes(c) && c !== 'rk' && c[0] === s).length;
              return `<button type="button" class="rook-trump ${s}${pickedTrump === s ? ' active' : ''}" data-trump="${s}" aria-pressed="${pickedTrump === s}"><span>${SUIT_NAMES[s]}</span><strong>${count}</strong></button>`;
            }).join('')}
          </span>
          <button type="button" class="btn btn-outline btn-sm" data-act="change-drops">Change dropped cards</button>
          <button type="button" class="btn btn-primary btn-sm" data-act="widow" ${pickedTrump ? '' : 'disabled'}>Start hand</button>`}`;
    } else if (v.phase === 'gameover' && v.result) {
      html = summaryHtml();
    }

    if (pendingPlayCard) {
      html += `<span class="rook-play-confirm-label">Play ${cardName(pendingPlayCard)}?</span>
        <button type="button" class="btn btn-primary btn-sm" data-act="confirm-play">Confirm play</button>
        <button type="button" class="btn btn-outline btn-sm" data-act="cancel-play">Cancel</button>`;
    }

    el.innerHTML = html;
    el.hidden = !html;
    $('handSorting').innerHTML = v.hand && v.hand.length ? `
      <button type="button" class="btn btn-outline btn-sm" data-act="group-hand" aria-pressed="${separateByColorHand}">${separateByColorHand ? 'Show one hand' : 'Separate by color'}</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="hand-direction" aria-pressed="${handDirection === 'rtl'}">Hand: ${handDirection === 'ltr' ? 'left to right' : 'right to left'}</button>` : '';
  }

  function summaryHtml() {
    const v = view;
    const r = v.result;
    const bt = teamOf(r.bidWinner);
    const ot = 1 - bt;
    const slamTeam = r.taken[0] === 180 ? 0 : 1;
    const lines = r.grandSlam ? [
      `<strong class="rook-slam-label">Grand slam!</strong> ${teamLabel(slamTeam)} (${teamNames(slamTeam)}) took all 180 points and scores <strong>+180</strong>.`,
      `Dropped cards <span class="rook-mini-cards">${r.discards.map(c => cardImg(c)).join('')}</span>
       (${r.widowPts} pts to Team ${r.widowTeam + 1} for the last trick).`
    ] : [
      `${teamLabel(bt)} (${teamNames(bt)}) bid <strong>${r.bid}</strong> in ${suitChip(r.trump)} and took <strong>${r.taken[bt]}</strong>:
       ${r.made ? `made it, <strong>+${r.bid}</strong>` : `set, <strong class="neg">−${r.bid}</strong>`}.`,
      `${teamLabel(ot)} (${teamNames(ot)}) took <strong>${r.taken[ot]}</strong>: <strong>+${r.delta[ot]}</strong>.`,
      `Dropped cards <span class="rook-mini-cards">${r.discards.map(c => cardImg(c)).join('')}</span>
       (${r.widowPts} pts to Team ${r.widowTeam + 1} for the last trick).`
    ];
    const over = v.phase === 'gameover';
    const slamKey = `${v.gameNo}-${v.handNo}`;
    if (r.grandSlam && celebratedHand !== slamKey) {
      celebratedHand = slamKey;
      playFireworks();
    }
    return `<div class="rook-summary ${r.grandSlam ? 'grand-slam' : ''}">
      <h3>${over ? v.winner === null ? `Game tied, ${v.scores[0]} to ${v.scores[1]}` : `${teamLabel(v.winner)} wins, ${v.scores[v.winner]} to ${v.scores[1 - v.winner]}! 🎉` : `Hand ${v.handNo} results`}</h3>
      <p class="rook-game-type-result">Game type: ${gameTypeText(v.gameType)}</p>
      ${lines.map(l => `<p>${l}</p>`).join('')}
      <button type="button" class="btn btn-primary btn-sm" data-act="again">Play Again</button>
      ${over ? exportButtons(true) : ''}
    </div>`;
  }

  function playFireworks() {
    const layer = document.createElement('div');
    layer.className = 'rook-fireworks';
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 216; i++) {
      const spark = document.createElement('i');
      const burst = Math.floor(i / 12);
      const wave = Math.floor(burst / 6);
      const location = burst % 6;
      spark.style.setProperty('--x', `${12 + location * 15}%`);
      spark.style.setProperty('--y', `${20 + (location % 3) * 20}%`);
      spark.style.setProperty('--angle', `${(i % 12) * 30 + Math.random() * 12}deg`);
      spark.style.setProperty('--distance', `${55 + Math.random() * 125}px`);
      spark.style.setProperty('--delay', `${wave * 1.35 + Math.random() * 0.5}s`);
      spark.style.setProperty('--hue', `${Math.floor(Math.random() * 360)}`);
      layer.appendChild(spark);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 5100);
  }

  function renderHand() {
    const v = view;
    const me = v.mySeat;
    const burying = v.phase === 'widow' && v.bidWinner === me;
    const playing = v.phase === 'play' && v.turn === me && !v.trickDone;
    const legal = playing ? legalPlays(v.hand, v.trick, v.trump) : [];
    const widow = v.widow || [];

    // While dealing, cards arrive one at a time in the order dealt; they're sorted once the deal is done
    const dealtCards = deal ? deal.order.slice(0, deal.step) : v.hand;
    const cards = burying && dropConfirmed ? dealtCards.filter(c => !picked.includes(c)) : dealtCards;
    const cardMarkup = c => {
      const cls = ['rook-card'];
      if ((burying && !dropConfirmed) || legal.includes(c)) cls.push('live');
      if (playing && !legal.includes(c)) cls.push('dim');
      if (burying && picked.includes(c)) cls.push('sel');
      if (playing && pendingPlayCard === c) cls.push('pending');
      if (burying && showWidowCards && widow.includes(c)) cls.push('new');
      const live = (burying && !dropConfirmed) || legal.includes(c);
      return `<button type="button" class="${cls.join(' ')}" data-card="${c}" ${live ? '' : 'tabindex="-1"'} aria-disabled="${playing && !legal.includes(c)}"
        aria-label="${cardName(c)}" aria-pressed="${playing && pendingPlayCard === c}">${cardImg(c).replace('rook-cardimg ', '')}</button>`;
    };
    const hand = $('hand');
    hand.classList.toggle('rtl', handDirection === 'rtl');
    const grouped = separateByColorHand && !deal;
    hand.classList.toggle('grouped', grouped);
    if (grouped) {
      hand.innerHTML = (cards.includes('rk') ? `<div class="rook-suit-row"><span class="rook-suit-label rook-label">Rook</span><div class="rook-suit-cards">${cardMarkup('rk')}</div></div>` : '') + SUITS.map(s => {
        const suitCards = cards.filter(c => c !== 'rk' && c[0] === s);
        return suitCards.length ? `<div class="rook-suit-row"><span class="rook-suit-label ${s}">${SUIT_NAMES[s]}</span><div class="rook-suit-cards">${suitCards.map(cardMarkup).join('')}</div></div>` : '';
      }).join('');
    } else hand.innerHTML = cards.map(cardMarkup).join('');

    $('handHint').textContent = burying
      ? dropConfirmed ? 'Your five dropped cards are confirmed. Choose a trump color above.'
        : showWidowCards ? 'Cards from the widow have a green border. Tap five cards to drop.' : 'Tap five cards to drop. Confirm your selection to choose trump.'
      : playing ? 'Click a card to play it.' : '';
  }

  // Trick-by-trick log, newest hand first. Shown when the host turns it on, and to everyone once the game is over.
  // Each trick reads left to right in play order, with the player's name under their card.
  function renderLog() {
    const v = view;
    const el = $('gameLog');
    if (!v.log) { el.innerHTML = ''; return; }
    const over = v.phase === 'gameover';
    const hands = v.log.filter(h => h.tricks.length).reverse();
    const play = (p, t) => `<figure class="rook-log-play">
        ${cardImg(p.card, p.seat === t.winner ? 'winner' : '')}
        <figcaption class="t${teamOf(p.seat)}-text">${nameOf(p.seat, { you: false })}</figcaption>
      </figure>`;

    const logScope = practiceMode ? `practice-${practiceSeed}` : (gameCode || 'game');
    el.innerHTML = `<h3>${over ? 'Full Game Log' : 'Game Log'}</h3>` + hands.map(h => {
      const stateKey = `rook-log-${logScope}-${v.gameNo}-${h.hand}`;
      return `
      <details data-log-key="${stateKey}" ${storage(stateKey) === 'true' ? 'open' : ''}>
        <summary>Hand ${h.hand} · Bid ${h.bid} by ${nameOf(h.bidWinner, { you: false })} · ${suitChip(h.trump)}</summary>
        <table>
          <thead><tr><th>Trick</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th><th>Taken by</th><th>Pts</th></tr></thead>
          <tbody>${h.tricks.map((t, n) => `<tr>
              <td>${n + 1}</td>
              ${t.plays.map(p => `<td>${play(p, t)}</td>`).join('')}
              <td><strong class="t${teamOf(t.winner)}-text">${nameOf(t.winner, { you: false })}</strong></td>
              <td>${t.points}</td>
            </tr>`).join('')}</tbody>
        </table>
      </details>`;
    }).join('')
      + `<p class="rook-log-note">${over ? 'Every trick from the game. ' : 'The host turned on the game log. '}Cards are in the order they were played; gold outline = took the trick.</p>`;
    bindLogDetails(el);
  }

  function bindLogDetails(root) {
    root.querySelectorAll('details[data-log-key]').forEach(details => {
      details.addEventListener('toggle', () => storage(details.dataset.logKey, String(details.open)));
    });
  }

  function renderHistory() {
    const v = view;
    if (!v.history.length) { $('history').innerHTML = ''; return; }
    const cell = n => `<span class="${n < 0 ? 'neg' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
    // The host can save the game so far at any point (everyone can once the game is over)
    const exportBtn = role === 'host' && v.phase !== 'gameover' ? ` <span class="rook-export">${exportButtons(false)}</span>` : '';
    const forcedPaper = v.phase === 'score-review';
    const toggle = forcedPaper ? '' : `<button type="button" class="btn btn-outline btn-sm rook-score-toggle" data-score-view>${paperScore ? 'Show score sheet' : 'Show paper scorecard'}</button>`;
    $('scoreDialog').classList.toggle('rook-score-spread', paperScore && v.phase === 'gameover');
    if (paperScore || forcedPaper) {
      if (paperScoreGameNo !== v.gameNo) {
        paperScoreGameNo = v.gameNo;
        paperScorePage = 0;
        paperScoreTapedPages.clear();
      }
      const pageSize = 5;
      const pageCount = Math.ceil(v.history.length / pageSize);
      if (forcedPaper) paperScorePage = Math.floor((v.history.length - 1) / pageSize);
      paperScorePage = Math.max(0, Math.min(paperScorePage, pageCount - 1));
      const scoreText = n => n < 0 ? `<span class="rook-paper-minus">−</span>${Math.abs(n)}` : String(n);
      const makeSheet = page => {
        const start = page * pageSize;
        const end = Math.min(start + pageSize, v.history.length);
        const rows = v.history.slice(start, end).map((h, offset) => {
          const index = start + offset;
          const bidRow = `<tr class="rook-paper-bid-row${index === 0 ? '' : ' has-total'}">
            <td class="t0-text"><span>${scoreText(h.delta[0])}</span></td><td class="t1-text"><span>${scoreText(h.delta[1])}</span></td>
          </tr>`;
          if (index === 0) return bidRow;
          return bidRow + `<tr class="rook-paper-total"><td class="t0-text">${scoreText(h.scores[0])}</td><td class="t1-text">${scoreText(h.scores[1])}</td></tr>`;
        }).join('');
        const tapeCount = paperScoreTapedPages.get(page) || 0;
        const tape = Array.from({ length: tapeCount }, (_, i) => `<span class="rook-paper-tape" style="left:${8 + ((i * 23) % 78)}%;--tape-turn:${i % 2 ? '2deg' : '-3deg'}"></span>`).join('');
        return `<section class="rook-paper-scorecard" data-score-sheet="${page}">${tape}<h3>Paper Scorecard <small>Hands ${start + 1}–${end}</small></h3>
          <table><thead><tr><th class="t0-text">${teamNames(0)}</th><th class="t1-text">${teamNames(1)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
      };
      const completedSpread = paperScore && v.phase === 'gameover';
      const pagination = pageCount > 1 ? `<nav class="rook-paper-pagination" aria-label="Scorecard pages">
        <button type="button" class="btn btn-outline btn-sm" data-score-page="previous" ${paperScorePage === 0 ? 'disabled' : ''}>Previous</button>
        <span>Sheet ${paperScorePage + 1} of ${pageCount} · ${v.history.length} hands</span>
        <button type="button" class="btn btn-outline btn-sm" data-score-page="next" ${paperScorePage >= pageCount - 1 ? 'disabled' : ''}>Next</button>
      </nav>` : '';
      const scoreReview = forcedPaper ? `<div class="rook-score-ack">
        ${v.scoreSeen[v.mySeat]
          ? `<p><strong>Scorecard acknowledged.</strong> Waiting for ${listNames([0, 1, 2, 3].filter(s => !v.scoreSeen[s]))}.</p>`
          : `<p>Check this hand’s scores, then acknowledge to continue.</p><button type="button" class="btn btn-primary btn-sm" data-act="score-seen">I've checked the scorecard</button>`}
      </div>` : '';
      $('history').innerHTML = `${toggle}${completedSpread
        ? `<div class="rook-paper-spread">${Array.from({ length: pageCount }, (_, page) => makeSheet(page)).join('')}</div>`
        : `${makeSheet(paperScorePage)}${pagination}`}${scoreReview}`;
    } else {
      $('scoreDialog').classList.remove('rook-score-spread');
      $('history').innerHTML = `<h3>Score Sheet ${exportBtn}</h3>${toggle}
        <table>
          <thead><tr><th>Hand</th><th>Bid</th><th>Trump</th><th class="t0-text">Team 1</th><th class="t1-text">Team 2</th></tr></thead>
          <tbody>${v.history.map(h => `<tr>
            <td>${h.hand}</td>
            <td>${h.bid} · ${nameOf(h.bidWinner, { you: false })}${h.made ? '' : ' (set)'}</td>
            <td>${suitChip(h.trump)}</td>
            <td>${cell(h.delta[0])} → <strong>${h.scores[0]}</strong></td>
            <td>${cell(h.delta[1])} → <strong>${h.scores[1]}</strong></td>
          </tr>`).join('')}</tbody>
        </table>`;
    }
  }

  function changePaperScorePage(direction) {
    if (!view || paperScoreTearTimer) return;
    const pageCount = Math.ceil(view.history.length / 5);
    const nextPage = paperScorePage + direction;
    if (nextPage < 0 || nextPage >= pageCount) return;
    if (direction > 0) {
      const sheet = $('history').querySelector('.rook-paper-scorecard');
      if (sheet) sheet.classList.add('tearing');
      paperScoreTearTimer = setTimeout(() => {
        paperScorePage = nextPage;
        paperScoreTearTimer = null;
        renderHistory();
      }, 500);
    } else {
      paperScoreTapedPages.set(nextPage, (paperScoreTapedPages.get(nextPage) || 0) + 1);
      paperScorePage = nextPage;
      renderHistory();
    }
  }

  // A completed sample game can be loaded with ?preview=reports to review both scorecard layouts and logs.
  function setupReportPreview() {
    const seats = [
      { name: 'Jace', connected: true }, { name: 'Rook Bot 1', connected: true },
      { name: 'Rook Bot 2', connected: true }, { name: 'Rook Bot 3', connected: true }
    ];
    const rounds = [
      [0, 120, 'y', [120, 55], [125, 55]], [1, 140, 'r', [65, -140], [65, 115]],
      [0, 115, 'g', [115, 50], [130, 50]], [0, 150, 'b', [150, 30], [150, 30]],
      [1, 100, 'y', [75, -100], [75, 105]], [0, 100, 'r', [-100, 80], [80, 100]],
      [1, 120, 'g', [95, 120], [95, 85]], [0, 135, 'b', [135, 40], [140, 40]],
      [1, 110, 'r', [50, -110], [50, 130]], [0, 150, 'y', [-150, 100], [30, 150]]
    ];
    const runningScores = [0, 0];
    const history = rounds.map(([bidWinner, bid, trump, delta, taken], handIndex) => {
      runningScores[0] += delta[0];
      runningScores[1] += delta[1];
      const discards = Array.from({ length: 5 }, (_, i) => DECK[(handIndex * 5 + i) % 56]);
      return {
        hand: handIndex + 1, bidWinner, bid, trump, made: delta[bidWinner] >= bid,
        grandSlam: false, delta, taken, scores: runningScores.slice(), discards,
        widow: discards.slice(), widowPts: 0, widowTeam: (handIndex + 1) % 2
      };
    });
    const cards = DECK.slice(0, 52);
    reportPreviewLog = history.map((h, handIndex) => {
      const bids = [null, null, null, null];
      bids[h.bidWinner] = h.bid;
      return {
        hand: h.hand, dealer: (handIndex + 3) % 4, bids,
        bidWinner: h.bidWinner, bid: h.bid, trump: h.trump,
        tricks: Array.from({ length: 13 }, (_, n) => {
          const plays = Array.from({ length: 4 }, (__, i) => ({
            seat: (n + handIndex + i) % 4,
            card: cards[n * 4 + i]
          }));
          const winner = plays[(n + handIndex) % 4].seat;
          return { plays, winner, points: sumPoints(plays.map(p => p.card)) };
        })
      };
    });
    const result = history[9];
    const lastTrick = reportPreviewLog[9].tricks[12];
    result.lastTrick = lastTrick;
    result.widowPts = sumPoints(result.discards);

    role = 'host';
    myName = 'Jace';
    practiceMode = true;
    practiceSeed = 'sample-game';
    paperScore = true;
    $('practiceLog').checked = true;
    const sampleView = {
      phase: 'gameover', mySeat: 0, handNo: 10, dealer: 0, turn: 0,
      gameType: { mode: 'hands', value: 10 }, bids: [150, 'pass', 'pass', 'pass'],
      highBid: 0, highBidder: null, bidWinner: result.bidWinner, bid: result.bid,
      widowSeen: [true, true, true, true], log: reportPreviewLog, live: false,
      trump: result.trump, trick: [], trickDone: false, trickNo: 13, lastTrick,
      taken: result.taken, tricksWon: [8, 5], scores: result.scores,
      history, result, winner: 0, gameNo: 1, pastGames: [], seats,
      counts: [0, 0, 0, 0], hand: [], droppedCards: result.discards
    };
    if (new URLSearchParams(location.search).get('sample') !== '10') {
      try {
        const saved = JSON.parse(storage('rook-last-completed-game'));
        if (saved && saved.phase === 'gameover' && saved.result && saved.gameType && Array.isArray(saved.scores) && Array.isArray(saved.counts) && Array.isArray(saved.history) && Array.isArray(saved.log) && Array.isArray(saved.seats)) {
          view = saved;
          reportPreviewSource = 'Last completed game saved in this browser';
        }
      } catch (e) { /* use the sample game */ }
    }
    if (!view) view = sampleView;
    reportPreviewLog = view.log;
    practiceSeed = reportPreviewSource === 'Completed sample game' ? '10-hand-sample' : 'last-game';
    render();
  }

  // CSV download buttons. At game over everyone has the full game; mid-game only the host does.
  function exportButtons(over) {
    const btn = (kind, label, title) =>
      `<button type="button" class="btn btn-outline btn-sm" data-csv="${kind}" title="${title}">${label}</button>`;
    const games = (over ? (view.pastGames || []).length : 0) + 1;
    return `<span class="rook-downloads">
      <span class="rook-downloads-label">${over ? 'Download CSV:' : 'Export CSV:'}</span>
      ${btn('hands', 'Hand by Hand', 'One row per hand of this game')}
      ${btn('tricks', 'Trick by Trick', 'One row per trick of this game')}
      ${games > 1 ? btn('all', `All ${games} Games`, 'Every trick of every game played this session') : ''}
    </span>`;
  }

  // Builds and downloads a CSV. The host exports from the full game state; everyone else from the
  // game-over view, which includes the whole log and the earlier games this session.
  function exportGame(kind) {
    let current, past;
    if (role === 'host' && G) {
      current = currentGame(G);
      past = G.pastGames;
    } else if (view.log) {
      current = { game: view.gameNo, names: view.seats.map(s => s.name), log: view.log, history: view.history };
      past = view.pastGames || [];
    } else return;

    const games = kind === 'all' ? past.concat(current) : [current];
    const csv = kind === 'hands' ? handsCsv(games) : tricksCsv(games);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const name = kind === 'all' ? `rook-all-games-${stamp}.csv` : `rook-game-${current.game}-${kind === 'hands' ? 'hands' : 'tricks'}-${stamp}.csv`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));   // BOM so Excel reads names right
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------- Events ----------

  // CSV buttons live in the game-over summary and the host's Score Sheet
  [$('actions'), $('history')].forEach(el => el.addEventListener('click', e => {
    const actionButton = e.target.closest('[data-act="score-seen"]');
    if (actionButton) { act({ type: 'score-seen' }); return; }
    const pageButton = e.target.closest('[data-score-page]');
    if (pageButton) {
      changePaperScorePage(pageButton.dataset.scorePage === 'next' ? 1 : -1);
      return;
    }
    const btn = e.target.closest('[data-csv]');
    if (btn) exportGame(btn.dataset.csv);
    if (e.target.closest('[data-score-view]')) {
      paperScore = !paperScore;
      if (!reportPreview) storage('rook-paper-score', String(paperScore));
      renderHistory();
    }
  }));

  $('scoreDialogOpen').addEventListener('click', () => $('scoreDialog').showModal());
  $('logDialogOpen').addEventListener('click', () => $('logDialog').showModal());
  $('felt').addEventListener('click', e => {
    if (e.target.closest('#droppedCardsDialogOpen')) $('droppedCardsDialog').showModal();
  });
  scoreDialogDismissal = GameDialogs.bind($('scoreDialog'), {requiresConfirmation: () => view?.phase === 'score-review'});
  GameDialogs.bind($('logDialog'));
  GameDialogs.bind($('droppedCardsDialog'));

  $('lobbyTeams').addEventListener('click', e => {
    const btn = e.target.closest('button[data-seat]');
    if (!btn || role !== 'host') return;
    const seat = Number(btn.dataset.seat);
    if (swapFrom === null) swapFrom = seat;
    else {
      const from = swapFrom;
      swapFrom = null;
      if (from !== seat) { swapSeats(from, seat); return; }
    }
    render();
  });

  $('shuffleBtn').addEventListener('click', () => {
    shuffle(lobby);
    swapFrom = null;
    broadcast();
  });
  $('startBtn').addEventListener('click', startGame);
  $('gameGoalMode').addEventListener('change', () => {
    updateGameGoalControls();
    if (view && view.phase === 'lobby') renderLobby();
  });
  $('gameGoalValue').addEventListener('input', () => {
    if (view && view.phase === 'lobby') renderLobby();
  });
  updateGameGoalControls();

  $('voiceJoinBtn').addEventListener('click', async () => {
    showVoiceError('');
    $('voiceJoinBtn').disabled = true;
    try {
      await voice.join();
      sendVoiceState();
    } catch (e) {
      showVoiceError(e.message);
    }
    $('voiceJoinBtn').disabled = false;
    renderVoice();
  });
  $('voiceMuteBtn').addEventListener('click', () => {
    voice.setMuted(!voice.muted);
    sendVoiceState();
  });
  $('voiceLeaveBtn').addEventListener('click', () => {
    voice.leave();
    sendVoiceState();
  });

  optionBoxes.forEach(box => box.addEventListener('change', () => {
    if (role !== 'host') return;
    options = { ...options, [box.dataset.option]: box.checked };
    broadcast();
  }));

  $('actions').addEventListener('click', e => {
    const trumpBtn = e.target.closest('[data-trump]');
    if (trumpBtn) {
      pickedTrump = trumpBtn.dataset.trump;
      renderActions();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'group-hand') {
      separateByColorHand = !separateByColorHand;
      storage('rook-separate-by-color-hand', String(separateByColorHand));
      renderHand();
      renderActions();
      return;
    }
    if (btn.dataset.act === 'hand-direction') {
      handDirection = handDirection === 'ltr' ? 'rtl' : 'ltr';
      storage('rook-hand-direction', handDirection);
      renderHand();
      renderActions();
      return;
    }
    if (btn.dataset.act === 'confirm-drops') {
      if (picked.length !== 5) return;
      dropConfirmed = true;
      pickedTrump = null;
      renderHand();
      renderActions();
      return;
    }
    if (btn.dataset.act === 'change-drops') {
      dropConfirmed = false;
      pickedTrump = null;
      renderHand();
      renderActions();
      return;
    }
    if (btn.dataset.act === 'confirm-play') {
      const card = pendingPlayCard;
      if (!card) return;
      pendingPlayCard = null;
      act({ type: 'play', card });
      return;
    }
    if (btn.dataset.act === 'cancel-play') {
      pendingPlayCard = null;
      renderHand();
      renderActions();
      return;
    }
    switch (btn.dataset.act) {
      case 'bid': act({ type: 'bid', amount: Number($('bidSelect').value) }); break;
      case 'pass': act({ type: 'bid', amount: 'pass' }); break;
      case 'raise': act({ type: 'raise', amount: Number($('raiseSelect').value) }); break;
      case 'keep': act({ type: 'raise', amount: null }); break;
      case 'seen': act({ type: 'seen' }); break;
      case 'widow':
        act({ type: 'widow', discards: picked.slice(), trump: pickedTrump });
        picked = [];
        pickedTrump = null;
        break;
      case 'again': act({ type: btn.dataset.act }); break;
    }
  });

  $('handSorting').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'group-hand') {
      separateByColorHand = !separateByColorHand;
      storage('rook-separate-by-color-hand', String(separateByColorHand));
      renderHand();
      renderActions();
    } else if (btn.dataset.act === 'hand-direction') {
      handDirection = handDirection === 'ltr' ? 'rtl' : 'ltr';
      storage('rook-hand-direction', handDirection);
      renderHand();
      renderActions();
    }
  });

  $('actions').addEventListener('change', e => {
    if (!e.target.matches('[data-toggle="widow-cards"]')) return;
    showWidowCards = e.target.checked;
    renderHand();
  });

  $('hand').addEventListener('click', e => {
    const btn = e.target.closest('.rook-card.live');
    if (!btn) return;
    const c = btn.dataset.card;
    if (view.phase === 'widow') {
      if (picked.includes(c)) picked = picked.filter(x => x !== c);
      else if (picked.length < 5) picked.push(c);
      renderHand();
      renderActions();
    } else {
      if (confirmCardBeforePlay) {
        pendingPlayCard = c;
        renderHand();
        renderActions();
      } else act({ type: 'play', card: c });
    }
  });

  $('confirmCardBeforePlayToggle').checked = confirmCardBeforePlay;
  $('confirmCardBeforePlayToggle').addEventListener('change', e => {
    confirmCardBeforePlay = e.target.checked;
    storage('rook-confirm-card-before-play', String(confirmCardBeforePlay));
    if (!confirmCardBeforePlay) pendingPlayCard = null;
    if (view && view.phase !== 'lobby') {
      renderHand();
      renderActions();
    }
  });

  // ---------- Start options ----------

  function requireName() {
    myName = cleanName(nameInput.value);
    nameInput.classList.toggle('invalid', !myName);
    nameError.hidden = !!myName;
    if (!myName) { nameInput.focus(); return false; }
    storage('rook-name', myName);
    return true;
  }

  function startJoin() {
    const code = parseCode(joinInput.value);
    if (!requireName()) return;
    if (!code) { joinInput.focus(); return; }
    joinGame(code);
  }
  $('hostBtn').addEventListener('click', () => {
    if (!requireName()) return;
    hostGame();
  });
  $('practiceBtn').addEventListener('click', startPractice);
  $('practiceGrandSlam').addEventListener('change', () => {
    const enabled = $('practiceGrandSlam').checked;
    $('practiceGrandSlamSuitRow').hidden = !enabled;
    $('practiceGrandSlamNote').hidden = !enabled;
  });
  $('joinBtn').addEventListener('click', startJoin);
  joinInput.addEventListener('keydown', e => { if (e.key === 'Enter') startJoin(); });
  nameInput.addEventListener('input', () => { nameInput.classList.remove('invalid'); nameError.hidden = true; });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter' && joinInput.value) startJoin(); });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 1500);
    });
  });

  copyPracticeSeedBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(practiceSeed).then(() => {
      copyPracticeSeedBtn.textContent = 'Copied!';
      setTimeout(() => { copyPracticeSeedBtn.textContent = 'Copy deal code'; }, 1500);
    });
  });

  $('practiceLog').addEventListener('change', () => {
    if (!practiceMode) return;
    if (reportPreview) {
      view.log = $('practiceLog').checked ? reportPreviewLog : null;
      renderTable();
      renderOnline();
      return;
    }
    options = { ...options, log: $('practiceLog').checked };
    broadcast();
  });
  rejoinBtn.addEventListener('click', () => {
    const code = gameCode;
    teardown();
    joinGame(code);
  });
  leaveBtn.addEventListener('click', () => {
    const midGame = view && view.phase !== 'lobby';
    const warning = role === 'host' ? 'Leave the game? You are the host, so this ends it for everyone.' : 'Leave the game?';
    if (midGame && !confirm(warning)) return;
    leave();
  });

  // Warn before closing the tab mid-game (especially for the host)
  window.addEventListener('beforeunload', e => {
    if (role && view && view.phase !== 'lobby') { e.preventDefault(); e.returnValue = ''; }
  });

  // Sections below the table start collapsed and remember what you left open (same as Cardoku)
  const OPEN_SECTIONS_KEY = 'rook-open-sections';
  const sections = document.querySelectorAll('.rook-section');
  let openSections = [];
  try {
    const savedSections = localStorage.getItem(OPEN_SECTIONS_KEY);
    openSections = savedSections === null ? ['rules'] : JSON.parse(savedSections);
  } catch (e) { openSections = ['rules']; }
  sections.forEach(el => {
    el.open = Array.isArray(openSections) && openSections.includes(el.dataset.section);
    el.addEventListener('toggle', () => {
      const open = [...sections].filter(s => s.open).map(s => s.dataset.section);
      try { localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(open)); } catch (e) { /* storage blocked */ }
    });
  });

  nameInput.value = storage('rook-name');
  if (reportPreview) setupReportPreview();
  else {
    render();
    // Invite links fill in the code; a name is still required to join
    const inviteCode = new URLSearchParams(location.search).get('join');
    if (inviteCode) joinInput.value = parseCode(inviteCode);
  }
})();
