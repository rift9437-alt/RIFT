/* =========================================================
   ASTEROID BLASTER — token upgrades
   Same "server decides cost/effect" pattern as the cosmetic
   shop above: the client only ever says which upgrade it wants,
   never how much it costs or what level it unlocks.
   ========================================================= */
let asteroidUpgradeCatalog = null;

async function loadAsteroidUpgradeCatalog(){
  if(asteroidUpgradeCatalog) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/asteroid/upgrades`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    asteroidUpgradeCatalog = await res.json();
  }catch(e){
    console.error('Asteroid upgrade catalog load failed:', e);
    asteroidUpgradeCatalog = asteroidUpgradeCatalog || {};
  }
}

async function renderAsteroidUpgrades(){
  const grid = document.getElementById('asteroid-upgrades-grid');
  const msg = document.getElementById('asteroid-upgrades-message');
  if(!grid) return;
  msg.textContent = '';
  await loadAsteroidUpgradeCatalog();
  await loadWallet();
  document.getElementById('asteroid-upgrades-balance').textContent = '🪙 ' + (wallet.tokens||0);

  const owned = wallet.asteroidUpgrades || { extraLife:0, turnSpeed:0, autoTurret:0 };

  grid.innerHTML = Object.entries(asteroidUpgradeCatalog).map(([id, up])=>{
    const level = owned[id] || 0;
    const maxed = level >= up.maxLevel;
    let btnHtml;
    if(maxed){
      btnHtml = `<button class="btn btn-secondary" disabled>Maxed (Lv ${level})</button>`;
    } else {
      const cost = up.costs[level];
      const canAfford = wallet.tokens >= cost;
      const label = up.maxLevel > 1 ? `Upgrade Lv ${level}&rarr;${level+1}` : 'Buy';
      btnHtml = `<button class="btn btn-primary" onclick="handleAsteroidUpgradePurchase('${id}')" ${canAfford?'':'disabled'}>${label} &middot; 🪙 ${cost}</button>`;
    }
    const levelTag = up.maxLevel > 1 ? ` (Lv ${level}/${up.maxLevel})` : (level ? ' (Owned)' : '');
    return `
      <div class="shop-card">
        <div class="shop-card-name">${up.name}${levelTag}</div>
        <div style="font-family:var(--font-mono); font-size:11px; opacity:0.75; margin:2px 0 6px;">${up.desc}</div>
        ${btnHtml}
      </div>
    `;
  }).join('');
}

async function handleAsteroidUpgradePurchase(upgradeId){
  const msg = document.getElementById('asteroid-upgrades-message');
  msg.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/asteroid/upgrades/purchase`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, upgradeId})
    });
    const data = await res.json();
    if(!res.ok){
      msg.textContent = data.error === 'Not enough tokens' ? "You don't have enough tokens yet." : (data.error || 'Purchase failed.');
      return;
    }
    wallet = data;
    updateTokenDisplay();
    renderAsteroidUpgrades();
  }catch(e){
    console.error('Asteroid upgrade purchase failed:', e);
    msg.textContent = 'Could not reach the server — try again.';
  }
}


/* =========================================================
   WILD DUEL — token upgrades
   Same pattern as the Asteroid Blaster upgrades: server owns
   cost/level, client just says which upgrade it wants.
   ========================================================= */
let wildduelUpgradeCatalog = null;

