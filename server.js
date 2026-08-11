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
  "JONAH-12",
  "DOM_FOOTY",
  "XAVIER_12"
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
  "JONAH-12": "3aa7b283173f4c75717a31819683b171:f9427fd40f38f2ff5f4037a4698b8eab5272d8914b85b97de5c523a1550eaac75d8a28db50d18ef587e34ad6c77d3278a4c19019e9b3fcecaba49a204af4d927",
  "DOM_FOOTY": "ddc64bbdfd97de6721c13e98437f5064:5c8d6a5f402ca1c0738bbe68a7a97496484fa14edced968563889b0f85d057376747fb986f1794e1b3fd9cce4093536fe5bf52106ea825adb49fd0299d441b9a",
  "XAVIER_12": "04a5ba71db687e3712762e8764992e00:4a57bd38dee153712556462a3a0c6b397838070ad66c78e3cc882464e77e2138cc0061254acab519fb5ced3f0ace70c6c0f8360e3ca4b04a49302b6fac660134"
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

// Login lockouts were removed — they were locking legitimate players out
// for 15 minutes just for re-logging in a few times in a row (e.g. after a
// session expired). Failed attempts are still counted for visibility, but
// no longer block anyone from logging in.
const loginAttempts = new Map(); // username -> { count, firstAttempt }
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;

function lockoutRemainingMs(username){
  return 0; // lockouts disabled — see note above
}
function recordFailedLogin(username){
  const now = Date.now();
  let rec = loginAttempts.get(username);
  if(!rec || now - rec.firstAttempt > LOCKOUT_WINDOW_MS){
    rec = { count: 0, firstAttempt: now };
  }
  rec.count++;
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
  golf: { bestHoles: 200 },
  policechase: { highScore: 100000 },
  hoops: { highScore: 5000 },
  burger: { highScore: 2000 },
  flood: { bestRooms: 500 },
  evolution: { bestStage: 7 },
  robot: { bestRound: 500 }
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
  sumo_win: 1, sumo_loss: 1,
  secret_found: 1,
  towerdefense_wave: 1,
  parkour_gate: 30, parkour_finish: 1,
  zombie_wave: 1, zombie_kill: 200, zombie_boss: 1,
  pirate_treasure: 50, pirate_skeleton: 50,
  samurai_win: 1, samurai_loss: 1,
  policechase_cash: 200, policechase_distance: 5000,
  tactics_win: 1, tactics_loss: 1, tactics_unit_kill: 20,
  runeduel_win: 1, runeduel_loss: 1, runeduel_creature_kill: 40,
  warlord_win: 1, warlord_loss: 1, warlord_territory: 40,
  evolution_dna: 400,
  flood_room: 1,
  hoops_basket: 1,
  burger_order: 1,
  tag_win: 1, tag_loss: 1,
  robot_win: 1,
  kart_win: 1, kart_finish: 1,
  hub_coin: 1,
  pumpkin_pick: 5, ghost_banish: 3
};

const DEFAULT_STATS = {
  soccer: { goals: 0, saves: 0, wins: 0, losses: 0 },
  racing: { wins: 0, losses: 0 },
  tank: { wins: 0, losses: 0 },
  runner: { highScore: 0 },
  wildduel: { wins: 0, losses: 0 },
  asteroid: { highScore: 0 },
  breaker: { highScore: 0 },
  roguelike: { deepestFloor: 0 },
  comet: { highScore: 0 },
  tunnel: { highScore: 0 },
  depths: { bestWave: 0 },
  stack: { bestHeight: 0 },
  golf: { bestHoles: 0 },
  sumo: { wins: 0, losses: 0 },
  towerdefense: { bestWave: 0 },
  parkour: { bestTime: 0 },
  zombie: { bestWave: 0 },
  pirate: { bestTreasure: 0 },
  samurai: { wins: 0, losses: 0 },
  policechase: { highScore: 0 },
  tactics: { wins: 0, losses: 0 },
  runeduel: { wins: 0, losses: 0 },
  warlord: { wins: 0, losses: 0 },
  evolution: { bestStage: 0 },
  flood: { bestRooms: 0 },
  hoops: { highScore: 0 },
  burger: { highScore: 0 },
  tag: { wins: 0, losses: 0 },
  robot: { bestRound: 0 },
  kart: { wins: 0, races: 0 }
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
  sumo_win: 20, sumo_loss: 5,
  secret_found: 40,       // an easter egg discovered
  towerdefense_wave: 8,   // per wave survived
  parkour_gate: 2,        // per checkpoint/gate cleared
  parkour_finish: 25,     // per time-trial course completed
  zombie_wave: 6,         // per wave survived
  zombie_kill: 0.4,       // per zombie killed
  zombie_boss: 40,        // per boss defeated (every 10th wave)
  pirate_treasure: 5,     // per treasure haul collected
  pirate_skeleton: 3,     // per skeleton crew defeated
  samurai_win: 20, samurai_loss: 5,
  policechase_cash: 1,    // per cash pickup grabbed
  policechase_distance: 0.2, // per block of distance survived
  tactics_win: 25, tactics_loss: 6, tactics_unit_kill: 3,
  runeduel_win: 25, runeduel_loss: 6, runeduel_creature_kill: 1.5,
  warlord_win: 30, warlord_loss: 6, warlord_territory: 2, // per territory conquered
  evolution_dna: 0.4,     // per bit of biomass eaten that run
  flood_room: 12,         // per flooded room escaped
  hoops_basket: 2,        // per basket sunk
  burger_order: 4,        // per order served correctly
  tag_win: 20, tag_loss: 5,
  robot_win: 15,          // per arena round won
  kart_win: 40,           // first across the line
  kart_finish: 12,        // anywhere else on the podium sheet
  hub_coin: 2,            // a token picked up in the hub
  pumpkin_pick: 3,        // Season 2 — a pumpkin in the haunted hub
  ghost_banish: 6         // Season 2 — a ghost sent on its way
};

const SHOP_ITEMS = {
  neon:   { name: 'Neon Default', cost: 0,   cyan: '#2de2c5', pink: '#ff3d8a', gold: '#ffc857', bg: '#0a0d13', bgPanel: '#12161f', bgPanelRaised: '#1a1f2b', border: '#262c3a' },
  sunset: { name: 'Sunset Drift', cost: 150, cyan: '#ff7a45', pink: '#ff4d6d', gold: '#ffd23f', bg: '#160f0a', bgPanel: '#20140d', bgPanelRaised: '#2b1c12', border: '#3a2415' },
  toxic:  { name: 'Toxic Lab',    cost: 150, cyan: '#9dff45', pink: '#45ffb0', gold: '#e8ff45', bg: '#0a130d', bgPanel: '#0f1f14', bgPanelRaised: '#16291b', border: '#22381f' },
  royal:  { name: 'Crown Jewels', cost: 200, cyan: '#2f9e56', pink: '#c81d3f', gold: '#e8b923', bg: '#0d1410', bgPanel: '#121d15', bgPanelRaised: '#1a2a1e', border: '#254030' },
  blood:  { name: 'Blood Moon',   cost: 250, cyan: '#ff5454', pink: '#ff8a8a', gold: '#ffae42', bg: '#150a0a', bgPanel: '#210f0f', bgPanelRaised: '#2b1515', border: '#3a1f1f' },
  arctic: { name: 'Arctic Drift', cost: 200, cyan: '#7dd3ff', pink: '#c3e9ff', gold: '#e0f7ff', bg: '#0a1018', bgPanel: '#0f1824', bgPanelRaised: '#16212f', border: '#223244' },
  vaporwave: { name: 'Vaporwave', cost: 250, cyan: '#5ff0ff', pink: '#ff6ad5', gold: '#c774e8', bg: '#130a1a', bgPanel: '#1c0f26', bgPanelRaised: '#271633', border: '#3a2247' },
  inferno: { name: 'Inferno Core', cost: 300, cyan: '#ff6a1a', pink: '#ff3b0f', gold: '#ffcf40', bg: '#140502', bgPanel: '#210a03', bgPanelRaised: '#2e1005', border: '#421a08' },
  abyss: { name: 'Abyssal Trench', cost: 300, cyan: '#2ee6c8', pink: '#0f6e8c', gold: '#7fffd4', bg: '#020a10', bgPanel: '#051620', bgPanelRaised: '#08222f', border: '#0d3140' },
  galaxy: { name: 'Galaxy Drift', cost: 350, cyan: '#8f6bff', pink: '#ff6be0', gold: '#f5f0ff', bg: '#08061a', bgPanel: '#100c29', bgPanelRaised: '#191238', border: '#251a4a' },
  goldrush: { name: 'Gold Rush', cost: 350, cyan: '#ffcf3f', pink: '#e8a13d', gold: '#fff4c2', bg: '#160f04', bgPanel: '#221807', bgPanelRaised: '#30220a', border: '#43310f' },
  static: { name: 'Static Noise', cost: 400, cyan: '#e6e6e6', pink: '#8f8f8f', gold: '#ffffff', bg: '#08080a', bgPanel: '#121214', bgPanelRaised: '#1c1c1f', border: '#2c2c30' },
  amethyst: { name: 'Amethyst Veil', cost: 300, cyan: '#a374ff', pink: '#d9a6ff', gold: '#f2e6ff', bg: '#0e0818', bgPanel: '#170f26', bgPanelRaised: '#211735', border: '#33224a' },
  coral: { name: 'Coral Reef', cost: 300, cyan: '#2fd9c4', pink: '#ff7f6b', gold: '#ffe0a3', bg: '#04181a', bgPanel: '#082426', bgPanelRaised: '#0e3336', border: '#164a4a' },
  solarflare: { name: 'Solar Flare', cost: 300, cyan: '#ffdd33', pink: '#ff8c1a', gold: '#fffbe0', bg: '#1a1102', bgPanel: '#291a04', bgPanelRaised: '#3a2606', border: '#523810' },
  goose: { name: 'Goose', cost: 9000, cyan: '#ff9c1a', pink: '#ffffff', gold: '#ffcf40', bg: '#e9edf0', bgPanel: '#dde3e7', bgPanelRaised: '#cfd7dc', border: '#aab4bb', image: 'data:image/webp;base64,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cpKXphfGSOOGQVlHgFeX297SO0NYvFmKQw2wyPmpnMjxWKh90MdO7UDuixquwrvRgdRkKQuN9TUBMYhcb6moCYxC431NQExiFxvilxZgfiIrdl7KqcyVHE8m0RSwQRtHP/5ZkecYECSdNddBzVkr77wW1ko97/GSvELjfU1ATGIXG+pqAmMQuN9TUBMYhbpcb1Yfv2Qxraion75GUwqZpDAX/9Oe7yrL/WBnhSbKHv8s8KQuN9TUBMYhcb6moCYxC431NQExiFxvqaeSkrPR2Ih/8m5xIL0htXCSFCByv6Jxv/JZrjHZLbokJT77td5lS17rCHAc+LwwvrhfbWLoptMs8n/EXRvqagJjELjfU1ATGIXG+pqAmMQuN9TTzIgAZ0UXsyHYvB1zwemHL+IsG55kgSvELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6milQap6QceE8lUHss13IBSGZB2H5CmqPj/sF/ok9Yp10b6moCYxC431NQExiFxvqagJjELjfU1AS8rnPFWKdEbdi31NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJjELjfU1ATGIXG+pqAmMQuN9TUBMYhcb6moCYxC431NQExiFxvqagJioAAP7/U2AAAAAAAAAAAAAAAAAAAAAAAAAAB5+664/FGzHl2EU/C9pmzgN6M9zbX75bdltZ9ZIyax0wph+DpETbUb93YtKLZOkUOI0t8lEgvSghJZme1Xv+QOub5Pq5/hS28dRRuC45sZqNjXHUfAnZEYu5W79vXpy+3g2CmLZfF0lUFxpV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' },
  hauntedvoid: { name: 'Haunted Void', cost: 666, cyan: '#8b5cf6', pink: '#ff7518', gold: '#c9ff2e', bg: '#08060d', bgPanel: '#120c1c', bgPanelRaised: '#1c1230', border: '#2e1d4a', bgGradient: 'linear-gradient(160deg, #0a0710 0%, #1d0f2e 45%, #2a1206 100%)', season: 2, limited: true },
  pumpkinking: { name: 'Pumpkin King', cost: 450, cyan: '#ff7518', pink: '#ffb347', gold: '#fff0c2', bg: '#140800', bgPanel: '#201004', bgPanelRaised: '#2e1808', border: '#42230b', season: 2, limited: true },
  gravemist:  { name: 'Grave Mist', cost: 450, cyan: '#9fb8ad', pink: '#6f8f84', gold: '#dfeae5', bg: '#080c0b', bgPanel: '#101614', bgPanelRaised: '#18211e', border: '#23302c', season: 2, limited: true },
  bloodmoonrise: { name: 'Blood Moonrise', cost: 500, cyan: '#ff2e2e', pink: '#ff6b6b', gold: '#ffd0d0', bg: '#0d0203', bgPanel: '#180507', bgPanelRaised: '#24080b', border: '#3a0f13', season: 2, limited: true },
  blossom: { name: 'Cherry Blossom', cost: 300, cyan: '#ffb7c5', pink: '#ff8fab', gold: '#fff0f4', bg: '#160c10', bgPanel: '#221319', bgPanelRaised: '#301b23', border: '#442733' },
  frostbite: { name: 'Frostbite', cost: 300, cyan: '#bfefff', pink: '#7fd4ff', gold: '#ffffff', bg: '#050b10', bgPanel: '#0a141c', bgPanelRaised: '#11202b', border: '#1c3140' },
  grid: { name: 'Neon Grid', cost: 350, cyan: '#00ffe0', pink: '#ff00c8', gold: '#faff00', bg: '#040406', bgPanel: '#0a0a0f', bgPanelRaised: '#111118', border: '#1e1e2a' },
  zip: { name: 'Zip', cost: 3000, cyan: '#22c55e', pink: '#ffffff', gold: '#16a34a', bg: '#f3fff5', bgPanel: '#e4fbe9', bgPanelRaised: '#d3f5dc', border: '#a9e6bb', bgGradient: 'linear-gradient(135deg, #ffffff 0%, #d9f7e0 30%, #ffffff 55%, #bdf0c9 80%, #ffffff 100%)', cabinetBg: '#1c5c33', cabinetText: '#f0fff4', cabinetTextDim: '#bfe8cc', text: '#0d2b16', textDim: '#3d6b4a', taunts: true },
  chip: { name: 'Chip', cost: 3000, cyan: '#5fd1ff', pink: '#ffd76b', gold: '#a6ffb0', bg: '#081018', bgPanel: '#0f1c26', bgPanelRaised: '#182b38', border: '#233f4d' },
  zipmerge: { name: 'Zip Merge Unlock', cost: 1500, type: 'upgrade', requires: 'zip', desc: 'Keep any theme equipped and still get bullied — Zip\'s commentary can run alongside your other themes.' },
  duo: { name: 'Yuta & Ryu', cost: 3000, cyan: '#6b8cff', pink: '#ff6bcb', gold: '#ffe08a', bg: '#140a22', bgPanel: '#1c1030', bgPanelRaised: '#261640', border: '#3a2456', bgGradient: 'linear-gradient(135deg, #ff8fd1 0%, #c48fff 35%, #6ea8ff 70%, #ff8fd1 100%)', buttonGradient: 'linear-gradient(135deg, #ff6bcb, #6b8cff)', taunts: true },
  duomerge: { name: 'Duo Merge Unlock', cost: 1500, type: 'upgrade', requires: 'duo', desc: 'Keep any theme equipped and still get commentary from Yuta & Ryu — their banter can run alongside your other themes.' },
  uro: { name: 'Uro', cost: 3000, cyan: '#ff8fd6', pink: '#c9a6ff', gold: '#8a2f5e', bg: '#1c0f1a', bgPanel: '#2a1526', bgPanelRaised: '#3a1c33', border: '#5c2a4c', bgGradient: 'linear-gradient(135deg, #ffd6f0 0%, #d9b3ff 35%, #ff8fd6 70%, #8a2f5e 100%)', cabinetBg: '#4a1638', cabinetText: '#ffe6f7', cabinetTextDim: '#d9a8c9', text: '#2a0f22', textDim: '#6b3a56', taunts: true },
  uromerge: { name: 'Uro Merge Unlock', cost: 1500, type: 'upgrade', requires: 'uro', desc: "Keep any theme equipped and still get mocked by Uro — her commentary can run alongside your other themes." },
  trio: { name: 'Yuta, Ryu & Uro', cost: 8000, cyan: '#9a7dff', pink: '#ff6bcb', gold: '#ffe08a', bg: '#100a1c', bgPanel: '#1a1128', bgPanelRaised: '#241636', border: '#3a2456', bgGradient: 'linear-gradient(135deg, #6ea8ff 0%, #ff6bcb 33%, #c9a6ff 66%, #ff8fd6 100%)', buttonGradient: 'linear-gradient(135deg, #6ea8ff, #ff6bcb, #c9a6ff)', taunts: true },
  triomerge: { name: 'Trio Merge Unlock', cost: 3000, type: 'upgrade', requires: 'trio', desc: "The priciest merge in the shop — keep any theme equipped and still get all three of them reacting (and arguing) alongside it." },
  beachwave: { name: 'Beach Wave', cost: 500, cyan: '#00c2d1', pink: '#ffb37a', gold: '#fff4d6', bg: '#052430', bgPanel: '#0a3444', bgPanelRaised: '#0f4658', border: '#1c5f73', bgGradient: 'linear-gradient(135deg, #ffe9b0 0%, #ffb37a 25%, #00c2d1 60%, #036c81 100%)', season: 1, limited: true },

  midnightplum: { name: 'Midnight Plum', cost: 150, cyan: '#c084fc', pink: '#e879f9', gold: '#fbcfe8', bg: '#0f0817', bgPanel: '#180f24', bgPanelRaised: '#221733', border: '#33234a' },
  emberglass: { name: 'Ember Glass', cost: 200, cyan: '#ff9d5c', pink: '#ff5c5c', gold: '#ffd08a', bg: '#160b06', bgPanel: '#22120a', bgPanelRaised: '#301a0f', border: '#452817' },
  seafoam: { name: 'Seafoam', cost: 200, cyan: '#5ce6c0', pink: '#8fffe0', gold: '#eafff5', bg: '#04120e', bgPanel: '#081e18', bgPanelRaised: '#0d2c23', border: '#164136' },
  crimsonwire: { name: 'Crimson Wire', cost: 350, cyan: '#ff2b4a', pink: '#ff8ba0', gold: '#ffe0e6', bg: '#0f0305', bgPanel: '#1a060a', bgPanelRaised: '#260a10', border: '#3a1119' },
  lunarfrost: { name: 'Lunar Frost', cost: 350, cyan: '#b8e6ff', pink: '#e0d4ff', gold: '#ffffff', bg: '#080b12', bgPanel: '#0f151e', bgPanelRaised: '#18202c', border: '#26313f' },
  copperveil: { name: 'Copper Veil', cost: 400, cyan: '#e8946a', pink: '#f4c28f', gold: '#fff0dc', bg: '#140d08', bgPanel: '#20160d', bgPanelRaised: '#2e2013', border: '#452f1c' },
  voidwalker: { name: 'Voidwalker', cost: 450, cyan: '#7000ff', pink: '#ff00aa', gold: '#00fff0', bg: '#020006', bgPanel: '#08000f', bgPanelRaised: '#100019', border: '#1e0030' },
  prism: { name: 'Prism Shift', cost: 500, cyan: '#ff5f6d', pink: '#7c4dff', gold: '#5bffea', bg: '#08060f', bgPanel: '#100c1c', bgPanelRaised: '#191228', border: '#281c3d', bgGradient: 'linear-gradient(135deg, #ff5f6d 0%, #7c4dff 33%, #5bffea 66%, #ff5f6d 100%)' }
};

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
// Progress for each achievement is derived from data the server already
// tracks authoritatively — per-game lifetime stats (data[user][game]) and
// wallet.stats (win streaks, lifetime tokens earned, bricks broken, races
// finished — things no single game's leaderboard record captures on its
// own). Rewards are applied once, the moment an achievement is unlocked.
const ACHIEVEMENTS = {
  first_victory:  { name: 'First Victory',         icon: '🥇', desc: 'Win your first game.',                                reward: { tokens: 300, title: 'Rookie' } },
  goals_100:      { name: 'Score 100 Goals',        icon: '⚽', desc: 'Score 100 goals across all Street Soccer matches.',   reward: { tokens: 2000, title: 'Goal Machine' } },
  floor_50:       { name: 'Reach Floor 50',         icon: '💀', desc: 'Reach floor 50 in Crypt Crawler.',                    reward: { tokens: 2500, title: 'Dungeon Runner' } },
  tokens_10000:   { name: 'Earn 10,000 Tokens',     icon: '💰', desc: 'Earn 10,000 tokens over your lifetime.',              reward: { tokens: 2000, title: 'Token Hoarder' } },
  win_streak_20:  { name: 'Win 20 Games in a Row',  icon: '🔥', desc: 'Win 20 competitive games in a row.',                  reward: { tokens: 3000, title: 'Unstoppable' } },
  bricks_5000:    { name: 'Break 5,000 Bricks',     icon: '🧱', desc: 'Break 5,000 bricks in Neon Breaker.',                 reward: { tokens: 2000, title: 'Brick Breaker' } },
  races_100:      { name: 'Finish 100 Races',       icon: '🏎', desc: 'Finish 100 races in Apex Loop.',                     reward: { tokens: 2500, title: 'Speed Demon' } },

  wins_100:       { name: 'Century Club',           icon: '💯', desc: 'Win 100 games total across the whole arcade.',       reward: { tokens: 3000, title: 'Century Club' } },
  floor_100:      { name: 'Bottomless',             icon: '☠️', desc: 'Reach floor 100 in Crypt Crawler.',                  reward: { tokens: 4500, title: 'Deep Diver' } },
  win_streak_50:  { name: 'Untouchable',            icon: '⚡', desc: 'Win 50 competitive games in a row.',                 reward: { tokens: 5000, title: 'Untouchable' } },
  tokens_50000:   { name: 'High Roller',            icon: '🏦', desc: 'Earn 50,000 tokens over your lifetime.',             reward: { tokens: 4000, title: 'Tycoon' } },
  bricks_20000:   { name: 'Wrecking Ball',          icon: '💥', desc: 'Break 20,000 bricks in Neon Breaker.',               reward: { tokens: 4000, title: 'Demolition Expert' } },
  races_500:      { name: 'Road Warrior',           icon: '🏁', desc: 'Finish 500 races in Apex Loop.',                     reward: { tokens: 4000 } },
  collector:      { name: 'Collector',              icon: '🎨', desc: 'Own every non-limited theme in the shop.',           reward: { tokens: 5000, title: 'Collector', border: 'collector-border' } },

  // Secret achievements — hidden as "???" until unlocked (see GET /api/achievements).
  full_roster:    { name: 'Full Roster',             icon: '🎭', secret: true, desc: 'Own every companion theme AND every Merge Unlock — Zip, Duo, Uro, and the Sendai Trio, all four merges.', reward: { tokens: 3000, title: 'Full Roster' } },
  big_spender:    { name: 'Easy Come, Easy Go',       icon: '🎰', secret: true, desc: 'Hold 5,000+ tokens at once, then spend all the way back down to zero.', reward: { tokens: 1500, title: 'Big Spender' } },
  crate_collector:{ name: 'Crate Digger',             icon: '📦', secret: true, desc: 'Open 25 Loot Crates.', reward: { tokens: 3000, border: 'crate-digger-border' } },
  jackpot:        { name: 'Jackpot',                  icon: '🍀', secret: true, desc: 'Pull a Legendary reward from a Loot Crate.', reward: { tokens: 4000, title: 'Jackpot' } },

  // --- Season 2: Haunted Arcade. Earnable only while the season runs.
  pumpkin_picker: { name: 'Pumpkin Picker',          icon: '🎃', desc: 'Collect 10 pumpkins in the haunted hub.',            reward: { tokens: 500, title: 'Pumpkin Picker' } },
  pumpkin_hoard:  { name: 'Patch Cleaner',           icon: '🧺', desc: 'Collect 100 pumpkins in the haunted hub.',           reward: { tokens: 3000, title: 'Gourd Lord' } },
  ghost_hunter:   { name: 'Ghost Hunter',            icon: '👻', desc: 'Banish 25 ghosts in the haunted hub.',               reward: { tokens: 2500, title: 'Ghost Hunter' } },
  midnight_shift: { name: 'The Midnight Shift',      icon: '🕛', desc: 'Play a cabinet between midnight and 1am.',           reward: { tokens: 1300, title: 'Night Shift' } },
  the_thirteenth: { name: 'Cabinet Thirteen',        icon: '🚪', secret: true, desc: 'Find what the arcade keeps behind the thirteenth door.', reward: { tokens: 4000, title: 'It Let Me In' } },

  legendary:      { name: 'Legendary Player',       icon: '👑', desc: 'Unlock every other achievement.',                    reward: { tokens: 5000, title: 'Legend', border: 'legendary-border' } }
};

