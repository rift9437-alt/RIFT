/* =========================================================
   REALTIME
   =========================================================
   A WebSocket to the API server that pushes chat, presence, score changes
   and admin announcements instead of waiting for the next poll.

   It is deliberately an *accelerator*, not a dependency. Every state change
   still goes through the REST API, and the HTTP pollers stay running as the
   fallback — they just slow right down while the socket is healthy. So a
   dropped socket (Render idling a free instance, a phone changing network,
   a proxy that won't upgrade) costs liveness for a few seconds and never
   correctness. */
const Realtime = (function(){
  const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];
  const HELLO_TIMEOUT_MS = 8000;
  // A server WebSocket ping is handled by the browser and never reaches JS,
  // so a healthy-but-quiet socket looks silent from here. The probe doubles
  // as the application-level keepalive that proves it either way — and stops
  // an idle proxy reaping the connection.
  const WATCHDOG_MS = 5000;      // how often we check for a silent socket
  const QUIET_LIMIT_MS = 25000;  // nothing heard for this long -> probe it
  const PROBE_GRACE_MS = 5000;   // no pong to the probe -> assume it's dead

  let ws = null;
  let attempt = 0;
  let live = false;              // authenticated and receiving
  let wantOpen = false;          // false once we log out, so retries stop
  let reconnectTimer = null;
  let helloTimer = null;
  let lastSeenAt = 0;            // last time the server said anything
  let probeSentAt = 0;           // 0 when we're not waiting on a probe
  const handlers = {};           // event type -> [fn]

  function on(type, fn){
    (handlers[type] = handlers[type] || []).push(fn);
  }

  function emit(type, payload){
    (handlers[type] || []).forEach(fn => {
      try { fn(payload); }
      catch(e){ console.error('Realtime handler failed for "' + type + '":', e); }
    });
  }

  function isLive(){ return live; }

  function setStatus(nowLive){
    if(live === nowLive) return;
    live = nowLive;
    emit('status', { live });
    const dot = document.getElementById('chat-status');
    if(dot){
      dot.textContent = live ? 'LIVE' : 'POLLING';
      dot.style.color = live ? 'var(--cyan)' : 'var(--text-dim)';
    }
  }

  function scheduleReconnect(){
    if(!wantOpen || reconnectTimer) return;
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, wait);
  }

  function connect(){
    if(!wantOpen || !authToken) return;
    if(ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      ws = new WebSocket(WS_URL);
    } catch(e){
      console.error('Realtime connect failed:', e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      lastSeenAt = Date.now();
      probeSentAt = 0;
      ws.send(JSON.stringify({ type: 'auth', token: authToken }));
      // If the server never answers the handshake, treat it as a dead socket
      // rather than sitting on a connection that will never deliver anything.
      clearTimeout(helloTimer);
      helloTimer = setTimeout(() => {
        if(!live && ws) ws.close();
      }, HELLO_TIMEOUT_MS);
    };

    ws.onmessage = ev => {
      lastSeenAt = Date.now();
      probeSentAt = 0;
      let msg;
      try { msg = JSON.parse(ev.data); }
      catch(e){ return; }
      if(msg.type === 'pong') return;
      if(msg.type === 'auth'){
        clearTimeout(helloTimer);
        if(msg.payload && msg.payload.ok){
          attempt = 0;
          setStatus(true);
          emit('presence', { online: (msg.payload.online) || [] });
        } else {
          // The token is stale — a reconnect won't fix it, so stop trying and
          // let the next REST call trigger the normal re-login path.
          wantOpen = false;
          setStatus(false);
        }
        return;
      }
      emit(msg.type, msg.payload);
    };

    ws.onclose = () => {
      clearTimeout(helloTimer);
      probeSentAt = 0;
      setStatus(false);
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => { /* onclose always follows; handled there */ };
  }

  function start(){
    wantOpen = true;
    attempt = 0;
    connect();
  }

  function stop(){
    wantOpen = false;
    clearTimeout(reconnectTimer); reconnectTimer = null;
    clearTimeout(helloTimer); helloTimer = null;
    setStatus(false);
    if(ws){ try { ws.close(); } catch(e){} ws = null; }
  }

  // A socket can die without onclose ever firing — a dropped Wi-Fi link, a
  // proxy reaping an idle connection, a free Render instance going to sleep.
  // Left alone that reads as "still live" and keeps the HTTP pollers switched
  // off, so the page goes quiet with no sign anything is wrong. Probe a quiet
  // socket and hang up on it if it doesn't answer; onclose then reconnects.
  setInterval(() => {
    if(!wantOpen) return;

    // A socket the browser has parked in CONNECTING/CLOSING isn't delivering
    // anything either, and while offline `close()` may not dispatch onclose
    // at all — so the watchdog decides liveness itself rather than waiting
    // for an event that might never arrive.
    if(!ws || ws.readyState !== WebSocket.OPEN){
      if(live) setStatus(false);
      return;
    }

    const now = Date.now();
    if(probeSentAt){
      if(now - probeSentAt > PROBE_GRACE_MS){
        probeSentAt = 0;
        setStatus(false);          // pollers take over now, not on onclose
        try { ws.close(); } catch(e){}
        ws = null;
        scheduleReconnect();
      }
      return;
    }
    if(now - lastSeenAt > QUIET_LIMIT_MS){
      probeSentAt = now;
      try { ws.send(JSON.stringify({ type: 'ping' })); }
      catch(e){
        probeSentAt = 0;
        setStatus(false);
        try { ws.close(); } catch(e2){}
        ws = null;
        scheduleReconnect();
      }
    }
  }, WATCHDOG_MS);

  // Coming back from a background tab or a sleeping laptop is the most common
  // way to find a socket that closed without firing onclose.
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && wantOpen && !live){
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      attempt = 0;
      connect();
    }
  });
  window.addEventListener('online', () => {
    if(wantOpen && !live){ attempt = 0; connect(); }
  });

  // Fire-and-forget. Returns false when there's no live socket so callers can
  // fall back — nothing sent this way is allowed to be the only path for
  // something that matters.
  function send(obj){
    if(!ws || ws.readyState !== WebSocket.OPEN || !live) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch(e){
      return false;
    }
  }

  return { start, stop, on, send, isLive };
})();

