/* =========================================================
   MULTIPLAYER — lobbies and shared state
   =========================================================
   Rooms are created and joined over REST; once you're in one, positions
   arrive over the WebSocket at ~17Hz. This file owns the lobby UI and the
   shared player table; the two worlds (hub + kart) read from it and draw.

   Remote players are interpolated toward the last snapshot rather than
   snapped to it, so a 60ms relay tick still reads as smooth movement at
   60fps. */
let mpRoom = null;            // the room we're in, or null
let mpRooms = [];             // the browsable list
let mpPlayers = new Map();    // user -> { x,y,z,yaw, tx,ty,tz,tyaw, phase, moving, lap, finished, emote }
let mpStartsAt = 0;
let mpFinishOrder = [];
let mpSendTimer = null;
// Kart item state, all of it the server's word. The client draws these and
// never decides them — see the kart item block in server.js.
let mpBoxMask = 0;            // bit per item box: 1 = on the track right now
let mpHazards = [];           // [[x,z], …] bananas lying about
let mpShells = [];            // shells in flight, purely for the animation

const MP_SEND_MS = 60;        // how often we tell the server where we are
const MP_LERP = 0.22;         // how hard remote players chase their target

function mpModeLabel(mode){
  return mode === 'kart' ? '🏎 Rift Kart' : '🌍 The Hub';
}

/* ---- lobby ---------------------------------------------------------- */

async function openMultiplayer(){
  showScreen('mp-screen');
  document.getElementById('mp-body').innerHTML =
    '<div class="clan-empty">Looking for rooms…</div>';
  await loadMpRooms();
  renderMpLobby();
}

