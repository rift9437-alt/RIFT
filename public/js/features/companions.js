/* =========================================================
   ZIP THEME COMPANION — Interactive Side Character & Commentary
   ========================================================= */
const ZIP_LOSS_LINES = [
  "wow you suck",
  "that was rough to watch",
  "my drawings play better than that",
  "did you even try?",
  "that's going straight to the bottom of the leaderboard",
  "i've seen better runs from a coin flip",
  "ouch. hard L",
  "step it up next time. or don't, i don't care",
  "my little brother chip could beat that and he's SIX",
  "chip cried the first time he played this and even he did better than you",
  "i showed chip your score and he just went 'oh.'",
  "that's chip-tier gameplay and he's not even trying",
  "i'm putting this run in the family group chat",
  "somewhere chip is laughing and he doesn't even know why yet",
  "not you losing to a game literally made for little kids",
  "and THAT'S why you're not allowed to touch chip's controller",
  "i've lost brain cells watching that",
  "genuinely tragic",
  "screenshotting this for blackmail later",
  "you had one job",
  "chip says hi. chip also says you're bad at this",
  "i'm telling everyone about this one",
  "that's a new personal worst i think",
  "was that... on purpose?",
  "no notes. just disappointment"
];
const ZIP_WIN_LINES = [
  "impressive but im better",
  "okay okay, not bad",
  "new record. i'm still not clapping",
  "fine, that one was decent",
  "beginner's luck, probably",
  "don't let it go to your head",
  "chip would still beat you on a bad day but ok",
  "i'll allow it. barely",
  "somebody's been practicing instead of having a life",
  "ok that was actually kind of cool. don't tell chip i said that",
  "not bad for someone who usually loses to a six year old's little brother",
  "huh. didn't expect that",
  "fine, you get one (1) compliment. don't get used to it",
  "i guess even a broken clock is right sometimes",
  "chip's gonna be so mad he missed this one",
  "still think i could've done it faster"
];
const ZIP_IDLE_LINES = [
  "still playing?",
  "bold of you to keep going",
  "2+2=8, fight me",
  "this is taking forever",
  "you good over there?",
  "i've been drawing this whole time",
  "just saying, i'd be better at this",
  "chip's outside eating dirt again, more entertaining than this tbh",
  "my brother chip once tried to eat a crayon, we're a family of high achievers",
  "chip keeps asking if it's his turn yet. it is not",
  "i'm bored. entertain me or something",
  "tick tock",
  "chip says you're taking too long too, and he can't even tell time yet",
  "hurry up i have places to be, unlike you apparently",
  "i could be doing literally anything else right now",
  "you know staring at the screen harder doesn't make you better right"
];

// Registering the three Zip companion states
const ZIP_IMAGES = {
  idle: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/zip_idle.png',
  win:  'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/zip_win.png',
  lose: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/zip_lose.png'
};

function hideCompanions(){
  const zipBox = document.getElementById('zip-companion');
  if(zipBox) zipBox.classList.add('hidden');
  const duoBox = document.getElementById('duo-companion');
  if(duoBox) duoBox.classList.add('hidden');
  const duoRyuBox = document.getElementById('duo-ryu-companion');
  if(duoRyuBox) duoRyuBox.classList.add('hidden');
  const uroBox = document.getElementById('uro-companion');
  if(uroBox) uroBox.classList.add('hidden');
  ['trio-yuta','trio-ryu','trio-uro'].forEach(id => {
    const box = document.getElementById(id);
    if(box) box.classList.add('hidden');
  });
}

let zipCompanionTimer = null;

