/* =========================================================
   PLAYER PROFILE
   ========================================================= */
let profileOptions = null; // { avatars: [...], banners: [...] }
let profileCustomizeSelection = { avatar: null, banner: null };

async function loadProfileOptions(){
  if(profileOptions) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/profile/options`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    profileOptions = await res.json();
  }catch(e){
    console.error('Profile options load failed:', e);
    profileOptions = { avatars: ['🙂'], banners: ['default'] };
  }
}

async function renderProfile(username){
  if(!username) return;
  let profile;
  try{
    const res = await apiFetch(`${LB_API_BASE}/profile?user=${encodeURIComponent(username)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    profile = await res.json();
  }catch(e){
    console.error('Profile load failed:', e);
    return;
  }

  const banner = document.getElementById('profile-banner');
  banner.setAttribute('data-banner', profile.banner || 'default');
  document.getElementById('profile-avatar').textContent = profile.avatar || '🙂';

  const nameEl = document.getElementById('profile-username');
  nameEl.textContent = profile.user;
  nameEl.classList.toggle('animated-name', !!profile.animatedName);

  document.getElementById('profile-titles').innerHTML = (profile.titles || [])
    .map(t => `<span class="profile-title-chip">${t}</span>`).join('');

  document.getElementById('profile-level-label').textContent = `Level ${profile.level}`;
  document.getElementById('profile-xp-label').textContent = `${profile.xpIntoLevel} / ${profile.xpForNextLevel} XP`;
  const pct = profile.xpForNextLevel > 0 ? Math.min(100, (profile.xpIntoLevel / profile.xpForNextLevel) * 100) : 0;
  document.getElementById('profile-xp-bar').style.width = `${pct}%`;

  document.getElementById('profile-tokens').textContent = `🪙 ${profile.tokens}`;
  document.getElementById('profile-fav-game').textContent = profile.favouriteGame || '—';
  document.getElementById('profile-winloss').textContent = `${profile.winLoss.wins}W / ${profile.winLoss.losses}L (${profile.winLoss.ratio})`;
  document.getElementById('profile-hours').textContent = `${profile.hoursPlayed}h`;
  document.getElementById('profile-achievements').textContent = `${profile.achievements.unlocked} / ${profile.achievements.total}`;
  document.getElementById('profile-rank').textContent = `#${profile.seasonRank.rank} of ${profile.seasonRank.of}`;
  document.getElementById('profile-joindate').textContent = profile.joinDate ? new Date(profile.joinDate).toLocaleDateString() : '—';

  const badgesList = document.getElementById('profile-badges-list');
  if(badgesList){
    const badges = (profile.achievements && profile.achievements.badges) || [];
    badgesList.innerHTML = badges.length
      ? badges.map(b => `
          <div class="profile-badge-chip ${b.secret ? 'secret-badge' : ''}">
            <div class="profile-badge-icon">${b.icon}</div>
            <div class="profile-badge-name">${b.name}</div>
          </div>
        `).join('')
      : `<span style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">No achievements unlocked yet.</span>`;
  }

  // Only the profile owner can edit it / manage friends.
  const isOwner = username === currentUser;
  document.getElementById('profile-edit-btn').classList.toggle('hidden', !isOwner);
  renderFriendsList(profile.friends || [], isOwner);

  const lbBlock = document.getElementById('friends-leaderboard-block');
  if(lbBlock){
    lbBlock.classList.toggle('hidden', !isOwner);
    if(isOwner) loadFriendsLeaderboard();
  }

  // Runs, guestbook and the challenge box hang off whoever's profile this is.
  renderProfileExtras(username);
}

async function loadFriendsLeaderboard(){
  if(!currentUser) return;
  const listEl = document.getElementById('friends-leaderboard-list');
  if(!listEl) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/friends/leaderboard?user=${encodeURIComponent(currentUser)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    const rows = data.leaderboard || [];
    listEl.innerHTML = rows.length > 1
      ? rows.map(r => `
          <div class="friends-lb-row ${r.isSelf ? 'self' : ''}">
            <span class="friends-lb-rank">#${r.rank}</span>
            <span>${r.avatar || '🙂'}</span>
            <span class="friends-lb-name">${r.user}${r.prestige ? ' ⭐'.repeat(r.prestige) : ''}</span>
            <span class="friends-lb-stat">Lv ${r.level}</span>
            <span class="friends-lb-stat">🪙 ${r.tokens}</span>
          </div>
        `).join('')
      : `<span style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">Add some friends to see how you stack up.</span>`;
  }catch(e){
    console.error('Friends leaderboard load failed:', e);
  }
}
function renderFriendsList(friends, isOwner){
  const list = document.getElementById('profile-friends-list');
  const addRow = document.getElementById('profile-friend-add');
  if(!list) return;
  list.innerHTML = friends.length
    ? friends.map(f => `
        <span class="profile-friend-chip">
          👤 ${f}
          ${isOwner ? `<button onclick="removeFriend('${f}')" title="Remove">✕</button>` : ''}
        </span>
      `).join('')
    : `<span style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">No friends added yet.</span>`;

  if(!addRow) return;
  if(!isOwner){ addRow.innerHTML = ''; return; }
  const candidates = USERS.filter(u => u !== currentUser && !friends.includes(u));
  addRow.innerHTML = candidates.length
    ? `
      <select id="friend-select">${candidates.map(u => `<option value="${u}">${u}</option>`).join('')}</select>
      <button class="btn btn-secondary" onclick="addFriend()">Add Friend</button>
    `
    : `<span style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">Everyone's already on your list.</span>`;
}

