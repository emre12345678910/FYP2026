// admin.js — entry controller for the Admin panel (admin.html).
// Gates on login; only admins may enter. Coaches/students are redirected.
import { resolveBackend, pullState, startSync, isShared } from './store.js?v=19';
import {
  ensureSeedAdmin, currentUser, renderLogin, renderAdminPanel, bindAccountChip,
} from './login.js?v=19';

const root = document.getElementById('app');
let AUTH = null;

function showLogin() {
  AUTH = null;
  renderLogin(root, (user) => { AUTH = user; afterLogin(); });
}

function notAdminScreen(user) {
  const dest = user.role === 'student' ? 'index.html' : 'dashboard.html';
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-brand"><span class="logo">🥊</span><h1>Eastside FC</h1></div>
    <p class="auth-sub">Admin area</p>
    <p class="muted">Your account (${user.role}) doesn't have admin access.</p>
    <a class="primary auth-btn" href="${dest}">Go to my app →</a>
    <button class="ghost" id="logout-btn" style="margin-top:10px">Sign out</button>
  </div></div>`;
  bindAccountChip(root, showLogin);
}

function afterLogin() {
  if (!AUTH || AUTH.role !== 'admin') { notAdminScreen(AUTH); return; }
  renderAdminPanel(root, AUTH, showLogin);
  if (isShared()) startSync(() => { if (AUTH && AUTH.role === 'admin') renderAdminPanel(root, AUTH, showLogin); });
}

async function boot() {
  try {
    await resolveBackend();
    if (isShared()) { try { await pullState(); } catch (e) { /* offline */ } }
  } catch (e) { /* local cache */ }

  await ensureSeedAdmin();

  const user = currentUser();
  if (!user) { showLogin(); return; }
  AUTH = user;
  afterLogin();
}
boot();
