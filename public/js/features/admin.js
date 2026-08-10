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
   'admin-clone-from','admin-clone-to','admin-ban-user','admin-resetplayer-user',
   'admin-player-user','admin-item-user','admin-ach-user'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.innerHTML = userOptions;
  });
  populateAdminCatalogs();
  populateAdminTournamentGames();
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

/* =========================================================
   ADMIN: PLAYER INSPECTOR, GRANTS, BUG TRIAGE
   =========================================================
   All of these post the admin password with each call, the same way the
   rest of the panel does — the server is the only thing that checks it. */

// Fill the item and achievement pickers from the catalogs the client has
// already loaded, so the admin never has to type an id by hand.
function populateAdminCatalogs(){
  const itemSel = document.getElementById('admin-item-id');
  if(itemSel && typeof shopCatalog !== 'undefined' && shopCatalog){
    itemSel.innerHTML = Object.entries(shopCatalog)
      .sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]))
      .map(([id, it]) => `<option value="${id}">${it.name || id}</option>`).join('');
  }
  const achSel = document.getElementById('admin-ach-id');
  if(achSel && typeof achievementsCatalog !== 'undefined' && achievementsCatalog){
    achSel.innerHTML = Object.entries(achievementsCatalog)
      .map(([id, a]) => `<option value="${id}">${a.icon || ''} ${a.name || id}</option>`).join('');
  }
}

async function adminPost(path, body, errId){
  const err = errId ? document.getElementById(errId) : null;
  if(err) err.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(Object.assign(
        { password: document.getElementById('admin-password').value }, body))
    });
    const data = await res.json().catch(()=>({}));
    if(res.status === 401){
      if(err) err.textContent = 'ACCESS DENIED — wrong admin password.';
      return null;
    }
    if(!res.ok){
      if(err) err.textContent = data.error || 'That did not work.';
      return null;
    }
    return data;
  }catch(e){
    console.error('Admin request failed:', path, e);
    if(err) err.textContent = 'Network error — try again.';
    return null;
  }
}

async function adminLookupPlayer(){
  const user = document.getElementById('admin-player-user').value;
  const out = document.getElementById('admin-player-out');
  out.innerHTML = '<div class="admin-note">Loading…</div>';
  const d = await adminPost('/admin/player', { user }, 'admin-player-error');
  if(!d){ out.innerHTML = ''; return; }
  const s = d.wallet.stats || {};
  const rows = [
    ['Tokens', d.wallet.tokens],
    ['Level', `${d.wallet.level} (prestige ${d.wallet.prestige})`],
    ['Podium points', d.points],
    ['Clan', d.clan ? `[${d.clan.tag}] ${d.clan.name} · ${d.clan.role}` : '—'],
    ['Cosmetics owned', d.wallet.owned],
    ['Achievements', d.wallet.achievements.length],
    ['Titles', (d.wallet.titles || []).join(', ') || '—'],
    ['Secrets found', d.wallet.secretsFound],
    ['Lifetime tokens', s.tokensEarnedLifetime || 0],
    ['Time played', Math.round((s.secondsPlayed || 0) / 60) + ' min'],
    ['Best win streak', s.bestWinStreak || 0],
    ['Banned', d.banned ? 'YES' : 'no']
  ];
  const games = Object.entries(d.games || {});
  out.innerHTML = `
    <table class="admin-table">
      ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
    </table>
    <div class="admin-note">${games.length ? 'Games played:' : 'No game stats yet.'}</div>
    ${games.length ? `<table class="admin-table">
      ${games.map(([g, st]) => `<tr><th>${g}</th><td>${
        Object.entries(st).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'
      }</td></tr>`).join('')}
    </table>` : ''}`;
}

async function adminGrantItem(){
  const ok = document.getElementById('admin-item-success');
  ok.textContent = '';
  const d = await adminPost('/admin/grant-item', {
    user: document.getElementById('admin-item-user').value,
    itemId: document.getElementById('admin-item-id').value
  }, 'admin-item-error');
  if(!d) return;
  ok.textContent = d.already
    ? `${d.user} already owned ${d.name}.`
    : `Granted ${d.name} to ${d.user}.`;
}

