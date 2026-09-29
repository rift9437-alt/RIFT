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
    case 'evolution-screen': return EvolutionGame;
    case 'flood-screen': return FloodGame;
    case 'hoops-screen': return HoopsGame;
    case 'burger-screen': return BurgerGame;
    case 'tag-screen': return TagGame;
    case 'robot-screen': return RobotGame;
    case 'whodidit-screen': return WhoDidItGame;
    case 'hub-screen': return HubWorld;
    case 'kart-screen': return KartGame;
    case 'thirteen-screen': return ThirteenGame;
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


/* =========================================================
   AUTO-PAUSE WHEN THE TAB GOES AWAY
   =========================================================
   Alt-tabbing used to cost you the run: the loop keeps going, the zombies
   keep coming, and you come back to a results screen. Anything with a
   pause gets paused instead.

   Only ever pauses — it never resumes for you. Coming back to a frozen
   frame you un-pause yourself is fine; coming back to a game already
   running before you've got your hands on the keys is not. */
document.addEventListener('visibilitychange', () => {
  if(!document.hidden) return;
  const game = currentGameModule();
  if(!game || !game.isRunning || !game.isRunning()) return;
  if(game.isPaused && game.isPaused()) return;
  // Multiplayer worlds are shared and keep running for everyone else, so
  // freezing your own view of them would only desync what you see.
  if(currentScreen === 'hub-screen' || currentScreen === 'kart-screen') return;
  pauseCurrentGame();
});
