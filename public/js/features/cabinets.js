/* =========================================================
   CABINET DIRECTORY — the dashboard grid is built from this list
   =========================================================
   Keeping the cabinets as data (rather than hand-written cards) is what makes
   the filter chips, the "surprise me" roll and the personal-best line on each
   card possible without repeating markup 15 times. */
const CABINETS = [
  { id:'soccer', icon:'⚽', name:'Street Soccer', accent:'#2de2c5',
    desc:"1v1 local soccer. First to 5 goals wins. Play a friend or a bot.",
    tags:['versus'], screen:'soccer-screen', mod:()=>SoccerGame,
    stat:'Tracks · Goals / Saves / Wins', best:{game:'soccer', key:'wins', label:'WINS'} },
  { id:'racing', icon:'🏎️', name:'Apex Loop', accent:'#ff3d8a',
    desc:"Top-down 2D racer. 5 laps to win. Hug the inside line to go faster.",
    tags:['versus'], screen:'racing-screen', mod:()=>RacingGame,
    stat:'Tracks · Wins', best:{game:'racing', key:'wins', label:'WINS'} },
  { id:'tank', icon:'🛡️', name:'Tank Duel', accent:'#ffc857',
    desc:"Arena tank combat. First to 3 hits wins. Watch the cover blocks.",
    tags:['versus'], screen:'tank-screen', mod:()=>TankGame,
    stat:'Tracks · Wins', best:{game:'tank', key:'wins', label:'WINS'} },
  { id:'runner', icon:'🏃', name:'Hop Runner', accent:'#8b8bff',
    desc:"Solo endless dodger. Jump the obstacles, chase a high score.",
    tags:['solo'], screen:'runner-screen', mod:()=>RunnerGame,
    stat:'Tracks · High Score', best:{game:'runner', key:'highScore', label:'BEST'} },
  { id:'wildduel', icon:'🤠', name:'Wild Duel', accent:'#ff5b3d',
    desc:"Quick-draw with S, then fight on the platforms. Shoot first and your foe starts hurt.",
    tags:['versus'], screen:'wildduel-screen', mod:()=>WildDuelGame,
    stat:'Tracks · Wins', best:{game:'wildduel', key:'wins', label:'WINS'} },
  { id:'asteroid', icon:'🌠', name:'Asteroid Blaster', accent:'#a0e4ff',
    desc:"Aim your gun left and right and blast incoming asteroids. 3 lives — don't let them through!",
    tags:['solo'], screen:'asteroid-screen', mod:()=>AsteroidGame,
    stat:'Tracks · Asteroids Shot', best:{game:'asteroid', key:'highScore', label:'BEST'} },
  { id:'breaker', icon:'🧱', name:'Neon Breaker', accent:'#f45d9c',
    desc:"Classic brick breaker. Move the paddle, keep the ball alive, clear every board.",
    tags:['solo'], screen:'breaker-screen', mod:()=>BreakerGame,
    stat:'Tracks · High Score', best:{game:'breaker', key:'highScore', label:'BEST'} },
  { id:'roguelike', icon:'⚔️', name:'Crypt Crawler', accent:'#8b6dff',
    desc:"A randomized dungeon every run. Fight with sword and magic, loot each floor, and watch for a boss every 5th floor.",
    tags:['solo'], screen:'roguelike-screen', mod:()=>RoguelikeGame,
    stat:'Tracks · Deepest Floor', best:{game:'roguelike', key:'deepestFloor', label:'FLOOR'} },
  { id:'comet', icon:'☄️', name:'Comet Dodge', accent:'#4cf3ff',
    desc:"Solo survival dodger. Steer clear of the falling comet field and outlast the clock.",
    tags:['solo'], screen:'comet-screen', mod:()=>CometGame,
    stat:'Tracks · High Score', best:{game:'comet', key:'highScore', label:'BEST'} },
  { id:'tunnel', icon:'🌀', name:'Hyper Tunnel', accent:'#a78bff',
    desc:"Roll around a real 3D tunnel, thread the gap in every barrier ring and burn boost for score.",
    tags:['solo','3d','new'], screen:'tunnel-screen', mod:()=>TunnelGame,
    stat:'Tracks · High Score', best:{game:'tunnel', key:'highScore', label:'BEST'} },
  { id:'depths', icon:'👁', name:'Neon Depths', accent:'#ff4d6d',
    desc:"First-person raycast shooter. Hunt through a generated maze, clear the wave, go again.",
    tags:['solo','3d','new'], screen:'depths-screen', mod:()=>DepthsGame,
    stat:'Tracks · Best Wave', best:{game:'depths', key:'bestWave', label:'WAVE'} },
  { id:'stack', icon:'🏗', name:'Sky Stack', accent:'#ffd23f',
    desc:"Stack a tower in 3D. Time each drop — the overhang gets sliced off and the camera climbs with you.",
    tags:['solo','3d','new'], screen:'stack-screen', mod:()=>StackGame,
    stat:'Tracks · Best Height', best:{game:'stack', key:'bestHeight', label:'HEIGHT'} },
  { id:'golf', icon:'🪐', name:'Gravity Golf', accent:'#7dd3ff',
    desc:"Orbital mini-golf. Slingshot your ball around planets and repulsors into the wormhole.",
    tags:['solo','new'], screen:'golf-screen', mod:()=>GolfGame,
    stat:'Tracks · Holes Sunk', best:{game:'golf', key:'bestHoles', label:'HOLES'} },
  { id:'sumo', icon:'🥏', name:'Neon Sumo', accent:'#45ffb0',
    desc:"Shove your rival off a shrinking disc. Dash costs stamina. First to 3 ring-outs wins.",
    tags:['versus','new'], screen:'sumo-screen', mod:()=>SumoGame,
    stat:'Tracks · Wins', best:{game:'sumo', key:'wins', label:'WINS'} },
  { id:'towerdefense', icon:'🏰', name:'Tower Defense', accent:'#ffb347',
    desc:"Build turrets along the winding path, upgrade them, and hold the line through endless waves.",
    tags:['solo','new'], screen:'towerdefense-screen', mod:()=>TowerDefenseGame,
    stat:'Tracks · Best Wave', best:{game:'towerdefense', key:'bestWave', label:'WAVE'} },
  { id:'parkour', icon:'🥷', name:'Ninja Parkour', accent:'#5be3ff',
    desc:"Wall-jump, grapple, and sprint through a time trial course before the clock runs out.",
    tags:['solo','new'], screen:'parkour-screen', mod:()=>ParkourGame,
    stat:'Tracks · Best Score', best:{game:'parkour', key:'bestTime', label:'SCORE'} },
  { id:'zombie', icon:'🧟', name:'Zombie Survival', accent:'#8fff6b',
    desc:"Endless waves of zombies across 3 maps. Spend scrap on weapons between rounds — bosses hit every 10th wave.",
    tags:['solo','new'], screen:'zombie-screen', mod:()=>ZombieGame,
    stat:'Tracks · Best Wave', best:{game:'zombie', key:'bestWave', label:'WAVE'} },
  { id:'pirate', icon:'🏴‍☠️', name:'Pirate Adventure', accent:'#ffd23f',
    desc:"Sail between islands, duel skeleton crews, dig up treasure, and upgrade your ship in port.",
    tags:['solo','new'], screen:'pirate-screen', mod:()=>PirateGame,
    stat:'Tracks · Best Treasure', best:{game:'pirate', key:'bestTreasure', label:'GOLD'} },
  { id:'samurai', icon:'🗡️', name:'Samurai Showdown', accent:'#ff4d4d',
    desc:"Fast, one-hit duels. Strike, deflect, and win a best-of-5 tournament against faster and faster rivals.",
    tags:['versus','new'], screen:'samurai-screen', mod:()=>SamuraiGame,
    stat:'Tracks · Wins', best:{game:'samurai', key:'wins', label:'WINS'} },
  { id:'policechase', icon:'🚓', name:'Police Chase', accent:'#4dd2ff',
    desc:"Weave through city traffic, grab cash, and outrun a rising wanted level as more cruisers join in.",
    tags:['solo','new'], screen:'policechase-screen', mod:()=>PoliceChaseGame,
    stat:'Tracks · High Score', best:{game:'policechase', key:'highScore', label:'BEST'} },
  { id:'tactics', icon:'♟️', name:'Tactics Grid', accent:'#c084fc',
    desc:"Turn-based squad combat on a 6x6 grid. Position matters — flank, focus fire, and wipe out the enemy squad.",
    tags:['versus','strategy','new'], screen:'tactics-screen', mod:()=>TacticsGame,
    stat:'Tracks · Wins', best:{game:'tactics', key:'wins', label:'WINS'} },
  { id:'runeduel', icon:'🔮', name:'Rune Duel', accent:'#8f6bff',
    desc:"Card-battler strategy. Manage mana, summon creatures, and race your rival's life total to zero.",
    tags:['versus','strategy','new'], screen:'runeduel-screen', mod:()=>RuneDuelGame,
    stat:'Tracks · Wins', best:{game:'runeduel', key:'wins', label:'WINS'} },
  { id:'warlord', icon:'🗺️', name:'Warlord', accent:'#ffb347',
    desc:"Risk-style territory conquest. Reinforce, attack adjacent lands, and take the whole map from the AI.",
    tags:['versus','strategy','new'], screen:'warlord-screen', mod:()=>WarlordGame,
    stat:'Tracks · Wins', best:{game:'warlord', key:'wins', label:'WINS'} },
  { id:'evolution', icon:'🧬', name:'Evolution', accent:'#45ffb0',
    desc:"Start as a cell and eat your way up seven stages. Every evolution offers a new trait — pick well, you keep them all run.",
    tags:['solo','new'], screen:'evolution-screen', mod:()=>EvolutionGame,
    stat:'Tracks · Best Stage', best:{game:'evolution', key:'bestStage', label:'STAGE'} },
  { id:'flood', icon:'🌊', name:'Flood Escape', accent:'#4cb8ff',
    desc:"The water never stops rising. Hit every switch to unlock the exit, then climb out before you're under.",
    tags:['solo','new'], screen:'flood-screen', mod:()=>FloodGame,
    stat:'Tracks · Rooms Escaped', best:{game:'flood', key:'bestRooms', label:'ROOMS'} },
  { id:'hoops', icon:'🏀', name:'Buzzer Beater', accent:'#ff8a3d',
    desc:"Ninety seconds on the clock and a hoop that starts drifting once you get good. Chain baskets for a rising multiplier.",
    tags:['solo','new'], screen:'hoops-screen', mod:()=>HoopsGame,
    stat:'Tracks · High Score', best:{game:'hoops', key:'highScore', label:'BEST'} },
  { id:'burger', icon:'🍔', name:'Burger Rush', accent:'#ffc857',
    desc:"Orders stack up with a patience timer. Build each one bottom-up, serve it in time, and don't let three walk out.",
    tags:['solo','new'], screen:'burger-screen', mod:()=>BurgerGame,
    stat:'Tracks · Orders Served', best:{game:'burger', key:'highScore', label:'SERVED'} },
  { id:'tag', icon:'🏃', name:'Neon Tag', accent:'#ff3d8a',
    desc:"Two runners, one tag. Whoever spends the least time as 'it' takes the round — with a dash on cooldown to break away.",
    tags:['versus','new'], screen:'tag-screen', mod:()=>TagGame,
    stat:'Tracks · Wins', best:{game:'tag', key:'wins', label:'WINS'} },
  { id:'robot', icon:'🤖', name:'Robot Arena', accent:'#7dd3ff',
    desc:"Build a bot from a chassis, a weapon and a core, then fight escalating opponents. Rebuild between rounds.",
    tags:['solo','new'], screen:'robot-screen', mod:()=>RobotGame,
    stat:'Tracks · Best Round', best:{game:'robot', key:'bestRound', label:'ROUND'} },
  { id:'builder', icon:'🛠', name:'Arcade Builder', accent:'#c084fc',
    desc:"Design a simple custom game from a template and share it with the community.",
    tags:[], screen:'builder-screen',
    stat:'Player-made games', onOpen:()=>openBuilder() },
  { id:'party', icon:'👥', name:'Party Mode', accent:'#ff3d8a',
    desc:"Create a room, invite friends, everyone plays the same random game. Highest score wins.",
    tags:[], screen:'party-screen',
    stat:'Multiplayer rooms', onOpen:()=>openPartyLobby() },
  { id:'leaderboard', icon:'🏆', name:'Leaderboard', accent:'#ffc857',
    desc:"See how all 9 keyholders stack up across every cabinet.",
    tags:[], screen:'leaderboard-screen', leader:true,
    stat:'Bragging rights live here', onOpen:()=>renderLeaderboard() },
  { id:'updatelog', icon:'📜', name:'Update Log', accent:'#9b8bff',
    desc:"What's new at Level 7.",
    tags:[], screen:'updatelog-screen',
    stat:'Patch notes', onOpen:()=>loadAndRenderUpdateLog() }
];

