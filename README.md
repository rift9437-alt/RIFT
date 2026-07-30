# Level 7 — Live Leaderboard Server

This is a tiny backend that makes the arcade leaderboard **shared and live**
across every player, instead of each browser keeping its own private copy
in `localStorage`.

https://rift-1-edfr.onrender.com/

## How it works

- `server.js` is a small Express app that does **two jobs**:
  - Serves the game itself (`level7_12.html`) at `/`.
  - Exposes the leaderboard API:
    - `GET /api/leaderboard` — returns the current standings for every user.
    - `POST /api/leaderboard/update` — applies a stat change for one user/game.
    - `GET /api/chat` / `POST /api/chat` — the shared chat room (see below).
- Data is stored in `leaderboard.json`, a plain JSON file that's created
  automatically the first time the server runs. No database to install.
- The game page polls `GET /api/leaderboard` every 4 seconds while the
  Leaderboard screen is open, and calls the update endpoint right after
  each match finishes. So if your friend on another device wins a match,
  your screen reflects it within a few seconds.

Because the server now serves the page itself, there's **only one thing to
run and one URL to share** — no separate static host, no editing any
config to point the page at the API.

## Running it locally

```bash
npm install
npm start
```

The server listens on port 3000 by default (override with `PORT=xxxx npm start`).
You should see:

```
Leaderboard server running on http://localhost:3000
```

Open `http://localhost:3000` in a browser — that's the full game, already
talking to the live leaderboard. Test the API directly with:

```bash
curl http://localhost:3000/api/leaderboard
```

## Hosting it for real

Deploy this one folder somewhere that can keep a Node process alive: a
VPS, Render, Railway, Fly.io, a Raspberry Pi on your home network, etc.
Any host that runs `npm install && npm start` and keeps it running works.
Whatever URL that host gives you (e.g. `https://your-app.onrender.com`)
is the link you share with everyone — the game and the live leaderboard
are both right there.

### If you'd rather host the page separately anyway

You can still split them up if you want (e.g. a CDN for the page, a tiny
box for the API). Open `level7_12.html`, find this line in the leaderboard
section:

```js
const LB_API_BASE = '/api';
```

and change it to the full URL of wherever you deploy the server, e.g.:

```js
const LB_API_BASE = 'https://leaderboard.yoursite.com/api';
```

The server already sends permissive CORS headers, so this works cross-origin
out of the box. If you want to lock it down to just your game's domain later,
edit the `Access-Control-Allow-Origin` header in `server.js`.

## Keeping it running

For production you'll want something to restart the server if it crashes
or the machine reboots. A couple of common options:

- **pm2** (`npm install -g pm2`, then `pm2 start server.js`)
- A `systemd` service if you're on a Linux VPS
- Whatever process manager your host (Render, Railway, etc.) provides
  automatically

## Backing up / resetting scores

All the data lives in one file: `leaderboard.json`, sitting next to
`server.js`. To back it up, just copy that file. To wipe the leaderboard
and start over, stop the server, delete `leaderboard.json`, and restart —
it'll regenerate with everyone at zero.

## Adding more users later

