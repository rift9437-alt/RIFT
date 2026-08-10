/* =========================================================
   ARCADE BUILDER — design a simple custom game from a template
   (not runnable yet; this saves the design and lets creators
   publish it to a community list).
   ========================================================= */
const BUILDER_TYPES = [
  { id:'clicker',     icon:'🖱️', name:'Clicker',     desc:'Tap to earn points. Simple, addictive, endless.' },
  { id:'platformer',  icon:'🏃', name:'Platformer',  desc:'Run and jump across platforms toward the goal.' },
  { id:'shooter',     icon:'🔫', name:'Shooter',     desc:'Aim and fire at waves of incoming enemies.' },
  { id:'racing',      icon:'🏎️', name:'Racing',      desc:'Race against the clock or a rival to the finish.' },
  { id:'survival',    icon:'🛡️', name:'Survival',    desc:'Last as long as you can against rising difficulty.' }
];
let builderMyGames = [];
let builderCommunityGames = [];
let builderTab = 'mine';
let builderEditingId = null;
let builderDraftType = null;

function openBuilder(){
  showBuilderListView();
  loadBuilderGames();
}

async function loadBuilderGames(){
  try{
    const [mineRes, communityRes] = await Promise.all([
      apiFetch(`${LB_API_BASE}/builder/mine?user=${encodeURIComponent(currentUser)}`),
      apiFetch(`${LB_API_BASE}/builder/community`)
    ]);
    builderMyGames = mineRes.ok ? await mineRes.json() : [];
    builderCommunityGames = communityRes.ok ? await communityRes.json() : [];
  }catch(e){
    console.error('Builder games fetch failed:', e);
  }
  renderBuilderGames();
}

