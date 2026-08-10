/* =========================================================
   THE LEVEL 7 GAZETTE + ARCHIVE
   =========================================================
   Two halves of the same screen. The Gazette's front page is written from
   whatever actually happened in the arcade — record gaps, the newest clan,
   who's been grinding. The Archive is the building's backstory, released a
   fragment at a time as you meet each condition; a sealed entry shows only
   the hint for what opens it, which makes the archive a list of things to
   go and try. */
let gazetteCache = null;
let loreCache = null;

async function loadGazette(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/gazette`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    gazetteCache = await res.json();
  }catch(e){
    console.error('Gazette load failed:', e);
  }
  return gazetteCache;
}

async function loadLore(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/lore`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    loreCache = await res.json();
  }catch(e){
    console.error('Lore load failed:', e);
  }
  return loreCache;
}

function issueDate(iso){
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

async function openGazette(){
  showScreen('gazette-screen');
  document.getElementById('gazette-front').innerHTML =
    '<div class="clan-empty">Setting the type…</div>';
  document.getElementById('gazette-archive').innerHTML = '';
  await Promise.all([loadGazette(), loadLore()]);
  renderGazette();
}

function renderGazette(){
  const front = document.getElementById('gazette-front');
  if(front){
    const stories = (gazetteCache && gazetteCache.stories) || [];
    front.innerHTML = `
      <div class="gaz-masthead">
        <div class="gaz-title">THE LEVEL 7 GAZETTE</div>
        <div class="gaz-rule"></div>
        <div class="gaz-dateline">
          <span>No. 7</span>
          <span>${issueDate(gazetteCache && gazetteCache.issued)}</span>
          <span>Price: one token</span>
        </div>
      </div>
      ${stories.length ? stories.map(s => `
        <article class="gaz-story gaz-${s.kind}">
          <h4>${s.headline}</h4>
          <p>${s.body}</p>
        </article>`).join('')
      : '<div class="clan-empty">Slow news day. Go and set a record.</div>'}`;
  }

  const arch = document.getElementById('gazette-archive');
  if(arch){
    const entries = (loreCache && loreCache.entries) || [];
    arch.innerHTML = `
      <div class="arch-head">
        THE ARCHIVE
        <span>${(loreCache && loreCache.unlocked) || 0} / ${(loreCache && loreCache.total) || entries.length} recovered</span>
      </div>
      ${entries.map((e, i) => e.unlocked ? `
        <div class="arch-entry">
          <div class="arch-num">${String(i + 1).padStart(2, '0')}</div>
          <div>
            <h5>${e.title}</h5>
            <p>${e.body}</p>
          </div>
        </div>` : `
        <div class="arch-entry arch-sealed">
          <div class="arch-num">${String(i + 1).padStart(2, '0')}</div>
          <div>
            <h5>SEALED</h5>
            <p>${e.hint || 'Keep playing.'}</p>
          </div>
        </div>`).join('')}`;
  }
}

/* =========================================================
   TOURNAMENTS
   =========================================================
   A timed contest on one cabinet's stat. Joining records your value at that
   moment, so the table ranks improvement during the window — holding the
   record already doesn't hand you the trophy. */
let tournamentCache = null;

async function loadTournaments(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/tournaments`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    tournamentCache = (await res.json()).tournaments || [];
  }catch(e){
    console.error('Tournament load failed:', e);
  }
  return tournamentCache || [];
}

function timeLeftText(iso){
  const left = new Date(iso).getTime() - Date.now();
  if(left <= 0) return 'finished';
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  if(h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h left';
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

async function openTournaments(){
  showScreen('tournaments-screen');
  document.getElementById('tournaments-body').innerHTML =
    '<div class="clan-empty">Checking the brackets…</div>';
  await loadTournaments();
  renderTournaments();
}

function renderTournaments(){
  const box = document.getElementById('tournaments-body');
  if(!box) return;
  const list = tournamentCache || [];
  if(!list.length){
    box.innerHTML = '<div class="clan-empty">No tournaments running. Ask an admin to start one.</div>';
    return;
  }
  box.innerHTML = list.map(t => `
    <div class="trn-card ${t.settled ? 'trn-done' : ''}">
      <div class="trn-head">
        <span class="trn-title">${t.title}</span>
        <span class="trn-game">${t.gameName} · ${t.statKey}</span>
        <span class="trn-clock">${t.settled ? 'settled' : timeLeftText(t.endsAt)}</span>
        ${t.prize ? `<span class="trn-prize">🪙 ${t.prize}</span>` : ''}
        ${t.settled
          ? ''
          : t.entered
            ? '<span class="trn-in">✓ Entered</span>'
            : `<button class="btn btn-primary btn-small" onclick="joinTournament(${t.id})">Enter</button>`}
      </div>
      ${t.settled
        ? `<div class="trn-result">${t.winner
             ? `🏆 <b>${t.winner}</b> took it with +${t.winningGain}.`
             : 'Nobody improved their score. No prize awarded.'}</div>`
        : ''}
      ${t.standings.length ? `
        <table class="trn-table">
          <tr><th>#</th><th>Player</th><th>Gain</th><th>Now</th></tr>
          ${t.standings.map((s, i) => `
            <tr class="${s.user === currentUser ? 'trn-me' : ''}">
              <td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
              <td>${s.user}</td>
              <td>+${s.gain}</td>
              <td>${s.now}</td>
            </tr>`).join('')}
        </table>`
        : '<div class="trn-empty">No entrants yet.</div>'}
    </div>`).join('');
}

async function joinTournament(id){
  try{
    const res = await apiFetch(`${LB_API_BASE}/tournaments/join`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, tournamentId: id })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){ toast('Tournaments', data.error || 'Could not enter.', '🏆', 'pink'); return; }
    Sfx.play('select');
    toast('Entered', 'Your score from now on is what counts', '🏆', 'gold');
    await loadTournaments();
    renderTournaments();
  }catch(e){
    console.error('Tournament join failed:', e);
    toast('Tournaments', 'Network error — try again.', '🏆', 'pink');
  }
}
