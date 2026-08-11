# Level 7

A browser arcade with 29 cabinets, a shared live leaderboard, chat, clans,
tournaments and a token economy.

**Play:** https://rift9437-alt.github.io/RIFT/

## How it's put together

Two pieces, hosted separately.

| | Where | What it does |
| --- | --- | --- |
| **Site** | GitHub Pages, from `public/` | Everything you see and play. Static files only. |
| **API + realtime** | Render — `https://rift-1-edfr.onrender.com` | Postgres-backed state, the REST API, and the WebSocket. |

The split is why the site loads instantly off a CDN while the parts that
have to be shared — scores, chat, wallets — stay on one authoritative
server. Visiting the Render URL in a browser just redirects you back to the
site, so there's still only one link worth sharing.

The client works out which backend to talk to at load time in
`public/js/core/config.js`, which is the only place the backend URL appears.
It stays same-origin when the API server is also serving the page (local
dev), and points at Render otherwise. To aim a page at a different backend
without editing anything, append `?api=https://some-other-host` — it sticks
for the session; `?api=` on its own clears it.

### Realtime

A WebSocket at `/ws` pushes chat messages, score changes, presence and admin
announcements the moment they happen, instead of waiting for the next poll.
The client authenticates with the same bearer token the REST API uses, so
the socket grants no authority the token didn't already have, and it is
push-only: **every** state change still goes through a POST that validates
it.

That makes the socket an accelerator, not a dependency. The HTTP pollers are
still there and simply back off while the socket is healthy, so losing the
connection costs a few seconds of latency and never correctness. Three
things can go wrong and all three are handled:

- **A clean disconnect** — `onclose` fires, the pollers resume immediately,
  and the client reconnects on a backoff (1s → 30s).
- **Coming back from offline or a sleeping tab** — the `online` and
  `visibilitychange` events trigger an immediate retry rather than waiting
  out the backoff. Measured at ~1.5s to recover.
- **A socket that dies silently** — a dropped Wi-Fi link or a proxy reaping
  an idle connection can leave a socket that looks open but delivers
  nothing, which would keep the pollers switched off and quietly freeze the
  page. A watchdog probes anything that's been quiet for 25s and hangs up if
  there's no answer within 5s, so this is caught in ~30-40s. The probe
  doubles as the application-level keepalive that stops proxies reaping the
  connection in the first place.

The status pill on the chat dock shows `LIVE` or `POLLING` so you can see
which mode you're in.

## Running it locally

```bash
npm install
SERVE_STATIC=1 npm start
```

`SERVE_STATIC=1` puts the front end back on this server, so one command and
one URL is still all you need for development. You should see:

```
Level 7 API running on http://localhost:3000
  serving the front end from public/
```

Open `http://localhost:3000`. Without `SERVE_STATIC`, the server runs
API-only and redirects browsers to the deployed site — which is how it runs
on Render. Test the API directly with:

```bash
curl http://localhost:3000/api/leaderboard
curl http://localhost:3000/healthz
```

## Deploying

**The site** deploys itself. `.github/workflows/pages.yml` publishes
`public/` to GitHub Pages on every push to `main` that touches it. One-time
setup: **Settings → Pages → Source: GitHub Actions**. The workflow copies
`index.html` to `404.html` so deep links land on the app instead of
GitHub's error page.

**The API** is a normal Node service on Render (`npm install && npm start`)
with `DATABASE_URL` pointing at Postgres. Two optional environment
variables:

- `SITE_ORIGIN` — where to redirect browsers. Defaults to the Pages URL;
  set it if that ever changes.
- `SERVE_STATIC=1` — serve the front end from this server too, disabling
  the redirect.

If you move either piece, the URLs live in exactly two places:
`public/js/core/config.js` (site → API) and `SITE_ORIGIN` (API → site).

## Hosting it for real

Deploy this one folder somewhere that can keep a Node process alive: a
VPS, Render, Railway, Fly.io, a Raspberry Pi on your home network, etc.
Any host that runs `npm install && npm start` and keeps it running works.
Whatever URL that host gives you (e.g. `https://your-app.onrender.com`)
is the link you share with everyone — the game and the live leaderboard
are both right there.

The server sends permissive CORS headers, which is what makes the
Pages-to-Render split work. To lock it down to just your own domain later,
edit the `Access-Control-Allow-Origin` header in `server.js`.

## Keeping it running

For production you'll want something to restart the server if it crashes
or the machine reboots. A couple of common options:

- **pm2** (`npm install -g pm2`, then `pm2 start server.js`)
- A `systemd` service if you're on a Linux VPS
- Whatever process manager your host (Render, Railway, etc.) provides
  automatically

## Backing up / resetting scores

