/* =========================================================
   LEADERBOARD STORAGE — backed by a shared server (live across all players)
   ========================================================= */
// Point this at wherever you deploy leaderboard-server/. If the game page
// and the API are served from the same origin, '/api' is fine as-is.
const LB_API_BASE = '/api';

function freshUserRecord(){
  return {
    soccer: {goals:0, saves:0, wins:0},
    racing: {wins:0},
    tank: {wins:0},
    runner: {highScore:0},
    wildduel: {wins:0},
    asteroid: {highScore:0},
    breaker: {highScore:0},
    roguelike: {deepestFloor:0},
    comet: {highScore:0},
    tunnel: {highScore:0},
    depths: {bestWave:0},
    stack: {bestHeight:0},
    golf: {bestHoles:0},
    sumo: {wins:0},
    towerdefense: {bestWave:0},
    parkour: {bestTime:0},
    zombie: {bestWave:0},
    pirate: {bestTreasure:0},
    samurai: {wins:0},
    policechase: {highScore:0},
    tactics: {wins:0},
    runeduel: {wins:0},
    warlord: {wins:0}
  };
}

// In-memory cache of the last leaderboard we fetched, so the UI always has
// something to render immediately rather than flashing empty while a
// request is in flight. Refreshed by loadLeaderboard() and by polling.
let lbCache = null;
USERS.forEach(u => { if(!lbCache) lbCache = {}; lbCache[u] = freshUserRecord(); });

async function loadLeaderboard(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/leaderboard`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    USERS.forEach(u=>{
      if(!data[u]) data[u] = freshUserRecord();
    });
    lbCache = data;
    return data;
  }catch(e){
    console.error('Leaderboard fetch failed, showing last known data:', e);
    return lbCache;
  }
}

// Sends a small, descriptive set of operations to the server instead of an
// arbitrary mutator function (functions can't cross a network boundary).
// Each op looks like one of:
//   {stat:'wins',      type:'increment',    value:1}
//   {stat:'wins',      type:'increment_if', value:1, cond:p1Won}
//   {stat:'highScore', type:'max',          value:score}
async function updateStat(game, ops){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/leaderboard/update`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, game, ops})
    });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    lbCache = await res.json();
  }catch(e){
    console.error('Leaderboard update failed (will retry on next poll):', e);
  }
}
