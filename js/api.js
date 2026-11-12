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
  // ↓↓↓ Backend selection ↓↓↓
  //   'auto'     — use Firebase if FIREBASE is filled in; else the Node server
  //                if it answers; else browser-only localStorage.
  //   'firebase' — force cloud sync across ALL devices on the internet.
  //   'server'   — the bundled Node server over your local network.
  //   'local'    — browser-only (offline; needs Export/Import to move data).
  //
  // ***** TO SYNC ACROSS ALL COMPUTERS (no Export/Import needed): *****
  //   1. Create a free Firebase project → console.firebase.google.com
  //   2. Add a Web App; copy its config into FIREBASE below.
  //   3. Build → Firestore Database → Create database (start in *test mode*
  //      for a quick prototype, or paste the rules from README).
  //   That's it — every device opening the site then shares the same data live.
  BACKEND: 'auto',

  // --- 'server' settings (local-network prototype) ---
  SERVER_URL: '',
  POLL_MS: 4000,

  // --- 'firebase' settings — PASTE YOUR WEB APP CONFIG HERE ---
  // When all these are filled, the app automatically uses Firebase and syncs
  // across every device on the internet in real time. Leave blank to disable.
  FIREBASE: {
    apiKey: 'AIzaSyA3guYDEocKWmH49wqdE7wreUaPnUntI5Q',
    authDomain: 'fyp2026-d31d0.firebaseapp.com',
    projectId: 'fyp2026-d31d0',
    storageBucket: 'fyp2026-d31d0.firebasestorage.app',
    messagingSenderId: '97401221114',
    appId: '1:97401221114:web:929402d512d7197209fe43',
  },
};

// True once the Firebase config looks filled in (apiKey + projectId present).
function firebaseConfigured() {
  const f = CONFIG.FIREBASE || {};
  return !!(f.apiKey && f.projectId && f.appId);
}