// Reasons in REWARDS that count as a "competitive win" or "competitive loss"
// for the purposes of the win-streak achievement.
const WIN_REASONS = ['soccer_win', 'racing_win', 'tank_win', 'wildduel_win', 'sumo_win', 'samurai_win', 'tactics_win', 'runeduel_win', 'warlord_win', 'tag_win'];
const LOSS_REASONS = ['soccer_loss', 'racing_loss', 'tank_loss', 'wildduel_loss', 'sumo_loss', 'samurai_loss', 'tactics_loss', 'runeduel_loss', 'warlord_loss', 'tag_loss'];

// Evaluates every achievement for a user against the freshest data, unlocks
// any newly-earned ones, and applies their rewards. Mutates `data[user]` —
// caller is responsible for saving. Returns the list of achievement ids that
// were newly unlocked this call (so the client can show an "unlocked!" toast).
function checkAchievements(data, user) {
  const wallet = data[user].wallet;
  if (!Array.isArray(wallet.achievements)) wallet.achievements = [];
  if (!wallet.stats) wallet.stats = { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0, maxTokensHeld: 0, crateOpens: 0, legendaryCratePulls: 0 };
  if (!Array.isArray(wallet.titles)) wallet.titles = [];
  if (!Array.isArray(wallet.borders)) wallet.borders = [];

  const has = (id) => wallet.achievements.includes(id);
  const totalWins = Object.keys(DEFAULT_STATS).reduce((sum, g) => sum + (data[user][g] && typeof data[user][g].wins === 'number' ? data[user][g].wins : 0), 0);

  const progress = {
    first_victory:  totalWins >= 1,
    goals_100:      (data[user].soccer?.goals || 0) >= 100,
    floor_50:       (data[user].roguelike?.deepestFloor || 0) >= 50,
    tokens_10000:   wallet.stats.tokensEarnedLifetime >= 10000,
    win_streak_20:  wallet.stats.bestWinStreak >= 20,
    bricks_5000:    wallet.stats.bricksBroken >= 5000,
    races_100:      wallet.stats.racesFinished >= 100,

    wins_100:       totalWins >= 100,
    floor_100:      (data[user].roguelike?.deepestFloor || 0) >= 100,
    win_streak_50:  wallet.stats.bestWinStreak >= 50,
    tokens_50000:   wallet.stats.tokensEarnedLifetime >= 50000,
    bricks_20000:   wallet.stats.bricksBroken >= 20000,
    races_500:      wallet.stats.racesFinished >= 500,
    // Collector counts only permanent, non-limited themes — a seasonal
    // theme rotating out shouldn't make this achievement unobtainable.
    collector:      Object.keys(SHOP_ITEMS)
                       .filter(id => SHOP_ITEMS[id].type !== 'upgrade' && !SHOP_ITEMS[id].limited)
                       .every(id => wallet.owned.includes(id)),

    full_roster:    ['zip', 'duo', 'uro', 'trio', 'zipmerge', 'duomerge', 'uromerge', 'triomerge']
                       .every(id => wallet.owned.includes(id)),
    big_spender:    (wallet.stats.maxTokensHeld || 0) >= 5000 && wallet.tokens === 0,
    crate_collector:(wallet.stats.crateOpens || 0) >= 25,
    jackpot:        (wallet.stats.legendaryCratePulls || 0) >= 1
  };
  // Legendary unlocks once every OTHER achievement is unlocked.
  progress.legendary = Object.keys(ACHIEVEMENTS).filter(id => id !== 'legendary').every(id => progress[id] || has(id));

  // Season 2 counters live on the wallet under `spooky`, so they survive the
  // season and can still be shown on a profile afterwards.
  const spooky = wallet.spooky || {};
  progress.pumpkin_picker = (spooky.pumpkins || 0) >= 10;
  progress.pumpkin_hoard  = (spooky.pumpkins || 0) >= 100;
  progress.ghost_hunter   = (spooky.ghosts || 0) >= 25;
  progress.midnight_shift = !!spooky.midnight;
  progress.the_thirteenth = !!spooky.thirteenth;

  const newlyUnlocked = [];
  for (const id of Object.keys(ACHIEVEMENTS)) {
    if (has(id) || !progress[id]) continue;
    // A seasonal achievement can only be earned while its season is running.
    // Already-earned ones are untouched — this gate is on unlocking, not on
    // keeping.
    if (SEASON_ACHIEVEMENTS[id] && SEASON_ACHIEVEMENTS[id] !== CURRENT_SEASON) continue;
    wallet.achievements.push(id);
    newlyUnlocked.push(id);
    const reward = ACHIEVEMENTS[id].reward || {};
    if (typeof reward.tokens === 'number') wallet.tokens += reward.tokens;
    if (reward.title && !wallet.titles.includes(reward.title)) wallet.titles.push(reward.title);
    if (reward.border && !wallet.borders.includes(reward.border)) wallet.borders.push(reward.border);
    if (reward.theme && !wallet.owned.includes(reward.theme)) wallet.owned.push(reward.theme);
  }
  return newlyUnlocked;
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------
// Each season pairs a limited-time shop theme with a badge. New seasons are
// added here going forward; CURRENT_SEASON controls which one is "live" and
// shown in the client's season banner + shop.
const SEASONS = {
  1: { name: 'Season 1', theme: 'Beach', badge: '🏖️', limitedThemeId: 'beachwave',
       blurb: 'Sun, surf, and a very limited-time Beach Wave theme in the shop.' },
  2: { name: 'Season 2 — Haunted Arcade', theme: 'Halloween', badge: '🎃',
       limitedThemeId: 'hauntedvoid',
       blurb: 'The lights have gone wrong. Pumpkins in the hub, something in the corridors, and cosmetics that leave when the season does.',
       // Only obtainable while this season is live. Once earned they're kept
       // forever — see SEASON_ACHIEVEMENTS below.
       achievements: ['pumpkin_picker', 'pumpkin_hoard', 'ghost_hunter', 'midnight_shift', 'the_thirteenth'] }
};
const CURRENT_SEASON = 2;

// Achievements tied to a season. They can only be *unlocked* while their
// season is the live one, which is what makes them limited — but nothing ever
// removes one you've already earned, so a badge from a past season stays on
// your profile for good.
const SEASON_ACHIEVEMENTS = {};
Object.entries(SEASONS).forEach(([num, def]) => {
  (def.achievements || []).forEach(id => { SEASON_ACHIEVEMENTS[id] = Number(num); });
});

// ---------------------------------------------------------------------------
// XP & Leveling
// ---------------------------------------------------------------------------
// XP is earned 1-for-1 alongside tokens (see /api/wallet/earn) — every action
// that pays tokens pays the same amount of XP, so no separate tracking is
// needed anywhere in the game code. The XP required per level grows steadily
// so leveling stays meaningful at higher levels.
function xpForLevel(level) {
  // Level 1->2 costs 500 XP, growing by 150 XP per level after that.
  return 500 + (level - 1) * 150;
}

// Given total lifetime XP, returns { level, xpIntoLevel, xpForNextLevel }.
function computeLevel(totalXp) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: xpForLevel(level) };
}

// Rewards for leveling up. Every level pays a small token bonus; milestone
// levels also unlock a cosmetic (theme, border, or animated username).
const LEVEL_MILESTONE_REWARDS = {
  3:  { title: 'Newcomer' },
  5:  { title: 'Rising Star' },
  8:  { title: 'Regular' },
  10: { border: 'level10-border' },
  12: { title: 'Grinder' },
  15: { theme: 'grid' },
  20: { title: 'Veteran' },
  25: { animatedName: true },
  30: { theme: 'galaxy' },
  35: { title: 'Elite' },
  40: { border: 'level40-border' },
  45: { theme: 'prism' },
  50: { title: 'Ascendant', border: 'level50-border', animatedName: true },
  60: { title: 'Mythic' },
  75: { theme: 'voidwalker', title: 'Immortal' },
  100:{ title: 'Level 100 Icon', border: 'level100-border' }
};

function levelUpTokenReward(level) {
  return level * 50;
}

// Mutates wallet in place, applying rewards for every level crossed between
// the wallet's previous level and its current XP total. Returns the list of
// levels newly reached this call (for a client-side "leveled up!" toast).
function checkLevelUp(data, user) {
  const wallet = data[user].wallet;
  if (typeof wallet.xp !== 'number') wallet.xp = 0;
  const prevLevel = typeof wallet.level === 'number' ? wallet.level : 1;
  const { level: newLevel } = computeLevel(wallet.xp);

  const levelsGained = [];
  for (let lvl = prevLevel + 1; lvl <= newLevel; lvl++) {
    levelsGained.push(lvl);
    wallet.tokens += levelUpTokenReward(lvl);
    const milestone = LEVEL_MILESTONE_REWARDS[lvl];
    if (milestone) {
      if (!Array.isArray(wallet.titles)) wallet.titles = [];
      if (!Array.isArray(wallet.borders)) wallet.borders = [];
      if (milestone.title && !wallet.titles.includes(milestone.title)) wallet.titles.push(milestone.title);
      if (milestone.border && !wallet.borders.includes(milestone.border)) wallet.borders.push(milestone.border);
      if (milestone.theme && !wallet.owned.includes(milestone.theme)) wallet.owned.push(milestone.theme);
      if (milestone.animatedName) wallet.animatedName = true;
    }
  }
  wallet.level = newLevel;
  return levelsGained;
}

// ---------------------------------------------------------------------------
// Player Profiles
// ---------------------------------------------------------------------------
const AVATARS = ['🙂', '😎', '🤖', '👾', '🧙', '🥷', '🦊', '🐺', '🐉', '🎮', '⚡', '🔥', '🌊', '🌙', '👑', '💀'];
const BANNERS = ['default', 'sunset', 'ocean', 'forest', 'neon', 'gold', 'crimson', 'void'];

// Maps a wallet/earn `reason` to the game it belongs to, for tallying which
// game a user plays most (their "favourite game" on their profile).
const REASON_TO_GAME = {
  soccer_win: 'soccer', soccer_loss: 'soccer', soccer_goal: 'soccer', soccer_save: 'soccer',
  racing_win: 'racing', racing_loss: 'racing',
  tank_win: 'tank', tank_loss: 'tank',
  wildduel_win: 'wildduel', wildduel_loss: 'wildduel',
  runner_score: 'runner',
  asteroid_shot: 'asteroid',
  breaker_brick: 'breaker',
  roguelike_kill: 'roguelike', roguelike_floor: 'roguelike', roguelike_loot: 'roguelike',
  comet_dodged: 'comet',
  tunnel_gate: 'tunnel',
  depths_kill: 'depths', depths_wave: 'depths',
  stack_block: 'stack',
  golf_hole: 'golf',
  sumo_win: 'sumo', sumo_loss: 'sumo',
  towerdefense_wave: 'towerdefense',
  parkour_gate: 'parkour', parkour_finish: 'parkour',
  zombie_wave: 'zombie', zombie_kill: 'zombie', zombie_boss: 'zombie',
  pirate_treasure: 'pirate', pirate_skeleton: 'pirate',
  samurai_win: 'samurai', samurai_loss: 'samurai',
  policechase_cash: 'policechase', policechase_distance: 'policechase',
  tactics_win: 'tactics', tactics_loss: 'tactics', tactics_unit_kill: 'tactics',
  runeduel_win: 'runeduel', runeduel_loss: 'runeduel', runeduel_creature_kill: 'runeduel',
  warlord_win: 'warlord', warlord_loss: 'warlord', warlord_territory: 'warlord',
  evolution_dna: 'evolution',
  flood_room: 'flood',
  hoops_basket: 'hoops',
  burger_order: 'burger',
  tag_win: 'tag', tag_loss: 'tag',
  robot_win: 'robot',
  kart_win: 'kart', kart_finish: 'kart'
};

const GAME_DISPLAY_NAMES = {
  soccer: 'Street Soccer', racing: 'Apex Loop', tank: 'Tank Duel', runner: 'Neon Runner',
  wildduel: 'Wild Duel', asteroid: 'Asteroid Field', breaker: 'Neon Breaker', roguelike: 'Crypt Crawler',
  comet: 'Comet Dodge', tunnel: 'Tunnel Rush', depths: 'The Depths', stack: 'Sky Stack',
  golf: 'Cosmic Golf', sumo: 'Sumo Duel',
  towerdefense: 'Tower Defense', parkour: 'Ninja Parkour', zombie: 'Zombie Survival',
  pirate: 'Pirate Adventure', samurai: 'Samurai Showdown', policechase: 'Police Chase',
  tactics: 'Tactics Grid', runeduel: 'Rune Duel', warlord: 'Warlord',
  evolution: 'Evolution', flood: 'Flood Escape', hoops: 'Buzzer Beater',
  burger: 'Burger Rush', tag: 'Neon Tag', robot: 'Robot Arena',
  kart: 'Rift Kart'
};

const DEFAULT_WALLET = { tokens: 0, owned: ['neon'], equipped: 'neon', companion: null, asteroidUpgrades: { extraLife: 0, turnSpeed: 0, autoTurret: 0 }, wildduelUpgrades: { extraHp: 0, fasterReload: 0, fasterMovement: 0 }, roguelikeUpgrades: { extraHp: 0, swordDamage: 0, magicPower: 0, swiftBoots: 0 }, achievements: [], secretsFound: 0, avatar3d: null, spooky: { pumpkins: 0, ghosts: 0, midnight: false, thirteenth: false }, stats: { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0, maxTokensHeld: 0, crateOpens: 0, legendaryCratePulls: 0 }, titles: [], borders: [], seasonBadges: [], xp: 0, level: 1, avatar: '🙂', banner: 'default', friends: [], pendingGifts: [], animatedName: false, createdAt: null, gamePlays: {}, unlockedAvatars: [], unlockedBanners: [], prestige: 0, prestigeBadgeColor: null, daily: null, dailyStreak: 0, dailyBestStreak: 0, dailyLastPerfectDate: null, lastSpinDate: null };