const TAG_LABELS = { solo:'Solo', versus:'1v1', '3d':'3D', 'new':'New', strategy:'Strategy' };
let cabinetFilter = 'all';

function launchCabinet(id){
  const cab = CABINETS.find(c=>c.id === id);
  if(!cab) return;
  // Info-only cabinets (Leaderboard, Update Log) aren't games — skip the
  // detail page and open them directly like before.
  if(!cab.mod){
    Sfx.play('select');
    stopAllGames();
    showScreen(cab.screen);
    if(cab.onOpen) cab.onOpen();
    return;
  }
  openGameDetail(id);
}

function actuallyLaunchCabinet(id){
  const cab = CABINETS.find(c=>c.id === id);
  if(!cab) return;
  Sfx.play('select');
  stopAllGames();
  showScreen(cab.screen);
  if(typeof Prefs !== 'undefined' && cab.mod){
    Prefs.noteRecent(id);
    lastPlayedCabinet = id;
    applyRememberedChoices(cab.screen);
    if(typeof snapshotRun === 'function') snapshotRun(id);
    if(typeof playStartAnimation === 'function') playStartAnimation(cab.name);
  }
  if(cab.mod){
    const game = cab.mod();
    if(typeof game.reset === 'function') game.reset();
    if(typeof game.start === 'function') game.start();
  }
  if(cab.onOpen) cab.onOpen();
}


