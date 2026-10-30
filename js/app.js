// app.js — UI controller for the Eastside FC Rehab & Monitoring App
import {
  getAthletes, addAthlete, updateAthlete, deleteAthlete, saveCheckin, deleteCheckin, checkinsForAthlete,
  fluidLossPct, totalWorkload, romPct, sweatRateLph, bpCategory, sleepHoursBetween, sleepMinutesBetween, formatHoursMinutes, formatSgt, sgtDay,
  getOverride, setOverride,
  getHydrationToday, addBottle, removeBottle, DEFAULT_BOTTLE_ML,
  hydrationGoalMl, exerciseMinutesToday,
  exportData, importData,
  COMBAT_TYPES, INTENSITY_LEVELS, HIGH_INTENSITY, MACRO_TAGS, PAIN_SYMPTOMS,
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

// Hydration tracker: a health-bar + bottle button (+1) + a timestamped log.
// Daily goal is computed from body weight (30–40 ml/kg) plus today's exercise
// (500–1000 ml per hour trained).
function hydrationTracker() {
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

  // Goal breakdown explainer
  const goalExplain = g.weight
    ? `Target = ${g.baseline} ml (${g.weight} kg × 35 ml/kg)` +
      (g.exercise > 0 ? ` + ${g.exercise} ml (${g.exerciseHours.toFixed(1)} h exercise × 750 ml/h)` : '')
    : 'Add a body weight to this athlete for a personalised target.';

  // Timestamped water log (most recent first)
  const logRows = (today.entries || []).slice().reverse().map((e, i, arr) => `
    <tr>
      <td>${arr.length - i}</td>
      <td>${esc(e.label || e.sgt || '')}</td>
      <td>+${e.ml} ml</td>
    </tr>`).join('');

  return `
  <section class="panel hydration-panel">
    <div class="panel-head">
      <h2>💧 Hydration — Today (SGT)</h2>
      <label class="bottle-cap">Bottle capacity (ml)
        <input type="number" id="bottle-ml" min="50" step="50" value="${bottleMl}">
      </label>
    </div>
    <div class="hydration-row">
      <button class="bottle-btn" id="bottle-add" title="Tap each time you finish a bottle (+${bottleMl} ml)">
        <span class="bottle-emoji">🍶</span>
        <span class="bottle-plus">+1</span>
      </button>
      <div class="hydration-bar-wrap">
        <div class="hydration-bar">
          <div class="hydration-fill ${barCls}" style="width:${pct}%"></div>
          <span class="hydration-label">${today.ml} / ${goal} ml · ${pct}%</span>
        </div>
        <div class="hydration-meta">
          <span>${today.taps} bottle${today.taps === 1 ? '' : 's'} drunk today</span>
          <button class="link-del" id="bottle-remove" ${today.taps === 0 ? 'disabled' : ''}>undo last</button>
          ${goalReached ? '<span class="pill ok">🎯 Goal reached!</span>' : ''}
        </div>
        <div class="hydration-goal-explain muted small">${esc(goalExplain)}</div>
      </div>
    </div>
    <div class="water-log">
      <h3>🕒 Water log — today</h3>
      ${today.entries && today.entries.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Time (SGT)</th><th>Amount</th></tr></thead>
          <tbody>${logRows}</tbody>
        </table>
      </div>` : '<p class="muted">No water logged yet today — tap the bottle to start.</p>'}
    </div>
  </section>`;
}

function athleteView(athletes) {
  const opts = athletes.map((a) =>
    `<option value="${a.id}" ${a.id === state.selectedAthlete ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  const a = athleteById(state.selectedAthlete);
  const profileBits = a ? [
    a.combatType,
    a.gender,
    a.age != null ? `Age ${a.age}` : null,
    a.currentWeight != null ? `${a.currentWeight} kg` : null,
  ].filter(Boolean) : [];
  const profile = profileBits.length
    ? `<div class="athlete-profile muted small">${profileBits.map(esc).join(' · ')}</div>` : '';

  return `
  ${athleteAlertBanner()}
  ${hydrationTracker()}
  <section class="panel">
    ${profile}
    <div class="panel-head">
      <h2>Daily / Session Check-in</h2>
      <div class="athlete-pick">
        <label>Athlete
          <select id="athlete-select">${opts}</select>
        </label>
        <button class="ghost" id="add-athlete">+ New athlete</button>
        ${a ? `<button class="danger" id="delete-athlete" title="Delete this athlete and all their data">🗑 Delete profile</button>` : ''}
      </div>
    </div>

    <form id="checkin-form" class="form-grid">
      <div class="sync-note">
        ℹ️ <strong>Data is stored on this device only</strong> (in this browser). To use your athletes on another device, click <strong>⬇ Export</strong> up top, then <strong>⬆ Import</strong> the file on the other device.
      </div>
      <div class="body-mass-row">
        <fieldset class="body-mass-fieldset">
          <legend>⚖️ Body Mass</legend>
          <label>Body mass (kg)<input type="number" step="0.1" name="body_mass_kg"></label>
          <small class="hint">Each recording is auto-timestamped in SGT and added to the log beside this.</small>
        </fieldset>
        <div class="body-mass-log-inline">
          <span class="field-label">⚖️ Body Mass log <span class="muted small">· timestamped (SGT)</span></span>
          ${a ? bodyMassLogTable(checkinsForAthlete(a.id)) : '<p class="muted">Select an athlete.</p>'}
        </div>
      </div>

      <div class="body-mass-row">
        <fieldset class="body-mass-fieldset">
          <legend>🩺 Blood Pressure</legend>
          <label>Systolic (mmHg)<input type="number" min="40" max="300" name="bp_systolic" id="bp-systolic" placeholder="e.g. 120"></label>
          <label>Diastolic (mmHg)<input type="number" min="30" max="200" name="bp_diastolic" id="bp-diastolic" placeholder="e.g. 80"></label>
          <div class="sweat-result">
            <span class="sweat-label">Reading</span>
            <span class="sweat-value" id="bp-category-display">—</span>
          </div>
          <small class="hint">Each reading is auto-timestamped in SGT and added to the log beside this.</small>
        </fieldset>
        <div class="body-mass-log-inline">
          <span class="field-label">🩺 Blood Pressure log <span class="muted small">· timestamped (SGT)</span></span>
          ${a ? bpLogTable(checkinsForAthlete(a.id)) : '<p class="muted">Select an athlete.</p>'}
        </div>
      </div>

      <fieldset>
        <legend>🔥 Training Load &amp; Intensity</legend>
        <label>Session RPE (1–10)
          <select name="srpe">
            <option value="">—</option>
            ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<option value="${n}">${n}</option>`).join('')}
          </select>
        </label>
        <label>Type of training
          <select name="intensity_level">
            <option value="">—</option>
            ${INTENSITY_LEVELS.map((l) => `<option>${l}</option>`).join('')}
          </select>
        </label>
        <label>Duration (min)<input type="number" min="0" name="duration_mins" id="duration-mins"></label>
        <label>Pre-session weight (kg)<input type="number" step="0.1" name="pre_weight_kg" id="pre-weight"></label>
        <label>Post-session weight (kg)<input type="number" step="0.1" name="post_weight_kg" id="post-weight"></label>
        <div class="sweat-result">
          <span class="sweat-label">Sweat rate</span>
          <span class="sweat-value" id="sweat-rate-display">—</span>
        </div>
        <small class="hint">Sweat rate = (pre − post + water drunk today) ÷ hours trained.</small>
      </fieldset>

      <fieldset class="wide">
        <legend>🤕 Pain &amp; Injury</legend>

        <div class="pain-symptoms">
          <span class="field-label">Pain symptoms <span class="muted small">(select any that apply)</span></span>
          <div class="tag-row">
            ${PAIN_SYMPTOMS.map((s) => `<label class="tag"><input type="checkbox" name="pain_symptom" value="${esc(s)}">${esc(s)}</label>`).join('')}
          </div>
        </div>

        <div class="pain-grid">
          <label>Pain score NPRS (0–10)
            <select name="pain_score">
              <option value="">—</option>
              ${Array.from({ length: 11 }, (_, i) => i).map((n) => `<option value="${n}">${n}${n === 0 ? ' (no pain)' : ''}</option>`).join('')}
            </select>
          </label>
          <label>Pain location<input type="text" name="pain_location" placeholder="e.g. Left Ankle"></label>
          <label>Pain period<input type="text" name="pain_period" placeholder="e.g. 3 days, since last sparring"></label>
        </div>

        <label>How did it happen? <span class="muted small">(optional)</span>
          <textarea name="pain_description" rows="2" placeholder="Describe what you were doing when the pain started…"></textarea>
        </label>
        <label>Actions taken to reduce the pain <span class="muted small">(optional)</span>
          <textarea name="pain_actions" rows="2" placeholder="e.g. Iced for 15 min, rested, taped the wrist, stretched…"></textarea>
        </label>

        <a href="#" class="treat-link" id="treat-injuries-link">📋 How to treat injuries in the gym</a>
      </fieldset>

      <fieldset>
        <legend>📐 Range of Motion</legend>
        <label>Joint tested<input type="text" name="joint_tested" placeholder="e.g. Ankle Dorsiflexion"></label>
        <label>Goniometer angle (°)<input type="number" min="0" max="360" name="goniometer_degrees"></label>
        <label>Baseline ROM (°)<input type="number" min="1" max="360" name="rom_baseline" id="rom-baseline" value="${a ? a.romBaseline : 135}"></label>
        <small class="hint">Goniometer angle is mapped to % of this baseline automatically. Updating it here saves to the athlete's profile.</small>
      </fieldset>

      <fieldset>
        <legend>😴 Sleep</legend>
        <div class="sleep-tracker">
          <div class="sleep-times">
            <label>Slept at
              <div class="time-row">
                <input type="time" name="sleep_start" id="sleep-start">
                <button type="button" class="ghost sleep-now" data-target="sleep-start">now</button>
              </div>
            </label>
            <label>Woke at
              <div class="time-row">
                <input type="time" name="sleep_end" id="sleep-end">
                <button type="button" class="ghost sleep-now" data-target="sleep-end">now</button>
              </div>
            </label>
          </div>
          <div class="sleep-result">
            <span class="sleep-hours-label">Sleep duration</span>
            <span class="sleep-hours-value" id="sleep-hours-display">—</span>
            <input type="hidden" name="sleep_hours" id="sleep-hours">
            <input type="hidden" name="sleep_minutes" id="sleep-minutes">
          </div>
        </div>
        <small class="hint">Tap “now” at bedtime and again on waking — hours are calculated automatically (overnight supported).</small>
      </fieldset>

      <fieldset class="wide">
        <legend>🍽️ Qualitative Nutrition Log</legend>
        <label>Pre-workout meal<input type="text" name="pre_workout_meal" placeholder="e.g. Chicken rice, electrolyte water, 2.5h before"></label>
        <label>Post-workout meal<input type="text" name="post_workout_meal" placeholder="e.g. Whey shake, banana, rice with beef"></label>
        <label>Main meal<input type="text" name="main_meal" placeholder="e.g. Grilled fish, veg, sweet potato"></label>
        <label class="check-inline">Fueled before session (ate 2–3 h prior)?
          <input type="checkbox" name="fueled_before_session">
        </label>
        <div class="tag-row" id="macro-tags">
          ${MACRO_TAGS.map((t) => `<label class="tag"><input type="checkbox" name="quality_tag" value="${t}">${t}</label>`).join('')}
        </div>
      </fieldset>

      <div class="form-actions">
        <button type="submit" class="primary">Save check-in</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </form>
  </section>

  ${recentCheckins()}
  ${athleteCharts()}
  `;
}

// "My Progress" — the athlete's own graphs & charts for all their metrics.
function athleteCharts() {
  if (!state.selectedAthlete) return '';
  const a = athleteById(state.selectedAthlete);
  if (!a) return '';
  const checkins = checkinsForAthlete(a.id);
  if (!checkins.length) {
    return '<section class="panel"><h2>📊 My Progress</h2><p class="muted">Save a few check-ins to see your trends here.</p></section>';
  }
  return `
  <section class="panel">
    <h2>📊 My Progress <span class="muted small">· your personal trends across all metrics</span></h2>
    <div class="charts">${renderCharts(a, checkins)}</div>
  </section>
  ${dietLog(checkins)}`;
}

// Timestamped Body Mass log — every body-mass recording with its SGT time.
// Table markup for the blood-pressure log (every reading, timestamped).
function bpLogTable(checkins) {
  const list = checkins.filter((c) => c.bp_systolic != null && c.bp_diastolic != null).slice().reverse();
  if (!list.length) return '<p class="muted">No blood-pressure readings yet. Enter systolic & diastolic to start the log.</p>';
  const rows = list.map((c) => {
    const cat = bpCategory(c.bp_systolic, c.bp_diastolic);
    return `<tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td>${c.bp_systolic}/${c.bp_diastolic} mmHg</td>
      <td>${cat ? `<span class="tier ${cat.cls}">${cat.label}</span>` : '—'}</td>
    </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Time (SGT)</th><th>Reading</th><th>Category</th></tr></thead>
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

