// input.js — Athlete INPUT app controller.
// Three logs that mirror the dashboard tabs:
//   • Daily log     — body mass, blood pressure, sleep, hydration
//   • Training log   — training load, pain & injury
//   • Mental log     — RESTQ / POMS / TSCI / SMS-II questionnaires
// Data is written to the same localStorage the Dashboard reads from.
import {
  getAthletes, addAthlete, updateAthlete, deleteAthlete, saveCheckin, saveMentalLog,
  checkinsForAthlete, mentalLogsForAthlete, lastBodyMass, hydrationMlForDay,
  sweatRateLph, bpCategory, sleepHoursBetween, sleepMinutesBetween, formatHoursMinutes, formatSgt, sgtDay,
  getHydrationToday, addBottle, removeBottle, DEFAULT_BOTTLE_ML,
  hydrationGoalMl, exerciseMinutesToday,
  exportData, importData, pullState, startSync, isShared, resolveBackend,
  BP_TIMINGS, INTENSITY_LEVELS, PAIN_SYMPTOMS,
} from './store.js?v=7';
import { QUESTIONNAIRES, itemId } from './psych.js?v=7';
import { hydrationWeekChart, bpWeekChart, bodyMassWeekChart, sleepChart } from './charts.js?v=7';

const root = document.getElementById('app');
// section = top-level ('physio' | 'mental'); physioSub = 'daily' | 'training'
let state = { section: 'physio', physioSub: 'daily', selectedAthlete: null };

function athleteById(id) { return getAthletes().find((a) => a.id === id); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------- Shell --------------------------------- */
function render() {
  const athletes = getAthletes();
  if (!state.selectedAthlete && athletes.length) state.selectedAthlete = athletes[0].id;
  const a = athleteById(state.selectedAthlete);

  const opts = athletes.map((x) =>
    `<option value="${x.id}" ${x.id === state.selectedAthlete ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="logo">🥊</span>
        <div>
          <h1>Eastside FC</h1>
          <p>Athlete Input</p>
        </div>
      </div>
      <nav class="tabs">
        <button class="tab ${state.section === 'physio' ? 'active' : ''}" data-section="physio">🫀 Physiological</button>
        <button class="tab ${state.section === 'mental' ? 'active' : ''}" data-section="mental">🧠 Mental log</button>
      </nav>
      <div class="athlete-picker-top">
        <select id="athlete-select" title="Select athlete">${opts || '<option>No athletes</option>'}</select>
        <button class="ghost" id="add-athlete" title="Add a new athlete">+ New</button>
        ${a ? '<button class="danger" id="delete-athlete" title="Delete this athlete and all data">🗑</button>' : ''}
      </div>
      <div class="tz">🕒 SGT (UTC+8)</div>
      <div class="data-actions">
        <button class="ghost" id="export-data" title="Download all data as a file">⬇ Export</button>
        <button class="ghost" id="import-data" title="Load data from an exported file">⬆ Import</button>
        <input type="file" accept="application/json,.json" id="import-file" hidden>
        <a class="ghost" href="dashboard.html" title="Open the coach dashboard">📊 Dashboard →</a>
      </div>
    </header>
    <main>${!a ? '<section class="panel"><p class="muted">Add an athlete to start logging.</p></section>'
      : state.section === 'mental' ? mentalLog(a)
      : physioSection(a)}</main>
  `;

  bindShell();
  if (!a) return;
  if (state.section === 'mental') { bindMental(a); return; }
  // Physiological section
  if (state.physioSub === 'daily') bindDaily(a);
  else bindTraining(a);
}

// Physiological section = a Daily / Training sub-tab bar + the chosen log.
function physioSection(a) {
  const subBar = `
    <div class="subtabs">
      <button class="subtab ${state.physioSub === 'daily' ? 'active' : ''}" data-sub="daily">📅 Daily log</button>
      <button class="subtab ${state.physioSub === 'training' ? 'active' : ''}" data-sub="training">🔥 Training log</button>
    </div>`;
  return subBar + (state.physioSub === 'daily' ? dailyLog(a) : trainingLog(a));
}

function bindShell() {
  root.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => { state.section = b.dataset.section; render(); }));

  root.querySelectorAll('[data-sub]').forEach((b) =>
    b.addEventListener('click', () => { state.physioSub = b.dataset.sub; render(); }));

  const sel = root.querySelector('#athlete-select');
  if (sel) sel.addEventListener('change', () => { state.selectedAthlete = sel.value; render(); });

  const addBtn = root.querySelector('#add-athlete');
  if (addBtn) addBtn.addEventListener('click', () => {
    const name = prompt('Athlete name?');
    if (!name) return;
    let gender = prompt(`Gender for ${name}? (Male / Female)`, '');
    if (gender) { const g = gender.trim().toLowerCase(); gender = g.startsWith('m') ? 'Male' : g.startsWith('f') ? 'Female' : gender.trim(); }
    let combatType = prompt(`Type of combat for ${name}? (Boxing / Muay Thai)`, '');
    if (combatType) { const c = combatType.trim().toLowerCase(); combatType = c.startsWith('b') ? 'Boxing' : c.startsWith('m') ? 'Muay Thai' : combatType.trim(); }
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
    if (!confirm(`Delete ${a.name}'s profile? This permanently removes all their data.`)) return;
    deleteAthlete(a.id);
    const remaining = getAthletes();
    state.selectedAthlete = remaining.length ? remaining[0].id : null;
    render();
  });

  const exportBtn = root.querySelector('#export-data');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const bundle = exportData();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `eastside-fc-data-${bundle.exportedAt.slice(0, 10)}.json`; link.click();
    URL.revokeObjectURL(url);
  });
  const importBtn = root.querySelector('#import-data');
  const importFile = root.querySelector('#import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let bundle; try { bundle = JSON.parse(reader.result); } catch { alert('That file could not be read as JSON.'); return; }
        const merge = confirm('Import data.\n\nOK = MERGE (keep current data, add new)\nCancel = REPLACE (overwrite all data on this device)');
        try {
          const res = importData(bundle, merge ? 'merge' : 'replace');
          state.selectedAthlete = null;
          alert(`Import complete (${res.mode}): ${res.athletes} athlete(s), ${res.checkins} check-in(s).`);
          render();
        } catch (e) { alert('Import failed: ' + e.message); }
        finally { importFile.value = ''; }
      };
      reader.readAsText(file);
    });
  }
}

