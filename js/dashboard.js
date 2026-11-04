// dashboard.js — Coach DASHBOARD (output only, read-only).
// Tabs:
//   🫀 Physiological  → sub-tabs: Daily · Training
//   🧠 Psychological  → RESTQ / POMS / TSCI / SMS-6 scored results & charts
// Reads from the same localStorage the Athlete Input app writes to.
import {
  getAthletes, checkinsForAthlete, mentalLogsForAthlete,
  fluidLossPct, bpCategory, formatHoursMinutes, formatSgt, sgtDay, sgtWeek, romPct,
  getOverride, exportData, importData, pullState, startSync, isShared, resolveBackend,
} from './store.js';
import { evaluateAthlete, readinessTier, evaluateReadinessStatus, tierMeta } from './alerts.js';
import {
  romChart, srpeChart, painChart, hydrationChart, sleepChart, nutritionChart,
  restqProfileChart, restqBalanceChart, pomsProfileChart, pomsTmdChart,
  tsciChart, smsProfileChart, smsRaiChart, weeklyTrendChart,
} from './charts.js';
import {
  QUESTIONNAIRES, scoreRestq, scorePoms, scoreTsci, scoreSms,
} from './psych.js';

const root = document.getElementById('app');
// tab: 'physio' | 'psych' ; physioSub: 'daily' | 'training'
let state = { tab: 'physio', physioSub: 'daily', selectedAthlete: null, rosterFilter: 'All', selectedMentalLog: null };