/* =========================================================
   GAME DETAIL SCREEN — shown when a cabinet is clicked, before
   the game actually launches. Everything here is derived from
   data already loaded client-side (lbCache, wallet, achievements
   catalog) — no extra network calls needed.
   ========================================================= */
function gdRankedUsers(cab){
  if(!cab.best || !lbCache) return [];
  const key = cab.best.key, game = cab.best.game;
  return USERS
    .map(u => ({ user: u, value: (lbCache[u] && lbCache[u][game] && lbCache[u][game][key]) || 0 }))
    .sort((a,b) => b.value - a.value);
}

async function openGameDetail(id){
  const cab = CABINETS.find(c=>c.id === id);
  if(!cab) return;
  await loadLeaderboard();
  if(!achievementsCatalog) await loadAchievementsCatalog();

  document.getElementById('gd-icon').textContent = cab.icon;
  document.getElementById('gd-name').textContent = cab.name.toUpperCase();
  document.getElementById('gd-desc').textContent = cab.desc;
  document.getElementById('gd-tags').innerHTML = cab.tags.map(t=>`<span class="cab-tag cab-tag-${t}">${TAG_LABELS[t]||t}</span>`).join('');
  document.getElementById('gd-play-btn').onclick = () => actuallyLaunchCabinet(id);

  const ranked = gdRankedUsers(cab);
  const myRankIdx = ranked.findIndex(r => r.user === currentUser);
  const myValue = myRankIdx >= 0 ? ranked[myRankIdx].value : 0;

  document.getElementById('gd-best-label').textContent = cab.best ? `YOUR BEST · ${cab.best.label}` : 'YOUR BEST';
  document.getElementById('gd-best-value').textContent = cab.best ? (myValue || '—') : '—';
  document.getElementById('gd-rank-value').textContent = (myValue > 0 && myRankIdx >= 0) ? `#${myRankIdx+1} / ${USERS.length}` : 'Unranked';
  document.getElementById('gd-record-value').textContent = ranked.length && ranked[0].value ? `${ranked[0].value} — ${ranked[0].user}` : '—';

  const unlockedCount = (wallet.achievements || []).length;
  const totalCount = achievementsCatalog ? Object.keys(achievementsCatalog).length : 0;
  document.getElementById('gd-achievements-value').textContent = `${unlockedCount} / ${totalCount}`;
  document.getElementById('gd-mastery-value').textContent = `Level ${wallet.level || 1}`;

  const friends = (wallet.friends || []).filter(f => USERS.includes(f));
  if(friends.length){
    const friendGroup = ranked.filter(r => friends.includes(r.user) || r.user === currentUser);
    const topFriendEntry = friendGroup.find(r => r.user !== currentUser);
    if(topFriendEntry){
      const rankInGroup = friendGroup.findIndex(r => r.user === topFriendEntry.user) + 1;
      document.getElementById('gd-friends-value').textContent = `${topFriendEntry.user} — #${rankInGroup}`;
    } else {
      document.getElementById('gd-friends-value').textContent = 'No scores yet';
    }
  } else {
    document.getElementById('gd-friends-value').textContent = 'Add friends →';
  }

  const table = document.getElementById('gd-records-table');
  const top5 = ranked.slice(0,5).filter(r => r.value > 0);
  const label = cab.best ? cab.best.label : 'SCORE';
  table.innerHTML = top5.length
    ? `<tr><th>Player</th><th>${label}</th></tr>` + top5.map((r,i)=>{
        const medal = i===0?'🥇':(i===1?'🥈':(i===2?'🥉':''));
        const me = r.user === currentUser ? ' style="color:var(--cyan)"' : '';
        return `<tr><td${me}><span class="rank-medal">${medal}</span>${r.user}</td><td>${r.value}</td></tr>`;
      }).join('')
    : `<tr><td style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim); text-align:center; padding:14px 0;">No scores yet — be the first!</td></tr>`;

  showScreen('gamedetail-screen');
}

