/* =========================================================
   GAME: POLICE CHASE
   ========================================================= */
const PoliceChaseGame = (function(){
  const canvas = document.getElementById('policechase-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const LANE_X = [W*0.28, W*0.5, W*0.72];
  const CAR_W = 40, CAR_H = 68;

  let rafId=null, running=false, paused=false;
  let lane, cars, cash, wanted, wantedTimer, scrollSpeed, spawnTimer, distanceScore, frame;

  function freshState(){
    lane = 1;
    cars = [];
    cash = 0;
    wanted = 0;
    wantedTimer = 0;
    scrollSpeed = 4;
    spawnTimer = 0;
    distanceScore = 0;
    frame = 0;
    updateHud();
  }

  function updateHud(){
    document.getElementById('policechase-cash-hud').textContent = cash;
    document.getElementById('policechase-wanted-hud').textContent = '★'.repeat(wanted) + '☆'.repeat(5-wanted);
  }

  function onKeyPress(name){
    if(!running || paused) return;
    if(name === 'a' || name === 'arrowleft') lane = Math.max(0, lane-1);
    if(name === 'd' || name === 'arrowright') lane = Math.min(2, lane+1);
  }

  function spawnEntity(){
    const l = Math.floor(Math.random()*3);
    const isCop = wanted > 0 && Math.random() < 0.18 + wanted*0.06;
    const isCash = !isCop && Math.random() < 0.3;
    cars.push({ lane:l, y:-100, type: isCop ? 'cop' : (isCash ? 'cash' : 'car') });
  }

  function gameOver(){
    running = false;
    const blocks = Math.floor(distanceScore/50);
    const score = cash*3 + blocks;
    updateStat('policechase', [{stat:'highScore', type:'max', value:score}]);
    zipReactToScore('policechase', 'highScore', score);
    if(cash > 0) earnTokens('policechase_cash', cash);
    if(blocks > 0) earnTokens('policechase_distance', blocks);
    document.getElementById('policechase-result-text').textContent = 'BUSTED';
    document.getElementById('policechase-result-sub').textContent = `Score ${score} · Collected 🪙 ${cash} · Traveled ${blocks} blocks.`;
    document.getElementById('policechase-play').classList.add('hidden');
    document.getElementById('policechase-result').classList.remove('hidden');
  }

  function update(){
    frame++;
    distanceScore += scrollSpeed;

    wantedTimer++;
    if(wantedTimer > 480){ wanted = Math.min(5, wanted+1); wantedTimer = 0; scrollSpeed += 0.4; }

    spawnTimer--;
    if(spawnTimer <= 0){
      spawnEntity();
      spawnTimer = Math.max(22, 46 - wanted*4);
    }

    const px = LANE_X[lane], py = H - 110;
    for(let i=cars.length-1;i>=0;i--){
      const c = cars[i];
      c.y += scrollSpeed;
      if(c.y > H+100){ cars.splice(i,1); continue; }
      if(c.lane === lane && Math.abs(c.y - py) < 60){
        if(c.type === 'cash'){
          cash += 5;
          cars.splice(i,1);
          updateHud();
        } else {
          gameOver();
          return;
        }
      }
    }
    updateHud();
  }

  function render(){
    ctx.fillStyle = '#101318';
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;
    ctx.setLineDash([20,18]);
    [ (LANE_X[0]+LANE_X[1])/2, (LANE_X[1]+LANE_X[2])/2 ].forEach(x=>{
      ctx.beginPath();
      ctx.moveTo(x, (frame*scrollSpeed) % 40 - 40);
      for(let y=-40;y<H+40;y+=40) ctx.lineTo(x, y + (frame*scrollSpeed)%40);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    cars.forEach(c => {
      const x = LANE_X[c.lane];
      if(c.type === 'cash'){
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(x, c.y, 12, 0, Math.PI*2);
        ctx.fill();
        return;
      }
      ctx.fillStyle = c.type === 'cop' ? '#4dd2ff' : '#ff5454';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = c.type === 'cop' ? 10 : 0;
      ctx.fillRect(x-CAR_W/2, c.y-CAR_H/2, CAR_W, CAR_H);
      ctx.shadowBlur = 0;
    });

    ctx.fillStyle = '#5be3ff';
    ctx.shadowColor = '#5be3ff';
    ctx.shadowBlur = 10;
    ctx.fillRect(LANE_X[lane]-CAR_W/2, H-110-CAR_H/2, CAR_W, CAR_H);
    ctx.shadowBlur = 0;
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('policechase-setup').classList.add('hidden');
    document.getElementById('policechase-result').classList.add('hidden');
    document.getElementById('policechase-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('policechase-setup').classList.remove('hidden');
    document.getElementById('policechase-play').classList.add('hidden');
    document.getElementById('policechase-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