async function loadMpRooms(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/mp/rooms`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    mpRooms = (await res.json()).rooms || [];
  }catch(e){
    console.error('Room list load failed:', e);
    mpRooms = [];
  }
  return mpRooms;
}

function renderMpLobby(){
  const box = document.getElementById('mp-body');
  if(!box) return;

  if(mpRoom){ renderMpRoom(); return; }

  box.innerHTML = `
    <div class="mp-create">
      <div class="setup-section-label">Start a room</div>
      <div class="mp-create-row">
        <input id="mp-name" maxlength="28" class="clan-input" placeholder="Room name">
        <select id="mp-mode" class="clan-input">
          <option value="world">🌍 The Hub — hang out</option>
          <option value="kart">🏎 Rift Kart — race with items</option>
        </select>
      </div>
      <label class="mp-check">
        <input type="checkbox" id="mp-private"> Private (code only, hidden from the list)
      </label>
      <div class="clan-error" id="mp-error"></div>
      <button class="btn btn-primary" onclick="createMpRoom()">Create room</button>
    </div>

    <div class="mp-join">
      <div class="setup-section-label">Join with a code</div>
      <div class="mp-create-row">
        <input id="mp-code" maxlength="4" class="clan-input clan-input-tag" placeholder="CODE">
        <button class="btn btn-secondary" onclick="joinMpRoom()">Join</button>
      </div>
    </div>

    <div class="setup-section-label">Open rooms</div>
    ${mpRooms.length ? mpRooms.map(r => `
      <div class="mp-card">
        <div class="mp-card-head">
          <span class="mp-code">${r.code}</span>
          <span class="mp-name">${escapeHtml(r.name)}</span>
          <span class="mp-mode">${mpModeLabel(r.mode)}</span>
          <span class="mp-count">${r.count}/${r.max}</span>
          ${r.started ? '<span class="mp-live">● in progress</span>' : ''}
          <button class="btn btn-primary btn-small"
                  onclick="joinMpRoom('${r.code}')">Join</button>
        </div>
        <div class="mp-players">
          ${r.players.map(p => `<span class="clan-member">${p.user}</span>`).join('')}
        </div>
      </div>`).join('')
    : '<div class="clan-empty">No open rooms. Make one — your friends can join with the code.</div>'}`;
}

function renderMpRoom(){
  const box = document.getElementById('mp-body');
  if(!box || !mpRoom) return;
  const isHost = mpRoom.host === currentUser;
  const me = mpRoom.players.find(p => p.user === currentUser);
  box.innerHTML = `
    <div class="mp-room">
      <div class="mp-room-head">
        <div>
          <div class="mp-room-name">${escapeHtml(mpRoom.name)}</div>
          <div class="mp-room-sub">${mpModeLabel(mpRoom.mode)} · host ${mpRoom.host}</div>
        </div>
        <div class="mp-room-code">
          <span>SHARE THIS CODE</span>
          <b>${mpRoom.code}</b>
        </div>
      </div>

      <div class="mp-roster">
        ${mpRoom.players.map(p => `
          <div class="mp-seat ${p.ready ? 'ready' : ''}">
            <canvas class="mp-seat-av" width="90" height="110"
                    data-user="${p.user}"></canvas>
            <span>${p.user}${p.user === mpRoom.host ? ' 👑' : ''}</span>
            <i>${p.ready ? 'READY' : 'waiting'}</i>
          </div>`).join('')}
        ${Array.from({ length: Math.max(0, mpRoom.max - mpRoom.count) }).map(() =>
          '<div class="mp-seat mp-seat-empty"><span>empty</span></div>').join('')}
      </div>

      <div class="mp-room-actions">
        <button class="btn ${me && me.ready ? 'btn-ghost' : 'btn-secondary'}"
                onclick="toggleMpReady()">${me && me.ready ? 'Not ready' : "I'm ready"}</button>
        ${isHost
          ? `<button class="btn btn-primary" onclick="startMpRoom()">
               ${mpRoom.mode === 'kart' ? 'Start race' : 'Enter the hub'}
             </button>`
          : `<button class="btn btn-primary" onclick="enterMpWorld()">
               ${mpRoom.mode === 'kart' ? 'Go to the grid' : 'Enter the hub'}
             </button>`}
        <button class="btn btn-ghost" onclick="leaveMpRoom()">Leave</button>
      </div>
    </div>`;

  drawSeatAvatars();
}

// Little idle portrait of each player in the lobby, drawn with the same
// model they'll appear as in the world.
function drawSeatAvatars(){
  document.querySelectorAll('.mp-seat-av').forEach(canvas => {
    const user = canvas.dataset.user;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cam = { x: 0, y: 0.95, z: -2.6, yaw: 0, pitch: -0.02 };
    const faces = Avatar3D.build(avatarFor(user), {
      x: 0, y: 0, z: 0, yaw: Math.PI * 0.15, phase: 0, moving: false
    });
    Mini3D.render(ctx, faces, cam, W, H, 150);
  });
}

async function mpPost(path, body, failMsg){
  const err = document.getElementById('mp-error');
  if(err) err.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/mp/${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(Object.assign({ user: currentUser }, body))
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      if(err) err.textContent = data.error || failMsg;
      else toast('Multiplayer', data.error || failMsg, '🎮', 'pink');
      return null;
    }
    return data;
  }catch(e){
    console.error('Room action failed:', e);
    if(err) err.textContent = 'Network error — try again.';
    return null;
  }
}

async function createMpRoom(){
  const data = await mpPost('create', {
    mode: document.getElementById('mp-mode').value,
    name: document.getElementById('mp-name').value.trim(),
    locked: document.getElementById('mp-private').checked
  }, 'Could not create that room.');
  if(!data) return;
  mpRoom = data.room;
  Sfx.play('win');
  renderMpLobby();
}

async function joinMpRoom(code){
  const raw = code || document.getElementById('mp-code').value;
  const data = await mpPost('join', { code: String(raw || '').trim().toUpperCase() },
                            'Could not join that room.');
  if(!data) return;
  mpRoom = data.room;
  Sfx.play('select');
  renderMpLobby();
}

async function leaveMpRoom(){
  await mpPost('leave', {}, 'Could not leave.');
  mpRoom = null;
  mpPlayers.clear();
  await loadMpRooms();
  renderMpLobby();
}

async function toggleMpReady(){
  const me = mpRoom && mpRoom.players.find(p => p.user === currentUser);
  const data = await mpPost('ready', { ready: !(me && me.ready) }, 'Could not set ready.');
  if(data){ mpRoom = data.room; renderMpRoom(); }
}

async function startMpRoom(){
  const data = await mpPost('start', {}, 'Could not start.');
  if(data) mpRoom = data.room;
}

/* ---- entering a world ----------------------------------------------- */

function enterMpWorld(){
  if(!mpRoom) return;
  mpLocal().needsSpawn = true;
  startMpSending();
  if(mpRoom.mode === 'kart') KartGame.start();
  else HubWorld.start();
}

// Tell the server where we are, on a fixed timer rather than every frame —
// the relay ticks at 60ms, so sending faster only wastes bandwidth.
function startMpSending(){
  stopMpSending();
  mpSendTimer = setInterval(() => {
    if(!mpRoom || !Realtime.isLive()) return;
    const me = mpPlayers.get(currentUser);
    if(!me) return;
    Realtime.send({
      type: 'mp:move',
      x: me.x, y: me.y, z: me.z, yaw: me.yaw,
      phase: me.phase, moving: me.moving
    });
  }, MP_SEND_MS);
}

function stopMpSending(){
  if(mpSendTimer){ clearInterval(mpSendTimer); mpSendTimer = null; }
}

// Local player state lives in the same table as everyone else's, so the
// world code can draw one list without special-casing "me".
function mpLocal(){
  let me = mpPlayers.get(currentUser);
  if(!me){
    me = { x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0,
           phase: 0, moving: false, lap: 0, finished: 0, emote: null, local: true };
    mpPlayers.set(currentUser, me);
  }
  me.local = true;
  return me;
}

// Called every frame by whichever world is running: eases remote players
// toward their last known position so the 17Hz relay doesn't look like it.
function mpInterpolate(){
  mpPlayers.forEach(p => {
    if(p.local) return;
    p.x += (p.tx - p.x) * MP_LERP;
    p.y += (p.ty - p.y) * MP_LERP;
    p.z += (p.tz - p.z) * MP_LERP;
    // Shortest way round the circle, so crossing ±PI doesn't spin them.
    let d = p.tyaw - p.yaw;
    while(d > Math.PI) d -= Math.PI * 2;
    while(d < -Math.PI) d += Math.PI * 2;
    p.yaw += d * MP_LERP;
    if(p.moving) p.phase += 0.22;
  });
}

function mpOthers(){
  return [...mpPlayers.entries()]
    .filter(([user]) => user !== currentUser)
    .map(([user, p]) => ({ user, p }));
}

/* ---- socket wiring --------------------------------------------------- */

Realtime.on('mp:room', room => {
  if(!mpRoom || room.code !== mpRoom.code) return;
  mpRoom = room;
  if(currentScreen === 'mp-screen') renderMpRoom();
});

Realtime.on('mp:start', payload => {
  if(!mpRoom || payload.code !== mpRoom.code) return;
  mpRoom = payload.room;
  mpStartsAt = payload.startsAt;
  mpFinishOrder = [];
  mpLocal().needsSpawn = true;
  Sfx.play('whoosh');
  enterMpWorld();
});

Realtime.on('mp:state', payload => {
  if(!mpRoom || payload.code !== mpRoom.code) return;
  mpStartsAt = payload.startsAt || 0;
  const seen = new Set();
  payload.players.forEach(s => {
    seen.add(s.u);
    if(s.u === currentUser){
      const me = mpLocal();
      // Our position is authoritative locally — taking it from the server
      // every tick would fight our own input over the network. The one
      // exception is the spawn: the server decides where the grid is, so we
      // accept its placement exactly once per race.
      if(me.needsSpawn){
        me.x = s.x; me.y = s.y; me.z = s.z; me.yaw = s.a;
        me.needsSpawn = false;
      }
      me.lap = s.l;
      me.finished = s.f;
      me.spun = !!s.k;
      me.shield = !!s.s;
      return;
    }
    let p = mpPlayers.get(s.u);
    if(!p){
      p = { x: s.x, y: s.y, z: s.z, yaw: s.a, phase: s.h, local: false };
      mpPlayers.set(s.u, p);
    }
    p.tx = s.x; p.ty = s.y; p.tz = s.z; p.tyaw = s.a;
    p.moving = !!s.m;
    p.lap = s.l;
    p.finished = s.f;
    p.spun = !!s.k;
    p.shield = !!s.s;
    p.emote = s.e;
  });
  if(typeof payload.bx === 'number') mpBoxMask = payload.bx;
  if(payload.hz) mpHazards = payload.hz;
  // Anyone missing from the snapshot has left.
  [...mpPlayers.keys()].forEach(u => {
    if(u !== currentUser && !seen.has(u)) mpPlayers.delete(u);
  });
});

Realtime.on('mp:finish', payload => {
  mpFinishOrder.push(payload);
  if(payload.user === currentUser){
    Sfx.play('win');
    toast('Finished', `P${payload.place} · ${(payload.time/1000).toFixed(1)}s`, '🏁', 'gold');
  } else {
    toast('Across the line', `${payload.user} finished P${payload.place}`, '🏁', 'cyan');
  }
});

Realtime.on('mp:emote', payload => {
  const p = mpPlayers.get(payload.user);
  if(p){ p.emote = payload.emote; }
});

/* ---- kart items ------------------------------------------------------
   Every one of these is the server telling us what happened. The kart reads
   them to draw and to react; it never decides any of it itself. */

Realtime.on('mp:kart-item', payload => KartGame.gotItem(payload.item));
Realtime.on('mp:kart-fizzle', () => KartGame.fizzled());

Realtime.on('mp:kart-boost', payload => {
  if(payload.user === currentUser) KartGame.itemBoost();
});

Realtime.on('mp:kart-shield', payload => {
  if(payload.user === currentUser) toast('Shield up', 'The next hit bounces off', '🛡', 'cyan');
});

Realtime.on('mp:kart-drop', payload => {
  // The banana itself arrives in the next state snapshot; this is the sound
  // and the puff of dust at the moment it lands.
  KartGame.droppedNearby(payload.x, payload.z);
});

Realtime.on('mp:kart-shell', payload => {
  mpShells.push({ from: payload.from, to: payload.to, at: Date.now(), ms: payload.ms });
  if(payload.to === currentUser) toast('Incoming', `${payload.from} fired a shell`, '🐢', 'pink');
});

Realtime.on('mp:kart-hit', payload => {
  mpShells = mpShells.filter(s => s.to !== payload.user);
  KartGame.struck(payload.user, payload.by);
});

Realtime.on('mp:kart-block', payload => {
  if(payload.user === currentUser) toast('Blocked', 'Your shield took it', '🛡', 'gold');
});

Realtime.on('mp:kart-bolt', payload => {
  if(payload.by === currentUser) toast('Rift Bolt', `Caught ${payload.hit.length} ahead of you`, '⚡', 'gold');
  else if(payload.hit.includes(currentUser)) toast('Rift Bolt', `${payload.by} hit the whole field`, '⚡', 'pink');
});

Realtime.on('avatar', payload => {
  if(payload && payload.user) avatarBook[payload.user] = payload.avatar;
});

// Backing out of a world puts you back in the lobby but keeps you in the
// room, so wandering off to check the leaderboard doesn't drop you out of
// your friends' race.
function leaveMpWorld(){
  stopAllGames();
  document.getElementById('pause-overlay').classList.add('hidden');
  openMultiplayer();
}

/* ---- Season 2 progress ----------------------------------------------
   Pumpkins and ghosts are reported to the server rather than counted in the
   client, so the seasonal badges can't be handed out by a page reload. The
   server caps how many can be claimed per call and refuses the whole thing
   once the season is over. */
async function postSpooky(event, qty){
  try{
    const res = await apiFetch(`${LB_API_BASE}/season/spooky`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, event, qty })
    });
    if(!res.ok) return null;
    const data = await res.json();
    if(wallet) wallet.spooky = data.spooky;
    return data.spooky;
  }catch(e){
    console.error('Season progress failed:', e);
    return null;
  }
}
