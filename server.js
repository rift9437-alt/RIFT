// Level 7 — Live Leaderboard Server
// -----------------------------------------------------------------------------
// A tiny Express server that stores the arcade leaderboard in a JSON file
// and exposes it over HTTP so every player's browser reads/writes the same
// shared data instead of each browser's own localStorage.
//
// Run:
//   npm install
//   npm start
//
// Endpoints:
//   GET  /api/leaderboard            -> { "HUNT-RYU": { soccer: {...}, racing: {...}, ... }, ... }
//   POST /api/leaderboard/update     -> body: { user, game, ops: [ {stat, op, value}, ... ] }
//
// Supported ops (op field):
//   "increment"     -> stat += value
//   "increment_if"  -> stat += value, only if `cond` is truthy (sent by client)
//   "max"           -> stat = Math.max(stat, value)
// -----------------------------------------------------------------------------

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'leaderboard.json');

// Must match the ACCOUNTS keys in level7_11.html so the leaderboard always
// has a row for every known user, even before they've played anything.
const USERS = [
  "HUNT-RYU",
  "LJ-ALAN",
  "ARTHUR-JSD",
  "VAL_SASHA",
  "ZANE_ICE",
  "JEN_BEN",
  "LUCA_SEA",
  "JONAH-12"
];

const DEFAULT_STATS = {
  soccer: { goals: 0, saves: 0, wins: 0 },
  racing: { wins: 0 },
  tank: { wins: 0 },
  runner: { highScore: 0 },
  wildduel: { wins: 0 },
  asteroid: { highScore: 0 }
};

// Password required to edit the Update Log through the secret admin panel.
// Override by setting ADMIN_PASSWORD in the environment before starting the server.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LEVEL7-ADMIN';
const UPDATELOG_FILE = path.join(__dirname, 'updatelog.txt');
const DEFAULT_UPDATELOG = `=== LEVEL 7 UPDATE LOG ===

[2026-06-25] ASTEROID BLASTER added to the arcade. Aim your gun with A/D (or arrow keys), blast incoming asteroids with SPACE before they reach your platform. 3 lives — every asteroid that slips through costs one. Score tracks total asteroids shot; high scores on the Leaderboard.

[2026-06-25] HOP RUNNER — new player sprite added. The runner now has a proper look instead of a plain block.

[2026-06-25] STREET SOCCER — new player sprites for both red and blue teams. Both players now sport custom pixel-art kits on the pitch.

[2026-06-25] APEX LOOP — fixed bot AI on Medium and Hard that was causing the car to spin in circles. Bot now uses stable, clamped steering logic and won't oscillate. Added speed boost powerups (⚡) scattered around the track — drive over them for a temporary burst of speed. Track background also polished up with a starfield, rumble strips, and lane markings.

[2026-06-24] WILD DUEL added to the arcade. Quick-draw with S, then fight it out on platforms with A/D/W/S. Local multiplayer or bot, 3 difficulties. Wins now appear on the Leaderboard.
[2026-06-24] Added this Update Log screen.

[Launch] Street Soccer, Apex Loop, Tank Duel, and Hop Runner went live, along with the shared live Leaderboard.
`;

function loadUpdateLog() {
  if (fs.existsSync(UPDATELOG_FILE)) {
    try {
      return fs.readFileSync(UPDATELOG_FILE, 'utf8');
    } catch (e) {
      console.error('Failed to read updatelog.txt, using default:', e);
    }
  }
  return DEFAULT_UPDATELOG;
}

function saveUpdateLog(content) {
  const tmpFile = UPDATELOG_FILE + '.tmp';
  fs.writeFileSync(tmpFile, content);
  fs.renameSync(tmpFile, UPDATELOG_FILE);
}

function freshUserRecord() {
  return JSON.parse(JSON.stringify(DEFAULT_STATS));
}

function loadData() {
  let data = {};
  if (fs.existsSync(DATA_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to parse leaderboard.json, starting fresh:', e);
      data = {};
    }
  }
  // Make sure every known user has a complete record, filling in any
  // missing games/stats (handy if you add a new game later).
  USERS.forEach(u => {
    if (!data[u]) data[u] = freshUserRecord();
    Object.keys(DEFAULT_STATS).forEach(game => {
      data[u][game] = Object.assign({}, DEFAULT_STATS[game], data[u][game] || {});
    });
  });
  return data;
}

function saveData(data) {
  // Atomic-ish write: write to a temp file then rename, so a crash mid-write
  // can't corrupt the real file.
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

// Very small write queue so concurrent requests (e.g. two players finishing
// matches at the same instant) apply one at a time instead of racing each
// other and losing an update.
let writeQueue = Promise.resolve();
function withWriteLock(fn) {
  const result = writeQueue.then(fn);
  // Keep the queue alive even if fn throws, so later writes still run.
  writeQueue = result.catch(() => {});
  return result;
}

const app = express();
app.use(express.json());

// Allow the game page to call this API even if it's hosted on a different
// origin/port during development. Tighten this to your real domain in
// production if you want to lock it down.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve the game itself from this same server, so "npm start" + one URL
// is all you need — no separate static host, no editing LB_API_BASE.
// (Only this one file is exposed; server.js/package.json/leaderboard.json
// are not served.)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'level7_12.html'));
});

app.get('/api/leaderboard', (req, res) => {
  res.json(loadData());
});

app.post('/api/leaderboard/update', async (req, res) => {
  const { user, game, ops } = req.body || {};

  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!DEFAULT_STATS[game]) {
    return res.status(400).json({ error: 'Unknown game' });
  }
  if (!Array.isArray(ops)) {
    return res.status(400).json({ error: 'ops must be an array' });
  }

  try {
    const updated = await withWriteLock(() => {
      const data = loadData();
      const record = data[user][game];

      for (const op of ops) {
        const { stat, type, value } = op;
        if (!(stat in record)) continue;
        if (typeof value !== 'number') continue;

        if (type === 'increment') {
          record[stat] += value;
        } else if (type === 'increment_if') {
          if (op.cond) record[stat] += value;
        } else if (type === 'max') {
          record[stat] = Math.max(record[stat], value);
        }
      }

      saveData(data);
      return data;
    });

    res.json(updated);
  } catch (e) {
    console.error('Update failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/updatelog', (req, res) => {
  res.json({ content: loadUpdateLog() });
});

app.post('/api/updatelog/update', async (req, res) => {
  const { password, content } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }
  try {
    const updated = await withWriteLock(() => {
      saveUpdateLog(content);
      return content;
    });
    res.json({ content: updated });
  } catch (e) {
    console.error('Update log save failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`Leaderboard server running on http://localhost:${PORT}`);
});
