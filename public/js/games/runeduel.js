/* =========================================================
   GAME: RUNE DUEL
   ========================================================= */
const RuneDuelGame = (function(){
  const canvas = document.getElementById('runeduel-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const CARD_POOL = [
    {type:'creature', name:'Squire', cost:1, atk:1, hp:2},
    {type:'creature', name:'Archer', cost:2, atk:2, hp:2},
    {type:'creature', name:'Knight', cost:3, atk:3, hp:4},
    {type:'creature', name:'Golem', cost:4, atk:4, hp:6},
    {type:'creature', name:'Dragon', cost:6, atk:7, hp:7},
    {type:'spell', name:'Fireball', cost:3, effect:'damage', value:4, desc:'4 dmg to enemy face'},
    {type:'spell', name:'Heal', cost:2, effect:'heal', value:5, desc:'Heal your face 5'},
    {type:'spell', name:'Lightning', cost:1, effect:'damage', value:2, desc:'2 dmg to enemy face'}
  ];
  function randomCard(){ return {...CARD_POOL[Math.floor(Math.random()*CARD_POOL.length)], id: Math.random().toString(36).slice(2)}; }

  let rafId=null, running=false, paused=false;
  let player, ai, hand, selectedAttacker, cardIdSeq;

  function freshState(){
    player = { life:20, mana:1, maxMana:1, board:[] };
    ai = { life:20, mana:1, maxMana:1, board:[] };
    hand = [randomCard(), randomCard(), randomCard()];
    selectedAttacker = null;
    updateHud();
    renderHand();
  }

  function updateHud(){
    document.getElementById('runeduel-mana-hud').textContent = `MANA ${player.mana}/${player.maxMana}`;
    document.getElementById('runeduel-life-hud').textContent = `${player.life} : ${ai.life}`;
  }

  function playCard(card){
    if(player.mana < card.cost) return;
    if(card.type === 'creature'){
      if(player.board.length >= 5) return;
      player.mana -= card.cost;
      player.board.push({ name:card.name, atk:card.atk, hp:card.hp, maxHp:card.hp, ready:false, attacked:false });
    } else {
      player.mana -= card.cost;
      if(card.effect === 'heal') player.life = Math.min(20, player.life + card.value);
      else { ai.life -= card.value; checkWin(); }
    }
    hand = hand.filter(c => c.id !== card.id);
    updateHud();
    renderHand();
    render();
  }

  function renderHand(){
    const box = document.getElementById('runeduel-hand');
    box.innerHTML = '';
    hand.forEach(card => {
      const el = document.createElement('div');
      el.className = 'rune-card' + (player.mana < card.cost ? ' unaffordable' : '');
      el.innerHTML = `
        <div class="rune-cost">${card.cost}</div>
        <div class="rune-name">${card.name}</div>
        <div class="rune-desc">${card.type==='creature' ? 'Creature' : card.desc}</div>
        <div class="rune-stats">${card.type==='creature' ? `⚔${card.atk} ❤${card.hp}` : ''}</div>
      `;
      el.onclick = () => playCard(card);
      box.appendChild(el);
    });
  }

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return { x:(e.clientX-rect.left)*(W/rect.width), y:(e.clientY-rect.top)*(H/rect.height) };
  }

  function boardSlotAt(list, y0, x){
    const slotW = 110;
    const startX = W/2 - (list.length*slotW)/2;
    for(let i=0;i<list.length;i++){
      const sx = startX + i*slotW;
      if(x >= sx && x <= sx+slotW-10) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', e=>{
    if(!running || paused) return;
    const p = canvasPos(e);
    // enemy face zone (top strip)
    if(p.y < 60){
      if(selectedAttacker !== null){
        const atk = player.board[selectedAttacker];
        if(atk && !atk.attacked){
          ai.life -= atk.atk;
          atk.attacked = true;
          selectedAttacker = null;
          updateHud();
          checkWin();
          render();
        }
      }
      return;
    }
    // enemy board row
    const eIdx = boardSlotAt(ai.board, 140, p.x);
    if(p.y > 110 && p.y < 220 && eIdx >= 0){
      if(selectedAttacker !== null){
        const atk = player.board[selectedAttacker];
        const def = ai.board[eIdx];
        if(atk && def && !atk.attacked){
          def.hp -= atk.atk;
          atk.hp -= def.atk;
          atk.attacked = true;
          if(def.hp <= 0){ ai.board.splice(eIdx,1); earnTokens('runeduel_creature_kill', 1); }
          if(atk.hp <= 0) player.board.splice(selectedAttacker,1);
          selectedAttacker = null;
          updateHud();
          checkWin();
          render();
        }
      }
      return;
    }
    // player board row
    const pIdx = boardSlotAt(player.board, 300, p.x);
    if(p.y > 260 && p.y < 370 && pIdx >= 0){
      const c = player.board[pIdx];
      if(c && c.ready && !c.attacked) selectedAttacker = (selectedAttacker===pIdx ? null : pIdx);
      render();
    }
  });

  function checkWin(){
    if(ai.life <= 0){ gameOver(true); return true; }
    if(player.life <= 0){ gameOver(false); return true; }
    return false;
  }

  function endTurn(){
    if(!running) return;
    selectedAttacker = null;
    aiTurn();
    if(checkWin()) return;
    player.maxMana = Math.min(10, player.maxMana+1);
    player.mana = player.maxMana;
    player.board.forEach(c => { c.ready = true; c.attacked = false; });
    if(hand.length < 6) hand.push(randomCard());
    updateHud();
    renderHand();
    render();
  }

  function aiTurn(){
    ai.maxMana = Math.min(10, ai.maxMana+1);
    ai.mana = ai.maxMana;
    ai.board.forEach(c => { c.ready = true; c.attacked = false; });
    let aiHand = [randomCard(), randomCard()];
    aiHand.sort((a,b)=>b.cost-a.cost);
    aiHand.forEach(card => {
      if(ai.mana < card.cost) return;
      if(card.type === 'creature' && ai.board.length < 5){
        ai.mana -= card.cost;
        ai.board.push({ name:card.name, atk:card.atk, hp:card.hp, maxHp:card.hp, ready:false, attacked:false });
      } else if(card.type === 'spell'){
        ai.mana -= card.cost;
        if(card.effect === 'heal') ai.life = Math.min(20, ai.life + card.value);
        else player.life -= card.value;
      }
    });
    ai.board.forEach(c => {
      if(!c.ready || c.attacked) return;
      const target = player.board.find(p => p.atk >= c.hp) || player.board[0];
      if(target){
        target.hp -= c.atk;
        c.hp -= target.atk;
        c.attacked = true;
      } else {
        player.life -= c.atk;
        c.attacked = true;
      }
    });
    player.board = player.board.filter(c => c.hp > 0);
    ai.board = ai.board.filter(c => c.hp > 0);
    updateHud();
  }

  function gameOver(won){
    running = false;
    updateStat('runeduel', [{stat: won ? 'wins' : 'losses', type:'increment', value:1}]);
    zipReactToScore('runeduel', 'wins', player.board.length);
    earnTokens(won ? 'runeduel_win' : 'runeduel_loss', 1);
    document.getElementById('runeduel-result-text').textContent = won ? 'DUEL WON' : 'DUEL LOST';
    document.getElementById('runeduel-result-sub').textContent = won ? `Rival face reduced to 0.` : `Your life hit 0.`;
    document.getElementById('runeduel-play').classList.add('hidden');
    document.getElementById('runeduel-result').classList.remove('hidden');
  }

  function drawBoard(list, y, color, isPlayer){
    const slotW = 110;
    const startX = W/2 - (list.length*slotW)/2;
    list.forEach((c,i) => {
      const x = startX + i*slotW;
      ctx.fillStyle = (isPlayer && i===selectedAttacker) ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x,y,slotW-10,80);
      ctx.strokeStyle = (isPlayer && !c.ready) ? '#555' : color;
      ctx.lineWidth = (isPlayer && i===selectedAttacker) ? 3 : 1.5;
      ctx.strokeRect(x,y,slotW-10,80);
      ctx.fillStyle = '#fff';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(c.name, x+(slotW-10)/2, y+18);
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.fillText(`⚔${c.atk}  ❤${c.hp}`, x+(slotW-10)/2, y+46);
      if(isPlayer && !c.ready){ ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='9px monospace'; ctx.fillText('SLEEPING', x+(slotW-10)/2, y+66); }
      else if(isPlayer && c.attacked){ ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='9px monospace'; ctx.fillText('SPENT', x+(slotW-10)/2, y+66); }
    });
  }

  function render(){
    ctx.fillStyle = '#0a0616';
    ctx.fillRect(0,0,W,H);

    ctx.fillStyle = 'rgba(255,77,77,0.08)';
    ctx.fillRect(0,0,W,60);
    ctx.fillStyle = '#ff4d4d';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`RIVAL ❤ ${Math.max(0,ai.life)}`, 14, 36);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(selectedAttacker!==null ? 'Click here to hit their face' : '', W-14, 36);

    drawBoard(ai.board, 110, '#ff4d4d', false);
    drawBoard(player.board, 300, '#8f6bff', true);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#8f6bff';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.fillText(`YOU ❤ ${Math.max(0,player.life)}`, 14, H-16);
  }

  function loop(){
    if(!running) return;
    if(!paused) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('runeduel-setup').classList.add('hidden');
    document.getElementById('runeduel-result').classList.add('hidden');
    document.getElementById('runeduel-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('runeduel-setup').classList.remove('hidden');
    document.getElementById('runeduel-play').classList.add('hidden');
    document.getElementById('runeduel-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, pause, resume, isPaused, isRunning, endTurn};
})();
