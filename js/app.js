// app.js — UI controller for the Eastside FC Rehab & Monitoring App
import {
  getAthletes, addAthlete, updateAthlete, saveCheckin, deleteCheckin, checkinsForAthlete,
  fluidLossPct, totalWorkload, romPct, formatSgt, sgtDay,
  getOverride, setOverride,
  getHydrationToday, addBottle, removeBottle, DEFAULT_BOTTLE_ML,
  INTENSITY_LEVELS, HIGH_INTENSITY, SLEEP_TIERS, MACRO_TAGS,
} from './store.js';

// Athlete lookup helper (for ROM baseline access at render time).
function athleteById(id) { return getAthletes().find((a) => a.id === id); }
import { evaluateAthlete, readinessTier, evaluateReadinessStatus, tierMeta } from './alerts.js';
// NOTE: alerts.js import is placed above the helpers that use it (hoisted ES import).
import {
  romChart, painIntensityChart, hydrationChart, sleepMatrixChart, nutritionChart,
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
      <div class="tz">🕒 Auto-timestamped · Singapore Time (SGT, UTC+8)</div>
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

// Hydration tracker: a health-bar + bottle button (+1) for today's water intake.
function hydrationTracker() {
  if (!state.selectedAthlete) return '';
  const a = athleteById(state.selectedAthlete);
  if (!a) return '';
  const bottleMl = a.bottleMl || DEFAULT_BOTTLE_ML;
  const goal = a.hydrationGoalMl || 3000;
  const today = getHydrationToday(a.id);
  const pct = Math.min(100, Math.round((today.ml / goal) * 100));
  const goalReached = today.ml >= goal;
  const barCls = pct >= 100 ? 'full' : pct >= 50 ? 'ok' : 'low';

  return `
  <section class="panel hydration-panel">
    <div class="panel-head">
      <h2>💧 Hydration — Today (SGT)</h2>
      <label class="bottle-cap">Bottle capacity (ml)
        <input type="number" id="bottle-ml" min="50" step="50" value="${bottleMl}">
      </label>
    </div>
    <div class="hydration-row">
      <button class="bottle-btn" id="bottle-add" title="Tap the bottle each time you finish it (+${bottleMl} ml)">
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
          <button class="link-del" id="bottle-remove" ${today.taps === 0 ? 'disabled' : ''}>undo −1</button>
          ${goalReached ? '<span class="pill ok">🎯 Goal reached!</span>' : ''}
        </div>
      </div>
    </div>
  </section>`;
}

function athleteView(athletes) {
  const opts = athletes.map((a) =>
    `<option value="${a.id}" ${a.id === state.selectedAthlete ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  const a = athleteById(state.selectedAthlete);
  const profile = a ? `<div class="athlete-profile muted small">
      ${a.age != null ? `Age ${a.age}` : ''}${a.age != null && a.currentWeight != null ? ' · ' : ''}${a.currentWeight != null ? `${a.currentWeight} kg` : ''}
    </div>` : '';

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
      </div>
    </div>

    <form id="checkin-form" class="form-grid">
      <fieldset>
        <legend>⚖️ Body Mass</legend>
        <label>Pre-session weight (kg)<input type="number" step="0.1" name="pre_weight_kg"></label>
        <label>Post-session weight (kg)<input type="number" step="0.1" name="post_weight_kg"></label>
      </fieldset>

      <fieldset>
        <legend>🔥 Training Load &amp; Intensity</legend>
        <label>Session RPE (1–10)<input type="number" min="1" max="10" name="srpe"></label>
        <label>Intensity level
          <select name="intensity_level">
            <option value="">—</option>
            ${INTENSITY_LEVELS.map((l) => `<option>${l}</option>`).join('')}
          </select>
        </label>
        <label>Duration (min)<input type="number" min="0" name="duration_mins"></label>
      </fieldset>

      <fieldset>
        <legend>🤕 Pain &amp; Injury</legend>
        <label>Pain score NPRS (0–10)<input type="number" min="0" max="10" name="pain_score"></label>
        <label>Pain location<input type="text" name="pain_location" placeholder="e.g. Left Ankle"></label>
      </fieldset>

      <fieldset>
        <legend>📐 Range of Motion</legend>
        <label>Joint tested<input type="text" name="joint_tested" placeholder="e.g. Ankle Dorsiflexion"></label>
        <label>Goniometer angle (°)<input type="number" min="0" max="360" name="goniometer_degrees"></label>
        <small class="hint">Mapped to % of this athlete's baseline automatically.</small>
      </fieldset>

      <fieldset>
        <legend>😴 Sleep</legend>
        <label>Duration (hrs)<input type="number" step="0.5" min="0" max="24" name="sleep_hours"></label>
        <label>Quality (1–10)<input type="number" min="1" max="10" name="sleep_quality"></label>
        <label>Tier
          <select name="sleep_tier">
            <option value="">—</option>
            ${SLEEP_TIERS.map((t) => `<option>${t}</option>`).join('')}
          </select>
        </label>
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
  `;
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
      <td>${c.sleep_hours != null ? c.sleep_hours + 'h' : '—'}</td>
      <td><button class="link-del" data-del="${c.id}">delete</button></td>
    </tr>`;
  }).join('');
  return `
  <section class="panel">
    <h2>Recent check-ins</h2>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Timestamp (SGT)</th><th>Intensity</th><th>sRPE</th><th>Workload</th>
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
    const currentWeight = prompt(`Current weight (kg) for ${name}?`, '');
    const age = prompt(`Age for ${name}?`, '');
    const baseline = prompt('Baseline ROM joint angle in degrees (e.g. 135)?', '135');
    const bottleMl = prompt('Water bottle capacity (ml)?', String(DEFAULT_BOTTLE_ML));
    const a = addAthlete({ name, romBaseline: baseline, currentWeight, age, bottleMl });
    state.selectedAthlete = a.id;
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
    const a = athleteById(state.selectedAthlete);
    removeBottle(state.selectedAthlete, (a && a.bottleMl) || DEFAULT_BOTTLE_ML);
    render();
  });

  root.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => { deleteCheckin(b.dataset.del); render(); }));

  const form = root.querySelector('#checkin-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const num = (k) => (f.get(k) !== '' && f.get(k) != null ? Number(f.get(k)) : null);
    const str = (k) => (f.get(k) ? String(f.get(k)).trim() : '');

    const input = {
      athleteId: state.selectedAthlete,
      pre_weight_kg: num('pre_weight_kg'),
      post_weight_kg: num('post_weight_kg'),
      joint_tested: str('joint_tested'),
      goniometer_degrees: num('goniometer_degrees'),
      pain_score: num('pain_score'),
      pain_location: str('pain_location'),
      srpe: num('srpe'),
      intensity_level: str('intensity_level') || null,
      duration_mins: num('duration_mins'),
      sleep_hours: num('sleep_hours'),
      sleep_quality: num('sleep_quality'),
      sleep_tier: str('sleep_tier') || null,
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

  // chart series
  const romSeries = checkins.filter((c) => c.rom_percentage != null || c.goniometer_degrees != null).map((c) => ({
    label: sgtDay(c.timestampUtc).slice(5),
    pct: c.rom_percentage != null ? c.rom_percentage : romPct(c.goniometer_degrees, a.romBaseline),
  }));
  const painSeries = checkins.filter((c) => c.srpe != null || c.pain_score != null).map((c) => ({
    label: sgtDay(c.timestampUtc).slice(5), srpe: c.srpe, pain: c.pain_score,
  }));
  const hydSeries = checkins.filter((c) => c.pre_weight_kg != null || c.post_weight_kg != null).map((c) => ({
    label: sgtDay(c.timestampUtc).slice(5), pre: c.pre_weight_kg, post: c.post_weight_kg,
    lossPct: fluidLossPct(c.pre_weight_kg, c.post_weight_kg),
  }));
  const sleepPts = checkins.filter((c) => c.sleep_hours != null).map((c) => {
    const q = c.sleep_quality != null ? c.sleep_quality
      : (c.sleep_tier === 'Restorative' ? 9 : c.sleep_tier === 'Average' ? 6 : c.sleep_tier === 'Poor' ? 3 : 5);
    const tier = c.sleep_hours < 5 ? 'red' : c.sleep_hours < 6 ? 'yellow' : 'green';
    return { hours: c.sleep_hours, quality: q, tier };
  });
  const nutSeries = checkins.filter((c) => c.srpe != null && c.duration_mins != null).map((c) => {
    const nl = c.nutrition_log || {};
    return {
      label: sgtDay(c.timestampUtc).slice(5),
      workload: c.workload,
      fueled: !!(nl.pre_workout_meal && nl.pre_workout_meal.trim()) && nl.fueled_before_session === true,
    };
  });

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
      <h2>${esc(a.name)} <span class="muted small">· baseline ROM ${a.romBaseline}°</span></h2>
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
      <div class="charts">
        <div class="chart-card">${romChart(romSeries)}</div>
        <div class="chart-card">${painIntensityChart(painSeries)}</div>
        <div class="chart-card">${hydrationChart(hydSeries)}</div>
        <div class="chart-card">${sleepMatrixChart(sleepPts)}</div>
        <div class="chart-card">${nutritionChart(nutSeries)}</div>
      </div>
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
            <th>SGT</th><th>Readiness</th><th>Pre/Post kg</th><th>Fluid%</th><th>sRPE</th><th>Intensity</th>
            <th>Dur</th><th>Workload</th><th>Pain</th><th>Location</th><th>Joint / °</th><th>ROM%</th><th>Sleep</th><th>Qual</th>
          </tr></thead>
          <tbody>${rawRows(a, checkins)}</tbody>
        </table>
      </div>
    </section>
  `;
}

function rawRows(a, checkins) {
  if (!checkins.length) return '<tr><td colspan="14" class="muted">No data</td></tr>';
  return checkins.slice().reverse().map((c) => {
    const loss = fluidLossPct(c.pre_weight_kg, c.post_weight_kg);
    const rom = c.rom_percentage;
    const wl = c.workload;
    const rt = tierMeta(evaluateReadinessStatus(c));
    return `<tr>
      <td>${esc(formatSgt(c.timestampUtc))}</td>
      <td><span class="tier ${rt.cls}">${rt.icon} ${rt.tier}</span></td>
      <td>${c.pre_weight_kg ?? '—'} / ${c.post_weight_kg ?? '—'}</td>
      <td class="${loss != null && loss > 2 ? 'cell-red' : ''}">${loss != null ? loss.toFixed(1) + '%' : '—'}</td>
      <td>${c.srpe ?? '—'}</td>
      <td>${esc(c.intensity_level || '—')}</td>
      <td>${c.duration_mins ?? '—'}</td>
      <td>${wl ?? '—'}</td>
      <td>${c.pain_score ?? '—'}</td>
      <td>${esc(c.pain_location || '—')}</td>
      <td>${esc(c.joint_tested || '—')}${c.goniometer_degrees != null ? ' · ' + c.goniometer_degrees + '°' : ''}</td>
      <td class="${rom != null && rom < 60 ? 'cell-red' : ''}">${rom != null ? rom.toFixed(0) + '%' : '—'}</td>
      <td class="${c.sleep_hours != null && c.sleep_hours < 6 ? 'cell-yellow' : ''}">${c.sleep_hours != null ? c.sleep_hours + 'h' : '—'}</td>
      <td>${c.sleep_quality ?? (c.sleep_tier || '—')}</td>
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
