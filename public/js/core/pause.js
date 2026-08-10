/* =========================================================
   PAUSE (shared across all games)
   ========================================================= */
function currentGameModule(){
  switch(currentScreen){
    case 'soccer-screen': return SoccerGame;
    case 'racing-screen': return RacingGame;
    case 'tank-screen': return TankGame;
    case 'runner-screen': return RunnerGame;
    case 'wildduel-screen': return WildDuelGame;
    case 'asteroid-screen': return AsteroidGame;
    case 'breaker-screen': return BreakerGame;
    case 'roguelike-screen': return RoguelikeGame;
    case 'comet-screen': return CometGame;
    case 'tunnel-screen': return TunnelGame;
    case 'depths-screen': return DepthsGame;
    case 'stack-screen': return StackGame;
    case 'golf-screen': return GolfGame;
    case 'sumo-screen': return SumoGame;
    case 'towerdefense-screen': return TowerDefenseGame;
    case 'parkour-screen': return ParkourGame;
    case 'zombie-screen': return ZombieGame;
    case 'pirate-screen': return PirateGame;
    case 'samurai-screen': return SamuraiGame;
    case 'policechase-screen': return PoliceChaseGame;
    case 'tactics-screen': return TacticsGame;
    case 'runeduel-screen': return RuneDuelGame;
    case 'warlord-screen': return WarlordGame;
    default: return null;
  }
}

function togglePauseCurrentGame(){
  const game = currentGameModule();
  if(!game || !game.isRunning()) return;
  if(game.isPaused()) resumeCurrentGame();
  else pauseCurrentGame();
}

function pauseCurrentGame(){
  const game = currentGameModule();
  if(!game || !game.isRunning()) return;
  game.pause();
  document.getElementById('pause-overlay').classList.remove('hidden');
}

function resumeCurrentGame(){
  const game = currentGameModule();
  if(!game) return;
  game.resume();
  document.getElementById('pause-overlay').classList.add('hidden');
}

function quitCurrentGame(){
  const game = currentGameModule();
  document.getElementById('pause-overlay').classList.add('hidden');
  if(game && game.reset) game.reset();
}