/* ---- subscriptions --------------------------------------------------
   Everything the socket pushes lands in code that already existed for the
   polling path, so there's one way for each kind of update to be applied. */

// A reaction is a change to a message that's already on screen, so it comes
// down its own channel rather than resending the message.
Realtime.on('chat:react', payload => {
  if(!payload || typeof applyReactions !== 'function') return;
  applyReactions(payload.messageId, payload.reactions);
});

Realtime.on('chat', payload => {
  if(!payload || !payload.message) return;
  if(typeof ingestChatMessages === 'function') ingestChatMessages([payload.message], false);
  // Standing in the hub, what people say also appears over their heads.
  if(currentScreen === 'hub-screen' && typeof HubWorld !== 'undefined'){
    HubWorld.sayInWorld(payload.message.user, payload.message.text);
  }
});

Realtime.on('scores', payload => {
  if(!payload || !payload.user || !payload.game) return;
  // Patch the local standings copy rather than refetching the whole table.
  if(typeof lbCache !== 'undefined' && lbCache && lbCache[payload.user]){
    lbCache[payload.user][payload.game] = payload.stats;
  }
  if(currentScreen === 'leaderboard-screen' && typeof renderLeaderboard === 'function'){
    renderLeaderboard();
  } else if(currentScreen === 'dashboard-screen' && typeof renderCabinets === 'function'){
    renderCabinets();
    if(typeof renderRival === 'function') renderRival();
  }
});

Realtime.on('broadcast', payload => {
  if(payload && typeof applyBroadcast === 'function') applyBroadcast(payload);
});

// Who the server currently sees connected — one source for anything that
// wants it, rather than each feature polling for its own copy.
let onlineNow = [];
function isUserOnline(user){ return onlineNow.includes(user); }

Realtime.on('presence', payload => {
  onlineNow = (payload && payload.online) || [];
  if(typeof renderChat === 'function' && typeof chatOpen !== 'undefined' && chatOpen){
    renderChat();
  }
});