function switchBuilderTab(tab){
  builderTab = tab;
  document.querySelectorAll('#builder-list-view .cosmetic-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderBuilderGames();
}

function builderTypeMeta(typeId){
  return BUILDER_TYPES.find(t => t.id === typeId) || { icon:'🎮', name: typeId };
}

function renderBuilderGames(){
  const grid = document.getElementById('builder-games-grid');
  const note = document.getElementById('builder-empty-note');
  const list = builderTab === 'mine' ? builderMyGames : builderCommunityGames;

  if(!list.length){
    grid.innerHTML = '';
    note.textContent = builderTab === 'mine' ? "You haven't designed a game yet — hit Create Game to start." : 'No community games published yet.';
    return;
  }
  note.textContent = '';

  grid.innerHTML = list.map(g => {
    const meta = builderTypeMeta(g.type);
    const isMine = g.user === currentUser;
    let actions = '';
    if(builderTab === 'mine'){
      actions = `
        <button class="btn btn-secondary" style="margin-top:6px;" onclick="editBuilderGame(${g.id})">✏️ Edit</button>
        <button class="btn ${g.published ? 'btn-secondary' : 'btn-pink'}" style="margin-top:6px;" onclick="toggleBuilderPublish(${g.id}, ${!g.published})">${g.published ? '🔒 Unpublish' : '🌐 Publish'}</button>
        <button class="btn btn-secondary" style="margin-top:6px; color:var(--pink);" onclick="deleteBuilderGame(${g.id})">🗑 Delete</button>
      `;
    } else {
      actions = `
        <button class="btn ${g.likedByMe ? 'btn-pink' : 'btn-secondary'}" style="margin-top:6px;" onclick="likeBuilderGame(${g.id})">❤️ ${g.likes||0}</button>
        ${isMine ? '' : `<div class="cosmetic-creator" style="margin-top:4px;">by ${g.user}</div>`}
      `;
    }
    return `
      <div class="cosmetic-card">
        <div class="cosmetic-preview">${meta.icon}</div>
        <div class="cosmetic-name">${g.title}</div>
        <div class="cosmetic-creator">${meta.name} &middot; ${g.config.difficulty || 'normal'}</div>
        ${actions}
      </div>
    `;
  }).join('');
}

function showBuilderListView(){
  document.getElementById('builder-list-view').classList.remove('hidden');
  document.getElementById('builder-type-view').classList.add('hidden');
  document.getElementById('builder-customize-view').classList.add('hidden');
  builderEditingId = null;
  builderDraftType = null;
}

function startNewBuilderGame(){
  builderEditingId = null;
  document.getElementById('builder-list-view').classList.add('hidden');
  document.getElementById('builder-customize-view').classList.add('hidden');
  document.getElementById('builder-type-view').classList.remove('hidden');
  document.getElementById('builder-type-grid').innerHTML = BUILDER_TYPES.map(t => `
    <div class="cosmetic-card" style="cursor:pointer;" onclick="pickBuilderType('${t.id}')">
      <div class="cosmetic-preview">${t.icon}</div>
      <div class="cosmetic-name">${t.name}</div>
      <div class="cosmetic-creator">${t.desc}</div>
    </div>
  `).join('');
}

function pickBuilderType(typeId){
  builderDraftType = typeId;
  document.getElementById('builder-type-view').classList.add('hidden');
  document.getElementById('builder-customize-view').classList.remove('hidden');
  document.getElementById('builder-customize-type-label').textContent = `${builderTypeMeta(typeId).icon} ${builderTypeMeta(typeId).name} template`;
  document.getElementById('builder-form-error').textContent = '';
  document.getElementById('builder-form-success').textContent = '';
  document.getElementById('builder-title').value = '';
  document.getElementById('builder-background').value = '';
  document.getElementById('builder-player').value = '';
  document.getElementById('builder-enemies').value = '';
  document.getElementById('builder-speed').value = 5;
  document.getElementById('builder-speed-value').textContent = '5';
  document.getElementById('builder-score-rule').value = '';
  document.getElementById('builder-difficulty').value = 'normal';
}

function editBuilderGame(id){
  const g = builderMyGames.find(x => x.id === id);
  if(!g) return;
  builderEditingId = id;
  builderDraftType = g.type;
  document.getElementById('builder-list-view').classList.add('hidden');
  document.getElementById('builder-type-view').classList.add('hidden');
  document.getElementById('builder-customize-view').classList.remove('hidden');
  document.getElementById('builder-customize-type-label').textContent = `${builderTypeMeta(g.type).icon} ${builderTypeMeta(g.type).name} template`;
  document.getElementById('builder-form-error').textContent = '';
  document.getElementById('builder-form-success').textContent = '';
  document.getElementById('builder-title').value = g.title || '';
  document.getElementById('builder-background').value = g.config.background || '';
  document.getElementById('builder-player').value = g.config.player || '';
  document.getElementById('builder-enemies').value = g.config.enemies || '';
  document.getElementById('builder-speed').value = g.config.speed || 5;
  document.getElementById('builder-speed-value').textContent = g.config.speed || 5;
  document.getElementById('builder-score-rule').value = g.config.scoreRule || '';
  document.getElementById('builder-difficulty').value = g.config.difficulty || 'normal';
}

async function saveBuilderDraft(){
  const err = document.getElementById('builder-form-error');
  const ok = document.getElementById('builder-form-success');
  err.textContent = ''; ok.textContent = '';

  const title = document.getElementById('builder-title').value.trim();
  const background = document.getElementById('builder-background').value.trim();
  const player = document.getElementById('builder-player').value.trim();
  const enemies = document.getElementById('builder-enemies').value.trim();
  const speed = Number(document.getElementById('builder-speed').value);
  const scoreRule = document.getElementById('builder-score-rule').value.trim();
  const difficulty = document.getElementById('builder-difficulty').value;

  if(!title){ err.textContent = 'Give your game a title.'; return; }
  if(!background || !player || !enemies){ err.textContent = 'Fill in background, player, and enemies.'; return; }
  if(!scoreRule){ err.textContent = 'Add a score rule.'; return; }

  const config = { background, player, enemies, speed, scoreRule, difficulty };
  const endpoint = builderEditingId ? '/builder/update' : '/builder/save';
  const body = { user: currentUser, title, type: builderDraftType, config };
  if(builderEditingId) body.gameId = builderEditingId;

  try{
    const res = await apiFetch(`${LB_API_BASE}${endpoint}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body)
    });
    const data = await res.json();
    if(!res.ok){ err.textContent = data.error || 'Could not save your game.'; return; }
    ok.textContent = 'Saved!';
    await loadBuilderGames();
    setTimeout(showBuilderListView, 700);
  }catch(e){
    console.error('Builder save failed:', e);
    err.textContent = 'Could not reach the server — try again.';
  }
}

async function toggleBuilderPublish(id, published){
  try{
    const res = await apiFetch(`${LB_API_BASE}/builder/publish`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, gameId: id, published})
    });
    if(res.ok) await loadBuilderGames();
  }catch(e){ console.error('Builder publish toggle failed:', e); }
}

async function deleteBuilderGame(id){
  if(!confirm('Delete this game design? This cannot be undone.')) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/builder/delete`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, gameId: id})
    });
    if(res.ok) await loadBuilderGames();
  }catch(e){ console.error('Builder delete failed:', e); }
}

async function likeBuilderGame(id){
  try{
    const res = await apiFetch(`${LB_API_BASE}/builder/like`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser, gameId: id})
    });
    if(res.ok) await loadBuilderGames();
  }catch(e){ console.error('Builder like failed:', e); }
}