// Timestamped diet / nutrition log sheet (most recent first). Shows each
// logged meal entry with its SGT time, meal window, macro tags and fueling.
function dietLog(checkins) {
  // Flatten each check-in's nutrition_log into per-meal rows, keeping the
  // check-in's SGT timestamp against every meal entry.
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

  return `
  <section class="panel">
    <h3>🍽️ Diet Log <span class="muted small">· every meal entry, timestamped (SGT)</span></h3>
    ${rows.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Time (SGT)</th><th>Window</th><th>Meal</th><th>Fueling</th><th>Tags</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>` : '<p class="muted">No meals logged yet. Add meals in the Nutrition section of a check-in.</p>'}
  </section>`;
}

function recentCheckins() {
  if (!state.selectedAthlete) return '';
  const athletes = getAthletes();
  const athlete = athletes.find((a) => a.id === state.selectedAthlete);
  const list = checkinsForAthlete(state.selectedAthlete).slice().reverse().slice(0, 8);
  if (!list.length) return '<section class="panel"><p class="muted">No check-ins yet for this athlete.</p></section>';
  const rows = list.map((c) => {
    const loss = fluidLossPct(c.pre_weight_kg, c.post_weight_kg);
    const rom = c.rom_percentage;
    const wl = c.workload;
    return `<tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td>${c.intensity_level ? esc(c.intensity_level) : '—'}</td>
      <td>${c.srpe ?? '—'}</td>
      <td>${wl != null ? wl : '—'}</td>
      <td>${c.pain_score ?? '—'}</td>
      <td>${rom != null ? rom.toFixed(0) + '%' : '—'}</td>
      <td>${loss != null ? loss.toFixed(1) + '%' : '—'}</td>
      <td>${sleepDisplay(c)}</td>
      <td><button class="link-del" data-del="${c.id}">delete</button></td>
    </tr>`;
  }).join('');
  return `
  <section class="panel">
    <h2>Recent check-ins</h2>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Timestamp (SGT)</th><th>Training type</th><th>sRPE</th><th>Workload</th>
          <th>Pain</th><th>ROM%</th><th>Fluid loss</th><th>Sleep</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function bindAthleteForm() {
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
    // Baseline ROM is set from the check-in form (below the ROM inputs);
    // bottle capacity is set beside the hydration bar. Both use defaults here.
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
    const msg = root.querySelector('#save-msg');
    msg.textContent = '✓ Saved with SGT timestamp';
    msg.classList.add('show');
    setTimeout(render, 700);
  });
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

  const sleepSeries = days.map((d) => ({
    label: d.label,
    hours: avg(d.items, (c) => c.sleep_hours),
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
