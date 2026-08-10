# Level 7 — Live Leaderboard Server

This is a tiny backend that makes the arcade leaderboard **shared and live**
across every player, instead of each browser keeping its own private copy
in `localStorage`.

https://rift-1-edfr.onrender.com/

## How it works

- `server.js` is a small Express app that does **two jobs**:
  - Serves the game itself from `public/` at `/`.
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
box for the API). Open `public/js/core/leaderboard.js`, find this line:

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

## Project layout

The page used to be one 16,000-line HTML file. It's now split so a change to
one game can't disturb anything else:

```
public/
  index.html              markup only — no inline CSS or JS
  css/
    base.css              tokens, reset, login
    dashboard.css         the cabinet grid
    features.css          community, profile, loot crates
    games.css             per-cabinet styling
    companions.css        the theme companion characters
    ui.css                leaderboard, chat, admin, shared HUD
  js/
    core/                 auth, screens, leaderboard, currency, sfx,
                          settings, sprites, mini3d, pause, init
    features/             chat, shop, achievements, daily, community,
                          profile, crates, party, builder, admin, ...
    games/                one file per cabinet (29 of them)
```

The scripts are plain (non-module) files loaded in order, exactly as they ran
when inlined, so every shared global still works — this was a file layout
change, not a rewrite. **Load order in `index.html` matters**: `core/` first,
then `features/`, then `games/`, and `core/init.js` last.

To add a cabinet: drop a file in `js/games/`, add its `<script>` tag before
`core/pause.js`, add the screen markup to `index.html`, and add an entry to
`CABINETS` in `js/features/cabinets.js`. Wire the stat into `DEFAULT_STATS`
in `server.js` and add a row to `LB_BOARDS` for the leaderboard.

## The cabinets

Twenty-nine playable cabinets, one JS file each under `public/js/games/`:

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
| 🏰 Tower Defense | Solo · strategy | Best wave |
| 🥷 Ninja Parkour | Solo | Best time |
| 🧟 Zombie Survival | Solo | Best wave |
| 🏴‍☠️ Pirate Adventure | Solo | Treasure |
| 🗡️ Samurai Showdown | 1v1 (bot or local) | Wins |
| 🚓 Police Chase | Solo | High score |
| ♟️ Tactics Grid | 1v1 · strategy | Wins |
| 🔮 Rune Duel | 1v1 · strategy | Wins |
| 🗺️ Warlord | 1v1 · strategy | Wins |
| 🧬 Evolution | Solo | Best stage |
| 🌊 Flood Escape | Solo | Rooms escaped |
| 🏀 Buzzer Beater | Solo | High score |
| 🍔 Burger Rush | Solo | Orders served |
| 🏃 Neon Tag | 1v1 (bot or local) | Wins |
| 🤖 Robot Arena | Solo | Best round |

The dashboard grid is generated from the `CABINETS` array in the page, so
adding a cabinet is one entry in that list plus the game module itself — the
filter chips, the tags and the "your best" line on each card all follow from
it. Wire the new stat into `DEFAULT_STATS` in `server.js` and add a row to
`LB_BOARDS` in `js/features/upgrades.js` and it shows up on the Leaderboard
too. Don't forget `stopAllGames()` in `js/core/screens.js` and
`currentGameModule()` in `js/core/pause.js` — a cabinet missing from either
starts fine but can't be paused and never receives key presses.

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

## Rotating shop

Above the main catalog the shop runs three rotating slots:

- **Daily Deals** — three themes at 10–30% off, rerolling at UTC midnight
- **Weekly Feature** — two at 25–45% off, rerolling weekly
- **Back Room** — one at 50–60% off, and it only opens once you've found a
  secret somewhere in the arcade

The rotation isn't stored anywhere. It's derived from the date with a seeded
PRNG (mulberry32 over a `"2026-08-10:daily"` style key), so every player sees
the same offers at the same moment, a server restart doesn't reroll them, and
there's no extra table to keep in sync. Free items, season-limited themes and
merge upgrades are excluded so a deal can't undercut something meant to be
earned.

The discount is resolved server-side at purchase time by the same function
that builds the offer — the client never sends a price.

## Arcade totals

A panel on the dashboard shows arcade-wide counters: tokens earned, games
played, time on the machines, achievements, crates opened, secrets found,
and the busiest cabinet. Every number is derived from the player records
rather than kept as its own counter, so nothing can drift out of sync — with
a 20-second cache, since it walks every record.

## Clans

Found a clan for 250 tokens and other players can join it, up to ten members.
A clan's score is the sum of its members' leaderboard points — the same
"how many players do you beat on this board" number the rival panel uses —
computed server-side from the standings, so it only moves when someone
actually plays.

Roles are leader → officer → member. Officers can remove members; only the
leader can promote, demote, or remove an officer, and the leader can't be
removed at all. A leader who leaves hands the clan to the longest-serving
officer (or the longest-serving member if there are none); the last person
out disbands it. Membership is one clan per player, enforced by the primary
key on `clan_members` rather than by a check the client could skip.

Your clan tag rides along next to your name in chat.

## Bug reports

Any player can file one from the Clans screen — pick an area, describe what
happened, and it lands in `bug_reports` for triage from the admin panel
(open / fixed / wontfix). Rate-limited to five per hour per player.

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

## Beyond the games

The arcade has a progression layer that sits across every cabinet.

**Perks** (Shop → Perks) are bought with coins and apply account-wide, not to
one game. Coin Magnet, Second Wind (revive), Extra Guard (+1 life/shield),
Insurance, Lucky Streak and Streak Saver. Anything that touches a payout is
applied **server-side** in `/api/wallet/earn` and `/api/run/complete`, so a
client claiming a perk level it doesn't own gets nothing extra.

**Daily bonus** pays once a day and scales with your streak (capped at 7
days). **Daily challenges** are three rotating objectives, picked
deterministically from the date so everyone gets the same set without the
server storing a generated list.

**Achievements** — 24 of them. Each is a pure function of a player's stored
record, so progress is recomputed rather than tracked separately, which means
they backfill correctly for anything earned before the feature shipped.

**Titles and emblems** are cosmetic shop tabs; both render next to your name
in chat and on every leaderboard.

**Prize wheel** costs 120 coins a spin. The winning slice is chosen by
`spinWheel()` on the server — the client animation just spins to the index it
was handed, so the visual can't decide the outcome.

**Who's online and the live ticker** come from two in-memory stores
(`presence`, `activity`) rather than the database, since both are live state
with no reason to survive a restart. Presence entries expire after 45s.

### Effects layer

`FX` is one shared module every cabinet draws through: a particle pool,
shockwave rings, floating text, screen shake and hit-stop, keyed per canvas so
nothing leaks between games. A game calls `FX.burst()` / `FX.shake()` /
`FX.text()` at the moment of impact and `FX.draw()` once per frame — which is
wired into all 14 render loops.

## Sound & settings

Every sound in the arcade is synthesised at runtime with WebAudio — there are
no audio files to host. Mute from the 🔊 button in the top bar, or open the
⚙ **Settings** panel for sound, CRT scanlines, screen shake, screen
transitions and the animated background. Those preferences are stored per
device in `localStorage`, not on the server.

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

