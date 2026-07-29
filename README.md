# Level 7 — Live Leaderboard Server

This is a tiny backend that makes the arcade leaderboard **shared and live**
across every player, instead of each browser keeping its own private copy
in `localStorage`.

## How it works

- `server.js` is a small Express app that does **two jobs**:
  - Serves the game itself (`level7_11.html`) at `/`.
  - Exposes the leaderboard API:
    - `GET /api/leaderboard` — returns the current standings for every user.
    - `POST /api/leaderboard/update` — applies a stat change for one user/game.
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
box for the API). Open `level7_11.html`, find this line in the leaderboard
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
once in the game's `ACCOUNTS` object, once in `server.js`'s `USERS` array —
so the server can validate requests without trusting the client. If you add
a new player account to the game, add their username to the `USERS` array
in `server.js` too.

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
admin password to edit and save the log content. The default password is
`LEVEL7-ADMIN` — change it by setting an `ADMIN_PASSWORD` environment
variable before starting the server (e.g. `ADMIN_PASSWORD=mysecret npm start`).