async function addFriend(){
  const select = document.getElementById('friend-select');
  if(!select || !select.value) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/friends/add`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({user: currentUser, friend: select.value})
    });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    await res.json();
    renderProfile(currentUser);
  }catch(e){ console.error('Add friend failed:', e); }
}

async function removeFriend(friend){
  try{
    const res = await apiFetch(`${LB_API_BASE}/friends/remove`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({user: currentUser, friend})
    });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    await res.json();
    renderProfile(currentUser);
  }catch(e){ console.error('Remove friend failed:', e); }
}

async function openProfileCustomize(){
  await loadProfileOptions();
  profileCustomizeSelection = { avatar: wallet ? wallet.avatar : '🙂', banner: wallet ? wallet.banner : 'default' };
  const avatarGrid = document.getElementById('profile-avatar-grid');
  const bannerGrid = document.getElementById('profile-banner-grid');
  avatarGrid.innerHTML = profileOptions.avatars.map(a => `
    <div class="profile-avatar-choice ${a === profileCustomizeSelection.avatar ? 'selected' : ''}" data-avatar="${a}" onclick="pickProfileAvatar('${a}')">${a}</div>
  `).join('');
  bannerGrid.innerHTML = profileOptions.banners.map(b => `
    <div class="profile-banner-choice ${b === profileCustomizeSelection.banner ? 'selected' : ''}" data-banner="${b}" onclick="pickProfileBanner('${b}')"></div>
  `).join('');
  document.getElementById('profile-customize-modal').classList.remove('hidden');
}

function pickProfileAvatar(avatar){
  profileCustomizeSelection.avatar = avatar;
  document.querySelectorAll('#profile-avatar-grid .profile-avatar-choice').forEach(el => {
    el.classList.toggle('selected', el.dataset.avatar === avatar);
  });
  saveProfileCustomization();
}

function pickProfileBanner(banner){
  profileCustomizeSelection.banner = banner;
  document.querySelectorAll('#profile-banner-grid .profile-banner-choice').forEach(el => {
    el.classList.toggle('selected', el.dataset.banner === banner);
  });
  saveProfileCustomization();
}

async function saveProfileCustomization(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/profile/customize`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({user: currentUser, avatar: profileCustomizeSelection.avatar, banner: profileCustomizeSelection.banner})
    });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    wallet = await res.json();
    renderProfile(currentUser);
  }catch(e){ console.error('Profile customize save failed:', e); }
}

function closeProfileCustomize(){
  document.getElementById('profile-customize-modal').classList.add('hidden');
}

// Lightweight playtime heartbeat — called periodically while logged in so
// "Hours Played" reflects real usage without any per-game changes needed.
let playtimeHeartbeatTimer = null;
const PLAYTIME_HEARTBEAT_MS = 60000;

function startPlaytimeHeartbeat(){
  stopPlaytimeHeartbeat();
  playtimeHeartbeatTimer = setInterval(() => {
    if(!currentUser) return;
    apiFetch(`${LB_API_BASE}/wallet/playtime`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({user: currentUser, seconds: PLAYTIME_HEARTBEAT_MS / 1000})
    }).catch(e => console.error('Playtime heartbeat failed:', e));
  }, PLAYTIME_HEARTBEAT_MS);
}

function stopPlaytimeHeartbeat(){
  if(playtimeHeartbeatTimer){ clearInterval(playtimeHeartbeatTimer); playtimeHeartbeatTimer = null; }
}

/* =========================================================
   RECENT RUNS, GUESTBOOK, CHALLENGES
   =========================================================
   An all-time-best table tells you what someone once did. These tell you what
   they've been doing, and give you something to say about it. */
let profileViewing = null;

