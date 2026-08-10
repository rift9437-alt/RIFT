/* =========================================================
   PARTY MODE — create/join a room, everyone plays the same
   randomly-picked game, highest score wins. Backed by simple
   REST polling (matches the broadcast/chat polling pattern
   already used elsewhere in this file).
   ========================================================= */
let currentParty = null;
let partyPollTimer = null;
let partySubmittedGame = null; // guards against double-submitting a score

function openPartyLobby(){
  if(currentParty){
    renderPartyRoom();
    startPartyPolling();
  } else {
    document.getElementById('party-lobby-view').classList.remove('hidden');
    document.getElementById('party-waiting-view').classList.add('hidden');
    document.getElementById('party-playing-view').classList.add('hidden');
    document.getElementById('party-finished-view').classList.add('hidden');
  }
}

function leaveAndBackToDashboard(){
  stopPartyPolling();
  backToDashboard();
}

async function createParty(){
  const err = document.getElementById('party-lobby-error');
  err.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/party/create`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser})
    });
    const data = await res.json();
    if(!res.ok){ err.textContent = data.error || 'Could not create a room.'; return; }
    currentParty = data;
    renderPartyRoom();
    startPartyPolling();
  }catch(e){
    console.error('Create party failed:', e);
    err.textContent = 'Could not reach the server — try again.';
  }
}

async function joinParty(){
  const err = document.getElementById('party-lobby-error');
  err.textContent = '';
  const code = document.getElementById('party-join-code').value.trim().toUpperCase();
  if(!code){ err.textContent = 'Enter a room code.'; return; }
  try{
    const res = await apiFetch(`${LB_API_BASE}/party/join`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, code})
    });
    const data = await res.json();
    if(!res.ok){ err.textContent = data.error || 'Could not join that room.'; return; }
    currentParty = data;
    renderPartyRoom();
    startPartyPolling();
  }catch(e){
    console.error('Join party failed:', e);
    err.textContent = 'Could not reach the server — try again.';
  }
}

async function leaveParty(){
  stopPartyPolling();
  if(currentParty){
    try{
      await apiFetch(`${LB_API_BASE}/party/leave`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, code: currentParty.code})
      });
    }catch(e){ /* non-critical */ }
  }
  currentParty = null;
  partySubmittedGame = null;
  document.getElementById('party-join-code').value = '';
  openPartyLobby();
}

async function startParty(){
  if(!currentParty) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/party/start`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, code: currentParty.code})
    });
    const data = await res.json();
    if(res.ok){ currentParty = data; renderPartyRoom(); }
  }catch(e){ console.error('Start party failed:', e); }
}

async function endParty(){
  if(!currentParty) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/party/end`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, code: currentParty.code})
    });
    const data = await res.json();
    if(res.ok){ currentParty = data; renderPartyRoom(); }
  }catch(e){ console.error('End party failed:', e); }
}

async function rematchParty(){
  if(!currentParty) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/party/rematch`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, code: currentParty.code})
    });
    const data = await res.json();
    if(res.ok){ currentParty = data; partySubmittedGame = null; renderPartyRoom(); }
  }catch(e){ console.error('Rematch failed:', e); }
}

// Launches the party's assigned cabinet like a normal game. When the player
// backs out to the dashboard, backToDashboard() notices partySubmittedGame
// is pending and auto-submits whatever score that cabinet's own leaderboard
// stat shows for them, then drops them back on the party screen.
function playPartyGame(){
  if(!currentParty || !currentParty.game) return;
  partySubmittedGame = currentParty.game;
  actuallyLaunchCabinet(currentParty.game);
}