/* ============================== DAILY LOG =============================== */
function dailyLog(a) {
  const prevMass = lastBodyMass(a.id);
  return `
  <div class="daily-log">
    <div class="daily-log-head">
      <div>
        <h1 class="daily-title">Physiological <span class="daily-title-sub">· Daily log</span></h1>
        <p class="daily-sub">BOXING · TRAIN · RECOVER · REPEAT · ${esc(a.name)}</p>
      </div>
      <button class="save-log-btn primary" type="submit" form="daily-form">Save Log</button>
    </div>

    <form id="daily-form" class="dl-grid">

      ${hydrationCard(a)}

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
          <select name="bp_timing"><option value="">—</option>${BP_TIMINGS.map((t) => `<option>${t}</option>`).join('')}</select>
        </label>
        <div class="dl-inline-status"><span id="bp-category-display" class="muted">—</span></div>
      </section>

      <!-- Sleep -->
      <section class="dl-card">
        <div class="dl-card-head"><h3>Sleep</h3><a href="#" class="hist-link" data-history="sleep">History</a></div>
        <label class="dl-field">Type of sleep
          <select name="sleep_type"><option value="Overnight">Overnight sleep</option><option value="Nap">Nap</option></select>
        </label>
        <div class="dl-two">
          <label class="dl-field">Sleep Time<div class="time-row"><input type="time" name="sleep_start" id="sleep-start"><button type="button" class="ghost sleep-now" data-target="sleep-start">now</button></div></label>
          <label class="dl-field">Wake Up<div class="time-row"><input type="time" name="sleep_end" id="sleep-end"><button type="button" class="ghost sleep-now" data-target="sleep-end">now</button></div></label>
        </div>
        <div class="dl-total-row">
          <span class="dl-field-label">Total Hours</span>
          <span class="dl-total-value" id="sleep-hours-display">—</span>
        </div>
        <input type="hidden" name="sleep_hours" id="sleep-hours">
        <input type="hidden" name="sleep_minutes" id="sleep-minutes">
      </section>

      <div class="form-actions dl-wide">
        <button type="submit" class="primary">Save daily log</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </form>
  </div>`;
}