// ---------------------------------------------------------------------------
// Daily Challenges
// ---------------------------------------------------------------------------
// Every account gets the same 3 challenges each day (deterministically
// rolled from the date, so it's a shared daily event rather than per-user
// RNG). Progress is driven off the same `reason` strings /api/wallet/earn
// already receives — no extra plumbing needed in the games themselves —
// plus a manual hook for loot crate opens. Clearing all 3 in one day builds
// a streak that pays an escalating bonus, up to a cap.
const CHALLENGE_POOL = [
  { id: 'goals5',    icon: '⚽', label: 'Score 5 goals',            reasons: ['soccer_goal'],                                              target: 5,  tokens: 150 },
  { id: 'wins2',     icon: '🏆', label: 'Win 2 games (any game)',   reasons: ['soccer_win', 'racing_win', 'tank_win', 'wildduel_win', 'sumo_win'], target: 2, tokens: 200 },
  { id: 'bricks50',  icon: '🧱', label: 'Break 50 bricks',          reasons: ['breaker_brick'],                                             target: 50, tokens: 120 },
  { id: 'floors3',   icon: '💀', label: 'Clear 3 dungeon floors',   reasons: ['roguelike_floor'],                                           target: 3,  tokens: 150 },
  { id: 'crates1',   icon: '📦', label: 'Open 1 Loot Crate',        reasons: ['lootcrate_open'],                                            target: 1,  tokens: 100 },
  { id: 'races3',    icon: '🏎', label: 'Finish 3 races',           reasons: ['racing_win', 'racing_loss'],                                 target: 3,  tokens: 130 },
  { id: 'runner1',   icon: '🏃', label: 'Play a round of Neon Runner', reasons: ['runner_score'],                                            target: 1,  tokens: 80  },
  { id: 'golf2',     icon: '⛳', label: 'Finish 2 golf holes',       reasons: ['golf_hole'],                                                 target: 2,  tokens: 110 },
  { id: 'saves3',    icon: '🧤', label: 'Make 3 soccer saves',      reasons: ['soccer_save'],                                               target: 3,  tokens: 110 },
  { id: 'kills5',    icon: '⚔️', label: 'Defeat 5 dungeon enemies', reasons: ['roguelike_kill'],                                            target: 5,  tokens: 140 }
];
const DAILY_STREAK_BONUS_PER_DAY = 50;
const DAILY_STREAK_BONUS_CAP = 500;

// ---------------------------------------------------------------------------
// Daily Spin Wheel
// ---------------------------------------------------------------------------
// One free spin per account per calendar day. Mostly a token payout with a
// couple of rarer, more exciting slices — a big token jackpot and a free
// Loot Crate. Wedge order here also defines the visual order on the wheel
// client-side, so don't reorder without checking the client's angle math.
const SPIN_WHEEL = [
  { id: 'small_tokens',  label: '100 Tokens',      icon: '🪙', weight: 30, tokens: 100 },
  { id: 'medium_tokens', label: '250 Tokens',       icon: '🪙', weight: 25, tokens: 250 },
  { id: 'large_tokens',  label: '500 Tokens',       icon: '🪙', weight: 18, tokens: 500 },
  { id: 'free_crate',    label: 'Free Loot Crate',  icon: '📦', weight: 12, freeCrate: true },
  { id: 'xp_boost',      label: '400 Bonus XP',     icon: '✨', weight: 10, xp: 400 },
  { id: 'jackpot',       label: 'JACKPOT — 2,000',  icon: '💎', weight: 5,  tokens: 2000 }
];

function rollSpinWheel() {
  const total = SPIN_WHEEL.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < SPIN_WHEEL.length; i++) {
    if (roll < SPIN_WHEEL[i].weight) return { index: i, wedge: SPIN_WHEEL[i] };
    roll -= SPIN_WHEEL[i].weight;
  }
  return { index: 0, wedge: SPIN_WHEEL[0] };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Small deterministic PRNG seeded from a string, so every account gets the
// exact same 3 challenges on a given date without needing a DB round trip.
function seededPick(seedStr, pool, count) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pickable = pool.slice();
  const picked = [];
  for (let i = 0; i < count && pickable.length; i++) {
    const idx = Math.floor(rand() * pickable.length);
    picked.push(pickable.splice(idx, 1)[0]);
  }
  return picked;
}

// Mutates wallet.daily in place, rolling a fresh set of 3 challenges if it's
// a new day. Does NOT save — caller is responsible for that.
function ensureDailyChallenges(wallet) {
  const today = todayKey();
  if (!wallet.daily || wallet.daily.date !== today) {
    // Missed a full day without clearing all 3 challenges? Streak resets.
    if (wallet.dailyLastPerfectDate && wallet.dailyLastPerfectDate !== today && wallet.dailyLastPerfectDate !== yesterdayKey()) {
      wallet.dailyStreak = 0;
    }
    const picked = seededPick(today, CHALLENGE_POOL, 3);
    wallet.daily = {
      date: today,
      challenges: picked.map(c => ({ id: c.id, icon: c.icon, label: c.label, reasons: c.reasons, target: c.target, tokens: c.tokens, progress: 0, claimed: false }))
    };
  }
}

// Advances progress on any of today's challenges that match this reason.
// Caller (wallet/earn or lootcrate/open) is responsible for saving.
function updateDailyChallenges(wallet, reason, qty) {
  ensureDailyChallenges(wallet);
  wallet.daily.challenges.forEach(c => {
    if (!c.claimed && c.reasons.includes(reason)) {
      c.progress = Math.min(c.target, c.progress + qty);
    }
  });
}

// ---------------------------------------------------------------------------
// Prestige
// ---------------------------------------------------------------------------
// Once a player has effectively "finished" the level track (hit the level
// cap), they can voluntarily reset their level/XP and per-game leaderboard
// stats in exchange for a permanent badge color, a title, and a token bonus.
// Achievements, tokens already banked, owned themes, and crate cosmetics are
// NOT reset — this is a progression reset, not a punishment.
const PRESTIGE_REQUIRED_LEVEL = 100;
const PRESTIGE_TIERS = {
  1: { name: 'Prestige I',   badgeColor: '#c0c0c0', tokenReward: 5000,  border: 'prestige-1-border', title: 'Prestige I' },
  2: { name: 'Prestige II',  badgeColor: '#ffd700', tokenReward: 8000,  border: 'prestige-2-border', title: 'Prestige II' },
  3: { name: 'Prestige III', badgeColor: '#2de2c5', tokenReward: 12000, border: 'prestige-3-border', title: 'Prestige III' }
};
const MAX_PRESTIGE = 3;

// ---------------------------------------------------------------------------
// Community-Created Cosmetics
// ---------------------------------------------------------------------------
// Players submit avatar/banner/theme ideas; everyone votes once per category
// per calendar month; an admin finalizes the month, and the winning entry
// becomes a free, permanent collectible for every account. Winning theme
// submissions are merged into the shop catalog at runtime (and reloaded from
// the DB on boot) via COMMUNITY_SHOP_THEMES.
const COSMETIC_CATEGORIES = ['avatar', 'banner', 'theme'];
const COMMUNITY_SHOP_THEMES = {}; // populated from cosmetic_winners on boot + on finalize

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7); // e.g. "2026-08"
}

// ---------------------------------------------------------------------------
// Community Goal
// ---------------------------------------------------------------------------
// A single shared counter every player contributes to just by opening loot
// crates. When it hits its target, every known user gets a one-time reward.
const COMMUNITY_GOAL_TARGET = 1000000;
const COMMUNITY_GOAL_THEME_ID = 'crate_legion';
const COMMUNITY_GOAL_THEME = { name: 'Crate Legion', cost: 0, type: 'community_goal', community: true, cyan: '#ffd700', pink: '#ff8c00', gold: '#fff4c2', bg: '#1a1400', bgPanel: '#241d00', bgPanelRaised: '#332800', border: '#4d3d00' };

async function bumpCommunityGoal(amount) {
  try {
    const { rows } = await pool.query(
      `UPDATE community_goal SET progress = LEAST(target, progress + $1) WHERE id = 1 RETURNING progress, target, completed`,
      [amount]
    );
    const row = rows[0];
    if (row && !row.completed && row.progress >= row.target) {
      const flip = await pool.query(`UPDATE community_goal SET completed = true, completed_at = now() WHERE id = 1 AND completed = false RETURNING id`);
      if (flip.rows.length) {
        await grantCommunityGoalRewards();
      }
    }
  } catch (e) {
    console.error('Community goal update failed:', e);
  }
}

async function grantCommunityGoalRewards() {
  await withWriteLock(async () => {
    const data = await loadData();
    USERS.forEach(u => {
      const wallet = data[u].wallet;
      wallet.tokens += 2500;
      if (!wallet.titles.includes('Crate Legion')) wallet.titles.push('Crate Legion');
      if (!wallet.borders.includes('community-goal-border')) wallet.borders.push('community-goal-border');
      if (!wallet.owned.includes(COMMUNITY_GOAL_THEME_ID)) wallet.owned.push(COMMUNITY_GOAL_THEME_ID);
    });
    await saveData(data);
  });
  logAdminAction('community_goal_completed', { target: COMMUNITY_GOAL_TARGET });
}

// ---------------------------------------------------------------------------
// Loot Crates
// ---------------------------------------------------------------------------
// Crates cost tokens to open and pay out one of four reward types: an
// exclusive avatar, an exclusive banner, a random theme the player doesn't
// already own, or a token jackpot — with rarer tiers weighted toward the
// bigger jackpots and guaranteeing something exclusive at Legendary.
const LOOT_CRATE_COST = 750;

// Cosmetics that can ONLY come from a crate — never sold directly, never in
// the normal avatar/banner picker until unlocked.
const CRATE_EXCLUSIVE_AVATARS = ['🐲', '🦄', '👽', '🎃', '🧛', '🦁', '🐯', '🦈'];
const CRATE_EXCLUSIVE_BANNERS = ['aurora', 'magma', 'frost', 'royal'];

const CRATE_RARITY_TABLE = [
  { id: 'common',    weight: 60, tokenRange: [100, 300] },
  { id: 'rare',      weight: 25, tokenRange: [300, 700] },
  { id: 'epic',      weight: 12, tokenRange: [700, 1500] },
  { id: 'legendary', weight: 3,  tokenRange: [2000, 5000] }
];

function rollCrateRarity() {
  const total = CRATE_RARITY_TABLE.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of CRATE_RARITY_TABLE) {
    if (roll < r.weight) return r;
    roll -= r.weight;
  }
  return CRATE_RARITY_TABLE[0];
}

// Mutates wallet in place with one random crate reward. Returns
// { rarity, rewardType, rewardValue } describing what was won.
function rollLootCrateReward(wallet) {
  if (!Array.isArray(wallet.unlockedAvatars)) wallet.unlockedAvatars = [];
  if (!Array.isArray(wallet.unlockedBanners)) wallet.unlockedBanners = [];

  const rarity = rollCrateRarity();
  const types = ['avatar', 'banner', 'theme', 'tokens'];
  let rewardType = types[Math.floor(Math.random() * types.length)];
  let rewardValue = null;

  if (rewardType === 'avatar') {
    const pool = CRATE_EXCLUSIVE_AVATARS.filter(a => !wallet.unlockedAvatars.includes(a));
    if (pool.length === 0) { rewardType = 'tokens'; }
    else { rewardValue = pool[Math.floor(Math.random() * pool.length)]; wallet.unlockedAvatars.push(rewardValue); }
  }
  if (rewardType === 'banner') {
    const pool = CRATE_EXCLUSIVE_BANNERS.filter(b => !wallet.unlockedBanners.includes(b));
    if (pool.length === 0) { rewardType = 'tokens'; }
    else { rewardValue = pool[Math.floor(Math.random() * pool.length)]; wallet.unlockedBanners.push(rewardValue); }
  }
  if (rewardType === 'theme') {
    const pool = Object.keys(SHOP_ITEMS).filter(id => SHOP_ITEMS[id].type !== 'upgrade' && !SHOP_ITEMS[id].limited && !wallet.owned.includes(id));
    if (pool.length === 0) { rewardType = 'tokens'; }
    else { rewardValue = pool[Math.floor(Math.random() * pool.length)]; wallet.owned.push(rewardValue); }
  }
  if (rewardType === 'tokens') {
    const [lo, hi] = rarity.tokenRange;
    rewardValue = Math.floor(lo + Math.random() * (hi - lo));
    wallet.tokens += rewardValue;
  }

  if (!wallet.stats) wallet.stats = { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0, maxTokensHeld: 0, crateOpens: 0, legendaryCratePulls: 0 };
  wallet.stats.crateOpens = (wallet.stats.crateOpens || 0) + 1;
  wallet.stats.maxTokensHeld = Math.max(wallet.stats.maxTokensHeld || 0, wallet.tokens);
  if (rarity.id === 'legendary') wallet.stats.legendaryCratePulls = (wallet.stats.legendaryCratePulls || 0) + 1;

  return { rarity: rarity.id, rewardType, rewardValue };
}

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

// Password required to edit the Update Log through the secret admin panel.
// Override by setting ADMIN_PASSWORD in the environment before starting the server.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN_123';
const DEFAULT_UPDATELOG = `=== LEVEL 7 UPDATE LOG ===

[2026-08-05] BETTER BOT AI — Street Soccer, Apex Loop, and Tank Duel bots got smarter instead of just chasing you around:
  • STREET SOCCER — the bot now predicts where the ball is actually heading instead of chasing its current spot, holds better goalkeeper position on shots aimed at it, and shoots with intent — lobbing over you if you're in the way, or driving it low and fast through a clear lane.
  • APEX LOOP — the bot looks for a passing lane and swings wide to overtake when it's closing in behind you, commits to drifting through sharp corners on Hard instead of slowing down, and self-corrects hard back onto the track if it drifts off instead of ignoring it.
  • TANK DUEL — the bot now dodges your incoming shots by reading their trajectory, uses the map's cover to flank around obstacles when it doesn't have a clean shot, and leads its aim at where you're moving instead of where you were.

[2026-08-04] SHOP — merge unlocks now live in their own column on the right of the shop instead of mixed in with themes. Also added the Trio: Yuta, Ryu & Uro (8000 tokens, the most expensive companion theme), plus a Trio Merge Unlock (3000 tokens) — the priciest merge yet. All three react to your runs, and sometimes go back and forth arguing about you, with Uro needling the other two's optimism.

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

[2026-08-04] SHOP — new theme: Yuta & Ryu (3000 tokens). Pink-to-blue gradient background and buttons. Two companions instead of one — most of the time only one of them reacts to how you did, but sometimes they turn and talk to each other about you instead.
[2026-08-04] ACCOUNTS — welcome DOM_FOOTY and XAVIER_12 to the roster.
[2026-08-03] SHOP — Zip Merge Unlock (1500 tokens, requires owning Zip). Once unlocked, you can enable/disable Zip's commentary independently from your equipped theme — keep whatever colors and background you like and still get bullied. Toggle it from her card in the shop.
[2026-08-03] SHOP — Royal Velvet reworked into Crown Jewels (gold/green/red). Three new themes: Amethyst Veil, Coral Reef, Solar Flare. And Goose — 9000 tokens, the priciest cosmetic yet, plasters a goose illustration across the background and every single button on the site. Purely cosmetic.
[2026-07-31] SHOP — six new cosmetic themes: Inferno Core (volcanic reds/orange), Abyssal Trench (deep-sea teal/black), Galaxy Drift (nebula purple/pink), Gold Rush (desert gold/brown), Static Noise (glitchy black-and-white), and Chip — a 3000-token companion theme, same price as Zip, but Chip is nice about it.
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
      if (typeof w.companion === 'undefined') w.companion = null;
      if (w.companion === 'zip' && (!w.owned.includes('zip') || !w.owned.includes('zipmerge'))) w.companion = null;
      if (w.companion === 'duo' && (!w.owned.includes('duo') || !w.owned.includes('duomerge'))) w.companion = null;
      if (w.companion === 'uro' && (!w.owned.includes('uro') || !w.owned.includes('uromerge'))) w.companion = null;
      if (w.companion === 'trio' && (!w.owned.includes('trio') || !w.owned.includes('triomerge'))) w.companion = null;
      if (!Array.isArray(w.achievements)) w.achievements = [];
      if (!w.stats || typeof w.stats !== 'object') {
        w.stats = { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0, maxTokensHeld: 0, crateOpens: 0, legendaryCratePulls: 0 };
      } else {
        for (const key of ['bricksBroken', 'racesFinished', 'winStreak', 'bestWinStreak', 'tokensEarnedLifetime', 'secondsPlayed', 'maxTokensHeld', 'crateOpens', 'legendaryCratePulls']) {
          if (typeof w.stats[key] !== 'number') w.stats[key] = 0;
        }
      }
      if (!Array.isArray(w.titles)) w.titles = [];
      if (!Array.isArray(w.borders)) w.borders = [];
      if (!Array.isArray(w.seasonBadges)) w.seasonBadges = [];
      if (typeof w.xp !== 'number') w.xp = 0;
      if (typeof w.level !== 'number') w.level = computeLevel(w.xp).level;
      if (!Array.isArray(w.unlockedAvatars)) w.unlockedAvatars = [];
      if (!Array.isArray(w.unlockedBanners)) w.unlockedBanners = [];
      if (!AVATARS.includes(w.avatar) && !w.unlockedAvatars.includes(w.avatar)) w.avatar = '🙂';
      if (!BANNERS.includes(w.banner) && !w.unlockedBanners.includes(w.banner)) w.banner = 'default';
      if (!Array.isArray(w.friends)) w.friends = [];
      if (!Array.isArray(w.pendingGifts)) w.pendingGifts = [];
      if (typeof w.animatedName !== 'boolean') w.animatedName = false;
      if (!w.createdAt) w.createdAt = new Date().toISOString();
      if (!w.gamePlays || typeof w.gamePlays !== 'object') w.gamePlays = {};
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
      if (typeof w.prestige !== 'number') w.prestige = 0;
      if (typeof w.prestigeBadgeColor === 'undefined') w.prestigeBadgeColor = null;
      if (typeof w.daily === 'undefined') w.daily = null;
      if (typeof w.dailyStreak !== 'number') w.dailyStreak = 0;
      if (typeof w.dailyBestStreak !== 'number') w.dailyBestStreak = 0;
      if (typeof w.dailyLastPerfectDate === 'undefined') w.dailyLastPerfectDate = null;
      if (typeof w.lastSpinDate === 'undefined') w.lastSpinDate = null;
    }
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

  // Community-created cosmetics: submissions + one-vote-per-category-per-month.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cosmetic_submissions (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      preview TEXT NOT NULL,
      month_key TEXT NOT NULL,
      votes INTEGER NOT NULL DEFAULT 0,
      winner BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS cosmetic_submissions_month_idx ON cosmetic_submissions (month_key, category)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cosmetic_votes (
      user_id TEXT NOT NULL,
      submission_id INTEGER NOT NULL REFERENCES cosmetic_submissions(id),
      month_key TEXT NOT NULL,
      category TEXT NOT NULL,
      PRIMARY KEY (user_id, month_key, category)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cosmetic_winners (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL REFERENCES cosmetic_submissions(id),
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      preview TEXT NOT NULL,
      creator TEXT NOT NULL,
      month_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Community Goal: one shared row, bumped by 1 every time anyone opens a
  // loot crate (see /api/lootcrate/open).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_goal (
      id INTEGER PRIMARY KEY DEFAULT 1,
      target BIGINT NOT NULL DEFAULT ${COMMUNITY_GOAL_TARGET},
      progress BIGINT NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      CONSTRAINT single_row_goal CHECK (id = 1)
    )
  `);
  const goalRows = await pool.query('SELECT id FROM community_goal WHERE id = 1');
  if (goalRows.rows.length === 0) {
    await pool.query('INSERT INTO community_goal (id, target, progress) VALUES (1, $1, 0)', [COMMUNITY_GOAL_TARGET]);
  }

  // Arcade Builder: user-made game configs from templates (Clicker,
  // Platformer, Shooter, Racing, Survival). Not runnable yet — this just
  // saves the customization choices and lets creators publish them to the
  // community list.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_games (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      published BOOLEAN NOT NULL DEFAULT false,
      plays INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS custom_games_user_idx ON custom_games (user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS custom_games_published_idx ON custom_games (published)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_game_likes (
      user_id TEXT NOT NULL,
      game_id INTEGER NOT NULL REFERENCES custom_games(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, game_id)
    )
  `);

  // Clans: a named group with a short tag, a leader, and members. Membership
  // is one clan per player, enforced by the primary key on clan_members.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clans (
      id SERIAL PRIMARY KEY,
      tag TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      motto TEXT NOT NULL DEFAULT '',
      colour TEXT NOT NULL DEFAULT '#2de2c5',
      owner TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clan_members (
      user_id TEXT PRIMARY KEY,
      clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS clan_members_clan_idx ON clan_members (clan_id)');

  // Bug reports: anyone can file one, admins triage them from the panel.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bug_reports (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      area TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS bug_reports_status_idx ON bug_reports (status, id DESC)');

  // Tournaments: a timed contest on one cabinet's stat. Each entrant's value
  // is recorded when they join, so the winner is decided by *improvement*
  // during the window rather than by whoever already had the best score.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      game TEXT NOT NULL,
      stat_key TEXT NOT NULL,
      prize INTEGER NOT NULL DEFAULT 0,
      ends_at TIMESTAMPTZ NOT NULL,
      settled BOOLEAN NOT NULL DEFAULT false,
      winner TEXT,
      winning_gain INTEGER,
      final_standings JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Older rows predate the frozen-standings column.
  await pool.query('ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS final_standings JSONB');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_entries (
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      start_value INTEGER NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tournament_id, user_id)
    )
  `);

  // Reload any previously-finalized community theme winners into memory so
  // they keep showing up in the shop after a restart.
  try {
    const { rows: themeWinners } = await pool.query("SELECT submission_id, name, preview FROM cosmetic_winners WHERE category = 'theme'");
    themeWinners.forEach(row => {
      try {
        const preview = JSON.parse(row.preview);
        COMMUNITY_SHOP_THEMES['community_' + row.submission_id] = Object.assign({ name: row.name, cost: 0, community: true }, preview);
      } catch (e) {
        console.error('Failed to parse community theme preview:', e);
      }
    });
  } catch (e) {
    console.error('Failed to reload community theme winners:', e);
  }
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

