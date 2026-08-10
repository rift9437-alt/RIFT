/* =========================================================
   GAME: PIRATE ADVENTURE
   ========================================================= */
const PirateGame = (function(){
  const canvas = document.getElementById('pirate-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const ISLANDS = [
    {id:0,x:80,y:380,name:'Home Port',home:true},
    {id:1,x:220,y:300,name:'Gull Cay'},
    {id:2,x:200,y:150,name:'Skull Rock'},
    {id:3,x:380,y:220,name:'Reef Isle'},
    {id:4,x:520,y:120,name:'Storm Point'},
    {id:5,x:560,y:300,name:'Bone Atoll'},
    {id:6,x:420,y:400,name:'Coral Key'},
    {id:7,x:640,y:400,name:"Kraken's Rest"}
  ];
  const EDGES = [[0,1],[1,2],[1,3],[2,3],[3,4],[3,6],[4,5],[5,6],[5,7],[6,7]];

  let rafId=null, running=false, paused=false;
  let currentIsland, treasureScore, hull, maxHull, cannons, sailing, sailFrom, sailTo, sailT, visited, state, fight, purchases;

  function neighbors(id){
    return EDGES.filter(e => e.includes(id)).map(e => e[0]===id?e[1]:e[0]);
  }

  function freshState(){
    currentIsland = 0;
    treasureScore = 0;
    maxHull = 100; hull = maxHull;
    cannons = 0;
    sailing = false;
    visited = new Set([0]);
    purchases = { hull:0, cannons:0 };
    state = 'map';
    updateHud();
  }

  function updateHud(){
    document.getElementById('pirate-treasure-hud').textContent = treasureScore;
    document.getElementById('pirate-hull-hud').textContent = '⛵ ' + Math.max(0,Math.round(hull));
  }

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX-rect.left)*(W/rect.width), y: (e.clientY-rect.top)*(H/rect.height) };
  }
  canvas.addEventListener('pointerdown', e=>{
    if(!running || paused || state !== 'map' || sailing) return;
    const p = canvasPos(e);
    const target = ISLANDS.find(is => Math.hypot(is.x-p.x, is.y-p.y) < 22);
    if(!target) return;
    if(!neighbors(currentIsland).includes(target.id)) return;
    sailFrom = ISLANDS[currentIsland];
    sailTo = target;
    sailT = 0;
    sailing = true;
  });

  function arrive(){
    sailing = false;
    currentIsland = sailTo.id;
    const island = ISLANDS[currentIsland];
    if(island.home){
      openPort();
      return;
    }
    visited.add(currentIsland);
    const roll = Math.random();
    if(roll < 0.42){
      startFight();
    } else if(roll < 0.82){
      const tier = 1 + Math.round(Math.hypot(island.x-80, island.y-380) / 140);
      const amount = Math.round((10 + Math.random()*20) * tier);
      treasureScore += amount;
      earnTokens('pirate_treasure', 1);
      updateHud();
      document.getElementById('pirate-result-text').textContent = 'TREASURE!';
      document.getElementById('pirate-result-sub').textContent = `You dug up ${amount} gold at ${island.name}.`;
      document.getElementById('pirate-result').classList.remove('hidden');
      setTimeout(()=>{ document.getElementById('pirate-result').classList.add('hidden'); }, 1400);
    }
  }

  function startFight(){
    state = 'fight';
    const tier = 1 + Math.round(Math.hypot(ISLANDS[currentIsland].x-80, ISLANDS[currentIsland].y-380) / 140);
    fight = { hp: 12 + tier*6, maxHp: 12 + tier*6, tier };
    document.getElementById('pirate-fight-sub').textContent = `Skeleton crew (HP ${fight.hp}) blocks the way!`;
    document.getElementById('pirate-fight').classList.remove('hidden');
  }

  function fightAction(action){
    if(state !== 'fight') return;
    if(action === 'attack'){
      const dmg = 4 + Math.floor(Math.random()*5);
      fight.hp -= dmg;
      if(fight.hp <= 0){
        const reward = 8 + fight.tier*4;
        treasureScore += reward;
        earnTokens('pirate_skeleton', 1);
        document.getElementById('pirate-fight').classList.add('hidden');
        state = 'map';
        updateHud();
        return;
      }
      const dmgTaken = (3 + Math.floor(Math.random()*5)) * (1 - cannons*0.12);
      hull -= dmgTaken;
    } else {
      const dmgTaken = (3 + Math.floor(Math.random()*5)) * 0.4 * (1 - cannons*0.12);
      hull -= dmgTaken;
    }
    document.getElementById('pirate-fight-sub').textContent = `Skeleton crew (HP ${Math.max(0,fight.hp)}) — your hull: ${Math.max(0,Math.round(hull))}`;
    updateHud();
    if(hull <= 0){
      document.getElementById('pirate-fight').classList.add('hidden');
      gameOver();
    }
  }

  function PORT_OPTIONS(){
    return [
      { label:`Reinforced Hull +25 Max (💰${20+purchases.hull*15})`, cost: 20+purchases.hull*15,
        apply: ()=>{ maxHull += 25; hull = maxHull; purchases.hull++; } },
      { label:`Bigger Cannons -12% dmg taken (💰${25+purchases.cannons*20})`, cost: 25+purchases.cannons*20,
        apply: ()=>{ cannons = Math.min(4, cannons+1); purchases.cannons++; } }
    ];
  }

  function openPort(){
    state = 'port';
    hull = Math.min(maxHull, hull + 20);
    document.getElementById('pirate-port-sub').textContent = `Back home. Treasure: 💰 ${treasureScore} · Hull ${Math.round(hull)}/${maxHull}`;
    const opts = document.getElementById('pirate-port-options');
    opts.innerHTML = '';
    PORT_OPTIONS().forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = o.label;
      btn.disabled = treasureScore < o.cost;
      btn.onclick = () => {
        if(treasureScore < o.cost) return;
        treasureScore -= o.cost;
        o.apply();
        openPort();
        updateHud();
      };
      opts.appendChild(btn);
    });
    document.getElementById('pirate-port').classList.remove('hidden');
    updateHud();
  }
  function leavePort(){
    document.getElementById('pirate-port').classList.add('hidden');
    state = 'map';
  }

  function gameOver(){
    running = false;
    updateStat('pirate', [{stat:'bestTreasure', type:'max', value:treasureScore}]);
    zipReactToScore('pirate', 'bestTreasure', treasureScore);
    document.getElementById('pirate-result-text').textContent = 'SHIP SUNK';
    document.getElementById('pirate-result-sub').textContent = `Your voyage ended with ${treasureScore} gold banked.`;
    document.getElementById('pirate-play').classList.add('hidden');
    document.getElementById('pirate-result').classList.remove('hidden');
  }

  function update(){
    if(sailing){
      sailT += 0.02 + cannons*0.003;
      if(sailT >= 1) arrive();
    }
  }

  function render(){
    ctx.fillStyle = '#03121c';
    ctx.fillRect(0,0,W,H);

    ctx.strokeStyle = 'rgba(125,211,255,0.25)';
    ctx.lineWidth = 2;
    EDGES.forEach(([a,b]) => {
      ctx.beginPath();
      ctx.moveTo(ISLANDS[a].x, ISLANDS[a].y);
      ctx.lineTo(ISLANDS[b].x, ISLANDS[b].y);
      ctx.stroke();
    });

    ISLANDS.forEach(is => {
      ctx.fillStyle = is.home ? '#ffd23f' : (visited.has(is.id) ? '#6b8cff' : '#2fd9c4');
      ctx.beginPath();
      ctx.arc(is.x,is.y,is.home?16:12,0,Math.PI*2);
      ctx.fill();
      ctx.fillStyle = 'rgba(232,236,241,0.75)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(is.name, is.x, is.y+26);
    });

    let shipX, shipY;
    if(sailing){
      shipX = sailFrom.x + (sailTo.x-sailFrom.x)*sailT;
      shipY = sailFrom.y + (sailTo.y-sailFrom.y)*sailT;
    } else {
      shipX = ISLANDS[currentIsland].x;
      shipY = ISLANDS[currentIsland].y - 20;
    }
    ctx.fillStyle = '#ffe6b0';
    ctx.shadowColor = '#ffe6b0';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(shipX, shipY-10);
    ctx.lineTo(shipX-9, shipY+8);
    ctx.lineTo(shipX+9, shipY+8);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    ctx.fillText(sailing ? 'Sailing…' : 'Click a connected island to sail there.', 14, H-12);
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('pirate-setup').classList.add('hidden');
    document.getElementById('pirate-result').classList.add('hidden');
    document.getElementById('pirate-fight').classList.add('hidden');
    document.getElementById('pirate-port').classList.add('hidden');
    document.getElementById('pirate-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }
  function stop(){ running=false; paused=false; sailing=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false; sailing = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('pirate-setup').classList.remove('hidden');
    document.getElementById('pirate-play').classList.add('hidden');
    document.getElementById('pirate-fight').classList.add('hidden');
    document.getElementById('pirate-port').classList.add('hidden');
    document.getElementById('pirate-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, pause, resume, isPaused, isRunning, fightAction, leavePort};
})();
