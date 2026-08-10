/* =========================================================
   INIT
   ========================================================= */
(function init(){
  loadSettings();
  renderCabinets();
  const savedUser = sessionStorage.getItem(SESSION_KEY);
  const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if(savedUser && savedToken && USERS.includes(savedUser)){
    currentUser = savedUser;
    authToken = savedToken;
    afterLogin();
  } else {
    showScreen('login-screen');
  }
})();
