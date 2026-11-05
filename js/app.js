// app.js — UI controller for the Eastside FC Rehab & Monitoring App
import {
  getAthletes, addAthlete, updateAthlete, deleteAthlete, saveCheckin, deleteCheckin, checkinsForAthlete, lastBodyMass,
  fluidLossPct, totalWorkload, romPct, sweatRateLph, bpCategory, sleepHoursBetween, sleepMinutesBetween, formatHoursMinutes, formatSgt, sgtDay,
  getOverride, setOverride,
  getHydrationToday, addBottle, removeBottle, DEFAULT_BOTTLE_ML,
  hydrationGoalMl, exerciseMinutesToday, hydrationMlForDay,
  exportData, importData,
  COMBAT_TYPES, BP_TIMINGS, INTENSITY_LEVELS, HIGH_INTENSITY, MACRO_TAGS, PAIN_SYMPTOMS,
} from './store.js';

// Athlete lookup helper (for ROM baseline access at render time).
function athleteById(id) { return getAthletes().find((a) => a.id === id); }

// Built-in animated avatars (CSS/emoji based — no external images needed).
const AVATARS = {
  boxer: { emoji: '🥊', label: 'Boxer', cls: 'av-boxer' },
  muaythai: { emoji: '🦵', label: 'Muay Thai', cls: 'av-muaythai' },
  champ: { emoji: '🏆', label: 'Champ', cls: 'av-champ' },
  fighterm: { emoji: '🧑‍🦱', label: 'Fighter', cls: 'av-fighterm' },
  fighterf: { emoji: '👩‍🦰', label: 'Fighter (F)', cls: 'av-fighterf' },
  fire: { emoji: '🔥', label: 'On Fire', cls: 'av-fire' },
  flex: { emoji: '💪', label: 'Flex', cls: 'av-flex' },
  medal: { emoji: '🥇', label: 'Gold', cls: 'av-medal' },
  tiger: { emoji: '🐯', label: 'Tiger', cls: 'av-tiger' },
  dragon: { emoji: '🐉', label: 'Dragon', cls: 'av-dragon' },
  belt: { emoji: '🎽', label: 'Belt', cls: 'av-belt' },
};

// Renders an athlete's avatar: an uploaded picture (data URL) if present,
// otherwise a built-in animated avatar. `size` is a CSS size class suffix.
function avatarMarkup(athlete, size = 'md') {
  if (!athlete) return '';
  if (athlete.avatarImage) {
    return `<span class="avatar avatar-${size}"><img src="${athlete.avatarImage}" alt="" class="avatar-img"></span>`;
  }
  const av = AVATARS[athlete.avatar] || AVATARS.boxer;
  return `<span class="avatar avatar-${size} ${av.cls} animated"><span class="avatar-emoji">${av.emoji}</span></span>`;
}