function athleteById(id) { return getAthletes().find((a) => a.id === id); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TIER_BY_NAME = {
  Cleared: { tier: 'Cleared', icon: '🟢', cls: 'green' },
  Modified: { tier: 'Modified', icon: '🟡', cls: 'yellow' },
  Restricted: { tier: 'Restricted', icon: '🔴', cls: 'red' },
};
function effectiveTier(athlete, checkins) {
  const auto = readinessTier(checkins);
  const ov = getOverride(athlete.id);
  if (ov && ov.tier) return { ...(TIER_BY_NAME[ov.tier] || auto), overridden: true, note: ov.note };
  return { ...auto, overridden: false };
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
          <p>Coach Dashboard <span class="ro-badge">read-only</span></p>
        </div>
      </div>
      <nav class="tabs">
        <button class="tab ${state.tab === 'physio' ? 'active' : ''}" data-tab="physio">🫀 Physiological</button>
        <button class="tab ${state.tab === 'psych' ? 'active' : ''}" data-tab="psych">🧠 Psychological</button>
        <button class="tab ${state.tab === 'trends' ? 'active' : ''}" data-tab="trends">📈 Weekly Trends</button>
      </nav>
      <div class="tz">🕒 SGT (UTC+8)</div>
      <div class="data-actions">
        <button class="ghost" id="export-data" title="Download all data as a file">⬇ Export</button>
        <button class="ghost" id="import-data" title="Load data from an exported file">⬆ Import</button>
        <input type="file" accept="application/json,.json" id="import-file" hidden>
        <a class="ghost" href="input.html" title="Open the athlete input app">✍️ Input →</a>
      </div>
    </header>
    <main>
      <section class="coach-grid">
        <aside class="roster">${roster(athletes)}</aside>
        <div class="detail" id="coach-detail">${detail()}</div>
      </section>
    </main>
  `;

  bindShell();
}

function bindShell() {
  root.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));

  root.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => { state.rosterFilter = b.dataset.filter; render(); }));

  root.querySelectorAll('[data-ath]').forEach((b) =>
    b.addEventListener('click', () => { state.selectedAthlete = b.dataset.ath; state.selectedMentalLog = null; render(); }));

  root.querySelectorAll('[data-sub]').forEach((b) =>
    b.addEventListener('click', () => { state.physioSub = b.dataset.sub; render(); }));

  root.querySelectorAll('[data-mlog]').forEach((r) =>
    r.addEventListener('click', () => { state.selectedMentalLog = r.dataset.mlog; render(); }));

  const exportBtn = root.querySelector('#export-data');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const bundle = exportData();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `eastside-fc-data-${bundle.exportedAt.slice(0, 10)}.json`; a.click();
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
        const merge = confirm('Import data.\n\nOK = MERGE\nCancel = REPLACE (overwrite all data on this device)');
        try { const res = importData(bundle, merge ? 'merge' : 'replace'); state.selectedAthlete = null; alert(`Import complete (${res.mode}): ${res.athletes} athlete(s), ${res.checkins} check-in(s).`); render(); }
        catch (e) { alert('Import failed: ' + e.message); } finally { importFile.value = ''; }
      };
      reader.readAsText(file);
    });
  }
}

/* -------------------------------- Roster -------------------------------- */
function roster(athletes) {
  const filters = ['All', 'Cleared', 'Modified', 'Restricted'];
  const enriched = athletes.map((a) => {
    const checkins = checkinsForAthlete(a.id);
    const alerts = evaluateAthlete(a, checkins);
    const status = effectiveTier(a, checkins);
    const latest = checkins[checkins.length - 1];
    const latestTier = latest ? tierMeta(evaluateReadinessStatus(latest)) : null;
    return { a, checkins, alerts, status, latest, latestTier };
  });
  const counts = { All: enriched.length, Cleared: 0, Modified: 0, Restricted: 0 };
  enriched.forEach((e) => { counts[e.status.tier] = (counts[e.status.tier] || 0) + 1; });
  const filterBar = filters.map((f) =>
    `<button class="filter-btn ${state.rosterFilter === f ? 'active' : ''}" data-filter="${f}">${f} <span class="count">${counts[f] ?? 0}</span></button>`).join('');
  const visible = enriched.filter((e) => state.rosterFilter === 'All' || e.status.tier === state.rosterFilter);
  const cards = visible.map(({ a, checkins, alerts, status, latest, latestTier }) => {
    const redN = alerts.filter((x) => x.severity === 'red').length;
    const yellowN = alerts.filter((x) => x.severity === 'yellow').length;
    const mentalN = mentalLogsForAthlete(a.id).length;
    return `
      <button class="athlete-card ${status.cls} ${a.id === state.selectedAthlete ? 'sel' : ''}" data-ath="${a.id}">
        <div class="card-top">
          <span class="name">${esc(a.name)}</span>
          <span class="tier ${status.cls}">${status.icon} ${status.tier}${status.overridden ? ' ✎' : ''}</span>
        </div>
        <div class="card-meta">
          <span>${checkins.length} logs</span>
          ${mentalN ? `<span class="badge">🧠 ${mentalN}</span>` : ''}
          ${latestTier ? `<span class="badge ${latestTier.cls}">latest ${latestTier.icon}</span>` : ''}
          ${redN ? `<span class="badge red">🔴 ${redN}</span>` : ''}
          ${yellowN ? `<span class="badge yellow">🟡 ${yellowN}</span>` : ''}
        </div>
        <div class="card-foot">${latest ? 'Last: ' + esc(formatSgt(latest.timestampUtc)) : 'No data'}</div>
      </button>`;
  }).join('');
  return `
    <h2>Roster</h2>
    <div class="filter-bar">${filterBar}</div>
    <div class="cards">${cards || '<p class="muted">No athletes match this filter.</p>'}</div>`;
}

/* -------------------------------- Detail -------------------------------- */
function detail() {
  const athletes = getAthletes();
  const a = athleteById(state.selectedAthlete) || athletes[0];
  if (!a) return '<p class="muted">No athletes yet. Add athletes in the Input app.</p>';
  const checkins = checkinsForAthlete(a.id);
  const status = effectiveTier(a, checkins);
  const auto = readinessTier(checkins);

  const head = `
    <div class="detail-head">
      <h2>${esc(a.name)} <span class="muted small">· ${[a.combatType, a.gender, a.age != null ? a.age + 'y' : null, a.currentWeight != null ? a.currentWeight + ' kg' : null, 'baseline ROM ' + a.romBaseline + '°'].filter(Boolean).map(esc).join(' · ')}</span></h2>
      <span class="tier big ${status.cls}">${status.icon} ${status.tier}${status.overridden ? ' ✎ override' : ''}</span>
    </div>
    <div class="override-bar"><span class="muted small">Auto readiness: ${auto.icon} ${auto.tier} · showing ${state.tab === 'physio' ? 'Physiological' : state.tab === 'psych' ? 'Psychological' : 'Weekly Trends'} data (read-only)</span></div>`;

  if (state.tab === 'psych') return head + psychPanel(a);
  if (state.tab === 'trends') return head + trendsPanel(a);
  return head + physioPanel(a, checkins);
}

/* --------------------------- Physiological tab --------------------------- */
function physioPanel(a, checkins) {
  const subBar = `
    <div class="subtabs">
      <button class="subtab ${state.physioSub === 'daily' ? 'active' : ''}" data-sub="daily">📅 Daily</button>
      <button class="subtab ${state.physioSub === 'training' ? 'active' : ''}" data-sub="training">🔥 Training</button>
    </div>`;
  return subBar + (state.physioSub === 'daily' ? dailyPanel(a, checkins) : trainingPanel(a, checkins));
}

// Per-SGT-day grouping + averaging (for day-over-day charts).
function groupByDay(checkins) {
  const map = new Map();
  for (const c of checkins) {
    const day = c.sgtDay || sgtDay(c.timestampUtc);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(c);
  }
  return [...map.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([day, items]) => ({ day, label: day.slice(5), items }));
}
function avg(items, pick) {
  const vals = items.map(pick).filter((v) => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/* ---- Daily sub-tab: body mass, BP, sleep, hydration, nutrition ---- */
function dailyPanel(a, checkins) {
  if (!checkins.length) return '<section class="panel"><p class="muted">No daily data yet for this athlete.</p></section>';
  const days = groupByDay(checkins);
  const hydSeries = days.map((d) => ({ label: d.label, pre: avg(d.items, (c) => c.pre_weight_kg), post: avg(d.items, (c) => c.post_weight_kg) }))
    .filter((d) => d.pre != null || d.post != null);
  const sleepSeries = days.map((d) => ({ label: d.label, hours: avg(d.items.filter((c) => c.sleep_type !== 'Nap'), (c) => c.sleep_hours) }))
    .filter((d) => d.hours != null);
  const nutSeries = days.map((d) => ({
    label: d.label,
    workload: avg(d.items, (c) => c.workload),
    fueled: d.items.filter((c) => c.workload != null).every((c) => { const nl = c.nutrition_log || {}; return !!(nl.pre_workout_meal && nl.pre_workout_meal.trim()) && nl.fueled_before_session === true; }),
  })).filter((d) => d.workload != null);

  return `
    <div class="charts">
      <div class="chart-card">${hydrationChart(hydSeries)}</div>
      <div class="chart-card">${sleepChart(sleepSeries)}</div>
      <div class="chart-card">${nutritionChart(nutSeries)}</div>
    </div>
    ${bodyMassSection(checkins)}
    ${bpSection(checkins)}
    ${foodSection(checkins)}`;
}

function bodyMassSection(checkins) {
  const list = checkins.filter((c) => c.body_mass_kg != null).slice().reverse();
  const rows = list.map((c, i) => {
    const prev = list[i + 1];
    const delta = prev && prev.body_mass_kg != null ? c.body_mass_kg - prev.body_mass_kg : null;
    const deltaStr = delta == null ? '—' : (delta === 0 ? '±0' : (delta > 0 ? '+' : '') + delta.toFixed(1)) + ' kg';
    return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td><td>${c.body_mass_kg} kg</td><td class="${delta != null && delta < 0 ? 'cell-yellow' : ''}">${deltaStr}</td></tr>`;
  }).join('');
  return `<section class="panel"><h3>⚖️ Body Mass log</h3>${list.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Body mass</th><th>Δ vs prev</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="muted">No body-mass recordings yet.</p>'}</section>`;
}

