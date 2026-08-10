/* =========================================================
   GAME: TACTICS GRID
   ========================================================= */
const TacticsGame = (function(){
  const canvas = document.getElementById('tactics-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const COLS = 6, ROWS = 6, CELL = W/COLS;

  let rafId=null, running=false, paused=false;
  let units, turn, selected, reachable, kills;

  function freshState(){
    units = [
      {gx:0,gy:1,hp:10,maxHp:10,atk:4,team:'p',moved:false,attacked:false,alive:true},
      {gx:0,gy:3,hp:10,maxHp:10,atk:4,team:'p',moved:false,attacked:false,alive:true},
      {gx:1,gy:2,hp:8,maxHp:8,atk:5,team:'p',moved:false,attacked:false,alive:true},
      {gx:5,gy:1,hp:10,maxHp:10,atk:4,team:'e',moved:false,attacked:false,alive:true},
      {gx:5,gy:3,hp:10,maxHp:10,atk:4,team:'e',moved:false,attacked:false,alive:true},
      {gx:4,gy:2,hp:8,maxHp:8,atk:5,team:'e',moved:false,attacked:false,alive:true}
    ];
    turn = 'p';
    selected = null;
    reachable = [];
    kills = 0;
    updateHud();
  }

  function updateHud(){
    const pAlive = units.filter(u=>u.team==='p'&&u.alive).length;
    const eAlive = units.filter(u=>u.team==='e'&&u.alive).length;
    document.getElementById('tactics-turn-hud').textContent = turn==='p' ? 'YOUR TURN' : "ENEMY TURN";
    document.getElementById('tactics-units-hud').textContent = `${pAlive} : ${eAlive}`;
  }

  function unitAt(gx,gy){ return units.find(u=>u.alive && u.gx===gx && u.gy===gy); }
  function dist(a,b){ return Math.abs(a.gx-b.gx)+Math.abs(a.gy-b.gy); }

  function computeReachable(unit){
    const out = [];
    for(let gx=0; gx<COLS; gx++) for(let gy=0; gy<ROWS; gy++){
      const d = Math.abs(gx-unit.gx)+Math.abs(gy-unit.gy);
      if(d>0 && d<=2 && !unitAt(gx,gy)) out.push({gx,gy});
    }
    return out;
  }

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return { x:(e.clientX-rect.left)*(W/rect.width), y:(e.clientY-rect.top)*(H/rect.height) };
  }
  function toGrid(p){ return { gx: Math.floor(p.x/CELL), gy: Math.floor(p.y/CELL) }; }

  canvas.addEventListener('pointerdown', e=>{
    if(!running || paused || turn !== 'p') return;
    const g = toGrid(canvasPos(e));
    const clicked = unitAt(g.gx, g.gy);

    if(selected){
      if(clicked && clicked === selected){ selected=null; reachable=[]; return; }
      if(!selected.moved && reachable.some(r=>r.gx===g.gx && r.gy===g.gy)){
        selected.gx = g.gx; selected.gy = g.gy; selected.moved = true;
        reachable = [];
        if(selected.moved && selected.attacked) selected = null;
        return;
      }
      if(clicked && clicked.team==='e' && !selected.attacked && dist(selected,clicked)<=1){
        resolveAttack(selected, clicked);
        selected.attacked = true;
        if(selected.moved && selected.attacked) selected = null;
        checkWin();
        return;
      }
      if(clicked && clicked.team==='p' && !(clicked.moved&&clicked.attacked)){
        selected = clicked;
        reachable = clicked.moved ? [] : computeReachable(clicked);
        return;
      }
      selected = null; reachable = [];
      return;
    }
    if(clicked && clicked.team==='p' && !(clicked.moved&&clicked.attacked)){
      selected = clicked;
      reachable = clicked.moved ? [] : computeReachable(clicked);
    }
  });

  function resolveAttack(attacker, defender){
    const dmg = Math.max(1, attacker.atk + Math.round((Math.random()-0.5)*3));
    defender.hp -= dmg;
    if(defender.hp <= 0){
      defender.alive = false;
      if(attacker.team==='p'){ kills++; earnTokens('tactics_unit_kill', 1); }
    }
    updateHud();
  }

  function checkWin(){
    const pAlive = units.filter(u=>u.team==='p'&&u.alive).length;
    const eAlive = units.filter(u=>u.team==='e'&&u.alive).length;
    if(eAlive === 0){ gameOver(true); return true; }
    if(pAlive === 0){ gameOver(false); return true; }
    return false;
  }

  function endTurn(){
    if(!running || turn !== 'p') return;
    selected = null; reachable = [];
    turn = 'e';
    updateHud();
    setTimeout(aiTurn, 500);
  }

  function aiTurn(){
    if(!running) return;
    const enemies = units.filter(u=>u.team==='e'&&u.alive);
    let i = 0;
    function step(){
      if(!running) return;
      if(i >= enemies.length){
        units.forEach(u=>{ u.moved=false; u.attacked=false; });
        turn = 'p';
        updateHud();
        return;
      }
      const en = enemies[i]; i++;
      if(!en.alive){ step(); return; }
      const targets = units.filter(u=>u.team==='p'&&u.alive);
      if(targets.length === 0){ step(); return; }
      let closest = targets[0];
      targets.forEach(t=>{ if(dist(en,t) < dist(en,closest)) closest = t; });

      const options = computeReachable(en);
      options.push({gx:en.gx, gy:en.gy});
      options.sort((a,b)=> (Math.abs(a.gx-closest.gx)+Math.abs(a.gy-closest.gy)) - (Math.abs(b.gx-closest.gx)+Math.abs(b.gy-closest.gy)));
      const best = options[0];
      en.gx = best.gx; en.gy = best.gy;

      const adjacentPlayer = targets.find(t => Math.abs(t.gx-en.gx)+Math.abs(t.gy-en.gy) <= 1);
      if(adjacentPlayer) resolveAttack(en, adjacentPlayer);

      render();
      if(checkWin()) return;
      setTimeout(step, 450);
    }
    step();
  }

  function gameOver(won){
    running = false;
    updateStat('tactics', [{stat: won ? 'wins' : 'losses', type:'increment', value:1}]);
    zipReactToScore('tactics', 'wins', kills);
    earnTokens(won ? 'tactics_win' : 'tactics_loss', 1);
    document.getElementById('tactics-result-text').textContent = won ? 'SQUAD VICTORY' : 'SQUAD WIPED';
    document.getElementById('tactics-result-sub').textContent = won ? `You wiped the enemy squad with ${kills} kill${kills===1?'':'s'}.` : 'Your squad was eliminated.';
    document.getElementById('tactics-play').classList.add('hidden');
    document.getElementById('tactics-result').classList.remove('hidden');
  }

  function render(){
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for(let i=0;i<=COLS;i++){ ctx.beginPath(); ctx.moveTo(i*CELL,0); ctx.lineTo(i*CELL,H); ctx.stroke(); }
    for(let i=0;i<=ROWS;i++){ ctx.beginPath(); ctx.moveTo(0,i*CELL); ctx.lineTo(W,i*CELL); ctx.stroke(); }

    reachable.forEach(r => {
      ctx.fillStyle = 'rgba(192,132,252,0.25)';
      ctx.fillRect(r.gx*CELL+3, r.gy*CELL+3, CELL-6, CELL-6);
    });
    if(selected && !selected.attacked){
      units.filter(u=>u.alive && u.team==='e' && dist(u,selected)<=1).forEach(en=>{
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 3;
        ctx.strokeRect(en.gx*CELL+4, en.gy*CELL+4, CELL-8, CELL-8);
      });
    }

    units.filter(u=>u.alive).forEach(u => {
      const cx = u.gx*CELL+CELL/2, cy = u.gy*CELL+CELL/2;
      ctx.fillStyle = u.team==='p' ? '#c084fc' : '#ff4d4d';
      if(u === selected){ ctx.shadowColor = '#fff'; ctx.shadowBlur = 14; }
      ctx.beginPath();
      ctx.arc(cx, cy, CELL*0.32, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1a1102';
      ctx.fillRect(cx-CELL*0.35, cy-CELL*0.42, CELL*0.7, 5);
      ctx.fillStyle = '#4dff8a';
      ctx.fillRect(cx-CELL*0.35, cy-CELL*0.42, CELL*0.7*(u.hp/u.maxHp), 5);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(u.atk, cx, cy+4);
      if(u.moved && u.attacked){ ctx.globalAlpha = 0.4; ctx.fillRect(u.gx*CELL, u.gy*CELL, CELL, CELL); ctx.globalAlpha = 1; }
    });
    ctx.textAlign = 'left';
  }

  function loop(){
    if(!running) return;
    if(!paused) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('tactics-setup').classList.add('hidden');
    document.getElementById('tactics-result').classList.add('hidden');
    document.getElementById('tactics-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('tactics-setup').classList.remove('hidden');
    document.getElementById('tactics-play').classList.add('hidden');
    document.getElementById('tactics-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, pause, resume, isPaused, isRunning, endTurn};
})();
