/* =========================================================
   CLANS
   =========================================================
   One clan per player. The server owns membership, roles and the score —
   this file only renders what it sends back and posts the actions. Clan
   score is the sum of its members' leaderboard points, so it moves when
   people actually play. */
let clanCache = null;      // last roster from the server
let clanCost = 250;
let clanMaxMembers = 10;

function myClan(){
  if(!clanCache || !currentUser) return null;
  return clanCache.find(c => c.members.some(m => m.user === currentUser)) || null;
}
function myClanRole(){
  const c = myClan();
  if(!c) return null;
  const m = c.members.find(x => x.user === currentUser);
  return m ? m.role : null;
}

// Short "[TAG]" prefix used next to names in chat and on the leaderboard.
function clanTagFor(user){
  if(!clanCache) return '';
  const c = clanCache.find(x => x.members.some(m => m.user === user));
  return c ? c.tag : '';
}

async function loadClans(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/clans`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    clanCache = data.clans || [];
    clanCost = data.cost ?? clanCost;
    clanMaxMembers = data.maxMembers ?? clanMaxMembers;
  }catch(e){
    console.error('Clan load failed:', e);
  }
  return clanCache || [];
}

async function openClans(){
  showScreen('clans-screen');
  document.getElementById('clans-body').innerHTML =
    '<div class="clan-empty">Loading clans…</div>';
  await loadClans();
  renderClans();
}

const ROLE_LABEL = { leader: '👑 Leader', officer: '🎖 Officer', member: 'Member' };

function renderClans(){
  const box = document.getElementById('clans-body');
  if(!box) return;
  const mine = myClan();
  const role = myClanRole();

  const createPanel = mine ? '' : `
    <div class="clan-create">
      <div class="setup-section-label">Found a clan &middot; ${clanCost} tokens</div>
      <div class="clan-create-row">
        <input id="clan-tag" maxlength="5" placeholder="TAG" class="clan-input clan-input-tag">
        <input id="clan-name" maxlength="24" placeholder="Clan name" class="clan-input">
        <input id="clan-colour" type="color" value="#2de2c5" class="clan-colour">
      </div>
      <input id="clan-motto" maxlength="80" placeholder="Motto (optional)" class="clan-input">
      <div class="clan-error" id="clan-error"></div>
      <button class="btn btn-primary" onclick="createClan()">Found it</button>
    </div>`;

  const rows = (clanCache || []).map((c, i) => {
    const isMine = mine && mine.id === c.id;
    const full = c.members.length >= clanMaxMembers;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    const action = isMine
      ? `<button class="btn btn-ghost btn-small" onclick="leaveClan()">Leave</button>`
      : mine
        ? ''
        : `<button class="btn btn-small ${full ? 'btn-ghost' : 'btn-primary'}"
                   ${full ? 'disabled' : ''} onclick="joinClan(${c.id})">
             ${full ? 'Full' : 'Join'}
           </button>`;
    return `
      <div class="clan-card ${isMine ? 'clan-card-mine' : ''}" style="--clan:${c.colour}">
        <div class="clan-card-head">
          <span class="clan-rank">${medal || '#' + (i + 1)}</span>
          <span class="clan-tag">[${c.tag}]</span>
          <span class="clan-name">${c.name}</span>
          <span class="clan-score">${c.score} pts</span>
          ${action}
        </div>
        ${c.motto ? `<div class="clan-motto">“${c.motto}”</div>` : ''}
        <div class="clan-members">
          ${c.members.map(m => `
            <span class="clan-member ${m.user === currentUser ? 'is-me' : ''}">
              ${m.user} <i>${ROLE_LABEL[m.role] || m.role} · ${m.points}</i>
              ${isMine && role === 'leader' && m.role !== 'leader'
                ? `<button class="clan-mini" title="${m.role === 'officer' ? 'Demote' : 'Promote'}"
                           onclick="setClanRole('${m.user}','${m.role === 'officer' ? 'member' : 'officer'}')">
                     ${m.role === 'officer' ? '▾' : '▴'}
                   </button>` : ''}
              ${isMine && (role === 'leader' || (role === 'officer' && m.role === 'member'))
                && m.user !== currentUser
                ? `<button class="clan-mini clan-mini-kick" title="Kick"
                           onclick="kickFromClan('${m.user}')">✕</button>` : ''}
            </span>`).join('')}
        </div>
      </div>`;
  }).join('');

  box.innerHTML = createPanel + (rows || '<div class="clan-empty">No clans yet — found the first one.</div>');
}

function clanError(msg){
  const el = document.getElementById('clan-error');
  if(el) el.textContent = msg;
  else toast('Clans', msg, '🛡', 'pink');
}

async function clanPost(path, body, failMsg){
  try{
    const res = await apiFetch(`${LB_API_BASE}/clans/${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(Object.assign({ user: currentUser }, body))
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){ clanError(data.error || failMsg); return null; }
    if(data.clans) clanCache = data.clans;
    renderClans();
    return data;
  }catch(e){
    console.error('Clan action failed:', e);
    clanError('Network error — try again.');
    return null;
  }
}