const http = require('http');
const { WebSocketServer } = require('ws');

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
  if (isRateLimited(ip, 30, 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts from this network. Try again in a minute.' });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required.' });
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

// Where the playable site actually lives. In production that's GitHub Pages;
// this server is API + realtime only, and bounces anyone who lands on it to
// the real front end. Override with SITE_ORIGIN if the Pages URL changes.
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://rift9437-alt.github.io/RIFT')
  .replace(/\/+$/, '');

// For local development, `SERVE_STATIC=1 npm start` puts the front end back on
// this server so "npm start" + one URL is still all you need. Only public/ is
// exposed, so server.js, package.json and any local data files stay
// unreachable no matter what path is requested.
const PUBLIC_DIR = path.join(__dirname, 'public');
const SERVE_STATIC = process.env.SERVE_STATIC === '1';

if (SERVE_STATIC) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));
  app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
} else {
  // Anything that isn't the API, the socket, or a health check is a person who
  // typed the backend URL by mistake — send them to the site. Registered last
  // (see the bottom of this file) so it can't shadow a real route.
  app.get('/healthz', (req, res) => res.json({ ok: true, site: SITE_ORIGIN }));
}

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

      checkAchievements(data, user);
      await saveData(data);
      return data;
    });

    // Push a patch, not the whole table. The full standings are ~15KB and a
    // score lands every few seconds across the arcade; one user's changed
    // game is all anyone needs to update their copy.
    broadcastEvent('scores', { user, game, stats: updated[user][game] });
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

// ---------------------------------------------------------------------------
// Party Mode
// ---------------------------------------------------------------------------
// Lightweight, in-memory party rooms (like `sessions` above — ephemeral is
// fine here, a restart just means everyone re-creates their room). A room
// has a host, a member list, and once started a single randomly-picked
// game that every member races to beat; highest submitted score wins.
const PARTY_GAMES = [
  'soccer', 'racing', 'tank', 'runner', 'wildduel', 'asteroid', 'breaker',
  'roguelike', 'comet', 'tunnel', 'depths', 'stack', 'golf', 'sumo',
  'towerdefense', 'parkour', 'zombie', 'pirate', 'samurai', 'policechase',
  'tactics', 'runeduel', 'warlord',
  'evolution', 'flood', 'hoops', 'burger', 'tag', 'robot'
];
const partyRooms = new Map(); // code -> room
const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // rooms auto-expire after 3h idle

function makeRoomCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (partyRooms.has(code));
  return code;
}

function pruneExpiredRooms(){
  const now = Date.now();
  for (const [code, room] of partyRooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) partyRooms.delete(code);
  }
}

function publicRoom(room){
  return {
    code: room.code,
    host: room.host,
    members: room.members,
    status: room.status, // 'waiting' | 'playing' | 'finished'
    game: room.game,
    scores: room.scores,
    winner: room.winner,
    createdAt: room.createdAt
  };
}

app.post('/api/party/create', async (req, res) => {
  const { user } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  pruneExpiredRooms();
  const code = makeRoomCode();
  const room = {
    code, host: user, members: [user], status: 'waiting',
    game: null, scores: {}, winner: null,
    createdAt: Date.now(), lastActivity: Date.now()
  };
  partyRooms.set(code, room);
  res.json(publicRoom(room));
});