The list of valid usernames is intentionally duplicated in two places —
once in the page's `USERS` array (used to draw the leaderboard rows), once in
`server.js`'s `USERS` array — so the server can validate requests without
trusting the client. Passwords only ever live server-side, hashed, in
`PASSWORD_HASHES`. To add a player: add the name to `USERS` in both files,
then generate their password hash with

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync('NEWPASSWORD',s,64).toString('hex'))"
```

and drop the result into `PASSWORD_HASHES` in `server.js`.

## The cabinets

Fourteen playable cabinets, all in the one HTML file:

| Cabinet | Type | Tracks |
| --- | --- | --- |
| ⚽ Street Soccer | 1v1 (bot or local) | Wins / Goals / Saves |
| 🏎️ Apex Loop | 1v1 (bot or local) | Wins |
| 🛡️ Tank Duel | 1v1 (bot or local) | Wins |
| 🏃 Hop Runner | Solo | High score |
| 🤠 Wild Duel | 1v1 (bot or local) | Wins |
| 🌠 Asteroid Blaster | Solo | Asteroids shot |
| 🧱 Neon Breaker | Solo | High score |
| ⚔️ Crypt Crawler | Solo | Deepest floor |
| ☄️ Comet Dodge | Solo | High score |
| 🌀 Hyper Tunnel | Solo · **3D** | High score |
| 👁 Neon Depths | Solo · **3D** | Best wave |
| 🏗 Sky Stack | Solo · **3D** | Best height |
| 🪐 Gravity Golf | Solo | Holes sunk |
| 🥏 Neon Sumo | 1v1 (bot or local) | Wins |

The dashboard grid is generated from the `CABINETS` array in the page, so
adding a cabinet is one entry in that list plus the game module itself — the
filter chips, the tags and the "your best" line on each card all follow from
it. Wire the new stat into `DEFAULT_STATS` in `server.js` and add a row to
`LB_BOARDS` in the page and it shows up on the Leaderboard too.

### The 3D cabinets

Three of them are actually 3D, with no libraries and no WebGL:

- **Hyper Tunnel** and **Sky Stack** run through `Mini3D`, a small software
  renderer in the page: world → camera space → near-plane clip (Sutherland–
  Hodgman against `z = NEAR`) → perspective projection → painter's-algorithm
  fill, with flat shading from a fixed key light. `Mini3D.box()` returns the
  six faces of a box ready to render; `Mini3D.render()` sorts and draws them.
- **Neon Depths** is a classic DDA raycaster instead — one ray per screen
  column for the walls, billboarded sprites for enemies and pickups, and a
  depth buffer per column so a sprite behind a corner is correctly hidden.

Both approaches share the arcade's flat-neon look and stay comfortably at
60fps on a normal laptop.

## Arcade chat

There's a live chat room docked in the bottom-left corner of every screen,
shared by everyone signed in. It follows the same server-is-authoritative
pattern as the leaderboard: the client only ever posts text and asks for
"anything newer than message N", so a busy room doesn't mean re-downloading
the history every few seconds.

- Messages live in their own `chat` table, so posting never touches (or
  locks) player records.
- Capped at 300 characters, one message per 800ms per account, 12 per 30
  seconds. Only the logged-in account can post as itself.
- The server keeps the most recent ~600 messages and trims older ones
  automatically; a fresh client is handed the last 120.
- Minimise the dock and a badge counts what you missed. Whether it's open is
  remembered per device.
- To wipe the room, use **Clear Arcade Chat** in the admin panel.

## Sound & settings

Every sound in the arcade is synthesised at runtime with WebAudio — there are
no audio files to host. Mute from the 🔊 button in the top bar, or open the
⚙ **Settings** panel for sound, CRT scanlines and screen shake. Those three
preferences are stored per device in `localStorage`, not on the server.

## Wild Duel

A new cabinet: a quick-draw duel (press **S**) that drops into a platform
fight (A/D move, W jump, S shoot, 4 HP). Shoot first in the draw and your
opponent starts the fight at 3 HP instead of 4. Draw at the same instant
and you both start full. Works as local multiplayer (P2 = arrow keys +
Down to shoot) or against a bot with 3 difficulties, each with its own
platform layout. Wins are tracked on the Leaderboard.

## Update Log & admin panel

There's an in-game "Update Log" cabinet that shows patch notes, pulled
from `updatelog.txt` (auto-created next to `leaderboard.json`, same idea —
back it up or edit it the same way).

To change the log from inside the page itself, click the **LEVEL 7** logo
in the top bar **5 times quickly** to open a hidden admin panel. Enter the
admin password once and every tool in the panel uses it: editing the log,
granting or setting coins, maxing upgrades, unlocking themes, setting a
Crypt Crawler floor, cloning player data, broadcasting a site message,
banning users, viewing security logs, clearing the arcade chat, resetting a
player or a single leaderboard, and the emergency lockdown switch.

Change the password by setting an `ADMIN_PASSWORD` environment variable
before starting the server (e.g. `ADMIN_PASSWORD=mysecret npm start`).