// Centered athlete controls (select / add / delete) for the middle of the top bar.
function athletePicker(athletes) {
  const a = athleteById(state.selectedAthlete);
  const opts = athletes.map((x) =>
    `<option value="${x.id}" ${x.id === state.selectedAthlete ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  return `
    <div class="athlete-picker-top">
      <select id="athlete-select" title="Select athlete">${opts || '<option>No athletes</option>'}</select>
      <button class="ghost" id="add-athlete" title="Add a new athlete">+ New</button>
      ${a ? `<button class="danger" id="delete-athlete" title="Delete this athlete and all their data">🗑</button>` : ''}
    </div>`;
}

// Profile chip shown at the top right of the top bar. Click opens the profile.
function profileChip(athletes) {
  const a = athleteById(state.selectedAthlete) || athletes[0];
  if (!a) return '';
  return `
    <button class="profile-chip" id="profile-chip" title="View / edit profile">
      ${avatarMarkup(a, 'sm')}
      <span class="profile-chip-name">${esc(a.name)}</span>
      <span class="profile-chip-caret">▾</span>
    </button>`;
}

// Opens the profile panel: avatar (editable) on top, stats + progression below.
function openProfile(athleteId) {
  const a = athleteById(athleteId);
  if (!a) return;
  const checkins = checkinsForAthlete(a.id);
  const latest = checkins[checkins.length - 1];
  const first = checkins[0];
  const status = effectiveTier(a, checkins);

  // Progression deltas (first -> latest) for a few key metrics.
  const prog = [];
  const pick = (label, pickFn, unit = '', better = 'up') => {
    const fv = first ? pickFn(first) : null;
    const lv = latest ? pickFn(latest) : null;
    if (fv == null || lv == null) return;
    const d = lv - fv;
    const arrow = d === 0 ? '→' : d > 0 ? '▲' : '▼';
    const good = d === 0 ? '' : ((d > 0 ? better === 'up' : better === 'down') ? 'up' : 'down');
    prog.push(`<li><span>${label}</span><span class="prog-val">${fv}${unit} → ${lv}${unit} <span class="prog-delta ${good}">${arrow} ${Math.abs(Math.round(d * 10) / 10)}${unit}</span></span></li>`);
  };
  pick('ROM %', (c) => c.rom_percentage, '%', 'up');
  pick('Pain (NPRS)', (c) => c.pain_score, '', 'down');
  pick('Body mass', (c) => c.body_mass_kg, ' kg', 'up');
  pick('Sleep', (c) => c.sleep_hours, ' h', 'up');

  const avatarChoices = Object.entries(AVATARS).map(([key, av]) =>
    `<button class="avatar-choice ${a.avatar === key && !a.avatarImage ? 'sel' : ''} ${av.cls} animated" data-avatar="${key}" title="${av.label}">
       <span class="avatar-emoji">${av.emoji}</span>
     </button>`).join('');

  const stats = [
    ['Combat', a.combatType || '—'],
    ['Gender', a.gender || '—'],
    ['Age', a.age != null ? a.age : '—'],
    ['Weight', a.currentWeight != null ? a.currentWeight + ' kg' : '—'],
    ['Baseline ROM', a.romBaseline + '°'],
    ['Check-ins', checkins.length],
    ['Status', `${status.icon} ${status.tier}`],
    ['Last check-in', latest ? formatSgt(latest.timestampUtc) : '—'],
  ].map(([k, v]) => `<div class="stat"><span class="stat-k">${k}</span><span class="stat-v">${esc(String(v))}</span></div>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal profile-modal" role="dialog" aria-label="Athlete profile">
      <div class="modal-head">
        <h2>Profile</h2>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>

      <div class="profile-top">
        ${avatarMarkup(a, 'lg')}
        <div class="profile-id">
          <div class="profile-name">${esc(a.name)}</div>
          <div class="muted small">${[a.combatType, a.gender].filter(Boolean).map(esc).join(' · ') || '—'}</div>
        </div>
      </div>

      <div class="avatar-editor">
        <span class="field-label">Profile picture</span>
        <div class="avatar-choices">
          ${avatarChoices}
          <label class="avatar-upload" title="Upload from your gallery">
            📷 Upload
            <input type="file" accept="image/*" id="avatar-upload-input" hidden>
          </label>
          ${a.avatarImage ? '<button class="avatar-remove" id="avatar-remove">Remove photo</button>' : ''}
        </div>
      </div>

      <div class="profile-stats-wrap">
        <span class="field-label">Stats</span>
        <div class="profile-stats">${stats}</div>
      </div>

      <div class="profile-prog-wrap">
        <span class="field-label">Progression <span class="muted small">(first → latest check-in)</span></span>
        <ul class="profile-prog">${prog.length ? prog.join('') : '<li class="muted">Not enough check-ins yet.</li>'}</ul>
      </div>
    </div>`;

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-close').addEventListener('click', close);

  // Pick a built-in animated avatar
  overlay.querySelectorAll('[data-avatar]').forEach((b) =>
    b.addEventListener('click', () => {
      updateAthlete(a.id, { avatar: b.dataset.avatar, avatarImage: null });
      close(); render(); openProfile(a.id);
    }));

  // Upload a picture from the gallery (downscaled to a data URL)
  const upload = overlay.querySelector('#avatar-upload-input');
  if (upload) upload.addEventListener('change', () => {
    const file = upload.files && upload.files[0];
    if (!file) return;
    downscaleImage(file, 240, (dataUrl) => {
      updateAthlete(a.id, { avatarImage: dataUrl });
      close(); render(); openProfile(a.id);
    });
  });

  const removeBtn = overlay.querySelector('#avatar-remove');
  if (removeBtn) removeBtn.addEventListener('click', () => {
    updateAthlete(a.id, { avatarImage: null });
    close(); render(); openProfile(a.id);
  });

  document.body.appendChild(overlay);
}

// Reads an image file, downscales it to a square-ish max dimension and returns
// a compressed JPEG data URL (keeps localStorage small).
function downscaleImage(file, maxDim, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// Reference table: common Muay Thai / gym injuries — how they happen and how
// to manage/prevent them. Shown in a modal from the Pain & Injury section.
const INJURY_GUIDE = [
  {
    injury: 'Head & Concussions: Dizziness, headache, confusion, nausea, light sensitivity, or temporary loss of consciousness after a blow to the head.',
    how: 'More frequent in boxing due to continuous head-target volume, and a core risk during Muay Thai sparring.',
    manage: 'Immediate cessation of contact activity. REST should be strict for the first 24–48 hours, followed by a gradual, multi-stage return-to-play protocol guided by a healthcare professional. Persistent symptoms require specialised neuro-vestibular physical therapy.',
  },
  {
    injury: 'Sprained Wrists, Fractures, Tendinopathy: Sharp wrist/knuckle pain, swelling, bruising, weakened grip strength.',
    how: 'From poor punch alignment or loose wraps.',
    manage: 'Proper hand wraps and snug gloves, daily isometric holds (30–45 secs) for tendon flare-ups, or RICE (Rest, Ice, Compression, Elevation) and medical splinting/casting for fractures.',
  },
  {
    injury: 'Bruised Shins, Shin Splints, Ankle Sprains: Deep bone bruising, swelling, localised tenderness, pain when bearing weight/kicking.',
    how: 'High kicking volume and intensity / repeated impact.',
    manage: 'RICE, foam rolling for shin splints, reducing kicking volume / checking impacts, and wearing proper shin guards.',
  },
  {
    injury: 'Bruised / Cracked Ribs: Sharp local pain when twisting, bending, or taking a deep breath.',
    how: 'Repeated punching impact without proper cover during sparring.',
    manage: 'Rest, ice, compression, and pausing sparring/clinching until normal chest expansion & rotation are pain-free.',
  },
  {
    injury: 'Rotator Cuff Strain, Tendinopathy, AC Joint Irritation: Deep shoulder ache during punch extension/clinch pulling, or painful tendon snaps around the elbow.',
    how: 'Impact overload causing irritation.',
    manage: 'Soft tissue mobilisation, call pressure on tight forearm/shoulder areas, progressive rotator cuff strengthening, and exercise modifications.',
  },
];

function openInjuryGuide() {
  const rows = INJURY_GUIDE.map((r) => `
    <tr>
      <td>${esc(r.injury)}</td>
      <td>${esc(r.how)}</td>
      <td>${esc(r.manage)}</td>
    </tr>`).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-label="How to treat injuries in the gym">
      <div class="modal-head">
        <h2>📋 How to treat injuries in the gym</h2>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="table-wrap">
        <table class="data-table injury-table">
          <thead><tr><th>Pain / Injury</th><th>How?</th><th>Management / Prevention</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="muted small modal-note">Reference guidance only — persistent or severe symptoms require a healthcare professional.</p>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  document.body.appendChild(overlay);
}

/* ------------------------------ History modals --------------------------- */
// Generic modal shell for a section's History (summary + optional chart + log).
function historyModal(title, subtitle, bodyHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal history-modal" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head">
        <div>
          <h2>${esc(title)}</h2>
          <p class="daily-sub">${esc(subtitle)}</p>
        </div>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>
      ${bodyHtml}
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });
  document.body.appendChild(overlay);
}

function summaryCards(cards) {
  return `<div class="hist-summary">${cards.map((c) =>
    `<div class="hist-stat"><span class="hist-stat-k">${esc(c.k)}</span><span class="hist-stat-v ${c.cls || ''}">${c.v}</span></div>`).join('')}</div>`;
}

// Opens the History view for a given section kind.
function openHistory(kind) {
  const a = athleteById(state.selectedAthlete);
  if (!a) return;
  const checkins = checkinsForAthlete(a.id);
  const sub = 'BOXING · TRACK · RECOVER · REPEAT';

  if (kind === 'hydration') {
    // 7-day consumed-per-day from the hydration store
    const days = last7Days();
    const series = days.map((d) => ({ label: d.label, ml: hydrationMlForDay(a.id, d.key) }));
    const goal = hydrationGoalMl(a, 0).total;
    const total = series.reduce((s, x) => s + x.ml, 0);
    const avgMl = series.length ? total / series.length : 0;
    const reached = series.filter((x) => x.ml >= goal).length;
    const body = `
      ${summaryCards([
        { k: 'Total Consumed', v: (total / 1000).toFixed(1) + ' L' },
        { k: 'Daily Goal', v: (goal / 1000).toFixed(1) + ' L', cls: 'accent' },
        { k: 'Avg Daily Intake', v: (avgMl / 1000).toFixed(2) + ' L' },
        { k: 'Goal Reached', v: reached + (reached === 1 ? ' Day' : ' Days'), cls: 'green' },
      ])}
      <div class="hist-chart">${hydrationWeekChart(series, goal)}</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Day</th><th>Consumed</th><th>Status</th></tr></thead>
        <tbody>${series.slice().reverse().map((x) => `<tr><td>${x.label}</td><td>${x.day}</td><td>${(x.ml / 1000).toFixed(1)} L</td>
          <td>${x.ml >= goal ? '<span class="pill ok">Goal reached</span>' : '<span class="pill warn">Under goal</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    return historyModal('Hydration History', sub, body);
  }

  if (kind === 'bp') {
    const list = checkins.filter((c) => c.bp_systolic != null && c.bp_diastolic != null);
    const sys = list.map((c) => c.bp_systolic), dia = list.map((c) => c.bp_diastolic);
    const mean = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 10) / 10 : 0;
    const within = list.filter((c) => bpCategory(c.bp_systolic, c.bp_diastolic)?.cls === 'green').length;
    const series = list.slice(-7).map((c) => ({ label: sgtDay(c.timestampUtc).slice(5), sys: c.bp_systolic, dia: c.bp_diastolic }));
    const body = `
      ${summaryCards([
        { k: 'Avg Systolic', v: mean(sys) + ' mmHg' },
        { k: 'Avg Diastolic', v: mean(dia) + ' mmHg' },
        { k: 'Reference', v: '&lt;120 / &lt;80', cls: 'accent' },
        { k: 'Within Reference', v: within + (within === 1 ? ' day' : ' days'), cls: 'green' },
      ])}
      <div class="hist-chart">${bpWeekChart(series)}</div>
      ${bpLogTable(checkins)}`;
    return historyModal('Blood Pressure History', sub, body);
  }

  if (kind === 'sleep') {
    const nights = checkins.filter((c) => c.sleep_type !== 'Nap' && c.sleep_hours != null);
    const series = nights.slice(-7).map((c) => ({ label: sgtDay(c.timestampUtc).slice(5), hours: c.sleep_hours }));
    const avgH = nights.length ? Math.round(nights.reduce((s, c) => s + c.sleep_hours, 0) / nights.length * 10) / 10 : 0;
    const inBand = nights.filter((c) => c.sleep_hours >= 7 && c.sleep_hours <= 10).length;
    const body = `
      ${summaryCards([
        { k: 'Avg Overnight', v: avgH + ' h' },
        { k: 'Recommended', v: '7–10 h', cls: 'accent' },
        { k: 'Nights 7–10 h', v: inBand + (inBand === 1 ? ' night' : ' nights'), cls: 'green' },
        { k: 'Naps logged', v: checkins.filter((c) => c.sleep_type === 'Nap').length },
      ])}
      <div class="hist-chart">${sleepChart(series)}</div>
      <h3 class="hist-h3">Overnight sleep log</h3>
      ${sleepLogTable(nights)}
      <h3 class="hist-h3">💤 Nap log</h3>
      ${napLogTable(checkins)}`;
    return historyModal('Sleep History', sub, body);
  }

  if (kind === 'bodymass') {
    const list = checkins.filter((c) => c.body_mass_kg != null);
    const series = list.slice(-7).map((c) => ({ label: sgtDay(c.timestampUtc).slice(5), pct: null, kg: c.body_mass_kg }));
    const first = list[0]?.body_mass_kg, latest = list[list.length - 1]?.body_mass_kg;
    const change = (first != null && latest != null) ? (latest - first) : null;
    const body = `
      ${summaryCards([
        { k: 'Latest', v: latest != null ? latest + ' kg' : '—' },
        { k: 'Earliest', v: first != null ? first + ' kg' : '—' },
        { k: 'Net change', v: change == null ? '—' : (change > 0 ? '+' : '') + change.toFixed(1) + ' kg', cls: change != null && change < 0 ? 'accent' : 'green' },
        { k: 'Recordings', v: list.length },
      ])}
      <div class="hist-chart">${bodyMassWeekChart(series)}</div>
      ${bodyMassLogTable(checkins)}`;
    return historyModal('Body Mass History', sub, body);
  }

  if (kind === 'training') {
    const list = checkins.filter((c) => c.intensity_level || c.srpe != null);
    const body = `
      <h3 class="hist-h3">Session History <span class="muted small">· RPE 1–10</span></h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Training Type</th><th>RPE</th><th>Duration</th><th>Workload</th></tr></thead>
        <tbody>${list.length ? list.slice().reverse().map((c) => `<tr>
          <td>${esc(formatSgt(c.timestampUtc))}</td>
          <td>${esc(c.intensity_level || '—')}</td>
          <td>${c.srpe ?? '—'}</td>
          <td>${c.duration_mins != null ? c.duration_mins + ' min' : '—'}</td>
          <td>${c.workload != null ? c.workload : '—'}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">No sessions logged yet.</td></tr>'}</tbody></table></div>`;
    return historyModal('Training History', sub, body);
  }

  if (kind === 'pain') {
    const list = checkins.filter((c) => c.pain_score != null || (c.pain_symptoms && c.pain_symptoms.length) || c.pain_location);
    const body = `
      <h3 class="hist-h3">Pain &amp; Symptoms History</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Pain</th><th>Type</th><th>Period</th><th>Symptoms</th><th>Actions</th></tr></thead>
        <tbody>${list.length ? list.slice().reverse().map((c) => `<tr>
          <td>${esc(formatSgt(c.timestampUtc))}</td>
          <td>${c.pain_score ?? '—'}</td>
          <td>${esc(c.pain_location || '—')}</td>
          <td>${esc(c.pain_period || '—')}</td>
          <td>${(c.pain_symptoms || []).map((s) => `<span class="pill">${esc(s)}</span>`).join(' ') || '—'}</td>
          <td>${esc(c.pain_actions || '—')}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="muted">No pain entries yet.</td></tr>'}</tbody></table></div>`;
    return historyModal('Pain & Symptoms History', sub, body);
  }

  if (kind === 'diet') {
    return historyModal('Nutrition History', sub, dietLogInner(checkins));
  }
}

// --- History helpers ---
function last7Days() {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dd = sgtDay(d.toISOString());
    out.push({ key: dd, label: dd.slice(5), day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(dd + 'T00:00:00Z').getUTCDay()] });
  }
  return out;
}

// Body-mass single-metric log table rows for a pre-filtered list (reused shapes).
function sleepLogTable(nights) {
  if (!nights.length) return '<p class="muted">No overnight sleep logged yet.</p>';
  const rows = nights.slice().reverse().map((c) => `<tr>
    <td>${esc(formatSgt(c.timestampUtc))}</td>
    <td>${c.sleep_start && c.sleep_end ? esc(c.sleep_start + '–' + c.sleep_end) : '—'}</td>
    <td>${sleepDisplay(c)}</td>
    <td>${c.sleep_hours > 10 ? '<span class="pill warn">over 10h</span>' : c.sleep_hours < 7 ? '<span class="pill warn">under 7h</span>' : '<span class="pill ok">7–10h ✓</span>'}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Window</th><th>Duration</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Display a check-in's sleep as "7 h 30 min" (prefers stored minutes; falls
// back to hours for older records saved before the minutes field existed).
function sleepDisplay(c) {
  if (c.sleep_minutes != null) return formatHoursMinutes(c.sleep_minutes);
  if (c.sleep_hours != null) return formatHoursMinutes(Math.round(c.sleep_hours * 60));
  return '—';
}
import { evaluateAthlete, readinessTier, evaluateReadinessStatus, tierMeta } from './alerts.js';
// NOTE: alerts.js import is placed above the helpers that use it (hoisted ES import).
import {
  romChart, srpeChart, painChart, hydrationChart, sleepChart, nutritionChart,
  hydrationWeekChart, bpWeekChart, bodyMassWeekChart,
} from './charts.js';

const root = document.getElementById('app');
let state = { view: 'athlete', selectedAthlete: null, rosterFilter: 'All' };

// Effective tier = coach override (if any) else auto-computed readiness.
function effectiveTier(athlete, checkins) {
  const auto = readinessTier(checkins);
  const ov = getOverride(athlete.id);
  if (ov && ov.tier) {
    const meta = TIER_BY_NAME[ov.tier] || auto;
    return { ...meta, overridden: true, note: ov.note };
  }
  return { ...auto, overridden: false };
}

const TIER_BY_NAME = {
  Cleared: { tier: 'Cleared', icon: '🟢', cls: 'green' },
  Modified: { tier: 'Modified', icon: '🟡', cls: 'yellow' },
  Restricted: { tier: 'Restricted', icon: '🔴', cls: 'red' },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------- Shell --------------------------------- */
function render() {
  const athletes = getAthletes();
  if (!state.selectedAthlete && athletes.length) state.selectedAthlete = athletes[0].id;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="logo">🥊</span>
        <div>
          <h1>Eastside FC</h1>
          <p>Rehab &amp; Return-to-Play Monitor</p>
        </div>
      </div>
      <nav class="tabs">
        <button class="tab ${state.view === 'athlete' ? 'active' : ''}" data-view="athlete">Athlete Check-in</button>
        <button class="tab ${state.view === 'coach' ? 'active' : ''}" data-view="coach">Coach Dashboard</button>
      </nav>
      ${athletePicker(athletes)}
      <div class="tz">🕒 SGT (UTC+8)</div>
      <div class="data-actions">
        <button class="ghost" id="export-data" title="Download all data as a file (to move to another device)">⬇ Export</button>
        <button class="ghost" id="import-data" title="Load data from an exported file">⬆ Import</button>
        <input type="file" accept="application/json,.json" id="import-file" hidden>
      </div>
      ${profileChip(athletes)}
    </header>
    <main>${state.view === 'athlete' ? athleteView(athletes) : coachView(athletes)}</main>
  `;

  bindShell();
  if (state.view === 'athlete') bindAthleteForm();
  if (state.view === 'coach') bindCoach();
}

function bindShell() {
  root.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));

  const chip = root.querySelector('#profile-chip');
  if (chip) chip.addEventListener('click', () => {
    if (state.selectedAthlete) openProfile(state.selectedAthlete);
  });

  // --- Athlete controls (now in the top bar, available in both views) ---
  const sel = root.querySelector('#athlete-select');
  if (sel) sel.addEventListener('change', () => { state.selectedAthlete = sel.value; render(); });

  const addBtn = root.querySelector('#add-athlete');
  if (addBtn) addBtn.addEventListener('click', () => {
    const name = prompt('Athlete name?');
    if (!name) return;
    let gender = prompt(`Gender for ${name}? (Male / Female)`, '');
    if (gender) {
      const g = gender.trim().toLowerCase();
      gender = g.startsWith('m') ? 'Male' : g.startsWith('f') ? 'Female' : gender.trim();
    }
    let combatType = prompt(`Type of combat for ${name}? (Boxing / Muay Thai)`, '');
    if (combatType) {
      const c = combatType.trim().toLowerCase();
      combatType = c.startsWith('b') ? 'Boxing' : c.startsWith('m') ? 'Muay Thai' : combatType.trim();
    }
    const currentWeight = prompt(`Current weight (kg) for ${name}?`, '');
    const age = prompt(`Age for ${name}?`, '');
    const a = addAthlete({ name, gender, combatType, currentWeight, age });
    state.selectedAthlete = a.id;
    render();
  });

  const deleteBtn = root.querySelector('#delete-athlete');
  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    const a = athleteById(state.selectedAthlete);
    if (!a) return;
    if (!confirm(`Delete ${a.name}'s profile? This permanently removes all their check-ins, hydration logs and data. This cannot be undone.`)) return;
    deleteAthlete(a.id);
    const remaining = getAthletes();
    state.selectedAthlete = remaining.length ? remaining[0].id : null;
    render();
  });

  // --- Export: download all data as a JSON file ---
  const exportBtn = root.querySelector('#export-data');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const bundle = exportData();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = bundle.exportedAt.slice(0, 10);
    a.href = url;
    a.download = `eastside-fc-data-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // --- Import: load data from a file (ask replace vs merge) ---
  const importBtn = root.querySelector('#import-data');
  const importFile = root.querySelector('#import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let bundle;
        try { bundle = JSON.parse(reader.result); }
        catch { alert('That file could not be read as JSON.'); return; }
        const merge = confirm(
          'Import data from this file.\n\n' +
          'OK = MERGE (keep current data, add anything new from the file)\n' +
          'Cancel = REPLACE (overwrite all data on this device with the file)'
        );
        try {
          const res = importData(bundle, merge ? 'merge' : 'replace');
          state.selectedAthlete = null;
          alert(`Import complete (${res.mode}): ${res.athletes} athlete(s), ${res.checkins} check-in(s).`);
          render();
        } catch (e) {
          alert('Import failed: ' + e.message);
        } finally {
          importFile.value = ''; // allow re-importing the same file
        }
      };
      reader.readAsText(file);
    });
  }
}

/* ----------------------------- Athlete view ------------------------------ */
// Banner summarising the athlete's current readiness tier + active alerts.
function athleteAlertBanner() {
  if (!state.selectedAthlete) return '';
  const a = athleteById(state.selectedAthlete);
  if (!a) return '';
  const checkins = checkinsForAthlete(a.id);
  if (!checkins.length) return '';
  const status = readinessTier(checkins);
  const alerts = evaluateAthlete(a, checkins);
  const latest = checkins[checkins.length - 1];
  const latestTier = tierMeta(evaluateReadinessStatus(latest));
  const items = alerts.length
    ? alerts.map((al) => `<li class="alert ${al.severity}"><span>${al.icon}</span>
        <div><strong>${esc(al.title)}</strong> <span class="muted">${esc(al.detail)}</span></div></li>`).join('')
    : '<li class="alert info"><span>🟢</span><div><strong>No active alerts — cleared to train</strong></div></li>';
  return `
  <section class="banner ${status.cls}">
    <div class="banner-head">
      <span class="banner-status">${status.icon} ${status.tier}</span>
      <span class="muted small">Latest check-in readiness: ${latestTier.icon} ${latestTier.tier}</span>
    </div>
    <ul class="alert-list compact">${items}</ul>
  </section>`;
}

// Hydration card: a health-bar + bottle button (+1), with a History link.
// Daily goal is computed from body weight (30–40 ml/kg) plus today's exercise.
function hydrationCard() {
  if (!state.selectedAthlete) return '';
  const a = athleteById(state.selectedAthlete);
  if (!a) return '';
  const bottleMl = a.bottleMl || DEFAULT_BOTTLE_ML;
  const exMins = exerciseMinutesToday(a.id);
  const g = hydrationGoalMl(a, exMins);
  const goal = g.total;
  const today = getHydrationToday(a.id);
  const pct = goal > 0 ? Math.min(100, Math.round((today.ml / goal) * 100)) : 0;
  const goalReached = today.ml >= goal;
  const barCls = pct >= 100 ? 'full' : pct >= 50 ? 'ok' : 'low';
  const litres = (n) => (n / 1000).toFixed(1) + ' L';

  return `
  <section class="dl-card">
    <div class="dl-card-head"><h3>Hydration</h3><a href="#" class="hist-link" data-history="hydration">History</a></div>
    <div class="hydration-bar">
      <div class="hydration-fill ${barCls}" style="width:${pct}%"></div>
    </div>
    <div class="hydration-summary">
      <span class="muted small">Consumed / Goal</span>
      <strong>${litres(today.ml)} / ${litres(goal)}</strong>
    </div>
    <div class="hydration-controls">
      <label class="dl-field bottle-cap">Bottle Capacity
        <input type="number" id="bottle-ml" min="50" step="50" value="${bottleMl}"> <span class="muted small">ml</span>
      </label>
      <button class="bottle-btn primary" id="bottle-add" type="button" title="Tap each time you finish a bottle (+${bottleMl} ml)">🍶 +1 bottle</button>
    </div>
    <div class="hydration-meta">
      <span>${today.taps} bottle${today.taps === 1 ? '' : 's'} today</span>
      <button class="link-del" id="bottle-remove" type="button" ${today.taps === 0 ? 'disabled' : ''}>undo last</button>
      ${goalReached ? '<span class="pill ok">🎯 Goal reached!</span>' : ''}
    </div>
  </section>`;
}

function athleteView(athletes) {
  const a = athleteById(state.selectedAthlete);
  const prevMass = a ? lastBodyMass(a.id) : null;

  if (!a) {
    return `<section class="panel"><p class="muted">No athlete selected. Use <strong>+ New</strong> at the top to add one.</p></section>`;
  }

  return `
  ${athleteAlertBanner()}

  <div class="daily-log">
    <div class="daily-log-head">
      <div>
        <h1 class="daily-title">Daily Log</h1>
        <p class="daily-sub">BOXING · TRAIN · RECOVER · REPEAT</p>
      </div>
      <button class="save-log-btn primary" type="submit" form="checkin-form">Save Log</button>
    </div>

    <form id="checkin-form" class="dl-grid">

      <!-- Hydration (tracker unchanged) -->
      ${hydrationCard()}

      <!-- Body Mass -->
      <section class="dl-card">
        <div class="dl-card-head"><h3>Body Mass</h3><a href="#" class="hist-link" data-history="bodymass">History</a></div>
        <label class="dl-field">Current Weight
          <input type="number" step="0.1" name="body_mass_kg" id="body-mass-input" placeholder="e.g. 72.5">
        </label>
        <div class="dl-field-static">
          <span class="dl-field-label">Previous Weight</span>
          <span class="dl-field-value" id="prev-weight">${prevMass != null ? prevMass + ' kg' : '—'}</span>
        </div>
        <div class="dl-change-row">
          <div class="dl-change"><span class="dl-field-label">Change</span><span class="dl-change-val" id="mass-change">—</span></div>
          <div class="dl-change"><span class="dl-field-label">% Change</span><span class="dl-change-val" id="mass-change-pct">—</span></div>
        </div>
      </section>

      <!-- Blood Pressure -->
      <section class="dl-card">
        <div class="dl-card-head"><h3>Blood Pressure</h3><a href="#" class="hist-link" data-history="bp">History</a></div>
        <div class="dl-two">
          <label class="dl-field">Systolic (mmHg)<input type="number" min="40" max="300" name="bp_systolic" id="bp-systolic" placeholder="120"></label>
          <label class="dl-field">Diastolic (mmHg)<input type="number" min="30" max="200" name="bp_diastolic" id="bp-diastolic" placeholder="80"></label>
        </div>
        <label class="dl-field">Timing
          <select name="bp_timing" id="bp-timing">
            <option value="">—</option>
            ${BP_TIMINGS.map((t) => `<option>${t}</option>`).join('')}
          </select>
        </label>
        <div class="dl-inline-status"><span id="bp-category-display" class="muted">—</span></div>
      </section>

      <!-- Sleep -->
      <section class="dl-card">
        <div class="dl-card-head"><h3>Sleep</h3><a href="#" class="hist-link" data-history="sleep">History</a></div>
        <label class="dl-field">Type of sleep
          <select name="sleep_type" id="sleep-type">
            <option value="Overnight">Overnight sleep</option>
            <option value="Nap">Nap</option>
          </select>
        </label>
        <div class="dl-two">
          <label class="dl-field">Sleep Time
            <div class="time-row"><input type="time" name="sleep_start" id="sleep-start"><button type="button" class="ghost sleep-now" data-target="sleep-start">now</button></div>
          </label>
          <label class="dl-field">Wake Up
            <div class="time-row"><input type="time" name="sleep_end" id="sleep-end"><button type="button" class="ghost sleep-now" data-target="sleep-end">now</button></div>
          </label>
        </div>
        <div class="dl-total-row">
          <span class="dl-field-label">Total Hours</span>
          <span class="dl-total-value" id="sleep-hours-display">—</span>
        </div>
        <input type="hidden" name="sleep_hours" id="sleep-hours">
        <input type="hidden" name="sleep_minutes" id="sleep-minutes">
      </section>

      <!-- Training Log (Training + ROM + Pain nested under it) -->
      <section class="dl-card dl-wide">
        <div class="dl-card-head"><h3>Training Log</h3><a href="#" class="hist-link" data-history="training">History</a></div>
        <div class="dl-row-fields">
          <label class="dl-field">Training Type
            <select name="intensity_level">
              <option value="">—</option>
              ${INTENSITY_LEVELS.map((l) => `<option>${l}</option>`).join('')}
            </select>
          </label>
          <label class="dl-field">RPE (1–10)
            <select name="srpe">
              <option value="">—</option>
              ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<option value="${n}">${n}</option>`).join('')}
            </select>
          </label>
          <label class="dl-field">Duration (min)<input type="number" min="0" name="duration_mins" id="duration-mins" placeholder="e.g. 60"></label>
        </div>
        <div class="dl-row-fields">
          <label class="dl-field">Pre-session weight (kg)<input type="number" step="0.1" name="pre_weight_kg" id="pre-weight"></label>
          <label class="dl-field">Post-session weight (kg)<input type="number" step="0.1" name="post_weight_kg" id="post-weight"></label>
          <div class="dl-field-static"><span class="dl-field-label">Sweat rate</span><span class="dl-field-value" id="sweat-rate-display">—</span></div>
        </div>

        <div class="dl-row-fields">
          <label class="dl-field">Joint tested<input type="text" name="joint_tested" placeholder="e.g. Ankle Dorsiflexion"></label>
          <label class="dl-field">Goniometer angle (°)<input type="number" min="0" max="360" name="goniometer_degrees"></label>
          <label class="dl-field">Baseline ROM (°)<input type="number" min="1" max="360" name="rom_baseline" id="rom-baseline" value="${a.romBaseline}"></label>
        </div>

        <!-- Pain & Symptoms nested under Training -->
        <div class="dl-subsection">
          <div class="dl-card-head"><h4>Pain &amp; Symptoms</h4><a href="#" class="hist-link" data-history="pain">History</a></div>
          <div class="dl-row-fields">
            <label class="dl-field">Pain Level (Rating)
              <select name="pain_score">
                <option value="">—</option>
                ${Array.from({ length: 11 }, (_, i) => i).map((n) => `<option value="${n}">${n}${n === 0 ? ' (no pain)' : ''}</option>`).join('')}
              </select>
            </label>
            <label class="dl-field">Type of Pain Felt<input type="text" name="pain_location" placeholder="e.g. Soreness, Left Ankle"></label>
            <label class="dl-field">Pain Time Period<input type="text" name="pain_period" placeholder="e.g. 2 Days"></label>
          </div>
          <div class="pain-symptoms">
            <span class="dl-field-label">Symptoms List <span class="muted small">(select any that apply)</span></span>
            <div class="tag-row">
              ${PAIN_SYMPTOMS.map((s) => `<label class="tag"><input type="checkbox" name="pain_symptom" value="${esc(s)}">${esc(s)}</label>`).join('')}
            </div>
          </div>
          <label class="dl-field">How did it happen? <span class="muted small">(optional)</span>
            <textarea name="pain_description" rows="2" placeholder="Describe what you were doing when the pain started…"></textarea>
          </label>
          <label class="dl-field">Actions to reduce pain <span class="muted small">(optional)</span>
            <textarea name="pain_actions" rows="2" placeholder="e.g. Ice bath, foam rolling, rest"></textarea>
          </label>
          <a href="#" class="treat-link" id="treat-injuries-link">📋 How to treat injuries in the gym</a>
        </div>
      </section>

      <!-- Nutrition -->
      <section class="dl-card dl-wide">
        <div class="dl-card-head"><h3>Nutrition Log</h3><a href="#" class="hist-link" data-history="diet">History</a></div>
        <div class="dl-row-fields">
          <label class="dl-field">Pre-workout meal<input type="text" name="pre_workout_meal" placeholder="e.g. Chicken rice, 2.5h before"></label>
          <label class="dl-field">Post-workout meal<input type="text" name="post_workout_meal" placeholder="e.g. Whey shake, banana, rice"></label>
          <label class="dl-field">Main meal<input type="text" name="main_meal" placeholder="e.g. Grilled fish, veg, sweet potato"></label>
        </div>
        <label class="check-inline">Fueled before session (ate 2–3 h prior)?
          <input type="checkbox" name="fueled_before_session">
        </label>
        <div class="tag-row" id="macro-tags">
          ${MACRO_TAGS.map((t) => `<label class="tag"><input type="checkbox" name="quality_tag" value="${t}">${t}</label>`).join('')}
        </div>
      </section>

      <div class="form-actions dl-wide">
        <button type="submit" class="primary">Save check-in</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </form>
  </div>
  `;
}

