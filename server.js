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
  asteroid: { highScore: 0 },
  breaker: { highScore: 0 }
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
  asteroid_shot: 1,      // per asteroid destroyed that run
  breaker_brick: 1       // per brick broken that run
};

const SHOP_ITEMS = {
  neon:   { name: 'Neon Default', cost: 0,   cyan: '#2de2c5', pink: '#ff3d8a', gold: '#ffc857' },
  sunset: { name: 'Sunset Drift', cost: 150, cyan: '#ff7a45', pink: '#ff4d6d', gold: '#ffd23f' },
  toxic:  { name: 'Toxic Lab',    cost: 150, cyan: '#9dff45', pink: '#45ffb0', gold: '#e8ff45' },
  royal:  { name: 'Royal Velvet', cost: 200, cyan: '#c9a6ff', pink: '#ff8fd1', gold: '#ffd24d' },
  blood:  { name: 'Blood Moon',   cost: 250, cyan: '#ff5454', pink: '#ff8a8a', gold: '#ffae42' },
  arctic: { name: 'Arctic Drift', cost: 200, cyan: '#7dd3ff', pink: '#c3e9ff', gold: '#e0f7ff' },
  vaporwave: { name: 'Vaporwave', cost: 250, cyan: '#5ff0ff', pink: '#ff6ad5', gold: '#c774e8' }
};

const DEFAULT_WALLET = { tokens: 0, owned: ['neon'], equipped: 'neon', asteroidUpgrades: { extraLife: 0, turnSpeed: 0, autoTurret: 0 }, wildduelUpgrades: { extraHp: 0, fasterReload: 0, fasterMovement: 0 } };

// Wild Duel upgrades apply to whichever user is logged in (their "p1"
// fighter) in both Single Player and Local Multiplayer — the bot / local
// player 2 always plays at base stats.
const WILDDUEL_UPGRADES = {
  extraHp: {
    name: 'Extra HP',
    desc: '+1 max health per level',
    maxLevel: 2,
    costs: [80, 160]
  },
  fasterReload: {
    name: 'Faster Reload',
    desc: '-12% shot cooldown per level',
    maxLevel: 3,
    costs: [60, 120, 200]
  },
  fasterMovement: {
    name: 'Faster Movement',
    desc: '+10% move speed per level',
    maxLevel: 3,
    costs: [60, 120, 200]
  }
};

// Shared purchase logic for any per-user, per-level upgrade track (Asteroid
// Blaster upgrades, Wild Duel upgrades, and anything added later). Returns
// either { wallet } on success or { error } on failure; never throws.
function purchaseLeveledUpgrade(wallet, catalog, walletKey, upgradeId) {
  const upgrade = catalog[upgradeId];
  if (!upgrade) return { error: 'Unknown upgrade' };
  const levels = wallet[walletKey];
  const level = levels[upgradeId] || 0;
  if (level >= upgrade.maxLevel) return { error: 'Already at max level' };
  const cost = upgrade.costs[level];
  if (wallet.tokens < cost) return { error: 'Not enough tokens' };
  wallet.tokens -= cost;
  levels[upgradeId] = level + 1;
  return { wallet };
}

// ---------------------------------------------------------------------------
// Asteroid Blaster upgrades
// ---------------------------------------------------------------------------
// Same "server is authoritative" pattern as the cosmetic shop above: the
// client only ever says which upgrade it wants to buy, never how much it
// costs or what it does. Each upgrade has its own max level and a cost per
// level (costs.length === maxLevel, costs[i] is the price to go from level i
// to level i+1).
const ASTEROID_UPGRADES = {
  extraLife: {
    name: 'Extra Life',
    desc: '+1 max life per level',
    maxLevel: 2,
    costs: [80, 160]
  },
  turnSpeed: {
    name: 'Faster Turn Speed',
    desc: '+15% gun turn speed per level',
    maxLevel: 3,
    costs: [60, 120, 200]
  },
  autoTurret: {
    name: 'Auto Turret',
    desc: 'A second turret that fires at the nearest asteroid on its own',
    maxLevel: 1,
    costs: [250]
  }
};

