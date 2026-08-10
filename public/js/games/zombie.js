/* =========================================================
   GAME: ZOMBIE SURVIVAL
   ========================================================= */
const ZombieGame = (function(){
  const canvas = document.getElementById('zombie-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const MAP_COLORS = { yard:'#1a1206', lab:'#061a18', city:'#0d0f14' };

  let rafId=null, running=false, paused=false;
  let map = 'yard';
  let px,py,hp,maxHp,wave,scrap,bullets,zombies,fireTimer,firing,mx,my,spawnQueue,spawnTimer,totalKills,inShop,weapon,purchases;

  function setMap(m){
    map = m;
    ['yard','lab','city'].forEach(id => {
      document.getElementById('zombie-map-'+id).classList.toggle('selected', id===m);
    });
  }

  function freshState(){
    px = W/2; py = H/2;
    maxHp = 100; hp = maxHp;
    wave = 1; scrap = 0; totalKills = 0;
    bullets = []; zombies = [];
    fireTimer = 0; firing = false;
    mx = px; my = py-50;
    weapon = { damage:10, cooldown:18 };
    purchases = { dmg:0, rate:0, hp:0 };
    inShop = false;
    startWave();
    updateHud();
  }

  function updateHud(){
    document.getElementById('zombie-wave-hud').textContent = wave;
    document.getElementById('zombie-hp-hud').textContent = '❤ ' + Math.max(0,Math.round(hp));
    document.getElementById('zombie-scrap-hud').textContent = '🔩 ' + scrap;
  }

  function startWave(){
    const isBoss = wave % 10 === 0;
    spawnQueue = isBoss ? 3 : (5 + wave);
    spawnTimer = 0;
  }

  function spawnZombie(boss){
    const edge = Math.floor(Math.random()*4);
    let x,y;
    if(edge===0){ x=Math.random()*W; y=-20; }
    else if(edge===1){ x=W+20; y=Math.random()*H; }
    else if(edge===2){ x=Math.random()*W; y=H+20; }
    else { x=-20; y=Math.random()*H; }
    zombies.push({
      x,y,boss,
      hp: boss ? (260 + wave*15) : (14 + wave*3.5),
      maxHp: boss ? (260 + wave*15) : (14 + wave*3.5),
      speed: boss ? 0.9 : (1.1 + Math.random()*0.4)
    });
  }

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX-rect.left)*(W/rect.width), y: (e.clientY-rect.top)*(H/rect.height) };
  }
  canvas.addEventListener('pointermove', e=>{ const p=canvasPos(e); mx=p.x; my=p.y; });
  canvas.addEventListener('pointerdown', ()=>{ firing = true; });
  canvas.addEventListener('pointerup', ()=>{ firing = false; });
  canvas.addEventListener('pointerleave', ()=>{ firing = false; });

  function fire(){
    const dx = mx-px, dy = my-py;
    const d = Math.hypot(dx,dy) || 1;
    bullets.push({ x:px, y:py, vx:(dx/d)*9, vy:(dy/d)*9, damage:weapon.damage });
  }

  function SHOP_OPTIONS(){
    return [
      { id:'dmg', label:`Sharper Rounds +4 DMG (🔩${15+purchases.dmg*10})`, cost: 15+purchases.dmg*10,
        apply: ()=>{ weapon.damage += 4; purchases.dmg++; } },
      { id:'rate', label:`Faster Trigger -2f Cooldown (🔩${15+purchases.rate*10})`, cost: 15+purchases.rate*10,
        apply: ()=>{ weapon.cooldown = Math.max(6, weapon.cooldown-2); purchases.rate++; } },
      { id:'hp', label:`Field Medkit +20 Max HP & Heal (🔩${12+purchases.hp*8})`, cost: 12+purchases.hp*8,
        apply: ()=>{ maxHp += 20; hp = maxHp; purchases.hp++; } }
    ];
  }

  function openShop(){
    inShop = true;
    document.getElementById('zombie-shop-sub').textContent = `Wave ${wave} cleared. Scrap: 🔩 ${scrap}`;
    const opts = document.getElementById('zombie-shop-options');
    opts.innerHTML = '';
    SHOP_OPTIONS().forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = o.label;
      btn.disabled = scrap < o.cost;
      btn.onclick = () => {
        if(scrap < o.cost) return;
        scrap -= o.cost;
        o.apply();
        openShop();
        updateHud();
      };
      opts.appendChild(btn);
    });
    document.getElementById('zombie-shop').classList.remove('hidden');
  }

  function nextWave(){
    document.getElementById('zombie-shop').classList.add('hidden');
    inShop = false;
    wave++;
    startWave();
    updateHud();
  }

  function gameOver(){
    running = false;
    const wavesSurvived = wave - 1;
    updateStat('zombie', [{stat:'bestWave', type:'max', value:wavesSurvived}]);
    zipReactToScore('zombie', 'bestWave', wavesSurvived);
    if(wavesSurvived > 0) earnTokens('zombie_wave', wavesSurvived);
    if(totalKills > 0) earnTokens('zombie_kill', totalKills);
    document.getElementById('zombie-result-text').textContent = 'YOU DIED';
    document.getElementById('zombie-result-sub').textContent =
      `Survived ${wavesSurvived} wave${wavesSurvived===1?'':'s'} and took down ${totalKills} zombies.`;
    document.getElementById('zombie-play').classList.add('hidden');
    document.getElementById('zombie-result').classList.remove('hidden');
  }

  function update(){
    if(inShop) return;

    let dx=0, dy=0;
    if(keys.has('a')) dx -= 1;
    if(keys.has('d')) dx += 1;
    if(keys.has('w')) dy -= 1;
    if(keys.has('s')) dy += 1;
    const len = Math.hypot(dx,dy) || 1;
    px = clamp(px + (dx/len)*3.4, 14, W-14);
    py = clamp(py + (dy/len)*3.4, 14, H-14);

    fireTimer--;
    if(firing && fireTimer <= 0){ fire(); fireTimer = weapon.cooldown; }

    for(let i=bullets.length-1;i>=0;i--){
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy;
      if(b.x<0||b.x>W||b.y<0||b.y>H){ bullets.splice(i,1); continue; }
      for(let j=zombies.length-1;j>=0;j--){
        const z = zombies[j];
        if(Math.hypot(b.x-z.x,b.y-z.y) < (z.boss?24:13)){
          z.hp -= b.damage;
          bullets.splice(i,1);
          if(z.hp <= 0){
            const wasBoss = z.boss;
            zombies.splice(j,1);
            totalKills++;
            scrap += wasBoss ? 40 : (4 + Math.floor(wave*0.3));
            updateHud();
            if(wasBoss) earnTokens('zombie_boss', 1);
          }
          break;
        }
      }
    }

    if(spawnQueue > 0){
      spawnTimer--;
      if(spawnTimer <= 0){
        spawnZombie(wave % 10 === 0 && spawnQueue === 1);
        spawnQueue--;
        spawnTimer = 30;
      }
    }

    zombies.forEach(z => {
      const dx = px-z.x, dy = py-z.y;
      const d = Math.hypot(dx,dy) || 1;
      z.x += (dx/d)*z.speed;
      z.y += (dy/d)*z.speed;
      if(d < (z.boss?26:16)) hp -= (z.boss ? 0.7 : 0.3);
    });

    updateHud();
    if(hp <= 0){ gameOver(); return; }

    if(spawnQueue === 0 && zombies.length === 0){
      openShop();
    }
  }

  function render(){
    ctx.fillStyle = MAP_COLORS[map] || '#12161f';
    ctx.fillRect(0,0,W,H);

    zombies.forEach(z => {
      ctx.fillStyle = z.boss ? '#ff2b4a' : '#8fff6b';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = z.boss ? 14 : 6;
      ctx.beginPath();
      ctx.arc(z.x,z.y,z.boss?24:12,0,Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1a1102';
      ctx.fillRect(z.x-14,z.y-(z.boss?36:20),28,4);
      ctx.fillStyle = '#4dff8a';
      ctx.fillRect(z.x-14,z.y-(z.boss?36:20),28*(z.hp/z.maxHp),4);
    });

    bullets.forEach(b => {
      ctx.fillStyle = '#ffdd33';
      ctx.beginPath();
      ctx.arc(b.x,b.y,3,0,Math.PI*2);
      ctx.fill();
    });

    ctx.strokeStyle = '#5be3ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px,py);
    ctx.lineTo(mx,my);
    ctx.stroke();

    ctx.fillStyle = '#5be3ff';
    ctx.shadowColor = '#5be3ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px,py,13,0,Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('zombie-setup').classList.add('hidden');
    document.getElementById('zombie-result').classList.add('hidden');
    document.getElementById('zombie-shop').classList.add('hidden');
    document.getElementById('zombie-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }
  function stop(){ running=false; paused=false; firing=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false; firing = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('zombie-setup').classList.remove('hidden');
    document.getElementById('zombie-play').classList.add('hidden');
    document.getElementById('zombie-shop').classList.add('hidden');
    document.getElementById('zombie-result').classList.add('hidden');
    setMap(map || 'yard');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  setMap('yard');
  return {start, stop, reset, pause, resume, isPaused, isRunning, setMap, nextWave};
})();
