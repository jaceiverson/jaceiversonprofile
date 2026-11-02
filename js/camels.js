/* Local-first UI and host-authoritative PeerJS rooms. No game narration. */
(() => {
  'use strict';
  const E = window.CamelUp, $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const color = c => `<span class="dot" style="--c:var(--${c})"></span>${c}`;
  const PREFIX = 'jiv-camelup-v1-';
  const connections = new Map();
  let peer, conn, host = false, practice = false, code = '', seats = [], game = null, view = null;
  let busy = false, lastRevision = -1, screen = '', pending = false, online = false, animation = 0;
  let timer, joinTimer;
  let tileSide = null, finishKind = 'winner', diceRenderKey = '';
  let celebratedFinish = '', lastRevealCard = '';
  const journalOpen = new Map();
  let journalRound = null, journalRenderKey = '';
  let selectedPlayer = 0, playerTurnKey = null, touchStart = null;
  const safeGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const safeSet = (key, val) => { try { localStorage.setItem(key, val); } catch {} };
  let token;
  try { token = sessionStorage.getItem('camel-token'); if (!token) { token = crypto.randomUUID(); sessionStorage.setItem('camel-token', token); } } catch { token = Math.random().toString(36).slice(2) + Date.now(); }
  const voice = new GameVoice({ onChange: renderVoice });
  const people = () => game ? game.players : seats;
  const message = text => { $('message').textContent = text || ''; };
  const name = () => $('name').value.trim().slice(0,24);
  const randomCode = () => { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join(''); };
  function mySeat() { return practice && game ? game.turn : host ? 0 : view?.mySeat ?? -1; }
  function persist() {
    if (host && !practice && code) safeSet('camel-host-' + code, JSON.stringify({ seats, game }));
  }
  function networkView(seat) {
    const v = game ? E.view(game, seat) : { phase:'lobby', players:seats.map(p => ({...p})), mySeat:seat, revision:-1 };
    v.players.forEach(p => { delete p.token; });
    return v;
  }
  function broadcast() {
    persist();
    for (const [id,c] of connections) {
      const seat = people().findIndex(p => p.pid === id);
      if (seat >= 0 && c.open) c.send({ type:'state', state:networkView(seat) });
    }
    accept(networkView(mySeat()));
  }
  function accept(v) {
    pending = false; online = true;
    if (!v || !Array.isArray(v.players)) return;
    const old = view;
    view = v;
    if (busy && old && v.revision === old.revision) { renderPlayers(); renderVoice(); return; }
    const animate = old && old.phase !== 'lobby' && v.event && v.event.id !== old.event?.id && v.revision !== lastRevision;
    lastRevision = v.revision;
    if (animate) {
      busy = true; screen = ''; render(); animateMove(old, v);
    } else render();
    renderVoice();
  }
  function clean() {
    clearTimeout(timer); clearTimeout(joinTimer); animation++; busy = false; pending = false; screen = '';
    voice.leave(); connections.forEach(c => c.close()); connections.clear();
    const old = peer; peer = conn = null; if (old) old.destroy();
    view = null; game = null; seats = []; online = false; lastRevision = -1; playerTurnKey = null; selectedPlayer = 0; celebratedFinish = ''; lastRevealCard = ''; journalOpen.clear(); journalRound = null; journalRenderKey = ''; $('fireworks').innerHTML = '';
  }
  function prepare(isHost, isPractice = false) {
    if (!name()) { message('Enter your name first.'); $('name').focus(); return false; }
    clean(); host = isHost; practice = isPractice; safeSet('camel-name', name()); message(''); return true;
  }
  function needPeer() { if (typeof Peer === 'undefined') { message('Online play could not load. Check your connection or try the local table.'); return false; } return true; }
  function setupPeer(id) {
    peer = id ? new Peer(id) : new Peer(); voice.attach(peer);
    peer.on('error', e => {
      pending = false;
      message(e.type === 'peer-unavailable' ? 'Room not found. Check the code and make sure the host has their tab open.' : `Connection problem (${e.type}). You can rejoin using the same room code.`);
      if (!online) { $('hostBtn').disabled = false; $('joinBtn').disabled = false; }
    });
    peer.on('disconnected', () => { message('Reconnecting to the room service…'); if (peer && !peer.destroyed) peer.reconnect(); });
    peer.on('open', () => { $('hostBtn').disabled = false; $('joinBtn').disabled = false; });
  }
  function hostRoom() {
    if (!needPeer() || !prepare(true)) return;
    const requested = $('code').value.trim().toUpperCase();
    let saved; try { saved = requested && JSON.parse(safeGet('camel-host-' + requested)); } catch {}
    if (saved?.seats?.[0]?.token === token) {
      code = requested; seats = saved.seats; game = saved.game;
      if (game && !game.instantRollGold) {
        if (game.phase === 'playing') game.players.forEach(p => { p.money += p.pyramids; });
        game.instantRollGold = true;
      }
      people().forEach((p,i) => { p.connected = i === 0; p.voice = null; });
    } else {
      code = randomCode(); seats = [{ name:name(), token, connected:true, pid:PREFIX + code, voice:null }];
    }
    message('Opening your room…'); $('hostBtn').disabled = true;
    setupPeer(PREFIX + code);
    peer.on('open', () => { people()[0].pid = peer.id; message(''); online = true; setRoomUrl(); broadcast(); });
    peer.on('connection', c => {
      const helloTimeout = setTimeout(() => { if (!connections.has(c.peer)) c.close(); }, 10000);
      c.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'hello') {
          clearTimeout(helloTimeout);
          const n = typeof msg.name === 'string' ? msg.name.trim().slice(0,24) : '';
          if (!n || typeof msg.token !== 'string' || msg.token.length > 100) return reject(c,'Enter a valid name.');
          let index = people().findIndex(p => p.token === msg.token);
          if (index === 0) return reject(c,'The host already uses this browser session. Join from a separate tab or browser.');
          if (index < 0) {
            if (game) return reject(c,'This race has started. Rejoin from your original browser tab.');
            if (seats.length >= 8) return reject(c,'The room has eight players already.');
            if (seats.some(p => p.name.toLowerCase() === n.toLowerCase())) return reject(c,'That name is taken. Try another name.');
            index = seats.length; seats.push({ name:n, token:msg.token });
          }
          const p = people()[index];
          const previous = connections.get(p.pid); if (previous && previous !== c) { connections.delete(p.pid); previous.close(); }
          Object.assign(p, {pid:c.peer, connected:true, voice:null}); connections.set(c.peer,c); broadcast(); return;
        }
        if (connections.get(c.peer) !== c) return;
        const seat = people().findIndex(p => p.pid === c.peer);
        if (msg.type === 'action') actHost(seat,msg.action,msg.revision);
        if (msg.type === 'voice') { people()[seat].voice = ['on','muted'].includes(msg.state) ? msg.state : null; broadcast(); }
      });
      c.on('close', () => {
        clearTimeout(helloTimeout);
        if (connections.get(c.peer) !== c) return;
        connections.delete(c.peer); const index = people().findIndex(p => p.pid === c.peer);
        if (index >= 0) {
          if (!game) seats.splice(index,1); else Object.assign(game.players[index], {connected:false,voice:null});
          broadcast();
        }
      });
      c.on('error', () => message('A player connection had a problem. They can rejoin with the room code.'));
    });
  }
  function reject(c, reason) { c.send({type:'reject',reason}); setTimeout(() => c.close(),500); }
  function setRoomUrl() { history.replaceState(null,'',location.pathname + '?join=' + code); }
  function joinRoom() {
    const wanted = $('code').value.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(wanted)) return message('Enter the six-character room code.');
    // Restore a host session after a refresh instead of connecting to ourselves.
    let saved; try { saved = JSON.parse(safeGet('camel-host-' + wanted)); } catch {}
    if (saved?.seats?.[0]?.token === token) return hostRoom();
    if (!needPeer() || !prepare(false)) return;
    code = wanted; message('Connecting to the herd…'); $('joinBtn').disabled = true; setupPeer();
    joinTimer = setTimeout(() => { $('joinBtn').disabled = false; message('The room is taking too long to answer. Check the host tab and try joining again.'); },15000);
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code,{reliable:true});
      conn.on('open', () => conn.send({type:'hello',name:name(),token}));
      conn.on('data', msg => {
        if (msg?.type === 'state') { clearTimeout(joinTimer); message(''); setRoomUrl(); accept(msg.state); }
        if (msg?.type === 'reject') { clearTimeout(joinTimer); message(msg.reason); $('joinBtn').disabled = false; }
      });
      conn.on('close', () => { online = false; pending = false; voice.leave(); message('Disconnected from the host. Keep this tab and rejoin the same room to recover your seat.'); render(); });
      conn.on('error', () => message('Connection interrupted. Rejoin the room to recover your seat.'));
    });
  }
  function startPractice() {
    if (!prepare(true,true)) return;
    code = 'LOCAL'; seats = [{name:name(),connected:true},{name:'Player 2',connected:true},{name:'Player 3',connected:true}];
    game = E.create(seats); broadcast();
  }
  function actHost(seat, a, revision) {
    if (!game || !online) return;
    if (a?.type === 'acknowledge') {
      // Acknowledgements from different peers may arrive at the same revision.
      // Their leg and phase identify the result being reviewed; each seat is counted once.
      E.apply(game,seat,a); broadcast(); return;
    }
    if (busy || revision !== game.revision || !people().every(p => p.connected)) return broadcast();
    E.apply(game,seat,a); broadcast();
  }
  function send(a) {
    if (!view || busy || pending || !online || view.phase !== 'playing' || mySeat() !== view.turn) return;
    screen = ''; message('');
    if (host) actHost(mySeat(),a,game.revision);
    else if (conn?.open) { pending = true; conn.send({type:'action',action:a,revision:view.revision}); renderActions(); }
  }
  function render() {
    $('welcome').hidden = !!view; $('room').hidden = !view;
    if (!view) { if ($('roundModal').open) $('roundModal').close(); return; }
    $('roomCode').textContent = code; $('copyBtn').hidden = practice;
    $('rejoinBtn').hidden = online || practice;
    $('rejoinBtn').disabled = online;
    $('connectionStatus').textContent = practice ? 'Shared-device table' : online ? '● Connected' : '○ Disconnected';
    renderPlayers();
    const lobby = view.phase === 'lobby'; $('lobby').hidden = !lobby; $('lobbyPlayers').hidden = !lobby; $('table').hidden = lobby;
    if (lobby) {
      const chosen = $('starter').value;
      $('starter').innerHTML = view.players.map((p,i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
      if (view.players[chosen]) $('starter').value = chosen;
      $('starter').disabled = !host; $('startBtn').hidden = !host;
      $('startBtn').disabled = view.players.length < 2;
      if ($('roundModal').open) $('roundModal').close();
      $('lobbyNote').textContent = host ? 'Keep this tab open during the game. You can restore this room after a refresh in this tab.' : 'Waiting for the host to start.';
      return;
    }
    $('leg').textContent = 'Leg ' + view.leg;
    $('diceCount').textContent = `${view.rolled.length} / 5 dice revealed`;
    drawBoard(view); renderDice(view); if (!busy) $('raceNote').textContent = view.event?.message || ''; renderActions(); renderSatchel(); renderScore(); renderBettingSlips();
    $('ranking').innerHTML = E.ranking(view).map((c,i) => `<span class="rank">${i+1}. ${color(c)}</span>`).join('');
    renderJournal();
  }
  function renderJournal() {
    const rounds = view.journal || [{round:0,entries:view.log}];
    const key = JSON.stringify([view.leg,rounds]);
    if (key === journalRenderKey) return;
    if (journalRound !== view.leg) {
      journalOpen.delete(journalRound); journalOpen.delete(view.leg); journalRound = view.leg;
    }
    journalRenderKey = key;
    $('journal').innerHTML = rounds.slice().reverse().map(r => {
      const open = journalOpen.has(r.round) ? journalOpen.get(r.round) : r.round === view.leg;
      return `<details class="journal-round" data-round="${r.round}" ${open ? 'open' : ''}><summary>${r.round ? 'Round ' + r.round : 'Earlier activity'}${r.round === view.leg ? ' · Current' : ''}<span>${r.entries.length} entries</span></summary><ol>${r.entries.map(t => `<li>${esc(t)}</li>`).join('')}</ol></details>`;
    }).join('');
  }
  function renderPlayers() {
    const turnKey = `${view.phase}:${view.leg}:${view.turn}`;
    if (turnKey !== playerTurnKey) { selectedPlayer = view.turn ?? 0; playerTurnKey = turnKey; }
    selectedPlayer = Math.max(0, Math.min(selectedPlayer, view.players.length - 1));
    const markup = view.players.map((p,i) => `<div class="player ${view.phase === 'playing' && view.turn === i ? 'active' : ''} ${selectedPlayer === i ? 'mobile-selected' : ''}" data-player="${i}"><div class="player-name">${esc(p.name)}${i === view.mySeat && !practice ? ' · you' : ''} <span class="voice-icon"></span></div>${p.money !== undefined ? `<div class="player-money">${p.money} <span>GOLD</span></div>` : ''}<div class="player-slips">${(p.tickets || []).map(t => `<span class="mini-slip" style="--slip-color:var(--${t.color})" title="${t.color} leg slip, ${t.value} GOLD">${t.color}<strong>${t.value}</strong><span>1st · GOLD</span></span>`).join('')}${p.pyramids ? `<span class="mini-slip" style="--slip-color:#b28c46">△<strong>${p.pyramids}</strong><span>GOLD paid</span></span>` : ''}</div>${p.money !== undefined ? `<p class="remaining-cards"><strong>${p.finishCardsRemaining ?? p.hand?.length ?? 5}</strong> final-bet cards left</p>` : ''}<small>${!p.connected ? 'Disconnected · waiting' : p.partner != null ? 'Partner: ' + esc(view.players[p.partner].name) : i === view.turn && view.phase === 'playing' ? 'Their turn' : ''}</small></div>`).join('');
    $('players').innerHTML = markup;
    $('lobbyPlayers').innerHTML = markup;
    $('playerPosition').textContent = `${selectedPlayer + 1} / ${view.players.length} · ${view.players[selectedPlayer].name}${selectedPlayer === view.turn && view.phase === 'playing' ? ' · active' : ''}`;
    $('activePlayer').disabled = selectedPlayer === view.turn;
    $('previousPlayer').disabled = $('nextPlayer').disabled = view.players.length < 2;
  }
  function browsePlayer(direction) {
    if (!view || view.phase === 'lobby') return;
    selectedPlayer = (selectedPlayer + direction + view.players.length) % view.players.length;
    renderPlayers(); renderVoice();
  }
  // Six spaces across and four down: a clockwise track surrounding the pyramid.
  const coords = [[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[5,1],[5,2],[5,3],[4,3],[3,3],[2,3],[1,3]];
  function position(space, level, height) {
    // Keep following the physical track after crossing the finish line.
    // Logical spaces stay unwrapped for race ranking (17+ ahead, 0 behind).
    const trackIndex = ((space - 1) % coords.length + coords.length) % coords.length;
    const [x,y] = coords[trackIndex];
    const base = Math.max(y*25+11, (height-1)*3.2+1);
    return {x:x*16.666+3.4,y:base-level*3.2};
  }
  function camelSvg(c) { return `<svg viewBox="0 0 100 75" role="img" aria-label="${c} camel"><g ${['white','black'].includes(c) ? 'transform="translate(100 0) scale(-1 1)"' : ''}><path d="M14 46 L15 64 Q18 69 22 64 L26 50 L48 50 L56 65 Q61 68 62 62 L61 45 Q73 40 74 26 L79 16 L89 18 Q96 17 94 11 L77 8 Q69 7 68 18 L60 35 Q55 30 51 25 Q44 12 36 30 Q30 15 22 30 L18 36 Q10 33 7 41 L3 47" fill="var(--${c})" stroke="#3a4238" stroke-width="2.3" stroke-linejoin="round"/><circle cx="83" cy="12" r="1.7" fill="#263b33"/><path d="M73 9L73 3M76 9L79 4" stroke="#3a4238" stroke-width="2"/></g><text x="37" y="44" text-anchor="middle">${c[0].toUpperCase()}</text></svg>`; }
  let boardReady = false;
  function drawBoard(g) {
    if (!boardReady) {
      $('track').innerHTML = coords.map(([x,y],i) => `<button type="button" class="space" data-space="${i+1}" id="space-${i+1}" disabled aria-label="Track space ${i+1}" style="left:${x*16.666}%;top:${y*25}%"><span class="num">${i+1}</span><span class="tile" hidden></span></button>`).join('');
      $('camels').innerHTML = E.ALL.map(c => `<div class="camel" id="camel-${c}">${camelSvg(c)}</div>`).join(''); boardReady = true;
    }
    for (let i=1;i<=16;i++) {
      const t = g.tiles.find(t => t.space === i), el = $('space-'+i).querySelector('.tile'); el.hidden = !t;
      if (t) { el.textContent = `${t.side === 1 ? '+1' : '−1'} ${g.players[t.seat].name}`; el.classList.toggle('jeer',t.side === -1); }
    }
    placeCamels(g);
  }
  function placeCamels(g) {
    const rect = $('board').getBoundingClientRect();
    E.ALL.forEach(c => {
      const at = E.locate(g,c), pos = position(at.space,at.level,g.board[at.space].length), el = $('camel-'+c);
      el.style.transform = `translate(${pos.x*rect.width/100}px,${pos.y*rect.height/100}px)`;
      el.style.zIndex = String(10+at.level); el.title = `${c}, space ${at.space}, stack level ${at.level+1}`;
    });
  }
  function diePips(value) {
    const positions = value === 1 ? ['center'] : value === 2 ? ['top-left','bottom-right'] : ['top-left','center','bottom-right'];
    return positions.map(p => `<i class="pip ${p}"></i>`).join('');
  }
  function renderDice(g, rolling = false) {
    const key = `${g.leg}:${rolling}:${g.rolled.map(d => d.color + d.steps + d.face).join(',')}`;
    if (key === diceRenderKey) return;
    diceRenderKey = key;
    $('dice').innerHTML = g.rolled.map((d,i) => {
      const animate = rolling && i === g.rolled.length - 1;
      const faces = [d.steps, d.steps % 3 + 1, (d.steps + 1) % 3 + 1, d.steps, d.steps % 3 + 1, (d.steps + 1) % 3 + 1];
      const pipColor = d.color === 'grey' && d.face === 'black' ? '#26332e' : '#fffaf0';
      return `<span class="die-slot${animate ? ' rolling' : ''}" style="--die-color:${d.color === 'grey' ? '#8a9189' : 'var(--' + d.color + ')'};--pip-color:${pipColor};--launch-x:calc(${2-i} * (var(--die-size) + var(--die-gap)));--tilt:${[-8,7,-4,9,-6][i]}deg" role="img" aria-label="${d.color} die: ${d.steps}${d.color === 'grey' ? ', ' + d.face + ' face' : ''}" title="${d.color} ${d.steps}${d.color === 'grey' ? ' (' + d.face + ')' : ''}"><span class="die-shadow" aria-hidden="true"></span><span class="die-flight" aria-hidden="true"><span class="die-cube">${['front','back','right','left','top','bottom'].map((face,j) => {
        // The grey die has a black 1/2/3 and a white 1/2/3. The result is always front.
        const selected = d.face === 'black' ? '#26332e' : '#fffaf0';
        const opposite = d.face === 'black' ? '#fffaf0' : '#26332e';
        const facePips = d.color === 'grey' ? (j % 2 === 0 ? selected : opposite) : '#fffaf0';
        return `<span class="die-face ${face}" style="--pip-color:${facePips}">${diePips(faces[j])}</span>`;
      }).join('')}</span></span></span>`;
    }).join('');
  }
  function canAct() {
    return view?.phase === 'playing' && view.turn === mySeat() && online && !busy && !pending && view.players.every(p => p.connected);
  }
  function renderBoardTargets() {
    if (!boardReady || !view || view.phase === 'lobby') return;
    for (let space = 1; space <= 16; space++) {
      const el = $('space-' + space), legal = canAct() && screen === 'tile' && [1,-1].includes(tileSide) && E.validTile(view, mySeat(), space);
      el.disabled = !legal;
      el.classList.toggle('placeable', legal && screen === 'tile');
      el.classList.toggle('jeer-target', legal && tileSide === -1);
      el.ariaLabel = `Space ${space}${legal ? ', place a cheer or jeer' : ', unavailable for a spectator tile'}`;
    }
  }
  function betSlip(c, value, label = 'LEG BET', detail = '1st', extra = '') {
    return `<span class="bet-slip" style="--slip-color:var(--${c})"><span class="slip-label">${label}</span><span class="slip-camel">${camelSvg(c)}</span><span class="slip-color">${c}</span><strong class="slip-value">${value}<small>${detail}</small></strong><span class="slip-terms">${extra || '2nd +1 · Other −1'}</span></span>`;
  }
  function renderBettingSlips() {
    const ready = canAct();
    $('bettingSlips').innerHTML = E.COLORS.map(c => {
      const pile = view.supply[c];
      return `<button class="slip-deck" data-ticket="${c}" ${!ready || !pile.length ? 'disabled' : ''} aria-label="Take ${c} leg slip for ${pile[0] || 0} GOLD"><span class="deck-cards" style="--cards:${pile.length}">${betSlip(c, pile[0] || '—')}</span><span class="deck-count">${pile.length ? pile.length + ' left · ' + pile.join(' / ') : 'All taken'}</span></button>`;
    }).join('');
    $('pyramidRoll').disabled = !ready;
    const hand = view.players[mySeat()]?.hand || [];
    $('finishPiles').innerHTML = ['winner','loser'].map(kind => `<button type="button" class="finish-pile" data-finish-kind="${kind}" aria-pressed="${screen === 'bet' && finishKind === kind}" ${!ready || !hand.length ? 'disabled' : ''}><span class="card-back" aria-hidden="true">?</span><span><strong>Overall ${kind}</strong><small>${view.bets[kind].length} secret slip${view.bets[kind].length === 1 ? '' : 's'}</small></span></button>`).join('');
    $('finishChoices').innerHTML = ready && screen === 'bet' ? `<p class="small">Choose a slip for the overall ${finishKind}. Your choice stays secret.</p><div class="slip-market">${E.COLORS.map(c => `<button class="slip-choice" data-bet="${c}" data-kind="${finishKind}" ${!hand.includes(c) ? 'disabled' : ''} aria-label="Secretly back ${c} as overall ${finishKind}">${betSlip(c, '?', 'FINISH BET', hand.includes(c) ? finishKind : 'Used', 'Correct: 8 / 5 / 3 / 2 / 1')}</button>`).join('')}</div>` : '';

  }
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  async function animateMove(old, next) {
    const ticket = ++animation, ev = next.event;
    if ($('reduceMotion').checked) {
      placeCamels(next); renderDice(next); busy = false; render(); renderVoice(); return;
    }
    $('board').classList.add('reduced-motion'); placeCamels(old); void $('board').offsetWidth; $('board').classList.remove('reduced-motion'); renderDice(next,true); $('raceNote').textContent = 'Shaking the pyramid…';
    await pause(1100); if (ticket !== animation) return;
    renderDice(next); $('raceNote').textContent = ev.message || next.log[0];
    const moving = JSON.parse(JSON.stringify(old));
    // Animate each travelled space, keeping the carried stack together.
    const from = E.locate(moving,ev.camel); const unit = moving.board[from.space].splice(from.level);
    const dir = ev.landing > from.space ? 1 : -1;
    for (let space = from.space + dir; dir > 0 ? space <= ev.landing : space >= ev.landing; space += dir) {
      const at = Math.max(0,Math.min(20,space)); moving.board[at].push(...unit); placeCamels(moving);
      await pause(500); if (ticket !== animation) return;
      moving.board[at].splice(-unit.length);
    }
    placeCamels(next); await pause(650); if (ticket !== animation) return;
    busy = false; render(); renderVoice();
  }
  function renderActions() {
    if (!view || view.phase === 'lobby') return;
    const me = view.players[mySeat()], active = view.phase === 'playing';
    const ready = online && view.players.every(p => p.connected);
    const mine = active && view.turn === mySeat() && ready && !busy && !pending;
    $('turnTitle').textContent = view.phase === 'finished' ? 'What a race!' : view.phase === 'scoring' ? 'Time to count GOLD.' : busy ? 'Here come the camels…' : !ready ? 'Waiting for the herd…' : mine ? (practice ? `${me.name}’s turn` : 'Your turn!') : `${view.players[view.turn].name}’s turn`;
    $('turnHint').textContent = !ready ? 'Play resumes when disconnected players rejoin.' : practice ? 'Shared-device mode: pass the screen to the named player. Finish bets stay hidden between turns.' : mine ? 'Click a leg slip, the pyramid, or an overall finish pile. To place a tile, choose Cheer or Jeer first.' : active ? 'Enjoy the race. Your actions will appear here.' : 'The results are below the track.';
    renderBoardTargets(); renderBettingSlips();
    $('cheerTile').disabled = $('jeerTile').disabled = !mine;
    $('cheerTile').ariaPressed = String(mine && screen === 'tile' && tileSide === 1);
    $('jeerTile').ariaPressed = String(mine && screen === 'tile' && tileSide === -1);
    const box = $('actions'); box.innerHTML = '';
    if (!mine) return;

    if (screen === 'tile') {
      const legal = Array.from({length:15},(_,i)=>i+2).filter(s => E.validTile(view,mySeat(),s));
      box.innerHTML += `<p class="small">${legal.length ? 'Click a highlighted board space to place your ' + (tileSide === 1 ? 'cheer' : 'jeer') + '.' : 'No legal spaces this turn.'}</p><button class="quiet" data-screen="">Cancel placement</button>`;
    } else if (screen === 'bet') {
      box.innerHTML += `<p class="small">Choose your ${finishKind} slip above the board.</p><button class="quiet" data-screen="">Cancel finish bet</button>`;
    } else if (screen === 'partner') {
      box.innerHTML += view.players.map((p,i)=>i!==mySeat() && p.partner===null ? `<button data-partner="${i}">${esc(p.name)}</button>`:'').join('') || '<p>No partners available this leg.</p>';
      box.innerHTML += '<button class="quiet" data-screen="">Cancel partnership</button>';
    } else if (view.players.length >= 6 && me.partner === null) {
      box.innerHTML += '<button data-screen="partner">Choose a betting partner</button>';
    }
  }

  function renderSatchel() {
    const p = view.players[mySeat()];
    $('satchel').innerHTML = `<p><strong>${esc(p.name)}</strong></p><div class="held-slips">${p.tickets.map(t => betSlip(t.color, t.value)).join('') || '<p class="small">No leg slips yet.</p>'}${p.pyramids ? `<span class="pyramid-slip"><span>△</span><strong>${p.pyramids} GOLD paid</strong><small>${p.pyramids} pyramid ticket${p.pyramids === 1 ? '' : 's'}</small></span>` : ''}</div><p class="small">Your secret finish bets</p><div class="held-slips">${!practice ? ['winner','loser'].flatMap(k => view.bets[k].filter(b => b.seat === mySeat()).map(b => betSlip(b.color, '?', 'FINISH BET', k, 'Revealed at the finish'))).join('') || '<p class="small">No finish bets yet.</p>' : '<p class="small">Secret cards are hidden between turns.</p>'}</div>`;

  }
  function celebrateFinish() {
    if (busy || view.roundReviewed || !view.event?.finished || !['revealing','finished'].includes(view.phase)) return;
    const key = `${code}:${view.leg}:${view.event.id}`;
    if (celebratedFinish === key) return;
    celebratedFinish = key;
    const calm = $('reduceMotion').checked;
    $('fireworks').classList.toggle('calm',calm);
    $('fireworks').innerHTML = [ [20,25],[75,25],[48,38],[80,62],[25,65] ].map(([x,y],burst) => `<span class="firework-burst" style="left:${x}%;top:${y}%">${Array.from({length:18},(_,i)=>{
      const angle=i*Math.PI*2/18, radius=65+(i%3)*18;
      return `<i class="firework-spark" style="--dx:${Math.cos(angle)*radius}px;--dy:${Math.sin(angle)*radius}px;--spark-color:${['#edb945','#df7654','#69ac91','#a78bc9','#5ba8c6'][burst]};--delay:${burst*.18}s"></i>`;
    }).join('')}</span>`).join('');
    setTimeout(()=>{ if (celebratedFinish === key) $('fireworks').innerHTML=''; },calm?1200:2600);
  }
  function revealedCard(card, flip = false) {
    if (!card) return '<div class="reveal-placeholder"><span class="card-back">?</span><p>The finish bets are still secret.</p></div>';
    return `<div class="reveal-card ${flip && !$('reduceMotion').checked ? 'reveal-flip' : ''}">${betSlip(card.color, card.reward > 0 ? '+'+card.reward : '−1', card.kind.toUpperCase()+' BET', 'GOLD', card.reward > 0 ? 'Correct prediction' : 'Incorrect prediction')}<div><h3>${esc(view.players[card.seat].name)}</h3><p>Backed ${color(card.color)} as overall ${card.kind}.</p><strong>${card.reward > 0 ? 'Correct! +' + card.reward + ' GOLD' : card.delta === 0 ? 'Incorrect · already at 0 GOLD' : 'Incorrect · −1 GOLD'}</strong><p class="small">Now ${card.money} GOLD</p></div></div>`;
  }
  function revealHistory() {
    return view.finishResults?.length ? `<details class="reveal-history"><summary>Review ${view.finishResults.length} revealed card${view.finishResults.length===1?'':'s'}</summary>${view.finishResults.map(b=>`<div class="score-row"><span>${esc(view.players[b.seat].name)} · ${color(b.color)} ${b.kind}</span><strong>${b.reward>0?'+':''}${b.reward} GOLD</strong></div>`).join('')}</details>` : '';
  }
  function renderFinishReveal() {
    const modal=$('roundModal'), cursor=view.revealCursor, last=view.finishResults.at(-1);
    const nextKind=cursor < view.bets.winner.length ? 'winner' : 'loser';
    const pileNumber=nextKind==='winner' ? cursor+1 : cursor-view.bets.winner.length+1;
    const flipKey=`${view.leg}:${cursor}`, flip=cursor>0 && lastRevealCard!==flipKey;
    lastRevealCard=flipKey;
    $('finalResult').hidden=true;
    $('score').innerHTML=`<p class="eyebrow">THE RACE HAS FINISHED · FINAL BETS</p><h2 id="roundTitle">Let’s turn over the cards.</h2><p>Winning camel: ${color(view.ranks[0])} · Last camel: ${color(view.ranks[4])}</p><p class="small">Final leg tickets have been scored. Reveal winner bets first, then loser bets, in the order they were placed.</p><div aria-live="polite">${revealedCard(last,flip)}</div><p><strong>${cursor} / ${view.revealTotal}</strong> cards revealed</p>${host ? `<button id="revealNext" class="primary">Reveal ${nextKind} card ${pileNumber} →</button>` : `<p class="small">Waiting for the host to reveal ${nextKind} card ${pileNumber}.</p>`}${revealHistory()}<details><summary>Final leg scoring</summary>${view.summary.map(s=>`<div class="score-row"><strong>${esc(s.name)}</strong><span>${s.delta>=0?'+':''}${s.delta} GOLD → ${s.money} GOLD</span></div>`).join('')}</details>`;
    if (!modal.open) { if ($('help').open) $('help').close(); modal.showModal(); }
  }
  function renderScore() {
    celebrateFinish();
    if (view.phase === 'revealing' && !busy) { renderFinishReveal(); return; }
    const modal = $('roundModal'), final = view.phase === 'finished';
    const show = ['scoring','finished'].includes(view.phase) && !view.roundReviewed && !busy;
    $('finalResult').hidden = !final || !view.roundReviewed;
    if (final && view.roundReviewed) {
      $('finalResult').innerHTML = `<h2>${view.winners.map(i=>esc(view.players[i].name)).join(' & ')} ${view.winners.length>1?'share the win!':'wins!'}</h2><p>${view.players.map(p=>esc(p.name)+' '+p.money+' GOLD').join(' · ')}</p>${host ? '<div class="buttons"><button id="playAgain" class="primary">Play Again</button><button id="backToLobby">Back to lobby</button></div><p class="small">Same players, same room, voice stays connected.</p>' : '<p class="small">Waiting for the host to return to the lobby.</p>'}`;
    }
    if (!show) { if (modal.open) modal.close(); return; }
    const acknowledged = view.acknowledged || view.players.map(() => false);
    const seat = practice ? acknowledged.findIndex(a => !a) : mySeat();
    const mine = acknowledged[seat], count = acknowledged.filter(Boolean).length;
    $('score').innerHTML = `<p class="eyebrow">${final?'THE FINISH LINE':'LEG '+view.leg+' COMPLETE'}</p><h2 id="roundTitle">${final?view.winners.map(i=>esc(view.players[i].name)).join(' & ') + (view.winners.length>1?' share the win!':' wins!'):'GOLD counted. Camels ready.'}</h2><p>Leg leader: ${color(view.ranks[0])} · Second: ${color(view.ranks[1])}</p>${view.summary.map(s=>`<div class="score-row"><strong>${esc(s.name)}</strong><span>Tickets ${s.own>=0?'+':''}${s.own}${s.bonus?' · partner +'+s.bonus:''} → ${s.money} GOLD after leg</span></div>`).join('')}${final?`<h3 class="finish-results-title">Finish bets revealed</h3>${view.finishResults.length ? revealedCard(view.finishResults.at(-1)) + revealHistory() : '<p>No finish bets placed.</p>'}<p>Final totals: ${view.players.map(p=>esc(p.name)+' '+p.money+' GOLD').join(' · ')}</p>`:'<p class="small">Roll GOLD was already paid. The next leg starts after everyone acknowledges these results.</p>'}<div class="round-acknowledgements" aria-live="polite"><p><strong>${count} / ${view.players.length}</strong> players ready</p>${view.players.map((p,i)=>`<span class="ack-status ${acknowledged[i]?'ready':''}">${acknowledged[i]?'✓':'○'} ${esc(p.name)}${!p.connected?' · reconnecting':''}</span>`).join('')}</div><button id="acknowledgeRound" class="primary" ${mine || pending || !online ? 'disabled' : ''}>${practice ? esc(view.players[seat]?.name || '') + ': acknowledge results' : mine ? 'Acknowledged · waiting for everyone' : 'Acknowledge results'}</button>`;
    if (!modal.open) { if ($('help').open) $('help').close(); modal.showModal(); }
  }
  function acknowledgeRound() {
    if (!view || busy || pending || !online || !['scoring','finished'].includes(view.phase)) return;
    const seat = practice ? (view.acknowledged || view.players.map(() => false)).findIndex(a => !a) : mySeat();
    const action = {type:'acknowledge',leg:view.leg,phase:view.phase};
    if (host) actHost(seat,action,game.revision);
    else if (conn?.open) { pending = true; conn.send({type:'action',action,revision:view.revision}); renderScore(); }
  }
  function renderVoice() {
    const visible = !!view && !practice && online;
    $('voiceJoin').hidden = !visible || voice.joined;
    $('voiceMute').hidden = $('voiceLeave').hidden = !visible || !voice.joined;
    $('voiceMute').textContent = voice.muted ? 'Unmute' : 'Mute';
    if (!visible) return;
    voice.sync(view.players.filter((p,i)=>i!==mySeat() && p.connected && p.voice).map(p=>p.pid));
    view.players.forEach((p,i)=>{
      const el = document.querySelector(`#players [data-player="${i}"]`); if (!el) return;
      el.classList.toggle('speaking',i===mySeat()?voice.isSpeaking():voice.isSpeaking(p.pid));
      el.querySelector('.voice-icon').textContent = p.voice === 'muted' ? '🔇' : p.voice ? '🎙' : '';
    });
  }
  function syncVoice() {
    const state = voice.joined ? voice.muted ? 'muted':'on' : null;
    if (host) { people()[0].voice = state; broadcast(); }
    else if(conn?.open) conn.send({type:'voice',state});
  }
  $('rejoinBtn').onclick = () => { $('code').value = code; joinRoom(); };
  $('hostBtn').onclick = hostRoom; $('joinBtn').onclick = joinRoom; $('practiceBtn').onclick = startPractice;
  $('startBtn').onclick = () => { if (host && !game && seats.length>=2 && seats.every(p=>p.connected)) { game = E.create(seats,Math.random,Number($('starter').value)); screen=''; broadcast(); } };
  $('actions').onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if ('screen' in b.dataset) { screen=b.dataset.screen; tileSide=null; renderActions(); }
    if (b.dataset.partner) send({type:'partner',seat:Number(b.dataset.partner)});
  };
  $('previousPlayer').onclick = () => browsePlayer(-1);
  $('nextPlayer').onclick = () => browsePlayer(1);
  $('activePlayer').onclick = () => { if (view) { selectedPlayer = view.turn; renderPlayers(); renderVoice(); } };
  $('players').onkeydown = e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); browsePlayer(e.key === 'ArrowLeft' ? -1 : 1); }
  };
  $('players').ontouchstart = e => { const t = e.touches[0]; touchStart = t ? {x:t.clientX,y:t.clientY} : null; };
  $('players').ontouchend = e => {
    const t = e.changedTouches[0], start = touchStart; touchStart = null;
    if (!t || !start) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) browsePlayer(dx < 0 ? 1 : -1);
  };
  $('track').onclick = e => {
    const space = Number(e.target.closest('[data-space]')?.dataset.space);
    if (!canAct() || screen !== 'tile' || ![1,-1].includes(tileSide) || !E.validTile(view, mySeat(), space)) return;
    send({type:'tile',space,side:tileSide});
  };
  function selectTile(side) { if (canAct()) { tileSide = side; screen = 'tile'; renderActions(); } }
  $('cheerTile').onclick = () => selectTile(1);
  $('jeerTile').onclick = () => selectTile(-1);
  $('pyramidRoll').onclick = () => { if (canAct()) send({type:'roll'}); };
  $('finishPiles').onclick = e => {
    const button = e.target.closest('[data-finish-kind]');
    if (!canAct() || !button || button.disabled || !['winner','loser'].includes(button.dataset.finishKind)) return;
    finishKind = button.dataset.finishKind; screen = 'bet'; renderActions();
  };
  $('finishChoices').onclick = e => {
    const button = e.target.closest('[data-bet]');
    if (canAct() && screen === 'bet' && button && !button.disabled && button.dataset.kind === finishKind) send({type:'bet',kind:finishKind,color:button.dataset.bet});
  };
  $('bettingSlips').onclick = e => {
    const button = e.target.closest('[data-ticket]');
    if (button && !button.disabled) send({type:'ticket',color:button.dataset.ticket});
  };
  $('journal').addEventListener('toggle', e => {
    if ($('journal').contains(e.target) && e.target.matches('details[data-round]')) journalOpen.set(Number(e.target.dataset.round), e.target.open);
  }, true);
  $('roundModal').oncancel = e => e.preventDefault();
  $('score').onclick = e => {
    const button=e.target.closest('button'); if (!button || button.disabled) return;
    if (button.id === 'revealNext') {
      if (host && view?.phase==='revealing' && !busy && online) actHost(0,{type:'reveal',index:view.revealCursor},game.revision);
    } else if (button.id === 'acknowledgeRound') acknowledgeRound();
  };
  $('finalResult').onclick = e => {
    const button = e.target.closest('button');
    if (!button || !host || game?.phase !== 'finished' || !game.roundReviewed) return;
    if (!['playAgain','backToLobby'].includes(button.id)) return;
    if (button.id === 'playAgain' && !game.players.every(p=>p.connected)) { message('Wait for disconnected players to rejoin before playing again.'); return; }
    seats = game.players.map(p=>({name:p.name,pid:p.pid,token:p.token,connected:p.connected,voice:p.voice}));
    game = button.id === 'playAgain' ? E.create(seats) : null;
    screen = ''; animation++; lastRevision = -1; diceRenderKey = ''; celebratedFinish = ''; lastRevealCard = '';
    journalOpen.clear(); journalRound = null; journalRenderKey = ''; playerTurnKey = null;
    $('fireworks').innerHTML = ''; message(''); broadcast();
  };
  $('voiceJoin').onclick = async () => {
    $('voiceJoin').disabled=true;
    try { await voice.join(); syncVoice(); message(''); } catch(e) { message(e.message); }
    $('voiceJoin').disabled=false;
  };
  $('voiceMute').onclick = () => {voice.setMuted(!voice.muted);syncVoice();};
  $('voiceLeave').onclick = () => {voice.leave();syncVoice();};
  $('copyBtn').onclick = async () => {
    const url=location.origin+location.pathname+'?join='+code;
    try { await navigator.clipboard.writeText(url); message('Invite link copied.'); } catch { message('Share this room code: '+code); }
  };
  $('leaveBtn').onclick = () => {
    if (host && !practice && !confirm('Leaving closes this room for everyone. Leave the table?')) return;
    clean(); history.replaceState(null,'',location.pathname); render(); message('You left the table.');
  };
  for (const id of ['helpBtn','rulesBtn']) $(id).onclick = () => $('help').showModal();
  $('closeHelp').onclick = () => $('help').close();
  $('help').onclick = e => {if(e.target===$('help')){const r=$('help').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('help').close();}};
  $('reduceMotion').onchange = () => {$('board').classList.toggle('reduced-motion',$('reduceMotion').checked);safeSet('camel-reduced-motion',$('reduceMotion').checked?'yes':'no');};
  $('reduceMotion').checked = safeGet('camel-reduced-motion')==='yes' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('reduceMotion').onchange();
  new ResizeObserver(()=>{if(view && view.phase!=='lobby' && !busy)placeCamels(view);}).observe($('board'));
  window.addEventListener('beforeunload',()=>{persist();voice.leave();});
  $('name').value = safeGet('camel-name') || '';
  const invite = new URLSearchParams(location.search).get('join');
  if(invite && /^[A-Z2-9]{6}$/.test(invite.toUpperCase())) { $('code').value=invite.toUpperCase(); message('Enter your name and join the room.'); }
})();