async function renderProfileExtras(username){
  profileViewing = username;
  const mine = username === currentUser;

  // Challenging yourself is not a thing.
  const cblock = document.getElementById('profile-challenge-block');
  if(cblock) cblock.classList.toggle('hidden', mine);
  if(!mine){
    const sel = document.getElementById('challenge-game');
    if(sel){
      // Only cabinets you've actually posted a score on — there has to be
      // something for them to beat.
      const mineRec = (lbCache && lbCache[currentUser]) || {};
      const playable = CABINETS.filter(c => c.best && (mineRec[c.best.game] || {})[c.best.key]);
      sel.innerHTML = playable.length
        ? playable.map(c => `<option value="${c.best.game}">${escapeHtml(c.name)} · ${(mineRec[c.best.game]||{})[c.best.key]}</option>`).join('')
        : '<option value="">Post a score somewhere first</option>';
    }
  }

  try{
    const res = await apiFetch(`${LB_API_BASE}/runs?user=${encodeURIComponent(username)}`);
    const data = await res.json();
    const box = document.getElementById('profile-runs');
    const runs = data.runs || [];
    lastRuns = runs;
    drawRunChart(runs);
    box.innerHTML = runs.length
      ? runs.map(r => `
          <div class="run-row">
            <span class="run-game">${escapeHtml(r.label || r.game)}</span>
            <span class="run-score ${r.best ? 'run-best' : ''}">${r.score.toLocaleString('en-GB')}${r.best ? ' ★' : ''}</span>
            <span class="run-when">${feedAgo(r.at)}</span>
          </div>`).join('')
      : '<div class="notif-empty">No runs recorded yet.</div>';
  }catch(e){ console.error('Runs load failed:', e); }

  loadGuestbook(username);
}

/* ---- form chart --------------------------------------------------------
   The run list says what you played; this says whether you're getting better
   at it. One cabinet at a time, because scores across different games aren't
   on the same scale and plotting them together would be meaningless. */
function drawRunChart(runs){
  const canvas = document.getElementById('profile-chart');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const pick = document.getElementById('chart-game');
  // Cabinets with enough runs to show a shape at all.
  const counts = {};
  runs.forEach(r => { counts[r.game] = (counts[r.game] || 0) + 1; });
  const games = Object.keys(counts).filter(g => counts[g] >= 2);
  if(pick && pick.dataset.built !== String(games.length)){
    pick.dataset.built = String(games.length);
    pick.innerHTML = games.map(g => {
      const label = (runs.find(r => r.game === g) || {}).label || g;
      return `<option value="${g}">${escapeHtml(label)}</option>`;
    }).join('');
  }
  const game = (pick && pick.value) || games[0];

  const series = runs.filter(r => r.game === game).slice().reverse();
  const note = document.getElementById('chart-note');
  if(series.length < 2){
    if(note) note.textContent = 'Two runs on the same cabinet and a shape appears here.';
    return;
  }
  if(note) note.textContent = `${series.length} recent runs · best ${Math.max(...series.map(r=>r.score)).toLocaleString('en-GB')}`;

  const pad = 8;
  const max = Math.max(...series.map(r => r.score)) || 1;
  const min = Math.min(...series.map(r => r.score));
  const span = (max - min) || max || 1;
  const x = i => pad + (i / (series.length - 1)) * (W - pad * 2);
  const y = v => H - pad - ((v - min) / span) * (H - pad * 2);

  // Fill under the line, so a short series still reads as a chart rather
  // than a stray diagonal.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(45,226,197,0.35)');
  grad.addColorStop(1, 'rgba(45,226,197,0.02)');
  ctx.beginPath();
  ctx.moveTo(x(0), H - pad);
  series.forEach((r, i) => ctx.lineTo(x(i), y(r.score)));
  ctx.lineTo(x(series.length - 1), H - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  series.forEach((r, i) => i ? ctx.lineTo(x(i), y(r.score)) : ctx.moveTo(x(i), y(r.score)));
  ctx.strokeStyle = '#2de2c5';
  ctx.lineWidth = 2;
  ctx.stroke();

  // A dot on every run, gold where it was a personal best at the time.
  series.forEach((r, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(r.score), r.best ? 3.5 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = r.best ? '#ffc857' : '#7dd3ff';
    ctx.fill();
  });
}

let lastRuns = [];
function changeChartGame(){ drawRunChart(lastRuns); }

async function loadGuestbook(username){
  try{
    const res = await apiFetch(`${LB_API_BASE}/guestbook?user=${encodeURIComponent(username)}`);
    const data = await res.json();
    paintGuestbook(data.notes || []);
  }catch(e){ console.error('Guestbook load failed:', e); }
}

function paintGuestbook(notes){
  const box = document.getElementById('profile-guestbook');
  if(!box) return;
  box.innerHTML = notes.length
    ? notes.map(n => `
        <div class="gb-note">
          <b>${escapeHtml(n.author)}</b><span>${feedAgo(n.at)}</span>
          <p>${escapeHtml(n.body)}</p>
        </div>`).join('')
    : '<div class="notif-empty">Nothing written here yet.</div>';
}

async function signGuestbook(){
  const input = document.getElementById('gb-input');
  const body = (input.value || '').trim();
  if(!body || !profileViewing) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/guestbook`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, profile: profileViewing, body })
    });
    const data = await res.json();
    if(!res.ok){ toast('Not posted', data.error || 'Try again', '📝', 'pink'); return; }
    input.value = '';
    paintGuestbook(data.notes || []);
    Sfx.play('select');
  }catch(e){ console.error('Guestbook post failed:', e); }
}

function challengeFromProfile(){
  const game = document.getElementById('challenge-game').value;
  if(!game || !profileViewing) return;
  sendChallenge(profileViewing, game);
}
