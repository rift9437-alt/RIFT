/* =========================================================
   CONFIG — where the backend lives
   =========================================================
   The site is static (GitHub Pages) and the API is a separate service
   (Render). Those are different origins in production but the same one when
   you run `SERVE_STATIC=1 npm start` locally, so the origin is worked out at
   load time rather than hard-coded twice.

   To point the site at a different backend, change API_ORIGIN below — it's
   the only place the backend URL appears. */
const API_ORIGIN = (function(){
  // An explicit override wins over everything, so you can point a local page
  // at a deployed backend (or the reverse) without editing this file:
  //   ?api=https://rift-1-edfr.onrender.com   — sticks for the session
  //   ?api=  (empty)                          — clears it again
  try{
    const param = new URLSearchParams(location.search).get('api');
    if(param !== null){
      if(param) localStorage.setItem('l7ApiOrigin', param.replace(/\/+$/, ''));
      else localStorage.removeItem('l7ApiOrigin');
    }
    const saved = localStorage.getItem('l7ApiOrigin');
    if(saved) return saved;
  }catch(e){ /* private mode, blocked storage — fall through to the default */ }

  const host = location.hostname;

  // Served by the API server itself — `SERVE_STATIC=1 npm start`, or someone
  // who opened the Render URL before the redirect landed. Stay same-origin so
  // there's nothing to configure and no CORS in the way.
  if(host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.onrender.com')){
    return location.origin;
  }

  // Anywhere else — GitHub Pages, a custom domain — talk to the deployed API.
  return 'https://rift-1-edfr.onrender.com';
})();

const LB_API_BASE = API_ORIGIN + '/api';

// ws:// for a local http server, wss:// for the deployed https one.
const WS_URL = API_ORIGIN.replace(/^http/, 'ws') + '/ws';
