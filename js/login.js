// login.js — login screen, role routing, and the Admin panel.
// Shared by both entry apps (input2.js and dashboard2.js). PROTOTYPE / UI-level
// access control — see the security note at the top of auth.js.
import {
  ensureSeedAdmin, login, logout, currentUser, getUsers, createAccount,
  setPassword, deleteAccount, linkStudentToAthlete, setCoachGrants, grantsForCoach,
  DEFAULT_ADMIN,
} from './auth.js?v=19';
import { getAthletes } from './store.js?v=19';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------ Login gate ------------------------------ */
// Renders the login screen into `root`. Calls onLogin(user) after success.
export function renderLogin(root, onLogin) {
  root.innerHTML = `
    <div class="auth-wrap">
      <form class="auth-card" id="login-form">
        <div class="auth-brand"><span class="logo">🥊</span><h1>Eastside FC</h1></div>
        <p class="auth-sub">Sign in to continue</p>
        <label class="auth-label">Username
          <input type="text" id="login-user" autocomplete="username" autofocus required>
        </label>
        <label class="auth-label">Password
          <input type="password" id="login-pass" autocomplete="current-password" required>
        </label>
        <p class="auth-error" id="login-error" hidden></p>
        <button type="submit" class="primary auth-btn">Sign in</button>
        <p class="auth-hint muted small">First time? Default admin — username <strong>${esc(DEFAULT_ADMIN.username)}</strong>, password <strong>${esc(DEFAULT_ADMIN.password)}</strong> (change it after signing in).</p>
        <p class="auth-note muted small">⚠️ Prototype login: access is enforced in the browser only, not cryptographically secure.</p>
      </form>
    </div>`;
  const form = root.querySelector('#login-form');
  const errEl = root.querySelector('#login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const res = await login(root.querySelector('#login-user').value, root.querySelector('#login-pass').value);
    if (!res.ok) { errEl.textContent = res.error; errEl.hidden = false; return; }
    onLogin(res.user);
  });
}

// Top-bar account chip + logout, reused by both apps once signed in.
export function accountChip(user) {
  const roleLabel = { admin: '🛠 Admin', coach: '🧑‍🏫 Coach', student: '🥊 Athlete' }[user.role] || user.role;
  return `
    <div class="account-chip">
      <span class="acct-name">${esc(user.name || user.username)}</span>
      <span class="acct-role">${roleLabel}</span>
      <button class="ghost" id="logout-btn" title="Sign out">Sign out</button>
    </div>`;
}

export function bindAccountChip(root, onLogout) {
  const b = root.querySelector('#logout-btn');
  if (b) b.addEventListener('click', () => { logout(); onLogout(); });
}

