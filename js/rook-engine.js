/*
 * Rook rules: the deck, bidding, the widow, tricks, scoring, and the CSV exports.
 *
 * No DOM or networking here, so the same file runs in the page (as window.RookEngine, used by
 * js/rook.js) and in Node for tests: const RookEngine = require('./js/rook-engine.js');
 */
(function (root) {
  // ---------- Rules (ported from github.com/jaceiverson/Rook, ooo-refactor branch) ----------
  const SUITS = ['b', 'r', 'g', 'y'];
  const SUIT_NAMES = { b: 'Black', r: 'Red', g: 'Green', y: 'Yellow' };
  const DECK = SUITS.flatMap(s => Array.from({ length: 14 }, (_, i) => s + (i + 1))).concat('rk');
  const MIN_BID = 100;
  const MAX_BID = 180;
  const WIN_SCORE = 500;
  const TRICKS = 13;

  const suitOf = c => (c === 'rk' ? 'rk' : c[0]);
  const numOf = c => (c === 'rk' ? 20 : Number(c.slice(1)));
  // pValue and tValue from deck.json: 1s are worth 15 and rank above 14; the Rook is 20 of both
  function pointsOf(c) {
    const n = numOf(c);
    if (n === 20) return 20;
    if (n === 1) return 15;
    if (n === 10 || n === 14) return 10;
    return n === 5 ? 5 : 0;
  }
  const rankOf = c => (numOf(c) === 1 ? 15 : numOf(c));
  const sumPoints = cards => cards.reduce((t, c) => t + pointsOf(c), 0);
  const teamOf = seat => seat % 2;   // seats alternate teams, so partners sit across
  const effSuit = (c, trump) => (c === 'rk' || suitOf(c) === trump ? 'trump' : suitOf(c));
  const cardName = c => (c === 'rk' ? 'the Rook' : `${SUIT_NAMES[suitOf(c)]} ${numOf(c)}`);

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Rook and trump first, then the other suits; high cards on the left
  function sortHand(cards, trump) {
    const order = ['rk'].concat(trump ? [trump, ...SUITS.filter(s => s !== trump)] : SUITS);
    return cards.slice().sort((a, b) =>
      order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankOf(b) - rankOf(a));
  }

  // Follow the led suit; if you can't, you must trump if you can (play.py available_cards)
  function legalPlays(hand, trick, trump) {
    if (!trick.length) return hand.slice();
    const lead = effSuit(trick[0].card, trump);
    const follow = hand.filter(c => effSuit(c, trump) === lead);
    if (follow.length) return follow;
    const trumps = hand.filter(c => effSuit(c, trump) === 'trump');
    return trumps.length ? trumps : hand.slice();
  }

  function trickWinner(trick, trump) {
    let best = trick[0];
    for (const p of trick.slice(1)) {
      const s = effSuit(p.card, trump);
      const b = effSuit(best.card, trump);
      if ((s === 'trump' && b !== 'trump') || (s === b && rankOf(p.card) > rankOf(best.card))) best = p;
    }
    return best.seat;
  }

  const minBid = G => (G.highBid ? G.highBid + 5 : MIN_BID);

  function newGame(seats, pastGames = []) {
    const G = {
      seats, scores: [0, 0], history: [], log: [], handNo: 0, dealer: -1, winner: null,
      pastGames, gameNo: pastGames.length + 1   // earlier games this session, for the all-games export
    };
    startHand(G);
    return G;
  }

  function startHand(G) {
    let hands;
    do {
      const deck = shuffle(DECK.slice());
      hands = [0, 1, 2, 3].map(i => deck.slice(i * 13, i * 13 + 13));
      G.widow = deck.slice(52);
    } while (hands.some(h => sumPoints(h) === 0));   // redeal when a hand has no point cards

    G.handNo++;
    G.dealer = (G.dealer + 1) % 4;
    G.log.push({ hand: G.handNo, dealer: G.dealer, bids: null, bidWinner: null, bid: 0, trump: null, tricks: [] });
    Object.assign(G, {
      phase: 'bidding',
      hands: hands.map(h => sortHand(h)),
      bids: [null, null, null, null],   // number, 'pass', or null (hasn't bid yet)
      highBid: 0,
      highBidder: null,
      turn: (G.dealer + 1) % 4,
      bidWinner: null,
      bid: 0,
      widowSeen: [false, false, false, false],
      trump: null,
      discards: [],
      trick: [],                        // [{ seat, card }] in play order
      trickDone: false,                 // all four cards are down, waiting to be collected
      trickNo: 0,
      taken: [0, 0],                    // points captured this hand, per team
      tricksWon: [0, 0],
      lastTrick: null,
      result: null
    });
  }

  function advanceBidding(G) {
    const active = [0, 1, 2, 3].filter(s => G.bids[s] !== 'pass');
    if (active.length === 1) {
      // If the first three pass, the last player is stuck with the minimum (play.py bid_sequence)
      G.bidWinner = G.turn = active[0];
      G.bid = G.highBid || MIN_BID;
      if (G.bid === MAX_BID) revealWidow(G);
      else G.phase = 'raise';
      return;
    }
    do G.turn = (G.turn + 1) % 4; while (G.bids[G.turn] === 'pass');
  }

  // The widow is turned face up, and everyone confirms they've seen it before it's picked up
  function revealWidow(G) {
    G.phase = 'reveal';
    G.widowSeen = [false, false, false, false];
  }

  function pickUpWidow(G) {
    G.phase = 'widow';
    G.hands[G.bidWinner] = sortHand(G.hands[G.bidWinner].concat(G.widow));
  }

  const validBid = n => Number.isInteger(n) && n % 5 === 0 && n <= MAX_BID;

  // Applies a player's action if it's legal; returns whether anything changed.
  function applyAction(G, seat, a) {
    switch (a && a.type) {
      case 'bid':
        if (G.phase !== 'bidding' || seat !== G.turn) return false;
        if (a.amount === 'pass') G.bids[seat] = 'pass';
        else if (validBid(a.amount) && a.amount >= minBid(G)) {
          G.bids[seat] = G.highBid = a.amount;
          G.highBidder = seat;
        } else return false;
        advanceBidding(G);
        return true;

      case 'raise':
        if (G.phase !== 'raise' || seat !== G.bidWinner) return false;
        if (a.amount != null) {
          if (!validBid(a.amount) || a.amount <= G.bid) return false;
          G.bid = a.amount;
        }
        revealWidow(G);
        return true;

      case 'seen':
        if (G.phase !== 'reveal' || G.widowSeen[seat]) return false;
        G.widowSeen[seat] = true;
        if (G.widowSeen.every(Boolean)) pickUpWidow(G);
        return true;

      case 'widow': {
        if (G.phase !== 'widow' || seat !== G.bidWinner) return false;
        const hand = G.hands[seat];
        const bury = a.discards;
        if (!SUITS.includes(a.trump) || !Array.isArray(bury) || bury.length !== 5 ||
          new Set(bury).size !== 5 || !bury.every(c => hand.includes(c))) return false;
        G.discards = bury.slice();
        G.trump = a.trump;
        G.hands[seat] = hand.filter(c => !bury.includes(c));
        G.hands = G.hands.map(h => sortHand(h, G.trump));
        Object.assign(G.log[G.log.length - 1], { bids: G.bids.slice(), bidWinner: seat, bid: G.bid, trump: G.trump });
        G.phase = 'play';
        G.turn = seat;   // bid winner leads the first trick
        return true;
      }

      case 'play': {
        if (G.phase !== 'play' || G.trickDone || seat !== G.turn) return false;
        if (!legalPlays(G.hands[seat], G.trick, G.trump).includes(a.card)) return false;
        G.hands[seat] = G.hands[seat].filter(c => c !== a.card);
        G.trick.push({ seat, card: a.card });
        if (G.trick.length < 4) {
          G.turn = (seat + 1) % 4;
          return true;
        }
        const w = trickWinner(G.trick, G.trump);
        const pts = sumPoints(G.trick.map(p => p.card));
        G.taken[teamOf(w)] += pts;
        G.tricksWon[teamOf(w)]++;
        G.lastTrick = { plays: G.trick.slice(), winner: w, points: pts };
        G.log[G.log.length - 1].tricks.push(G.lastTrick);
        G.trickDone = true;
        G.turn = w;   // trick winner leads next
        return true;
      }

      case 'next':
        if (G.phase !== 'handover') return false;
        startHand(G);
        return true;

      case 'again':
        if (G.phase !== 'gameover') return false;
        Object.assign(G, newGame(G.seats, G.pastGames.concat(currentGame(G))));
        return true;
    }
    return false;
  }

  // Clears a finished trick off the table (the host calls this after a short pause)
  function collectTrick(G) {
    if (!G.trickDone) return;
    G.trick = [];
    G.trickDone = false;
    G.trickNo++;
    if (G.trickNo === TRICKS) endHand(G);
  }

  // Scoring from play.py find_winner
  function endHand(G) {
    const lastTeam = teamOf(G.lastTrick.winner);
    const bidTeam = teamOf(G.bidWinner);
    const widowPts = sumPoints(G.discards);
    G.taken[lastTeam] += widowPts;   // last trick takes the buried widow

    const made = G.taken[bidTeam] >= G.bid;
    const delta = [0, 0];
    delta[bidTeam] = made ? G.bid : -G.bid;
    delta[1 - bidTeam] = G.taken[1 - bidTeam];
    G.scores = G.scores.map((s, t) => s + delta[t]);

    G.result = {
      bidWinner: G.bidWinner, bid: G.bid, trump: G.trump, made, delta,
      taken: G.taken.slice(), widow: G.widow.slice(), discards: G.discards.slice(), widowPts, widowTeam: lastTeam
    };
    G.history.push({ hand: G.handNo, ...G.result, scores: G.scores.slice() });

    // First to 500 wins, but only if they're ahead (game.py check_for_game_winner)
    const lead = G.scores[0] > G.scores[1] ? 0 : G.scores[1] > G.scores[0] ? 1 : null;
    if (lead !== null && G.scores[lead] >= WIN_SCORE) {
      G.winner = lead;
      G.phase = 'gameover';
    } else {
      G.phase = 'handover';
    }
  }

  // What one seat is allowed to see: their own hand, the widow until it's buried, and the trick log
  // if the host allows it (everyone gets the full log once the game is over)
  function viewFor(G, seat, { log = false, live = false } = {}) {
    const v = {
      phase: G.phase, mySeat: seat, handNo: G.handNo, dealer: G.dealer, turn: G.turn,
      bids: G.bids, highBid: G.highBid, highBidder: G.highBidder, bidWinner: G.bidWinner, bid: G.bid,
      widowSeen: G.widowSeen, log: log || G.phase === 'gameover' ? G.log : null, live,
      trump: G.trump, trick: G.trick, trickDone: G.trickDone, trickNo: G.trickNo,
      taken: G.taken, tricksWon: G.tricksWon, lastTrick: G.lastTrick, scores: G.scores,
      history: G.history, result: G.result, winner: G.winner, gameNo: G.gameNo,
      pastGames: G.phase === 'gameover' ? G.pastGames : null,
      seats: G.seats.map(s => ({ name: s.name, connected: s.connected, voice: s.voice || null, pid: s.pid || null })),
      counts: G.hands.map(h => h.length),
      hand: seat >= 0 ? G.hands[seat] : []
    };
    if (G.phase === 'reveal' || G.phase === 'widow') v.widow = G.widow;
    return v;
  }
  // ---------- CSV export ----------
  // Two layouts: one row per hand (handsCsv) or one row per trick (tricksCsv). Both take a list of games,
  // so the same code exports one game or every game this session. Hand details repeat on each trick row
  // so the file sorts and filters cleanly in a spreadsheet. A hand still being played has no results
  // (and no widow, which isn't public until the hand is over).
  const cardLabel = c => (c === 'rk' ? 'Rook' : `${SUIT_NAMES[suitOf(c)]} ${numOf(c)}`);
  const cardList = list => (list || []).map(cardLabel).join(' ');

  // Snapshot of a game for exporting (names are kept as they were in that game)
  function currentGame(G) {
    return { game: G.gameNo, names: G.seats.map(s => s.name), log: G.log, history: G.history };
  }

  function csvCell(v) {
    if (typeof v === 'number') return String(v);
    let text = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;   // so spreadsheets don't run a name as a formula
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  const toCsv = rows => rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

  // Columns both layouts share: who bid what, and how the hand turned out
  function handColumns(g, h, r) {
    const names = g.names;
    const bids = (h.bids || []).map((b, s) => `${names[s]}: ${b === null ? '-' : b}`).join('; ');
    return {
      start: [g.game, h.hand, names[h.dealer], bids, names[h.bidWinner], `Team ${teamOf(h.bidWinner) + 1}`,
        h.bid, SUIT_NAMES[h.trump], r ? cardList(r.widow) : '', r ? cardList(r.discards) : ''],
      results: r
        ? [r.made ? 'Yes' : 'No', r.taken[0], r.taken[1], r.delta[0], r.delta[1], r.scores[0], r.scores[1]]
        : ['', '', '', '', '', '', ''],
      teams: [`${names[0]} & ${names[2]}`, `${names[1]} & ${names[3]}`]
    };
  }

  const HAND_HEAD = ['Game', 'Hand', 'Dealer', 'Bids', 'Bid Winner', 'Bidding Team', 'Bid', 'Trump', 'Widow', 'Buried'];
  const RESULT_HEAD = ['Bid Made', 'Team 1 Points Taken', 'Team 2 Points Taken', 'Team 1 Hand Score',
    'Team 2 Hand Score', 'Team 1 Total', 'Team 2 Total'];

  function handsCsv(games) {
    const rows = [[...HAND_HEAD, 'Team 1 Tricks', 'Team 2 Tricks', 'Last Trick Team', 'Widow Points',
      ...RESULT_HEAD, 'Team 1', 'Team 2']];
    for (const g of games) {
      for (const h of g.log) {
        const r = g.history.find(x => x.hand === h.hand);
        if (!r) continue;   // only finished hands
        const c = handColumns(g, h, r);
        const won = t => h.tricks.filter(x => teamOf(x.winner) === t).length;
        rows.push([...c.start, won(0), won(1), `Team ${r.widowTeam + 1}`, r.widowPts, ...c.results, ...c.teams]);
      }
    }
    return toCsv(rows);
  }

  function tricksCsv(games) {
    const rows = [[...HAND_HEAD, 'Trick', 'Led By', '1st Player', '1st Card', '2nd Player', '2nd Card',
      '3rd Player', '3rd Card', '4th Player', '4th Card', 'Taken By', 'Taken By Team', 'Trick Points',
      ...RESULT_HEAD, 'Team 1', 'Team 2']];
    for (const g of games) {
      for (const h of g.log) {
        const c = handColumns(g, h, g.history.find(x => x.hand === h.hand));
        h.tricks.forEach((t, n) => rows.push([
          ...c.start, n + 1, g.names[t.plays[0].seat],
          ...t.plays.flatMap(p => [g.names[p.seat], cardLabel(p.card)]),
          g.names[t.winner], `Team ${teamOf(t.winner) + 1}`, t.points,
          ...c.results, ...c.teams
        ]));
      }
    }
    return toCsv(rows);
  }

  const RookEngine = {
    SUITS, SUIT_NAMES, DECK, MIN_BID, MAX_BID, WIN_SCORE, TRICKS, pointsOf, sumPoints, teamOf, effSuit,
    cardName, shuffle, legalPlays, trickWinner, minBid, newGame, applyAction, collectTrick, viewFor,
    currentGame, handsCsv, tricksCsv
  };
  if (typeof module === 'object' && module.exports) module.exports = RookEngine;
  else root.RookEngine = RookEngine;
})(this);