function showZipCharacterCompanion(kind, customText){
  const companion = document.getElementById('zip-companion');
  const textEl = document.getElementById('zip-companion-text');
  const imgEl = document.getElementById('zip-companion-img');
  if(!companion || !textEl || !imgEl) return;
  hideCompanions();

  let textBank = ZIP_IDLE_LINES;
  let stateImg = ZIP_IMAGES.idle;

  if(kind === 'win'){
    textBank = ZIP_WIN_LINES;
    stateImg = ZIP_IMAGES.win;
  } else if(kind === 'loss'){
    textBank = ZIP_LOSS_LINES;
    stateImg = ZIP_IMAGES.lose;
  }

  textEl.textContent = customText || textBank[Math.floor(Math.random()*textBank.length)];
  imgEl.src = stateImg;

  companion.classList.remove('hidden');
  clearTimeout(zipCompanionTimer);

  const duration = (kind === 'idle') ? 4500 : 7500;
  zipCompanionTimer = setTimeout(() => {
    if(kind !== 'idle'){
      showZipCharacterCompanion('idle', "2+2=8, fight me");
    } else {
      companion.classList.add('hidden');
    }
  }, duration);
}


/* =========================================================
   DUO THEME COMPANION — Yuta & Ryu
   Two characters instead of one. Most of the time only one of
   them comments on how you did — but sometimes they talk to
   each other about you instead.
   ========================================================= */
const DUO_IMAGES = {
  yuta: {
    idle: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/yuta-idle.webp',
    win:  'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/yuta-win',
    lose: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/yuta-loss'
  },
  ryu: {
    idle: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/guy.png',
    win:  'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/SUHWEET',
    lose: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/dessert.webp'
  }
};

const YUTA_WIN_LINES = [
  "well done. you should be proud of that.",
  "i knew you could do it.",
  "that took real focus. nicely played.",
  "you're getting stronger. i can tell.",
  "no need to thank me — that was all you.",
  "i mean it, that was impressive.",
  "let's keep going, together.",
  "i'm glad you're alright. and that you won."
];
const YUTA_LOSS_LINES = [
  "it's alright. you'll get it next time.",
  "don't be too hard on yourself.",
  "everyone stumbles. what matters is you keep trying.",
  "take a breath. we'll figure this out.",
  "losing isn't failing. not trying would be.",
  "i'm still proud of the effort you put in.",
  "let's learn from this one, okay?",
  "that's alright. i believe in you."
];
const YUTA_IDLE_LINES = [
  "take your time. there's no rush.",
  "i'll be right here if you need me.",
  "you seem focused. that's good.",
  "stay safe out there.",
  "whatever happens, i've got your back.",
  "no pressure. just do your best.",
  "i trust you.",
  "i was just thinking about our friends."
];
const RYU_WIN_LINES = [
  "NOW that's what i'm talking about!",
  "delicious. absolutely delicious.",
  "you're finally getting interesting!",
  "hah! that's the good stuff right there.",
  "i knew you had it in you — let's go again!",
  "that felt GREAT. do it again.",
  "okay, i'm impressed. don't let it go to your head.",
  "that's a five-star meal if i've ever seen one."
];
const RYU_LOSS_LINES = [
  "aw, bland. c'mon, spice it up next time.",
  "that's it? i've had appetizers with more kick.",
  "don't sweat it — that just means the next one's better.",
  "boring. give me something worth chewing on.",
  "not every meal's a banquet. shake it off.",
  "you call that a fight? i call that a snack.",
  "come on, get back up. i want the real deal.",
  "rough one. but i've seen worse. try again."
];
const RYU_IDLE_LINES = [
  "i'm STARVING for a good match.",
  "c'mon, hurry it up, i'm getting bored.",
  "you feel that? that's anticipation.",
  "give me something worth my time.",
  "i could go a few rounds right now.",
  "still cookin' over there?",
  "life's a meal. don't serve me leftovers.",
  "let's see what you've got."
];

// When they'd rather talk to each other than to you.
const DUO_EXCHANGES = [
  [{s:'yuta', t:"they're trying their best, i think."}, {s:'ryu', t:"best isn't always enough. but hey, i respect the effort."}],
  [{s:'ryu', t:"this one's got some fight in them."}, {s:'yuta', t:"please don't encourage reckless behavior, ryu."}],
  [{s:'yuta', t:"i just hope they're doing okay."}, {s:'ryu', t:"they're FINE, yuta. let them have some fun."}],
  [{s:'ryu', t:"not bad! not bad at all!"}, {s:'yuta', t:"you say that to everyone."}],
  [{s:'yuta', t:"we should be supportive either way."}, {s:'ryu', t:"i AM being supportive. loudly."}],
  [{s:'ryu', t:"i wish they'd swing a little harder."}, {s:'yuta', t:"maybe they're just being careful."}],
  [{s:'yuta', t:"i wonder what they're thinking right now."}, {s:'ryu', t:"probably thinking about how hungry i am."}],
  [{s:'ryu', t:"you ever think we talk about them too much?"}, {s:'yuta', t:"...maybe a little."}]
];