async function adminGrantAchievement(){
  const ok = document.getElementById('admin-ach-success');
  ok.textContent = '';
  const d = await adminPost('/admin/grant-achievement', {
    user: document.getElementById('admin-ach-user').value,
    achievementId: document.getElementById('admin-ach-id').value
  }, 'admin-ach-error');
  if(!d) return;
  ok.textContent = d.already
    ? `${d.user} already had ${d.name}.`
    : `Granted ${d.name} to ${d.user} — balance now ${d.tokens}.`;
}

async function adminLoadBugs(id, status){
  const out = document.getElementById('admin-bugs-out');
  out.innerHTML = '<div class="admin-note">Loading…</div>';
  const d = await adminPost('/admin/bugs', id ? { id, status } : {}, 'admin-bugs-error');
  if(!d){ out.innerHTML = ''; return; }
  const reports = d.reports || [];
  if(!reports.length){ out.innerHTML = '<div class="admin-note">No reports filed.</div>'; return; }
  out.innerHTML = reports.map(r => `
    <div class="admin-bug admin-bug-${r.status}">
      <div class="admin-bug-head">
        <b>#${r.id}</b> ${r.user_id} · ${r.area}
        <span class="admin-bug-status">${r.status}</span>
      </div>
      <div class="admin-bug-body">${escapeHtml(r.body)}</div>
      <div class="admin-bug-actions">
        <button class="btn btn-small btn-secondary" onclick="adminLoadBugs(${r.id},'fixed')">Fixed</button>
        <button class="btn btn-small btn-secondary" onclick="adminLoadBugs(${r.id},'wontfix')">Won't fix</button>
        <button class="btn btn-small btn-ghost" onclick="adminLoadBugs(${r.id},'open')">Reopen</button>
      </div>
    </div>`).join('');
}

/* ---- tournaments ----------------------------------------------------- */

function populateAdminTournamentGames(){
  const sel = document.getElementById('admin-trn-game');
  if(!sel || typeof CABINETS === 'undefined') return;
  sel.innerHTML = CABINETS.filter(c => c.best)
    .map(c => `<option value="${c.best.game}">${c.icon} ${c.name} — ${c.best.key}</option>`).join('');
}

async function adminCreateTournament(){
  const ok = document.getElementById('admin-trn-success');
  ok.textContent = '';
  const d = await adminPost('/admin/tournaments', {
    action: 'create',
    title: document.getElementById('admin-trn-title').value.trim(),
    game: document.getElementById('admin-trn-game').value,
    prize: Number(document.getElementById('admin-trn-prize').value) || 0,
    hours: Number(document.getElementById('admin-trn-hours').value) || 24
  }, 'admin-trn-error');
  if(!d) return;
  ok.textContent = 'Tournament started.';
  renderAdminTournaments(d.tournaments);
}

async function adminListTournaments(){
  const d = await adminPost('/admin/tournaments', { action: 'list' }, 'admin-trn-error');
  if(d) renderAdminTournaments(d.tournaments);
}

async function adminTournamentAction(id, action){
  if(action === 'delete' && !confirm('Delete tournament #' + id + '? Entries go with it.')) return;
  const d = await adminPost('/admin/tournaments', { action, id }, 'admin-trn-error');
  if(d) renderAdminTournaments(d.tournaments);
}

function renderAdminTournaments(list){
  const out = document.getElementById('admin-trn-out');
  if(!out) return;
  if(!list || !list.length){ out.innerHTML = '<div class="admin-note">None yet.</div>'; return; }
  out.innerHTML = `<table class="admin-table">
    ${list.map(t => `
      <tr>
        <th>#${t.id} ${t.title}</th>
        <td>
          ${t.game}/${t.stat_key} · 🪙${t.prize} ·
          ${t.settled ? `settled — ${t.winner ? t.winner + ' (+' + t.winning_gain + ')' : 'no winner'}`
                      : 'ends ' + new Date(t.ends_at).toLocaleString()}
          <div class="admin-bug-actions" style="margin-top:5px;">
            ${t.settled ? '' : `<button class="btn btn-small btn-secondary" onclick="adminTournamentAction(${t.id},'end')">End now</button>`}
            <button class="btn btn-small btn-ghost" onclick="adminTournamentAction(${t.id},'delete')">Delete</button>
          </div>
        </td>
      </tr>`).join('')}
  </table>`;
}