Everything lives in Postgres, pointed at by `DATABASE_URL`. Back it up with
`pg_dump` the way you would any database. To wipe the standings without
touching wallets or cosmetics, use **Reset Leaderboard** in the admin panel;
to reset one player entirely, use **Reset Player**.

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
    clans.css             clans and bug reports
    shop-rotation.css     rotating shop slots, arcade totals
    gazette.css           the Gazette, the archive, tournaments
    avatar.css            the avatar creator
    multiplayer.css       room lobby and seats
  js/
    core/                 auth, screens, leaderboard, currency, sfx,
                          settings, sprites, mini3d, pause, init
    features/             chat, shop, achievements, daily, community,
                          profile, crates, party, builder, admin, ...
    games/                one file per cabinet (29), plus the two
                          multiplayer worlds (hub, kart)
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

## Avatars and multiplayer

Three pieces that build on each other, all on the same software renderer the
3D cabinets use — no WebGL, no libraries.

**Your avatar** is a blocky character built from `Mini3D` boxes: skin, shirt,
trousers, shoes and a hat, edited on a turntable you can drag. The same model
is what other players see in the shared world and sitting in your kart. The
walk cycle runs off a phase the caller advances rather than an internal
clock, so a remote player animates from the movement actually received for
them. Appearance is validated server-side — six-digit hex and a known hat id
or the save is rejected — because it renders inside everyone else's client.
A player who has never opened the editor gets a look seeded from their name,
so they're still a distinct character rather than a shared default.

**Rooms** have a four-character code, are public or private, and hold up to
eight. Create and join over REST; once you're in, positions relay over the
WebSocket at ~17Hz and remote players are interpolated toward the last
snapshot so the tick rate doesn't show. Your own movement is applied locally
and immediately — you never wait on the network to move.

The server relays rather than simulates, which is the right trade for a
private arcade, but it still owns everything that persists: a lap only
counts if the checkpoint you claimed is the one you were due, and finishing
pays through the same wallet path as every other game.

**The Hub** is a plaza you walk around with everyone else in the room —
sprint, jump, emotes, name tags carrying your clan tag, tokens to collect,
a minimap, and chat that appears over your head as well as in the dock.

**Rift Kart** is three laps of a circuit with kerbs, a start grid and a
gantry. Hold SHIFT through a corner to drift; a long clean slide earns a
mini-turbo that pushes you past your own top speed. Boost pads sit on the
racing line, and there's a minimap, a live running order and a results board
built from what the server actually paid out.

## Tournaments

A timed contest on one cabinet's stat, started from the admin panel with a
prize and a duration.

Entering records your value at that moment, and the table ranks **improvement
during the window** — so already holding the record doesn't hand you the
trophy, and joining late doesn't rule you out. Re-entering can't reset your
own baseline (the insert is `ON CONFLICT DO NOTHING`), which would otherwise
wipe out your progress.

When the clock runs out the tournament settles: the prize is paid once (the
`UPDATE` only matches while `settled` is still false, so two concurrent
callers can't both award it) and the final table is frozen into the row.
Recomputing a finished table from live stats would let scores set afterwards
rewrite its history and contradict the recorded winner.

## Admin panel

Five clicks on the logo opens it. Everything posts the admin password with
each call and the server is the only thing that checks it — the panel is a
convenience, not the security boundary.

Alongside the existing tools (grant/set coins, reset a player, unlock themes,
set a floor, reset the leaderboard, broadcast, clear chat, ban, clone, and an
emergency lockdown) there's now:

- **Inspect a player** — wallet, level, podium points, clan and role,
  cosmetics owned, achievements, titles, secrets, lifetime tokens, time
  played, and per-game stats on one screen
- **Grant a single cosmetic** — one item to one player, idempotent
- **Grant an achievement** — pays its reward exactly as if it had been
  earned, so tokens, titles and borders all land properly
- **Bug report triage** — list what players have filed and mark each
  open / fixed / won't fix

The item and achievement pickers are populated from the catalogs the client
has already loaded, so there's no id to type by hand.

## The Gazette and the Archive

One screen, two halves.

The **Gazette** is a front page written from whatever actually happened in
the arcade: the board with the widest gap between first and second, whoever
has been on the machines longest, the newest clan, who's sitting on the most
tokens, how many bug reports are open. Every story is generated from live
records on request, so it can't go stale; cached for 30 seconds.

The **Archive** is the building's backstory, released a fragment at a time.
Each entry unlocks on something you actually did, and they unlock *in order* —
a sealed entry shows only the hint for what opens it and never ships its text
to the client, so the archive reads as a straight story and doubles as a list
of things to go and try.

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

There's an in-game "Update Log" cabinet that shows patch notes, stored in
the `updatelog` table and edited from the admin panel.

To change the log from inside the page itself, click the **LEVEL 7** logo
in the top bar **5 times quickly** to open a hidden admin panel. Enter the
admin password once and every tool in the panel uses it: editing the log,
granting or setting coins, maxing upgrades, unlocking themes, setting a
Crypt Crawler floor, cloning player data, broadcasting a site message,
banning users, viewing security logs, clearing the arcade chat, resetting a
player or a single leaderboard, and the emergency lockdown switch.

Change the password by setting an `ADMIN_PASSWORD` environment variable
before starting the server (e.g. `ADMIN_PASSWORD=mysecret npm start`).