async function loadWildDuelUpgradeCatalog(){
  if(wildduelUpgradeCatalog) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/wildduel/upgrades`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    wildduelUpgradeCatalog = await res.json();
  }catch(e){
    console.error('Wild Duel upgrade catalog load failed:', e);
    wildduelUpgradeCatalog = wildduelUpgradeCatalog || {};
  }
}

async function renderWildDuelUpgrades(){
  const grid = document.getElementById('wildduel-upgrades-grid');
  const msg = document.getElementById('wildduel-upgrades-message');
  if(!grid) return;
  msg.textContent = '';
  await loadWildDuelUpgradeCatalog();
  await loadWallet();
  document.getElementById('wildduel-upgrades-balance').textContent = '🪙 ' + (wallet.tokens||0);

  const owned = wallet.wildduelUpgrades || { extraHp:0, fasterReload:0, fasterMovement:0 };

  grid.innerHTML = Object.entries(wildduelUpgradeCatalog).map(([id, up])=>{
    const level = owned[id] || 0;
    const maxed = level >= up.maxLevel;
    let btnHtml;
    if(maxed){
      btnHtml = `<button class="btn btn-secondary" disabled>Maxed (Lv ${level})</button>`;
    } else {
      const cost = up.costs[level];
      const canAfford = wallet.tokens >= cost;
      const label = up.maxLevel > 1 ? `Upgrade Lv ${level}&rarr;${level+1}` : 'Buy';
      btnHtml = `<button class="btn btn-primary" onclick="handleWildDuelUpgradePurchase('${id}')" ${canAfford?'':'disabled'}>${label} &middot; 🪙 ${cost}</button>`;
    }
    const levelTag = up.maxLevel > 1 ? ` (Lv ${level}/${up.maxLevel})` : (level ? ' (Owned)' : '');
    return `
      <div class="shop-card">
        <div class="shop-card-name">${up.name}${levelTag}</div>
        <div style="font-family:var(--font-mono); font-size:11px; opacity:0.75; margin:2px 0 6px;">${up.desc}</div>
        ${btnHtml}
      </div>
    `;
  }).join('');
}

async function handleWildDuelUpgradePurchase(upgradeId){
  const msg = document.getElementById('wildduel-upgrades-message');
  msg.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/wildduel/upgrades/purchase`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, upgradeId})
    });
    const data = await res.json();
    if(!res.ok){
      msg.textContent = data.error === 'Not enough tokens' ? "You don't have enough tokens yet." : (data.error || 'Purchase failed.');
      return;
    }
    wallet = data;
    updateTokenDisplay();
    renderWildDuelUpgrades();
  }catch(e){
    console.error('Wild Duel upgrade purchase failed:', e);
    msg.textContent = 'Could not reach the server — try again.';
  }
}


/* =========================================================
   CRYPT CRAWLER — permanent token upgrades
   Same pattern as the other games' upgrade shops.
   ========================================================= */
let roguelikeUpgradeCatalog = null;

async function loadRoguelikeUpgradeCatalog(){
  if(roguelikeUpgradeCatalog) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/roguelike/upgrades`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    roguelikeUpgradeCatalog = await res.json();
  }catch(e){
    console.error('Crypt Crawler upgrade catalog load failed:', e);
    roguelikeUpgradeCatalog = roguelikeUpgradeCatalog || {};
  }
}

async function renderRoguelikeUpgrades(){
  const grid = document.getElementById('roguelike-upgrades-grid');
  const msg = document.getElementById('roguelike-upgrades-message');
  if(!grid) return;
  msg.textContent = '';
  await loadRoguelikeUpgradeCatalog();
  await loadWallet();
  document.getElementById('roguelike-upgrades-balance').textContent = '🪙 ' + (wallet.tokens||0);

  const owned = wallet.roguelikeUpgrades || { extraHp:0, swordDamage:0, magicPower:0 };

  grid.innerHTML = Object.entries(roguelikeUpgradeCatalog).map(([id, up])=>{
    const level = owned[id] || 0;
    const maxed = level >= up.maxLevel;
    let btnHtml;
    if(maxed){
      btnHtml = `<button class="btn btn-secondary" disabled>Maxed (Lv ${level})</button>`;
    } else {
      const cost = up.costs[level];
      const canAfford = wallet.tokens >= cost;
      const label = up.maxLevel > 1 ? `Upgrade Lv ${level}&rarr;${level+1}` : 'Buy';
      btnHtml = `<button class="btn btn-primary" onclick="handleRoguelikeUpgradePurchase('${id}')" ${canAfford?'':'disabled'}>${label} &middot; 🪙 ${cost}</button>`;
    }
    const levelTag = up.maxLevel > 1 ? ` (Lv ${level}/${up.maxLevel})` : (level ? ' (Owned)' : '');
    return `
      <div class="shop-card">
        <div class="shop-card-name">${up.name}${levelTag}</div>
        <div style="font-family:var(--font-mono); font-size:11px; opacity:0.75; margin:2px 0 6px;">${up.desc}</div>
        ${btnHtml}
      </div>
    `;
  }).join('');
}

async function handleRoguelikeUpgradePurchase(upgradeId){
  const msg = document.getElementById('roguelike-upgrades-message');
  msg.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/roguelike/upgrades/purchase`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, upgradeId})
    });
    const data = await res.json();
    if(!res.ok){
      msg.textContent = data.error === 'Not enough tokens' ? "You don't have enough tokens yet." : (data.error || 'Purchase failed.');
      return;
    }
    wallet = data;
    updateTokenDisplay();
    renderRoguelikeUpgrades();
  }catch(e){
    console.error('Crypt Crawler upgrade purchase failed:', e);
    msg.textContent = 'Could not reach the server — try again.';
  }
}

