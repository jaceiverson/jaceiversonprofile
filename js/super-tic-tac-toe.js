// Super Tic Tac Toe (games/super-tic-tac-toe.html)
(function () {
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  const TIE = 'T';
  const PEER_PREFIX = 'jace-sttt-';

  const gameEl = document.getElementById('game');
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const undoBtn = document.getElementById('undoBtn');
  const newBtn = document.getElementById('newBtn');
  const ruleBtns = document.querySelectorAll('.sttt-rule');
  const rulesetName = document.getElementById('rulesetName');

  const modal = document.getElementById('modeModal');
  const onlinePanel = document.getElementById('onlinePanel');
  const onlineMsg = document.getElementById('onlineMsg');
  const joinInput = document.getElementById('joinInput');
  const copyBtn = document.getElementById('copyBtn');

  let rule = 'dead';
  let state;
  let history;

  // Online play: null myMark means local pass-and-play
  let peer = null;
  let conn = null;
  let myMark = null;
  let shareLink = '';
  let myName = '';
  let theirName = '';     // sent by the other player when you connect

  // Opt-in voice chat: theirVoice is the opponent's state ('on', 'muted', or null)
  const voice = new GameVoice({ onChange: () => renderVoice() });
  let theirVoice = null;

  function newState() {
    return {
      cells: Array.from({ length: 9 }, () => Array(9).fill(null)),
      winners: Array(9).fill(null),   // 'X', 'O', TIE, or null per small board
      turn: 'X',
      target: null,                   // board the next player is sent to (null = first move)
      last: null,                     // [board, cell] of the previous move
      gameWinner: null                // 'X', 'O', TIE, or null
    };
  }

  function lineWinner(cells) {
    for (const [a, b, c] of LINES) {
      if (cells[a] && cells[a] !== TIE && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
    }
    return null;
  }

  const isFull = b => state.cells[b].every(Boolean);

  // A board accepts moves if it has an empty cell and, under Free Square, nobody has won it yet.
  function isOpen(b) {
    if (isFull(b)) return false;
    return rule === 'dead' || state.winners[b] === null;
  }

  function playableBoards() {
    if (state.gameWinner) return [];
    if (state.target !== null && isOpen(state.target)) return [state.target];
    return [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(isOpen);
  }

  const myTurn = () => myMark === null || state.turn === myMark;

  // Applies a move if it's legal; returns whether it was applied.
  function play(b, c) {
    if (!playableBoards().includes(b) || state.cells[b][c]) return false;

    history.push(JSON.parse(JSON.stringify(state)));

    state.cells[b][c] = state.turn;
    state.last = [b, c];

    // A small board's owner never changes once decided (matters for Dead Square)
    if (state.winners[b] === null) {
      const w = lineWinner(state.cells[b]);
      if (w) state.winners[b] = w;
      else if (isFull(b)) state.winners[b] = TIE;
    }

    state.target = c;
    state.turn = state.turn === 'X' ? 'O' : 'X';

    const big = lineWinner(state.winners);
    if (big) state.gameWinner = big;
    else if (playableBoards().length === 0) state.gameWinner = TIE;

    render();
    return true;
  }

  function onCellClick(b, c) {
    if (!myTurn()) return;
    if (play(b, c)) send({ type: 'move', b, c });
  }

  function mark(p) {
    return `<span class="${p.toLowerCase()}">${p}</span>`;
  }

  const esc = s => String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const opponent = () => esc(theirName || 'Your opponent');

  function statusText(playable) {
    if (state.gameWinner === TIE) return "It's a draw!";
    if (state.gameWinner) {
      if (myMark === null) return `${mark(state.gameWinner)} wins the game! 🎉`;
      return state.gameWinner === myMark ? 'You win the game! 🎉' : `${opponent()} (${mark(state.gameWinner)}) wins the game. Rematch?`;
    }
    if (!myTurn()) return `Waiting for ${opponent()} (${mark(state.turn)}) to move…`;

    const who = myMark === null ? `${mark(state.turn)}'s turn` : `Your turn (${mark(myMark)})`;
    if (playable.length === 1) return `${who}, play in the highlighted board`;
    if (state.target === null) return `${who}, play anywhere`;
    return `${who}, free move! Pick any highlighted board`;
  }

  function render() {
    const playable = playableBoards();
    gameEl.classList.toggle('dead-mode', rule === 'dead');

    boardEl.innerHTML = '';
    for (let b = 0; b < 9; b++) {
      const mini = document.createElement('div');
      mini.className = 'sttt-mini' + (playable.includes(b) ? ' playable' : '');
      const w = state.winners[b];
      if (w) mini.dataset.winner = w === TIE ? '–' : w;

      for (let c = 0; c < 9; c++) {
        const v = state.cells[b][c];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'sttt-cell';
        if (v) cell.classList.add('filled', v.toLowerCase());
        if (state.last && state.last[0] === b && state.last[1] === c) cell.classList.add('last');
        cell.textContent = v || '';
        cell.setAttribute('aria-label', `Board ${b + 1}, cell ${c + 1}${v ? ', ' + v : ''}`);
        if (v || !playable.includes(b) || !myTurn()) cell.disabled = true;
        cell.addEventListener('click', () => onCellClick(b, c));
        mini.appendChild(cell);
      }
      boardEl.appendChild(mini);
    }

    statusEl.innerHTML = statusText(playable);

    // No undo online
    undoBtn.disabled = myMark !== null || history.length === 0;
    rulesetName.textContent = rule === 'dead' ? 'Dead Square' : 'Free Square';
    ruleBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.rule === rule));
  }

  function reset() {
    state = newState();
    history = [];
    render();
  }

  // Rules are only picked in the mode modal, which always opens on a fresh board
  ruleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      rule = btn.dataset.rule;
      render();
    });
  });

  newBtn.addEventListener('click', () => {
    reset();
    send({ type: 'reset', rule });
  });

  undoBtn.addEventListener('click', () => {
    if (!history.length) return;
    state = history.pop();
    render();
  });

  // ---------- Online play ----------

  function send(msg) {
    if (conn && conn.open) conn.send(msg);
  }

  function showOnline(html, { link = false } = {}) {
    onlinePanel.hidden = false;
    onlineMsg.innerHTML = html;
    copyBtn.hidden = !link;
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

  function hostGame() {
    if (!peerAvailable()) return;
    const code = randomCode();
    showOnline('Creating game…');
    peer = new Peer(PEER_PREFIX + code);
    voice.attach(peer);
    peer.on('open', () => {
      shareLink = `${location.origin}${location.pathname}?join=${code}`;
      showOnline(`Game code <strong>${code}</strong>. Send the link to a friend. Waiting for them to join…`, { link: true });
    });
    peer.on('connection', c => {
      if (conn) { c.on('open', () => c.close()); return; }  // game is full
      attach(c, 'X');
    });
    peer.on('error', onPeerError);
  }

  function joinGame(code) {
    if (!code || !peerAvailable()) return;
    showOnline('Connecting…');
    peer = new Peer();
    voice.attach(peer);
    peer.on('open', () => attach(peer.connect(PEER_PREFIX + code, { reliable: true }), 'O'));
    peer.on('error', onPeerError);
  }

  function attach(c, mark) {
    conn = c;
    c.on('open', () => {
      myMark = mark;
      reset();
      if (mark === 'X') send({ type: 'reset', rule });
      send({ type: 'hello', name: myName });
      showConnected();
      renderVoice();
    });
    c.on('data', msg => {
      if (msg.type === 'move') play(msg.b, msg.c);
      else if (msg.type === 'reset') { rule = msg.rule === 'free' ? 'free' : 'dead'; reset(); }
      else if (msg.type === 'hello') {
        theirName = cleanName(msg.name);
        showConnected();
        render();
        renderVoice();
      }
      else if (msg.type === 'voice') {
        theirVoice = msg.state === 'on' || msg.state === 'muted' ? msg.state : null;
        syncVoice();
      }
    });
    c.on('close', () => {
      conn = null;
      myMark = null;
      theirVoice = null;
      voice.leave();
      render();
      showOnline(`${opponent()} left the game. Click <strong>Change Mode</strong> to start a new one.`);
      theirName = '';
    });
  }

  function showConnected() {
    const you = myMark === 'X' ? '<strong>X</strong> (you go first)' : '<strong>O</strong>';
    showOnline(theirName
      ? `Connected! You're playing <strong>${esc(theirName)}</strong>. You are ${you}.`
      : `Connected! You are ${you}.`);
  }

  function onPeerError(err) {
    if (err.type === 'peer-unavailable' && conn && conn.open) return;  // a voice call that didn't connect, not a missing game
    if (err.type === 'unavailable-id') { peer.destroy(); hostGame(); return; }  // code collision, try another
    const msg = err.type === 'peer-unavailable'
      ? "Couldn't find that game. Double-check the code, or ask your friend for a new link."
      : `Connection problem (${err.type}). Click <strong>Change Mode</strong> to try again.`;
    showOnline(msg);
  }

  function leave() {
    voice.leave();
    theirVoice = null;
    theirName = '';
    if (conn) conn.close();
    if (peer) peer.destroy();
    peer = conn = null;
    myMark = null;
    onlinePanel.hidden = true;
    window.history.replaceState(null, '', location.pathname);  // drop ?join= so a refresh doesn't rejoin
    reset();
  }

  // ---------- Voice chat ----------

  function syncVoice() {
    voice.sync(theirVoice && conn ? [conn.peer] : []);
    renderVoice();
  }

  function sendVoiceState() {
    send({ type: 'voice', state: voice.joined ? (voice.muted ? 'muted' : 'on') : null });
  }

  // Buttons, plus a chip per player in voice that glows while they talk
  function renderVoice() {
    const online = !!(conn && conn.open && myMark);
    document.getElementById('voiceControls').hidden = !online;
    document.getElementById('voiceJoinBtn').hidden = voice.joined;
    document.getElementById('voiceMuteBtn').hidden = document.getElementById('voiceLeaveBtn').hidden = !voice.joined;
    document.getElementById('voiceMuteBtn').textContent = voice.muted ? '🔇 Unmute' : 'Mute';
    if (!online) { document.getElementById('voiceChips').innerHTML = ''; return; }

    const theirMark = myMark === 'X' ? 'O' : 'X';
    const chip = (mark, state, talking, who) =>
      `<span class="sttt-voice-chip ${mark.toLowerCase()}${talking ? ' speaking' : ''}" title="${who} (${mark})">${who} ${state === 'muted' ? '🔇' : '🎙️'}</span>`;
    document.getElementById('voiceChips').innerHTML =
      (voice.joined ? chip(myMark, voice.muted ? 'muted' : 'on', voice.isSpeaking(), 'You') : '') + ' ' +
      (theirVoice ? chip(theirMark, theirVoice, voice.isSpeaking(conn.peer), opponent()) : '');
  }

  function showVoiceError(message) {
    document.getElementById('voiceMsg').textContent = message;
    document.getElementById('voiceMsg').hidden = !message;
  }

  document.getElementById('voiceJoinBtn').addEventListener('click', async () => {
    showVoiceError('');
    document.getElementById('voiceJoinBtn').disabled = true;
    try {
      await voice.join();
      sendVoiceState();
      syncVoice();
    } catch (e) {
      showVoiceError(e.message);
    }
    document.getElementById('voiceJoinBtn').disabled = false;
    renderVoice();
  });
  document.getElementById('voiceMuteBtn').addEventListener('click', () => {
    voice.setMuted(!voice.muted);
    sendVoiceState();
  });
  document.getElementById('voiceLeaveBtn').addEventListener('click', () => {
    voice.leave();
    sendVoiceState();
  });

  // ---------- Mode picker ----------

  const nameInput = document.getElementById('nameInput');
  const nameError = document.getElementById('nameError');
  const NAME_KEY = 'sttt-name';

  function savedName() {
    try { return localStorage.getItem(NAME_KEY) || localStorage.getItem('rook-name') || ''; } catch (e) { return ''; }
  }

  // Online play needs a name; Pass & Play doesn't
  function requireName() {
    myName = cleanName(nameInput.value);
    nameInput.classList.toggle('invalid', !myName);
    nameError.hidden = !!myName;
    if (!myName) { nameInput.focus(); return false; }
    try { localStorage.setItem(NAME_KEY, myName); } catch (e) { /* storage blocked */ }
    return true;
  }

  function openPicker() {
    nameInput.value = nameInput.value || savedName();
    nameInput.classList.remove('invalid');
    nameError.hidden = true;
    modal.showModal();
  }

  function startJoin() {
    const code = parseCode(joinInput.value);
    if (!requireName()) return;
    if (!code) { joinInput.focus(); return; }
    modal.close();
    joinGame(code);
  }

  document.getElementById('modeBtn').addEventListener('click', () => {
    leave();
    openPicker();
  });
  document.getElementById('localBtn').addEventListener('click', () => modal.close());
  // Clicking the dimmed area outside the picker closes it (and plays locally), like pressing Esc
  let pressedOutside = false;
  const outside = e => {
    const r = modal.getBoundingClientRect();
    return e.target === modal && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  modal.addEventListener('pointerdown', e => { pressedOutside = outside(e); });
  modal.addEventListener('click', e => { if (pressedOutside && outside(e)) modal.close(); });
  document.getElementById('hostBtn').addEventListener('click', () => {
    if (!requireName()) return;
    modal.close();
    hostGame();
  });
  nameInput.addEventListener('input', () => { nameInput.classList.remove('invalid'); nameError.hidden = true; });
  document.getElementById('joinBtn').addEventListener('click', startJoin);
  joinInput.addEventListener('keydown', e => { if (e.key === 'Enter') startJoin(); });
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 1500);
    });
  });

  reset();

  // Invite links open the picker with the code filled in, since a name is needed to join
  const inviteCode = new URLSearchParams(location.search).get('join');
  if (inviteCode) joinInput.value = parseCode(inviteCode);
  openPicker();
  if (inviteCode) (nameInput.value ? document.getElementById('joinBtn') : nameInput).focus();
})();
