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

// ---------------------------------------------------------------------------
// Currency + Shop
// ---------------------------------------------------------------------------
// Tokens are earned by playing (see REWARDS) and spent on cosmetic site-wide
// color themes (see SHOP_ITEMS). Both tables live server-side and are
// authoritative — the client never gets to say how much something costs or
// how many tokens an action is worth, it just says *what happened* (a reason
// + a quantity), and the server looks up the real value.
const REWARDS = {
  soccer_win: 20, soccer_loss: 5, soccer_goal: 1, soccer_save: 1,
  racing_win: 20, racing_loss: 5,
  tank_win: 20, tank_loss: 5,
  wildduel_win: 20, wildduel_loss: 5,
  runner_score: 0.5,   // per point of score that run
  asteroid_shot: 1      // per asteroid destroyed that run
};

const SHOP_ITEMS = {
  neon:   { name: 'Neon Default', cost: 0,   cyan: '#2de2c5', pink: '#ff3d8a', gold: '#ffc857' },
  sunset: { name: 'Sunset Drift', cost: 150, cyan: '#ff7a45', pink: '#ff4d6d', gold: '#ffd23f' },
  toxic:  { name: 'Toxic Lab',    cost: 150, cyan: '#9dff45', pink: '#45ffb0', gold: '#e8ff45' },
  royal:  { name: 'Royal Velvet', cost: 200, cyan: '#c9a6ff', pink: '#ff8fd1', gold: '#ffd24d' },
  blood:  { name: 'Blood Moon',   cost: 250, cyan: '#ff5454', pink: '#ff8a8a', gold: '#ffae42' }
};

const DEFAULT_WALLET = { tokens: 0, owned: ['neon'], equipped: 'neon' };

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
  const rec = JSON.parse(JSON.stringify(DEFAULT_STATS));
  rec.wallet = JSON.parse(JSON.stringify(DEFAULT_WALLET));
  return rec;
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
    // Same idea for the wallet: backfill anything missing rather than
    // assuming every saved record already has the new fields.
    const w = data[u].wallet;
    if (!w || typeof w !== 'object') {
      data[u].wallet = JSON.parse(JSON.stringify(DEFAULT_WALLET));
    } else {
      if (typeof w.tokens !== 'number') w.tokens = 0;
      if (!Array.isArray(w.owned)) w.owned = [];
      if (!w.owned.includes('neon')) w.owned.push('neon');
      if (!w.equipped || !w.owned.includes(w.equipped)) w.equipped = 'neon';
    }
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

// ---------------------------------------------------------------------------
// Wallet + Shop endpoints
// ---------------------------------------------------------------------------
app.get('/api/wallet', (req, res) => {
  const user = req.query.user;
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const data = loadData();
  res.json(data[user].wallet);
});

app.get('/api/shop/items', (req, res) => {
  res.json(SHOP_ITEMS);
});

// The client reports *what happened* (a reason + how many times), never an
// amount — the actual token value always comes from the REWARDS table here,
// so there's no way to fake a payout by sending a bogus amount.
app.post('/api/wallet/earn', async (req, res) => {
  const { user, reason, qty } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!(reason in REWARDS)) {
    return res.status(400).json({ error: 'Unknown reason' });
  }
  const safeQty = Math.max(0, Math.min(500, Number(qty) || 0));
  const amount = Math.round(REWARDS[reason] * safeQty);

  try {
    const updated = await withWriteLock(() => {
      const data = loadData();
      data[user].wallet.tokens += amount;
      saveData(data);
      return data[user].wallet;
    });
    res.json(updated);
  } catch (e) {
    console.error('Earn failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/shop/purchase', async (req, res) => {
  const { user, itemId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!SHOP_ITEMS[itemId]) {
    return res.status(400).json({ error: 'Unknown item' });
  }

  try {
    const result = await withWriteLock(() => {
      const data = loadData();
      const wallet = data[user].wallet;
      if (wallet.owned.includes(itemId)) {
        return { error: 'Already owned' };
      }
      const cost = SHOP_ITEMS[itemId].cost;
      if (wallet.tokens < cost) {
        return { error: 'Not enough tokens' };
      }
      wallet.tokens -= cost;
      wallet.owned.push(itemId);
      wallet.equipped = itemId;
      saveData(data);
      return { wallet };
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Purchase failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/wallet/equip', async (req, res) => {
  const { user, itemId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }

  try {
    const result = await withWriteLock(() => {
      const data = loadData();
      const wallet = data[user].wallet;
      if (!wallet.owned.includes(itemId)) {
        return { error: 'Not owned' };
      }
      wallet.equipped = itemId;
      saveData(data);
      return { wallet };
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Equip failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`Leaderboard server running on http://localhost:${PORT}`);
});