// Password required to edit the Update Log through the secret admin panel.
// Override by setting ADMIN_PASSWORD in the environment before starting the server.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN_123';
const UPDATELOG_FILE = path.join(__dirname, 'updatelog.txt');
const DEFAULT_UPDATELOG = `=== LEVEL 7 UPDATE LOG ===

[2026-07-23] NEON BREAKER added to the arcade. Move the paddle with A/D (or arrow keys), SPACE to launch the ball, break every brick before your 3 lives run out. Score tracks total bricks broken; high scores on the Leaderboard.
[2026-07-23] PAUSE added across every game. Hit ESC (or the ⏸ button top-right) mid-match to freeze the action, then Resume or Quit to Setup.
[2026-07-23] SHOP — two new color themes added: Arctic Drift and Vaporwave.
[2026-07-23] Admin panel — added a "Grant Coins" tool for handing out tokens directly.

[2026-07-23] WILD DUEL — token upgrades added. Spend your tokens on Extra HP (up to +2 max health), Faster Reload (up to 3 levels), and Faster Movement (up to 3 levels). These apply to your fighter in both Single Player and Local Multiplayer — the bot / other local player always plays at base stats. Pick your upgrades from the launch screen before you duel.

[2026-07-21] ASTEROID BLASTER — token upgrades added. Spend your tokens on Extra Life (up to +2 max lives), Faster Turn Speed (up to 3 levels), and a second Auto Turret that fires on its own at the nearest asteroid. Pick your upgrades from the launch screen before you play.
[2026-07-21] In early brainstorming: a new arcade game inspired by the sorcerer/curse-battle anime genre. Nothing built yet — concept ideas only, using original characters rather than any existing show's cast to keep things original.

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
      if (!w.asteroidUpgrades || typeof w.asteroidUpgrades !== 'object') {
        w.asteroidUpgrades = { extraLife: 0, turnSpeed: 0, autoTurret: 0 };
      } else {
        Object.keys(ASTEROID_UPGRADES).forEach(id => {
          if (typeof w.asteroidUpgrades[id] !== 'number') w.asteroidUpgrades[id] = 0;
        });
      }
      if (!w.wildduelUpgrades || typeof w.wildduelUpgrades !== 'object') {
        w.wildduelUpgrades = { extraHp: 0, fasterReload: 0, fasterMovement: 0 };
      } else {
        Object.keys(WILDDUEL_UPGRADES).forEach(id => {
          if (typeof w.wildduelUpgrades[id] !== 'number') w.wildduelUpgrades[id] = 0;
        });
      }
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

app.get('/api/asteroid/upgrades', (req, res) => {
  res.json(ASTEROID_UPGRADES);
});

app.post('/api/asteroid/upgrades/purchase', async (req, res) => {
  const { user, upgradeId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const upgrade = ASTEROID_UPGRADES[upgradeId];
  if (!upgrade) {
    return res.status(400).json({ error: 'Unknown upgrade' });
  }

  try {
    const result = await withWriteLock(() => {
      const data = loadData();
      const wallet = data[user].wallet;
      const outcome = purchaseLeveledUpgrade(wallet, ASTEROID_UPGRADES, 'asteroidUpgrades', upgradeId);
      if (outcome.error) return outcome;
      saveData(data);
      return outcome;
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Asteroid upgrade purchase failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/wildduel/upgrades', (req, res) => {
  res.json(WILDDUEL_UPGRADES);
});

app.post('/api/wildduel/upgrades/purchase', async (req, res) => {
  const { user, upgradeId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!WILDDUEL_UPGRADES[upgradeId]) {
    return res.status(400).json({ error: 'Unknown upgrade' });
  }

  try {
    const result = await withWriteLock(() => {
      const data = loadData();
      const wallet = data[user].wallet;
      const outcome = purchaseLeveledUpgrade(wallet, WILDDUEL_UPGRADES, 'wildduelUpgrades', upgradeId);
      if (outcome.error) return outcome;
      saveData(data);
      return outcome;
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Wild Duel upgrade purchase failed:', e);
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

// Admin-only: manually grant (or remove, with a negative amount) tokens for
// a user. Gated by the same ADMIN_PASSWORD as the update log editor.
app.post('/api/admin/grant-coins', async (req, res) => {
  const { password, user, amount } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt === 0) {
    return res.status(400).json({ error: 'Amount must be a non-zero number' });
  }

  try {
    const updated = await withWriteLock(() => {
      const data = loadData();
      data[user].wallet.tokens = Math.max(0, data[user].wallet.tokens + amt);
      saveData(data);
      return data[user].wallet;
    });
    res.json(updated);
  } catch (e) {
    console.error('Admin grant coins failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`Leaderboard server running on http://localhost:${PORT}`);
});
