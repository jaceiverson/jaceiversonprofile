/* Camel Up, second edition. Pure rules; stacks are stored bottom to top. */
(function (root) {
  'use strict';
  const COLORS = ['blue', 'green', 'yellow', 'purple', 'red'];
  const ALL = [...COLORS, 'black', 'white'];
  const die = rng => 1 + Math.floor(rng() * 3);
  function create(players, rng = Math.random, starter = 0) {
    if (players.length < 2 || players.length > 8) throw Error('Choose 2–8 players.');
    const g = { players: players.map(p => ({ ...p, money: 3, tickets: [], pyramids: 0, hand: [...COLORS], partner: null })),
      board: Array.from({ length: 21 }, () => []), tiles: [], bets: { winner: [], loser: [] },
      instantRollGold: true, phase: 'playing', turn: starter, leg: 1, revision: 0, log: ['The race is ready. Choose one action each turn.'], journal: [{round:1,entries:['The race is ready. Choose one action each turn.']}], event: null };
    // Randomize the otherwise arbitrary starting stack order.
    const shuffled = [...COLORS];
    for (let i = 4; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    shuffled.forEach(c => g.board[die(rng)].push(c));
    ['black', 'white'].forEach(c => g.board[17 - die(rng)].push(c));
    resetLeg(g); return g;
  }
  function ensureJournal(g) {
    // Older saved rooms have a flat, truncated log with no recoverable round boundaries.
    if (!g.journal) g.journal = g.log?.length ? [{round:0,entries:g.log.slice()}] : [];
    let round = g.journal.find(r => r.round === g.leg);
    if (!round) { round = {round:g.leg,entries:[]}; g.journal.push(round); }
    return round;
  }
  function record(g, message) {
    ensureJournal(g).entries.unshift(message);
    g.log.unshift(message); g.log = g.log.slice(0,60);
  }
  function resetLeg(g) {
    const round = ensureJournal(g);
    if (!round.entries.length) round.entries.push(`Round ${g.leg} started.`);
    g.dice = [...COLORS, 'grey']; g.rolled = [];
    g.supply = Object.fromEntries(COLORS.map(c => [c, [5, 3, 2, 2]]));
    g.acknowledged = g.players.map(() => false); g.roundReviewed = false;
    g.tiles = []; g.players.forEach(p => { p.tickets = []; p.pyramids = 0; p.partner = null; });
  }
  function locate(g, camel) {
    for (let space = 0; space < g.board.length; space++) { const level = g.board[space].indexOf(camel); if (level >= 0) return { space, level }; }
    throw Error('Missing camel');
  }
  function ranking(g) { return g.board.flatMap(s => s.filter(c => COLORS.includes(c))).reverse(); }
  function crazy(g, face) {
    const b = locate(g, 'black'), w = locate(g, 'white');
    if (b.space === w.space && Math.abs(b.level - w.level) === 1) return b.level > w.level ? 'black' : 'white';
    const carries = p => g.board[p.space].slice(p.level + 1).some(c => COLORS.includes(c));
    if (carries(b) !== carries(w)) return carries(b) ? 'black' : 'white';
    return face;
  }
  function validTile(g, seat, space) {
    return Number.isInteger(space) && space >= 2 && space <= 16 && !g.board[space].length &&
      !g.tiles.some(t => t.seat !== seat && Math.abs(t.space - space) <= 1) &&
      !g.tiles.some(t => t.seat === seat && t.space === space);
  }
  function move(g, camel, steps) {
    const from = locate(g, camel), direction = COLORS.includes(camel) ? 1 : -1;
    const unit = g.board[from.space].splice(from.level);
    let to = from.space + direction * steps, under = false;
    const landing = to;
    const tile = g.tiles.find(t => t.space === to);
    const tileGold = tile ? unit.length : 0;
    if (tile) { g.players[tile.seat].money += tileGold; to += direction * tile.side; under = tile.side === -1; }
    to = Math.max(0, Math.min(20, to));
    const landedOn = g.board[to].slice();
    if (under) g.board[to].unshift(...unit); else g.board[to].push(...unit);
    return { camel, steps, from: from.space, landing, to, unit, under, landedOn, tileGold, tile: tile ? { ...tile } : null, finished: to < 1 || to > 16 };
  }
  function rollMessage(g, seat, dieColor, movement) {
    const {camel,steps,unit,tile,under,landedOn,to,landing} = movement;
    const camelName = camel[0].toUpperCase() + camel.slice(1);
    const carried = unit.slice(1), backward = !COLORS.includes(camel);
    let message = `${g.players[seat].name} rolled ${dieColor} ${steps} and earned 1 GOLD. ${camelName} Moved ${steps}${backward ? ' backward' : ''}${carried.length ? ' and Carried (' + carried.map(c=>c.toUpperCase()).join(', ') + ') camels' : ''}.`;
    if (tile) {
      const direction = backward ? (under ? 'forward' : 'backward') : (under ? 'backward' : 'forward');
      message += ` Hit a ${under ? 'Jeer' : 'Cheer'} on space ${landing} and moved 1 extra space ${direction}. ${g.players[tile.seat].name} earned ${movement.tileGold} GOLD.`;
    }
    if (landedOn.length) message += ` Landed ${under ? 'underneath' : 'on top of'} (${landedOn.map(c=>c.toUpperCase()).join(', ')}) camels on space ${to}.`;
    if (movement.finished) message += ' Crossed the finish line!';
    return message;
  }
  function ticketValue(t, ranks) { return t.color === ranks[0] ? t.value : t.color === ranks[1] ? 1 : -1; }
  function scoreLeg(g) {
    const ranks = ranking(g);
    g.summary = g.players.map(p => {
      const own = p.tickets.reduce((n, t) => n + ticketValue(t, ranks), 0);
      const partner = p.partner === null ? null : g.players[p.partner];
      const bonus = partner ? Math.max(0, partner.pyramids ? 1 : 0, ...partner.tickets.map(t => ticketValue(t, ranks))) : 0;
      const before = p.money; p.money = Math.max(0, p.money + own + bonus);
      return { name: p.name, own, bonus, delta: p.money - before, money: p.money };
    });
    g.ranks = ranks;
  }
  function finish(g) {
    g.finishResults = []; g.revealCursor = 0;
    g.revealTotal = g.bets.winner.length + g.bets.loser.length;
    g.phase = g.revealTotal ? 'revealing' : 'finished';
    if (!g.revealTotal) setWinners(g);
  }
  function setWinners(g) {
    const max = Math.max(...g.players.map(p => p.money));
    g.winners = g.players.map((p,i) => p.money === max ? i : -1).filter(i => i >= 0);
  }
  function revealNext(g, seat, expectedIndex) {
    if (g.phase !== 'revealing' || seat !== 0 || expectedIndex !== g.revealCursor) return false;
    const cards = ['winner','loser'].flatMap(kind => g.bets[kind].map(b => ({...b,kind})));
    const card = cards[g.revealCursor];
    if (!card) return false;
    const hit = card.color === g.ranks[card.kind === 'winner' ? 0 : 4];
    const correctBefore = g.finishResults.filter(b => b.kind === card.kind && b.reward > 0).length;
    const reward = hit ? ([8,5,3,2][correctBefore] || 1) : -1;
    const p = g.players[card.seat], before = p.money;
    p.money = Math.max(0,p.money + reward);
    g.finishResults.push({...card,reward,delta:p.money-before,money:p.money});
    g.revealCursor++; g.revision++;
    if (g.revealCursor === g.revealTotal) { g.phase = 'finished'; setWinners(g); }
    return true;
  }
  function apply(g, seat, a, rng = Math.random) {
    if (a?.type === 'reveal') return revealNext(g,seat,a.index);
    if (a?.type === 'acknowledge') {
      if (a.phase !== g.phase) return false;
      return acknowledge(g, seat, a.leg);
    }
    if (!a || g.phase !== 'playing' || g.turn !== seat) return false;
    const p = g.players[seat]; let message;
    const previousEvent = g.event; g.event = null;
    if (a.type === 'roll') {
      const index = Math.floor(rng() * g.dice.length), color = g.dice.splice(index, 1)[0];
      const steps = die(rng), face = color === 'grey' ? (rng() < .5 ? 'black' : 'white') : color;
      const camel = color === 'grey' ? crazy(g, face) : color;
      // Roll rewards are paid now; pyramid tickets only track rolls and partner copies.
      p.pyramids++; p.money++; const movement = move(g, camel, steps);
      g.rolled.push({ color, steps, face });
      g.event = { ...movement, color, face, id: g.revision + 1 };
      message = rollMessage(g,seat,color,movement);
      g.event.message = message;
      if (movement.finished || g.rolled.length === 5) {
        scoreLeg(g); g.phase = 'scoring';
        if (movement.finished) finish(g);
      }
    } else if (a.type === 'ticket' && COLORS.includes(a.color) && g.supply[a.color].length) {
      const value = g.supply[a.color].shift(); p.tickets.push({ color: a.color, value });
      message = `${p.name} took a ${a.color} leg ticket (${value} GOLD).`;
    } else if (a.type === 'tile' && [1, -1].includes(a.side) && validTile(g, seat, a.space)) {
      g.tiles = g.tiles.filter(t => t.seat !== seat); g.tiles.push({ seat, space: a.space, side: a.side });
      message = `${p.name} placed ${a.side === 1 ? 'cheer' : 'jeer'} on space ${a.space}.`;
    } else if (a.type === 'bet' && ['winner', 'loser'].includes(a.kind) && p.hand.includes(a.color)) {
      p.hand.splice(p.hand.indexOf(a.color), 1); g.bets[a.kind].push({ seat, color: a.color });
      message = `${p.name} secretly backed the overall ${a.kind}.`;
    } else if (a.type === 'partner' && g.players.length >= 6 && Number.isInteger(a.seat) && a.seat !== seat && g.players[a.seat] && p.partner === null && g.players[a.seat].partner === null) {
      p.partner = a.seat; g.players[a.seat].partner = seat; message = `${p.name} partnered with ${g.players[a.seat].name}.`;
    } else { g.event = previousEvent; return false; }
    g.turn = (g.turn + 1) % g.players.length; g.revision++;
    record(g,message); return true;
  }
  function allAcknowledged(g) { return g.acknowledged?.length === g.players.length && g.acknowledged.every(Boolean); }
  function acknowledge(g, seat, leg) {
    if (!['scoring','finished'].includes(g.phase) || leg !== g.leg || !Number.isInteger(seat) || !g.players[seat] || g.roundReviewed) return false;
    if (!g.acknowledged) g.acknowledged = g.players.map(() => false);
    if (g.acknowledged[seat]) return false;
    g.acknowledged[seat] = true; g.revision++;
    if (allAcknowledged(g)) {
      if (g.phase === 'scoring') nextLeg(g);
      else g.roundReviewed = true;
    }
    return true;
  }
  function nextLeg(g) {
    if (g.phase !== 'scoring' || !allAcknowledged(g)) return false;
    g.leg++; resetLeg(g); g.phase = 'playing'; g.event = null; g.revision++; return true;
  }
  // Only the host holds the full hidden finish-card decks.
  function view(g, seat) {
    const v = JSON.parse(JSON.stringify(g));
    v.players.forEach((p,i) => { p.finishCardsRemaining = g.players[i].hand.length; });
    if (g.phase !== 'finished') {
      for (const kind of ['winner', 'loser']) {
        const revealed = g.finishResults?.filter(b => b.kind === kind).length || 0;
        v.bets[kind] = g.bets[kind].map((b,i) => ({ seat:b.seat, ...(b.seat === seat || i < revealed ? {color:b.color} : {}) }));
      }
      v.players.forEach((p, i) => { if (i !== seat) p.hand = null; });
    }
    v.mySeat = seat; return v;
  }
  const api = { COLORS, ALL, create, locate, ranking, crazy, validTile, move, ticketValue, scoreLeg, revealNext, apply, allAcknowledged, acknowledge, nextLeg, view };
  if (typeof module !== 'undefined') module.exports = api; else root.CamelUp = api;
})(typeof window !== 'undefined' ? window : globalThis);
