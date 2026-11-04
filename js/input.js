// input.js — Athlete INPUT app controller.
// Three logs that mirror the dashboard tabs:
//   • Daily log     — body mass, blood pressure, sleep, hydration, nutrition
//   • Training log   — training load, pain & injury, range of motion
//   • Mental log     — RESTQ / POMS / TSCI / SMS-II questionnaires
// Data is written to the same localStorage the Dashboard reads from.
import {
  getAthletes, addAthlete, updateAthlete, deleteAthlete, saveCheckin, saveMentalLog,
  checkinsForAthlete, mentalLogsForAthlete,
  sweatRateLph, bpCategory, sleepHoursBetween, sleepMinutesBetween, formatHoursMinutes, formatSgt,
  getHydrationToday, addBottle, removeBottle, DEFAULT_BOTTLE_ML,
  hydrationGoalMl, exerciseMinutesToday,
  exportData, importData, pullState, startSync, isShared, resolveBackend,
  BP_TIMINGS, INTENSITY_LEVELS, MACRO_TAGS, PAIN_SYMPTOMS,
} from './store.js';
import { QUESTIONNAIRES, itemId } from './psych.js';

const root = document.getElementById('app');
let state = { log: 'daily', selectedAthlete: null };

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
        <button class="tab ${state.log === 'daily' ? 'active' : ''}" data-log="daily">📅 Daily log</button>
        <button class="tab ${state.log === 'training' ? 'active' : ''}" data-log="training">🔥 Training log</button>
        <button class="tab ${state.log === 'mental' ? 'active' : ''}" data-log="mental">🧠 Mental log</button>
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
        <a class="ghost" href="index.html" title="Open the coach dashboard">📊 Dashboard →</a>
      </div>
    </header>
    <main>${!a ? '<section class="panel"><p class="muted">Add an athlete to start logging.</p></section>'
      : state.log === 'daily' ? dailyLog(a)
      : state.log === 'training' ? trainingLog(a)
      : mentalLog(a)}</main>
  `;

  bindShell();
  if (!a) return;
  if (state.log === 'daily') bindDaily(a);
  if (state.log === 'training') bindTraining(a);
  if (state.log === 'mental') bindMental(a);
}

function bindShell() {
  root.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => { state.log = b.dataset.log; render(); }));

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
  return `
  ${hydrationTracker(a)}
  <section class="panel">
    <div class="panel-head">
      <h2>📅 Daily log <span class="muted small">· ${esc(a.name)}</span></h2>
    </div>
    <form id="daily-form" class="form-grid">
      <div class="body-mass-row">
        <fieldset class="body-mass-fieldset">
          <legend>⚖️ Body Mass</legend>
          <label>Body mass (kg)<input type="number" step="0.1" name="body_mass_kg"></label>
          <small class="hint">Auto-timestamped in SGT.</small>
        </fieldset>
        <div class="body-mass-log-inline">
          <span class="field-label">⚖️ Body Mass log <span class="muted small">· timestamped (SGT)</span></span>
          ${bodyMassLogTable(checkinsForAthlete(a.id))}
        </div>
      </div>

      <div class="body-mass-row">
        <fieldset class="body-mass-fieldset">
          <legend>🩺 Blood Pressure</legend>
          <label>Timing
            <select name="bp_timing"><option value="">—</option>${BP_TIMINGS.map((t) => `<option>${t}</option>`).join('')}</select>
          </label>
          <label>Systolic (mmHg)<input type="number" min="40" max="300" name="bp_systolic" id="bp-systolic" placeholder="e.g. 120"></label>
          <label>Diastolic (mmHg)<input type="number" min="30" max="200" name="bp_diastolic" id="bp-diastolic" placeholder="e.g. 80"></label>
          <div class="sweat-result"><span class="sweat-label">Reading</span><span class="sweat-value" id="bp-category-display">—</span></div>
        </fieldset>
        <div class="body-mass-log-inline">
          <span class="field-label">🩺 Blood Pressure log <span class="muted small">· timestamped (SGT)</span></span>
          ${bpLogTable(checkinsForAthlete(a.id))}
        </div>
      </div>

      <fieldset>
        <legend>😴 Sleep</legend>
        <label>Type of sleep
          <select name="sleep_type"><option value="Overnight">Overnight sleep</option><option value="Nap">Nap</option></select>
        </label>
        <div class="sleep-tracker">
          <div class="sleep-times">
            <label>Slept at<div class="time-row"><input type="time" name="sleep_start" id="sleep-start"><button type="button" class="ghost sleep-now" data-target="sleep-start">now</button></div></label>
            <label>Woke at<div class="time-row"><input type="time" name="sleep_end" id="sleep-end"><button type="button" class="ghost sleep-now" data-target="sleep-end">now</button></div></label>
          </div>
          <div class="sleep-result">
            <span class="sleep-hours-label">Sleep duration</span>
            <span class="sleep-hours-value" id="sleep-hours-display">—</span>
            <input type="hidden" name="sleep_hours" id="sleep-hours">
            <input type="hidden" name="sleep_minutes" id="sleep-minutes">
          </div>
        </div>
        <small class="hint">Tap “now” at bedtime and on waking — hours are calculated automatically.</small>
      </fieldset>

      <fieldset class="wide">
        <legend>🍽️ Qualitative Nutrition Log</legend>
        <label>Pre-workout meal<input type="text" name="pre_workout_meal" placeholder="e.g. Chicken rice, 2.5h before"></label>
        <label>Post-workout meal<input type="text" name="post_workout_meal" placeholder="e.g. Whey shake, banana"></label>
        <label>Main meal<input type="text" name="main_meal" placeholder="e.g. Grilled fish, veg, sweet potato"></label>
        <label class="check-inline">Fueled before session (ate 2–3 h prior)?<input type="checkbox" name="fueled_before_session"></label>
        <div class="tag-row">${MACRO_TAGS.map((t) => `<label class="tag"><input type="checkbox" name="quality_tag" value="${t}">${t}</label>`).join('')}</div>
      </fieldset>

      <div class="form-actions">
        <button type="submit" class="primary">Save daily log</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </form>
  </section>`;
}

/* ============================= TRAINING LOG ============================= */
function trainingLog(a) {
  return `
  <section class="panel">
    <div class="panel-head"><h2>🔥 Training log <span class="muted small">· ${esc(a.name)}</span></h2></div>
    <form id="training-form" class="form-grid">
      <fieldset>
        <legend>🔥 Training Load &amp; Intensity</legend>
        <label>Session RPE (1–10)
          <select name="srpe"><option value="">—</option>${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<option value="${n}">${n}</option>`).join('')}</select>
        </label>
        <label>Type of training
          <select name="intensity_level"><option value="">—</option>${INTENSITY_LEVELS.map((l) => `<option>${l}</option>`).join('')}</select>
        </label>
        <label>Duration (min)<input type="number" min="0" name="duration_mins" id="duration-mins"></label>
        <label>Pre-session weight (kg)<input type="number" step="0.1" name="pre_weight_kg" id="pre-weight"></label>
        <label>Post-session weight (kg)<input type="number" step="0.1" name="post_weight_kg" id="post-weight"></label>
        <div class="sweat-result"><span class="sweat-label">Sweat rate</span><span class="sweat-value" id="sweat-rate-display">—</span></div>
        <small class="hint">Sweat rate = (pre − post + water drunk today) ÷ hours trained.</small>
      </fieldset>

      <fieldset class="wide">
        <legend>🤕 Pain &amp; Injury</legend>
        <div class="pain-symptoms">
          <span class="field-label">Pain symptoms <span class="muted small">(select any that apply)</span></span>
          <div class="tag-row">${PAIN_SYMPTOMS.map((s) => `<label class="tag"><input type="checkbox" name="pain_symptom" value="${esc(s)}">${esc(s)}</label>`).join('')}</div>
        </div>
        <div class="pain-grid">
          <label>Pain score NPRS (0–10)
            <select name="pain_score"><option value="">—</option>${Array.from({ length: 11 }, (_, i) => i).map((n) => `<option value="${n}">${n}${n === 0 ? ' (no pain)' : ''}</option>`).join('')}</select>
          </label>
          <label>Pain location<input type="text" name="pain_location" placeholder="e.g. Left Ankle"></label>
          <label>Pain period<input type="text" name="pain_period" placeholder="e.g. 3 days, since last sparring"></label>
        </div>
        <label>How did it happen? <span class="muted small">(optional)</span><textarea name="pain_description" rows="2"></textarea></label>
        <label>Actions taken to reduce the pain <span class="muted small">(optional)</span><textarea name="pain_actions" rows="2"></textarea></label>
      </fieldset>

      <fieldset>
        <legend>📐 Range of Motion</legend>
        <label>Joint tested<input type="text" name="joint_tested" placeholder="e.g. Ankle Dorsiflexion"></label>
        <label>Goniometer angle (°)<input type="number" min="0" max="360" name="goniometer_degrees"></label>
        <label>Baseline ROM (°)<input type="number" min="1" max="360" name="rom_baseline" id="rom-baseline" value="${a.romBaseline}"></label>
        <small class="hint">Goniometer angle is mapped to % of this baseline automatically.</small>
      </fieldset>

      <div class="form-actions">
        <button type="submit" class="primary">Save training log</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </form>
  </section>`;
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

/* =============================== Hydration ============================== */
function hydrationTracker(a) {
  const bottleMl = a.bottleMl || DEFAULT_BOTTLE_ML;
  const exMins = exerciseMinutesToday(a.id);
  const g = hydrationGoalMl(a, exMins);
  const goal = g.total;
  const today = getHydrationToday(a.id);
  const pct = goal > 0 ? Math.min(100, Math.round((today.ml / goal) * 100)) : 0;
  const barCls = pct >= 100 ? 'full' : pct >= 50 ? 'ok' : 'low';
  const goalExplain = g.weight
    ? `Target = ${g.baseline} ml (${g.weight} kg × 35 ml/kg)` + (g.exercise > 0 ? ` + ${g.exercise} ml (${g.exerciseHours.toFixed(1)} h exercise × 750 ml/h)` : '')
    : 'Add a body weight to this athlete for a personalised target.';
  const logRows = (today.entries || []).slice().reverse().map((e, i, arr) =>
    `<tr><td>${arr.length - i}</td><td>${esc(e.label || e.sgt || '')}</td><td>+${e.ml} ml</td></tr>`).join('');

  return `
  <section class="panel hydration-panel">
    <div class="panel-head">
      <h2>💧 Hydration — Today (SGT)</h2>
      <label class="bottle-cap">Bottle capacity (ml)<input type="number" id="bottle-ml" min="50" step="50" value="${bottleMl}"></label>
    </div>
    <div class="hydration-row">
      <button class="bottle-btn" id="bottle-add" title="Tap each time you finish a bottle (+${bottleMl} ml)">
        <span class="bottle-emoji">🍶</span><span class="bottle-plus">+1</span>
      </button>
      <div class="hydration-bar-wrap">
        <div class="hydration-bar"><div class="hydration-fill ${barCls}" style="width:${pct}%"></div><span class="hydration-label">${today.ml} / ${goal} ml · ${pct}%</span></div>
        <div class="hydration-meta">
          <span>${today.taps} bottle${today.taps === 1 ? '' : 's'} drunk today</span>
          <button class="link-del" id="bottle-remove" ${today.taps === 0 ? 'disabled' : ''}>undo last</button>
          ${today.ml >= goal ? '<span class="pill ok">🎯 Goal reached!</span>' : ''}
        </div>
        <div class="hydration-goal-explain muted small">${esc(goalExplain)}</div>
      </div>
    </div>
    <div class="water-log">
      <h3>🕒 Water log — today</h3>
      ${today.entries && today.entries.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>#</th><th>Time (SGT)</th><th>Amount</th></tr></thead><tbody>${logRows}</tbody></table></div>`
        : '<p class="muted">No water logged yet today — tap the bottle to start.</p>'}
    </div>
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
      nutrition_log: {
        pre_workout_meal: str('pre_workout_meal'), post_workout_meal: str('post_workout_meal'), main_meal: str('main_meal'),
        quality_tags: f.getAll('quality_tag'), fueled_before_session: f.get('fueled_before_session') === 'on',
      },
    }, a);
    flashSaved(form, '✓ Daily log saved (SGT)');
  });
}

function bindTraining(a) {
  const romBaselineInput = root.querySelector('#rom-baseline');
  if (romBaselineInput) romBaselineInput.addEventListener('change', () => {
    const val = Number(romBaselineInput.value); if (val > 0) updateAthlete(a.id, { romBaseline: val });
  });

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

  const form = root.querySelector('#training-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const num = (k) => (f.get(k) !== '' && f.get(k) != null ? Number(f.get(k)) : null);
    const str = (k) => (f.get(k) ? String(f.get(k)).trim() : '');
    const romBaseline = num('rom_baseline');
    if (romBaseline && romBaseline > 0) updateAthlete(a.id, { romBaseline });
    saveCheckin({
      athleteId: a.id,
      srpe: num('srpe'), intensity_level: str('intensity_level') || null, duration_mins: num('duration_mins'),
      pre_weight_kg: num('pre_weight_kg'), post_weight_kg: num('post_weight_kg'),
      joint_tested: str('joint_tested'), goniometer_degrees: num('goniometer_degrees'),
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
