/**
 * Cardoku results collector: a Google Apps Script web app that saves every finished
 * Cardoku game (games/cardoku.html) to a Google Sheet, emails player feedback, and
 * optionally emails you about every game.
 *
 * This file is not used by the website. It runs in your Google account.
 *
 * Setup
 *   1. Create a Google Sheet (e.g. "Cardoku Results").
 *   2. Extensions > Apps Script. Replace the default code with this file and save.
 *   3. Set FEEDBACK_EMAIL below (and optionally NOTIFY_EMAIL for an email per game).
 *   4. Deploy > New deployment > type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      Approve the permissions prompt (Sheets and Mail).
 *   5. Copy the web app URL (ends in /exec) into RESULTS_URL in games/cardoku.html.
 *
 * The URL is visible in the page source, but it can only add rows and send feedback to
 * FEEDBACK_EMAIL. Your email address lives only here, never in the public page. Nobody can
 * read the Sheet unless you share it. Basic checks below reject malformed posts and floods.
 *
 * After editing this script, use Deploy > Manage deployments > Edit (pencil) >
 * Version: New version > Deploy, so the same URL picks up the change.
 */

const SHEET_NAME = 'Games';
const FEEDBACK_SHEET_NAME = 'Feedback';
const FEEDBACK_EMAIL = 'iverson.jace@gmail.com';  // where "Share game feedback" goes
const NOTIFY_EMAIL = '';    // e.g. 'you@example.com' for an email on every finished game; empty for none
const MAX_PER_MINUTE = 30;  // crude flood protection across all players
const MAX_IMAGE_CHARS = 3000000;  // ~2 MB PNG as base64

// New columns go at the end so rows saved before they existed still line up
const HEADERS = [
  'Received', 'Game ID', 'Finished', 'Score', 'Lines', 'Placed', 'Discarded', 'Layout',
  'Achievements', 'Board', 'Discard pile', 'Completed lines', 'Raw JSON', 'Rules', 'Source'
];
const FEEDBACK_HEADERS = ['Received', 'Game ID', 'Score', 'Rules', 'Source', 'Message'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply_(false);
  try {
    if (!underRateLimit_()) return reply_(false);
    const data = JSON.parse(e.postData.contents);
    if (data && data.type === 'feedback') return reply_(handleFeedback_(data));
    if (!isValid_(data)) return reply_(false);

    const sheet = getSheet_(SHEET_NAME, HEADERS);
    const row = [
      new Date(),
      data.id,
      data.date,
      data.score,
      data.lines,
      data.placed,
      data.discarded,
      data.layout,
      (data.achievementNames || []).join(', '),
      data.boardRows.join('\n'),
      data.discards.join(' '),
      (data.completed || []).join('\n'),
      JSON.stringify(data),
      data.rules || '',
      data.source || ''
    ];

    // A player can undo after the game ends and finish again; keep one row per game
    const existing = findRow_(sheet, data.id);
    if (existing) {
      sheet.getRange(existing, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
      notify_(data);
    }
    return reply_(true);
  } catch (err) {
    return reply_(false);
  } finally {
    lock.releaseLock();
  }
}

function isValid_(d) {
  return d &&
    typeof d.id === 'string' && d.id.length <= 40 &&
    typeof d.score === 'number' &&
    Array.isArray(d.board) && d.board.length === 81 &&
    Array.isArray(d.boardRows) && d.boardRows.length === 9 &&
    Array.isArray(d.discards) && d.discards.length <= 45 &&
    d.board.filter(Boolean).length + d.discards.length <= 54;
}

// "Share game feedback": logs the note and emails the board picture plus the game's JSON
function handleFeedback_(d) {
  const game = d.game;
  const message = typeof d.message === 'string' ? d.message.slice(0, 2000) : '';
  const image = typeof d.image === 'string' && d.image.startsWith('data:image/png;base64,') &&
    d.image.length <= MAX_IMAGE_CHARS ? d.image : null;
  if (!isValid_(game)) return false;

  getSheet_(FEEDBACK_SHEET_NAME, FEEDBACK_HEADERS)
    .appendRow([new Date(), game.id, game.score, game.rules || '', game.source || '', message]);

  if (!FEEDBACK_EMAIL) return true;
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const summary = [
    `Score: ${game.score}  (${game.lines} lines, ${game.placed} placed, ${game.discarded} discarded, ${game.layout} layout)`,
    `Rules v${game.rules || '?'} · from ${game.source || 'unknown'}`,
    `Achievements: ${(game.achievementNames || []).join(', ') || 'none'}`,
    '',
    ...game.boardRows,
    '',
    `Discards: ${game.discards.join(' ') || 'none'}`
  ].join('\n');

  const attachments = [Utilities.newBlob(JSON.stringify(game, null, 2), 'application/json', `cardoku-${game.id}.json`)];
  const inlineImages = {};
  if (image) {
    const png = Utilities.newBlob(Utilities.base64Decode(image.split(',')[1]), 'image/png', `cardoku-${game.id}.png`);
    attachments.unshift(png);
    inlineImages.board = png;
  }

  MailApp.sendEmail({
    to: FEEDBACK_EMAIL,
    subject: `Cardoku feedback: ${game.score} pts`,
    htmlBody:
      `<p><strong>Player's note:</strong><br>${message ? escape(message).replace(/\n/g, '<br>') : '<em>(none)</em>'}</p>` +
      (image ? '<p><img src="cid:board" alt="Final board" style="max-width: 480px"></p>' : '') +
      `<pre style="font-family: monospace">${escape(summary)}</pre>`,
    attachments,
    inlineImages
  });
  return true;
}

function underRateLimit_() {
  const cache = CacheService.getScriptCache();
  const key = 'posts-' + Math.floor(Date.now() / 60000);
  const count = Number(cache.get(key) || 0);
  if (count >= MAX_PER_MINUTE) return false;
  cache.put(key, String(count + 1), 120);
  return true;
}

// Creates the tab on first use, and adds any header cells that were introduced later
function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    if (name === SHEET_NAME) sheet.getRange('J:J').setFontFamily('Roboto Mono');
  } else if (sheet.getRange(1, headers.length).getValue() !== headers[headers.length - 1]) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function findRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, 2, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] === id) return i + 2;
  }
  return 0;
}

function notify_(d) {
  if (!NOTIFY_EMAIL) return;
  const body = [
    `Score: ${d.score}  (${d.lines} lines, ${d.placed} placed, ${d.discarded} discarded, ${d.layout} layout)`,
    `Rules v${d.rules || '?'} · from ${d.source || 'unknown'}`,
    `Achievements: ${(d.achievementNames || []).join(', ') || 'none'}`,
    '',
    'Board:',
    ...d.boardRows,
    '',
    `Discards: ${d.discards.join(' ') || 'none'}`,
    '',
    'Completed:',
    ...(d.completed || [])
  ].join('\n');
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: `Cardoku game finished: ${d.score} pts`,
    htmlBody: `<pre style="font-family: monospace">${body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`
  });
}

function reply_(ok) {
  return ContentService.createTextOutput(JSON.stringify({ ok })).setMimeType(ContentService.MimeType.JSON);
}