let duoCompanionTimer = null;

function setDuoChar(who, imgSrc, text, visible){
  const col = document.getElementById(`duo-${who}-col`);
  const img = document.getElementById(`duo-${who}-img`);
  const txt = document.getElementById(`duo-${who}-text`);
  if(!col || !img || !txt) return;
  if(!visible){
    col.classList.add('hidden');
    return;
  }
  col.classList.remove('hidden');
  img.src = imgSrc;
  txt.textContent = text;
}

function showDuoCompanion(kind){
  const companion = document.getElementById('duo-companion');
  const ryuCompanion = document.getElementById('duo-ryu-companion');
  if(!companion || !ryuCompanion) return;
  hideCompanions();

  const isExchange = Math.random() < 0.3;

  if(isExchange){
    const exchange = DUO_EXCHANGES[Math.floor(Math.random()*DUO_EXCHANGES.length)];
    exchange.forEach(line => {
      const img = line.s === 'yuta' ? DUO_IMAGES.yuta.idle : DUO_IMAGES.ryu.idle;
      setDuoChar(line.s, img, line.t, true);
    });
    // hide whichever character somehow isn't part of this exchange (defensive)
    const speakers = exchange.map(l => l.s);
    ['yuta','ryu'].forEach(who => { if(!speakers.includes(who)) setDuoChar(who, '', '', false); });
  } else {
    const speaker = Math.random() < 0.5 ? 'yuta' : 'ryu';
    const other = speaker === 'yuta' ? 'ryu' : 'yuta';
    let textBank, stateImg;
    if(speaker === 'yuta'){
      textBank = kind === 'win' ? YUTA_WIN_LINES : kind === 'loss' ? YUTA_LOSS_LINES : YUTA_IDLE_LINES;
      stateImg = kind === 'win' ? DUO_IMAGES.yuta.win : kind === 'loss' ? DUO_IMAGES.yuta.lose : DUO_IMAGES.yuta.idle;
    } else {
      textBank = kind === 'win' ? RYU_WIN_LINES : kind === 'loss' ? RYU_LOSS_LINES : RYU_IDLE_LINES;
      stateImg = kind === 'win' ? DUO_IMAGES.ryu.win : kind === 'loss' ? DUO_IMAGES.ryu.lose : DUO_IMAGES.ryu.idle;
    }
    setDuoChar(speaker, stateImg, textBank[Math.floor(Math.random()*textBank.length)], true);
    setDuoChar(other, '', '', false);
  }

  companion.classList.remove('hidden');
  ryuCompanion.classList.remove('hidden');
  clearTimeout(duoCompanionTimer);

  const duration = (kind === 'idle') ? 5000 : 8000;
  duoCompanionTimer = setTimeout(() => {
    if(kind !== 'idle'){
      showDuoCompanion('idle');
    } else {
      companion.classList.add('hidden');
      ryuCompanion.classList.add('hidden');
    }
  }, duration);
}


/* =========================================================
   URO THEME COMPANION — Interactive Side Character & Commentary
   Proud, sharp-tongued, and bitter toward anyone who looks
   like they were born into an easy win.
   ========================================================= */
const URO_IMAGES = {
  idle: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/uro-idle.webp',
  win:  'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/uro-win.webp',
  lose: 'https://raw.githubusercontent.com/rift9437-alt/RIFT/main/uro-lose.webp'
};

const URO_WIN_LINES = [
  "don't get used to it.",
  "hah. finally earned something.",
  "not bad — for once you didn't rely on luck.",
  "see? skill beats a good bloodline every time.",
  "that's what happens when you actually try.",
  "i'll allow you this one. just this one.",
  "guess you're not completely hopeless.",
  "victory tastes better when nobody handed it to you."
];

