// "Move to the Cardoku app": sends a copy of this browser's Cardoku progress (past games, achievements,
// Completionist checks) to the Cardoku server and shows a transfer code to enter in the app
// (Menu → Transfer Data → Receive). Nothing here is changed or removed. The server deletes its copy
// once the app receives it, or after 7 days.
(function () {
  const TRANSFER_URL = 'https://play.cardoku.com/api/transfer';

  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  };

  // "2026-10-31T19:26:00.000Z" → "2026-10-31 13:26" in this browser's time, as the app writes it
  function localTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // This site's saved progress in the app's save format (Progress.export_data in the app)
  function progress() {
    const history = read('cardoku-history', []);
    const games = (Array.isArray(history) ? history : []).filter(g => g && g.id).map(g => ({
      id: 'web-' + g.id,
      finished: localTime(g.date),
      layout: g.layout || 'default',
      score: g.score,
      lines: g.lines,
      placed: g.placed,
      discarded: g.discarded,
      undo_used: !!g.undoUsed,
      assisted: false,
      grid: (g.board || []).map(code => code || ''),
      achievements: g.achievements || [],
      fresh: (g.newAchievements || []).concat(g.upgradedAchievements || [])
    }));
    const achievements = {};
    const state = read('cardoku-achievement-state', {});
    Object.keys(state || {}).forEach(id => {
      const s = state[id] || {};
      if (!s.unlocked && !s.titleVisible) return;
      achievements[id] = {
        unlocked: s.unlocked ? localTime(s.unlocked).slice(0, 10) : '',
        title_visible: !!(s.titleVisible || s.unlocked),
        no_undo: s.noUndo ? localTime(s.noUndo).slice(0, 10) : ''
      };
    });
    const bests = {};
    const layouts = (read('cardoku-stats', {}) || {}).layouts || {};
    Object.keys(layouts).forEach(name => {
      if (layouts[name] && layouts[name].max !== null && layouts[name].max !== undefined) bests[name] = layouts[name].max;
    });
    const finished = read('cardoku-finished', {}) || {};
    const best = Number(localStorage.getItem('cardoku-best-score'));
    return {
      games,
      dailies: {},
      achievements,
      checked: read('cardoku-completionist', []),
      gold: read('cardoku-completionist-gold', []),
      finished: Math.max(Number(finished.count) || 0, games.length),
      bests,
      best: localStorage.getItem('cardoku-best-score') !== null && !isNaN(best) ? best : null
    };
  }

  const button = document.getElementById('transferBtn');
  const status = document.getElementById('transferStatus');
  const codeBox = document.getElementById('transferCode');
  if (!button) return;

  let p;
  try {
    p = progress();
  } catch (e) {
    return;  // storage blocked: nothing to move
  }
  const unlocked = Object.values(p.achievements).filter(a => a.unlocked).length;
  if (!p.games.length && !unlocked) return;
  button.hidden = false;
  status.hidden = false;
  status.textContent = `Moving to the app? This browser has ${p.games.length} saved game${p.games.length === 1 ? '' : 's'} ` +
    `and ${unlocked} achievement${unlocked === 1 ? '' : 's'}. Make a code, then enter it in the app under Transfer Data.`;

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      // text/plain keeps it a simple request (no CORS preflight); the server reads it as JSON
      const response = await fetch(TRANSFER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ version: 'web-' + location.hostname, platform: 'Old web', progress: progress() })
      });
      const reply = await response.json();
      if (!response.ok || !reply.code) throw new Error(reply.error || response.status);
      codeBox.textContent = reply.code.slice(0, 4) + '-' + reply.code.slice(4);
      codeBox.hidden = false;
      status.textContent = 'In the Cardoku app, open Transfer Data and enter this code under Receive. ' +
        'It works once, within 7 days. Everything stays here too.';
      button.textContent = 'Make a new code';
    } catch (e) {
      status.textContent = "Couldn't make a code. Check your connection and try again.";
      button.textContent = 'Move to the Cardoku app';
    }
    button.disabled = false;
  });
})();
