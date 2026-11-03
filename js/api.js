// api.js — swappable backend adapter.
// ---------------------------------------------------------------------------
// This is the ONE place you change to switch where data is stored.
//
//   BACKEND = 'local'    → browser localStorage only (no sharing; offline demo)
//   BACKEND = 'server'   → the bundled Node server (server/server.js) over your
//                          local network. Shared across devices on that network.
//   BACKEND = 'firebase' → placeholder for later (see FIREBASE section below).
//
// The rest of the app (store.js, input.js, dashboard.js) does NOT need to change
// when you switch backends — only the variables in this file.
// ---------------------------------------------------------------------------

export const CONFIG = {
  // ↓↓↓ CHANGE THIS to switch backend ↓↓↓
  //   'local'    — browser-only (what GitHub Pages uses; safe default)
  //   'server'   — the bundled Node server over your local network
  //   'firebase' — later (not yet implemented)
  // TIP: the committed default is 'local' so the public GitHub Pages site keeps
  // working. When you run `node server/server.js` and open the site THROUGH it,
  // set this to 'server' (or leave 'auto' below to detect automatically).
  BACKEND: 'auto',

  // --- 'server' settings (local-network prototype) ---
  // Leave blank to use the same host that served the page (recommended: just
  // open the site via the Node server and this "just works"). Or hard-code your
  // machine's LAN address, e.g. 'http://192.168.1.42:8080'.
  SERVER_URL: '',

  // How often (ms) the dashboard/input pages pull shared data from the server.
  POLL_MS: 4000,

  // --- 'firebase' settings (fill in later) ---
  // When you move to Firebase, set BACKEND:'firebase' and paste your config
  // here, then implement the FIREBASE section at the bottom of this file.
  FIREBASE: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    // ...
  },
};

// All app data lives under these keys. The server stores exactly this shape.
export const KEYS = {
  athletes: 'eastside_fc_athletes_v1',
  checkins: 'eastside_fc_checkins_v1',
  mental: 'eastside_fc_mental_v1',
  overrides: 'eastside_fc_overrides_v1',
  hydration: 'eastside_fc_hydration_v1',
};

function serverBase() {
  return (CONFIG.SERVER_URL || '').replace(/\/$/, '') || '';
}

// The backend actually in use. 'auto' resolves to 'server' once the Node API
// answers, otherwise 'local'. Resolved lazily by resolveBackend().
let _resolved = CONFIG.BACKEND === 'auto' ? null : CONFIG.BACKEND;

export function activeBackend() {
  return _resolved || (CONFIG.BACKEND === 'auto' ? 'local' : CONFIG.BACKEND);
}

// Returns true when a shared backend (not plain localStorage) is active.
export function isShared() {
  return activeBackend() === 'server' || activeBackend() === 'firebase';
}

// For 'auto': probe the server once. If reachable, use 'server'; else 'local'.
export async function resolveBackend() {
  if (_resolved) return _resolved;
  if (CONFIG.BACKEND !== 'auto') { _resolved = CONFIG.BACKEND; return _resolved; }
  try {
    const res = await fetch(serverBase() + '/api/state', { cache: 'no-store' });
    _resolved = res.ok ? 'server' : 'local';
  } catch { _resolved = 'local'; }
  return _resolved;
}

/* =========================================================================
 * SERVER backend (local-network prototype)
 * The Node server exposes:
 *   GET  /api/state           → { [key]: value, ... }
 *   PUT  /api/state/:key      → body is the raw JSON value for that key
 * ======================================================================= */

// Pulls the whole shared state and writes it into localStorage so the existing
// synchronous store.js keeps working. Returns true if anything changed.
export async function pullState() {
  const backend = activeBackend();
  if (backend === 'server') {
    const res = await fetch(serverBase() + '/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('server ' + res.status);
    const state = await res.json();
    let changed = false;
    for (const key of Object.values(KEYS)) {
      const incoming = JSON.stringify(state[key] ?? (key === KEYS.overrides || key === KEYS.hydration ? {} : []));
      if (localStorage.getItem(key) !== incoming) { localStorage.setItem(key, incoming); changed = true; }
    }
    return changed;
  }
  if (backend === 'firebase') return pullStateFirebase();
  return false; // 'local'
}

// Pushes one key's current localStorage value up to the shared backend.
export async function pushKey(key) {
  const backend = activeBackend();
  if (backend === 'local') return;
  const value = localStorage.getItem(key);
  if (value == null) return;
  if (backend === 'server') {
    await fetch(serverBase() + '/api/state/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: value, // already JSON text
    });
    return;
  }
  if (backend === 'firebase') return pushKeyFirebase(key, value);
}

// Pushes every key (used after a bulk import).
export async function pushAll() {
  for (const key of Object.values(KEYS)) await pushKey(key);
}

// Starts periodic polling; calls onChange() whenever shared data changed.
let _timer = null;
export function startSync(onChange) {
  if (!isShared()) return () => {}; // resolveBackend() must run before this
  const tick = async () => {
    try { if (await pullState()) onChange && onChange(); }
    catch (e) { /* offline / server down — keep using local cache */ }
  };
  tick();
  _timer = setInterval(tick, CONFIG.POLL_MS);
  return () => { if (_timer) clearInterval(_timer); _timer = null; };
}

/* =========================================================================
 * FIREBASE backend — implement later.
 * To migrate:
 *   1. Set CONFIG.BACKEND = 'firebase' and fill CONFIG.FIREBASE above.
 *   2. Add the Firebase SDK (e.g. a <script type="module"> import) and
 *      implement the two functions below to read/write a single document per
 *      key (or a collection). The rest of the app is unchanged.
 * ======================================================================= */
async function pullStateFirebase() {
  // e.g. read docs for each KEYS value from Firestore, write into localStorage,
  // return whether anything changed. Left unimplemented on purpose.
  throw new Error('Firebase backend not implemented yet — see js/api.js');
}
async function pushKeyFirebase(_key, _value) {
  throw new Error('Firebase backend not implemented yet — see js/api.js');
}