const URO_LOSS_LINES = [
  "pathetic. sit down.",
  "were you even trying, or just coasting?",
  "born lucky, plays sloppy. typical.",
  "don't blame the odds. blame the effort.",
  "i've seen better fights from people half as gifted as you.",
  "that's what happens when talent shows up without work.",
  "spare me the excuses.",
  "you had every advantage and still lost. embarrassing."
];

const URO_IDLE_LINES = [
  "i'm not here to be impressed.",
  "everyone thinks they're special until they're not.",
  "still waiting for someone worth my time.",
  "don't mistake my patience for kindness.",
  "i clawed my way here. nobody handed me anything.",
  "spare me the noble-blood speeches.",
  "prove it, don't preach it.",
  "i respect skill. i despise entitlement."
];

let uroCompanionTimer = null;

function showUroCompanion(kind, customText){
  const companion = document.getElementById('uro-companion');
  const textEl = document.getElementById('uro-companion-text');
  const imgEl = document.getElementById('uro-companion-img');
  if(!companion || !textEl || !imgEl) return;
  hideCompanions();

  let textBank = URO_IDLE_LINES;
  let stateImg = URO_IMAGES.idle;

  if(kind === 'win'){
    textBank = URO_WIN_LINES;
    stateImg = URO_IMAGES.win;
  } else if(kind === 'loss'){
    textBank = URO_LOSS_LINES;
    stateImg = URO_IMAGES.lose;
  }

  textEl.textContent = customText || textBank[Math.floor(Math.random()*textBank.length)];
  imgEl.src = stateImg;

  companion.classList.remove('hidden');
  clearTimeout(uroCompanionTimer);

  const duration = (kind === 'idle') ? 4500 : 7500;
  uroCompanionTimer = setTimeout(() => {
    if(kind !== 'idle'){
      showUroCompanion('idle');
    } else {
      companion.classList.add('hidden');
    }
  }, duration);
}


/* =========================================================
   TRIO THEME COMPANION — Yuta, Ryu & Uro
   The priciest companion theme. Reuses each character's own
   line banks and images, but adds three-way exchanges where
   Uro's cynicism clashes with the other two.
   ========================================================= */
const TRIO_EXCHANGES = [
  [{s:'uro', t:"you two coddle them too much."}, {s:'yuta', t:"encouragement isn't coddling, uro."}, {s:'ryu', t:"yeah! i coddle nobody and i'm still nice about it."}],
  [{s:'ryu', t:"lighten up, uro, they're trying."}, {s:'uro', t:"trying isn't an accomplishment."}],
  [{s:'yuta', t:"everyone starts somewhere."}, {s:'uro', t:"and some starts are easier than others."}],
  [{s:'uro', t:"born lucky or built tough — i want to see which one this is."}, {s:'ryu', t:"ooh, i like that test."}],
  [{s:'yuta', t:"please be a little kinder, uro."}, {s:'uro', t:"kindness doesn't win fights."}],
  [{s:'ryu', t:"at least admit that was a good one."}, {s:'uro', t:"...fine. it wasn't terrible."}],
  [{s:'uro', t:"hmph. still not impressed."}, {s:'yuta', t:"you're never impressed."}, {s:'uro', t:"exactly."}],
  [{s:'ryu', t:"we're basically a buffet of opinions over here."}, {s:'yuta', t:"please don't call us a buffet."}, {s:'uro', t:"for once, i agree with him."}]
];

let trioCompanionTimer = null;

function setTrioChar(who, imgSrc, text, visible){
  const box = document.getElementById(`trio-${who}`);
  const img = document.getElementById(`trio-${who}-img`);
  const txt = document.getElementById(`trio-${who}-text`);
  if(!box || !img || !txt) return;
  if(!visible){
    box.classList.add('hidden');
    return;
  }
  img.src = imgSrc;
  txt.textContent = text;
  box.classList.remove('hidden');
}