function cabinetBestText(cab){
  if(!cab.best || !currentUser) return '';
  const rec = lbCache && lbCache[currentUser] && lbCache[currentUser][cab.best.game];
  const val = rec ? rec[cab.best.key] : 0;
  if(!val) return '';
  return `★ YOUR ${cab.best.label} · ${val}`;
}

function renderCabinets(){
  const grid = document.getElementById('cabinet-grid');
  if(!grid) return;

  const layout = (typeof Prefs !== 'undefined' && Prefs.get('layout')) || 'grid';
  grid.className = 'cabinet-grid' + (layout === 'grid' ? '' : ' layout-' + layout);

  const query = (typeof cabinetSearch !== 'undefined' ? cabinetSearch : '');
  const recents = (typeof Prefs !== 'undefined' ? Prefs.get('recents') : []) || [];

  let visible = CABINETS.filter(c=>{
    if(cabinetFilter !== 'all' && !c.tags.includes(cabinetFilter)) return false;
    if(!query) return true;
    // Search across name, blurb and tags so "racing" finds Apex Loop.
    const extra = (typeof CABINET_KEYWORDS !== 'undefined' && CABINET_KEYWORDS[c.id]) || '';
    const hay = (c.name + ' ' + c.desc + ' ' + c.tags.join(' ') + ' ' + (c.stat||'') + ' ' + extra).toLowerCase();
    return hay.includes(query);
  });

  // Favourites float to the top; everything else keeps catalogue order.
  if(typeof Prefs !== 'undefined'){
    visible = visible.slice().sort((a,b)=>{
      const fa = Prefs.isFavourite(a.id) ? 0 : 1;
      const fb = Prefs.isFavourite(b.id) ? 0 : 1;
      return fa - fb;
    });
  }

  if(!visible.length){
    grid.innerHTML = `<div class="dash-empty">No cabinets match “${escapeHtml(query)}”.</div>`;
    return;
  }

  grid.innerHTML = visible.map(cab=>{
    const tags = cab.tags.map(t=>`<span class="cab-tag cab-tag-${t}">${TAG_LABELS[t]||t}</span>`).join('');
    const fav = typeof Prefs !== 'undefined' && Prefs.isFavourite(cab.id);
    const recentIdx = recents.indexOf(cab.id);
    return `
      <div class="cabinet ${cab.leader?'cabinet-leader':''}" style="--accent-c:${cab.accent}" onclick="launchCabinet('${cab.id}')">
        <button class="fav-star ${fav?'on':''}" title="${fav?'Unpin':'Pin to top'}"
                onclick="toggleCabinetFavourite('${cab.id}', event)">${fav?'★':'☆'}</button>
        ${fav ? '<div class="cabinet-pin">Pinned</div>' : ''}
        <div class="cabinet-icon">${cab.icon}</div>
        <div class="cabinet-name">${cab.name}</div>
        ${tags ? `<div class="cabinet-tags">${tags}</div>` : ''}
        <div class="cabinet-desc">${cab.desc}</div>
        <div class="cabinet-stat">${cab.stat}</div>
        <div class="cabinet-best">${cabinetBestText(cab)}</div>
        ${recentIdx >= 0 ? `<div class="cabinet-recent-badge">🕒 ${recentIdx === 0 ? 'Last played' : '#' + (recentIdx+1) + ' recent'}</div>` : ''}
      </div>
    `;
  }).join('');
}

function setCabinetFilter(filter){
  cabinetFilter = filter;
  document.querySelectorAll('#dash-toolbar .filter-chip').forEach(chip=>{
    chip.classList.toggle('active', chip.dataset.filter === filter);
  });
  renderCabinets();
}

function surpriseMe(){
  const playable = CABINETS.filter(c=>c.mod);
  const pick = playable[Math.floor(Math.random()*playable.length)];
  Sfx.play('whoosh');
  launchCabinet(pick.id);
}

// Pulls fresh standings, then repaints the grid so the "your best" line on
// each card reflects the run you just finished.
async function refreshCabinets(){
  await loadLeaderboard();
  renderCabinets();
}