/* ------------------------------ Admin panel ----------------------------- */
// Full admin UI: list accounts, create accounts, link students↔athletes, and
// grant coaches access to specific athletes.
export function renderAdminPanel(root, user, onLogout) {
  const users = getUsers();
  const athletes = getAthletes().filter((a) => !a._demo);
  const athleteName = (id) => { const a = athletes.find((x) => x.id === id); return a ? a.name : (id || '—'); };

  const coaches = users.filter((u) => u.role === 'coach');
  const students = users.filter((u) => u.role === 'student');

  const userRows = users.map((u) => `
    <tr>
      <td>${esc(u.name || '')}</td>
      <td>${esc(u.username)}</td>
      <td><span class="pill">${esc(u.role)}</span></td>
      <td>${u.role === 'student' ? esc(athleteName(u.athleteId)) : u.role === 'coach' ? `${grantsForCoach(u.id).length} athlete(s)` : '—'}</td>
      <td>
        <button class="link-del" data-reset="${u.id}">reset pw</button>
        ${u.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1 ? '' : `· <button class="link-del" data-del="${u.id}">delete</button>`}
      </td>
    </tr>`).join('');

  const athleteOptions = athletes.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  // Coach access-grant editors (checkbox list of athletes per coach)
  const grantEditors = coaches.length ? coaches.map((c) => {
    const granted = new Set(grantsForCoach(c.id));
    const boxes = athletes.length ? athletes.map((a) =>
      `<label class="grant-box"><input type="checkbox" data-grant-coach="${c.id}" value="${a.id}" ${granted.has(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')
      : '<span class="muted">No athletes exist yet.</span>';
    return `
      <div class="grant-card">
        <div class="grant-head"><strong>${esc(c.name || c.username)}</strong> <span class="muted small">(${esc(c.username)})</span></div>
        <div class="grant-boxes">${boxes}</div>
      </div>`;
  }).join('') : '<p class="muted">No coach accounts yet.</p>';

  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="logo">🥊</span><div><h1>Eastside FC</h1><p>Admin · accounts &amp; access</p></div></div>
      <div class="data-actions">
        <a class="ghost" href="index.html" title="Athlete input app">✍️ Input</a>
        <a class="ghost" href="dashboard.html" title="Coach dashboard">📊 Dashboard</a>
        ${accountChip(user)}
      </div>
    </header>
    <main>
      <section class="panel">
        <div class="sync-note">⚠️ <strong>Prototype access control.</strong> This gates the UI and scopes what each role sees, but it is enforced in the browser only. For real security, enable Firebase Authentication + Firestore Security Rules (see README).</div>
      </section>

      <section class="panel">
        <h2>➕ Create account</h2>
        <form id="create-form" class="form-grid">
          <label>Name<input type="text" name="name" placeholder="Full name"></label>
          <label>Username<input type="text" name="username" required placeholder="login id"></label>
          <label>Password<input type="text" name="password" required placeholder="min 4 characters"></label>
          <label>Role
            <select name="role" id="role-select">
              <option value="student">Student (athlete)</option>
              <option value="coach">Coach</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label id="link-athlete-wrap">Link to athlete
            <select name="athleteId">
              <option value="">— none yet —</option>
              ${athleteOptions}
            </select>
          </label>
          <div class="form-actions">
            <button type="submit" class="primary">Create account</button>
            <span id="create-msg" class="save-msg"></span>
          </div>
        </form>
        <p class="muted small">Tip: create athlete records first in the Input app, then link a Student account to one here.</p>
      </section>

      <section class="panel">
        <h2>🔑 Coach access grants <span class="muted small">· which athletes each coach can see</span></h2>
        <div class="grant-grid">${grantEditors}</div>
      </section>

      <section class="panel">
        <h2>👥 Accounts <span class="muted small">· ${users.length}</span></h2>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Linked / access</th><th></th></tr></thead>
          <tbody>${userRows || '<tr><td colspan="5" class="muted">No accounts</td></tr>'}</tbody>
        </table></div>
      </section>
    </main>`;

  bindAccountChip(root, onLogout);

  // Show/hide the "link to athlete" field based on role.
  const roleSel = root.querySelector('#role-select');
  const linkWrap = root.querySelector('#link-athlete-wrap');
  const syncLinkVisibility = () => { linkWrap.style.display = roleSel.value === 'student' ? '' : 'none'; };
  roleSel.addEventListener('change', syncLinkVisibility); syncLinkVisibility();

  // Create account
  root.querySelector('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await createAccount({
      name: f.get('name'), username: f.get('username'), password: f.get('password'),
      role: f.get('role'), athleteId: f.get('athleteId') || null,
    });
    const msg = root.querySelector('#create-msg');
    if (!res.ok) { msg.textContent = '✖ ' + res.error; msg.classList.add('show'); return; }
    renderAdminPanel(root, user, onLogout); // refresh
  });

  // Reset password / delete account
  root.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const pw = prompt('New password (min 4 chars):', '');
    if (pw == null) return;
    const res = await setPassword(b.dataset.reset, pw);
    alert(res.ok ? 'Password updated.' : res.error);
  }));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Delete this account? This cannot be undone.')) return;
    const res = deleteAccount(b.dataset.del);
    if (!res.ok) { alert(res.error); return; }
    renderAdminPanel(root, user, onLogout);
  }));

  // Link student → athlete (change via the Accounts table would need a picker;
  // simplest: re-link from a prompt when clicking the linked cell is overkill —
  // instead relinking is done by recreating or via the create form). We also
  // allow quick relink through the grant checkboxes for coaches below.

  // Coach grants (checkbox toggles persist immediately)
  root.querySelectorAll('[data-grant-coach]').forEach((cb) => cb.addEventListener('change', () => {
    const coachId = cb.dataset.grantCoach;
    const checked = [...root.querySelectorAll(`[data-grant-coach="${coachId}"]`)]
      .filter((x) => x.checked).map((x) => x.value);
    setCoachGrants(coachId, checked);
  }));
}

/* --------------------------- Student relink note ------------------------ */
// Re-link a student account to a different athlete (used from admin table).
export function promptRelinkStudent(userId) {
  const athletes = getAthletes().filter((a) => !a._demo);
  const list = athletes.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
  const pick = prompt(`Link student to which athlete?\n${list}\n\nEnter number (blank = unlink):`, '');
  if (pick == null) return;
  const idx = parseInt(pick, 10) - 1;
  linkStudentToAthlete(userId, athletes[idx] ? athletes[idx].id : null);
}

export { ensureSeedAdmin, currentUser };