function showTrioCompanion(kind){
  hideCompanions();

  const isExchange = Math.random() < 0.35;

  if(isExchange){
    const exchange = TRIO_EXCHANGES[Math.floor(Math.random()*TRIO_EXCHANGES.length)];
    const speakers = exchange.map(l => l.s);
    exchange.forEach(line => {
      const img = line.s === 'yuta' ? DUO_IMAGES.yuta.idle : line.s === 'ryu' ? DUO_IMAGES.ryu.idle : URO_IMAGES.idle;
      setTrioChar(line.s, img, line.t, true);
    });
    ['yuta','ryu','uro'].forEach(who => { if(!speakers.includes(who)) setTrioChar(who, '', '', false); });
  } else {
    const roll = Math.random();
    const speaker = roll < 0.34 ? 'yuta' : roll < 0.67 ? 'ryu' : 'uro';
    let textBank, stateImg;
    if(speaker === 'yuta'){
      textBank = kind === 'win' ? YUTA_WIN_LINES : kind === 'loss' ? YUTA_LOSS_LINES : YUTA_IDLE_LINES;
      stateImg = kind === 'win' ? DUO_IMAGES.yuta.win : kind === 'loss' ? DUO_IMAGES.yuta.lose : DUO_IMAGES.yuta.idle;
    } else if(speaker === 'ryu'){
      textBank = kind === 'win' ? RYU_WIN_LINES : kind === 'loss' ? RYU_LOSS_LINES : RYU_IDLE_LINES;
      stateImg = kind === 'win' ? DUO_IMAGES.ryu.win : kind === 'loss' ? DUO_IMAGES.ryu.lose : DUO_IMAGES.ryu.idle;
    } else {
      textBank = kind === 'win' ? URO_WIN_LINES : kind === 'loss' ? URO_LOSS_LINES : URO_IDLE_LINES;
      stateImg = kind === 'win' ? URO_IMAGES.win : kind === 'loss' ? URO_IMAGES.lose : URO_IMAGES.idle;
    }
    setTrioChar(speaker, stateImg, textBank[Math.floor(Math.random()*textBank.length)], true);
    ['yuta','ryu','uro'].forEach(who => { if(who !== speaker) setTrioChar(who, '', '', false); });
  }

  clearTimeout(trioCompanionTimer);
  const duration = (kind === 'idle') ? 5000 : 8000;
  trioCompanionTimer = setTimeout(() => {
    if(kind !== 'idle'){
      showTrioCompanion('idle');
    } else {
      hideCompanions();
    }
  }, duration);
}

// Dispatcher — every existing call site keeps calling showZipCompanion();
// it just routes to whichever companion theme is actually equipped.
function showZipCompanion(kind, customText){
  if(wallet && (wallet.equipped === 'zip' || wallet.companion === 'zip')){
    showZipCharacterCompanion(kind, customText);
  } else if(wallet && (wallet.equipped === 'duo' || wallet.companion === 'duo')){
    showDuoCompanion(kind);
  } else if(wallet && (wallet.equipped === 'uro' || wallet.companion === 'uro')){
    showUroCompanion(kind, customText);
  } else if(wallet && (wallet.equipped === 'trio' || wallet.companion === 'trio')){
    showTrioCompanion(kind);
  } else {
    hideCompanions();
  }
}

function zipReactToScore(game, statKey, newValue){
  const prev = (lbCache && lbCache[currentUser] && lbCache[currentUser][game] && lbCache[currentUser][game][statKey]) || 0;
  showZipCompanion(newValue > prev ? 'win' : 'loss');
}

setInterval(()=>{
  const hasCompanion = wallet && (wallet.equipped === 'zip' || wallet.companion === 'zip' || wallet.equipped === 'duo' || wallet.companion === 'duo' || wallet.equipped === 'uro' || wallet.companion === 'uro' || wallet.equipped === 'trio' || wallet.companion === 'trio');
  if(!hasCompanion) return;
  const game = currentGameModule();
  if(!game || !game.isRunning || !game.isRunning() || game.isPaused()) {
    hideCompanions();
    return;
  }
  if(Math.random() < 0.15) showZipCompanion('idle');
}, 7000);


