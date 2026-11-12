// auth.js — PROTOTYPE login + role-based access control (Path A: UI-level).
// ---------------------------------------------------------------------------
// ⚠️ SECURITY NOTE (read me):
// This is a CLIENT-SIDE access-control layer for a static app. It gates the UI
// and scopes what each role sees, and it hashes passwords (SHA-256 + per-user
// salt) so plaintext isn't stored. BUT because everything runs in the browser
// and all data lives in one shared store, a technically skilled user could
// bypass these checks via the dev console. For REAL enforcement you must add
// Firebase Authentication + Firestore Security Rules (server-side) — see
// README "Upgrading to enforced security". Use this for prototype/demo only.
// ---------------------------------------------------------------------------
//
// Roles:
//   'admin'   — creates accounts, links a student account to an athlete record,
//               and grants coaches access to specific students. Sees everything.
//   'coach'   — sees ONLY the athletes an admin granted them.
//   'student' — sees/edits ONLY their own linked athlete.
//
// Data (synced via api.js like everything else), stored under USERS_KEY:
//   {
//     users:  [ { id, username, role, name, salt, hash, athleteId?, createdAt } ],
//     grants: { [coachUserId]: [athleteId, ...] }   // coach → athletes access
//   }
// Session (this device only) stored under SESSION_KEY: { userId }.

import { pushKey, isShared } from './api.js?v=19';

export const USERS_KEY = 'eastside_fc_users_v1';
const SESSION_KEY = 'eastside_fc_session_v1';

// First-run seed: a single admin so the system is usable immediately.
// The admin is expected to change this password (Admin panel › Change password).
export const DEFAULT_ADMIN = { username: 'admin', password: 'admin123' };

/* ----------------------------- store helpers ---------------------------- */
function readStore() {
  const raw = localStorage.getItem(USERS_KEY);
  if (raw) { try { return normalize(JSON.parse(raw)); } catch { /* fall through */ } }
  return { users: [], grants: {} };
}
function normalize(s) {
  return { users: Array.isArray(s.users) ? s.users : [], grants: s.grants && typeof s.grants === 'object' ? s.grants : {} };
}
function writeStore(store) {
  localStorage.setItem(USERS_KEY, JSON.stringify(store));
  if (isShared()) pushKey(USERS_KEY).catch(() => {});
}

/* ----------------------------- password hash ---------------------------- */
// SHA-256(salt + password) via Web Crypto. Not bcrypt, but keeps plaintext out
// of storage — adequate for a prototype. (Real apps: use Firebase Auth.)
function randomSalt() {
  const a = new Uint8Array(16);
  (globalThis.crypto || window.crypto).getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + ':' + password);
  const buf = await (globalThis.crypto || window.crypto).subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------ bootstrap ------------------------------- */
// Ensures at least one admin exists. Safe to call repeatedly.
export async function ensureSeedAdmin() {
  const store = readStore();
  if (store.users.some((u) => u.role === 'admin')) return;
  // Don't clobber if other devices may still be syncing in users; only seed
  // when there are genuinely no users at all.
  if (store.users.length > 0) return;
  const salt = randomSalt();
  const hash = await hashPassword(DEFAULT_ADMIN.password, salt);
  store.users.push({
    id: 'u_admin_' + Date.now(),
    username: DEFAULT_ADMIN.username,
    role: 'admin',
    name: 'Administrator',
    salt, hash,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  });
  writeStore(store);
}

/* ------------------------------- queries -------------------------------- */
export function getUsers() { return readStore().users; }
export function getGrants() { return readStore().grants; }
export function userById(id) { return readStore().users.find((u) => u.id === id) || null; }
export function userByUsername(name) {
  const n = String(name || '').trim().toLowerCase();
  return readStore().users.find((u) => u.username.toLowerCase() === n) || null;
}

