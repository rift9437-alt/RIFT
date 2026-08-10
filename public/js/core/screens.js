/* =========================================================
   SCREEN MANAGEMENT
   ========================================================= */
let currentScreen = 'login-screen';
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  currentScreen = id;
  window.scrollTo(0,0);
}
function backToDashboard(){
  stopAllGames();
  document.getElementById('pause-overlay').classList.add('hidden');
  if(partySubmittedGame){
    submitPendingPartyScore();
    return;
  }
  showScreen('dashboard-screen');
  refreshCabinets();
  loadDailyChallenges();
  if(typeof renderRival === 'function') renderRival();
  if(typeof TV !== 'undefined') TV.refresh();
}
function stopAllGames(){
  SoccerGame.stop();
  RacingGame.stop();
  TankGame.stop();
  RunnerGame.stop();
  WildDuelGame.stop();
  AsteroidGame.stop();
  BreakerGame.stop();
  RoguelikeGame.stop();
  CometGame.stop();
  TunnelGame.stop();
  DepthsGame.stop();
  StackGame.stop();
  GolfGame.stop();
  SumoGame.stop();
  TowerDefenseGame.stop();
  ParkourGame.stop();
  ZombieGame.stop();
  PirateGame.stop();
  SamuraiGame.stop();
  PoliceChaseGame.stop();
  TacticsGame.stop();
  RuneDuelGame.stop();
  WarlordGame.stop();
}