// reason: a key into the server's REWARDS table (e.g. 'soccer_win').
// qty: how many times it happened (e.g. number of goals). Defaults to 1.
// Spending that isn't a shop purchase. The server owns the price — the client
// only says what it wants and how far into the run it is — so this returns
// whether it actually went through rather than assuming it did.
async function spendTokens(reason, scale){
  if(!currentUser) return false;
  try{
    const res = await apiFetch(`${LB_API_BASE}/wallet/spend`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, reason, n: scale })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      if(typeof toast === 'function' && data.error === 'Not enough tokens'){
        toast('Not enough tokens', `That costs ${data.cost}`, '🪙', 'pink');
      }
      return false;
    }
    wallet = data.wallet;
    updateTokenDisplay();
    return true;
  }catch(e){
    console.error('Spend failed:', e);
    return false;
  }
}

async function earnTokens(reason, qty){
  if(!currentUser) return;
  try{
    const prevUnlocked = (wallet && wallet.achievements) ? wallet.achievements.length : 0;
    const prevLevel = wallet ? (wallet.level || 1) : 1;
    const res = await apiFetch(`${LB_API_BASE}/wallet/earn`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, reason, qty: qty==null ? 1 : qty})
    });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const prevAchievements = wallet ? (wallet.achievements || []) : [];
    wallet = await res.json();
    updateTokenDisplay();
    if((wallet.achievements || []).length > prevUnlocked){
      const newIds = wallet.achievements.filter(id => !prevAchievements.includes(id));
      showAchievementToast(newIds);
    }
    if((wallet.level || 1) > prevLevel){
      showLevelUpToast(wallet.level);
    }
  }catch(e){
    console.error('Earn tokens failed (will catch up on next wallet load):', e);
  }
}

