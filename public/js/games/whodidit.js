/* =========================================================
   WHO DID IT? — a short mystery
   =========================================================
   Something has gone missing from the arcade. Five suspects, four rooms, a
   clock. Search rooms for physical clues and question suspects for
   testimony, then name the culprit before the time runs out.

   The case is generated fresh every run: who did it, where they were, what
   they took, and which details are true. Clues never lie — but a suspect
   might, and exactly one of them is lying about where they were. Working out
   who is the actual puzzle. */
const WhoDidItGame = (function(){
  const canvas = document.getElementById('whodidit-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const ROUND_SECONDS = 180;
  const SEARCH_COST = 8;      // seconds burned searching a room
  const TALK_COST = 5;        // seconds burned on a question

  const SUSPECTS = [
    { id: 'zip',   name: 'Zip',        icon: '🟢', colour: '#22c55e' },
    { id: 'duo',   name: 'Duo',        icon: '🔵', colour: '#4cb8ff' },
    { id: 'uro',   name: 'Uro',        icon: '🟣', colour: '#c084fc' },
    { id: 'ryu',   name: 'The Keeper', icon: '🟠', colour: '#ff8a3d' },
    { id: 'nyx',   name: 'Nyx',        icon: '⚫', colour: '#8b94a7' }
  ];

  const ROOMS = [
    { id: 'arcade',  name: 'The Arcade Floor', icon: '🕹' },
    { id: 'backroom',name: 'The Back Room',    icon: '🚪' },
    { id: 'office',  name: 'The Office',       icon: '🗄' },
    { id: 'basement',name: 'The Basement',     icon: '🔦' }
  ];

  const STOLEN = ['the token press die', 'the master key', 'the ledger',
                  'cabinet thirteen’s plaque', 'the prize wheel pin'];

  // What people are wearing. Deliberately shared between suspects — a thread
  // of fabric should narrow the field, not hand you the answer.
  const OUTFITS = ['a dark coat', 'a bright jacket', 'plain overalls'];

  // Physical traces. Each asserts one thing about the culprit rather than
  // naming them, so a case takes two or three to close.
  const TRAIT_CLUES = [
    { key: 'outfit', text: c => `A thread from ${c.outfit}, caught on the frame.` },
    { key: 'tall',   text: c => c.tall ? 'Scuff marks high on the door — whoever it was is tall.'
                                       : 'The top shelf is untouched. They couldn’t reach it.' },
    { key: 'gloved', text: c => c.gloved ? 'No prints at all. They wore gloves.'
                                         : 'A clean set of prints on the panel.' },
    // Atmosphere. It fixes when it happened, but it doesn't narrow anything —
    // every case keeps one clue that isn't a lever.
    { key: 'time',   text: c => `The clock stopped at ${c.hour}. That’s when it happened.` }
  ];
  const DEDUCTIVE = ['outfit', 'tall', 'gloved'];

  let rafId = null, running = false, paused = false;
  let timeLeft, frame, solved, message, messageTimer;
  let culprit, stolen, truth, clues, testimony, searched, questioned, accusing;

  /* ---- case generation ------------------------------------------------ */

  function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

  function generateCase(){
    culprit = pick(SUSPECTS);
    stolen = pick(STOLEN);
    const scene = pick(ROOMS);

    truth = { scene, hour: pick(['1:10', '2:45', '3:30', '11:55']) };

    // Where everyone actually was. The culprit is at the scene and nobody
    // else is, so "who was in that room" has exactly one answer.
    const shuffledRooms = ROOMS.slice().sort(() => Math.random() - 0.5);
    truth.where = {};
    SUSPECTS.forEach((sp, i) => {
      truth.where[sp.id] = sp.id === culprit.id
        ? scene.id
        : shuffledRooms[i % ROOMS.length].id;
    });
    SUSPECTS.forEach(sp => {
      if(sp.id !== culprit.id && truth.where[sp.id] === scene.id){
        truth.where[sp.id] = ROOMS.find(r => r.id !== scene.id).id;
      }
    });

    // Which three clues this case leaves behind, decided before anyone's
    // traits are rolled — the traits then have to make that set add up.
    const chosen = TRAIT_CLUES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    const asserted = chosen.map(c => c.key).filter(k => DEDUCTIVE.includes(k));

    // Everyone's physical traits. The culprit's are whatever the clues will
    // describe; the others are rolled until nobody else fits every clue,
    // because a mystery you can only guess at isn't one.
    truth.traits = { tall: {}, gloved: {}, outfit: {} };
    const rollCulprit = () => {
      truth.tall = Math.random() < 0.5;
      truth.gloved = Math.random() < 0.5;
      truth.outfit = pick(OUTFITS);
      truth.traits.tall[culprit.id] = truth.tall;
      truth.traits.gloved[culprit.id] = truth.gloved;
      truth.traits.outfit[culprit.id] = truth.outfit;
    };
    const others = SUSPECTS.filter(sp => sp.id !== culprit.id);
    const fitsEveryClue = id => asserted.every(k => truth.traits[k][id] === truth.traits[k][culprit.id]);
    rollCulprit();
    for(let attempt = 0; attempt < 300; attempt++){
      others.forEach(sp => {
        truth.traits.tall[sp.id] = Math.random() < 0.5;
        truth.traits.gloved[sp.id] = Math.random() < 0.5;
        truth.traits.outfit[sp.id] = pick(OUTFITS);
      });
      if(!others.some(sp => fitsEveryClue(sp.id))) break;
      // A very unlucky clue set (two binary clues, four innocents) can be
      // slow to separate. Re-rolling what the clues assert unsticks it.
      if(attempt === 150) rollCulprit();
    }
    // Last resort: force each innocent off the culprit's profile outright, so
    // a case can never ship with two people fitting the evidence.
    others.forEach(sp => {
      if(!fitsEveryClue(sp.id)) return;
      const k = asserted[0] || 'tall';
      if(k === 'outfit') truth.traits.outfit[sp.id] = pick(OUTFITS.filter(o => o !== truth.outfit));
      else truth.traits[k][sp.id] = !truth.traits[k][culprit.id];
    });

    // One suspect lies about where they were. If it's the culprit they'll
    // claim somewhere else; if it's an innocent, their alibi is simply wrong,
    // which is the red herring.
    truth.liar = Math.random() < 0.6 ? culprit.id : pick(others).id;

    // Spread the clues around. The scene keeps the break-in itself and one
    // trace, so searching the right room is always worth something.
    clues = {};
    ROOMS.forEach(r => { clues[r.id] = []; });
    clues[scene.id].push({ text: `Signs of a struggle — ${stolen} was taken from here.`, key: 'scene' });
    chosen.forEach((c, i) => {
      const room = i === 0 ? scene : pick(ROOMS);
      clues[room.id].push({ text: c.text(truth), key: c.key });
    });
    ROOMS.forEach(r => {
      if(!clues[r.id].length) clues[r.id].push({ text: 'Nothing here but dust and old tokens.', key: null });
    });

    // What each suspect will say. Traits are always given straight; only the
    // alibi can be a lie.
    testimony = {};
    SUSPECTS.forEach(sp => {
      const claimed = sp.id === truth.liar
        ? pick(ROOMS.filter(r => r.id !== truth.where[sp.id])).id
        : truth.where[sp.id];
      testimony[sp.id] = [
        `${ROOMS.find(r => r.id === claimed).name}, all evening.`,
        truth.traits.tall[sp.id] ? 'I can reach the top shelf.' : 'I can’t reach the top shelf.',
        truth.traits.gloved[sp.id] ? 'I always wear gloves in here.' : 'I never wear gloves.',
        `I’ve been in ${truth.traits.outfit[sp.id]} all day.`
      ];
    });

    searched = {};
    questioned = {};
    accusing = false;
    solved = null;
  }

  /* ---- flow ----------------------------------------------------------- */

  function say(t){ message = t; messageTimer = 200; }

  function searchRoom(id){
    if(!running || solved) return;
    if(searched[id]){ say('You have already been through there.'); return; }
    searched[id] = true;
    timeLeft -= SEARCH_COST;
    Sfx.play('click');
    render();
  }

  function question(id){
    if(!running || solved) return;
    if(questioned[id]){ say('They have told you all they will.'); return; }
    questioned[id] = true;
    timeLeft -= TALK_COST;
    Sfx.play('select');
    render();
  }

  function beginAccuse(){
    if(!running || solved) return;
    accusing = true;
    render();
  }
  function cancelAccuse(){ accusing = false; render(); }

  function accuse(id){
    if(!running || solved) return;
    const right = id === culprit.id;
    solved = right ? 'right' : 'wrong';
    running = false;
    Sfx.play(right ? 'win' : 'lose');
    const found = Object.values(searched).filter(Boolean).length;
    if(right){
      const spent = ROUND_SECONDS - timeLeft;
      updateStat('whodidit', [{stat:'solved', type:'increment', value:1}]);
      earnTokens('mystery_solved', 1);
      document.getElementById('whodidit-result-text').textContent = 'CASE CLOSED';
      document.getElementById('whodidit-result-sub').textContent =
        `${culprit.name} took ${stolen}. Solved in ${Math.round(spent)}s with ${found} of 4 rooms searched.`;
    } else {
      document.getElementById('whodidit-result-text').textContent = 'WRONG CALL';
      document.getElementById('whodidit-result-sub').textContent =
        `It was ${culprit.name}. They took ${stolen} from ${truth.scene.name}.`;
    }
    document.getElementById('whodidit-play').classList.add('hidden');
    document.getElementById('whodidit-result').classList.remove('hidden');
  }

  function timeUp(){
    solved = 'timeout';
    running = false;
    Sfx.play('lose');
    document.getElementById('whodidit-result-text').textContent = 'OUT OF TIME';
    document.getElementById('whodidit-result-sub').textContent =
      `It was ${culprit.name}, and they took ${stolen}.`;
    document.getElementById('whodidit-play').classList.add('hidden');
    document.getElementById('whodidit-result').classList.remove('hidden');
  }

  /* ---- rendering ------------------------------------------------------ */

  // The board is a canvas so it sits alongside the other cabinets, but the
  // interaction is buttons — a point-and-click needs real hit targets, and
  // faking them on a canvas would just be worse buttons.
  function render(){
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#141020');
    g.addColorStop(1, '#08060e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ffc857';
    ctx.textAlign = 'center';
    ctx.fillText(`SOMETHING IS MISSING: ${stolen.toUpperCase()}`, W/2, 34);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = timeLeft < 30 ? '#ff5454' : 'rgba(232,236,241,0.7)';
    ctx.fillText(`${Math.max(0, Math.ceil(timeLeft))}s remaining`, W/2, 56);

    // Two columns, because five full statements down one of them runs off the
    // bottom of the board. Evidence left, what people said right.
    const COL_W = (W - 90) / 2;
    const LEFT = 30, RIGHT = LEFT + COL_W + 30, TOP = 92, LH = 14;
    ctx.textAlign = 'left';

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#7dd3ff';
    ctx.fillText('EVIDENCE', LEFT, TOP);
    ctx.fillStyle = '#c084fc';
    ctx.fillText('STATEMENTS', RIGHT, TOP);

    ctx.font = '11px "JetBrains Mono", monospace';
    let y = TOP + 20;
    let any = false;
    ROOMS.forEach(r => {
      if(!searched[r.id]) return;
      ctx.fillStyle = 'rgba(232,236,241,0.5)';
      ctx.fillText(r.name.toUpperCase(), LEFT, y);
      y += LH;
      clues[r.id].forEach(c => {
        any = true;
        ctx.fillStyle = c.key ? 'rgba(232,236,241,0.92)' : 'rgba(232,236,241,0.38)';
        y = wrap(c.text, LEFT + 10, y, COL_W - 10, LH) + 4;
      });
      y += 4;
    });
    if(!any){
      ctx.fillStyle = 'rgba(232,236,241,0.35)';
      wrap('Nothing yet. Search a room.', LEFT, y, COL_W, LH);
    }

    // Five suspects saying four things each is 25 lines, so this column runs
    // a size down and a little tighter to land inside the board.
    const SLH = 13;
    y = TOP + 18;
    let anyone = false;
    SUSPECTS.forEach(sp => {
      if(!questioned[sp.id]) return;
      anyone = true;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillStyle = sp.colour;
      ctx.fillText(sp.name.toUpperCase(), RIGHT, y);
      y += SLH;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(232,236,241,0.8)';
      testimony[sp.id].forEach(line => {
        y = wrap('“' + line + '”', RIGHT + 10, y, COL_W - 10, SLH);
      });
      y += 5;
    });
    ctx.font = '11px "JetBrains Mono", monospace';
    if(!anyone){
      ctx.fillStyle = 'rgba(232,236,241,0.35)';
      wrap('Nobody has said anything. Ask them.', RIGHT, y, COL_W, LH);
    }

    if(messageTimer > 0){
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5454';
      ctx.fillText(message, W/2, H - 16);
    }
    ctx.restore();

    renderControls();
  }

  // Draws wrapped text and hands back the y the next line should start at, so
  // callers never have to measure the same string twice to know how tall it was.
  function wrap(text, x, y, maxW, lh){
    const words = text.split(' ');
    let line = '', yy = y;
    words.forEach(word => {
      const test = line ? line + ' ' + word : word;
      if(ctx.measureText(test).width > maxW && line){
        ctx.fillText(line, x, yy);
        line = word; yy += lh;
      } else line = test;
    });
    if(line){ ctx.fillText(line, x, yy); yy += lh; }
    return yy;
  }

  function renderControls(){
    const box = document.getElementById('whodidit-controls');
    if(!box) return;
    if(accusing){
      box.innerHTML = `
        <div class="wdi-label">Who did it?</div>
        <div class="wdi-row">
          ${SUSPECTS.map(sp => `
            <button class="wdi-btn wdi-accuse" style="--c:${sp.colour}"
                    onclick="WhoDidItGame.accuse('${sp.id}')">
              ${sp.icon} ${sp.name}
            </button>`).join('')}
        </div>
        <button class="btn btn-ghost" onclick="WhoDidItGame.cancelAccuse()">Not yet</button>`;
      return;
    }
    box.innerHTML = `
      <div class="wdi-label">Search a room &middot; ${SEARCH_COST}s each</div>
      <div class="wdi-row">
        ${ROOMS.map(r => `
          <button class="wdi-btn ${searched[r.id] ? 'done' : ''}"
                  onclick="WhoDidItGame.searchRoom('${r.id}')">
            ${r.icon} ${r.name}
          </button>`).join('')}
      </div>
      <div class="wdi-label">Question a suspect &middot; ${TALK_COST}s each</div>
      <div class="wdi-row">
        ${SUSPECTS.map(sp => `
          <button class="wdi-btn ${questioned[sp.id] ? 'done' : ''}" style="--c:${sp.colour}"
                  onclick="WhoDidItGame.question('${sp.id}')">
            ${sp.icon} ${sp.name}
          </button>`).join('')}
      </div>
      <button class="btn btn-primary" onclick="WhoDidItGame.beginAccuse()">Name the culprit</button>`;
  }

  function update(){
    frame++;
    timeLeft -= 1/60;
    if(messageTimer > 0) messageTimer--;
    if(timeLeft <= 0){ timeUp(); return; }
  }

  function loop(){
    if(!running) return;
    if(!paused){
      update();
      if(frame % 30 === 0 && running) render();
    }
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('whodidit-setup').classList.add('hidden');
    document.getElementById('whodidit-result').classList.add('hidden');
    document.getElementById('whodidit-play').classList.remove('hidden');
    generateCase();
    timeLeft = ROUND_SECONDS;
    frame = 0;
    message = ''; messageTimer = 0;
    paused = false; running = true;
    render();
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running = false; paused = false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    stop();
    document.getElementById('whodidit-setup').classList.remove('hidden');
    document.getElementById('whodidit-play').classList.add('hidden');
    document.getElementById('whodidit-result').classList.add('hidden');
  }
  function onKeyPress(){}
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  // The case file as text — exactly what's painted on the board, nothing the
  // player hasn't turned up yet. It's what makes the notebook readable to
  // anything that isn't an eye looking at a canvas.
  function caseNotes(){
    if(!clues) return null;
    return {
      stolen,
      timeLeft: Math.max(0, Math.round(timeLeft)),
      evidence: ROOMS.filter(r => searched[r.id])
                     .map(r => ({ room: r.name, found: clues[r.id].map(c => c.text) })),
      statements: SUSPECTS.filter(sp => questioned[sp.id])
                          .map(sp => ({ who: sp.name, said: testimony[sp.id].slice() }))
    };
  }

  return { start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning,
           searchRoom, question, beginAccuse, cancelAccuse, accuse, caseNotes };
})();
