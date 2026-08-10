/* =========================================================
   UPDATE LOG (with secret admin panel)
   ========================================================= */
async function loadAndRenderUpdateLog(){
  const box = document.getElementById('updatelog-content');
  box.textContent = 'Loading…';
  try{
    const res = await apiFetch(`${LB_API_BASE}/updatelog`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    box.textContent = data.content;
  }catch(e){
    console.error('Update log fetch failed:', e);
    box.textContent = "Couldn't load the update log right now — try again in a bit.";
  }
}

let logoClickTimes = [];
function onLogoClick(){
  const now = Date.now();
  logoClickTimes.push(now);
  logoClickTimes = logoClickTimes.filter(t => now - t < 2000);
  if(logoClickTimes.length >= 5){
    logoClickTimes = [];
    openAdminModal();
  }
}

async function openAdminModal(){
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-error').textContent = '';
  document.getElementById('admin-success').textContent = '';
  document.getElementById('admin-content').value = 'Loading…';
  document.getElementById('admin-modal').classList.remove('hidden');

  const userOptions = USERS.map(u => `<option value="${u}">${u}</option>`).join('');
  ['admin-grant-user','admin-setcoins-user','admin-quick-user','admin-floor-user',
   'admin-clone-from','admin-clone-to','admin-ban-user','admin-resetplayer-user'].forEach(id=>{
    document.getElementById(id).innerHTML = userOptions;
  });
  document.getElementById('admin-clone-to').selectedIndex = Math.min(1, USERS.length-1);

  ['grant','setcoins','quick','floor','clone','broadcast','ban','logs','resetplayer','resetlb','lockdown'].forEach(section=>{
    const err = document.getElementById(`admin-${section}-error`);
    const ok = document.getElementById(`admin-${section}-success`);
    if(err) err.textContent = '';
    if(ok) ok.textContent = '';
  });
  document.getElementById('admin-grant-amount').value = '';
  document.getElementById('admin-setcoins-amount').value = '';
  document.getElementById('admin-floor-value').value = '';
  document.getElementById('admin-broadcast-text').value = lastBroadcastContent || '';
  document.getElementById('admin-logs-output').value = '';
  document.getElementById('admin-ban-status').textContent = '';
  document.getElementById('admin-lockdown-status').textContent = 'Lockdown status: checking…';

  try{
    const res = await apiFetch(`${LB_API_BASE}/updatelog`);
    const data = await res.json();
    document.getElementById('admin-content').value = data.content;
  }catch(e){
    document.getElementById('admin-content').value = '';
  }

  refreshAdminBanStatus();
  refreshAdminLockdownStatus();
}

document.getElementById('admin-ban-user').addEventListener('change', refreshAdminBanStatus);
document.getElementById('admin-password').addEventListener('blur', ()=>{
  refreshAdminBanStatus();
  refreshAdminLockdownStatus();
});

async function refreshAdminBanStatus(){
  const password = document.getElementById('admin-password').value;
  const statusEl = document.getElementById('admin-ban-status');
  if(!password){ statusEl.textContent = ''; return; }
  const user = document.getElementById('admin-ban-user').value;
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/user-list`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({password})
    });
    const data = await res.json();
    if(!res.ok){ statusEl.textContent = ''; return; }
    const rec = data.users.find(u => u.user === user);
    statusEl.textContent = rec ? `Status: ${rec.banned ? '🚫 BANNED' : '✅ active'} · 🪙 ${rec.tokens}` : '';
  }catch(e){ statusEl.textContent = ''; }
}

async function refreshAdminLockdownStatus(){
  const password = document.getElementById('admin-password').value;
  const statusEl = document.getElementById('admin-lockdown-status');
  if(!password){ statusEl.textContent = ''; return; }
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/lockdown-status`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({password})
    });
    const data = await res.json();
    if(!res.ok){ statusEl.textContent = ''; return; }
    statusEl.textContent = data.lockdown ? '⚠ Lockdown is currently ON' : 'Lockdown is currently off';
  }catch(e){ statusEl.textContent = ''; }
}

function closeAdminModal(){
  document.getElementById('admin-modal').classList.add('hidden');
}