async function createClan(){
  const tag = document.getElementById('clan-tag').value.trim().toUpperCase();
  const name = document.getElementById('clan-name').value.trim();
  const motto = document.getElementById('clan-motto').value.trim();
  const colour = document.getElementById('clan-colour').value;
  clanError('');
  const data = await clanPost('create', { tag, name, motto, colour }, 'Could not found the clan.');
  if(!data) return;
  if(typeof data.tokens === 'number'){
    wallet.tokens = data.tokens;
    if(typeof updateTokenDisplay === 'function') updateTokenDisplay();
  }
  Sfx.play('win');
  toast('Clan founded', `[${tag}] ${name}`, '🛡', 'gold');
}

async function joinClan(id){
  if(await clanPost('join', { clanId: id }, 'Could not join.')){
    Sfx.play('select');
    toast('Joined', 'Welcome to the clan', '🛡', 'cyan');
  }
}

async function leaveClan(){
  const mine = myClan();
  if(!mine) return;
  const warn = myClanRole() === 'leader'
    ? 'You lead this clan. Leaving hands it to your longest-serving officer, or disbands it if you are the last one.'
    : `Leave [${mine.tag}] ${mine.name}?`;
  if(!confirm(warn)) return;
  if(await clanPost('leave', {}, 'Could not leave.')) Sfx.play('click');
}

async function kickFromClan(target){
  if(!confirm(`Remove ${target} from the clan?`)) return;
  await clanPost('kick', { target }, 'Could not remove them.');
}

async function setClanRole(target, role){
  await clanPost('role', { target, role }, 'Could not change their role.');
}

/* ---- bug reports ---------------------------------------------------- */

function openBugReport(){
  document.getElementById('bug-body').value = '';
  document.getElementById('bug-status').textContent = '';
  document.getElementById('bug-modal').classList.remove('hidden');
}
function closeBugReport(){
  document.getElementById('bug-modal').classList.add('hidden');
}
async function submitBugReport(){
  const area = document.getElementById('bug-area').value;
  const body = document.getElementById('bug-body').value.trim();
  const status = document.getElementById('bug-status');
  status.textContent = 'Sending…';
  try{
    const res = await apiFetch(`${LB_API_BASE}/bugs/report`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, area, body })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){ status.textContent = data.error || 'Could not send that.'; return; }
    status.textContent = 'Thanks — logged.';
    Sfx.play('perfect');
    setTimeout(closeBugReport, 900);
  }catch(e){
    console.error('Bug report failed:', e);
    status.textContent = 'Network error — try again.';
  }
}

/* =========================================================
   GLOBAL COUNTERS
   =========================================================
   Arcade-wide totals, derived server-side from the player records. Nothing
   here is a stored counter, so it can't drift away from the real data. */
let globalStatsCache = null;

function compactNumber(n){
  if(n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
  if(n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

function hoursText(seconds){
  const h = seconds / 3600;
  if(h >= 1) return h.toFixed(h >= 10 ? 0 : 1) + 'h';
  return Math.round(seconds / 60) + 'm';
}

async function loadGlobalStats(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/global-stats`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    globalStatsCache = await res.json();
  }catch(e){
    console.error('Global stats load failed:', e);
  }
  return globalStatsCache;
}

function renderGlobalStats(){
  const box = document.getElementById('global-panel');
  if(!box || !globalStatsCache) return;
  const t = globalStatsCache.totals;
  const busiest = globalStatsCache.busiest;
  const cells = [
    ['🪙', compactNumber(t.tokensEarned), 'tokens earned'],
    ['🎮', compactNumber(t.gamesPlayed), 'games played'],
    ['⏱', hoursText(t.secondsPlayed), 'time on the machines'],
    ['🏅', compactNumber(t.achievementsUnlocked), 'achievements'],
    ['📦', compactNumber(t.cratesOpened), 'crates opened'],
    ['🔍', compactNumber(t.secretsFound), 'secrets found']
  ];
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="global-head">ARCADE TOTALS · ALL ${globalStatsCache.players} KEYHOLDERS</div>
    <div class="global-grid">
      ${cells.map(([icon, value, label]) => `
        <div class="global-cell">
          <span class="global-icon">${icon}</span>
          <b>${value}</b>
          <i>${label}</i>
        </div>`).join('')}
    </div>
    ${busiest ? `<div class="global-busiest">Busiest cabinet: <b>${busiest.name}</b> · ${compactNumber(busiest.plays)} plays</div>` : ''}`;
}

async function refreshGlobalStats(){
  await loadGlobalStats();
  renderGlobalStats();
}