/* ============================= TRAINING LOG ============================= */
function trainingLog(a) {
  return `
  <div class="daily-log">
    <div class="daily-log-head">
      <div>
        <h1 class="daily-title">Physiological <span class="daily-title-sub">· Training log</span></h1>
        <p class="daily-sub">BOXING · TRAIN · RECOVER · REPEAT · ${esc(a.name)}</p>
      </div>
      <button class="save-log-btn primary" type="submit" form="training-form">Save Log</button>
    </div>

    <form id="training-form" class="dl-grid">
      <!-- Training Load + Pain nested under Training -->
      <section class="dl-card dl-wide">
        <div class="dl-card-head"><h3>Training Load &amp; Intensity</h3><a href="#" class="hist-link" data-history="training">History</a></div>
        <div class="dl-row-fields">
          <label class="dl-field">Training Type
            <select name="intensity_level"><option value="">—</option>${INTENSITY_LEVELS.map((l) => `<option>${l}</option>`).join('')}</select>
          </label>
          <label class="dl-field">RPE (1–10)
            <select name="srpe"><option value="">—</option>${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<option value="${n}">${n}</option>`).join('')}</select>
          </label>
          <label class="dl-field">Duration (min)<input type="number" min="0" name="duration_mins" id="duration-mins" placeholder="e.g. 60"></label>
        </div>
        <div class="dl-row-fields">
          <label class="dl-field">Pre-session weight (kg)<input type="number" step="0.1" name="pre_weight_kg" id="pre-weight"></label>
          <label class="dl-field">Post-session weight (kg)<input type="number" step="0.1" name="post_weight_kg" id="post-weight"></label>
          <div class="dl-field-static"><span class="dl-field-label">Sweat rate</span><span class="dl-field-value" id="sweat-rate-display">—</span></div>
        </div>

        <!-- Pain & Symptoms nested under Training -->
        <div class="dl-subsection">
          <div class="dl-card-head"><h4>Pain &amp; Symptoms</h4><a href="#" class="hist-link" data-history="pain">History</a></div>
          <div class="dl-row-fields">
            <label class="dl-field">Pain Level (Rating)
              <select name="pain_score"><option value="">—</option>${Array.from({ length: 11 }, (_, i) => i).map((n) => `<option value="${n}">${n}${n === 0 ? ' (no pain)' : ''}</option>`).join('')}</select>
            </label>
            <label class="dl-field">Type of Pain Felt<input type="text" name="pain_location" placeholder="e.g. Soreness, Left Ankle"></label>
            <label class="dl-field">Pain Time Period<input type="text" name="pain_period" placeholder="e.g. 2 Days"></label>
          </div>
          <div class="pain-symptoms">
            <span class="dl-field-label">Symptoms List <span class="muted small">(select any that apply)</span></span>
            <div class="tag-row">${PAIN_SYMPTOMS.map((s) => `<label class="tag"><input type="checkbox" name="pain_symptom" value="${esc(s)}">${esc(s)}</label>`).join('')}</div>
          </div>
          <label class="dl-field">How did it happen? <span class="muted small">(optional)</span><textarea name="pain_description" rows="2"></textarea></label>
          <label class="dl-field">Actions to reduce pain <span class="muted small">(optional)</span><textarea name="pain_actions" rows="2"></textarea></label>
        </div>
      </section>

      <div class="form-actions dl-wide">
        <button type="submit" class="primary">Save training log</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </form>
  </div>`;
}

/* ============================== MENTAL LOG ============================== */
function questionnaireBlock(q) {
  // A scale is "worded" when its options carry meaningful text (RESTQ, POMS);
  // numeric scales (TSCI 1–9, SMS-II 1–7) instead show end-anchors.
  const worded = q.scaleResponses.some((r) => r.label && r.label !== String(r.v));
  const scaleLegend = worded
    ? q.scaleResponses.map((r) => `${r.v} = ${r.label}`).join('  ·  ')
    : `${q.min} = ${q.anchors ? q.anchors.low : 'low'}  …  ${q.max} = ${q.anchors ? q.anchors.high : 'high'}`;
  let body = '';

  // Each response option shows BOTH the number and its word so the scale is
  // obvious at a glance (no hover needed). Numeric scales show the number with
  // the end-anchor words printed beneath the row.
  const renderItem = (label, id) => `
    <div class="q-item">
      <span class="q-text">${esc(label)}</span>
      <div class="q-answer">
        <div class="q-scale ${worded ? 'worded' : 'numeric'}">
          ${q.scaleResponses.map((r) => `
            <label class="q-opt" title="${esc(r.label)}">
              <input type="radio" name="${id}" value="${r.v}" required>
              <span class="q-opt-num">${r.v}</span>
              ${worded ? `<span class="q-opt-word">${esc(r.label)}</span>` : ''}
            </label>`).join('')}
        </div>
        ${worded ? '' : `<div class="q-anchors"><span>${esc(q.anchors ? q.anchors.low : 'low')}</span><span>${esc(q.anchors ? q.anchors.high : 'high')}</span></div>`}
      </div>
    </div>`;

  if (q.key === 'restq') {
    body = q.scales.map((sc) => `
      <div class="q-group">
        <h4 class="q-group-title ${sc.group === 'stress' ? 'stress' : 'recovery'}">${esc(sc.name)}
          <span class="pill ${sc.group === 'stress' ? 'warn' : 'ok'}">${sc.group}</span></h4>
        ${sc.items.map((t, i) => renderItem(t, itemId('restq', sc.key, i))).join('')}
      </div>`).join('');
  } else if (q.key === 'poms') {
    body = `<p class="q-prompt">Rate how you feel right now.</p>` + q.subscales.map((sub) => `
      <div class="q-group">
        <h4 class="q-group-title ${sub.polarity === 'positive' ? 'recovery' : 'stress'}">${esc(sub.name)}</h4>
        ${sub.items.map((t, i) => renderItem(t, itemId('poms', sub.key, i))).join('')}
      </div>`).join('');
  } else if (q.key === 'tsci') {
    body = `<p class="q-prompt">${esc(q.prompt)}</p>` +
      q.items.map((t, i) => renderItem(t, itemId('tsci', 'item', i))).join('');
  } else if (q.key === 'sms') {
    body = `<p class="q-prompt">${esc(q.prompt)}</p>` + q.subscales.map((sub) => `
      <div class="q-group">
        <h4 class="q-group-title ${sub.raiWeight > 0 ? 'recovery' : 'stress'}">${esc(sub.name)}</h4>
        ${sub.items.map((t, i) => renderItem(t, itemId('sms', sub.key, i))).join('')}
      </div>`).join('');
  }

  return `
    <details class="q-card" ${q.key === 'restq' ? 'open' : ''}>
      <summary><span class="q-title">${esc(q.title)}</span></summary>
      <div class="q-scale-legend"><span class="legend-tag">Scale</span> ${esc(scaleLegend)}</div>
      ${body}
    </details>`;
}

function mentalLog(a) {
  const prior = mentalLogsForAthlete(a.id);
  const priorRows = prior.slice().reverse().slice(0, 8).map((m) => {
    const done = Object.keys(QUESTIONNAIRES).filter((k) => m.responses && m.responses[k] && Object.keys(m.responses[k]).length);
    return `<tr><td>${esc(formatSgt(m.timestampUtc))}</td><td>${done.map((k) => `<span class="pill">${QUESTIONNAIRES[k].shortTitle}</span>`).join(' ') || '—'}</td></tr>`;
  }).join('');

  return `
  <section class="panel">
    <div class="panel-head"><h2>🧠 Mental log <span class="muted small">· ${esc(a.name)}</span></h2></div>
    <div class="sync-note">
      ℹ️ Answer any or all of the four questionnaires, then save. Each submission is auto-timestamped (SGT) and the coach dashboard shows the scored results.
      <br><span class="muted small">Note: item wording below is representative; replace with the official licensed instrument text before real use.</span>
    </div>
    <form id="mental-form">
      ${Object.values(QUESTIONNAIRES).map(questionnaireBlock).join('')}
      <div class="form-actions">
        <button type="submit" class="primary">Save mental log</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </form>
  </section>

  <section class="panel">
    <h3>🕒 Recent mental logs</h3>
    ${prior.length ? `<div class="table-wrap"><table class="data-table" style="max-width:520px">
      <thead><tr><th>Time (SGT)</th><th>Questionnaires completed</th></tr></thead>
      <tbody>${priorRows}</tbody></table></div>` : '<p class="muted">No mental logs yet.</p>'}
  </section>`;
}

/* ---------------------------- Shared tables ----------------------------- */
function bpLogTable(checkins) {
  const list = checkins.filter((c) => c.bp_systolic != null && c.bp_diastolic != null).slice().reverse();
  if (!list.length) return '<p class="muted">No blood-pressure readings yet.</p>';
  const rows = list.map((c) => {
    const cat = bpCategory(c.bp_systolic, c.bp_diastolic);
    return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td><td>${c.bp_timing ? `<span class="pill">${esc(c.bp_timing)}</span>` : '—'}</td>
      <td>${c.bp_systolic}/${c.bp_diastolic} mmHg</td><td>${cat ? `<span class="tier ${cat.cls}">${cat.label}</span>` : '—'}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Timing</th><th>Reading</th><th>Category</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function bodyMassLogTable(checkins) {
  const list = checkins.filter((c) => c.body_mass_kg != null).slice().reverse();
  if (!list.length) return '<p class="muted">No body-mass recordings yet.</p>';
  const rows = list.map((c, i) => {
    const prev = list[i + 1];
    const delta = prev && prev.body_mass_kg != null ? c.body_mass_kg - prev.body_mass_kg : null;
    const deltaStr = delta == null ? '—' : (delta === 0 ? '±0' : (delta > 0 ? '+' : '') + delta.toFixed(1)) + ' kg';
    return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td><td>${c.body_mass_kg} kg</td><td class="${delta != null && delta < 0 ? 'cell-yellow' : ''}">${deltaStr}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Body mass</th><th>Δ vs prev</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* --------------------------- Hydration card ----------------------------- */
function hydrationCard(a) {
  const bottleMl = a.bottleMl || DEFAULT_BOTTLE_ML;
  const g = hydrationGoalMl(a, exerciseMinutesToday(a.id));
  const goal = g.total;
  const today = getHydrationToday(a.id);
  const pct = goal > 0 ? Math.min(100, Math.round((today.ml / goal) * 100)) : 0;
  const barCls = pct >= 100 ? 'full' : pct >= 50 ? 'ok' : 'low';
  const litres = (n) => (n / 1000).toFixed(1) + ' L';
  return `
  <section class="dl-card">
    <div class="dl-card-head"><h3>Hydration</h3><a href="#" class="hist-link" data-history="hydration">History</a></div>
    <div class="hydration-bar"><div class="hydration-fill ${barCls}" style="width:${pct}%"></div></div>
    <div class="hydration-summary"><span class="muted small">Consumed / Goal</span><strong>${litres(today.ml)} / ${litres(goal)}</strong></div>
    <div class="hydration-controls">
      <label class="dl-field bottle-cap">Bottle Capacity<input type="number" id="bottle-ml" min="50" step="50" value="${bottleMl}"> <span class="muted small">ml</span></label>
      <button class="bottle-btn primary" id="bottle-add" type="button" title="Tap each time you finish a bottle (+${bottleMl} ml)">🍶 +1 bottle</button>
    </div>
    <div class="hydration-meta">
      <span>${today.taps} bottle${today.taps === 1 ? '' : 's'} today</span>
      <button class="link-del" id="bottle-remove" type="button" ${today.taps === 0 ? 'disabled' : ''}>undo last</button>
      ${today.ml >= goal ? '<span class="pill ok">🎯 Goal reached!</span>' : ''}
    </div>
  </section>`;
}

/* ------------------------------ History modals --------------------------- */
function historyModal(title, subtitle, bodyHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal history-modal" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head">
        <div><h2>${esc(title)}</h2><p class="daily-sub">${esc(subtitle)}</p></div>
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

function sleepLogTable(nights) {
  if (!nights.length) return '<p class="muted">No overnight sleep logged yet.</p>';
  const rows = nights.slice().reverse().map((c) => `<tr>
    <td>${esc(formatSgt(c.timestampUtc))}</td>
    <td>${c.sleep_start && c.sleep_end ? esc(c.sleep_start + '–' + c.sleep_end) : '—'}</td>
    <td>${c.sleep_minutes != null ? formatHoursMinutes(c.sleep_minutes) : (c.sleep_hours != null ? c.sleep_hours + ' h' : '—')}</td>
    <td>${c.sleep_hours > 10 ? '<span class="pill warn">over 10h</span>' : c.sleep_hours < 7 ? '<span class="pill warn">under 7h</span>' : '<span class="pill ok">7–10h ✓</span>'}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Window</th><th>Duration</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function napLogTable(checkins) {
  const list = checkins.filter((c) => c.sleep_type === 'Nap' && c.sleep_minutes != null).slice().reverse();
  if (!list.length) return '<p class="muted">No naps logged yet.</p>';
  const rows = list.map((c) => {
    const m = c.sleep_minutes;
    const note = m > 90 ? '<span class="cell-red">over 90m</span>' : m < 20 ? '<span class="cell-yellow">under 20m</span>' : '<span class="pill ok">20–90m ✓</span>';
    return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td><td class="${m > 90 ? 'cell-red' : ''}">${formatHoursMinutes(m)}</td><td>${note}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Duration</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function openHistory(kind, a) {
  const checkins = checkinsForAthlete(a.id);
  const sub = 'BOXING · TRACK · RECOVER · REPEAT';

  if (kind === 'hydration') {
    const days = last7Days();
    const series = days.map((d) => ({ label: d.label, day: d.day, ml: hydrationMlForDay(a.id, d.key) }));
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
    const mean = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 10) / 10 : 0;
    const within = list.filter((c) => bpCategory(c.bp_systolic, c.bp_diastolic)?.cls === 'green').length;
    const series = list.slice(-7).map((c) => ({ label: sgtDay(c.timestampUtc).slice(5), sys: c.bp_systolic, dia: c.bp_diastolic }));
    const body = `
      ${summaryCards([
        { k: 'Avg Systolic', v: mean(list.map((c) => c.bp_systolic)) + ' mmHg' },
        { k: 'Avg Diastolic', v: mean(list.map((c) => c.bp_diastolic)) + ' mmHg' },
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
      <h3 class="hist-h3">Overnight sleep log</h3>${sleepLogTable(nights)}
      <h3 class="hist-h3">💤 Nap log</h3>${napLogTable(checkins)}`;
    return historyModal('Sleep History', sub, body);
  }

  if (kind === 'bodymass') {
    const list = checkins.filter((c) => c.body_mass_kg != null);
    const series = list.slice(-7).map((c) => ({ label: sgtDay(c.timestampUtc).slice(5), kg: c.body_mass_kg }));
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
          <td>${esc(formatSgt(c.timestampUtc))}</td><td>${esc(c.intensity_level || '—')}</td><td>${c.srpe ?? '—'}</td>
          <td>${c.duration_mins != null ? c.duration_mins + ' min' : '—'}</td><td>${c.workload != null ? c.workload : '—'}</td></tr>`).join('')
          : '<tr><td colspan="5" class="muted">No sessions logged yet.</td></tr>'}</tbody></table></div>`;
    return historyModal('Training History', sub, body);
  }

  if (kind === 'pain') {
    const list = checkins.filter((c) => c.pain_score != null || (c.pain_symptoms && c.pain_symptoms.length) || c.pain_location);
    const body = `
      <h3 class="hist-h3">Pain &amp; Symptoms History</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Pain</th><th>Type</th><th>Period</th><th>Symptoms</th><th>Actions</th></tr></thead>
        <tbody>${list.length ? list.slice().reverse().map((c) => `<tr>
          <td>${esc(formatSgt(c.timestampUtc))}</td><td>${c.pain_score ?? '—'}</td><td>${esc(c.pain_location || '—')}</td><td>${esc(c.pain_period || '—')}</td>
          <td>${(c.pain_symptoms || []).map((s) => `<span class="pill">${esc(s)}</span>`).join(' ') || '—'}</td><td>${esc(c.pain_actions || '—')}</td></tr>`).join('')
          : '<tr><td colspan="6" class="muted">No pain entries yet.</td></tr>'}</tbody></table></div>`;
    return historyModal('Pain & Symptoms History', sub, body);
  }
}

/* ------------------------------- Bindings ------------------------------- */
function bindHydration(a) {
  const bottleMlInput = root.querySelector('#bottle-ml');
  if (bottleMlInput) bottleMlInput.addEventListener('change', () => {
    updateAthlete(a.id, { bottleMl: Math.max(50, Number(bottleMlInput.value) || DEFAULT_BOTTLE_ML) });
    render();
  });
  const addBottleBtn = root.querySelector('#bottle-add');
  if (addBottleBtn) addBottleBtn.addEventListener('click', () => { addBottle(a.id, (a && a.bottleMl) || DEFAULT_BOTTLE_ML); render(); });
  const removeBottleBtn = root.querySelector('#bottle-remove');
  if (removeBottleBtn) removeBottleBtn.addEventListener('click', () => { removeBottle(a.id); render(); });
}

function flashSaved(form, text) {
  const msg = form.querySelector('#save-msg');
  if (msg) { msg.textContent = text; msg.classList.add('show'); }
  setTimeout(render, 900);
}

function bindDaily(a) {
  bindHydration(a);

  // Sleep tracker
  const sleepStart = root.querySelector('#sleep-start');
  const sleepEnd = root.querySelector('#sleep-end');
  const sleepHours = root.querySelector('#sleep-hours');
  const sleepMinutes = root.querySelector('#sleep-minutes');
  const sleepDisp = root.querySelector('#sleep-hours-display');
  function recalcSleep() {
    if (!sleepStart || !sleepEnd) return;
    const mins = sleepMinutesBetween(sleepStart.value, sleepEnd.value);
    if (mins != null) {
      sleepHours.value = sleepHoursBetween(sleepStart.value, sleepEnd.value);
      sleepMinutes.value = mins;
      sleepDisp.textContent = formatHoursMinutes(mins);
      sleepDisp.classList.toggle('short', mins < 360);
    } else { sleepHours.value = ''; sleepMinutes.value = ''; sleepDisp.textContent = '—'; sleepDisp.classList.remove('short'); }
  }
  root.querySelectorAll('.sleep-now').forEach((b) => b.addEventListener('click', () => {
    const target = root.querySelector('#' + b.dataset.target);
    const now = new Date();
    target.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    recalcSleep();
  }));
  if (sleepStart) sleepStart.addEventListener('change', recalcSleep);
  if (sleepEnd) sleepEnd.addEventListener('change', recalcSleep);

  // BP readout
  const bpSys = root.querySelector('#bp-systolic');
  const bpDia = root.querySelector('#bp-diastolic');
  const bpDisplay = root.querySelector('#bp-category-display');
  function recalcBp() {
    if (!bpDisplay) return;
    const cat = bpCategory(bpSys.value, bpDia.value);
    bpDisplay.className = 'sweat-value';
    if (cat) { bpDisplay.textContent = cat.label; if (cat.cls === 'red') bpDisplay.classList.add('bp-red'); else if (cat.cls === 'yellow') bpDisplay.classList.add('high'); }
    else bpDisplay.textContent = '—';
  }
  [bpSys, bpDia].forEach((el) => el && el.addEventListener('input', recalcBp));

  // Body Mass: live change vs previous recorded weight
  const bodyMassInput = root.querySelector('#body-mass-input');
  if (bodyMassInput) {
    const prev = lastBodyMass(a.id);
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

  // History links
  root.querySelectorAll('[data-history]').forEach((lnk) =>
    lnk.addEventListener('click', (e) => { e.preventDefault(); openHistory(lnk.dataset.history, a); }));

  const form = root.querySelector('#daily-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const num = (k) => (f.get(k) !== '' && f.get(k) != null ? Number(f.get(k)) : null);
    const str = (k) => (f.get(k) ? String(f.get(k)).trim() : '');
    saveCheckin({
      athleteId: a.id,
      body_mass_kg: num('body_mass_kg'),
      bp_systolic: num('bp_systolic'), bp_diastolic: num('bp_diastolic'), bp_timing: str('bp_timing') || null,
      sleep_type: str('sleep_type') || null, sleep_hours: num('sleep_hours'), sleep_minutes: num('sleep_minutes'),
      sleep_start: str('sleep_start') || null, sleep_end: str('sleep_end') || null,
    }, a);
    flashSaved(form, '✓ Daily log saved (SGT)');
  });
}

function bindTraining(a) {
  const preW = root.querySelector('#pre-weight');
  const postW = root.querySelector('#post-weight');
  const durW = root.querySelector('#duration-mins');
  const sweatDisplay = root.querySelector('#sweat-rate-display');
  function recalcSweat() {
    if (!sweatDisplay) return;
    const pre = preW.value !== '' ? Number(preW.value) : null;
    const post = postW.value !== '' ? Number(postW.value) : null;
    const dur = durW.value !== '' ? Number(durW.value) : null;
    const fluids = getHydrationToday(a.id).ml;
    const rate = sweatRateLph(pre, post, dur, fluids);
    if (rate != null) { sweatDisplay.textContent = `${rate.toFixed(2)} L/h`; sweatDisplay.classList.toggle('high', rate >= 1.5); }
    else { sweatDisplay.textContent = '—'; sweatDisplay.classList.remove('high'); }
  }
  [preW, postW, durW].forEach((el) => el && el.addEventListener('input', recalcSweat));

  // History links
  root.querySelectorAll('[data-history]').forEach((lnk) =>
    lnk.addEventListener('click', (e) => { e.preventDefault(); openHistory(lnk.dataset.history, a); }));

  const form = root.querySelector('#training-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const num = (k) => (f.get(k) !== '' && f.get(k) != null ? Number(f.get(k)) : null);
    const str = (k) => (f.get(k) ? String(f.get(k)).trim() : '');
    saveCheckin({
      athleteId: a.id,
      srpe: num('srpe'), intensity_level: str('intensity_level') || null, duration_mins: num('duration_mins'),
      pre_weight_kg: num('pre_weight_kg'), post_weight_kg: num('post_weight_kg'),
      pain_score: num('pain_score'), pain_location: str('pain_location'), pain_symptoms: f.getAll('pain_symptom'),
      pain_description: str('pain_description') || null, pain_actions: str('pain_actions') || null, pain_period: str('pain_period') || null,
    }, a);
    flashSaved(form, '✓ Training log saved (SGT)');
  });
}

function bindMental(a) {
  const form = root.querySelector('#mental-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const responses = {};
    for (const [key, raw] of f.entries()) {
      const qKey = key.split('_')[0]; // restq / poms / tsci / sms
      if (!QUESTIONNAIRES[qKey]) continue;
      (responses[qKey] = responses[qKey] || {})[key] = Number(raw);
    }
    const answered = Object.keys(responses).length;
    if (!answered) { alert('Answer at least one questionnaire before saving.'); return; }
    saveMentalLog({ athleteId: a.id, responses });
    flashSaved(form, `✓ Mental log saved — ${answered} questionnaire(s)`);
  });
}

/* ------------------------------ Bootstrap ------------------------------- */
// Avoid re-rendering (which would discard half-filled form inputs) while the
// user is mid-entry; only live-refresh when nothing is focused.
function liveRefresh() {
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
  if (!typing) render();
}

async function boot() {
  await resolveBackend();
  if (isShared()) { try { await pullState(); } catch (e) { /* server offline; use local cache */ } }
  render();
  startSync(liveRefresh);
}
boot();
