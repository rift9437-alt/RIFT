/* =========================================================
   FIRST-RUN TOUR
   =========================================================
   The arcade has a lot of surface now — thirty-odd cabinets, a shop, clans,
   bounties, a season track, a command palette. Somebody signing in for the
   first time sees all of it at once and none of it explained.

   Five pointers, shown once, skippable at any point, and remembered per
   device. It never blocks anything: the page underneath stays live, so
   somebody who'd rather just play can ignore it entirely. */
const TOUR_KEY = 'level7_tour_done';

const TOUR_STEPS = [
  { sel: '.cabinet-grid',
    title: 'The cabinets',
    body: 'Thirty-odd games. Pin the ones you like with the star, or filter them with the chips above.' },
  { sel: '#bounty-panel',
    title: 'Bounties and challenges',
    body: 'Three a day, each pointing at a score somebody here has actually set. Beat it and the tokens land straight away.' },
  { sel: '#daily-panel',
    title: 'Dailies, weeklies, the season track',
    body: 'Small goals that pay out, and a track that moves every time you earn anything at all.' },
  { sel: '#chat-toggle',
    title: 'Everyone shares this room',
    body: 'Chat to whoever is signed in. /w NAME whispers, and reactions work on any message.' },
  { sel: '#notif-btn',
    title: 'Anything aimed at you turns up here',
    body: 'And Ctrl+K opens a search box that jumps to any cabinet, player or screen. Press ? for the keys.' }
];

let tourStep = 0;

function tourSeen(){
  try{ return localStorage.getItem(TOUR_KEY) === '1'; }catch(e){ return true; }
}
function markTourSeen(){
  try{ localStorage.setItem(TOUR_KEY, '1'); }catch(e){}
}

function maybeStartTour(){
  if(tourSeen()) return;
  // Let the dashboard finish painting, or the first pointer measures an
  // element that hasn't been laid out yet.
  setTimeout(() => { if(currentScreen === 'dashboard-screen') startTour(); }, 1800);
}

function startTour(){
  tourStep = 0;
  document.getElementById('tour-layer').classList.remove('hidden');
  paintTourStep();
}

function endTour(){
  markTourSeen();
  document.getElementById('tour-layer').classList.add('hidden');
}

function tourNext(){
  tourStep++;
  if(tourStep >= TOUR_STEPS.length){ endTour(); return; }
  paintTourStep();
}

function paintTourStep(){
  const step = TOUR_STEPS[tourStep];
  const target = document.querySelector(step.sel);
  const card = document.getElementById('tour-card');
  const ring = document.getElementById('tour-ring');
  // A step whose target isn't on this page is skipped rather than pointing at
  // nothing — the chat dock, for one, can be hidden.
  if(!target){ tourNext(); return; }

  const r = target.getBoundingClientRect();
  ring.style.top = (r.top + window.scrollY - 6) + 'px';
  ring.style.left = (r.left - 6) + 'px';
  ring.style.width = (r.width + 12) + 'px';
  ring.style.height = (r.height + 12) + 'px';

  card.innerHTML = `
    <div class="tour-step">${tourStep + 1} / ${TOUR_STEPS.length}</div>
    <h4>${escapeHtml(step.title)}</h4>
    <p>${escapeHtml(step.body)}</p>
    <div class="tour-actions">
      <button class="btn btn-ghost" onclick="endTour()">Skip</button>
      <button class="btn btn-primary" onclick="tourNext()">${
        tourStep === TOUR_STEPS.length - 1 ? 'Got it' : 'Next'}</button>
    </div>`;

  // Put the card near the thing it's describing, but never off the screen.
  const below = r.bottom + 14 + window.scrollY;
  const wouldOverflow = r.bottom + 200 > window.innerHeight;
  card.style.top = (wouldOverflow ? Math.max(12, r.top + window.scrollY - 190) : below) + 'px';
  card.style.left = Math.max(12, Math.min(window.innerWidth - 332, r.left)) + 'px';
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Anyone can bring it back from Settings if they skipped it too fast.
function replayTour(){
  try{ localStorage.removeItem(TOUR_KEY); }catch(e){}
  closeSettings();
  backToDashboard();
  setTimeout(startTour, 500);
}
