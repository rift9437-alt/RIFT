/* =========================================================
   AUTH
   ========================================================= */
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
const SESSION_KEY = "level7_session_user";
const SESSION_TOKEN_KEY = "level7_session_token";
let currentUser = null;
let authToken = null;

function authHeaders(){
  const h = {'Content-Type': 'application/json'};
  if(authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}

// Wraps fetch for every API call. If the server says our session is no
// longer valid (401), it forces a logout instead of leaving the page stuck
// silently failing every request.
async function apiFetch(url, options){
  const res = await fetch(url, options);
  if(res.status === 401 && currentUser){
    forceLogout('Your session expired — please log in again.');
  }
  if(res.status === 503){
    document.getElementById('lockdown-banner').classList.remove('hidden');
  }
  return res;
}

async function attemptLogin(){
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/login`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({username: u, password: p})
    });
    const data = await res.json();
    if(!res.ok){
      err.textContent = data.error || 'ACCESS DENIED — check your username & password.';
      return;
    }
    currentUser = data.username;
    authToken = data.token;
    sessionStorage.setItem(SESSION_KEY, currentUser);
    sessionStorage.setItem(SESSION_TOKEN_KEY, authToken);
    document.getElementById('login-password').value = '';
    afterLogin();
  }catch(e){
    console.error('Login failed:', e);
    err.textContent = 'Could not reach the server — try again.';
  }
}

function afterLogin(){
  document.getElementById('current-username').textContent = currentUser;
  document.getElementById('dash-welcome-line').textContent = 'WELCOME BACK, ' + currentUser;
  showScreen('dashboard-screen');
  loadShopItems().then(loadWallet);
  loadAchievementsCatalog();
  loadSeasonInfo();
  loadDailyChallenges();
  startGlobalPolling();
  startPlaytimeHeartbeat();
  refreshCabinets();
  openChatDock();
  startChatPolling();
  if(typeof TV !== 'undefined') TV.start();
  if(typeof renderRival === 'function') setTimeout(renderRival, 800);
  if(typeof wireSecretSpots === 'function') wireSecretSpots();
  if(typeof Realtime !== 'undefined') Realtime.start();
  if(typeof refreshGlobalStats === 'function') refreshGlobalStats();
  if(typeof loadClans === 'function') loadClans().then(()=>{
    if(typeof renderChat === 'function') renderChat();
  });
}

function logout(){
  stopAllGames();
  if(typeof Realtime !== 'undefined') Realtime.stop();
  stopGlobalPolling();
  stopPlaytimeHeartbeat();
  stopChatPolling();
  hideChatDock();
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  currentUser = null;
  authToken = null;
  wallet = { tokens: 0, owned: ['neon'], equipped: 'neon' };
  resetTheme();
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
  showScreen('login-screen');
}

// Used when the server rejects our session (expired/invalid) mid-session,
// rather than from the user clicking Logout.
function forceLogout(message){
  logout();
  if(message) document.getElementById('login-error').textContent = message;
}


/* =========================================================
   BROADCAST BANNER + LOCKDOWN STATUS
   Polls a couple of lightweight public endpoints while logged
   in so everyone sees an admin's broadcast message or an
   active lockdown without needing to refresh the page.
   ========================================================= */
const BROADCAST_SEEN_KEY = "level7_broadcast_seen";
let globalPollTimer = null;
let lastBroadcastContent = '';

// Shared by the 15s poll and the socket push, so an announcement lands the
// same way whichever arrives first.
function applyBroadcast(data){
  if(!data) return;
  lastBroadcastContent = data.content || '';
  const seen = sessionStorage.getItem(BROADCAST_SEEN_KEY);
  const banner = document.getElementById('broadcast-banner');
  if(data.content && data.updatedAt !== seen){
    document.getElementById('broadcast-banner-text').textContent = '📣 ' + data.content;
    banner.classList.remove('hidden');
    banner.dataset.updatedAt = data.updatedAt;
  } else if(!data.content){
    banner.classList.add('hidden');
  }
}

async function pollBroadcast(){
  try{
    const res = await fetch(`${LB_API_BASE}/broadcast`);
    if(!res.ok) return;
    applyBroadcast(await res.json());
  }catch(e){ /* non-critical, ignore */ }
}

function dismissBroadcast(){
  const banner = document.getElementById('broadcast-banner');
  if(banner.dataset.updatedAt) sessionStorage.setItem(BROADCAST_SEEN_KEY, banner.dataset.updatedAt);
  banner.classList.add('hidden');
}

function startGlobalPolling(){
  pollBroadcast();
  checkPendingGifts();
  if(globalPollTimer) clearInterval(globalPollTimer);
  globalPollTimer = setInterval(() => { pollBroadcast(); checkPendingGifts(); }, 15000);
}

function stopGlobalPolling(){
  if(globalPollTimer){ clearInterval(globalPollTimer); globalPollTimer = null; }
  document.getElementById('broadcast-banner').classList.add('hidden');
  document.getElementById('lockdown-banner').classList.add('hidden');
}

['login-username','login-password'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', e=>{
    if(e.key === 'Enter') attemptLogin();
  });
});
