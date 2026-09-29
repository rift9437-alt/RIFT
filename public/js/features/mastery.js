/* =========================================================
   CABINET MASTERY
   =========================================================
   A five-star rating per cabinet, earned by playing it rather than bought.
   Two halves: how much you've played it, and how you compare to the best
   score on it. Neither on its own is a good measure — plays alone rewards
   idling, and rank alone means a cabinet nobody else touches is instantly
   five stars.

   It's derived entirely from numbers the server already keeps, so there's
   nothing new to store and it can never disagree with the leaderboard. */
const MASTERY_PLAY_STEPS = [1, 5, 15, 40, 80];

function masteryFor(cabId){
  const cab = CABINETS.find(c => c.id === cabId);
  if(!cab || !cab.best || !wallet) return 0;
  const plays = (wallet.gamePlays && wallet.gamePlays[cab.best.game]) || 0;

  // Stars from time spent with it.
  let stars = 0;
  MASTERY_PLAY_STEPS.forEach(step => { if(plays >= step) stars++; });

  // ...capped by how your score stands against the best anyone has posted, so
  // the last stars have to be earned rather than ground out.
  const mine = ((lbCache && lbCache[currentUser] && lbCache[currentUser][cab.best.game]) || {})[cab.best.key] || 0;
  let top = 0;
  if(lbCache){
    USERS.forEach(u => {
      const v = ((lbCache[u] || {})[cab.best.game] || {})[cab.best.key] || 0;
      if(v > top) top = v;
    });
  }
  if(!mine) return 0;
  const share = top > 0 ? mine / top : 1;
  const rankCap = share >= 1 ? 5 : share >= 0.7 ? 4 : share >= 0.4 ? 3 : share >= 0.15 ? 2 : 1;
  return Math.max(0, Math.min(stars, rankCap));
}

function masteryStars(cabId){
  const n = masteryFor(cabId);
  if(!n) return '';
  return `<div class="cab-mastery" title="Mastery ${n}/5 — plays and how you compare on the board">${
    '★'.repeat(n)}${'☆'.repeat(5 - n)}</div>`;
}

// Total mastery across the arcade, for the profile.
function masteryTotal(){
  return CABINETS.filter(c => c.best).reduce((sum, c) => sum + masteryFor(c.id), 0);
}
