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
