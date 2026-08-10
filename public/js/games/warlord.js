/* =========================================================
   GAME: WARLORD
   ========================================================= */
const WarlordGame = (function(){
  const canvas = document.getElementById('warlord-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const TERRITORY_DEF = [
    {id:0,x:100,y:120,name:'Norwyn'},
    {id:1,x:100,y:300,name:'Vaelport'},
    {id:2,x:230,y:200,name:'Ashford'},
    {id:3,x:230,y:400,name:'Duskmere'},
    {id:4,x:470,y:120,name:'Redgate'},
    {id:5,x:470,y:300,name:'Ironhold'},
    {id:6,x:600,y:200,name:'Blackpeak'},
    {id:7,x:600,y:400,name:"Grimspire"}
  ];
  const EDGES = [[0,1],[0,2],[1,3],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];

  let rafId=null, running=false, paused=false;
  let territories, phase, reinforceLeft, selectedSrc, conquestCount;

  function neighbors(id){ return EDGES.filter(e=>e.includes(id)).map(e=>e[0]===id?e[1]:e[0]); }

  function freshState(){
    territories = TERRITORY_DEF.map(t => ({...t,
      owner: t.id <= 3 ? 'p' : 'e',
      armies: 3
    }));
    conquestCount = 0;
    startReinforcePhase('p');
  }

  function ownedBy(owner){ return territories.filter(t=>t.owner===owner); }

  function startReinforcePhase(owner){
    phase = owner === 'p' ? 'reinforce' : 'ai';
    selectedSrc = null;
    if(owner === 'p'){
      reinforceLeft = Math.max(3, Math.floor(ownedBy('p').length/2));
      updateHud();
      render();
    } else {
      setTimeout(aiTurn, 500);
    }
  }

  function updateHud(){
    const p = ownedBy('p').length, e = ownedBy('e').length;
    document.getElementById('warlord-territory-hud').textContent = `${p} : ${e}`;
    if(phase === 'reinforce') document.getElementById('warlord-phase-hud').textContent = `REINFORCE · ${reinforceLeft} LEFT`;
    else if(phase === 'attack') document.getElementById('warlord-phase-hud').textContent = 'ATTACK PHASE';
    else document.getElementById('warlord-phase-hud').textContent = "ENEMY TURN";
  }

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return { x:(e.clientX-rect.left)*(W/rect.width), y:(e.clientY-rect.top)*(H/rect.height) };
  }
  function territoryAt(p){ return territories.find(t => Math.hypot(t.x-p.x, t.y-p.y) < 26); }

  canvas.addEventListener('pointerdown', e=>{
    if(!running || paused) return;
    const p = canvasPos(e);
    const t = territoryAt(p);
    if(!t) return;

    if(phase === 'reinforce'){
      if(t.owner !== 'p' || reinforceLeft <= 0) return;
      t.armies++;
      reinforceLeft--;
      updateHud();
      render();
      return;
    }
    if(phase === 'attack'){
      if(selectedSrc === null){
        if(t.owner === 'p' && t.armies > 1) selectedSrc = t.id;
        render();
        return;
      }
      const src = territories.find(x=>x.id===selectedSrc);
      if(t.id === src.id){ selectedSrc = null; render(); return; }
      if(t.owner === 'p'){
        if(t.armies > 1) selectedSrc = t.id;
        render();
        return;
      }
      if(!neighbors(src.id).includes(t.id)){ return; }
      resolveCombat(src, t, 'p');
      selectedSrc = null;
      updateHud();
      render();
      checkWin();
    }
  });

  function resolveCombat(attacker, defender, attackerOwner){
    const attackPower = (attacker.armies-1) * (0.7+Math.random()*0.6);
    const defensePower = defender.armies * (0.7+Math.random()*0.6);
    if(attackPower > defensePower){
      const moveIn = Math.max(1, Math.round((attacker.armies-1) - defender.armies*0.4));
      const wasPlayerVictory = attackerOwner === 'p';
      defender.owner = attackerOwner;
      defender.armies = moveIn;
      attacker.armies = 1;
      if(wasPlayerVictory){ conquestCount++; earnTokens('warlord_territory', 1); }
    } else {
      const loss = Math.max(1, Math.round((attacker.armies-1)*0.4));
      attacker.armies = Math.max(1, attacker.armies-loss);
      const defLoss = Math.max(1, Math.round(defender.armies*0.25));
      defender.armies = Math.max(1, defender.armies-defLoss);
    }
  }

  function endPhase(){
    if(!running) return;
    if(phase === 'reinforce'){
      if(reinforceLeft > 0){
        const mine = ownedBy('p').sort((a,b)=>b.armies-a.armies)[0];
        if(mine) mine.armies += reinforceLeft;
        reinforceLeft = 0;
      }
      phase = 'attack';
      updateHud();
      render();
      return;
    }
    if(phase === 'attack'){
      selectedSrc = null;
      startReinforcePhase('e');
    }
  }

  function aiTurn(){
    if(!running) return;
    const mine = ownedBy('e');
    const reinforce = Math.max(3, Math.floor(mine.length/2));
    if(mine.length){
      let best = mine[0], bestScore = -1;
      mine.forEach(t => {
        const threat = neighbors(t.id).filter(nid => territories.find(x=>x.id===nid).owner==='p').length;
        if(threat > bestScore){ bestScore = threat; best = t; }
      });
      best.armies += reinforce;
    }
    ownedBy('e').forEach(t => {
      if(t.armies <= 3) return;
      const targets = neighbors(t.id).map(nid=>territories.find(x=>x.id===nid)).filter(nb => nb.owner==='p');
      targets.forEach(target => {
        if(t.armies > 3 && t.armies-1 > target.armies*0.9){
          resolveCombat(t, target, 'e');
        }
      });
    });
    render();
    if(checkWin()) return;
    startReinforcePhase('p');
  }

  function checkWin(){
    const pCount = ownedBy('p').length, eCount = ownedBy('e').length;
    if(eCount === 0){ gameOver(true); return true; }
    if(pCount === 0){ gameOver(false); return true; }
    return false;
  }

  function gameOver(won){
    running = false;
    updateStat('warlord', [{stat: won ? 'wins' : 'losses', type:'increment', value:1}]);
    zipReactToScore('warlord', 'wins', conquestCount);
    earnTokens(won ? 'warlord_win' : 'warlord_loss', 1);
    document.getElementById('warlord-result-text').textContent = won ? 'MAP CONQUERED' : 'ELIMINATED';
    document.getElementById('warlord-result-sub').textContent = won
      ? `You took the whole map, conquering ${conquestCount} enemy territories along the way.`
      : 'The enemy overran your last territory.';
    document.getElementById('warlord-play').classList.add('hidden');
    document.getElementById('warlord-result').classList.remove('hidden');
  }

  function render(){
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0,0,W,H);

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    EDGES.forEach(([a,b]) => {
      const ta = territories.find(t=>t.id===a), tb = territories.find(t=>t.id===b);
      ctx.beginPath();
      ctx.moveTo(ta.x,ta.y);
      ctx.lineTo(tb.x,tb.y);
      ctx.stroke();
    });

    territories.forEach(t => {
      ctx.fillStyle = t.owner==='p' ? '#6b8cff' : '#ff5454';
      if(t.id === selectedSrc){ ctx.shadowColor='#fff'; ctx.shadowBlur=16; }
      ctx.beginPath();
      ctx.arc(t.x,t.y,24,0,Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.armies, t.x, t.y+5);
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(232,236,241,0.65)';
      ctx.fillText(t.name, t.x, t.y+40);
    });

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    ctx.font = '11px "JetBrains Mono", monospace';
    if(phase==='reinforce') ctx.fillText('Click your territories to place reinforcements.', 14, H-12);
    else if(phase==='attack') ctx.fillText(selectedSrc===null ? 'Click a territory with 2+ armies to attack from.' : 'Click an adjacent enemy territory to attack it.', 14, H-12);
  }

  function loop(){
    if(!running) return;
    if(!paused) {} // turn-based; no continuous update needed
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('warlord-setup').classList.add('hidden');
    document.getElementById('warlord-result').classList.add('hidden');
    document.getElementById('warlord-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('warlord-setup').classList.remove('hidden');
    document.getElementById('warlord-play').classList.add('hidden');
    document.getElementById('warlord-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, pause, resume, isPaused, isRunning, endPhase};
})();