// Polling: while the leaderboard screen is open, refresh every few seconds
// so everyone sees everyone else's results without needing to reload.
const LB_POLL_MS = 4000;
let lbPollTimer = null;
function startLeaderboardPolling(){
  stopLeaderboardPolling();
  lbPollTimer = setInterval(()=>{
    if(currentScreen === 'leaderboard-screen') renderLeaderboard();
  }, LB_POLL_MS);
}
function stopLeaderboardPolling(){
  if(lbPollTimer){ clearInterval(lbPollTimer); lbPollTimer = null; }
}
startLeaderboardPolling();

// One entry per cabinet that keeps a score. `cols` are the stat keys shown as
// table columns; the first one is the primary sort key.
const LB_BOARDS = [
  { game:'soccer',    title:'⚽ Street Soccer',    cols:[['wins','Wins'],['goals','Goals'],['saves','Saves']] },
  { game:'racing',    title:'🏎️ Apex Loop',        cols:[['wins','Wins']] },
  { game:'tank',      title:'🛡️ Tank Duel',        cols:[['wins','Wins']] },
  { game:'runner',    title:'🏃 Hop Runner',       cols:[['highScore','High Score']] },
  { game:'wildduel',  title:'🤠 Wild Duel',        cols:[['wins','Wins']] },
  { game:'asteroid',  title:'🌠 Asteroid Blaster', cols:[['highScore','Best Shot']] },
  { game:'breaker',   title:'🧱 Neon Breaker',     cols:[['highScore','High Score']] },
  { game:'roguelike', title:'⚔️ Crypt Crawler',    cols:[['deepestFloor','Deepest Floor']] },
  { game:'comet',     title:'☄️ Comet Dodge',      cols:[['highScore','High Score']] },
  { game:'tunnel',    title:'🌀 Hyper Tunnel',     cols:[['highScore','High Score']] },
  { game:'depths',    title:'👁 Neon Depths',      cols:[['bestWave','Best Wave']] },
  { game:'stack',     title:'🏗 Sky Stack',        cols:[['bestHeight','Best Height']] },
  { game:'golf',      title:'🪐 Gravity Golf',     cols:[['bestHoles','Holes Sunk']] },
  { game:'sumo',      title:'🥏 Neon Sumo',        cols:[['wins','Wins']] },
  { game:'towerdefense', title:'🏰 Tower Defense', cols:[['bestWave','Best Wave']] },
  { game:'parkour',   title:'🥷 Ninja Parkour',    cols:[['bestTime','Best Time']] },
  { game:'zombie',    title:'🧟 Zombie Survival',  cols:[['bestWave','Best Wave']] },
  { game:'pirate',    title:'🏴‍☠️ Pirate Voyage',   cols:[['bestTreasure','Treasure']] },
  { game:'samurai',   title:'🗡 Samurai Showdown', cols:[['wins','Wins']] },
  { game:'policechase', title:'🚔 Police Chase',   cols:[['highScore','High Score']] },
  { game:'tactics',   title:'♟️ Tactics Grid',     cols:[['wins','Wins']] },
  { game:'runeduel',  title:'🔮 Rune Duel',        cols:[['wins','Wins']] },
  { game:'warlord',   title:'🗺️ Warlord',          cols:[['wins','Wins']] },
  { game:'evolution', title:'🧬 Evolution',        cols:[['bestStage','Best Stage']] },
  { game:'flood',     title:'🌊 Flood Escape',     cols:[['bestRooms','Rooms']] },
  { game:'hoops',     title:'🏀 Buzzer Beater',    cols:[['highScore','High Score']] },
  { game:'burger',    title:'🍔 Burger Rush',      cols:[['highScore','Served']] },
  { game:'tag',       title:'🏃 Neon Tag',         cols:[['wins','Wins']] },
  { game:'robot',     title:'🤖 Robot Arena',      cols:[['bestRound','Best Round']] }
];