/* ------------------------------- session -------------------------------- */
export function currentUser() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!s || !s.userId) return null;
    return userById(s.userId);
  } catch { return null; }
}
export function isLoggedIn() { return !!currentUser(); }
export function logout() { localStorage.removeItem(SESSION_KEY); }

// Attempts a login. Returns { ok, user } or { ok:false, error }.
export async function login(username, password) {
  const u = userByUsername(username);
  if (!u) return { ok: false, error: 'No account with that username.' };
  const hash = await hashPassword(password, u.salt);
  if (hash !== u.hash) return { ok: false, error: 'Incorrect password.' };
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: u.id }));
  return { ok: true, user: u };
}

/* --------------------------- admin operations --------------------------- */
// Create an account. `role` ∈ {'coach','student','admin'}. For students you may
// pass athleteId to link them to an athlete record. Returns { ok, user|error }.
export async function createAccount({ username, password, role, name, athleteId }) {
  const uname = String(username || '').trim();
  if (!uname) return { ok: false, error: 'Username is required.' };
  if (userByUsername(uname)) return { ok: false, error: 'That username is already taken.' };
  if (!password || String(password).length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };
  if (!['admin', 'coach', 'student'].includes(role)) return { ok: false, error: 'Invalid role.' };
  const store = readStore();
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const user = {
    id: 'u_' + Date.now() + Math.floor(Math.random() * 10000),
    username: uname, role, name: (name || uname).trim(),
    salt, hash,
    athleteId: role === 'student' ? (athleteId || null) : null,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  writeStore(store);
  return { ok: true, user };
}

export async function setPassword(userId, password) {
  if (!password || String(password).length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };
  const store = readStore();
  const u = store.users.find((x) => x.id === userId);
  if (!u) return { ok: false, error: 'User not found.' };
  u.salt = randomSalt();
  u.hash = await hashPassword(password, u.salt);
  delete u.mustChangePassword;
  writeStore(store);
  return { ok: true };
}

export function deleteAccount(userId) {
  const store = readStore();
  const u = store.users.find((x) => x.id === userId);
  if (!u) return { ok: false, error: 'User not found.' };
  if (u.role === 'admin' && store.users.filter((x) => x.role === 'admin').length <= 1) {
    return { ok: false, error: 'Cannot delete the only admin account.' };
  }
  store.users = store.users.filter((x) => x.id !== userId);
  delete store.grants[userId];
  writeStore(store);
  return { ok: true };
}

// Link / unlink a student account to an athlete record.
export function linkStudentToAthlete(userId, athleteId) {
  const store = readStore();
  const u = store.users.find((x) => x.id === userId);
  if (!u || u.role !== 'student') return { ok: false, error: 'Not a student account.' };
  u.athleteId = athleteId || null;
  writeStore(store);
  return { ok: true };
}

// Set the full list of athleteIds a coach may access.
export function setCoachGrants(coachUserId, athleteIds) {
  const store = readStore();
  const u = store.users.find((x) => x.id === coachUserId);
  if (!u || u.role !== 'coach') return { ok: false, error: 'Not a coach account.' };
  store.grants[coachUserId] = [...new Set(athleteIds || [])];
  writeStore(store);
  return { ok: true };
}

export function grantsForCoach(coachUserId) {
  return readStore().grants[coachUserId] || [];
}

/* ----------------------- access-scope resolution ------------------------ */
// Which athleteIds may the given user see? admin → all (null = "no filter",
// callers treat null as all); coach → granted ids; student → their own id.
export function visibleAthleteIds(user) {
  if (!user) return [];
  if (user.role === 'admin') return null;            // null = unrestricted
  if (user.role === 'coach') return grantsForCoach(user.id);
  if (user.role === 'student') return user.athleteId ? [user.athleteId] : [];
  return [];
}

// Can `user` see this athleteId?
export function canSeeAthlete(user, athleteId) {
  const ids = visibleAthleteIds(user);
  if (ids === null) return true;                     // admin
  return ids.includes(athleteId);
}