async function saveUpdateLog(){
  const password = document.getElementById('admin-password').value;
  const content = document.getElementById('admin-content').value;
  const err = document.getElementById('admin-error');
  const ok = document.getElementById('admin-success');
  err.textContent = ''; ok.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/updatelog/update`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({password, content})
    });
    if(res.status === 401){
      err.textContent = 'ACCESS DENIED — wrong admin password.';
      return;
    }
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    ok.textContent = 'Saved.';
    if(currentScreen === 'updatelog-screen') loadAndRenderUpdateLog();
    setTimeout(closeAdminModal, 700);
  }catch(e){
    console.error('Update log save failed:', e);
    err.textContent = 'Save failed — check the server is running.';
  }
}

async function grantCoins(){
  const password = document.getElementById('admin-password').value;
  const user = document.getElementById('admin-grant-user').value;
  const amount = document.getElementById('admin-grant-amount').value;
  const err = document.getElementById('admin-grant-error');
  const ok = document.getElementById('admin-grant-success');
  err.textContent = ''; ok.textContent = '';

  if(!amount || Number(amount) === 0){
    err.textContent = 'Enter a non-zero amount.';
    return;
  }

  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/grant-coins`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({password, user, amount: Number(amount)})
    });
    const data = await res.json();
    if(res.status === 401){
      err.textContent = 'ACCESS DENIED — wrong admin password.';
      return;
    }
    if(!res.ok){
      err.textContent = data.error || 'Grant failed.';
      return;
    }
    ok.textContent = `Done — ${user} now has 🪙 ${data.tokens}.`;
    document.getElementById('admin-grant-amount').value = '';
    // Keep whatever's on screen in sync if it's the current user's own wallet.
    if(user === currentUser){
      wallet = data;
      updateTokenDisplay();
    }
  }catch(e){
    console.error('Grant coins failed:', e);
    err.textContent = 'Grant failed — check the server is running.';
  }
}