function showLevelUpToast(newLevel){
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:5000; background:linear-gradient(135deg, var(--bg-panel), var(--bg-panel-raised)); border:1px solid var(--gold); border-radius:12px; padding:12px 22px; font-family:var(--font-mono); font-size:13px; color:var(--text); box-shadow:0 10px 30px rgba(0,0,0,0.5); animation: zip-pop 0.2s ease-out; text-align:center;`;
  toast.innerHTML = `<b style="color:var(--gold); font-size:15px;">⭐ LEVEL UP!</b><br>You reached Level ${newLevel}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function showAchievementToast(ids){
  if(!ids || !ids.length) return;
  achievementsCatalog = null; // force a refetch — a just-unlocked secret needs its real name revealed
  ids.forEach(async (id, i) => {
    if(!achievementsCatalog) await loadAchievementsCatalog();
    const a = achievementsCatalog && achievementsCatalog[id];
    if(!a) return;
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed; top:${20 + i*70}px; right:20px; z-index:5000; background:linear-gradient(135deg, var(--bg-panel), var(--bg-panel-raised)); border:1px solid var(--gold); border-radius:12px; padding:12px 18px; font-family:var(--font-mono); font-size:12px; color:var(--text); box-shadow:0 10px 30px rgba(0,0,0,0.5); animation: zip-pop 0.2s ease-out;`;
    toast.innerHTML = `<b style="color:var(--gold);">${a.icon || '🏆'} ACHIEVEMENT UNLOCKED</b><br>${a.name}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  });
}

async function renderShop(){
  const grid = document.getElementById('shop-grid');
  const mergeGrid = document.getElementById('shop-merge-grid');
  const msg = document.getElementById('shop-message');
  msg.textContent = '';
  if(!shopCatalog) await loadShopItems();
  await loadWallet();
  document.getElementById('shop-balance').textContent = '🪙 ' + (wallet.tokens||0);

  const themeCards = [];
  const mergeCards = [];

  Object.entries(shopCatalog).forEach(([id,item])=>{
    const owned = wallet.owned.includes(id);

    // Upgrade-type items (e.g. Zip Merge) don't have swatches or a single
    // equipped slot — they're just unlocked, then toggled on/off. They get
    // their own column on the right instead of living in the theme grid.
    if(item.type === 'upgrade'){
      const hasPrereq = !item.requires || wallet.owned.includes(item.requires);
      // The companion this merge item toggles — driven by `requires` so
      // Zip Merge, Duo Merge, and Uro Merge all reuse the same logic.
      const companionId = item.requires;
      const companionLabel = shopCatalog[companionId]?.name || companionId;
      const swatch = (shopCatalog[companionId] && item.requires !== 'duo')
        ? [shopCatalog[companionId].cyan, shopCatalog[companionId].pink, shopCatalog[companionId].gold]
        : ['#22c55e', '#ffffff', '#16a34a'];
      let btnHtml;
      if(!hasPrereq){
        btnHtml = `<button class="btn btn-secondary" disabled>Requires ${companionLabel}</button>`;
      } else if(owned){
        const on = wallet.companion === companionId;
        btnHtml = `<button class="btn ${on?'btn-secondary':'btn-primary'}" onclick="handleToggleCompanion(${on?'null':`'${companionId}'`})">${on?'Disable':'Enable'} ${companionLabel} Commentary</button>`;
      } else {
        const canAfford = wallet.tokens >= item.cost;
        btnHtml = `<button class="btn btn-primary" onclick="handlePurchase('${id}')" ${canAfford?'':'disabled'}>Unlock &middot; 🪙 ${item.cost}</button>`;
      }
      const canGiftMerge = (wallet.friends||[]).length > 0 && item.cost;
      const giftBtnMerge = canGiftMerge ? `<button class="btn btn-secondary" style="margin-top:6px;" onclick="openGiftModal('${id}','${item.name.replace(/'/g,"\\'")}')">🎁 Gift &middot; 🪙 ${item.cost}</button>` : '';
      mergeCards.push(`
        <div class="shop-card ${owned && wallet.companion===companionId ? 'shop-card-equipped':''}">
          <div class="shop-swatch">
            <span style="background:${swatch[0]}"></span>
            <span style="background:${swatch[1]}; border:1px solid #ccc"></span>
            <span style="background:${swatch[2]}"></span>
          </div>
          <div class="shop-card-name">${item.name}</div>
          ${item.desc ? `<div class="shop-card-desc" style="font-size:11px; color:var(--text-dim); margin-bottom:8px; line-height:1.4;">${item.desc}</div>` : ''}
          ${btnHtml}
          ${giftBtnMerge}
        </div>
      `);
      return;
    }

    const equipped = wallet.equipped === id;
    let btnHtml;
    if(equipped){
      btnHtml = `<button class="btn btn-secondary" disabled>Equipped</button>`;
    } else if(owned){
      btnHtml = `<button class="btn btn-secondary" onclick="handleEquip('${id}')">Equip</button>`;
    } else {
      const canAfford = wallet.tokens >= item.cost;
      btnHtml = `<button class="btn btn-primary" onclick="handlePurchase('${id}')" ${canAfford?'':'disabled'}>Buy &middot; 🪙 ${item.cost}</button>`;
    }
    const canGift = (wallet.friends||[]).length > 0 && item.cost;
    const giftBtn = canGift ? `<button class="btn btn-secondary" style="margin-top:6px;" onclick="openGiftModal('${id}','${item.name.replace(/'/g,"\\'")}')">🎁 Gift &middot; 🪙 ${item.cost}</button>` : '';
    themeCards.push(`
      <div class="shop-card ${equipped?'shop-card-equipped':''}">
        <div class="shop-swatch">
          <span style="background:${item.cyan}"></span>
          <span style="background:${item.pink}"></span>
          <span style="background:${item.gold}"></span>
        </div>
        <div class="shop-card-name">${item.name}</div>
        ${btnHtml}
        ${giftBtn}
      </div>
    `);
  });

  grid.innerHTML = themeCards.join('');
  if(mergeGrid) mergeGrid.innerHTML = mergeCards.join('') || `<div style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim); text-align:center;">No merges yet.</div>`;
}

async function handlePurchase(itemId){
  const msg = document.getElementById('shop-message');
  msg.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/shop/purchase`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, itemId})
    });
    const data = await res.json();
    if(!res.ok){
      msg.textContent = data.error === 'Not enough tokens' ? "You don't have enough tokens yet." : (data.error || 'Purchase failed.');
      return;
    }
    wallet = data;
    applyTheme(wallet.equipped);
    updateTokenDisplay();
    renderShop();
  }catch(e){
    console.error('Purchase failed:', e);
    msg.textContent = 'Could not reach the server — try again.';
  }
}