function bpSection(checkins) {
  const list = checkins.filter((c) => c.bp_systolic != null && c.bp_diastolic != null).slice().reverse();
  const rows = list.map((c) => {
    const cat = bpCategory(c.bp_systolic, c.bp_diastolic);
    return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td><td>${c.bp_timing ? `<span class="pill">${esc(c.bp_timing)}</span>` : '—'}</td>
      <td>${c.bp_systolic}/${c.bp_diastolic} mmHg</td><td>${cat ? `<span class="tier ${cat.cls}">${cat.label}</span>` : '—'}</td></tr>`;
  }).join('');
  return `<section class="panel"><h3>🩺 Blood Pressure log</h3>${list.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Timing</th><th>Reading</th><th>Category</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="muted">No blood-pressure readings yet.</p>'}</section>`;
}

function foodSection(checkins) {
  const rows = checkins.filter((c) => { const nl = c.nutrition_log || {}; return nl.pre_workout_meal || nl.post_workout_meal || nl.main_meal; })
    .slice().reverse().map((c) => {
      const nl = c.nutrition_log || {};
      return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td>
        <td>${esc(nl.pre_workout_meal || '—')} ${nl.fueled_before_session ? '<span class="pill ok">timely</span>' : (nl.pre_workout_meal ? '<span class="pill warn">late</span>' : '')}</td>
        <td>${esc(nl.post_workout_meal || '—')}</td><td>${esc(nl.main_meal || '—')}</td>
        <td>${(nl.quality_tags || []).map((m) => `<span class="pill">${esc(m)}</span>`).join(' ') || '—'}</td></tr>`;
    }).join('');
  return `<section class="panel"><h3>🍽️ Food &amp; Fueling log</h3>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Pre-workout</th><th>Post-workout</th><th>Main meal</th><th>Tags</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">No food logs yet</td></tr>'}</tbody></table></div></section>`;
}

/* ---- Training sub-tab: training load, pain, ROM ---- */
function trainingPanel(a, checkins) {
  if (!checkins.length) return '<section class="panel"><p class="muted">No training data yet for this athlete.</p></section>';
  const days = groupByDay(checkins);
  const romSeries = days.map((d) => ({ label: d.label, pct: avg(d.items, (c) => (c.rom_percentage != null ? c.rom_percentage : romPct(c.goniometer_degrees, a.romBaseline))) })).filter((d) => d.pct != null);
  const painSeries = days.map((d) => ({ label: d.label, srpe: avg(d.items, (c) => c.srpe), pain: avg(d.items, (c) => c.pain_score) })).filter((d) => d.srpe != null || d.pain != null);

  const rawRows = checkins.filter((c) => c.srpe != null || c.pain_score != null || c.goniometer_degrees != null)
    .slice().reverse().map((c) => {
      const loss = fluidLossPct(c.pre_weight_kg, c.post_weight_kg);
      const rom = c.rom_percentage;
      return `<tr>
        <td>${esc(formatSgt(c.timestampUtc))}</td>
        <td>${esc(c.intensity_level || '—')}</td>
        <td>${c.srpe ?? '—'}</td>
        <td>${c.duration_mins ?? '—'}</td>
        <td>${c.workload ?? '—'}</td>
        <td>${c.pre_weight_kg ?? '—'} / ${c.post_weight_kg ?? '—'}</td>
        <td class="${loss != null && loss > 2 ? 'cell-red' : ''}">${loss != null ? loss.toFixed(1) + '%' : '—'}</td>
        <td>${c.sweat_rate_lph != null ? c.sweat_rate_lph.toFixed(2) + ' L/h' : '—'}</td>
        <td class="${c.pain_score != null && c.pain_score >= 6 ? 'cell-red' : ''}">${c.pain_score ?? '—'}</td>
        <td>${esc(c.pain_location || '—')}${(c.pain_symptoms && c.pain_symptoms.length) ? ` <span class="pill" title="${esc(c.pain_symptoms.join('; '))}">${c.pain_symptoms.length} symptom${c.pain_symptoms.length === 1 ? '' : 's'}</span>` : ''}</td>
        <td>${esc(c.joint_tested || '—')}${c.goniometer_degrees != null ? ' · ' + c.goniometer_degrees + '°' : ''}</td>
        <td class="${rom != null && rom < 60 ? 'cell-red' : ''}">${rom != null ? rom.toFixed(0) + '%' : '—'}</td>
      </tr>`;
    }).join('');

  const alerts = evaluateAthlete(a, checkins);
  const alertList = alerts.length
    ? alerts.map((al) => `<li class="alert ${al.severity}"><span>${al.icon}</span><div><strong>${esc(al.title)}</strong><br><span class="muted">${esc(al.detail)}</span></div></li>`).join('')
    : '<li class="alert info"><span>🟢</span><div><strong>No active alerts</strong></div></li>';

  return `
    <div class="detail-cols">
      <div class="charts">
        <div class="chart-card">${romChart(romSeries)}</div>
        <div class="chart-card">${srpeChart(painSeries)}</div>
        <div class="chart-card">${painChart(painSeries)}</div>
      </div>
      <aside class="alerts-pane"><h3>🔔 Notifications &amp; Alerts</h3><ul class="alert-list">${alertList}</ul></aside>
    </div>
    <section class="panel"><h3>Training sessions — raw metrics</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>SGT</th><th>Intensity</th><th>sRPE</th><th>Dur</th><th>Workload</th><th>Pre/Post kg</th><th>Fluid%</th><th>Sweat</th><th>Pain</th><th>Location</th><th>Joint / °</th><th>ROM%</th>
      </tr></thead><tbody>${rawRows || '<tr><td colspan="12" class="muted">No training data</td></tr>'}</tbody></table></div>
    </section>`;
}

/* ---------------------------- Weekly Trends tab -------------------------- */
// Each questionnaire's "total score" trended week-over-week. When a week has
// more than one submission, the week's value is the average of those scores.
function trendsPanel(a) {
  const logs = mentalLogsForAthlete(a.id);
  if (!logs.length) return '<section class="panel"><p class="muted">No psychological (mental log) data yet for this athlete, so there are no weekly trends to show. Athletes complete these in the Mental log of the Input app.</p></section>';

  // Group submissions by ISO week (SGT-anchored), preserving chronological order.
  const weeks = new Map(); // key -> { key, label, start, logs: [] }
  for (const m of logs) {
    const w = sgtWeek(m.timestampUtc);
    if (!weeks.has(w.key)) weeks.set(w.key, { ...w, logs: [] });
    weeks.get(w.key).logs.push(m);
  }
  const weekList = [...weeks.values()].sort((x, y) => (x.key < y.key ? -1 : 1));

  // Average of a per-log score across a week's submissions (ignoring missing).
  const weekAvg = (wk, scoreFn) => {
    const vals = wk.logs.map(scoreFn).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };

  // Per-questionnaire total-score extractor from a single mental-log record.
  const totals = {
    restq: (m) => { const s = m.responses && m.responses.restq ? scoreRestq(m.responses.restq) : null; return s ? s.recoveryStressBalance : null; },
    poms: (m) => { const s = m.responses && m.responses.poms ? scorePoms(m.responses.poms) : null; return s ? s.tmd : null; },
    tsci: (m) => { const s = m.responses && m.responses.tsci ? scoreTsci(m.responses.tsci) : null; return s ? s.score : null; },
    sms: (m) => { const s = m.responses && m.responses.sms ? scoreSms(m.responses.sms) : null; return s ? s.rai : null; },
  };

  const mkSeries = (fn) => weekList.map((wk) => ({ label: wk.label, value: weekAvg(wk, fn) }));
  const restqSeries = mkSeries(totals.restq);
  const pomsSeries = mkSeries(totals.poms);
  const tsciSeries = mkSeries(totals.tsci);
  const smsSeries = mkSeries(totals.sms);

  const cards = [
    weeklyTrendChart(restqSeries, { title: 'RESTQ total — Recovery − Stress (higher is better)', min: -6, max: 6, ref: 0, refLabel: 'balanced', emptyMsg: 'No RESTQ submissions yet' }),
    weeklyTrendChart(pomsSeries, { title: 'POMS total — Mood Disturbance (lower is better)', ref: 100, refLabel: 'neutral 100', emptyMsg: 'No POMS submissions yet' }),
    weeklyTrendChart(tsciSeries, { title: 'TSCI total — Sport-Confidence (1–9, higher is better)', min: 1, max: 9, ref: 5, refLabel: 'midpoint 5', emptyMsg: 'No TSCI submissions yet' }),
    weeklyTrendChart(smsSeries, { title: 'SMS-6 total — Relative Autonomy Index (higher is better)', ref: 0, refLabel: '0', emptyMsg: 'No SMS-6 submissions yet' }),
  ].map((c) => `<div class="chart-card">${c}</div>`).join('');

  // Summary table: one row per week, each questionnaire's total + submission count.
  const fmt = (v, dp = 1) => (v == null ? '—' : (v > 0 && dp > 0 ? '+' : '') + v.toFixed(dp));
  const rows = weekList.slice().reverse().map((wk) => `
    <tr>
      <td>${esc(wk.label)} <span class="muted small">(wk of ${esc(wk.start)})</span></td>
      <td>${wk.logs.length}</td>
      <td>${fmt(weekAvg(wk, totals.restq))}</td>
      <td>${fmt(weekAvg(wk, totals.poms), 0)}</td>
      <td>${fmt(weekAvg(wk, totals.tsci), 1).replace('+', '')}</td>
      <td>${fmt(weekAvg(wk, totals.sms))}</td>
    </tr>`).join('');

  return `
    <div class="muted small view-hint">Weekly trend of each questionnaire's <strong>total score</strong> (${weekList.length} week${weekList.length === 1 ? '' : 's'} with data). A week with multiple submissions is averaged.</div>
    <div class="charts">${cards}</div>
    <section class="panel">
      <h3>📈 Weekly totals — ${esc(a.name)}</h3>
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Week</th><th>#</th>
          <th title="Recovery − Stress (0–6 scales); higher is better">RESTQ</th>
          <th title="Total Mood Disturbance; lower is better">POMS TMD</th>
          <th title="Mean confidence 1–9; higher is better">TSCI</th>
          <th title="Relative Autonomy Index; higher is better">SMS-6 RAI</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

/* ---------------------------- Psychological tab --------------------------- */
function psychPanel(a) {
  const logs = mentalLogsForAthlete(a.id);
  if (!logs.length) return '<section class="panel"><p class="muted">No psychological (mental log) data yet for this athlete. Athletes complete these in the Mental log of the Input app.</p></section>';

  // The submission currently being viewed: the one the coach picked from the
  // history table, else the most recent.
  const selected = logs.find((m) => m.id === state.selectedMentalLog) || logs[logs.length - 1];
  const isLatest = selected === logs[logs.length - 1];

  // Scored results for the viewed submission
  const restq = selected.responses && selected.responses.restq ? scoreRestq(selected.responses.restq) : null;
  const poms = selected.responses && selected.responses.poms ? scorePoms(selected.responses.poms) : null;
  const tsci = selected.responses && selected.responses.tsci ? scoreTsci(selected.responses.tsci) : null;
  const sms = selected.responses && selected.responses.sms ? scoreSms(selected.responses.sms) : null;

  // Trend series across all logs
  const restqTrend = logs.map((m) => { const s = m.responses && m.responses.restq ? scoreRestq(m.responses.restq) : null; return s ? { label: (m.sgtDay || sgtDay(m.timestampUtc)).slice(5), stress: s.stressIndex, recovery: s.recoveryIndex } : null; }).filter(Boolean);
  const tmdTrend = logs.map((m) => { const s = m.responses && m.responses.poms ? scorePoms(m.responses.poms) : null; return s ? { label: (m.sgtDay || sgtDay(m.timestampUtc)).slice(5), tmd: s.tmd } : null; }).filter(Boolean);
  const tsciTrend = logs.map((m) => { const s = m.responses && m.responses.tsci ? scoreTsci(m.responses.tsci) : null; return s ? { label: (m.sgtDay || sgtDay(m.timestampUtc)).slice(5), score: s.score } : null; }).filter(Boolean);
  const raiTrend = logs.map((m) => { const s = m.responses && m.responses.sms ? scoreSms(m.responses.sms) : null; return s ? { label: (m.sgtDay || sgtDay(m.timestampUtc)).slice(5), rai: s.rai } : null; }).filter(Boolean);

  const headline = `
    <div class="psych-summary">
      <div class="psych-kpi ${tsci && tsci.score != null ? '' : 'empty'}">
        <span class="kpi-label">💪 Confidence (TSCI)</span>
        <span class="kpi-value">${tsci && tsci.score != null ? tsci.score.toFixed(1) + ' / 9' : '—'}</span>
        <span class="kpi-sub">${tsci && tsci.band ? tsci.band : 'no data'}</span>
      </div>
      <div class="psych-kpi ${poms && poms.tmd != null ? '' : 'empty'}">
        <span class="kpi-label">🎭 Mood (POMS TMD)</span>
        <span class="kpi-value">${poms && poms.tmd != null ? poms.tmd.toFixed(0) : '—'}</span>
        <span class="kpi-sub">lower is better (neutral 100)</span>
      </div>
      <div class="psych-kpi ${restq && restq.recoveryStressBalance != null ? '' : 'empty'}">
        <span class="kpi-label">🔋 Stress/Recovery (RESTQ)</span>
        <span class="kpi-value">${restq && restq.recoveryStressBalance != null ? (restq.recoveryStressBalance > 0 ? '+' : '') + restq.recoveryStressBalance.toFixed(1) : '—'}</span>
        <span class="kpi-sub">recovery − stress (higher is better)</span>
      </div>
      <div class="psych-kpi ${sms && sms.rai != null ? '' : 'empty'}">
        <span class="kpi-label">🚀 Motivation (SMS-6 RAI)</span>
        <span class="kpi-value">${sms && sms.rai != null ? (sms.rai > 0 ? '+' : '') + sms.rai.toFixed(1) : '—'}</span>
        <span class="kpi-sub">autonomy index (higher is better)</span>
      </div>
    </div>`;

  const sections = [
    { q: 'restq', title: '🔋 Stress — RESTQ-Sport', profile: restq ? restqProfileChart(restq) : null, trend: restqTrend.length ? restqBalanceChart(restqTrend) : null },
    { q: 'poms', title: '🎭 Mood — Profile of Mood States', profile: poms ? pomsProfileChart(poms) : null, trend: tmdTrend.length ? pomsTmdChart(tmdTrend) : null },
    { q: 'tsci', title: '💪 Confidence — Vealey TSCI', profile: null, trend: tsciTrend.length ? tsciChart(tsciTrend) : null },
    { q: 'sms', title: '🚀 Motivation — SMS-6', profile: sms ? smsProfileChart(sms) : null, trend: raiTrend.length ? smsRaiChart(raiTrend) : null },
  ].map((s) => {
    const charts = [s.profile, s.trend].filter(Boolean);
    return `<section class="panel">
      <h3>${s.title} <span class="muted small">· viewing: ${esc(formatSgt(selected.timestampUtc))}${isLatest ? ' (latest)' : ''}</span></h3>
      ${charts.length ? `<div class="charts">${charts.map((c) => `<div class="chart-card">${c}</div>`).join('')}</div>`
        : '<p class="muted">No submissions for this questionnaire yet.</p>'}
    </section>`;
  }).join('');

  // Clickable history — pick any past submission to view its scored results.
  const historyRows = logs.slice().reverse().map((m) => {
    const done = Object.keys(QUESTIONNAIRES).filter((k) => m.responses && m.responses[k] && Object.keys(m.responses[k]).length);
    const sel = m.id === selected.id;
    return `<tr class="history-row ${sel ? 'sel' : ''}" data-mlog="${m.id}" title="View this submission's results">
      <td>${esc(formatSgt(m.timestampUtc))}${sel ? ' <span class="pill ok">viewing</span>' : ''}</td>
      <td>${done.map((k) => `<span class="pill">${QUESTIONNAIRES[k].shortTitle}</span>`).join(' ') || '—'}</td></tr>`;
  }).join('');

  return `
    <div class="muted small view-hint">Viewing submission from <strong>${esc(formatSgt(selected.timestampUtc))}</strong>${isLatest ? ' (latest)' : ''} — click any row in the history below to look back at an earlier date/time.</div>
    ${headline}
    ${sections}
    <section class="panel"><h3>🕒 Mental log history <span class="muted small">· ${logs.length} submission${logs.length === 1 ? '' : 's'} · click a row to view</span></h3>
      <div class="table-wrap"><table class="data-table" style="max-width:640px">
        <thead><tr><th>Time (SGT)</th><th>Questionnaires</th></tr></thead><tbody>${historyRows}</tbody></table></div>
    </section>`;
}

/* ------------------------------ Bootstrap ------------------------------- */
async function boot() {
  await resolveBackend();
  if (isShared()) { try { await pullState(); } catch (e) { /* server offline; use local cache */ } }
  render();
  // The dashboard is read-only, so it's always safe to live-refresh on new data.
  startSync(render);
}
boot();