async function submitPendingPartyScore(){
  if(!partySubmittedGame || !currentParty) return;
  const cab = CABINETS.find(c => c.id === partySubmittedGame);
  await loadLeaderboard();
  const value = cab && cab.best && lbCache[currentUser] && lbCache[currentUser][cab.best.game]
    ? (lbCache[currentUser][cab.best.game][cab.best.key] || 0) : 0;
  partySubmittedGame = null;
  try{
    const res = await apiFetch(`${LB_API_BASE}/party/score`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({user: currentUser, code: currentParty.code, score: value})
    });
    const data = await res.json();
    if(res.ok) currentParty = data;
  }catch(e){ console.error('Party score submit failed:', e); }
  showScreen('party-screen');
  renderPartyRoom();
  startPartyPolling();
}

function startPartyPolling(){
  stopPartyPolling();
  partyPollTimer = setInterval(pollParty, 4000);
}
function stopPartyPolling(){
  if(partyPollTimer){ clearInterval(partyPollTimer); partyPollTimer = null; }
}

async function pollParty(){
  if(!currentParty) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/party/room?code=${encodeURIComponent(currentParty.code)}`);
    if(!res.ok){ currentParty = null; stopPartyPolling(); if(currentScreen === 'party-screen') openPartyLobby(); return; }
    currentParty = await res.json();
    if(currentScreen === 'party-screen') renderPartyRoom();
  }catch(e){ /* non-critical, ignore */ }
}

function renderPartyRoom(){
  if(!currentParty) return;
  document.getElementById('party-lobby-view').classList.add('hidden');
  document.getElementById('party-waiting-view').classList.toggle('hidden', currentParty.status !== 'waiting');
  document.getElementById('party-playing-view').classList.toggle('hidden', currentParty.status !== 'playing');
  document.getElementById('party-finished-view').classList.toggle('hidden', currentParty.status !== 'finished');

  const isHost = currentParty.host === currentUser;

  if(currentParty.status === 'waiting'){
    document.getElementById('party-room-code').textContent = currentParty.code;
    document.getElementById('party-member-list').innerHTML = currentParty.members.map(m =>
      `<div style="font-family:var(--font-mono); font-size:12px; padding:4px 0;">${m === currentParty.host ? '👑 ' : ''}${m}</div>`
    ).join('');
    document.getElementById('party-host-controls').classList.toggle('hidden', !isHost);
    document.getElementById('party-nonhost-note').classList.toggle('hidden', isHost);
  }

  if(currentParty.status === 'playing'){
    const cab = CABINETS.find(c => c.id === currentParty.game);
    document.getElementById('party-game-name').textContent = cab ? `${cab.icon} ${cab.name}` : currentParty.game;
    const submittedCount = Object.keys(currentParty.scores || {}).length;
    document.getElementById('party-progress-note').textContent = `${submittedCount} / ${currentParty.members.length} players have submitted a score`;
    const alreadyPlayed = Object.prototype.hasOwnProperty.call(currentParty.scores || {}, currentUser);
    const btn = document.getElementById('party-play-btn');
    btn.textContent = alreadyPlayed ? '✅ Run Submitted' : '▶ PLAY YOUR RUN';
    btn.disabled = alreadyPlayed;
    document.getElementById('party-host-end-controls').classList.toggle('hidden', !isHost);
  }

  if(currentParty.status === 'finished'){
    const cab = CABINETS.find(c => c.id === currentParty.game);
    document.getElementById('party-finished-game').textContent = (cab ? cab.name : currentParty.game).toUpperCase();
    const label = cab && cab.best ? cab.best.label : 'SCORE';
    const rows = currentParty.members
      .map(m => ({ user: m, value: (currentParty.scores && currentParty.scores[m]) || 0 }))
      .sort((a,b) => b.value - a.value);
    document.getElementById('party-results-table').innerHTML =
      `<tr><th>Player</th><th>${label}</th></tr>` + rows.map((r,i) => {
        const medal = i===0?'🥇':(i===1?'🥈':(i===2?'🥉':''));
        const me = r.user === currentUser ? ' style="color:var(--cyan)"' : '';
        return `<tr><td${me}><span class="rank-medal">${medal}</span>${r.user}</td><td>${r.value}</td></tr>`;
      }).join('');
    document.getElementById('party-rematch-controls').classList.toggle('hidden', !isHost);
  }
}