// Table markup for the blood-pressure log (every reading, timestamped).
function bpLogTable(checkins) {
  const list = checkins.filter((c) => c.bp_systolic != null && c.bp_diastolic != null).slice().reverse();
  if (!list.length) return '<p class="muted">No blood-pressure readings yet. Enter systolic & diastolic to start the log.</p>';
  const rows = list.map((c) => {
    const cat = bpCategory(c.bp_systolic, c.bp_diastolic);
    return `<tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td>${c.bp_timing ? `<span class="pill">${esc(c.bp_timing)}</span>` : '—'}</td>
      <td>${c.bp_systolic}/${c.bp_diastolic} mmHg</td>
      <td>${cat ? `<span class="tier ${cat.cls}">${cat.label}</span>` : '—'}</td>
    </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Time (SGT)</th><th>Timing</th><th>Reading</th><th>Category</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Table markup for the body-mass log (every recording + delta vs previous).
function bodyMassLogTable(checkins) {
  const list = checkins.filter((c) => c.body_mass_kg != null).slice().reverse();
  if (!list.length) return '<p class="muted">No body-mass recordings yet. Enter a body mass to start the log.</p>';
  const rows = list.map((c, i) => {
    const prev = list[i + 1]; // next in reversed list = earlier recording
    const delta = prev && prev.body_mass_kg != null ? c.body_mass_kg - prev.body_mass_kg : null;
    const deltaStr = delta == null ? '—'
      : (delta === 0 ? '±0' : (delta > 0 ? '+' : '') + delta.toFixed(1)) + ' kg';
    return `<tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td>${c.body_mass_kg} kg</td>
      <td class="${delta != null && delta < 0 ? 'cell-yellow' : ''}">${deltaStr}</td>
    </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Time (SGT)</th><th>Body mass</th><th>Δ vs prev</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Nap log table — every nap, timestamped, flagged >90 min in red / <20 min.
function napLogTable(checkins) {
  const list = checkins.filter((c) => c.sleep_type === 'Nap' && c.sleep_minutes != null).slice().reverse();
  if (!list.length) return '<p class="muted">No naps logged yet. Log a nap by selecting “Nap” in the Sleep section.</p>';
  const rows = list.map((c) => {
    const m = c.sleep_minutes;
    const over = m > 90;
    const short = m < 20;
    const note = over ? '<span class="cell-red">over 90m</span>'
      : short ? '<span class="cell-yellow">under 20m</span>'
      : '<span class="pill ok">20–90m ✓</span>';
    return `<tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td class="${over ? 'cell-red' : ''}">${formatHoursMinutes(m)}</td>
      <td>${note}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Duration</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Diet log table — each meal entry with SGT time, window, macro tags, fueling.
function dietLogInner(checkins) {
  const rows = [];
  checkins.slice().reverse().forEach((c) => {
    const nl = c.nutrition_log || {};
    const ts = formatSgt(c.timestampUtc);
    const tags = (nl.quality_tags || []).map((m) => `<span class="pill">${esc(m)}</span>`).join(' ');
    const meals = [
      ['Pre-workout', nl.pre_workout_meal],
      ['Post-workout', nl.post_workout_meal],
      ['Main meal', nl.main_meal],
    ].filter(([, v]) => v && v.trim());
    meals.forEach(([window, desc], i) => {
      rows.push(`<tr>
        <td>${i === 0 ? esc(ts) : ''}</td>
        <td><span class="pill">${window}</span></td>
        <td>${esc(desc)}</td>
        <td>${window === 'Pre-workout' ? (nl.fueled_before_session ? '<span class="pill ok">ate 2–3h before</span>' : '<span class="pill warn">not timely</span>') : ''}</td>
        <td>${i === 0 ? (tags || '—') : ''}</td>
      </tr>`);
    });
  });
  return rows.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Window</th><th>Meal</th><th>Fueling</th><th>Tags</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : '<p class="muted">No meals logged yet. Add meals in the Nutrition section of a check-in.</p>';
}

function bindAthleteForm() {
  // --- Hydration tracker handlers ---
  const bottleMlInput = root.querySelector('#bottle-ml');
  if (bottleMlInput) {
    bottleMlInput.addEventListener('change', () => {
      const val = Math.max(50, Number(bottleMlInput.value) || DEFAULT_BOTTLE_ML);
      updateAthlete(state.selectedAthlete, { bottleMl: val });
      render();
    });
  }
  const addBottleBtn = root.querySelector('#bottle-add');
  if (addBottleBtn) addBottleBtn.addEventListener('click', () => {
    const a = athleteById(state.selectedAthlete);
    addBottle(state.selectedAthlete, (a && a.bottleMl) || DEFAULT_BOTTLE_ML);
    render();
  });
  const removeBottleBtn = root.querySelector('#bottle-remove');
  if (removeBottleBtn) removeBottleBtn.addEventListener('click', () => {
    removeBottle(state.selectedAthlete);
    render();
  });

  // --- Baseline ROM: persist to the athlete profile when changed ---
  const romBaselineInput = root.querySelector('#rom-baseline');
  if (romBaselineInput) romBaselineInput.addEventListener('change', () => {
    const val = Number(romBaselineInput.value);
    if (val > 0) updateAthlete(state.selectedAthlete, { romBaseline: val });
  });

  root.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => { deleteCheckin(b.dataset.del); render(); }));

  // --- Sleep tracker: "now" buttons + live duration calculation ---
  const sleepStart = root.querySelector('#sleep-start');
  const sleepEnd = root.querySelector('#sleep-end');
  const sleepHours = root.querySelector('#sleep-hours');
  const sleepMinutes = root.querySelector('#sleep-minutes');
  const sleepDisplay = root.querySelector('#sleep-hours-display');
  function recalcSleep() {
    if (!sleepStart || !sleepEnd) return;
    const mins = sleepMinutesBetween(sleepStart.value, sleepEnd.value);
    if (mins != null) {
      const hrs = sleepHoursBetween(sleepStart.value, sleepEnd.value);
      sleepHours.value = hrs;
      sleepMinutes.value = mins;
      sleepDisplay.textContent = formatHoursMinutes(mins);
      sleepDisplay.classList.toggle('short', mins < 360); // < 6 h
    } else {
      sleepHours.value = '';
      sleepMinutes.value = '';
      sleepDisplay.textContent = '—';
      sleepDisplay.classList.remove('short');
    }
  }
  root.querySelectorAll('.sleep-now').forEach((b) =>
    b.addEventListener('click', () => {
      const target = root.querySelector('#' + b.dataset.target);
      const now = new Date();
      target.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      recalcSleep();
    }));
  if (sleepStart) sleepStart.addEventListener('change', recalcSleep);
  if (sleepEnd) sleepEnd.addEventListener('change', recalcSleep);

  // --- Body Mass: live change vs previous recorded weight ---
  const bodyMassInput = root.querySelector('#body-mass-input');
  if (bodyMassInput) {
    const prev = state.selectedAthlete ? lastBodyMass(state.selectedAthlete) : null;
    const changeEl = root.querySelector('#mass-change');
    const pctEl = root.querySelector('#mass-change-pct');
    bodyMassInput.addEventListener('input', () => {
      const cur = bodyMassInput.value !== '' ? Number(bodyMassInput.value) : null;
      if (cur == null || prev == null) {
        changeEl.textContent = '—'; pctEl.textContent = '—';
        changeEl.className = 'dl-change-val'; pctEl.className = 'dl-change-val';
        return;
      }
      const d = Math.round((cur - prev) * 10) / 10;
      const pct = Math.round((d / prev) * 1000) / 10;
      const sign = d > 0 ? '+' : '';
      changeEl.textContent = `${sign}${d} kg`;
      pctEl.textContent = `${sign}${pct}%`;
      const cls = 'dl-change-val ' + (d > 0 ? 'up' : d < 0 ? 'down' : '');
      changeEl.className = cls; pctEl.className = cls;
    });
  }

  // --- History links (open per-section history modal) ---
  root.querySelectorAll('[data-history]').forEach((lnk) =>
    lnk.addEventListener('click', (e) => { e.preventDefault(); openHistory(lnk.dataset.history); }));

  // --- Live sweat-rate readout from pre/post weight + duration ---
  const preW = root.querySelector('#pre-weight');
  const postW = root.querySelector('#post-weight');
  const durW = root.querySelector('#duration-mins');
  const sweatDisplay = root.querySelector('#sweat-rate-display');
  function recalcSweat() {
    if (!sweatDisplay) return;
    const pre = preW.value !== '' ? Number(preW.value) : null;
    const post = postW.value !== '' ? Number(postW.value) : null;
    const dur = durW.value !== '' ? Number(durW.value) : null;
    const fluids = state.selectedAthlete ? getHydrationToday(state.selectedAthlete).ml : 0;
    const rate = sweatRateLph(pre, post, dur, fluids);
    if (rate != null) {
      sweatDisplay.textContent = `${rate.toFixed(2)} L/h`;
      sweatDisplay.classList.toggle('high', rate >= 1.5);
    } else {
      sweatDisplay.textContent = '—';
      sweatDisplay.classList.remove('high');
    }
  }
  [preW, postW, durW].forEach((el) => el && el.addEventListener('input', recalcSweat));

  // --- Live blood-pressure category readout ---
  const bpSys = root.querySelector('#bp-systolic');
  const bpDia = root.querySelector('#bp-diastolic');
  const bpDisplay = root.querySelector('#bp-category-display');
  function recalcBp() {
    if (!bpDisplay) return;
    const cat = bpCategory(bpSys.value, bpDia.value);
    bpDisplay.className = 'sweat-value';
    if (cat) {
      bpDisplay.textContent = cat.label;
      if (cat.cls === 'red') bpDisplay.classList.add('bp-red');
      else if (cat.cls === 'yellow') bpDisplay.classList.add('high');
    } else {
      bpDisplay.textContent = '—';
    }
  }
  [bpSys, bpDia].forEach((el) => el && el.addEventListener('input', recalcBp));

  // --- "How to treat injuries in the gym" reference table (modal) ---
  const treatLink = root.querySelector('#treat-injuries-link');
  if (treatLink) treatLink.addEventListener('click', (e) => {
    e.preventDefault();
    openInjuryGuide();
  });

  const form = root.querySelector('#checkin-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const num = (k) => (f.get(k) !== '' && f.get(k) != null ? Number(f.get(k)) : null);
    const str = (k) => (f.get(k) ? String(f.get(k)).trim() : '');

    // Persist any baseline-ROM edit before saving, so ROM% uses the right base.
    const romBaseline = num('rom_baseline');
    if (romBaseline && romBaseline > 0) updateAthlete(state.selectedAthlete, { romBaseline });

    const input = {
      athleteId: state.selectedAthlete,
      body_mass_kg: num('body_mass_kg'),
      bp_systolic: num('bp_systolic'),
      bp_diastolic: num('bp_diastolic'),
      bp_timing: str('bp_timing') || null,
      pre_weight_kg: num('pre_weight_kg'),
      post_weight_kg: num('post_weight_kg'),
      joint_tested: str('joint_tested'),
      goniometer_degrees: num('goniometer_degrees'),
      pain_score: num('pain_score'),
      pain_location: str('pain_location'),
      pain_symptoms: f.getAll('pain_symptom'),
      pain_description: str('pain_description') || null,
      pain_actions: str('pain_actions') || null,
      pain_period: str('pain_period') || null,
      srpe: num('srpe'),
      intensity_level: str('intensity_level') || null,
      duration_mins: num('duration_mins'),
      sleep_type: str('sleep_type') || null,
      sleep_hours: num('sleep_hours'),
      sleep_minutes: num('sleep_minutes'),
      sleep_start: str('sleep_start') || null,
      sleep_end: str('sleep_end') || null,
      nutrition_log: {
        pre_workout_meal: str('pre_workout_meal'),
        post_workout_meal: str('post_workout_meal'),
        main_meal: str('main_meal'),
        quality_tags: f.getAll('quality_tag'),
        fueled_before_session: f.get('fueled_before_session') === 'on',
      },
    };
    saveCheckin(input, athleteById(state.selectedAthlete));

    // --- On-save sleep notifications ---
    const mins = input.sleep_minutes;
    if (input.sleep_type === 'Nap' && mins != null) {
      if (mins < 20) {
        // dismissible popup for a too-short nap
        showNapPopup(mins);
      } else if (mins > 90) {
        toast(`Nap was ${formatHoursMinutes(mins)} — over the recommended 90 min.`, 'red');
      }
    }
    if (input.sleep_type === 'Overnight' && input.sleep_hours != null) {
      if (input.sleep_hours > 10) toast(`Overnight sleep ${input.sleep_hours}h is over the 10h line.`, 'red');
      else if (input.sleep_hours < 7) toast(`Overnight sleep ${input.sleep_hours}h is under the 7h line.`, 'yellow');
    }

    const msg = root.querySelector('#save-msg');
    msg.textContent = '✓ Saved with SGT timestamp';
    msg.classList.add('show');
    setTimeout(render, 900);
  });
}

// A dismissible modal shown when a logged nap is shorter than 20 min.
function showNapPopup(mins) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal nap-popup" role="dialog" aria-label="Short nap">
      <div class="nap-popup-emoji">😴</div>
      <h2>Only ${formatHoursMinutes(mins)}?</h2>
      <p>The recommended nap is <strong>20–90 min</strong>. Do you want to sleep a bit more?</p>
      <button class="primary nap-dismiss">Dismiss</button>
    </div>`;
  overlay.querySelector('.nap-dismiss').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// Lightweight transient toast notification (auto-dismisses).
function toast(text, cls = '') {
  const t = document.createElement('div');
  t.className = `toast ${cls}`;
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
}

/* --------------------- Shared analytics chart builders ------------------- */
// Groups an athlete's check-ins by SGT calendar day, in chronological order.
// Returns [{ day: 'MM-DD', items: [...] }], so every chart shows one
// point/bar per day — a true day-over-day progression (line & bar only).
function groupByDay(checkins) {
  const map = new Map();
  for (const c of checkins) {
    const day = c.sgtDay || sgtDay(c.timestampUtc);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(c);
  }
  return [...map.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([day, items]) => ({ day, label: day.slice(5), items }));
}

// Average of a field across a day's check-ins (ignores null/undefined).
function avg(items, pick) {
  const vals = items.map(pick).filter((v) => v != null);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Builds the five chart series, aggregated per SGT day for multi-day trends.
function buildChartSeries(a, checkins) {
  const days = groupByDay(checkins);

  const romSeries = days.map((d) => ({
    label: d.label,
    pct: avg(d.items, (c) => (c.rom_percentage != null ? c.rom_percentage : romPct(c.goniometer_degrees, a.romBaseline))),
  })).filter((d) => d.pct != null);

  const painSeries = days.map((d) => ({
    label: d.label,
    srpe: avg(d.items, (c) => c.srpe),
    pain: avg(d.items, (c) => c.pain_score),
  })).filter((d) => d.srpe != null || d.pain != null);

  const hydSeries = days.map((d) => ({
    label: d.label,
    pre: avg(d.items, (c) => c.pre_weight_kg),
    post: avg(d.items, (c) => c.post_weight_kg),
  })).filter((d) => d.pre != null || d.post != null);

  // Sleep chart = overnight sleep per night only (naps are tracked separately).
  // Legacy records without a sleep_type are treated as overnight.
  const sleepSeries = days.map((d) => ({
    label: d.label,
    hours: avg(d.items.filter((c) => c.sleep_type !== 'Nap'), (c) => c.sleep_hours),
  })).filter((d) => d.hours != null);

  const nutSeries = days.map((d) => ({
    label: d.label,
    workload: avg(d.items, (c) => c.workload),
    // a day counts as fueled if every logged session that day was fueled in time
    fueled: d.items.filter((c) => c.workload != null).every((c) => {
      const nl = c.nutrition_log || {};
      return !!(nl.pre_workout_meal && nl.pre_workout_meal.trim()) && nl.fueled_before_session === true;
    }),
  })).filter((d) => d.workload != null);

  return { romSeries, painSeries, hydSeries, sleepSeries, nutSeries };
}

// Renders the analytics charts (line & bar) for an athlete. Shared by the
// coach dashboard and the athlete's own "My Progress" view.
function renderCharts(a, checkins) {
  const s = buildChartSeries(a, checkins);
  return `
    <div class="chart-card">${romChart(s.romSeries)}</div>
    <div class="chart-card">${srpeChart(s.painSeries)}</div>
    <div class="chart-card">${painChart(s.painSeries)}</div>
    <div class="chart-card">${hydrationChart(s.hydSeries)}</div>
    <div class="chart-card">${sleepChart(s.sleepSeries)}</div>
    <div class="chart-card">${nutritionChart(s.nutSeries)}</div>`;
}

/* ------------------------------ Coach view ------------------------------- */
function coachView(athletes) {
  const filters = ['All', 'Cleared', 'Modified', 'Restricted'];

  const enriched = athletes.map((a) => {
    const checkins = checkinsForAthlete(a.id);
    const alerts = evaluateAthlete(a, checkins);
    const status = effectiveTier(a, checkins); // override-aware
    const latest = checkins[checkins.length - 1];
    const latestTier = latest ? tierMeta(evaluateReadinessStatus(latest)) : null;
    return { a, checkins, alerts, status, latest, latestTier };
  });

  const counts = { All: enriched.length, Cleared: 0, Modified: 0, Restricted: 0 };
  enriched.forEach((e) => { counts[e.status.tier] = (counts[e.status.tier] || 0) + 1; });

  const filterBar = filters.map((f) =>
    `<button class="filter-btn ${state.rosterFilter === f ? 'active' : ''}" data-filter="${f}">${f} <span class="count">${counts[f] ?? 0}</span></button>`
  ).join('');

  const visible = enriched.filter((e) => state.rosterFilter === 'All' || e.status.tier === state.rosterFilter);

  const cards = visible.map(({ a, checkins, alerts, status, latest, latestTier }) => {
    const redN = alerts.filter((x) => x.severity === 'red').length;
    const yellowN = alerts.filter((x) => x.severity === 'yellow').length;
    return `
      <button class="athlete-card ${status.cls} ${a.id === state.selectedAthlete ? 'sel' : ''}" data-ath="${a.id}">
        <div class="card-top">
          <span class="name">${esc(a.name)}</span>
          <span class="tier ${status.cls}">${status.icon} ${status.tier}${status.overridden ? ' ✎' : ''}</span>
        </div>
        <div class="card-meta">
          <span>${checkins.length} check-ins</span>
          ${latestTier ? `<span class="badge ${latestTier.cls}">latest ${latestTier.icon}</span>` : ''}
          ${redN ? `<span class="badge red">🔴 ${redN}</span>` : ''}
          ${yellowN ? `<span class="badge yellow">🟡 ${yellowN}</span>` : ''}
        </div>
        <div class="card-foot">${latest ? 'Last: ' + esc(formatSgt(latest.timestampUtc)) : 'No data'}</div>
      </button>`;
  }).join('');

  return `
  <section class="coach-grid">
    <aside class="roster">
      <h2>Roster</h2>
      <div class="filter-bar">${filterBar}</div>
      <div class="cards">${cards || '<p class="muted">No athletes match this filter.</p>'}</div>
    </aside>
    <div class="detail" id="coach-detail">${coachDetail()}</div>
  </section>`;
}

function coachDetail() {
  const athletes = getAthletes();
  const a = athletes.find((x) => x.id === state.selectedAthlete) || athletes[0];
  if (!a) return '<p class="muted">Select an athlete.</p>';
  const checkins = checkinsForAthlete(a.id);
  const alerts = evaluateAthlete(a, checkins);
  const auto = readinessTier(checkins);          // auto-computed (rubric)
  const status = effectiveTier(a, checkins);     // override-aware display tier

  const alertList = alerts.length
    ? alerts.map((al) => `<li class="alert ${al.severity}"><span>${al.icon}</span>
        <div><strong>${esc(al.title)}</strong><br><span class="muted">${esc(al.detail)}</span></div></li>`).join('')
    : '<li class="alert info"><span>🟢</span><div><strong>No active alerts</strong></div></li>';

  const foodRows = checkins.filter((c) => {
    const nl = c.nutrition_log || {};
    return nl.pre_workout_meal || nl.post_workout_meal || nl.main_meal;
  }).slice().reverse().slice(0, 6).map((c) => {
    const nl = c.nutrition_log || {};
    return `
    <tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td>${esc(nl.pre_workout_meal || '—')} ${nl.fueled_before_session ? '<span class="pill ok">timely</span>' : (nl.pre_workout_meal ? '<span class="pill warn">late</span>' : '')}</td>
      <td>${esc(nl.post_workout_meal || '—')}</td>
      <td>${esc(nl.main_meal || '—')}</td>
      <td>${(nl.quality_tags || []).map((m) => `<span class="pill">${esc(m)}</span>`).join(' ') || '—'}</td>
    </tr>`;
  }).join('');

  const ovNote = getOverride(a.id);
  return `
    <div class="detail-head">
      <h2>${avatarMarkup(a, 'sm')} ${esc(a.name)} <span class="muted small">· ${[a.combatType, a.gender, a.age != null ? a.age + 'y' : null, a.currentWeight != null ? a.currentWeight + ' kg' : null, 'baseline ROM ' + a.romBaseline + '°'].filter(Boolean).map(esc).join(' · ')}</span></h2>
      <span class="tier big ${status.cls}">${status.icon} ${status.tier}${status.overridden ? ' ✎ override' : ''}</span>
    </div>

    <div class="override-bar">
      <span class="muted small">Auto readiness: ${auto.icon} ${auto.tier}</span>
      <span class="override-label">Coach override:</span>
      <div class="override-btns" data-athlete="${a.id}">
        <button class="ov-btn ${status.overridden && status.tier === 'Cleared' ? 'on green' : ''}" data-ov="Cleared">🟢 Clear</button>
        <button class="ov-btn ${status.overridden && status.tier === 'Modified' ? 'on yellow' : ''}" data-ov="Modified">🟡 Modify</button>
        <button class="ov-btn ${status.overridden && status.tier === 'Restricted' ? 'on red' : ''}" data-ov="Restricted">🔴 Restrict</button>
        <button class="ov-btn clear" data-ov="">Reset to auto</button>
      </div>
      ${ovNote && ovNote.tier ? `<span class="muted small">Overridden ${esc(ovNote.setAt || '')}${ovNote.note ? ' · ' + esc(ovNote.note) : ''}</span>` : ''}
    </div>

    <div class="detail-cols">
      <div class="charts">${renderCharts(a, checkins)}</div>
      <aside class="alerts-pane">
        <h3>🔔 Notifications &amp; Alerts</h3>
        <ul class="alert-list">${alertList}</ul>
      </aside>
    </div>

    <section class="panel">
      <h3>🍽️ Food &amp; Fueling Log</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Timestamp (SGT)</th><th>Pre-workout</th><th>Post-workout</th><th>Main meal</th><th>Tags</th></tr></thead>
          <tbody>${foodRows || '<tr><td colspan="5" class="muted">No food logs yet</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h3>Raw metrics</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>SGT</th><th>Readiness</th><th>Body mass</th><th>BP (mmHg)</th><th>Pre/Post kg</th><th>Fluid%</th><th>Sweat</th><th>sRPE</th><th>Intensity</th>
            <th>Dur</th><th>Workload</th><th>Pain</th><th>Location</th><th>Joint / °</th><th>ROM%</th><th>Sleep</th><th>Window</th>
          </tr></thead>
          <tbody>${rawRows(a, checkins)}</tbody>
        </table>
      </div>
    </section>
  `;
}

function rawRows(a, checkins) {
  if (!checkins.length) return '<tr><td colspan="17" class="muted">No data</td></tr>';
  return checkins.slice().reverse().map((c) => {
    const loss = fluidLossPct(c.pre_weight_kg, c.post_weight_kg);
    const rom = c.rom_percentage;
    const wl = c.workload;
    const rt = tierMeta(evaluateReadinessStatus(c));
    return `<tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td><span class="tier ${rt.cls}">${rt.icon} ${rt.tier}</span></td>
      <td>${c.body_mass_kg != null ? c.body_mass_kg + ' kg' : '—'}</td>
      <td>${(() => { if (c.bp_systolic == null || c.bp_diastolic == null) return '—'; const cat = bpCategory(c.bp_systolic, c.bp_diastolic); return `<span class="${cat && cat.cls !== 'green' ? (cat.cls === 'red' ? 'cell-red' : 'cell-yellow') : ''}">${c.bp_systolic}/${c.bp_diastolic}</span>`; })()}</td>
      <td>${c.pre_weight_kg ?? '—'} / ${c.post_weight_kg ?? '—'}</td>
      <td class="${loss != null && loss > 2 ? 'cell-red' : ''}">${loss != null ? loss.toFixed(1) + '%' : '—'}</td>
      <td>${c.sweat_rate_lph != null ? c.sweat_rate_lph.toFixed(2) + ' L/h' : '—'}</td>
      <td>${c.srpe ?? '—'}</td>
      <td>${esc(c.intensity_level || '—')}</td>
      <td>${c.duration_mins ?? '—'}</td>
      <td>${wl ?? '—'}</td>
      <td>${c.pain_score ?? '—'}</td>
      <td>${esc(c.pain_location || '—')}${(c.pain_symptoms && c.pain_symptoms.length) ? ` <span class="pill" title="${esc(c.pain_symptoms.join('; '))}">${c.pain_symptoms.length} symptom${c.pain_symptoms.length === 1 ? '' : 's'}</span>` : ''}${c.pain_period ? ` <span class="muted small">· ${esc(c.pain_period)}</span>` : ''}</td>
      <td>${esc(c.joint_tested || '—')}${c.goniometer_degrees != null ? ' · ' + c.goniometer_degrees + '°' : ''}</td>
      <td class="${rom != null && rom < 60 ? 'cell-red' : ''}">${rom != null ? rom.toFixed(0) + '%' : '—'}</td>
      <td class="${c.sleep_hours != null && c.sleep_hours < 6 ? 'cell-yellow' : ''}">${sleepDisplay(c)}</td>
      <td>${c.sleep_start && c.sleep_end ? esc(c.sleep_start + '–' + c.sleep_end) : '—'}</td>
    </tr>`;
  }).join('');
}

function bindCoach() {
  root.querySelectorAll('[data-ath]').forEach((b) =>
    b.addEventListener('click', () => {
      state.selectedAthlete = b.dataset.ath;
      root.querySelector('#coach-detail').innerHTML = coachDetail();
      bindCoachDetail(); // re-bind only the freshly rendered detail controls
      root.querySelectorAll('.athlete-card').forEach((c) => c.classList.toggle('sel', c.dataset.ath === state.selectedAthlete));
    }));

  // Status filter buttons
  root.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => { state.rosterFilter = b.dataset.filter; render(); }));

  bindCoachDetail();
}

// Binds controls that live inside the (re-renderable) detail pane.
function bindCoachDetail() {
  const ovWrap = root.querySelector('.override-btns');
  if (!ovWrap) return;
  const athleteId = ovWrap.dataset.athlete;
  ovWrap.querySelectorAll('.ov-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const tier = b.dataset.ov; // '' resets to auto
      let note = '';
      if (tier) note = prompt(`Override note for setting ${tier} (optional):`, '') || '';
      setOverride(athleteId, tier || null, note);
      render(); // override affects roster colours + filters
    }));
}

render();