async function renderLeaderboard(){
  const data = await loadLeaderboard();
  const grid = document.getElementById('lb-grid');

  function rankRows(rowsArr, cols){
    return rowsArr.map((r,i)=>{
      const rankClass = i===0?'rank1':(i===1?'rank2':(i===2?'rank3':''));
      const medal = i===0?'🥇':(i===1?'🥈':(i===2?'🥉':''));
      const me = r.name === currentUser ? ' style="color:var(--cyan)"' : '';
      const cells = cols.map(c=>`<td>${r[c]}</td>`).join('');
      return `<tr class="${rankClass}"><td${me}><span class="rank-medal">${medal}</span>${r.name}</td>${cells}</tr>`;
    }).join('');
  }

  function boardRows(board){
    const keys = board.cols.map(c=>c[0]);
    return USERS.map(u=>{
      const rec = (data[u] && data[u][board.game]) || {};
      const row = { name:u };
      keys.forEach(k=>{ row[k] = rec[k] || 0; });
      return row;
    }).sort((a,b)=>{
      for(const k of keys){
        if(b[k] !== a[k]) return b[k] - a[k];
      }
      return 0;
    });
  }

  // Arcade Champion: 3 points for topping a board, 2 for second, 1 for third.
  // Only counts players who actually put a number on the board.
  const points = {};
  USERS.forEach(u=>{ points[u] = { name:u, points:0, golds:0 }; });
  LB_BOARDS.forEach(board=>{
    const rows = boardRows(board);
    const primary = board.cols[0][0];
    rows.slice(0,3).forEach((r,i)=>{
      if(!r[primary]) return;
      points[r.name].points += 3 - i;
      if(i === 0) points[r.name].golds++;
    });
  });
  const championRows = Object.values(points).sort((a,b)=> b.points-a.points || b.golds-a.golds);

  const championCard = `
    <div class="lb-card cabinet-leader" style="grid-column:1/-1;">
      <h3>👑 Arcade Champion <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-dim); letter-spacing:1px;">3/2/1 PTS FOR EACH CABINET'S TOP THREE</span></h3>
      <table>
        <tr><th>Player</th><th>Points</th><th>Cabinets Led</th></tr>
        ${rankRows(championRows, ['points','golds'])}
      </table>
    </div>
  `;

  grid.innerHTML = championCard + LB_BOARDS.map(board=>`
    <div class="lb-card">
      <h3>${board.title}</h3>
      <table>
        <tr><th>Player</th>${board.cols.map(c=>`<th>${c[1]}</th>`).join('')}</tr>
        ${rankRows(boardRows(board), board.cols.map(c=>c[0]))}
      </table>
    </div>
  `).join('');
}

const keys = new Set();
function keyName(e){
  if(e.key === ' ') return 'space';
  return e.key.toLowerCase();
}
const SCROLL_BLOCK_KEYS = ['arrowup','arrowdown','arrowleft','arrowright','space'];

document.addEventListener('keydown', e=>{
  const name = keyName(e);
  // Never let typing in a field (chat, admin panel, login) drive a game.
  const t = e.target;
  if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if(name === 'escape'){
    togglePauseCurrentGame();
    return;
  }
  if(SCROLL_BLOCK_KEYS.includes(name) && currentScreen.endsWith('-screen') && currentScreen !== 'dashboard-screen' && currentScreen !== 'leaderboard-screen' && currentScreen !== 'updatelog-screen' && currentScreen !== 'shop-screen'){
    e.preventDefault();
  }
  keys.add(name);
  if(e.repeat) return;
  const mod = currentGameModule();
  if(mod && mod.onKeyPress) mod.onKeyPress(name);
});
document.addEventListener('keyup', e=>{
  keys.delete(keyName(e));
});

function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