// All app data lives under these keys. The server stores exactly this shape.
export const KEYS = {
  athletes: 'eastside_fc_athletes_v1',
  checkins: 'eastside_fc_checkins_v1',
  mental: 'eastside_fc_mental_v1',
  overrides: 'eastside_fc_overrides_v1',
  hydration: 'eastside_fc_hydration_v1',
  users: 'eastside_fc_users_v1',
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

// Resolve which backend to use.
//   explicit BACKEND wins; 'auto' → Firebase (if configured) → server (if it
//   answers) → local.
export async function resolveBackend() {
  if (_resolved) return _resolved;
  if (CONFIG.BACKEND === 'firebase') { _resolved = 'firebase'; await initFirebase(); return _resolved; }
  if (CONFIG.BACKEND === 'server' || CONFIG.BACKEND === 'local') { _resolved = CONFIG.BACKEND; return _resolved; }
  // auto
  if (firebaseConfigured()) {
    try { await initFirebase(); _resolved = 'firebase'; return _resolved; }
    catch (e) { console.warn('Firebase init failed, falling back:', e.message); }
  }
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
    return applyMergedState(state);
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

// Starts live sync; calls onChange() whenever shared data changed.
//   firebase → real-time onSnapshot (instant push).
//   server   → periodic polling every POLL_MS.
let _timer = null;
export function startSync(onChange) {
  if (!isShared()) return () => {}; // resolveBackend() must run before this
  if (activeBackend() === 'firebase') return startSyncFirebase(onChange);
  const tick = async () => {
    try { if (await pullState()) onChange && onChange(); }
    catch (e) { /* offline / server down — keep using local cache */ }
  };
  tick();
  _timer = setInterval(tick, CONFIG.POLL_MS);
  return () => { if (_timer) clearInterval(_timer); _timer = null; };
}

/* =========================================================================
 * FIREBASE backend — real cloud sync across ALL devices on the internet.
 * Uses Firestore. All app data is stored in ONE document:
 *     collection "eastside_fc" → document "shared"
 * with one field per KEYS entry (athletes, checkins, mental, overrides,
 * hydration). We load the Firebase SDK from the CDN on demand so there is no
 * build step; the rest of the app (store.js) is unchanged.
 * ======================================================================= */
const FB_COLLECTION = 'eastside_fc';
const FB_DOC = 'shared';
let _fb = null; // { db, doc, getDoc, setDoc, onSnapshot, ref }

async function initFirebase() {
  if (_fb) return _fb;
  if (!firebaseConfigured()) throw new Error('Firebase config is empty');
  const V = '10.12.2';
  const appMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const fsMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const app = appMod.initializeApp(CONFIG.FIREBASE);
  const db = fsMod.getFirestore(app);
  const ref = fsMod.doc(db, FB_COLLECTION, FB_DOC);
  _fb = { db, ref, getDoc: fsMod.getDoc, setDoc: fsMod.setDoc, updateDoc: fsMod.updateDoc, onSnapshot: fsMod.onSnapshot };
  return _fb;
}

// Merge helpers so two devices don't overwrite each other. Record arrays
// (athletes/checkins/mental) merge by `id` (union); object maps
// (overrides/hydration) merge by key. Cloud values win on conflict.
function mergeById(localArr, cloudArr) {
  const byId = new Map();
  for (const r of (localArr || [])) if (r && r.id != null) byId.set(r.id, r);
  for (const r of (cloudArr || [])) if (r && r.id != null) byId.set(r.id, r); // cloud overrides
  return [...byId.values()];
}
function mergeMap(localObj, cloudObj) { return { ...(localObj || {}), ...(cloudObj || {}) }; }

// The users store is { users:[...], grants:{...} }. Merge accounts by id (cloud
// wins on conflict) and grants per coach key, so neither device clobbers the
// other's new accounts/grants.
function mergeUsers(localU, cloudU) {
  const l = localU && typeof localU === 'object' ? localU : { users: [], grants: {} };
  const c = cloudU && typeof cloudU === 'object' ? cloudU : { users: [], grants: {} };
  return {
    users: mergeById(l.users || [], c.users || []),
    grants: { ...(l.grants || {}), ...(c.grants || {}) },
  };
}
function readLocal(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// Writes a shared-state object's fields into localStorage, MERGING with
// whatever is already local so nothing is lost. Used by both backends.
// Returns true if anything changed.
function applyMergedState(data) {
  data = data || {};
  let changed = false;
  const arrayKeys = [KEYS.athletes, KEYS.checkins, KEYS.mental];
  const mapKeys = [KEYS.overrides, KEYS.hydration];
  for (const key of arrayKeys) {
    const merged = mergeById(readLocal(key, []), data[key] || []);
    const text = JSON.stringify(merged);
    if (localStorage.getItem(key) !== text) { localStorage.setItem(key, text); changed = true; }
  }
  for (const key of mapKeys) {
    const merged = mergeMap(readLocal(key, {}), data[key] || {});
    const text = JSON.stringify(merged);
    if (localStorage.getItem(key) !== text) { localStorage.setItem(key, text); changed = true; }
  }
  // Users store merges accounts-by-id + grants-per-coach.
  {
    const merged = mergeUsers(readLocal(KEYS.users, { users: [], grants: {} }), data[KEYS.users] || {});
    const text = JSON.stringify(merged);
    if (localStorage.getItem(KEYS.users) !== text) { localStorage.setItem(KEYS.users, text); changed = true; }
  }
  return changed;
}

async function pullStateFirebase() {
  const fb = await initFirebase();
  const snap = await fb.getDoc(fb.ref);
  return applyMergedState(snap.exists() ? snap.data() : {});
}

// Pushes one key up. For record arrays/maps we first read the current cloud
// value and MERGE, so a device that hasn't fully synced can't wipe records
// another device added.
async function pushKeyFirebase(key, value) {
  const fb = await initFirebase();
  let parsed;
  try { parsed = JSON.parse(value); } catch { parsed = value; }
  const arrayKeys = [KEYS.athletes, KEYS.checkins, KEYS.mental];
  const mapKeys = [KEYS.overrides, KEYS.hydration];
  if (key === KEYS.users) {
    try {
      const snap = await fb.getDoc(fb.ref);
      const cloud = snap.exists() ? snap.data()[key] : undefined;
      parsed = mergeUsers(cloud, parsed);
    } catch { /* if the read fails, write local value as-is */ }
  } else if (arrayKeys.includes(key) || mapKeys.includes(key)) {
    try {
      const snap = await fb.getDoc(fb.ref);
      const cloud = snap.exists() ? snap.data()[key] : undefined;
      if (arrayKeys.includes(key)) parsed = mergeById(cloud || [], parsed || []);
      else parsed = mergeMap(cloud || {}, parsed || {});
    } catch { /* if the read fails, write local value as-is */ }
  }
  await fb.setDoc(fb.ref, { [key]: parsed, _updatedAt: Date.now() }, { merge: true });
}

// Real-time listener: pushes changes to every device instantly.
function startSyncFirebase(onChange) {
  let stop = () => {};
  initFirebase().then((fb) => {
    stop = fb.onSnapshot(fb.ref, (snap) => {
      const changed = applyMergedState(snap.exists() ? snap.data() : {});
      if (changed && onChange) onChange();
    }, (err) => console.warn('Firebase onSnapshot error:', err && err.message));
  }).catch((e) => console.warn('Firebase sync not started:', e.message));
  return () => stop();
}