async function adminSetCoins(){
  const password = document.getElementById('admin-password').value;
  const user = document.getElementById('admin-setcoins-user').value;
  const amount = document.getElementById('admin-setcoins-amount').value;
  const err = document.getElementById('admin-setcoins-error');
  const ok = document.getElementById('admin-setcoins-success');
  err.textContent = ''; ok.textContent = '';
  if(amount === '' || Number(amount) < 0){
    err.textContent = 'Enter a balance of 0 or more.';
    return;
  }
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/set-coins`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, user, amount: Number(amount)})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = `Done — ${user} now has 🪙 ${data.tokens}.`;
    if(user === currentUser){ wallet = data; updateTokenDisplay(); }
  }catch(e){
    console.error('Set coins failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminMaxUpgrades(){
  const password = document.getElementById('admin-password').value;
  const user = document.getElementById('admin-quick-user').value;
  const err = document.getElementById('admin-quick-error');
  const ok = document.getElementById('admin-quick-success');
  err.textContent = ''; ok.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/max-upgrades`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, user})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = `Every upgrade maxed for ${user}.`;
    if(user === currentUser){ wallet = data; updateTokenDisplay(); }
  }catch(e){
    console.error('Max upgrades failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminUnlockThemes(){
  const password = document.getElementById('admin-password').value;
  const user = document.getElementById('admin-quick-user').value;
  const err = document.getElementById('admin-quick-error');
  const ok = document.getElementById('admin-quick-success');
  err.textContent = ''; ok.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/unlock-themes`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, user})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = `Every theme unlocked for ${user}.`;
    if(user === currentUser){ wallet = data; updateTokenDisplay(); }
  }catch(e){
    console.error('Unlock themes failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminSetFloor(){
  const password = document.getElementById('admin-password').value;
  const user = document.getElementById('admin-floor-user').value;
  const floor = document.getElementById('admin-floor-value').value;
  const err = document.getElementById('admin-floor-error');
  const ok = document.getElementById('admin-floor-success');
  err.textContent = ''; ok.textContent = '';
  if(floor === '' || Number(floor) < 0){
    err.textContent = 'Enter a floor of 0 or more.';
    return;
  }
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/set-floor`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, user, floor: Number(floor)})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = `${user}'s deepest floor is now ${data.deepestFloor}.`;
    if(currentScreen === 'leaderboard-screen') renderLeaderboard();
  }catch(e){
    console.error('Set floor failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminClonePlayer(){
  const password = document.getElementById('admin-password').value;
  const fromUser = document.getElementById('admin-clone-from').value;
  const toUser = document.getElementById('admin-clone-to').value;
  const err = document.getElementById('admin-clone-error');
  const ok = document.getElementById('admin-clone-success');
  err.textContent = ''; ok.textContent = '';
  if(fromUser === toUser){
    err.textContent = 'Pick two different users.';
    return;
  }
  if(!confirm(`This will completely overwrite ${toUser}'s stats, wallet, tokens, and upgrades with a copy of ${fromUser}'s. Continue?`)) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/clone-player`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, fromUser, toUser})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = `Cloned ${fromUser} onto ${toUser}.`;
    if(toUser === currentUser){ loadWallet(); }
    if(currentScreen === 'leaderboard-screen') renderLeaderboard();
  }catch(e){
    console.error('Clone player failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminSendBroadcast(){
  const password = document.getElementById('admin-password').value;
  const content = document.getElementById('admin-broadcast-text').value;
  const err = document.getElementById('admin-broadcast-error');
  const ok = document.getElementById('admin-broadcast-success');
  err.textContent = ''; ok.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/broadcast`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, content})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = content ? 'Broadcast sent to everyone.' : 'Broadcast cleared.';
    pollBroadcast();
  }catch(e){
    console.error('Broadcast failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

function adminClearBroadcast(){
  document.getElementById('admin-broadcast-text').value = '';
  adminSendBroadcast();
}

async function adminClearChat(){
  const password = document.getElementById('admin-password').value;
  const err = document.getElementById('admin-chat-error');
  const ok = document.getElementById('admin-chat-success');
  err.textContent = ''; ok.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/clear-chat`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password})
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = 'Chat history cleared.';
    chatMessages = [];
    chatLastId = 0;
    chatUnread = 0;
    updateChatBadge();
    renderChat();
  }catch(e){ err.textContent = 'Could not reach the server.'; }
}

async function adminBanUser(){ await adminSetBan(true); }
async function adminUnbanUser(){ await adminSetBan(false); }

async function adminSetBan(banned){
  const password = document.getElementById('admin-password').value;
  const user = document.getElementById('admin-ban-user').value;
  const err = document.getElementById('admin-ban-error');
  const ok = document.getElementById('admin-ban-success');
  err.textContent = ''; ok.textContent = '';
  if(banned && !confirm(`Ban ${user}? They'll be logged out immediately and unable to log back in until unbanned.`)) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/ban`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, user, banned})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = `${user} is now ${banned ? 'banned' : 'unbanned'}.`;
    if(banned && user === currentUser){ forceLogout('Your account has been banned.'); }
    refreshAdminBanStatus();
  }catch(e){
    console.error('Ban/unban failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminLoadLogs(){
  const password = document.getElementById('admin-password').value;
  const err = document.getElementById('admin-logs-error');
  const out = document.getElementById('admin-logs-output');
  err.textContent = ''; out.value = 'Loading…';
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/logs`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; out.value=''; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; out.value=''; return; }
    out.value = data.logs.length ? data.logs.map(l =>
      `[${new Date(l.created_at).toLocaleString()}] ${l.action} ${JSON.stringify(l.details)}`
    ).join('\n') : 'No log entries yet.';
  }catch(e){
    console.error('Load logs failed:', e);
    err.textContent = 'Failed — check the server is running.';
    out.value = '';
  }
}

async function adminResetPlayer(){
  const password = document.getElementById('admin-password').value;
  const user = document.getElementById('admin-resetplayer-user').value;
  const scope = document.getElementById('admin-resetplayer-scope').value;
  const err = document.getElementById('admin-resetplayer-error');
  const ok = document.getElementById('admin-resetplayer-success');
  err.textContent = ''; ok.textContent = '';
  if(!confirm(`This will permanently wipe ${user}'s ${scope === 'all' ? 'stats AND wallet' : scope} back to defaults. Continue?`)) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/reset-player`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, user, scope})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = `${user}'s ${scope} reset.`;
    if(user === currentUser){ loadWallet(); }
    if(currentScreen === 'leaderboard-screen') renderLeaderboard();
  }catch(e){
    console.error('Reset player failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminResetLeaderboard(){
  const password = document.getElementById('admin-password').value;
  const scope = document.getElementById('admin-resetlb-scope').value;
  const err = document.getElementById('admin-resetlb-error');
  const ok = document.getElementById('admin-resetlb-success');
  err.textContent = ''; ok.textContent = '';
  const label = scope === 'all' ? 'EVERY game for EVERY player' : `${scope} for every player`;
  if(!confirm(`This will permanently reset the leaderboard for ${label}. Continue?`)) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/reset-leaderboard`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, scope})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = 'Leaderboard reset.';
    if(currentScreen === 'leaderboard-screen') renderLeaderboard();
  }catch(e){
    console.error('Reset leaderboard failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}

async function adminSetLockdown(enabled){
  const password = document.getElementById('admin-password').value;
  const err = document.getElementById('admin-lockdown-error');
  const ok = document.getElementById('admin-lockdown-success');
  err.textContent = ''; ok.textContent = '';
  if(enabled && !confirm('This blocks every login and gameplay action site-wide until you turn it back off. Continue?')) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/admin/lockdown`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({password, enabled})
    });
    const data = await res.json();
    if(res.status === 401){ err.textContent = 'ACCESS DENIED — wrong admin password.'; return; }
    if(!res.ok){ err.textContent = data.error || 'Failed.'; return; }
    ok.textContent = data.lockdown ? 'Lockdown is now ON.' : 'Lockdown is now off.';
    document.getElementById('admin-lockdown-status').textContent = data.lockdown ? '⚠ Lockdown is currently ON' : 'Lockdown is currently off';
    document.getElementById('lockdown-banner').classList.toggle('hidden', !data.lockdown);
  }catch(e){
    console.error('Lockdown toggle failed:', e);
    err.textContent = 'Failed — check the server is running.';
  }
}
