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
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;

// Postgres connection. Set DATABASE_URL in the environment, e.g.
//   postgres://user:password@host:5432/dbname
// Most hosted Postgres providers (Render, Heroku, RDS, etc.) require SSL —
// uncomment the ssl block below if your provider needs it.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: { rejectUnauthorized: false }
});

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

// ---------------------------------------------------------------------------
// Security — auth, sessions, lockouts, rate limiting
// ---------------------------------------------------------------------------
// Passwords never live in the client HTML. Each is stored here as
// "salt:hash" (scrypt), never in plaintext. To add or change a password,
// generate a new hash with:
//   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync('NEWPASSWORD',s,64).toString('hex'))"
const PASSWORD_HASHES = {
  "HUNT-RYU": "9e241886c7a277a3e4cf34ca2e095d6b:dfa25861ebd08db5fcb7b7aa4dd5af024ceee4551b9ff5370b6a68a1b2045a0cae58fc7f79b3d055575a17d3948cf05338202eb3f733954683950eb482ffc0bd",
  "LJ-ALAN": "c7f2073b9dca6dedde5c4ae1a1388432:641ef2875efcb443220226a4971e283a6827edc10bd4ca995599014790dd4ed13d14ba1f78eb83dc28d62edbcb29c1ca55139c865a83ba52fa8b14b2812d7e17",
  "ARTHUR-JSD": "04aa84544adde56d3a28009d709fbb6e:3fe0e7849107b8801a2c818af73e7a0803e76fbd3cd55a0c7d7070ae41b11f64e6ae737b438573234000d8df343df1d813502dddaf984670069f36bbc2ea53e6",
  "VAL_SASHA": "99553dddd8b07045f1277d65a57386b5:8ad6b7aae04ab7f2c9adc82ed88f9fa5c13e43904f518dc17af1ca26b0b187c48a73f11ebbb0ca00d07fa8526bc5c180174dc6d37ffe6264aa952707bde4df5b",
  "ZANE_ICE": "5e3487dbaebd3fffd994c403075b5f8f:b2a157682f96249d9fb129d43c9ce6dfb7f16ab4c4ffe999d5a95500b3a7cc8cf46c57b37f217f32314f0b8a113bcb793174827e8e5e75a7abe8f62c0e2a4af0",
  "JEN_BEN": "258315f235530dff7c61df00c9aa7939:16c0832cee17bd5e9298ed30a2c709f764299f1a0eb821f09db474af46605d9f28c26a7e0f0b4dcdbc629127f5c5e99048f3a75bd8fc5a19496f237f3171873e",
  "LUCA_SEA": "9c3526d4ffa519c9ced5a0e86c4845f2:5b7c6b2589d46bdc0fbdf293354f1f690978c7d446304687df88151a107a71df93b64cd6c338c37d0f5f865a45dc63b4b58cc0c936ea1001eb93ac3100b568df",
  "JONAH-12": "3aa7b283173f4c75717a31819683b171:f9427fd40f38f2ff5f4037a4698b8eab5272d8914b85b97de5c523a1550eaac75d8a28db50d18ef587e34ad6c77d3278a4c19019e9b3fcecaba49a204af4d927"
};