app.post('/api/party/join', async (req, res) => {
  const { user, code } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const room = partyRooms.get((code || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.status !== 'waiting') return res.status(400).json({ error: 'That party has already started' });
  if (!room.members.includes(user)) room.members.push(user);
  room.lastActivity = Date.now();
  res.json(publicRoom(room));
});

app.post('/api/party/leave', async (req, res) => {
  const { user, code } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const room = partyRooms.get((code || '').toUpperCase());
  if (!room) return res.json({ ok: true });
  room.members = room.members.filter(m => m !== user);
  delete room.scores[user];
  if (room.members.length === 0) {
    partyRooms.delete(room.code);
  } else if (room.host === user) {
    room.host = room.members[0]; // hand off host to whoever's left
  }
  room.lastActivity = Date.now();
  res.json({ ok: true });
});

app.get('/api/party/room', async (req, res) => {
  const { code } = req.query || {};
  const room = partyRooms.get((code || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(publicRoom(room));
});

app.post('/api/party/start', async (req, res) => {
  const { user, code } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const room = partyRooms.get((code || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.host !== user) return res.status(403).json({ error: 'Only the host can start the party' });
  if (room.status !== 'waiting') return res.status(400).json({ error: 'Party already started' });
  room.game = PARTY_GAMES[Math.floor(Math.random() * PARTY_GAMES.length)];
  room.status = 'playing';
  room.scores = {};
  room.winner = null;
  room.lastActivity = Date.now();
  res.json(publicRoom(room));
});

// Any member reports their run's score once for the room's chosen game.
// Highest score wins once everyone still in the room has submitted (or the
// host force-ends it early via /api/party/end).
app.post('/api/party/score', async (req, res) => {
  const { user, code, score } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const room = partyRooms.get((code || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.status !== 'playing') return res.status(400).json({ error: 'Party is not in progress' });
  if (!room.members.includes(user)) return res.status(403).json({ error: 'Not in this party' });
  const safeScore = Math.max(0, Math.min(1000000, Number(score) || 0));
  room.scores[user] = safeScore;
  room.lastActivity = Date.now();
  if (room.members.every(m => typeof room.scores[m] === 'number')) {
    finishParty(room);
  }
  res.json(publicRoom(room));
});

function finishParty(room){
  let best = null;
  for (const m of room.members) {
    const s = room.scores[m] || 0;
    if (!best || s > best.score) best = { user: m, score: s };
  }
  room.status = 'finished';
  room.winner = best;
}

app.post('/api/party/end', async (req, res) => {
  const { user, code } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const room = partyRooms.get((code || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.host !== user) return res.status(403).json({ error: 'Only the host can end the party' });
  if (room.status !== 'playing') return res.status(400).json({ error: 'Party is not in progress' });
  finishParty(room);
  room.lastActivity = Date.now();
  res.json(publicRoom(room));
});

app.post('/api/party/rematch', async (req, res) => {
  const { user, code } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const room = partyRooms.get((code || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.host !== user) return res.status(403).json({ error: 'Only the host can start a rematch' });
  room.status = 'waiting';
  room.game = null;
  room.scores = {};
  room.winner = null;
  room.lastActivity = Date.now();
  res.json(publicRoom(room));
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
    const posted = chatRowToMessage(inserted.rows[0]);
    broadcastEvent('chat', { message: posted });
    const from = Math.max(0, parseInt(since, 10) || 0);
    const messages = from > 0 ? await loadChatSince(from) : [posted];
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

// ---------------------------------------------------------------------------
// Rotating shop
// ---------------------------------------------------------------------------
// Daily, weekly and event slots that discount items already in the catalog.
// The rotation is *derived* from the date rather than stored, so every client
// sees the same offers at the same time, a restart doesn't reroll them, and
// there's no extra table to keep in sync. The discount is applied on the
// server at purchase time — the client never sends a price.
const ROTATION = {
  daily:  { slots: 3, min: 0.10, max: 0.30, label: 'Daily Deals' },
  weekly: { slots: 2, min: 0.25, max: 0.45, label: 'Weekly Feature' },
  secret: { slots: 1, min: 0.50, max: 0.60, label: 'Back Room' }
};

// A small deterministic PRNG (mulberry32) seeded from a string, so
// "2026-08-10:daily" always produces the same picks on every process.
function seededRandom(seed){
  let h = 1779033703 ^ seed.length;
  for(let i = 0; i < seed.length; i++){
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayKey(now){ return new Date(now || Date.now()).toISOString().slice(0, 10); }
function weekKey(now){
  // ISO-ish week bucket: days since epoch / 7. Good enough to roll weekly and
  // to stay stable inside a week.
  const d = new Date(now || Date.now());
  return 'w' + Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 604800000);
}

// Items eligible for a discount: real cosmetics only. Free, limited-edition
// and community-goal items stay out so the rotation can't undercut or
// give away something that's meant to be earned.
function rotatableIds(){
  return Object.keys(SHOP_ITEMS).filter(id => {
    const it = SHOP_ITEMS[id];
    return it.type !== 'upgrade' && it.type !== 'community_goal'
        && !it.limited && it.cost > 0;
  }).sort();
}

function rollSlots(kind, key){
  const cfg = ROTATION[kind];
  const rand = seededRandom(key + ':' + kind);
  const pool = rotatableIds();
  const picks = [];
  const taken = new Set();
  for(let i = 0; i < cfg.slots && taken.size < pool.length; i++){
    let id;
    do { id = pool[Math.floor(rand() * pool.length)]; } while(taken.has(id));
    taken.add(id);
    // Quantise the discount to whole 5% steps so it reads as a real price tag.
    const spread = cfg.max - cfg.min;
    const pct = Math.round((cfg.min + rand() * spread) * 20) / 20;
    const base = SHOP_ITEMS[id].cost;
    picks.push({
      id,
      name: SHOP_ITEMS[id].name,
      base,
      cost: Math.max(1, Math.round(base * (1 - pct))),
      discount: Math.round(pct * 100)
    });
  }
  return picks;
}

// The single source of truth for "what does this item cost right now".
// Both the shop endpoint and the purchase endpoint call this, so a discount
// shown in the UI is exactly the one charged.
function effectivePrice(itemId, user, data){
  const base = (SHOP_ITEMS[itemId] || COMMUNITY_SHOP_THEMES[itemId] || {}).cost;
  if (typeof base !== 'number') return null;
  const offers = currentRotation(user, data);
  let best = base;
  ['daily', 'weekly', 'secret'].forEach(kind => {
    const hit = (offers[kind] || []).find(o => o.id === itemId);
    if (hit && hit.cost < best) best = hit.cost;
  });
  return best;
}

// The Back Room only opens for players who've actually found a secret, which
// is what `secretsFound` on the wallet tracks.
function currentRotation(user, data){
  const now = Date.now();
  const out = {
    daily: rollSlots('daily', dayKey(now)),
    weekly: rollSlots('weekly', weekKey(now)),
    secret: [],
    labels: { daily: ROTATION.daily.label, weekly: ROTATION.weekly.label, secret: ROTATION.secret.label },
    resetsAt: {
      daily: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1),
      weekly: (Math.floor(now / 604800000) + 1) * 604800000
    }
  };
  const wallet = user && data && data[user] ? data[user].wallet : null;
  if (wallet && (wallet.secretsFound || 0) > 0) {
    out.secret = rollSlots('secret', dayKey(now) + ':' + (wallet.secretsFound || 0));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Global counters
// ---------------------------------------------------------------------------
// Arcade-wide totals, derived from the player records rather than kept as a
// separate counter — nothing to drift out of sync, and a wiped leaderboard
// is reflected immediately. Cached briefly because it walks every record.
let globalStatsCache = { at: 0, value: null };
const GLOBAL_STATS_TTL_MS = 20000;

async function globalStats(){
  if (globalStatsCache.value && Date.now() - globalStatsCache.at < GLOBAL_STATS_TTL_MS) {
    return globalStatsCache.value;
  }
  const data = await loadData();
  const totals = {
    tokensEarned: 0, secondsPlayed: 0, gamesPlayed: 0, secretsFound: 0,
    cratesOpened: 0, achievementsUnlocked: 0, levelsGained: 0
  };
  const perGame = {};
  USERS.forEach(u => {
    const w = (data[u] && data[u].wallet) || {};
    const st = w.stats || {};
    totals.tokensEarned += st.tokensEarnedLifetime || 0;
    totals.secondsPlayed += st.secondsPlayed || 0;
    totals.cratesOpened += st.crateOpens || 0;
    totals.secretsFound += w.secretsFound || 0;
    totals.achievementsUnlocked += (w.achievements || []).length;
    totals.levelsGained += Math.max(0, (w.level || 1) - 1);
    Object.entries(w.gamePlays || {}).forEach(([g, n]) => {
      perGame[g] = (perGame[g] || 0) + n;
      totals.gamesPlayed += n;
    });
  });
  const busiest = Object.entries(perGame).sort((a, b) => b[1] - a[1])[0];
  const value = {
    totals,
    perGame,
    busiest: busiest ? { game: busiest[0], name: GAME_DISPLAY_NAMES[busiest[0]] || busiest[0], plays: busiest[1] } : null,
    players: USERS.length
  };
  globalStatsCache = { at: Date.now(), value };
  return value;
}

// ---------------------------------------------------------------------------
// Lore — the Level 7 archive
// ---------------------------------------------------------------------------
// Fragments of the arcade's backstory, each unlocked by something you
// actually did. They're ordered, and each one points at what unlocks the
// next, so reading the archive doubles as a trail of things to go and try.
const LORE = [
  { id: 'l1', title: 'The Lease',
    body: "Level 7 was the seventh floor of a building that only had six. The lease was signed anyway. The landlord never came back for the paperwork, and by the time anyone checked, the stairwell had one more landing than the blueprints allowed.",
    hint: 'Play anything. The floor notices.',
    test: w => (w.stats?.secondsPlayed || 0) > 0 || Object.keys(w.gamePlays || {}).length > 0 },

  { id: 'l2', title: 'First Keyholder',
    body: "Ten keys were cut. Nobody remembers who cut them. Each one opens the same door, and the door has never once been locked — which is either a joke at the keyholders' expense, or the whole point.",
    hint: 'Win a game. Any game.',
    test: (w, totals) => totals.wins >= 1 },

  { id: 'l3', title: 'The Token Press',
    body: "The tokens aren't currency anywhere else. They were struck in the basement on a machine that predates the arcade, out of an alloy the smelter's records list only as 'floor-stock'. They are always warm.",
    hint: 'Earn 1,000 tokens across your lifetime.',
    test: w => (w.stats?.tokensEarnedLifetime || 0) >= 1000 },

  { id: 'l4', title: 'Cabinet Thirteen',
    body: "There is no cabinet thirteen. There is a gap in the numbering where it should be, and the power draw on that circuit is measurably higher than the empty space accounts for. Management has been asked. Management has not answered.",
    hint: 'Play ten different cabinets.',
    test: w => Object.keys(w.gamePlays || {}).length >= 10 },

  { id: 'l5', title: 'The Long Game',
    body: "One keyholder is said to have played for eleven hours straight without touching the exit. When they finally stood up, the high score table had their initials on every row, and none of the rest of us had put a coin in.",
    hint: 'Spend an hour on the machines.',
    test: w => (w.stats?.secondsPlayed || 0) >= 3600 },

  { id: 'l6', title: 'What the Crates Are For',
    body: "The crates arrive already sealed. Nobody delivers them. Opening one has never yielded anything the arcade didn't already contain — which raises the question of why anyone bothered to seal them.",
    hint: 'Open five loot crates.',
    test: w => (w.stats?.crateOpens || 0) >= 5 },

  { id: 'l7', title: 'The Seventh Secret',
    body: "Every secret in this building is a door. Every door leads back into the same room. The keyholders who found the most of them describe the feeling not as discovery but as recognition — as though the arcade had been waiting for them to catch up.",
    hint: 'Find three secrets.',
    test: w => (w.secretsFound || 0) >= 3 },

  { id: 'l8', title: 'Closing Time',
    body: "There is no closing time. The sign says there is. The sign has said so since before any of us had keys, and the lights have never once gone out. Whatever the seventh floor is for, it is not for leaving.",
    hint: 'Reach level 10.',
    test: w => (w.level || 1) >= 10 }
];

function loreFor(user, data){
  const w = (data[user] && data[user].wallet) || {};
  const totals = {
    wins: Object.keys(DEFAULT_STATS).reduce((sum, g) =>
      sum + ((data[user] && data[user][g] && typeof data[user][g].wins === 'number') ? data[user][g].wins : 0), 0)
  };
  // Entries unlock in order — a later fragment stays sealed until the ones
  // before it are read, so the archive always tells the story straight.
  let chainBroken = false;
  return LORE.map(entry => {
    const met = !chainBroken && !!entry.test(w, totals);
    if (!met) chainBroken = true;
    return met
      ? { id: entry.id, title: entry.title, body: entry.body, unlocked: true }
      : { id: entry.id, title: '???', body: null, hint: entry.hint, unlocked: false };
  });
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------
// A timed contest on one cabinet's stat. Joining records your current value,
// so the standings rank *improvement during the window* — a player who
// already holds the record starts level with everyone else, and someone who
// joins late can still win. Settling pays the prize once and only once.
function statValue(rec, game, key){
  return (rec && rec[game] && typeof rec[game][key] === 'number') ? rec[game][key] : 0;
}

async function tournamentStandings(t, data){
  const { rows: entries } = await pool.query(
    'SELECT user_id, start_value FROM tournament_entries WHERE tournament_id = $1', [t.id]);
  return entries.map(e => {
    const now = statValue(data[e.user_id], t.game, t.stat_key);
    return { user: e.user_id, start: e.start_value, now, gain: Math.max(0, now - e.start_value) };
  }).sort((a, b) => b.gain - a.gain || a.user.localeCompare(b.user));
}

// Pays out any tournament whose clock has run out. Idempotent: the UPDATE
// only matches while settled is still false, so two concurrent callers
// can't both award the prize.
async function settleDueTournaments(){
  const { rows: due } = await pool.query(
    'SELECT * FROM tournaments WHERE settled = false AND ends_at <= now()');
  if (!due.length) return;
  for (const t of due) {
    try {
      await withWriteLock(async () => {
        const data = await loadData();
        const standings = await tournamentStandings(t, data);
        const top = standings.find(s => s.gain > 0) || null;
        // Freeze the table as it stands right now. Recomputing it later from
        // live stats would let scores set *after* the tournament ended
        // rewrite its history and contradict the recorded winner.
        const claim = await pool.query(
          `UPDATE tournaments SET settled = true, winner = $1, winning_gain = $2,
                  final_standings = $3::jsonb
           WHERE id = $4 AND settled = false RETURNING id`,
          [top ? top.user : null, top ? top.gain : 0,
           JSON.stringify(standings), t.id]);
        if (!claim.rows.length) return; // somebody else settled it first
        if (top && t.prize > 0) {
          const w = data[top.user].wallet;
          w.tokens += t.prize;
          if (!w.stats) w.stats = {};
          w.stats.tokensEarnedLifetime = (w.stats.tokensEarnedLifetime || 0) + t.prize;
          await saveData(data);
        }
      });
    } catch (e) {
      console.error('Tournament settle failed:', t.id, e);
    }
  }
}

app.get('/api/tournaments', async (req, res) => {
  try {
    await settleDueTournaments();
    const data = await loadData();
    const { rows } = await pool.query(
      'SELECT * FROM tournaments ORDER BY settled ASC, ends_at DESC LIMIT 12');
    const user = authenticate(req);
    const out = [];
    for (const t of rows) {
      const standings = t.settled && Array.isArray(t.final_standings)
        ? t.final_standings
        : await tournamentStandings(t, data);
      out.push({
        id: t.id, title: t.title, game: t.game,
        gameName: GAME_DISPLAY_NAMES[t.game] || t.game,
        statKey: t.stat_key, prize: t.prize,
        endsAt: t.ends_at, settled: t.settled,
        winner: t.winner, winningGain: t.winning_gain,
        entered: user ? standings.some(s => s.user === user) : false,
        standings: standings.slice(0, 10)
      });
    }
    res.json({ tournaments: out });
  } catch (e) {
    console.error('Tournament list failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/tournaments/join', async (req, res) => {
  const { user, tournamentId } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
    const t = rows[0];
    if (!t) return res.status(404).json({ error: 'No such tournament.' });
    if (t.settled || new Date(t.ends_at) <= new Date()) {
      return res.status(400).json({ error: 'That tournament has finished.' });
    }
    const data = await loadData();
    // ON CONFLICT DO NOTHING keeps a second join from resetting your baseline
    // to a higher value — which would otherwise wipe out your own progress.
    await pool.query(
      `INSERT INTO tournament_entries (tournament_id, user_id, start_value)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [t.id, user, statValue(data[user], t.game, t.stat_key)]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Tournament join failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/admin/tournaments', async (req, res) => {
  const { password, action, title, game, statKey, prize, hours, id } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect admin password' });
  try {
    if (action === 'create') {
      if (!DEFAULT_STATS[game]) return res.status(400).json({ error: 'Unknown game' });
      const key = statKey || Object.keys(DEFAULT_STATS[game])[0];
      if (!(key in DEFAULT_STATS[game])) return res.status(400).json({ error: 'Unknown stat for that game' });
      const hrs = Math.max(1, Math.min(720, Number(hours) || 24));
      const { rows } = await pool.query(
        `INSERT INTO tournaments (title, game, stat_key, prize, ends_at)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval) RETURNING id`,
        [String(title || `${GAME_DISPLAY_NAMES[game] || game} Cup`).slice(0, 60),
         game, key, Math.max(0, Math.min(100000, Number(prize) || 0)), String(hrs)]);
      logAdminAction('tournament_create', { id: rows[0].id, game, key, hrs });
    } else if (action === 'end') {
      await pool.query('UPDATE tournaments SET ends_at = now() WHERE id = $1 AND settled = false', [id]);
      await settleDueTournaments();
      logAdminAction('tournament_end', { id });
    } else if (action === 'delete') {
      await pool.query('DELETE FROM tournaments WHERE id = $1', [id]);
      logAdminAction('tournament_delete', { id });
    }
    const { rows } = await pool.query('SELECT * FROM tournaments ORDER BY id DESC LIMIT 20');
    res.json({ tournaments: rows });
  } catch (e) {
    console.error('Admin tournament action failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/lore', async (req, res) => {
  const user = authenticate(req);
  try {
    const data = await loadData();
    const entries = user ? loreFor(user, data) : LORE.map(e => ({ id: e.id, title: '???', unlocked: false, hint: 'Sign in to read the archive.' }));
    res.json({ entries, total: LORE.length, unlocked: entries.filter(e => e.unlocked).length });
  } catch (e) {
    console.error('Lore fetch failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// The Level 7 Gazette
// ---------------------------------------------------------------------------
// A front page written from whatever actually happened in the arcade —
// record holders, the newest clan, who's been grinding. Derived on request
// so it's never stale, cached briefly because it reads every record.
let gazetteCache = { at: 0, value: null };
const GAZETTE_TTL_MS = 30000;

async function buildGazette(){
  if (gazetteCache.value && Date.now() - gazetteCache.at < GAZETTE_TTL_MS) return gazetteCache.value;
  const data = await loadData();
  const stories = [];

  // Lead story: the board with the biggest gap between first and second.
  let lead = null;
  Object.keys(DEFAULT_STATS).forEach(game => {
    const key = Object.keys(DEFAULT_STATS[game])[0];
    if (!key) return;
    const ranked = USERS
      .map(u => ({ user: u, value: ((data[u] && data[u][game]) || {})[key] || 0 }))
      .sort((a, b) => b.value - a.value);
    if (!ranked[0] || !ranked[0].value) return;
    const gap = ranked[0].value - (ranked[1] ? ranked[1].value : 0);
    if (!lead || gap > lead.gap) {
      // A runner-up on zero hasn't actually played, so don't frame their
      // absence as a "cushion" the size of the whole score.
      const contender = ranked[1] && ranked[1].value > 0 ? ranked[1] : null;
      lead = { game, key, gap, holder: ranked[0].user, value: ranked[0].value,
               runnerUp: contender ? contender.user : null };
    }
  });
  if (lead) {
    const num = n => n.toLocaleString('en-US');
    stories.push({
      kind: 'lead',
      headline: `${lead.holder} RUNS AWAY WITH ${(GAME_DISPLAY_NAMES[lead.game] || lead.game).toUpperCase()}`,
      body: lead.runnerUp
        ? `${num(lead.value)} on the board and a ${num(lead.gap)}-point cushion over ${lead.runnerUp}. Nobody has come close since.`
        : `${num(lead.value)} on the board, and not one other keyholder has posted a score.`
    });
  }

  // Grinder of the moment.
  const busiest = USERS
    .map(u => ({ user: u, secs: ((data[u] && data[u].wallet && data[u].wallet.stats) || {}).secondsPlayed || 0 }))
    .sort((a, b) => b.secs - a.secs)[0];
  if (busiest && busiest.secs > 0) {
    const mins = Math.round(busiest.secs / 60);
    stories.push({
      kind: 'story',
      headline: `${busiest.user} HAS NOT LEFT THE BUILDING`,
      body: `${mins} minute${mins === 1 ? '' : 's'} on the machines and counting. Someone check on them.`
    });
  }

  // Newest clan.
  try {
    const { rows } = await pool.query(
      'SELECT tag, name, owner, motto FROM clans ORDER BY created_at DESC LIMIT 1');
    if (rows.length) {
      stories.push({
        kind: 'story',
        headline: `[${rows[0].tag}] ${rows[0].name.toUpperCase()} OPENS ITS DOORS`,
        body: `Founded by ${rows[0].owner}.` + (rows[0].motto ? ` Their words, not ours: “${rows[0].motto}”.` : '')
      });
    }
  } catch (e) {
    console.error('Gazette clan story failed:', e);
  }

  // Richest keyholder.
  const richest = USERS
    .map(u => ({ user: u, tokens: ((data[u] && data[u].wallet) || {}).tokens || 0 }))
    .sort((a, b) => b.tokens - a.tokens)[0];
  if (richest && richest.tokens > 0) {
    stories.push({
      kind: 'brief',
      headline: 'TOKEN WATCH',
      body: `${richest.user} is sitting on ${richest.tokens.toLocaleString('en-US')} tokens. The press in the basement keeps running regardless.`
    });
  }

  // Open bug reports, so players can see their reports landed somewhere.
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM bug_reports WHERE status = 'open'");
    if (rows[0].n > 0) {
      stories.push({
        kind: 'brief',
        headline: 'MAINTENANCE LOG',
        body: `${rows[0].n} report${rows[0].n === 1 ? '' : 's'} open on the workshop bench. Management is aware. Management is always aware.`
      });
    }
  } catch (e) {
    console.error('Gazette bug story failed:', e);
  }

  const value = { issued: new Date().toISOString(), stories };
  gazetteCache = { at: Date.now(), value };
  return value;
}

app.get('/api/gazette', async (req, res) => {
  try {
    res.json(await buildGazette());
  } catch (e) {
    console.error('Gazette failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/global-stats', async (req, res) => {
  try {
    res.json(await globalStats());
  } catch (e) {
    console.error('Global stats failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// 3D avatar
// ---------------------------------------------------------------------------
// Every player's look is rendered inside everyone else's client, so this is
// validated hard on the way in rather than trusted. Only six-digit hex
// colours and a known hat id survive; anything else is dropped rather than
// stored, so there's nothing a client could smuggle into another player's
// canvas or DOM.
const AVATAR_HATS = ['none', 'cap', 'crown', 'band', 'antenna', 'top'];
const HEX6 = /^#[0-9a-fA-F]{6}$/;

function sanitizeAvatar3d(raw){
  if(!raw || typeof raw !== 'object') return null;
  const out = {};
  for(const key of ['skin', 'shirt', 'pants', 'shoes', 'hatColor']){
    if(!HEX6.test(raw[key])) return null;
    out[key] = String(raw[key]).toLowerCase();
  }
  if(!AVATAR_HATS.includes(raw.hat)) return null;
  out.hat = raw.hat;
  return out;
}

app.post('/api/avatar3d', async (req, res) => {
  const { user, avatar } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const clean = sanitizeAvatar3d(avatar);
  if (!clean) return res.status(400).json({ error: 'That avatar is not valid.' });
  try {
    await withWriteLock(async () => {
      const data = await loadData();
      data[user].wallet.avatar3d = clean;
      await saveData(data);
    });
    // So everyone already in a world sees the change without relogging.
    broadcastEvent('avatar', { user, avatar: clean });
    res.json({ avatar: clean });
  } catch (e) {
    console.error('Avatar save failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Every player's look in one call, so a client entering a world can draw
// everyone correctly straight away instead of per-player lookups.
app.get('/api/avatars', async (req, res) => {
  try {
    const data = await loadData();
    const out = {};
    USERS.forEach(u => { out[u] = (data[u] && data[u].wallet && data[u].wallet.avatar3d) || null; });
    res.json({ avatars: out });
  } catch (e) {
    console.error('Avatar list failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Season 2 — Haunted Arcade
// ---------------------------------------------------------------------------
// Seasonal counters live on the wallet and are only *incremented* while the
// season is live, which is what makes the badges limited. Nothing here ever
// clears one — a pumpkin count from a finished season stays on the profile.
const SPOOKY_EVENTS = {
  pumpkin:    { field: 'pumpkins', max: 5,  reason: 'pumpkin_pick' },
  ghost:      { field: 'ghosts',   max: 3,  reason: 'ghost_banish' },
  midnight:   { flag: 'midnight' },
  thirteenth: { flag: 'thirteenth' }
};

app.post('/api/season/spooky', async (req, res) => {
  const { user, event, qty } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  const def = SPOOKY_EVENTS[event];
  if (!def) return res.status(400).json({ error: 'Unknown event' });
  if (CURRENT_SEASON !== 2) {
    return res.status(400).json({ error: 'That season has ended.' });
  }
  try {
    const out = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (!wallet.spooky) wallet.spooky = { pumpkins: 0, ghosts: 0, midnight: false, thirteenth: false };
      if (def.flag) {
        wallet.spooky[def.flag] = true;
      } else {
        const n = Math.max(0, Math.min(def.max, Number(qty) || 0));
        wallet.spooky[def.field] = (wallet.spooky[def.field] || 0) + n;
        const pay = (REWARDS[def.reason] || 0) * n;
        wallet.tokens += pay;
        if (!wallet.stats) wallet.stats = {};
        wallet.stats.tokensEarnedLifetime = (wallet.stats.tokensEarnedLifetime || 0) + pay;
      }
      checkAchievements(data, user);
      await saveData(data);
      return wallet.spooky;
    });
    res.json({ spooky: out });
  } catch (e) {
    console.error('Spooky event failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/shop/rotation', async (req, res) => {
  const user = authenticate(req);
  try {
    const data = user ? await loadData() : null;
    res.json(currentRotation(user, data));
  } catch (e) {
    console.error('Shop rotation failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/shop/items', (req, res) => {
  res.json(Object.assign({}, SHOP_ITEMS, COMMUNITY_SHOP_THEMES, { [COMMUNITY_GOAL_THEME_ID]: COMMUNITY_GOAL_THEME }));
});

app.get('/api/achievements', async (req, res) => {
  const { user } = req.query || {};
  let unlocked = [];
  if (user && USERS.includes(user)) {
    const data = await loadData();
    unlocked = data[user].wallet.achievements || [];
  }
  const masked = {};
  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    if (a.secret && !unlocked.includes(id)) {
      masked[id] = { name: '???', icon: '❓', desc: 'Secret achievement — keep playing to find out.', secret: true };
    } else {
      masked[id] = a;
    }
  }
  res.json(masked);
});

app.get('/api/season', (req, res) => {
  res.json({ current: CURRENT_SEASON, ...SEASONS[CURRENT_SEASON] });
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
  const amount = Math.round(REWARDS[reason] * safeQty);

  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      wallet.tokens += amount;
      if (!wallet.stats) wallet.stats = { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0, maxTokensHeld: 0, crateOpens: 0, legendaryCratePulls: 0 };
      if (amount > 0) {
        wallet.stats.tokensEarnedLifetime += amount;
        wallet.xp = (wallet.xp || 0) + amount; // XP mirrors tokens earned 1-for-1.
      }
      wallet.stats.maxTokensHeld = Math.max(wallet.stats.maxTokensHeld || 0, wallet.tokens);
      if (reason === 'breaker_brick') wallet.stats.bricksBroken += safeQty;
      // Finding a secret is what opens the shop's Back Room.
      if (reason === 'secret_found') wallet.secretsFound = (wallet.secretsFound || 0) + safeQty;
      if (reason === 'racing_win' || reason === 'racing_loss') wallet.stats.racesFinished += 1;
      if (WIN_REASONS.includes(reason)) {
        wallet.stats.winStreak += 1;
        wallet.stats.bestWinStreak = Math.max(wallet.stats.bestWinStreak, wallet.stats.winStreak);
      } else if (LOSS_REASONS.includes(reason)) {
        wallet.stats.winStreak = 0;
      }
      // Per-game loss counter (for win/loss ratio on the profile page).
      if (LOSS_REASONS.includes(reason)) {
        const g = REASON_TO_GAME[reason];
        if (g && data[user][g] && typeof data[user][g].losses === 'number') data[user][g].losses += 1;
      }
      // Tally which game this action belongs to (for "favourite game").
      const playedGame = REASON_TO_GAME[reason];
      if (playedGame) {
        if (!wallet.gamePlays || typeof wallet.gamePlays !== 'object') wallet.gamePlays = {};
        wallet.gamePlays[playedGame] = (wallet.gamePlays[playedGame] || 0) + 1;
      }
      if (safeQty > 0) updateDailyChallenges(wallet, reason, safeQty);
      checkLevelUp(data, user);
      checkAchievements(data, user);
      await saveData(data);
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
  if (!requireOwnUser(req, res, user)) return;
  const purchasableCatalog = Object.assign({}, SHOP_ITEMS, COMMUNITY_SHOP_THEMES);
  if (!purchasableCatalog[itemId]) {
    return res.status(400).json({ error: 'Unknown item' });
  }
  if (purchasableCatalog[itemId].type === 'community_goal') {
    return res.status(400).json({ error: 'This theme is only unlocked by completing the community goal' });
  }
  flagIfSuspicious(user, 'shop/purchase');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (wallet.owned.includes(itemId)) {
        return { error: 'Already owned' };
      }
      const shopItem = purchasableCatalog[itemId];
      if (shopItem.requires && !wallet.owned.includes(shopItem.requires)) {
        return { error: 'Missing prerequisite' };
      }
      // Never trust a price from the client — resolve it here, from the same
      // function that built the offer the player clicked.
      const cost = effectivePrice(itemId, user, data) ?? shopItem.cost;
      if (wallet.tokens < cost) {
        return { error: 'Not enough tokens' };
      }
      wallet.tokens -= cost;
      wallet.owned.push(itemId);
      if (shopItem.type !== 'upgrade') wallet.equipped = itemId;
      // Owning a season's limited theme earns its exclusive badge.
      const season = SEASONS[CURRENT_SEASON];
      if (season && season.limitedThemeId === itemId) {
        if (!Array.isArray(wallet.seasonBadges)) wallet.seasonBadges = [];
        const badgeId = `season${CURRENT_SEASON}`;
        if (!wallet.seasonBadges.includes(badgeId)) wallet.seasonBadges.push(badgeId);
      }
      if (!wallet.stats) wallet.stats = { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0, maxTokensHeld: 0, crateOpens: 0, legendaryCratePulls: 0 };
      wallet.stats.maxTokensHeld = Math.max(wallet.stats.maxTokensHeld || 0, wallet.tokens);
      checkAchievements(data, user);
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

// Gift any shop item (theme, companion, or merge upgrade) to a friend. The
// sender pays the item's normal token cost from their own wallet; the item
// is added directly to the recipient's `owned` list (never the sender's —
// gifting doesn't imply buying it for yourself too). A short pendingGifts
// entry is queued on the recipient's wallet so the client can pop a toast
// like "🎁 HUNT-RYU sent you Neon Banner" the next time it polls.
app.post('/api/shop/gift', async (req, res) => {
  const { user, friend, itemId } = req.body || {};
  if (!USERS.includes(user) || !USERS.includes(friend)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (friend === user) {
    return res.status(400).json({ error: "Can't gift yourself" });
  }
  const giftableCatalog = Object.assign({}, SHOP_ITEMS, COMMUNITY_SHOP_THEMES);
  const shopItem = giftableCatalog[itemId];
  if (!shopItem || shopItem.type === 'community_goal') {
    return res.status(400).json({ error: 'Unknown item' });
  }
  flagIfSuspicious(user, 'shop/gift');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const sender = data[user].wallet;
      const recipient = data[friend].wallet;
      if (!Array.isArray(sender.friends) || !sender.friends.includes(friend)) {
        return { error: 'Add them as a friend first' };
      }
      if (recipient.owned.includes(itemId)) {
        return { error: `${friend} already owns this` };
      }
      if (shopItem.requires && !recipient.owned.includes(shopItem.requires)) {
        return { error: `${friend} is missing a prerequisite for this item` };
      }
      const cost = shopItem.cost;
      if (sender.tokens < cost) {
        return { error: 'Not enough tokens' };
      }
      sender.tokens -= cost;
      recipient.owned.push(itemId);
      if (!Array.isArray(recipient.pendingGifts)) recipient.pendingGifts = [];
      recipient.pendingGifts.push({ from: user, itemId, itemName: shopItem.name, at: Date.now() });
      if (!sender.stats) sender.stats = { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0, maxTokensHeld: 0, crateOpens: 0, legendaryCratePulls: 0 };
      sender.stats.maxTokensHeld = Math.max(sender.stats.maxTokensHeld || 0, sender.tokens);
      checkAchievements(data, friend);
      await saveData(data);
      logAdminAction('gift_sent', { from: user, to: friend, itemId });
      return { wallet: sender };
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Gift failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Clears the recipient's pendingGifts queue once the client has shown the
// toast(s) — called right after the client reads them off the wallet.
app.post('/api/shop/gifts/ack', async (req, res) => {
  const { user } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      data[user].wallet.pendingGifts = [];
      await saveData(data);
      return data[user].wallet;
    });
    res.json(updated);
  } catch (e) {
    console.error('Gift ack failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/lootcrate/info', (req, res) => {
  const totalWeight = CRATE_RARITY_TABLE.reduce((sum, r) => sum + r.weight, 0);
  res.json({
    cost: LOOT_CRATE_COST,
    odds: CRATE_RARITY_TABLE.map(r => ({ id: r.id, chance: +(r.weight / totalWeight * 100).toFixed(1) }))
  });
});

app.post('/api/lootcrate/open', async (req, res) => {
  const { user } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  flagIfSuspicious(user, 'lootcrate/open');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (wallet.tokens < LOOT_CRATE_COST) {
        return { error: 'Not enough tokens' };
      }
      wallet.tokens -= LOOT_CRATE_COST;
      const outcome = rollLootCrateReward(wallet);
      updateDailyChallenges(wallet, 'lootcrate_open', 1);
      checkAchievements(data, user);
      await saveData(data);
      return { outcome, wallet };
    });
    if (result.error) return res.status(400).json(result);
    bumpCommunityGoal(1); // fire-and-forget; doesn't block the response
    res.json(result);
  } catch (e) {
    console.error('Loot crate open failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/community-goal', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT target, progress, completed, completed_at FROM community_goal WHERE id = 1');
    const row = rows[0] || { target: COMMUNITY_GOAL_TARGET, progress: 0, completed: false, completed_at: null };
    res.json({
      title: 'Open 1,000,000 Loot Crates',
      target: Number(row.target),
      progress: Number(row.progress),
      completed: row.completed,
      completedAt: row.completed_at,
      rewardThemeId: COMMUNITY_GOAL_THEME_ID
    });
  } catch (e) {
    console.error('Community goal fetch failed:', e);
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

// ---------------------------------------------------------------------------
// Prestige endpoints
// ---------------------------------------------------------------------------
app.get('/api/prestige/info', async (req, res) => {
  const user = req.query.user;
  const base = { requiredLevel: PRESTIGE_REQUIRED_LEVEL, maxPrestige: MAX_PRESTIGE, tiers: PRESTIGE_TIERS };
  if (!user || !USERS.includes(user)) return res.json(base);
  const data = await loadData();
  const wallet = data[user].wallet;
  res.json(Object.assign({}, base, {
    currentPrestige: wallet.prestige || 0,
    currentLevel: wallet.level || 1,
    eligible: (wallet.prestige || 0) < MAX_PRESTIGE && (wallet.level || 1) >= PRESTIGE_REQUIRED_LEVEL
  }));
});

// Resets level/XP and every per-game leaderboard stat back to zero in
// exchange for a permanent prestige badge, title, and token bonus. Tokens
// already banked, owned themes, crate cosmetics, and achievements are kept.
app.post('/api/prestige', async (req, res) => {
  const { user } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  flagIfSuspicious(user, 'prestige');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if ((wallet.prestige || 0) >= MAX_PRESTIGE) {
        return { error: 'Already at maximum prestige' };
      }
      if ((wallet.level || 1) < PRESTIGE_REQUIRED_LEVEL) {
        return { error: `Reach level ${PRESTIGE_REQUIRED_LEVEL} before prestiging` };
      }
      const nextTier = (wallet.prestige || 0) + 1;
      const tier = PRESTIGE_TIERS[nextTier];
      wallet.prestige = nextTier;
      wallet.prestigeBadgeColor = tier.badgeColor;
      wallet.tokens += tier.tokenReward;
      if (!wallet.titles.includes(tier.title)) wallet.titles.push(tier.title);
      if (!wallet.borders.includes(tier.border)) wallet.borders.push(tier.border);
      wallet.xp = 0;
      wallet.level = 1;
      Object.keys(DEFAULT_STATS).forEach(game => {
        data[user][game] = JSON.parse(JSON.stringify(DEFAULT_STATS[game]));
      });
      await saveData(data);
      return { wallet };
    });
    if (result.error) return res.status(400).json(result);
    logAdminAction('prestige', { user, newPrestige: result.wallet.prestige });
    res.json(result.wallet);
  } catch (e) {
    console.error('Prestige failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Daily Challenges
// ---------------------------------------------------------------------------
app.get('/api/daily/challenges', async (req, res) => {
  const user = req.query.user;
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      ensureDailyChallenges(wallet);
      await saveData(data);
      return wallet;
    });
    res.json({
      daily: result.daily,
      streak: result.dailyStreak || 0,
      bestStreak: result.dailyBestStreak || 0,
      streakBonusPerDay: DAILY_STREAK_BONUS_PER_DAY,
      streakBonusCap: DAILY_STREAK_BONUS_CAP
    });
  } catch (e) {
    console.error('Daily challenges fetch failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/daily/claim', async (req, res) => {
  const { user, challengeId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  flagIfSuspicious(user, 'daily/claim');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      ensureDailyChallenges(wallet);
      const challenge = wallet.daily.challenges.find(c => c.id === challengeId);
      if (!challenge) return { error: 'Unknown challenge' };
      if (challenge.claimed) return { error: 'Already claimed' };
      if (challenge.progress < challenge.target) return { error: 'Not complete yet' };

      challenge.claimed = true;
      wallet.tokens += challenge.tokens;
      wallet.xp = (wallet.xp || 0) + challenge.tokens;

      let streakBonus = 0;
      const allClaimed = wallet.daily.challenges.every(c => c.claimed);
      if (allClaimed) {
        const today = todayKey();
        if (wallet.dailyLastPerfectDate === today) {
          // Already counted today (shouldn't normally happen, but stay safe).
        } else if (wallet.dailyLastPerfectDate === yesterdayKey()) {
          wallet.dailyStreak = (wallet.dailyStreak || 0) + 1;
        } else {
          wallet.dailyStreak = 1;
        }
        wallet.dailyLastPerfectDate = today;
        wallet.dailyBestStreak = Math.max(wallet.dailyBestStreak || 0, wallet.dailyStreak);
        streakBonus = Math.min(DAILY_STREAK_BONUS_CAP, wallet.dailyStreak * DAILY_STREAK_BONUS_PER_DAY);
        wallet.tokens += streakBonus;
        wallet.xp += streakBonus;
      }

      checkLevelUp(data, user);
      checkAchievements(data, user);
      await saveData(data);
      return { wallet, allClaimed, streakBonus, streak: wallet.dailyStreak };
    });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('Daily claim failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Daily Spin Wheel
// ---------------------------------------------------------------------------
app.get('/api/spin/status', async (req, res) => {
  const user = req.query.user;
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  const data = await loadData();
  const wallet = data[user].wallet;
  res.json({
    wedges: SPIN_WHEEL.map(w => ({ id: w.id, label: w.label, icon: w.icon })),
    canSpin: wallet.lastSpinDate !== todayKey()
  });
});

app.post('/api/spin/roll', async (req, res) => {
  const { user } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  flagIfSuspicious(user, 'spin/roll');

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      const today = todayKey();
      if (wallet.lastSpinDate === today) {
        return { error: 'Already spun today — come back tomorrow.' };
      }
      wallet.lastSpinDate = today;

      const { index, wedge } = rollSpinWheel();
      if (wedge.tokens) {
        wallet.tokens += wedge.tokens;
        wallet.xp = (wallet.xp || 0) + wedge.tokens;
      }
      if (wedge.xp) {
        wallet.xp = (wallet.xp || 0) + wedge.xp;
      }
      if (wedge.freeCrate) {
        const outcome = rollLootCrateReward(wallet); // no token cost — it's free
        updateDailyChallenges(wallet, 'lootcrate_open', 1);
        wallet._lastFreeCrateOutcome = outcome; // transient, not persisted meaningfully but fine either way
      }
      checkLevelUp(data, user);
      checkAchievements(data, user);
      await saveData(data);
      return { wallet, index, wedge: { id: wedge.id, label: wedge.label, icon: wedge.icon } };
    });
    if (result.error) return res.status(400).json(result);
    delete result.wallet._lastFreeCrateOutcome;
    if (result.wedge && result.wedge.id === 'free_crate') bumpCommunityGoal(1);
    res.json(result);
  } catch (e) {
    console.error('Spin roll failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Community-created cosmetics: submit, list, vote, and (admin) finalize
// ---------------------------------------------------------------------------
app.post('/api/cosmetics/submit', async (req, res) => {
  const { user, category, name, preview } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (!COSMETIC_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'category must be avatar, banner, or theme' });
  }
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 30) : '';
  if (!cleanName) {
    return res.status(400).json({ error: 'name is required (max 30 chars)' });
  }
  if (typeof preview !== 'string' || !preview.trim() || preview.length > 400) {
    return res.status(400).json({ error: 'preview is required (max 400 chars)' });
  }
  if (category === 'theme') {
    try {
      const parsed = JSON.parse(preview);
      if (!parsed.cyan || !parsed.pink || !parsed.gold || !parsed.bg) {
        return res.status(400).json({ error: 'theme preview needs cyan, pink, gold, and bg hex colors' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'theme preview must be JSON with cyan/pink/gold/bg colors' });
    }
  }
  flagIfSuspicious(user, 'cosmetics/submit');
  const monthKey = currentMonthKey();
  try {
    const existing = await pool.query(
      'SELECT id FROM cosmetic_submissions WHERE user_id = $1 AND category = $2 AND month_key = $3',
      [user, category, monthKey]
    );
    if (existing.rows.length) {
      return res.status(400).json({ error: 'You already submitted a ' + category + ' this month' });
    }
    const { rows } = await pool.query(
      `INSERT INTO cosmetic_submissions (user_id, category, name, preview, month_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, user_id, category, name, preview, month_key, votes, winner, created_at`,
      [user, category, cleanName, preview, monthKey]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('Cosmetic submit failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/cosmetics/submissions', async (req, res) => {
  const monthKey = req.query.month || currentMonthKey();
  const category = req.query.category;
  try {
    const params = [monthKey];
    let query = 'SELECT id, user_id, category, name, preview, month_key, votes, winner, created_at FROM cosmetic_submissions WHERE month_key = $1';
    if (category && COSMETIC_CATEGORIES.includes(category)) {
      params.push(category);
      query += ' AND category = $2';
    }
    query += ' ORDER BY votes DESC, created_at ASC';
    const { rows } = await pool.query(query, params);
    res.json({ monthKey, submissions: rows });
  } catch (e) {
    console.error('Cosmetic submissions fetch failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/cosmetics/vote', async (req, res) => {
  const { user, submissionId } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  flagIfSuspicious(user, 'cosmetics/vote');
  try {
    const { rows } = await pool.query('SELECT id, category, month_key FROM cosmetic_submissions WHERE id = $1', [submissionId]);
    const submission = rows[0];
    if (!submission) return res.status(400).json({ error: 'Unknown submission' });
    if (submission.month_key !== currentMonthKey()) {
      return res.status(400).json({ error: 'Voting for that month has closed' });
    }
    try {
      await pool.query(
        'INSERT INTO cosmetic_votes (user_id, submission_id, month_key, category) VALUES ($1, $2, $3, $4)',
        [user, submission.id, submission.month_key, submission.category]
      );
    } catch (e) {
      return res.status(400).json({ error: 'You already voted for a ' + submission.category + ' this month' });
    }
    const updated = await pool.query('UPDATE cosmetic_submissions SET votes = votes + 1 WHERE id = $1 RETURNING id, votes', [submission.id]);
    res.json(updated.rows[0]);
  } catch (e) {
    console.error('Cosmetic vote failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/cosmetics/winners', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT submission_id, category, name, preview, creator, month_key, created_at FROM cosmetic_winners ORDER BY created_at DESC');
    res.json({ winners: rows });
  } catch (e) {
    console.error('Cosmetic winners fetch failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: close out this month's voting. Picks the top submission in
// each category (if it has at least one vote), makes it an official,
// free-for-everyone collectible, and pays the creator a token + title bonus.
app.post('/api/admin/cosmetics/finalize-month', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  const monthKey = currentMonthKey();
  const results = [];
  try {
    for (const category of COSMETIC_CATEGORIES) {
      const { rows } = await pool.query(
        `SELECT id, user_id, name, preview, votes FROM cosmetic_submissions
         WHERE month_key = $1 AND category = $2 AND winner = false AND votes > 0
         ORDER BY votes DESC, created_at ASC LIMIT 1`,
        [monthKey, category]
      );
      const winner = rows[0];
      if (!winner) continue;

      await pool.query('UPDATE cosmetic_submissions SET winner = true WHERE id = $1', [winner.id]);
      await pool.query(
        `INSERT INTO cosmetic_winners (submission_id, category, name, preview, creator, month_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [winner.id, category, winner.name, winner.preview, winner.user_id, monthKey]
      );

      await withWriteLock(async () => {
        const data = await loadData();
        USERS.forEach(u => {
          const wallet = data[u].wallet;
          if (category === 'avatar' && !wallet.unlockedAvatars.includes(winner.preview)) {
            wallet.unlockedAvatars.push(winner.preview);
          }
          if (category === 'banner' && !wallet.unlockedBanners.includes(winner.preview)) {
            wallet.unlockedBanners.push(winner.preview);
          }
          if (category === 'theme') {
            const themeId = 'community_' + winner.id;
            if (!wallet.owned.includes(themeId)) wallet.owned.push(themeId);
          }
        });
        if (USERS.includes(winner.user_id)) {
          const creatorWallet = data[winner.user_id].wallet;
          creatorWallet.tokens += 2000;
          if (!creatorWallet.titles.includes('Community Creator')) creatorWallet.titles.push('Community Creator');
        }
        await saveData(data);
      });

      if (category === 'theme') {
        try {
          const preview = JSON.parse(winner.preview);
          COMMUNITY_SHOP_THEMES['community_' + winner.id] = Object.assign({ name: winner.name, cost: 0, community: true }, preview);
        } catch (e) {
          console.error('Failed to apply winning theme preview:', e);
        }
      }

      results.push({ category, name: winner.name, creator: winner.user_id, votes: winner.votes });
    }
    logAdminAction('cosmetics_finalize_month', { monthKey, results });
    res.json({ monthKey, winners: results });
  } catch (e) {
    console.error('Cosmetic finalize failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Arcade Builder
// ---------------------------------------------------------------------------
// Lets players assemble a simple custom game from a template (Clicker,
// Platformer, Shooter, Racing, Survival) by picking a background, player
// look, enemy look, speed, score rule, and difficulty. Saved configs aren't
// runnable yet (no template engine wired up) — this is the save/browse/
// publish layer. `config` is stored as a JSON string, validated below.
const BUILDER_TYPES = ['clicker', 'platformer', 'shooter', 'racing', 'survival'];
const BUILDER_DIFFICULTIES = ['easy', 'normal', 'hard', 'brutal'];

function validateBuilderConfig(type, title, config) {
  if (!BUILDER_TYPES.includes(type)) return 'Invalid game type';
  if (typeof title !== 'string' || !title.trim() || title.length > 40) return 'Title must be 1-40 characters';
  if (!config || typeof config !== 'object') return 'Missing config';
  const { background, player, enemies, speed, scoreRule, difficulty } = config;
  if (typeof background !== 'string' || background.length > 30) return 'Invalid background';
  if (typeof player !== 'string' || player.length > 30) return 'Invalid player look';
  if (typeof enemies !== 'string' || enemies.length > 30) return 'Invalid enemy look';
  if (typeof speed !== 'number' || speed < 1 || speed > 10) return 'Speed must be 1-10';
  if (typeof scoreRule !== 'string' || !scoreRule.trim() || scoreRule.length > 80) return 'Score rule must be 1-80 characters';
  if (!BUILDER_DIFFICULTIES.includes(difficulty)) return 'Invalid difficulty';
  return null;
}

function rowToBuilderGame(row) {
  let config = {};
  try { config = JSON.parse(row.config); } catch (e) { /* leave empty */ }
  return {
    id: row.id, user: row.user_id, title: row.title, type: row.type, config,
    published: row.published, plays: row.plays, likes: row.likes,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

// Saves a new custom game (drafts start unpublished).
app.post('/api/builder/save', async (req, res) => {
  const { user, title, type, config } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const error = validateBuilderConfig(type, title, config);
  if (error) return res.status(400).json({ error });
  flagIfSuspicious(user, 'builder/save');
  try {
    const { rows } = await pool.query(
      `INSERT INTO custom_games (user_id, title, type, config) VALUES ($1, $2, $3, $4) RETURNING *`,
      [user, title.trim(), type, JSON.stringify(config)]
    );
    res.json(rowToBuilderGame(rows[0]));
  } catch (e) {
    console.error('Builder save failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Edits an existing draft the caller owns (unpublishes it — re-publish once
// happy with the changes, so edits don't silently change a public listing).
app.post('/api/builder/update', async (req, res) => {
  const { user, gameId, title, type, config } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  const error = validateBuilderConfig(type, title, config);
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await pool.query('SELECT * FROM custom_games WHERE id = $1', [gameId]);
    if (!rows[0]) return res.status(404).json({ error: 'Game not found' });
    if (rows[0].user_id !== user) return res.status(403).json({ error: 'Not your game' });
    const updated = await pool.query(
      `UPDATE custom_games SET title = $1, type = $2, config = $3, published = false, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [title.trim(), type, JSON.stringify(config), gameId]
    );
    res.json(rowToBuilderGame(updated.rows[0]));
  } catch (e) {
    console.error('Builder update failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/builder/publish', async (req, res) => {
  const { user, gameId, published } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  try {
    const { rows } = await pool.query('SELECT * FROM custom_games WHERE id = $1', [gameId]);
    if (!rows[0]) return res.status(404).json({ error: 'Game not found' });
    if (rows[0].user_id !== user) return res.status(403).json({ error: 'Not your game' });
    const updated = await pool.query(
      `UPDATE custom_games SET published = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [!!published, gameId]
    );
    res.json(rowToBuilderGame(updated.rows[0]));
  } catch (e) {
    console.error('Builder publish failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/builder/delete', async (req, res) => {
  const { user, gameId } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  try {
    const { rows } = await pool.query('SELECT user_id FROM custom_games WHERE id = $1', [gameId]);
    if (!rows[0]) return res.json({ ok: true });
    if (rows[0].user_id !== user) return res.status(403).json({ error: 'Not your game' });
    await pool.query('DELETE FROM custom_games WHERE id = $1', [gameId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Builder delete failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/builder/mine', async (req, res) => {
  const { user } = req.query || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  try {
    const { rows } = await pool.query('SELECT * FROM custom_games WHERE user_id = $1 ORDER BY updated_at DESC', [user]);
    res.json(rows.map(rowToBuilderGame));
  } catch (e) {
    console.error('Builder mine fetch failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/builder/community', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM custom_games WHERE published = true ORDER BY created_at DESC LIMIT 100');
    res.json(rows.map(rowToBuilderGame));
  } catch (e) {
    console.error('Builder community fetch failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/builder/like', async (req, res) => {
  const { user, gameId } = req.body || {};
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  if (!requireOwnUser(req, res, user)) return;
  try {
    const { rows } = await pool.query('SELECT published FROM custom_games WHERE id = $1', [gameId]);
    if (!rows[0] || !rows[0].published) return res.status(404).json({ error: 'Game not found' });
    const existing = await pool.query('SELECT 1 FROM custom_game_likes WHERE user_id = $1 AND game_id = $2', [user, gameId]);
    let liked;
    if (existing.rows.length) {
      await pool.query('DELETE FROM custom_game_likes WHERE user_id = $1 AND game_id = $2', [user, gameId]);
      await pool.query('UPDATE custom_games SET likes = GREATEST(0, likes - 1) WHERE id = $1', [gameId]);
      liked = false;
    } else {
      await pool.query('INSERT INTO custom_game_likes (user_id, game_id) VALUES ($1, $2)', [user, gameId]);
      await pool.query('UPDATE custom_games SET likes = likes + 1 WHERE id = $1', [gameId]);
      liked = true;
    }
    const { rows: updated } = await pool.query('SELECT * FROM custom_games WHERE id = $1', [gameId]);
    res.json(Object.assign(rowToBuilderGame(updated[0]), { likedByMe: liked }));
  } catch (e) {
    console.error('Builder like failed:', e);
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

app.post('/api/wallet/companion', async (req, res) => {
  const { user, companion } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (companion !== null && companion !== 'zip' && companion !== 'duo' && companion !== 'uro' && companion !== 'trio') {
    return res.status(400).json({ error: 'Invalid companion' });
  }

  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (companion === 'zip' && (!wallet.owned.includes('zip') || !wallet.owned.includes('zipmerge'))) {
        return { error: 'Zip Merge Unlock required' };
      }
      if (companion === 'duo' && (!wallet.owned.includes('duo') || !wallet.owned.includes('duomerge'))) {
        return { error: 'Duo Merge Unlock required' };
      }
      if (companion === 'uro' && (!wallet.owned.includes('uro') || !wallet.owned.includes('uromerge'))) {
        return { error: 'Uro Merge Unlock required' };
      }
      if (companion === 'trio' && (!wallet.owned.includes('trio') || !wallet.owned.includes('triomerge'))) {
        return { error: 'Trio Merge Unlock required' };
      }
      wallet.companion = companion;
      await saveData(data);
      return { wallet };
    });
    if (result.error) return res.status(400).json(result);
    res.json(result.wallet);
  } catch (e) {
    console.error('Companion toggle failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Player Profiles, Playtime & Friends
// ---------------------------------------------------------------------------

// The client calls this every ~60s while a user is active (dashboard or in a
// game) so "Hours Played" has something real to show. Capped per-call so a
// tampered client can't fast-forward its own playtime.
app.post('/api/wallet/playtime', async (req, res) => {
  const { user, seconds } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  const safeSeconds = Math.max(0, Math.min(90, Number(seconds) || 0));

  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (!wallet.stats) wallet.stats = { bricksBroken: 0, racesFinished: 0, winStreak: 0, bestWinStreak: 0, tokensEarnedLifetime: 0, secondsPlayed: 0 };
      wallet.stats.secondsPlayed = (wallet.stats.secondsPlayed || 0) + safeSeconds;
      await saveData(data);
      return data[user].wallet;
    });
    res.json(updated);
  } catch (e) {
    console.error('Playtime update failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/profile/options', async (req, res) => {
  const { user } = req.query || {};
  let unlockedAvatars = [];
  let unlockedBanners = [];
  if (user && USERS.includes(user)) {
    const data = await loadData();
    unlockedAvatars = data[user].wallet.unlockedAvatars || [];
    unlockedBanners = data[user].wallet.unlockedBanners || [];
  }
  res.json({
    avatars: [...AVATARS, ...unlockedAvatars],
    banners: [...BANNERS, ...unlockedBanners],
    lockedAvatarCount: CRATE_EXCLUSIVE_AVATARS.filter(a => !unlockedAvatars.includes(a)).length,
    lockedBannerCount: CRATE_EXCLUSIVE_BANNERS.filter(b => !unlockedBanners.includes(b)).length
  });
});

app.post('/api/profile/customize', async (req, res) => {
  const { user, avatar, banner } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;

  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (!Array.isArray(wallet.unlockedAvatars)) wallet.unlockedAvatars = [];
      if (!Array.isArray(wallet.unlockedBanners)) wallet.unlockedBanners = [];
      if (avatar !== undefined) {
        if (!AVATARS.includes(avatar) && !wallet.unlockedAvatars.includes(avatar)) {
          return { error: 'Invalid or not-yet-unlocked avatar' };
        }
        wallet.avatar = avatar;
      }
      if (banner !== undefined) {
        if (!BANNERS.includes(banner) && !wallet.unlockedBanners.includes(banner)) {
          return { error: 'Invalid or not-yet-unlocked banner' };
        }
        wallet.banner = banner;
      }
      await saveData(data);
      return data[user].wallet;
    });
    if (updated && updated.error) return res.status(400).json(updated);
    res.json(updated);
  } catch (e) {
    console.error('Profile customize failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/friends/add', async (req, res) => {
  const { user, friend } = req.body || {};
  if (!USERS.includes(user) || !USERS.includes(friend)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;
  if (friend === user) {
    return res.status(400).json({ error: "Can't add yourself" });
  }

  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (!Array.isArray(wallet.friends)) wallet.friends = [];
      if (!wallet.friends.includes(friend)) wallet.friends.push(friend);
      await saveData(data);
      return data[user].wallet;
    });
    res.json(updated);
  } catch (e) {
    console.error('Add friend failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/friends/remove', async (req, res) => {
  const { user, friend } = req.body || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  if (!requireOwnUser(req, res, user)) return;

  try {
    const updated = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      wallet.friends = (wallet.friends || []).filter(f => f !== friend);
      await saveData(data);
      return data[user].wallet;
    });
    res.json(updated);
  } catch (e) {
    console.error('Remove friend failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Ranks the caller against just their own friends list (plus themself) by
// lifetime XP — a smaller, more personal leaderboard than the global one.
app.get('/api/friends/leaderboard', async (req, res) => {
  const { user } = req.query || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }
  try {
    const data = await loadData();
    const friends = (data[user].wallet.friends || []).filter(f => USERS.includes(f));
    const group = Array.from(new Set([user, ...friends]));
    const ranked = group
      .map(u => {
        const w = data[u].wallet;
        const { level } = computeLevel(w.xp || 0);
        return {
          user: u,
          isSelf: u === user,
          avatar: w.avatar,
          level,
          xp: w.xp || 0,
          tokens: w.tokens,
          prestige: w.prestige || 0,
          achievementCount: (w.achievements || []).length
        };
      })
      .sort((a, b) => b.xp - a.xp)
      .map((entry, i) => Object.assign({ rank: i + 1 }, entry));
    res.json({ leaderboard: ranked });
  } catch (e) {
    console.error('Friends leaderboard failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Assembles everything the Player Profile screen needs in one call: level/XP
// progress, favourite game, win/loss ratio, hours played, achievement
// progress, a season rank (standing among all players by lifetime XP), and
// account basics. Read-only and safe to call for any known user (profiles
// are viewable, not just editable by their owner).
app.get('/api/profile', async (req, res) => {
  const { user } = req.query || {};
  if (!USERS.includes(user)) {
    return res.status(400).json({ error: 'Unknown user' });
  }

  try {
    const data = await loadData();
    const record = data[user];
    const wallet = record.wallet;
    const { level, xpIntoLevel, xpForNextLevel } = computeLevel(wallet.xp || 0);

    // Favourite game = whichever reason-tagged game this wallet has the most
    // recorded plays in.
    const gamePlays = wallet.gamePlays || {};
    let favouriteGame = null;
    let favouriteGameCount = 0;
    for (const [game, count] of Object.entries(gamePlays)) {
      if (count > favouriteGameCount) { favouriteGame = game; favouriteGameCount = count; }
    }

    // Win/loss ratio, summed across every competitive game.
    let wins = 0, losses = 0;
    for (const game of Object.keys(DEFAULT_STATS)) {
      const g = record[game] || {};
      if (typeof g.wins === 'number') wins += g.wins;
      if (typeof g.losses === 'number') losses += g.losses;
    }

    // Season rank — standing among all players by lifetime XP. A lightweight
    // stand-in for a true per-season leaderboard, recomputed on every call.
    const ranked = USERS
      .map(u => ({ u, xp: (data[u] && data[u].wallet && data[u].wallet.xp) || 0 }))
      .sort((a, b) => b.xp - a.xp);
    const rank = ranked.findIndex(r => r.u === user) + 1;

    res.json({
      user,
      avatar: wallet.avatar,
      banner: wallet.banner,
      level,
      xp: wallet.xp || 0,
      xpIntoLevel,
      xpForNextLevel,
      tokens: wallet.tokens,
      favouriteGame: favouriteGame ? (GAME_DISPLAY_NAMES[favouriteGame] || favouriteGame) : null,
      winLoss: { wins, losses, ratio: losses > 0 ? +(wins / losses).toFixed(2) : wins },
      hoursPlayed: +((wallet.stats?.secondsPlayed || 0) / 3600).toFixed(1),
      achievements: {
        unlocked: (wallet.achievements || []).length,
        total: Object.keys(ACHIEVEMENTS).length,
        // Secret achievements only appear here once actually unlocked —
        // that's what makes them show up on the profile page for the
        // first time, same as any other achievement.
        badges: (wallet.achievements || []).map(id => ACHIEVEMENTS[id])
          .filter(Boolean)
          .map(a => ({ name: a.name, icon: a.icon, secret: !!a.secret }))
      },
      seasonRank: { rank, of: USERS.length, season: CURRENT_SEASON },
      friends: wallet.friends || [],
      titles: wallet.titles || [],
      borders: wallet.borders || [],
      animatedName: !!wallet.animatedName,
      joinDate: wallet.createdAt
    });
  } catch (e) {
    console.error('Profile load failed:', e);
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
      }
      if (scope === 'wallet' || scope === 'all') {
        data[user].wallet = fresh.wallet;
      }
      if (scope === 'all') {
        data[user].banned = banned;
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
  roguelikeUpgrades: ROGUELIKE_UPGRADES
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
    const current = await loadBroadcast();
    broadcastEvent('broadcast', current);
    res.json(current);
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
// Admin-only: grant a single shop item (theme, companion, merge upgrade) to
// one player, without charging them and without touching anyone else.
app.post('/api/admin/grant-item', async (req, res) => {
  const { password, user, itemId } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect admin password' });
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  const catalog = Object.assign({}, SHOP_ITEMS, COMMUNITY_SHOP_THEMES, { [COMMUNITY_GOAL_THEME_ID]: COMMUNITY_GOAL_THEME });
  if (!catalog[itemId]) return res.status(400).json({ error: 'Unknown item' });
  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (!Array.isArray(wallet.owned)) wallet.owned = ['neon'];
      if (wallet.owned.includes(itemId)) return { already: true };
      wallet.owned.push(itemId);
      await saveData(data);
      return { owned: wallet.owned.length };
    });
    logAdminAction('grant_item', { user, itemId, already: !!result.already });
    res.json({ user, itemId, name: catalog[itemId].name, already: !!result.already });
  } catch (e) {
    console.error('Admin grant item failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: grant an achievement, paying out its reward exactly as if the
// player had earned it — so titles, borders and tokens all land properly.
app.post('/api/admin/grant-achievement', async (req, res) => {
  const { password, user, achievementId } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect admin password' });
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  const ach = ACHIEVEMENTS[achievementId];
  if (!ach) return res.status(400).json({ error: 'Unknown achievement' });
  try {
    const result = await withWriteLock(async () => {
      const data = await loadData();
      const wallet = data[user].wallet;
      if (!Array.isArray(wallet.achievements)) wallet.achievements = [];
      if (wallet.achievements.includes(achievementId)) return { already: true };
      wallet.achievements.push(achievementId);
      const reward = ach.reward || {};
      if (reward.tokens) {
        wallet.tokens += reward.tokens;
        if (!wallet.stats) wallet.stats = {};
        wallet.stats.tokensEarnedLifetime = (wallet.stats.tokensEarnedLifetime || 0) + reward.tokens;
      }
      if (reward.title) {
        if (!Array.isArray(wallet.titles)) wallet.titles = [];
        if (!wallet.titles.includes(reward.title)) wallet.titles.push(reward.title);
      }
      if (reward.border) {
        if (!Array.isArray(wallet.borders)) wallet.borders = [];
        if (!wallet.borders.includes(reward.border)) wallet.borders.push(reward.border);
      }
      await saveData(data);
      return { tokens: wallet.tokens };
    });
    logAdminAction('grant_achievement', { user, achievementId, already: !!result.already });
    res.json({ user, achievementId, name: ach.name, already: !!result.already, tokens: result.tokens });
  } catch (e) {
    console.error('Admin grant achievement failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin-only: everything about one player on a single screen — wallet,
// per-game stats, achievements, clan, and how they rank overall.
app.post('/api/admin/player', async (req, res) => {
  const { password, user } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect admin password' });
  if (!USERS.includes(user)) return res.status(400).json({ error: 'Unknown user' });
  try {
    const data = await loadData();
    const rec = data[user];
    const w = rec.wallet || {};
    let clan = null;
    try {
      const { rows } = await pool.query(
        `SELECT c.tag, c.name, m.role FROM clan_members m
         JOIN clans c ON c.id = m.clan_id WHERE m.user_id = $1`, [user]);
      clan = rows[0] || null;
    } catch (e) { console.error('Admin player clan lookup failed:', e); }

    const games = {};
    Object.keys(DEFAULT_STATS).forEach(g => {
      const stats = rec[g] || {};
      if (Object.values(stats).some(v => v > 0)) games[g] = stats;
    });

    res.json({
      user,
      banned: !!rec.banned,
      clan,
      points: clanPointsFor(user, data),
      wallet: {
        tokens: w.tokens || 0, level: w.level || 1, xp: w.xp || 0,
        prestige: w.prestige || 0, equipped: w.equipped,
        owned: (w.owned || []).length, achievements: (w.achievements || []),
        titles: w.titles || [], secretsFound: w.secretsFound || 0,
        stats: w.stats || {}, createdAt: w.createdAt || null
      },
      games
    });
  } catch (e) {
    console.error('Admin player lookup failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

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

// ---------------------------------------------------------------------------
// Clans
// ---------------------------------------------------------------------------
// One clan per player. A clan has a leader (the creator, who can never be
// kicked), any number of officers who can invite and kick members, and
// members. Clan score is derived from the same leaderboard standings the
// rival panel uses, so it can't be inflated independently of actual play.
const CLAN_COST = 250;          // tokens to found one
const CLAN_TAG_RE = /^[A-Z0-9]{2,5}$/;
const CLAN_NAME_RE = /^[\w '\-]{3,24}$/;
const CLAN_MAX_MEMBERS = 10;

// Points for one player = how many other players they beat on each board.
// Same rule the client's rival panel uses, kept server-side so the clan
// table can't be driven by a hand-edited client.
function clanPointsFor(user, data){
  let pts = 0;
  Object.keys(DEFAULT_STATS).forEach(game => {
    const keys = Object.keys(DEFAULT_STATS[game]);
    if (!keys.length) return;
    const key = keys[0];
    const mine = ((data[user] && data[user][game]) || {})[key] || 0;
    if (!mine) return;
    USERS.forEach(other => {
      if (other === user) return;
      const theirs = ((data[other] && data[other][game]) || {})[key] || 0;
      if (mine > theirs) pts++;
    });
  });
  return pts;
}

async function clanRoster(){
  const { rows: clans } = await pool.query(
    'SELECT id, tag, name, motto, colour, owner, created_at FROM clans ORDER BY id');
  const { rows: members } = await pool.query(
    'SELECT user_id, clan_id, role FROM clan_members');
  const data = await loadData();
  const byClan = new Map(clans.map(c => [c.id, Object.assign({}, c, { members: [], score: 0 })]));
  members.forEach(m => {
    const c = byClan.get(m.clan_id);
    if (!c) return;
    const points = USERS.includes(m.user_id) ? clanPointsFor(m.user_id, data) : 0;
    c.members.push({ user: m.user_id, role: m.role, points });
    c.score += points;
  });
  const list = [...byClan.values()];
  list.forEach(c => c.members.sort((a, b) => b.points - a.points));
  list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return list;
}

async function membershipOf(user){
  const { rows } = await pool.query(
    'SELECT clan_id, role FROM clan_members WHERE user_id = $1', [user]);
  return rows[0] || null;
}

app.get('/api/clans', async (req, res) => {
  try {
    res.json({ clans: await clanRoster(), cost: CLAN_COST, maxMembers: CLAN_MAX_MEMBERS });
  } catch (e) {
    console.error('Clan list failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/clans/create', async (req, res) => {
  const { user, tag, name, motto, colour } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  const cleanTag = String(tag || '').toUpperCase().trim();
  const cleanName = String(name || '').trim();
  if (!CLAN_TAG_RE.test(cleanTag)) {
    return res.status(400).json({ error: 'Tag must be 2-5 letters or numbers.' });
  }
  if (!CLAN_NAME_RE.test(cleanName)) {
    return res.status(400).json({ error: 'Name must be 3-24 characters.' });
  }
  try {
    const existing = await membershipOf(user);
    if (existing) return res.status(400).json({ error: 'Leave your current clan first.' });

    const result = await withWriteLock(async () => {
      const data = await loadData();
      if (data[user].wallet.tokens < CLAN_COST) {
        return { error: `Founding a clan costs ${CLAN_COST} tokens.` };
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ins = await client.query(
          `INSERT INTO clans (tag, name, motto, colour, owner)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [cleanTag, cleanName, String(motto || '').slice(0, 80),
           /^#[0-9a-fA-F]{6}$/.test(colour || '') ? colour : '#2de2c5', user]);
        await client.query(
          `INSERT INTO clan_members (user_id, clan_id, role) VALUES ($1, $2, 'leader')`,
          [user, ins.rows[0].id]);
        await client.query('COMMIT');
        data[user].wallet.tokens -= CLAN_COST;
        await saveData(data);
        return { id: ins.rows[0].id, tokens: data[user].wallet.tokens };
      } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') return { error: 'That tag or name is already taken.' };
        throw err;
      } finally {
        client.release();
      }
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(Object.assign({ clans: await clanRoster() }, result));
  } catch (e) {
    console.error('Clan create failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/clans/join', async (req, res) => {
  const { user, clanId } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  try {
    if (await membershipOf(user)) {
      return res.status(400).json({ error: 'Leave your current clan first.' });
    }
    const { rows } = await pool.query('SELECT id FROM clans WHERE id = $1', [clanId]);
    if (!rows.length) return res.status(404).json({ error: 'No such clan.' });
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [clanId]);
    if (countRows[0].n >= CLAN_MAX_MEMBERS) {
      return res.status(400).json({ error: 'That clan is full.' });
    }
    await pool.query(
      `INSERT INTO clan_members (user_id, clan_id, role) VALUES ($1, $2, 'member')`,
      [user, clanId]);
    res.json({ clans: await clanRoster() });
  } catch (e) {
    console.error('Clan join failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Leaving as the leader hands the clan to the longest-serving officer, or
// the longest-serving member if there are no officers. An empty clan is
// disbanded rather than left ownerless.
app.post('/api/clans/leave', async (req, res) => {
  const { user } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  try {
    const me = await membershipOf(user);
    if (!me) return res.status(400).json({ error: "You're not in a clan." });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM clan_members WHERE user_id = $1', [user]);
      if (me.role === 'leader') {
        const { rows: heirs } = await client.query(
          `SELECT user_id FROM clan_members WHERE clan_id = $1
           ORDER BY (role = 'officer') DESC, joined_at ASC LIMIT 1`, [me.clan_id]);
        if (heirs.length) {
          await client.query(
            `UPDATE clan_members SET role = 'leader' WHERE user_id = $1`, [heirs[0].user_id]);
          await client.query('UPDATE clans SET owner = $1 WHERE id = $2',
            [heirs[0].user_id, me.clan_id]);
        } else {
          await client.query('DELETE FROM clans WHERE id = $1', [me.clan_id]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ clans: await clanRoster() });
  } catch (e) {
    console.error('Clan leave failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/clans/kick', async (req, res) => {
  const { user, target } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  try {
    const me = await membershipOf(user);
    const them = await membershipOf(target);
    if (!me || me.role === 'member') return res.status(403).json({ error: 'Officers and leaders only.' });
    if (!them || them.clan_id !== me.clan_id) return res.status(400).json({ error: 'Not in your clan.' });
    if (them.role === 'leader') return res.status(403).json({ error: "You can't kick the leader." });
    if (me.role === 'officer' && them.role === 'officer') {
      return res.status(403).json({ error: 'Only the leader can remove an officer.' });
    }
    await pool.query('DELETE FROM clan_members WHERE user_id = $1', [target]);
    res.json({ clans: await clanRoster() });
  } catch (e) {
    console.error('Clan kick failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/clans/role', async (req, res) => {
  const { user, target, role } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  if (role !== 'officer' && role !== 'member') {
    return res.status(400).json({ error: 'Role must be officer or member.' });
  }
  try {
    const me = await membershipOf(user);
    const them = await membershipOf(target);
    if (!me || me.role !== 'leader') return res.status(403).json({ error: 'Leaders only.' });
    if (!them || them.clan_id !== me.clan_id) return res.status(400).json({ error: 'Not in your clan.' });
    if (them.role === 'leader') return res.status(400).json({ error: "You're already the leader." });
    await pool.query('UPDATE clan_members SET role = $1 WHERE user_id = $2', [role, target]);
    res.json({ clans: await clanRoster() });
  } catch (e) {
    console.error('Clan role change failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Bug reports
// ---------------------------------------------------------------------------
app.post('/api/bugs/report', async (req, res) => {
  const { user, area, body } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  const text = String(body || '').trim();
  if (text.length < 10) return res.status(400).json({ error: 'Tell us a bit more — 10 characters minimum.' });
  if (text.length > 1000) return res.status(400).json({ error: 'Keep it under 1000 characters.' });
  try {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM bug_reports WHERE user_id = $1 AND created_at > now() - interval \'1 hour\'',
      [user]);
    if (rows[0].n >= 5) return res.status(429).json({ error: 'That is a lot of reports — try again later.' });
    await pool.query('INSERT INTO bug_reports (user_id, area, body) VALUES ($1, $2, $3)',
      [user, String(area || 'general').slice(0, 40), text]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Bug report failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/admin/bugs', async (req, res) => {
  const { password, id, status } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect admin password' });
  try {
    if (id && status) {
      if (!['open', 'fixed', 'wontfix'].includes(status)) {
        return res.status(400).json({ error: 'Unknown status' });
      }
      await pool.query('UPDATE bug_reports SET status = $1 WHERE id = $2', [status, id]);
      logAdminAction('bug_status', { id, status });
    }
    const { rows } = await pool.query(
      'SELECT id, user_id, area, body, status, created_at FROM bug_reports ORDER BY id DESC LIMIT 100');
    res.json({ reports: rows });
  } catch (e) {
    console.error('Admin bug list failed:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Multiplayer rooms
// ---------------------------------------------------------------------------
// Shared 3D spaces — the hub world and kart races. Rooms are in memory on
// purpose: they're ephemeral by nature, a restart just drops everyone back
// to the lobby list, and keeping them out of Postgres means a 20Hz position
// relay never touches the database.
//
// The server relays movement rather than simulating it, so this is not
// authoritative physics — with ten friends on a private arcade that trade is
// worth it for the latency. What the server *does* own is everything that
// persists: only the finish order is trusted enough to pay tokens, and it's
// paid through the same earn path everything else uses.
const MP_TICK_MS = 60;           // ~17 state broadcasts a second
const MP_ROOM_TTL_MS = 30 * 60 * 1000;
const MP_MAX_PLAYERS = 8;
const MP_MODES = {
  world: { name: 'The Hub', max: 8, min: 1 },
  kart:  { name: 'Rift Kart', max: 8, min: 1 }
};

const mpRooms = new Map();       // code -> room

function mpCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for(let i=0;i<4;i++) code += chars[Math.floor(Math.random()*chars.length)];
  } while(mpRooms.has(code));
  return code;
}

function mpPublic(room){
  return {
    code: room.code,
    mode: room.mode,
    modeName: MP_MODES[room.mode].name,
    name: room.name,
    host: room.host,
    started: room.started,
    locked: room.locked,
    count: room.players.size,
    max: MP_MODES[room.mode].max,
    players: [...room.players.values()].map(p => ({ user: p.user, ready: p.ready }))
  };
}

function mpRoomList(){
  return [...mpRooms.values()]
    .filter(r => !r.locked)
    .map(mpPublic)
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

// One room per player. Joining a second drops you from the first, which is
// what you'd want anyway and stops a ghost lingering in the old room.
function mpLeaveAll(user, exceptCode){
  for(const room of mpRooms.values()){
    if(room.code === exceptCode) continue;
    if(room.players.delete(user)){
      if(room.players.size === 0){
        mpRooms.delete(room.code);
      } else if(room.host === user){
        room.host = room.players.keys().next().value;
      }
      mpBroadcastRoom(room, 'mp:room', mpPublic(room));
    }
  }
}

function mpBroadcastRoom(room, type, payload){
  const members = new Set(room.players.keys());
  broadcastEvent(type, payload, user => members.has(user));
}

// The same centreline the client draws. Kept here because the server already
// judges checkpoints against it — a start grid placed by a different curve
// would drop everyone into the infield, which is exactly what it did before
// this existed.
const KART_TRACK_R = 30;
function kartTrackPoint(t){
  const a = t * Math.PI * 2;
  const r = KART_TRACK_R + Math.sin(a * 2) * 6 + Math.sin(a * 3) * 3.5;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}
// Heading along the track at t, in the game's convention (x = sin(yaw),
// z = cos(yaw)).
function kartTrackYaw(t){
  const a = kartTrackPoint(t), b = kartTrackPoint(t + 0.002);
  return Math.atan2(b.x - a.x, b.z - a.z);
}

function mpFreshPlayer(user, mode){
  // Spawn positions are spread around a circle so nobody starts inside
  // somebody else.
  return {
    user, ready: false,
    x: 0, y: 0, z: 0, yaw: 0,
    vx: 0, vz: 0,
    phase: 0, moving: false,
    lap: 0, checkpoint: 0, finished: 0,
    emote: null, emoteAt: 0,
    lastInputAt: Date.now()
  };
}

function mpSpawn(room, player, index){
  if(room.mode === 'kart'){
    // Two columns on a start grid, laid out *along the track* just behind
    // the line and facing the way the circuit runs.
    const row = Math.floor(index / 2), col = index % 2;
    const t = -0.012 - row * 0.010;          // a little way back from t=0
    const p = kartTrackPoint(t);
    const yaw = kartTrackYaw(t);
    // Sideways along the road is the heading rotated a quarter turn.
    const sx = Math.cos(yaw), sz = -Math.sin(yaw);
    const lane = col === 0 ? -2.2 : 2.2;
    player.x = p.x + sx * lane;
    player.z = p.z + sz * lane;
    player.yaw = yaw;
  } else {
    const a = (index / MP_MAX_PLAYERS) * Math.PI * 2;
    player.x = Math.cos(a) * 4;
    player.z = Math.sin(a) * 4;
    player.yaw = -a;
  }
  player.lap = 0; player.checkpoint = 0; player.finished = 0;
}

// Rooms nobody has touched in half an hour are cleaned up, so a forgotten
// room can't hold a code or keep broadcasting forever.
setInterval(() => {
  const now = Date.now();
  for(const room of mpRooms.values()){
    if(now - room.touchedAt > MP_ROOM_TTL_MS) mpRooms.delete(room.code);
  }
}, 60000).unref();

app.get('/api/mp/rooms', (req, res) => {
  res.json({ rooms: mpRoomList(), modes: MP_MODES });
});

app.post('/api/mp/create', async (req, res) => {
  const { user, mode, name, locked } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  if (!MP_MODES[mode]) return res.status(400).json({ error: 'Unknown mode' });
  mpLeaveAll(user);
  const room = {
    code: mpCode(),
    mode,
    name: String(name || `${user}'s room`).slice(0, 28),
    host: user,
    locked: !!locked,
    started: false,
    startedAt: 0,
    players: new Map(),
    touchedAt: Date.now()
  };
  const p = mpFreshPlayer(user, mode);
  mpSpawn(room, p, 0);
  room.players.set(user, p);
  mpRooms.set(room.code, room);
  res.json({ room: mpPublic(room) });
});

app.post('/api/mp/join', async (req, res) => {
  const { user, code } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  const room = mpRooms.get(String(code || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'No room with that code.' });
  if (room.players.size >= MP_MODES[room.mode].max && !room.players.has(user)) {
    return res.status(400).json({ error: 'That room is full.' });
  }
  if (room.started && room.mode === 'kart' && !room.players.has(user)) {
    return res.status(400).json({ error: 'That race has already started.' });
  }
  mpLeaveAll(user, room.code);
  if (!room.players.has(user)) {
    const p = mpFreshPlayer(user, room.mode);
    mpSpawn(room, p, room.players.size);
    room.players.set(user, p);
  }
  room.touchedAt = Date.now();
  mpBroadcastRoom(room, 'mp:room', mpPublic(room));
  res.json({ room: mpPublic(room) });
});

app.post('/api/mp/leave', async (req, res) => {
  const { user } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  mpLeaveAll(user);
  res.json({ ok: true });
});

app.post('/api/mp/ready', async (req, res) => {
  const { user, ready } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  for(const room of mpRooms.values()){
    const p = room.players.get(user);
    if(!p) continue;
    p.ready = !!ready;
    room.touchedAt = Date.now();
    mpBroadcastRoom(room, 'mp:room', mpPublic(room));
    return res.json({ room: mpPublic(room) });
  }
  res.status(400).json({ error: "You're not in a room." });
});

app.post('/api/mp/start', async (req, res) => {
  const { user } = req.body || {};
  if (!requireOwnUser(req, res, user)) return;
  for(const room of mpRooms.values()){
    if(!room.players.has(user)) continue;
    if(room.host !== user) return res.status(403).json({ error: 'Only the host can start.' });
    room.started = true;
    room.startedAt = Date.now() + 3000;   // a shared countdown everyone sees
    let i = 0;
    for(const p of room.players.values()){ mpSpawn(room, p, i++); p.ready = false; }
    room.touchedAt = Date.now();
    mpBroadcastRoom(room, 'mp:start', { code: room.code, startsAt: room.startedAt, room: mpPublic(room) });
    return res.json({ room: mpPublic(room) });
  }
  res.status(400).json({ error: "You're not in a room." });
});

// ---------------------------------------------------------------------------
// Realtime (WebSocket)
// ---------------------------------------------------------------------------
// One socket per logged-in tab. The client authenticates with the same bearer
// token it uses for the REST API — the socket grants no authority the token
// didn't already have, and it is push-only: every state change still goes
// through a POST that validates it. Losing the socket costs you liveness,
// never correctness, because the HTTP pollers stay as the fallback.
const wss = new WebSocketServer({ noServer: true });
const liveSockets = new Set();

const WS_AUTH_GRACE_MS = 10000;   // authenticate this fast or you're dropped
const WS_HEARTBEAT_MS = 30000;    // ping cadence; two misses and you're gone

function wsSend(ws, type, payload){
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ type, payload, at: Date.now() }));
  } catch (e) {
    console.error('WS send failed:', e);
  }
}

// Push an event to every authenticated socket. `filter` narrows it to
// specific users (e.g. a gift only its recipient should hear about).
function broadcastEvent(type, payload, filter){
  for (const ws of liveSockets) {
    if (!ws.username) continue;
    if (filter && !filter(ws.username)) continue;
    wsSend(ws, type, payload);
  }
}

function onlineUsers(){
  return [...new Set([...liveSockets].map(ws => ws.username).filter(Boolean))].sort();
}

let presenceDirty = false;
function announcePresence(){
  // Coalesce bursts (a reload is a disconnect plus a connect) into one push.
  if (presenceDirty) return;
  presenceDirty = true;
  setTimeout(() => {
    presenceDirty = false;
    broadcastEvent('presence', { online: onlineUsers() });
  }, 250);
}

wss.on('connection', ws => {
  liveSockets.add(ws);
  ws.isAlive = true;
  ws.username = null;
  ws.on('pong', () => { ws.isAlive = true; });

  // A socket that never authenticates is just holding a slot.
  const authTimer = setTimeout(() => {
    if (!ws.username) ws.close(4001, 'Authentication timeout');
  }, WS_AUTH_GRACE_MS);

  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(String(raw).slice(0, 4096));
    } catch (e) {
      return; // ignore anything that isn't small, well-formed JSON
    }
    if (msg.type === 'auth') {
      const session = sessions.get(msg.token);
      if (!session || session.expiresAt < Date.now()) {
        wsSend(ws, 'auth', { ok: false, error: 'Session expired' });
        ws.close(4003, 'Bad token');
        return;
      }
      clearTimeout(authTimer);
      ws.username = session.username;
      wsSend(ws, 'auth', { ok: true, user: ws.username, online: onlineUsers() });
      announcePresence();
      return;
    }
    if (msg.type === 'ping') { wsSend(ws, 'pong', {}); return; }
    if (!ws.username) return;   // everything below acts as a player

    // Movement. Clamped and range-checked rather than trusted: a bad or
    // hostile client can misplace *itself*, which is a cosmetic problem, but
    // it can't hand itself laps, tokens or a place in the finish order —
    // those are decided below and on the REST side.
    if (msg.type === 'mp:move') {
      const room = mpRoomOf(ws.username);
      if (!room) return;
      const p = room.players.get(ws.username);
      if (!p) return;
      const num = (v, limit) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(-limit, Math.min(limit, n)) : 0;
      };
      p.x = num(msg.x, 400);
      p.y = num(msg.y, 100);
      p.z = num(msg.z, 400);
      p.yaw = num(msg.yaw, Math.PI * 4);
      p.phase = num(msg.phase, 1e6);
      p.moving = !!msg.moving;
      p.lastInputAt = Date.now();
      room.touchedAt = p.lastInputAt;
      return;
    }

    // Lap progress. The server keeps the counter and only accepts the *next*
    // checkpoint in sequence, so a client can't run the count up by claiming
    // the finish line over and over.
    if (msg.type === 'mp:checkpoint') {
      const room = mpRoomOf(ws.username);
      if (!room || room.mode !== 'kart' || !room.started) return;
      const p = room.players.get(ws.username);
      if (!p || p.finished) return;
      const idx = Number(msg.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= KART_CHECKPOINTS) return;
      if (idx !== (p.checkpoint % KART_CHECKPOINTS)) return;
      p.checkpoint++;
      if (p.checkpoint % KART_CHECKPOINTS === 0) {
        p.lap++;
        if (p.lap >= KART_LAPS) {
          p.finished = Date.now();
          const place = [...room.players.values()].filter(q => q.finished).length;
          mpBroadcastRoom(room, 'mp:finish', {
            user: ws.username, place, time: p.finished - room.startedAt
          });
          awardKartFinish(ws.username, place).catch(e =>
            console.error('Kart payout failed:', e));
        }
      }
      return;
    }

    if (msg.type === 'mp:emote') {
      const room = mpRoomOf(ws.username);
      if (!room) return;
      const p = room.players.get(ws.username);
      if (!p) return;
      const emote = String(msg.emote || '').slice(0, 8);
      p.emote = emote;
      p.emoteAt = Date.now();
      mpBroadcastRoom(room, 'mp:emote', { user: ws.username, emote });
      return;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    liveSockets.delete(ws);
    announcePresence();
  });
  ws.on('error', () => {
    clearTimeout(authTimer);
    liveSockets.delete(ws);
  });
});

// The kart track is defined server-side too, so lap counting can't be argued
// with by a client that draws a different one.
const KART_CHECKPOINTS = 8;
const KART_LAPS = 3;

function mpRoomOf(user){
  for(const room of mpRooms.values()){
    if(room.players.has(user)) return room;
  }
  return null;
}

// Finishing pays through the same wallet path as everything else, so the
// lifetime totals and achievement checks stay consistent.
async function awardKartFinish(user, place){
  if(!USERS.includes(user)) return;
  const reason = place === 1 ? 'kart_win' : 'kart_finish';
  await withWriteLock(async () => {
    const data = await loadData();
    const wallet = data[user].wallet;
    const amount = REWARDS[reason] || 0;
    wallet.tokens += amount;
    if(!wallet.stats) wallet.stats = {};
    wallet.stats.tokensEarnedLifetime = (wallet.stats.tokensEarnedLifetime || 0) + amount;
    const rec = data[user].kart;
    if(rec){
      rec.races = (rec.races || 0) + 1;
      if(place === 1) rec.wins = (rec.wins || 0) + 1;
    }
    checkAchievements(data, user);
    await saveData(data);
  });
}

// The relay tick — one compact snapshot per room. Positions only; everything
// durable already went through an endpoint.
setInterval(() => {
  const now = Date.now();
  for(const room of mpRooms.values()){
    if(room.players.size === 0) continue;

    // Drop anyone whose socket went away, so their avatar doesn't stand
    // around after they've closed the tab.
    const connected = new Set([...liveSockets].map(w => w.username).filter(Boolean));
    let changed = false;
    for(const user of [...room.players.keys()]){
      if(!connected.has(user)){ room.players.delete(user); changed = true; }
    }
    if(changed){
      if(room.players.size === 0){ mpRooms.delete(room.code); continue; }
      if(!room.players.has(room.host)) room.host = room.players.keys().next().value;
      mpBroadcastRoom(room, 'mp:room', mpPublic(room));
    }

    const players = [...room.players.values()].map(p => ({
      u: p.user,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      z: Math.round(p.z * 100) / 100,
      a: Math.round(p.yaw * 100) / 100,
      h: Math.round(p.phase * 10) / 10,
      m: p.moving ? 1 : 0,
      l: p.lap,
      f: p.finished ? 1 : 0,
      e: (p.emote && now - p.emoteAt < 2500) ? p.emote : null
    }));
    mpBroadcastRoom(room, 'mp:state', {
      code: room.code, t: now, startsAt: room.startedAt, players
    });
  }
}, MP_TICK_MS).unref();

// Render's proxy will happily hold a half-dead socket open; the ping/pong
// sweep is what actually reaps them.
const wsHeartbeat = setInterval(() => {
  for (const ws of liveSockets) {
    if (ws.isAlive === false) { ws.terminate(); liveSockets.delete(ws); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { ws.terminate(); liveSockets.delete(ws); }
  }
}, WS_HEARTBEAT_MS);
wsHeartbeat.unref();

// Registered last so it can never shadow a real route: anything that isn't the
// API or a health check is a person who typed the backend URL, so send them to
// the site. An unknown /api/* path stays a JSON 404 — redirecting an API call
// to an HTML page would turn a clear error into a confusing parse failure.
if (!SERVE_STATIC) {
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Unknown endpoint' });
    }
    const suffix = req.originalUrl === '/' ? '' : req.originalUrl;
    res.redirect(302, SITE_ORIGIN + suffix);
  });
}

const server = http.createServer(app);

// Only upgrade on /ws — anything else asking to upgrade gets hung up on
// rather than left hanging.
server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (e) {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Level 7 API running on http://localhost:${PORT}`);
      console.log(SERVE_STATIC
        ? '  serving the front end from public/'
        : `  front end expected at ${SITE_ORIGIN}`);
    });
  })
  .catch(e => {
    console.error('Failed to initialize database, exiting:', e);
    process.exit(1);
  });