function verifyPassword(username, password){
  const entry = PASSWORD_HASHES[username];
  if(!entry || typeof password !== 'string') return false;
  const [salt, hash] = entry.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

// Session tokens are held in memory (not the database) — they're short-lived
// credentials, not data worth persisting across restarts. A restart just
// means everyone logs in again.
const sessions = new Map(); // token -> { username, expiresAt }
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, sliding

function createSession(username){
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function authenticate(req){
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) return null;
  const session = sessions.get(token);
  if(!session) return null;
  if(session.expiresAt < Date.now()){ sessions.delete(token); return null; }
  session.expiresAt = Date.now() + SESSION_TTL_MS; // sliding expiry
  return session.username;
}

// Confirms the request carries a valid session AND that session belongs to
// the account it's trying to act as. This is what stops one logged-in
// player from spending or earning tokens on someone else's account by
// simply changing the `user` field in a request body.
function requireOwnUser(req, res, bodyUser){
  const authedUser = authenticate(req);
  if(!authedUser){
    res.status(401).json({ error: 'Not authenticated. Please log in again.' });
    return null;
  }
  if(authedUser !== bodyUser){
    res.status(403).json({ error: 'You can only act as your own account.' });
    return null;
  }
  return authedUser;
}

// Login lockouts — after repeated failed attempts on one account, block
// further attempts on that account for a cooldown period, regardless of
// which IP they're coming from.
const loginAttempts = new Map(); // username -> { count, firstAttempt, lockedUntil }
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function lockoutRemainingMs(username){
  const rec = loginAttempts.get(username);
  if(!rec || !rec.lockedUntil) return 0;
  return Math.max(0, rec.lockedUntil - Date.now());
}
function recordFailedLogin(username){
  const now = Date.now();
  let rec = loginAttempts.get(username);
  if(!rec || now - rec.firstAttempt > LOCKOUT_WINDOW_MS){
    rec = { count: 0, firstAttempt: now, lockedUntil: 0 };
  }
  rec.count++;
  if(rec.count >= LOCKOUT_THRESHOLD){
    rec.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(username, rec);
}
function clearLoginAttempts(username){
  loginAttempts.delete(username);
}

// IP rate limiting — simple in-memory sliding window. Fine for a hobby-scale
// site behind one server instance; not meant to replace a real WAF.
const ipHits = new Map(); // ip -> [timestamps]
function isRateLimited(ip, limit, windowMs){
  const now = Date.now();
  let hits = (ipHits.get(ip) || []).filter(t => now - t < windowMs);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > limit;
}
function clientIp(req){
  const fwd = req.headers['x-forwarded-for'];
  if(fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// Suspicious activity — flags (doesn't block) accounts firing an abnormal
// number of mutating requests in a short window, so an admin can review.
const userActivity = new Map(); // username -> [timestamps]
function flagIfSuspicious(username, action){
  const now = Date.now();
  let hits = (userActivity.get(username) || []).filter(t => now - t < 10000);
  hits.push(now);
  userActivity.set(username, hits);
  if(hits.length === 31){ // fire once per burst, not on every call past the line
    logAdminAction('suspicious_activity', { username, action, callsInLast10s: hits.length });
  }
}

// Sanity ceilings so a tampered client can't hand itself an impossible
// score or floor. Applied in /api/leaderboard/update.
const STAT_CEILINGS = {
  runner: { highScore: 20000 },
  asteroid: { highScore: 5000 },
  breaker: { highScore: 5000 },
  roguelike: { deepestFloor: 500 },
  comet: { highScore: 5000 },
  tunnel: { highScore: 250000 },
  depths: { bestWave: 200 },
  stack: { bestHeight: 500 },
  golf: { bestHoles: 200 }
};
const MAX_INCREMENT_PER_CALL = 5;

// Per-reason ceilings for /api/wallet/earn, tighter than the generic 0-500
// clamp so a single call can't claim an implausible number of events.
const REASON_QTY_CAPS = {
  soccer_win: 1, soccer_loss: 1, soccer_goal: 5, soccer_save: 5,
  racing_win: 1, racing_loss: 1,
  tank_win: 1, tank_loss: 1,
  wildduel_win: 1, wildduel_loss: 1,
  runner_score: 20000,
  asteroid_shot: 200,
  breaker_brick: 200,
  roguelike_kill: 100,
  roguelike_floor: 100,
  roguelike_loot: 50,
  comet_dodged: 200,
  tunnel_gate: 300,
  depths_kill: 60,
  depths_wave: 1,
  stack_block: 5,
  golf_hole: 5,
  sumo_win: 1, sumo_loss: 1
};

const DEFAULT_STATS = {
  soccer: { goals: 0, saves: 0, wins: 0 },
  racing: { wins: 0 },
  tank: { wins: 0 },
  runner: { highScore: 0 },
  wildduel: { wins: 0 },
  asteroid: { highScore: 0 },
  breaker: { highScore: 0 },
  roguelike: { deepestFloor: 0 },
  comet: { highScore: 0 },
  tunnel: { highScore: 0 },
  depths: { bestWave: 0 },
  stack: { bestHeight: 0 },
  golf: { bestHoles: 0 },
  sumo: { wins: 0 }
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
  breaker_brick: 1,      // per brick broken that run
  roguelike_kill: 2,     // per monster killed that run
  roguelike_floor: 10,   // per floor cleared that run
  roguelike_loot: 3,     // per loot pickup grabbed that run
  comet_dodged: 0.5,     // per comet dodged that run
  tunnel_gate: 1,        // per barrier ring threaded that run
  depths_kill: 2,        // per hostile killed that run
  depths_wave: 12,       // per wave cleared
  stack_block: 2,        // per block landed on the tower
  golf_hole: 15,         // per hole sunk
  sumo_win: 20, sumo_loss: 5
};

const SHOP_ITEMS = {
  neon:   { name: 'Neon Default', cost: 0,   cyan: '#2de2c5', pink: '#ff3d8a', gold: '#ffc857', bg: '#0a0d13', bgPanel: '#12161f', bgPanelRaised: '#1a1f2b', border: '#262c3a' },
  sunset: { name: 'Sunset Drift', cost: 150, cyan: '#ff7a45', pink: '#ff4d6d', gold: '#ffd23f', bg: '#160f0a', bgPanel: '#20140d', bgPanelRaised: '#2b1c12', border: '#3a2415' },
  toxic:  { name: 'Toxic Lab',    cost: 150, cyan: '#9dff45', pink: '#45ffb0', gold: '#e8ff45', bg: '#0a130d', bgPanel: '#0f1f14', bgPanelRaised: '#16291b', border: '#22381f' },
  royal:  { name: 'Royal Velvet', cost: 200, cyan: '#c9a6ff', pink: '#ff8fd1', gold: '#ffd24d', bg: '#120a16', bgPanel: '#1a0f20', bgPanelRaised: '#24162b', border: '#332040' },
  blood:  { name: 'Blood Moon',   cost: 250, cyan: '#ff5454', pink: '#ff8a8a', gold: '#ffae42', bg: '#150a0a', bgPanel: '#210f0f', bgPanelRaised: '#2b1515', border: '#3a1f1f' },
  arctic: { name: 'Arctic Drift', cost: 200, cyan: '#7dd3ff', pink: '#c3e9ff', gold: '#e0f7ff', bg: '#0a1018', bgPanel: '#0f1824', bgPanelRaised: '#16212f', border: '#223244' },
  vaporwave: { name: 'Vaporwave', cost: 250, cyan: '#5ff0ff', pink: '#ff6ad5', gold: '#c774e8', bg: '#130a1a', bgPanel: '#1c0f26', bgPanelRaised: '#271633', border: '#3a2247' },
  zip: { name: 'Zip', cost: 3000, cyan: '#ff2e2e', pink: '#ffffff', gold: '#ff2e2e', bg: '#0a0a0a', bgPanel: '#141414', bgPanelRaised: '#1e1e1e', border: '#2a2a2a', taunts: true }
};

const DEFAULT_WALLET = {
  tokens: 0,
  owned: ['neon'], equipped: 'neon',
  asteroidUpgrades: { extraLife: 0, turnSpeed: 0, autoTurret: 0 },
  wildduelUpgrades: { extraHp: 0, fasterReload: 0, fasterMovement: 0 },
  roguelikeUpgrades: { extraHp: 0, swordDamage: 0, magicPower: 0, swiftBoots: 0 },
  perks: { coinMagnet: 0, secondWind: 0, extraGuard: 0, insurance: 0, luckyStreak: 0, streakSaver: 0 },
  titles: ['none'], title: 'none',
  emblems: ['none'], emblem: 'none'
};

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
function clampNumber(v, min, max){
  return Math.max(min, Math.min(max, v));
}

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

// Crypt Crawler upgrades are permanent (bought with tokens between runs, not
// found in a run) and apply from floor 1 of every run.
const ROGUELIKE_UPGRADES = {
  extraHp: {
    name: 'Extra HP',
    desc: '+1 max health per level',
    maxLevel: 3,
    costs: [80, 140, 220]
  },
  swordDamage: {
    name: 'Sharper Blade',
    desc: '+20% sword damage per level',
    maxLevel: 3,
    costs: [80, 140, 220]
  },
  magicPower: {
    name: 'Arcane Power',
    desc: '+20% magic damage and -10% magic cooldown per level',
    maxLevel: 3,
    costs: [80, 140, 220]
  },
  swiftBoots: {
    name: 'Swift Boots',
    desc: '+10% move speed per level',
    maxLevel: 3,
    costs: [80, 140, 220]
  }
};

// ---------------------------------------------------------------------------
// Perks — global, coin-bought, and they apply in *every* cabinet
// ---------------------------------------------------------------------------
// Unlike the per-game upgrade tracks above, perks are account-wide. Same
// server-is-authoritative rule: the client asks to buy one by id, the server
// owns the price and the effect. The client reads the levels back and applies
// the numbers, but the server re-derives anything that touches the wallet.
const PERKS = {
  coinMagnet: {
    name: 'Coin Magnet',
    desc: '+15% tokens from everything you play, per level',
    icon: '🧲',
    maxLevel: 3,
    costs: [200, 400, 700]
  },
  secondWind: {
    name: 'Second Wind',
    desc: 'One free revive per solo run, per level',
    icon: '💨',
    maxLevel: 2,
    costs: [350, 800]
  },
  extraGuard: {
    name: 'Extra Guard',
    desc: '+1 starting life in Asteroid Blaster and Neon Breaker, +1 shield in Hyper Tunnel, per level',
    icon: '❤️',
    maxLevel: 2,
    costs: [250, 520]
  },
  insurance: {
    name: 'Insurance',
    desc: 'Losing a versus match still pays out like a win, per level +40%',
    icon: '🛡',
    maxLevel: 2,
    costs: [250, 500]
  },
  luckyStreak: {
    name: 'Lucky Streak',
    desc: '+8% chance of a bonus payout at the end of any run, per level',
    icon: '🍀',
    maxLevel: 3,
    costs: [180, 360, 640]
  },
  streakSaver: {
    name: 'Streak Saver',
    desc: 'Your daily streak survives one missed day',
    icon: '📅',
    maxLevel: 1,
    costs: [600]
  }
};

const DEFAULT_PERKS = { coinMagnet: 0, secondWind: 0, extraGuard: 0, insurance: 0, luckyStreak: 0, streakSaver: 0 };

// Cosmetic titles + emblems shown next to your name in chat and on the
// leaderboard. Purely decorative; some are bought, some are achievement locked.
const TITLES = {
  none:      { name: 'No Title',        cost: 0,    text: '' },
  rookie:    { name: 'Rookie',          cost: 50,   text: 'ROOKIE' },
  regular:   { name: 'Regular',         cost: 150,  text: 'REGULAR' },
  hotshot:   { name: 'Hotshot',         cost: 400,  text: 'HOTSHOT' },
  veteran:   { name: 'Veteran',         cost: 800,  text: 'VETERAN' },
  menace:    { name: 'Menace',          cost: 1200, text: 'MENACE' },
  legend:    { name: 'Legend',          cost: 2500, text: 'LEGEND' },
  keyholder: { name: 'Keyholder Prime', cost: 5000, text: 'KEYHOLDER PRIME' }
};

const EMBLEMS = {
  none:    { name: 'None',      cost: 0,    icon: '' },
  spade:   { name: 'Spade',     cost: 80,   icon: '♠' },
  bolt:    { name: 'Bolt',      cost: 120,  icon: '⚡' },
  skull:   { name: 'Skull',     cost: 200,  icon: '💀' },
  star:    { name: 'Star',      cost: 300,  icon: '⭐' },
  fire:    { name: 'Fire',      cost: 450,  icon: '🔥' },
  crown:   { name: 'Crown',     cost: 900,  icon: '👑' },
  diamond: { name: 'Diamond',   cost: 1500, icon: '💎' },
  galaxy:  { name: 'Galaxy',    cost: 3000, icon: '🌌' }
};

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
// Each one is a pure function of a player's record, so progress is recomputed
// from the stats we already store rather than tracked separately — that means
// they backfill correctly for players who earned them before this shipped.
const ACHIEVEMENTS = [
  { id:'first_blood',   name:'First Blood',      desc:'Win any versus match',                 reward:50,   icon:'🥊', goal:1,    value:d => totalVersusWins(d) },
  { id:'brawler',       name:'Brawler',          desc:'Win 10 versus matches',                reward:150,  icon:'🥋', goal:10,   value:d => totalVersusWins(d) },
  { id:'champion',      name:'Arena Champion',   desc:'Win 50 versus matches',                reward:600,  icon:'🏆', goal:50,   value:d => totalVersusWins(d) },
  { id:'sharpshooter',  name:'Sharpshooter',     desc:'Shoot 100 asteroids in one run',       reward:120,  icon:'🌠', goal:100,  value:d => d.asteroid.highScore },
  { id:'bricklayer',    name:'Bricklayer',       desc:'Break 200 bricks in one run',          reward:150,  icon:'🧱', goal:200,  value:d => d.breaker.highScore },
  { id:'hopper',        name:'Hopper',           desc:'Clear 50 obstacles in Hop Runner',     reward:120,  icon:'🏃', goal:50,   value:d => d.runner.highScore },
  { id:'stargazer',     name:'Stargazer',        desc:'Score 500 in Comet Dodge',             reward:150,  icon:'☄️', goal:500,  value:d => d.comet.highScore },
  { id:'delver',        name:'Delver',           desc:'Reach floor 5 in Crypt Crawler',       reward:120,  icon:'⚔️', goal:5,    value:d => d.roguelike.deepestFloor },
  { id:'deep_delver',   name:'Deep Delver',      desc:'Reach floor 15 in Crypt Crawler',      reward:500,  icon:'🗝', goal:15,   value:d => d.roguelike.deepestFloor },
  { id:'tunnel_rat',    name:'Tunnel Rat',       desc:'Score 10,000 in Hyper Tunnel',         reward:200,  icon:'🌀', goal:10000,value:d => d.tunnel.highScore },
  { id:'lightspeed',    name:'Lightspeed',       desc:'Score 50,000 in Hyper Tunnel',         reward:700,  icon:'💫', goal:50000,value:d => d.tunnel.highScore },
  { id:'survivor',      name:'Survivor',         desc:'Reach wave 5 in Neon Depths',          reward:200,  icon:'👁', goal:5,    value:d => d.depths.bestWave },
  { id:'exterminator',  name:'Exterminator',     desc:'Reach wave 12 in Neon Depths',         reward:700,  icon:'☣️', goal:12,   value:d => d.depths.bestWave },
  { id:'architect',     name:'Architect',        desc:'Stack 15 blocks in Sky Stack',         reward:200,  icon:'🏗', goal:15,   value:d => d.stack.bestHeight },
  { id:'skyscraper',    name:'Skyscraper',       desc:'Stack 30 blocks in Sky Stack',         reward:700,  icon:'🌆', goal:30,   value:d => d.stack.bestHeight },
  { id:'birdie',        name:'Birdie',           desc:'Sink 5 holes in Gravity Golf',         reward:200,  icon:'🪐', goal:5,    value:d => d.golf.bestHoles },
  { id:'tour_pro',      name:'Tour Pro',         desc:'Sink 15 holes in Gravity Golf',        reward:700,  icon:'⛳', goal:15,   value:d => d.golf.bestHoles },
  { id:'striker',       name:'Striker',          desc:'Score 25 goals in Street Soccer',      reward:200,  icon:'⚽', goal:25,   value:d => d.soccer.goals },
  { id:'keeper',        name:'Keeper',           desc:'Make 25 saves in Street Soccer',       reward:200,  icon:'🧤', goal:25,   value:d => d.soccer.saves },
  { id:'jack_of_all',   name:'Jack of All Games',desc:'Put a score on every cabinet',         reward:800,  icon:'🎰', goal:14,   value:d => cabinetsPlayed(d) },
  { id:'high_roller',   name:'High Roller',      desc:'Hold 5,000 tokens at once',            reward:400,  icon:'🪙', goal:5000, value:d => d.wallet.tokens },
  { id:'collector',     name:'Collector',        desc:'Own 5 themes',                         reward:300,  icon:'🎨', goal:5,    value:d => (d.wallet.owned || []).length },
  { id:'perked_up',     name:'Perked Up',        desc:'Buy 5 perk levels',                    reward:350,  icon:'🧪', goal:5,    value:d => perkLevels(d) },
  { id:'decorated',     name:'Decorated',        desc:'Unlock 10 achievements',               reward:500,  icon:'🎖', goal:10,   value:d => (d.achievements || []).length }
];

function totalVersusWins(d){
  return (d.soccer.wins||0) + (d.racing.wins||0) + (d.tank.wins||0) + (d.wildduel.wins||0) + (d.sumo.wins||0);
}
function cabinetsPlayed(d){
  return Object.keys(DEFAULT_STATS).filter(game => {
    const rec = d[game] || {};
    return Object.keys(DEFAULT_STATS[game]).some(k => (rec[k] || 0) > 0);
  }).length;
}
function perkLevels(d){
  const p = (d.wallet && d.wallet.perks) || {};
  return Object.keys(PERKS).reduce((n, id) => n + (p[id] || 0), 0);
}

// Recomputes every achievement against a player record, credits the reward for
// anything newly earned, and returns what was just unlocked so the client can
// pop a toast for it.
function evaluateAchievements(record){
  if (!Array.isArray(record.achievements)) record.achievements = [];
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (record.achievements.includes(a.id)) continue;
    let value = 0;
    try { value = a.value(record) || 0; } catch (e) { value = 0; }
    if (value >= a.goal) {
      record.achievements.push(a.id);
      record.wallet.tokens += a.reward;
      newly.push({ id: a.id, name: a.name, icon: a.icon, reward: a.reward });
    }
  }
  return newly;
}

function achievementProgress(record){
  return ACHIEVEMENTS.map(a => {
    let value = 0;
    try { value = a.value(record) || 0; } catch (e) { value = 0; }
    return {
      id: a.id, name: a.name, desc: a.desc, icon: a.icon,
      reward: a.reward, goal: a.goal,
      value: Math.min(value, a.goal),
      earned: (record.achievements || []).includes(a.id)
    };
  });
}

// ---------------------------------------------------------------------------
// Daily bonus + daily challenges
// ---------------------------------------------------------------------------
const DAILY_BASE = 100;
const DAILY_STREAK_BONUS = 25;   // per consecutive day, capped below
const DAILY_STREAK_CAP = 7;

function todayKey(){
  return new Date().toISOString().slice(0, 10);
}
function yesterdayKey(){
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Challenges are picked deterministically from the date, so everyone gets the
// same three each day without needing to store a generated set.
const CHALLENGE_POOL = [
  { id:'play3',      desc:'Finish 3 runs or matches today',        reward:120, goal:3,    track:'plays' },
  { id:'play6',      desc:'Finish 6 runs or matches today',        reward:220, goal:6,    track:'plays' },
  { id:'win1',       desc:'Win a versus match today',              reward:150, goal:1,    track:'wins' },
  { id:'win3',       desc:'Win 3 versus matches today',            reward:300, goal:3,    track:'wins' },
  { id:'earn200',    desc:'Earn 200 tokens today',                 reward:150, goal:200,  track:'earned' },
  { id:'earn500',    desc:'Earn 500 tokens today',                 reward:320, goal:500,  track:'earned' },
  { id:'try3',       desc:'Play 3 different cabinets today',       reward:200, goal:3,    track:'distinct' },
  { id:'try5',       desc:'Play 5 different cabinets today',       reward:380, goal:5,    track:'distinct' },
  { id:'chat',       desc:'Say something in the arcade chat',      reward:80,  goal:1,    track:'chats' },
  { id:'spin',       desc:'Spin the prize wheel once',             reward:100, goal:1,    track:'spins' }
];

function dailyChallengeIds(dateKey){
  // Cheap deterministic hash of the date -> three distinct pool entries.
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  const picked = [];
  let cursor = h;
  while (picked.length < 3) {
    cursor = (cursor * 1103515245 + 12345) >>> 0;
    const idx = cursor % CHALLENGE_POOL.length;
    if (!picked.includes(CHALLENGE_POOL[idx].id)) picked.push(CHALLENGE_POOL[idx].id);
  }
  return picked;
}

function freshDaily(){
  return { date: todayKey(), plays: 0, wins: 0, earned: 0, chats: 0, spins: 0, cabinets: [], claimed: [] };
}

// Rolls the per-day counters over when the date changes.
function currentDaily(record){
  if (!record.daily || record.daily.date !== todayKey()) record.daily = freshDaily();
  if (!Array.isArray(record.daily.cabinets)) record.daily.cabinets = [];
  if (!Array.isArray(record.daily.claimed)) record.daily.claimed = [];
  return record.daily;
}

function challengeState(record){
  const daily = currentDaily(record);
  return dailyChallengeIds(daily.date).map(id => {
    const c = CHALLENGE_POOL.find(x => x.id === id);
    const value = c.track === 'distinct' ? daily.cabinets.length : (daily[c.track] || 0);
    return {
      id: c.id, desc: c.desc, reward: c.reward, goal: c.goal,
      value: Math.min(value, c.goal),
      done: value >= c.goal,
      claimed: daily.claimed.includes(c.id)
    };
  });
}

// ---------------------------------------------------------------------------
// Prize wheel
// ---------------------------------------------------------------------------
const WHEEL_COST = 120;
const WHEEL_SLICES = [
  { label:'Bust',      tokens:0,   weight:16 },
  { label:'+40',       tokens:40,  weight:20 },
  { label:'+80',       tokens:80,  weight:18 },
  { label:'+120',      tokens:120, weight:16 },
  { label:'+200',      tokens:200, weight:12 },
  { label:'+320',      tokens:320, weight:9  },
  { label:'+500',      tokens:500, weight:6  },
  { label:'JACKPOT',   tokens:1200,weight:3  }
];

function spinWheel(){
  const total = WHEEL_SLICES.reduce((n, s) => n + s.weight, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < WHEEL_SLICES.length; i++) {
    roll -= WHEEL_SLICES[i].weight;
    if (roll <= 0) return i;
  }
  return WHEEL_SLICES.length - 1;
}

// ---------------------------------------------------------------------------
// Presence + activity feed (both in-memory — they're live state, not history)
// ---------------------------------------------------------------------------
const presence = new Map();      // username -> { where, at }
const PRESENCE_TTL_MS = 45 * 1000;
const activity = [];             // newest last
const ACTIVITY_MAX = 40;

function pushActivity(user, text, icon){
  activity.push({ id: activity.length ? activity[activity.length - 1].id + 1 : 1, user, text, icon: icon || '🎮', at: new Date().toISOString() });
  while (activity.length > ACTIVITY_MAX) activity.shift();
}

function livePresence(){
  const now = Date.now();
  const out = [];
  for (const [user, rec] of presence) {
    if (now - rec.at > PRESENCE_TTL_MS) { presence.delete(user); continue; }
    out.push({ user, where: rec.where });
  }
  return out;
}

// Password required to edit the Update Log through the secret admin panel.
// Override by setting ADMIN_PASSWORD in the environment before starting the server.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN_123';
const DEFAULT_UPDATELOG = `=== LEVEL 7 UPDATE LOG ===

[2026-07-30] BIG UPDATE — the arcade is no longer just a game library.

  PERKS — a new Perks tab in the shop. Bought with coins, they apply account-wide in every cabinet:
    • Coin Magnet — +15% tokens from everything you play, per level
    • Second Wind — a free revive per solo run, per level
    • Extra Guard — +1 starting life in Asteroid Blaster and Neon Breaker, +1 shield in Hyper Tunnel
    • Insurance — losing a versus match still pays out like a win
    • Lucky Streak — a chance of a bonus payout at the end of any run
    • Streak Saver — your daily streak survives one missed day

  DAILY BONUS — claim coins once a day; the payout climbs with your streak.
  DAILY CHALLENGES — three rotating objectives every day, each worth coins. Everyone gets the same three.
  ACHIEVEMENTS — 24 of them, each paying coins. They backfill, so anything you'd already done is credited the first time you look.
  PROFILE — your emblem, title, cabinet bests, day streak and last 25 runs in one place.
  TITLES & EMBLEMS — two more shop tabs. Both show next to your name in chat and on every leaderboard.
  PRIZE WHEEL — spend 120 coins for a spin. The slice is picked server-side, so nobody can rig it. Jackpot pays 1200.

  WHO'S ONLINE — the chat dock now shows who else is in the arcade and which cabinet they're on.
  LIVE TICKER — recent results scroll across the top of the dashboard.
  CHAT — @mentions highlight (and toast you when it's your name), and "/me does a thing" renders as an action line.

  VISUALS — a new shared effects layer runs in all 14 cabinets: particle bursts, shockwave rings, floating score text, screen shake and hit-stop. Goals, tank hits, shattered asteroids, broken bricks and crypt kills all land properly now.
  Plus an animated starfield behind the whole site, a CRT wipe between screens, and toast notifications for coins, unlocks and achievements. All of it can be switched off in Settings.

[2026-07-30] ARCADE CHAT — there's now a live chat room docked in the corner of every screen. Everyone signed in shares it, messages arrive within a few seconds, and it remembers whether you had it open. Minimise it and a badge counts anything you missed.

[2026-07-30] FIVE NEW CABINETS, THREE OF THEM IN 3D:
  • HYPER TUNNEL (3D) — roll around a real perspective-projected tunnel, thread the gap in each barrier ring and burn boost for score. Energy cells refill your boost and stack a multiplier. 3 shields, three speed classes.
  • NEON DEPTHS (3D) — a first-person raycast shooter. Each wave generates a fresh maze full of hunters; clear it to heal and reload. Drones rush you, sentinels hold back and shoot. Minimap in the corner, 12-round mag, R to reload.
  • SKY STACK (3D) — stack a tower block by block with the camera climbing and orbiting as you go. Overhang gets sliced off; centre a drop for a PERFECT and win width back.
  • GRAVITY GOLF — orbital mini-golf. Slingshot around planets, dodge repulsors and burning stars, sink the wormhole. Beat par and you bank the spare shots.
  • NEON SUMO — 1v1 shoving match on a shrinking disc. Dash costs stamina, power pads make your hit heavier, first to 3 ring-outs wins. Bot with 3 difficulties or local multiplayer.

[2026-07-30] DASHBOARD — cabinets now carry SOLO / 1v1 / 3D / NEW tags, filter chips to narrow the grid, a "Surprise Me" roll, and your personal best printed on each card.
[2026-07-30] LEADERBOARD — added the missing Crypt Crawler board plus boards for all five new cabinets, and a new ARCADE CHAMPION table that scores 3/2/1 points for every cabinet's top three.
[2026-07-30] SOUND — the whole arcade now has procedural sound effects (no audio files, all synthesised). Mute from the topbar, or open the new ⚙ Settings panel to toggle sound, CRT scanlines and screen shake.
[2026-07-30] FIXED — pausing (ESC / ⏸) never worked in Crypt Crawler; it does now. Typing in a text field no longer leaks keypresses into a running game.

[2026-07-31] SHOP — added Zip, the most expensive theme yet (3000 tokens). Equip it and a trash-talking commentary box shows up after every match or run, reacting to how you did. Purely cosmetic — no gameplay effect.

[2026-07-30] COMET DODGE added to the arcade — a solo survival dodger. Steer your ship with A/D (or arrow keys) through a falling comet field; every second alive adds to your score, and the field speeds up the longer you last. Leaderboard tracks your best run; tokens earned for every comet you dodge.

[2026-07-29] CRYPT CRAWLER content update — boss floors now show a health bar, added a minimap, elite enemies (gold outline, tougher, better drops), two new enemy types (Bat, Brute), rare loot and equipment rune pickups, and a 4th permanent upgrade: Swift Boots (+10% move speed per level).

[2026-07-28] SECURITY — accounts now log in through the server instead of the page checking a plaintext password list. Passwords are hashed, repeated failed logins lock an account out temporarily, requests are rate-limited per IP, and admin actions are logged. Added score/floor sanity checks so a tampered client can't hand itself an impossible result.

[2026-07-24] CRYPT CRAWLER added to the arcade — a top-down roguelike. Fight with sword and magic, explore a randomized room every floor, grab loot, and watch out for a boss every 5th floor. Permanent token upgrades available (Extra HP, Sharper Blade, Arcane Power). Leaderboard tracks your deepest floor reached.
[2026-07-24] SHOP — themes now restyle the whole site (backgrounds and panels too), not just the accent colors.

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

async function loadUpdateLog() {
  try {
    const { rows } = await pool.query('SELECT content FROM updatelog WHERE id = 1');
    if (rows.length > 0) return rows[0].content;
  } catch (e) {
    console.error('Failed to read update log from DB, using default:', e);
  }
  return DEFAULT_UPDATELOG;
}

async function saveUpdateLog(content) {
  await pool.query(
    `INSERT INTO updatelog (id, content) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content`,
    [content]
  );
}

// ---------------------------------------------------------------------------
// Site-wide broadcast banner — a short admin message shown to every player.
// Empty content means "no active broadcast".
// ---------------------------------------------------------------------------
async function loadBroadcast() {
  try {
    const { rows } = await pool.query('SELECT content, updated_at FROM broadcast WHERE id = 1');
    if (rows.length > 0) return { content: rows[0].content, updatedAt: rows[0].updated_at };
  } catch (e) {
    console.error('Failed to read broadcast from DB:', e);
  }
  return { content: '', updatedAt: null };
}

async function saveBroadcast(content) {
  await pool.query(
    `INSERT INTO broadcast (id, content, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [content]
  );
}

// ---------------------------------------------------------------------------
// Emergency lockdown — in-memory, same lifetime as sessions (a restart
// clears it). While enabled, every mutating gameplay endpoint (including
// login) is blocked with a 503; admin endpoints stay reachable so an admin
// can turn it back off. Read-only GETs (leaderboard, update log, broadcast)
// keep working so people can still see what's going on.
// ---------------------------------------------------------------------------
let LOCKDOWN = false;

function freshUserRecord() {
  const rec = JSON.parse(JSON.stringify(DEFAULT_STATS));
  rec.wallet = JSON.parse(JSON.stringify(DEFAULT_WALLET));
  rec.banned = false;
  rec.achievements = [];
  rec.daily = freshDaily();
  rec.streak = { count: 0, lastClaim: '' };
  rec.history = [];
  return rec;
}

async function loadData() {
  let data = {};
  try {
    const { rows } = await pool.query('SELECT user_id, data FROM players');
    rows.forEach(row => { data[row.user_id] = row.data; });
  } catch (e) {
    console.error('Failed to load players from DB, starting fresh:', e);
    data = {};
  }
  // Make sure every known user has a complete record, filling in any
  // missing games/stats (handy if you add a new game later).
  USERS.forEach(u => {
    if (!data[u]) data[u] = freshUserRecord();
    if (typeof data[u].banned !== 'boolean') data[u].banned = false;
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
      if (!w.roguelikeUpgrades || typeof w.roguelikeUpgrades !== 'object') {
        w.roguelikeUpgrades = { extraHp: 0, swordDamage: 0, magicPower: 0, swiftBoots: 0 };
      } else {
        Object.keys(ROGUELIKE_UPGRADES).forEach(id => {
          if (typeof w.roguelikeUpgrades[id] !== 'number') w.roguelikeUpgrades[id] = 0;
        });
      }
      // Perks and cosmetics were added later — backfill them the same way.
      if (!w.perks || typeof w.perks !== 'object') w.perks = Object.assign({}, DEFAULT_PERKS);
      Object.keys(PERKS).forEach(id => {
        if (typeof w.perks[id] !== 'number') w.perks[id] = 0;
      });
      if (!Array.isArray(w.titles)) w.titles = ['none'];
      if (!w.titles.includes('none')) w.titles.push('none');
      if (!w.title || !w.titles.includes(w.title)) w.title = 'none';
      if (!Array.isArray(w.emblems)) w.emblems = ['none'];
      if (!w.emblems.includes('none')) w.emblems.push('none');
      if (!w.emblem || !w.emblems.includes(w.emblem)) w.emblem = 'none';
    }
    // Progression fields, same backfill idea.
    if (!Array.isArray(data[u].achievements)) data[u].achievements = [];
    if (!data[u].daily || typeof data[u].daily !== 'object') data[u].daily = freshDaily();
    if (!data[u].streak || typeof data[u].streak !== 'object') data[u].streak = { count: 0, lastClaim: '' };
    if (!Array.isArray(data[u].history)) data[u].history = [];
  });
  return data;
}

async function saveData(data) {
  // Upsert every user record in one transaction, so a crash mid-write
  // can't leave the table half-updated.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const userId of Object.keys(data)) {
      await client.query(
        `INSERT INTO players (user_id, data) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`,
        [userId, JSON.stringify(data[userId])]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Creates the two tables on first run (no-op if they already exist) and
// seeds the update log with its default text the very first time.
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      user_id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS updatelog (
      id INTEGER PRIMARY KEY DEFAULT 1,
      content TEXT NOT NULL,
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);
  const { rows } = await pool.query('SELECT id FROM updatelog WHERE id = 1');
  if (rows.length === 0) {
    await pool.query('INSERT INTO updatelog (id, content) VALUES (1, $1)', [DEFAULT_UPDATELOG]);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS broadcast (
      id INTEGER PRIMARY KEY DEFAULT 1,
      content TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT single_row_broadcast CHECK (id = 1)
    )
  `);
  const bRows = await pool.query('SELECT id FROM broadcast WHERE id = 1');
  if (bRows.rows.length === 0) {
    await pool.query('INSERT INTO broadcast (id, content) VALUES (1, $1)', ['']);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS chat_id_idx ON chat (id DESC)');
}

async function logAdminAction(action, details){
  try{
    await pool.query(
      'INSERT INTO admin_log (action, details) VALUES ($1, $2::jsonb)',
      [action, JSON.stringify(details || {})]
    );
  }catch(e){
    console.error('Failed to write admin log:', e);
  }
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// General IP rate limit across the whole API — generous, just a backstop
// against runaway clients or scripted abuse. /api/login has its own
// stricter limit below.
app.use('/api/', (req, res, next) => {
  if (isRateLimited(clientIp(req), 180, 60 * 1000)) {
    return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
  }
  next();
});

// Emergency lockdown gate — blocks every mutating request except the admin
// tools themselves (so an admin can always turn it back off).
app.use('/api/', (req, res, next) => {
  if (LOCKDOWN && req.method === 'POST' && !req.path.startsWith('/admin/')) {
    return res.status(503).json({ error: 'Site is temporarily locked down for maintenance. Try again shortly.' });
  }
  next();
});

app.post('/api/login', async (req, res) => {
  const ip = clientIp(req);
  if (isRateLimited(ip, 10, 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts from this network. Try again in a minute.' });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  const locked = lockoutRemainingMs(username);
  if (locked > 0) {
    return res.status(423).json({ error: `Too many failed attempts. Try again in ${Math.ceil(locked / 60000)} minute(s).` });
  }
  if (!USERS.includes(username) || !verifyPassword(username, password)) {
    recordFailedLogin(username);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const data = await loadData();
  if (data[username] && data[username].banned) {
    return res.status(403).json({ error: 'This account has been banned.' });
  }
  clearLoginAttempts(username);
  const token = createSession(username);
  res.json({ token, username });
});

// Serve the game itself from this same server, so "npm start" + one URL
// is all you need — no separate static host, no editing LB_API_BASE.
// (Only this one file is exposed; server.js/package.json/leaderboard.json
// are not served.)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'level7_12.html'));
});

app.get('/api/leaderboard', async (req, res) => {
  res.json(await loadData());
});

app.post('/api/leaderboard/update', async (req, res) => {
  const { user, game, ops } = req.body || {};

  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (!DEFAULT_STATS[game]) {
    return res.status(400).json({ error: 'Unknown game' });
  }
  if (!Array.isArray(ops)) {
    return res.status(400).json({ error: 'ops must be an array' });
  }
  flagIfSuspicious(user, 'leaderboard/update');

  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const record = data[user][game];
      const ceilings = STAT_CEILINGS[game] || {};

      for (const op of ops) {
        const { stat, type, value } = op;
        if (!(stat in record)) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;

        if (type === 'increment') {
          const safeValue = clampNumber(value, -MAX_INCREMENT_PER_CALL, MAX_INCREMENT_PER_CALL);
          record[stat] += safeValue;
        } else if (type === 'increment_if') {
          if (op.cond) {
            const safeValue = clampNumber(value, -MAX_INCREMENT_PER_CALL, MAX_INCREMENT_PER_CALL);
            record[stat] += safeValue;
          }
        } else if (type === 'max') {
          let safeValue = value;
          // A "max" op on deepestFloor can only ever move the record up by
          // one floor per call — a run can't legitimately jump from floor 3
          // to floor 80 in a single update.
          if (game === 'roguelike' && stat === 'deepestFloor') {
            safeValue = Math.min(safeValue, record[stat] + 1);
          }
          if (typeof ceilings[stat] === 'number') {
            safeValue = Math.min(safeValue, ceilings[stat]);
          }
          record[stat] = Math.max(record[stat], safeValue);
        }
      }

      await saveData(data);
      return data;
    });

    res.json(updated);
  } catch (e) {
    console.error('Update failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/updatelog', async (req, res) => {
  res.json({ content: await loadUpdateLog() });
});

app.get('/api/broadcast', async (req, res) => {
  res.json(await loadBroadcast());
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
    const updated = await withWriteLock(async () => {
      await saveUpdateLog(content);
      return content;
    });
    logAdminAction('updatelog_edit', { contentLength: content.length });
    res.json({ content: updated });
  } catch (e) {
    console.error('Update log save failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Arcade chat
// ---------------------------------------------------------------------------
// One shared room for all keyholders. Messages live in their own table rather
// than in the player records, so posting a message never touches (or locks)
// leaderboard data. The client polls with `since` so a busy room doesn't mean
// re-downloading the whole history every few seconds.
const CHAT_MAX_LEN = 300;
const CHAT_BACKLOG = 120;     // how much history a fresh client gets
const CHAT_KEEP_ROWS = 600;   // older messages are trimmed away
const CHAT_MIN_GAP_MS = 800;  // fastest one account may post
const CHAT_BURST_LIMIT = 12;  // messages per 30s window, per account
const chatActivity = new Map(); // username -> { last, stamps: [] }

function chatSpamCheck(username){
  const now = Date.now();
  const rec = chatActivity.get(username) || { last: 0, stamps: [] };
  if (now - rec.last < CHAT_MIN_GAP_MS) {
    return 'You are sending messages too fast.';
  }
  rec.stamps = rec.stamps.filter(t => now - t < 30 * 1000);
  if (rec.stamps.length >= CHAT_BURST_LIMIT) {
    return 'Too many messages — give the room a moment.';
  }
  rec.last = now;
  rec.stamps.push(now);
  chatActivity.set(username, rec);
  return null;
}

function chatRowToMessage(row) {
  return { id: Number(row.id), user: row.username, text: row.body, at: row.created_at };
}

async function loadChatSince(since) {
  if (since > 0) {
    const { rows } = await pool.query(
      'SELECT id, username, body, created_at FROM chat WHERE id > $1 ORDER BY id ASC LIMIT 200',
      [since]
    );
    return rows.map(chatRowToMessage);
  }
  const { rows } = await pool.query(
    'SELECT id, username, body, created_at FROM chat ORDER BY id DESC LIMIT $1',
    [CHAT_BACKLOG]
  );
  return rows.reverse().map(chatRowToMessage);
}

app.get('/api/chat', async (req, res) => {
  const user = authenticate(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated. Please log in again.' });
  }
  const since = Math.max(0, parseInt(req.query.since, 10) || 0);
  try {
    res.json({ messages: await loadChatSince(since) });
  } catch (e) {
    console.error('Chat load failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { user, text, since } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'text must be a string' });
  }
  // Collapse runs of blank lines so nobody can shove the room off-screen.
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, CHAT_MAX_LEN);
  if (!clean) {
    return res.status(400).json({ error: 'Message is empty.' });
  }
  const spam = chatSpamCheck(user);
  if (spam) {
    return res.status(429).json({ error: spam });
  }
  flagIfSuspicious(user, 'chat/post');

  try {
    const inserted = await pool.query(
      'INSERT INTO chat (username, body) VALUES ($1, $2) RETURNING id, username, body, created_at',
      [user, clean]
    );
    // Opportunistic trim — cheap, and keeps the table from growing forever.
    if (Number(inserted.rows[0].id) % 25 === 0) {
      await pool.query(
        'DELETE FROM chat WHERE id <= (SELECT id FROM chat ORDER BY id DESC OFFSET $1 LIMIT 1)',
        [CHAT_KEEP_ROWS]
      ).catch(() => {});
    }
    // Counts toward the "say something in chat" daily challenge.
    withWriteLock(async () => {
      const data = await loadData();
      currentDaily(data[user]).chats++;
      await saveData(data);
    }).catch(() => {});

    const from = Math.max(0, parseInt(since, 10) || 0);
    const messages = from > 0
      ? await loadChatSince(from)
      : [chatRowToMessage(inserted.rows[0])];
    res.json({ messages });
  } catch (e) {
    console.error('Chat post failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Wallet + Shop endpoints
// ---------------------------------------------------------------------------
app.get('/api/wallet', async (req, res) => {
  const user = req.query.user;
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const data = await loadData();
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
  if (!requireOwnUser(req, res, user)) return;
  if (!(reason in REWARDS)) {
    return res.status(400).json({ error: 'Unknown reason' });
  }
  flagIfSuspicious(user, 'wallet/earn:' + reason);
  const cap = REASON_QTY_CAPS[reason] ?? 500;
  const safeQty = Math.max(0, Math.min(cap, Number(qty) || 0));
  const base = Math.round(REWARDS[reason] * safeQty);

  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const record = data[user];
      // The Coin Magnet perk is applied here, server-side, so the payout can
      // never be inflated by a client claiming a perk level it doesn't own.
      const magnet = 1 + 0.15 * (record.wallet.perks.coinMagnet || 0);
      // Insurance turns a losing payout into something closer to a win.
      const isLoss = /_loss$/.test(reason);
      const insurance = isLoss ? (1 + 0.4 * (record.wallet.perks.insurance || 0)) : 1;
      const amount = Math.round(base * magnet * insurance);

      record.wallet.tokens += amount;
      const daily = currentDaily(record);
      daily.earned += amount;
      const unlocked = evaluateAchievements(record);
      await saveData(data);
      return { wallet: record.wallet, earned: amount, achievements: unlocked };
    });
    // Old clients read the wallet fields straight off the response body, so
    // keep those at the top level and hang the new bits alongside them.
    res.json(Object.assign({}, updated.wallet, { earnedAmount: updated.earned, newAchievements: updated.achievements }));
  } catch (e) {
    console.error('Earn failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Run completion — one call at the end of a run or match
// ---------------------------------------------------------------------------
// Kept separate from /leaderboard/update because several cabinets post stats
// more than once per run (Neon Depths posts every wave). This fires exactly
// once, so daily counters and the activity feed stay honest.
app.post('/api/run/complete', async (req, res) => {
  const { user, game, result, summary } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  if (!DEFAULT_STATS[game]) return res.status(400).json({ error: 'Unknown game' });
  flagIfSuspicious(user, 'run/complete');

  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const record = data[user];
      const daily = currentDaily(record);
      daily.plays++;
      if (result === 'win') daily.wins++;
      if (!daily.cabinets.includes(game)) daily.cabinets.push(game);

      record.history.unshift({
        game,
        result: result === 'win' ? 'win' : (result === 'loss' ? 'loss' : 'run'),
        summary: typeof summary === 'string' ? summary.slice(0, 120) : '',
        at: new Date().toISOString()
      });
      record.history = record.history.slice(0, 25);

      // Lucky Streak: a small chance of a bonus payout at the end of a run.
      let bonus = 0;
      const luck = 0.08 * (record.wallet.perks.luckyStreak || 0);
      if (luck > 0 && Math.random() < luck) {
        bonus = 50 + Math.floor(Math.random() * 150);
        record.wallet.tokens += bonus;
      }

      const unlocked = evaluateAchievements(record);
      await saveData(data);
      return { wallet: record.wallet, bonus, achievements: unlocked, challenges: challengeState(record) };
    });

    if (typeof summary === 'string' && summary) {
      pushActivity(user, summary.slice(0, 120), result === 'win' ? '🏆' : '🎮');
    }
    res.json(out);
  } catch (e) {
    console.error('Run complete failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Perks
// ---------------------------------------------------------------------------
app.get('/api/perks', (req, res) => res.json(PERKS));

app.post('/api/perks/purchase', async (req, res) => {
  const { user, perkId } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const result = purchaseLeveledUpgrade(data[user].wallet, PERKS, 'perks', perkId);
      if (result.error) return result;
      const unlocked = evaluateAchievements(data[user]);
      await saveData(data);
      return { wallet: data[user].wallet, achievements: unlocked };
    });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(Object.assign({}, out.wallet, { newAchievements: out.achievements }));
  } catch (e) {
    console.error('Perk purchase failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Cosmetics (titles + emblems)
// ---------------------------------------------------------------------------
app.get('/api/cosmetics', (req, res) => res.json({ titles: TITLES, emblems: EMBLEMS }));

function cosmeticTables(kind){
  if (kind === 'title') return { catalog: TITLES, owned: 'titles', equipped: 'title' };
  if (kind === 'emblem') return { catalog: EMBLEMS, owned: 'emblems', equipped: 'emblem' };
  return null;
}

app.post('/api/cosmetics/purchase', async (req, res) => {
  const { user, kind, id } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const t = cosmeticTables(kind);
  if (!t || !t.catalog[id]) return res.status(400).json({ error: 'Unknown item' });
  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const w = data[user].wallet;
      if (!Array.isArray(w[t.owned])) w[t.owned] = ['none'];
      if (w[t.owned].includes(id)) return { error: 'Already owned' };
      const cost = t.catalog[id].cost;
      if (w.tokens < cost) return { error: 'Not enough tokens' };
      w.tokens -= cost;
      w[t.owned].push(id);
      w[t.equipped] = id;
      await saveData(data);
      return { wallet: w };
    });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out.wallet);
  } catch (e) {
    console.error('Cosmetic purchase failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/cosmetics/equip', async (req, res) => {
  const { user, kind, id } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const t = cosmeticTables(kind);
  if (!t || !t.catalog[id]) return res.status(400).json({ error: 'Unknown item' });
  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const w = data[user].wallet;
      if (!w[t.owned].includes(id)) return { error: 'You do not own that' };
      w[t.equipped] = id;
      await saveData(data);
      return { wallet: w };
    });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out.wallet);
  } catch (e) {
    console.error('Cosmetic equip failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Achievements / daily / profile
// ---------------------------------------------------------------------------
app.get('/api/achievements', async (req, res) => {
  const user = req.query.user;
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  const data = await loadData();
  res.json({ achievements: achievementProgress(data[user]) });
});

app.get('/api/daily', async (req, res) => {
  const user = req.query.user;
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  const data = await loadData();
  const record = data[user];
  const streak = record.streak || { count: 0, lastClaim: '' };
  res.json({
    canClaim: streak.lastClaim !== todayKey(),
    streak: streak.count || 0,
    nextReward: DAILY_BASE + DAILY_STREAK_BONUS * Math.min(DAILY_STREAK_CAP, streak.lastClaim === yesterdayKey() ? (streak.count || 0) : 0),
    challenges: challengeState(record)
  });
});

app.post('/api/daily/claim', async (req, res) => {
  const { user } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const record = data[user];
      const streak = record.streak || (record.streak = { count: 0, lastClaim: '' });
      if (streak.lastClaim === todayKey()) return { error: 'Already claimed today' };
      // Missing a day resets the run; claiming yesterday extends it. The
      // Streak Saver perk forgives exactly one missed day.
      const saver = (record.wallet.perks.streakSaver || 0) > 0;
      const gapDate = new Date();
      gapDate.setUTCDate(gapDate.getUTCDate() - 2);
      const twoDaysAgo = gapDate.toISOString().slice(0, 10);
      const continues = streak.lastClaim === yesterdayKey() || (saver && streak.lastClaim === twoDaysAgo);
      streak.count = continues ? (streak.count || 0) + 1 : 1;
      streak.lastClaim = todayKey();
      const reward = DAILY_BASE + DAILY_STREAK_BONUS * Math.min(DAILY_STREAK_CAP, streak.count - 1);
      record.wallet.tokens += reward;
      currentDaily(record).earned += reward;
      const unlocked = evaluateAchievements(record);
      await saveData(data);
      return { wallet: record.wallet, reward, streak: streak.count, achievements: unlocked };
    });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    console.error('Daily claim failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/daily/challenge/claim', async (req, res) => {
  const { user, id } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const record = data[user];
      const state = challengeState(record).find(c => c.id === id);
      if (!state) return { error: 'Not one of today\'s challenges' };
      if (state.claimed) return { error: 'Already claimed' };
      if (!state.done) return { error: 'Not finished yet' };
      const daily = currentDaily(record);
      daily.claimed.push(id);
      record.wallet.tokens += state.reward;
      daily.earned += state.reward;
      const unlocked = evaluateAchievements(record);
      await saveData(data);
      return { wallet: record.wallet, reward: state.reward, challenges: challengeState(record), achievements: unlocked };
    });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    console.error('Challenge claim failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/profile', async (req, res) => {
  const user = req.query.user;
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  const data = await loadData();
  const record = data[user];
  const progress = achievementProgress(record);
  res.json({
    user,
    stats: Object.fromEntries(Object.keys(DEFAULT_STATS).map(g => [g, record[g]])),
    wallet: record.wallet,
    history: record.history || [],
    streak: record.streak || { count: 0 },
    achievementsEarned: progress.filter(a => a.earned).length,
    achievementsTotal: progress.length,
    versusWins: totalVersusWins(record),
    cabinetsPlayed: cabinetsPlayed(record),
    title: (TITLES[record.wallet.title] || TITLES.none).text,
    emblem: (EMBLEMS[record.wallet.emblem] || EMBLEMS.none).icon
  });
});

// ---------------------------------------------------------------------------
// Prize wheel
// ---------------------------------------------------------------------------
app.get('/api/wheel', (req, res) => res.json({ cost: WHEEL_COST, slices: WHEEL_SLICES.map(s => ({ label: s.label, tokens: s.tokens })) }));

app.post('/api/wheel/spin', async (req, res) => {
  const { user } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  flagIfSuspicious(user, 'wheel/spin');
  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const record = data[user];
      if (record.wallet.tokens < WHEEL_COST) return { error: 'Not enough tokens' };
      record.wallet.tokens -= WHEEL_COST;
      // The winning slice is picked here, never by the client.
      const index = spinWheel();
      const slice = WHEEL_SLICES[index];
      record.wallet.tokens += slice.tokens;
      const daily = currentDaily(record);
      daily.spins++;
      if (slice.tokens > 0) daily.earned += slice.tokens;
      const unlocked = evaluateAchievements(record);
      await saveData(data);
      return { wallet: record.wallet, index, slice: { label: slice.label, tokens: slice.tokens }, achievements: unlocked };
    });
    if (out.error) return res.status(400).json({ error: out.error });
    if (out.slice.tokens >= 500) pushActivity(user, `hit ${out.slice.label} on the prize wheel`, '🎡');
    res.json(out);
  } catch (e) {
    console.error('Wheel spin failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Presence + activity feed
// ---------------------------------------------------------------------------
app.post('/api/presence', (req, res) => {
  const { user, where } = req.body || {};
  const authed = authenticate(req);
  if (!authed || authed !== user) return res.status(401).json({ error: 'Not authenticated' });
  presence.set(user, { where: typeof where === 'string' ? where.slice(0, 40) : 'the arcade', at: Date.now() });
  res.json({ online: livePresence() });
});

app.get('/api/presence', (req, res) => {
  if (!authenticate(req)) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ online: livePresence() });
});

app.get('/api/activity', (req, res) => {
  if (!authenticate(req)) return res.status(401).json({ error: 'Not authenticated' });
  const since = Math.max(0, parseInt(req.query.since, 10) || 0);
  res.json({ events: activity.filter(a => a.id > since) });
});

app.post('/api/shop/purchase', async (req, res) => {
  const { user, itemId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (!SHOP_ITEMS[itemId]) {
    return res.status(400).json({ error: 'Unknown item' });
  }
  flagIfSuspicious(user, 'shop/purchase');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
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
      await saveData(data);
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
  if (!requireOwnUser(req, res, user)) return;
  const upgrade = ASTEROID_UPGRADES[upgradeId];
  if (!upgrade) {
    return res.status(400).json({ error: 'Unknown upgrade' });
  }
  flagIfSuspicious(user, 'asteroid/upgrades/purchase');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      const outcome = purchaseLeveledUpgrade(wallet, ASTEROID_UPGRADES, 'asteroidUpgrades', upgradeId);
      if (outcome.error) return outcome;
      await saveData(data);
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
  if (!requireOwnUser(req, res, user)) return;
  if (!WILDDUEL_UPGRADES[upgradeId]) {
    return res.status(400).json({ error: 'Unknown upgrade' });
  }
  flagIfSuspicious(user, 'wildduel/upgrades/purchase');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      const outcome = purchaseLeveledUpgrade(wallet, WILDDUEL_UPGRADES, 'wildduelUpgrades', upgradeId);
      if (outcome.error) return outcome;
      await saveData(data);
      return outcome;
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Wild Duel upgrade purchase failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/roguelike/upgrades', (req, res) => {
  res.json(ROGUELIKE_UPGRADES);
});

app.post('/api/roguelike/upgrades/purchase', async (req, res) => {
  const { user, upgradeId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (!ROGUELIKE_UPGRADES[upgradeId]) {
    return res.status(400).json({ error: 'Unknown upgrade' });
  }
  flagIfSuspicious(user, 'roguelike/upgrades/purchase');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      const outcome = purchaseLeveledUpgrade(wallet, ROGUELIKE_UPGRADES, 'roguelikeUpgrades', upgradeId);
      if (outcome.error) return outcome;
      await saveData(data);
      return outcome;
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Crypt Crawler upgrade purchase failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/wallet/equip', async (req, res) => {
  const { user, itemId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (!wallet.owned.includes(itemId)) {
        return { error: 'Not owned' };
      }
      wallet.equipped = itemId;
      await saveData(data);
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
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      data[user].wallet.tokens = Math.max(0, data[user].wallet.tokens + amt);
      await saveData(data);
      return data[user].wallet;
    });
    logAdminAction('grant_coins', { user, amount: amt, newBalance: updated.tokens });
    res.json(updated);
  } catch (e) {
    console.error('Admin grant coins failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: view the most recent admin actions and suspicious-activity
// flags. Same password gate as the other admin tools.
app.post('/api/admin/logs', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT action, details, created_at FROM admin_log ORDER BY created_at DESC LIMIT 200'
    );
    res.json({ logs: rows });
  } catch (e) {
    console.error('Fetch admin logs failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: set a user's token balance to an exact amount (as opposed to
// grant-coins, which adjusts it by a delta).
app.post('/api/admin/set-coins', async (req, res) => {
  const { password, user, amount } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({ error: 'Amount must be a non-negative number' });
  }
  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      data[user].wallet.tokens = amt;
      await saveData(data);
      return data[user].wallet;
    });
    logAdminAction('set_coins', { user, amount: amt });
    res.json(updated);
  } catch (e) {
    console.error('Admin set coins failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: reset a user's stats, wallet, or both back to defaults.
app.post('/api/admin/reset-player', async (req, res) => {
  const { password, user, scope } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!['stats', 'wallet', 'all'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be stats, wallet, or all' });
  }
  try {
    await withWriteLock(async () => {
      const data = await loadData();
      const fresh = freshUserRecord();
      const banned = data[user].banned; // a stats/wallet reset shouldn't lift a ban
      if (scope === 'stats' || scope === 'all') {
        Object.keys(DEFAULT_STATS).forEach(game => { data[user][game] = fresh[game]; });
        data[user].achievements = [];
        data[user].history = [];
      }
      if (scope === 'wallet' || scope === 'all') {
        data[user].wallet = fresh.wallet;
      }
      if (scope === 'all') {
        data[user].banned = banned;
        data[user].daily = freshDaily();
        data[user].streak = { count: 0, lastClaim: '' };
      }
      await saveData(data);
    });
    logAdminAction('reset_player', { user, scope });
    res.json({ ok: true });
  } catch (e) {
    console.error('Admin reset player failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: max out every per-game upgrade track for a user in one click.
const UPGRADE_CATALOGS = {
  asteroidUpgrades: ASTEROID_UPGRADES,
  wildduelUpgrades: WILDDUEL_UPGRADES,
  roguelikeUpgrades: ROGUELIKE_UPGRADES,
  perks: PERKS
};
app.post('/api/admin/max-upgrades', async (req, res) => {
  const { password, user } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      Object.entries(UPGRADE_CATALOGS).forEach(([walletKey, catalog]) => {
        Object.entries(catalog).forEach(([id, up]) => {
          wallet[walletKey][id] = up.maxLevel;
        });
      });
      await saveData(data);
      return wallet;
    });
    logAdminAction('max_upgrades', { user });
    res.json(updated);
  } catch (e) {
    console.error('Admin max upgrades failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: unlock every shop theme for a user without charging tokens.
app.post('/api/admin/unlock-themes', async (req, res) => {
  const { password, user } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      wallet.owned = Object.keys(SHOP_ITEMS);
      await saveData(data);
      return wallet;
    });
    logAdminAction('unlock_themes', { user });
    res.json(updated);
  } catch (e) {
    console.error('Admin unlock themes failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: directly set a user's deepest Crypt Crawler floor (for testing
// or fixing a bugged run) — still bounded by the same ceiling as normal play.
app.post('/api/admin/set-floor', async (req, res) => {
  const { password, user, floor } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const f = Math.round(Number(floor));
  if (!Number.isFinite(f) || f < 0) {
    return res.status(400).json({ error: 'floor must be a non-negative number' });
  }
  const ceiling = (STAT_CEILINGS.roguelike && STAT_CEILINGS.roguelike.deepestFloor) || 500;
  const safeFloor = Math.min(f, ceiling);
  try {
    await withWriteLock(async () => {
      const data = await loadData();
      data[user].roguelike.deepestFloor = safeFloor;
      await saveData(data);
    });
    logAdminAction('set_floor', { user, floor: safeFloor });
    res.json({ deepestFloor: safeFloor });
  } catch (e) {
    console.error('Admin set floor failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: reset one game's leaderboard (or every game's) back to zero
// for every user. Wallets and upgrades are untouched.
app.post('/api/admin/reset-leaderboard', async (req, res) => {
  const { password, scope } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  const games = scope === 'all' ? Object.keys(DEFAULT_STATS) : [scope];
  if (scope !== 'all' && !DEFAULT_STATS[scope]) {
    return res.status(400).json({ error: 'Unknown game' });
  }
  try {
    await withWriteLock(async () => {
      const data = await loadData();
      USERS.forEach(u => {
        games.forEach(game => {
          data[u][game] = JSON.parse(JSON.stringify(DEFAULT_STATS[game]));
        });
      });
      await saveData(data);
    });
    logAdminAction('reset_leaderboard', { scope });
    res.json({ ok: true });
  } catch (e) {
    console.error('Admin reset leaderboard failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: set or clear the site-wide broadcast banner.
app.post('/api/admin/broadcast', async (req, res) => {
  const { password, content } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }
  try {
    await saveBroadcast(content);
    logAdminAction('broadcast', { contentLength: content.length, cleared: content.length === 0 });
    res.json(await loadBroadcast());
  } catch (e) {
    console.error('Admin broadcast failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: wipe the shared chat room.
app.post('/api/admin/clear-chat', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  try {
    const { rowCount } = await pool.query('DELETE FROM chat');
    chatActivity.clear();
    logAdminAction('clear_chat', { removed: rowCount });
    res.json({ ok: true, removed: rowCount });
  } catch (e) {
    console.error('Admin clear chat failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: list every known user with their ban status, for the ban/unban
// tool in the admin panel.
app.post('/api/admin/user-list', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  try {
    const data = await loadData();
    res.json({ users: USERS.map(u => ({ user: u, banned: !!data[u].banned, tokens: data[u].wallet.tokens })) });
  } catch (e) {
    console.error('Admin user list failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: ban or unban a user. Banning also kills any of their active
// sessions so they're logged out immediately, not just on next login.
app.post('/api/admin/ban', async (req, res) => {
  const { password, user, banned } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  try {
    await withWriteLock(async () => {
      const data = await loadData();
      data[user].banned = !!banned;
      await saveData(data);
    });
    if (banned) {
      for (const [token, session] of sessions.entries()) {
        if (session.username === user) sessions.delete(token);
      }
    }
    logAdminAction(banned ? 'ban_user' : 'unban_user', { user });
    res.json({ user, banned: !!banned });
  } catch (e) {
    console.error('Admin ban failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: copy one user's stats + wallet onto another user's account —
// handy for testing or restoring a save from a snapshot of a similar
// account. Overwrites toUser entirely (except their ban status).
app.post('/api/admin/clone-player', async (req, res) => {
  const { password, fromUser, toUser } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!USERS.includes(fromUser) || !USERS.includes(toUser)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (fromUser === toUser) {
    return res.status(400).json({ error: 'Source and target must be different users' });
  }
  try {
    await withWriteLock(async () => {
      const data = await loadData();
      const bannedState = data[toUser].banned;
      const clone = JSON.parse(JSON.stringify(data[fromUser]));
      clone.banned = bannedState;
      data[toUser] = clone;
      await saveData(data);
    });
    logAdminAction('clone_player', { fromUser, toUser });
    res.json({ ok: true });
  } catch (e) {
    console.error('Admin clone player failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: flip emergency lockdown mode on/off. See the LOCKDOWN
// middleware above for exactly what this blocks.
app.post('/api/admin/lockdown', async (req, res) => {
  const { password, enabled } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  LOCKDOWN = !!enabled;
  logAdminAction('lockdown', { enabled: LOCKDOWN });
  res.json({ lockdown: LOCKDOWN });
});

app.post('/api/admin/lockdown-status', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  res.json({ lockdown: LOCKDOWN });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Leaderboard server running on http://localhost:${PORT}`);
    });
  })
  .catch(e => {
    console.error('Failed to initialize database, exiting:', e);
    process.exit(1);
  });
