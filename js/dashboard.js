// dashboard.js — Coach DASHBOARD (output only, read-only).
// Tabs:
//   🫀 Physiological  → sub-tabs: Daily · Training
//   🧠 Psychological  → RESTQ / POMS / TSCI / SMS-II scored results & charts
// Reads from the same localStorage the Athlete Input app writes to.
import {
  getAthletes, checkinsForAthlete, mentalLogsForAthlete,
  bpCategory, formatHoursMinutes, formatSgt, sgtDay, sgtWeek,
  getOverride, exportData, importData, pullState, startSync, isShared, resolveBackend,
} from './store.js?v=9';
import { evaluateAthlete, readinessTier, evaluateReadinessStatus, tierMeta } from './alerts.js?v=9';
import {
  srpeChart, painChart, sleepChart,
  restqProfileChart, restqBalanceChart, pomsProfileChart, pomsTmdChart,
  tsciChart, smsProfileChart, smsRaiChart, weeklyTrendChart,
} from './charts.js?v=9';
import {
  QUESTIONNAIRES, scoreRestq, scorePoms, scoreTsci, scoreSms,
} from './psych.js?v=9';

const root = document.getElementById('app');
// tab: 'physio' | 'psych' ; physioSub: 'daily' | 'training'
let state = {
  tab: 'physio', physioSub: 'daily',
  // Weekly Trends: category (psych | physio) + a per-metric sub-tab for each.
  trendsCat: 'psych', trendsSub: 'all', trendsPhysioSub: 'all',
  selectedAthlete: null, rosterFilter: 'All', selectedMentalLog: null,
};

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
        <a class="ghost" href="index.html" title="Open the athlete Daily Log">✍️ Athlete Log →</a>
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

  root.querySelectorAll('[data-tsub]').forEach((b) =>
    b.addEventListener('click', () => { state.trendsSub = b.dataset.tsub; render(); }));

  root.querySelectorAll('[data-tcat]').forEach((b) =>
    b.addEventListener('click', () => { state.trendsCat = b.dataset.tcat; render(); }));

  root.querySelectorAll('[data-tpsub]').forEach((b) =>
    b.addEventListener('click', () => { state.trendsPhysioSub = b.dataset.tpsub; render(); }));

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
      <h2>${esc(a.name)} <span class="muted small">· ${[a.combatType, a.gender, a.age != null ? a.age + 'y' : null, a.currentWeight != null ? a.currentWeight + ' kg' : null].filter(Boolean).map(esc).join(' · ')}</span></h2>
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
  const sleepSeries = days.map((d) => ({ label: d.label, hours: avg(d.items.filter((c) => c.sleep_type !== 'Nap'), (c) => c.sleep_hours) }))
    .filter((d) => d.hours != null);

  return `
    <div class="charts">
      <div class="chart-card">${sleepChart(sleepSeries)}</div>
    </div>
    ${bodyMassSection(checkins)}
    ${bpSection(checkins)}`;
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


/* ---- Training sub-tab: training load, pain ---- */
function trainingPanel(a, checkins) {
  if (!checkins.length) return '<section class="panel"><p class="muted">No training data yet for this athlete.</p></section>';
  const days = groupByDay(checkins);
  const painSeries = days.map((d) => ({ label: d.label, srpe: avg(d.items, (c) => c.srpe), pain: avg(d.items, (c) => c.pain_score) })).filter((d) => d.srpe != null || d.pain != null);

  const rawRows = checkins.filter((c) => c.srpe != null || c.pain_score != null)
    .slice().reverse().map((c) => `<tr>
        <td>${esc(formatSgt(c.timestampUtc))}</td>
        <td>${esc(c.intensity_level || '—')}</td>
        <td>${c.srpe ?? '—'}</td>
        <td>${c.duration_mins ?? '—'}</td>
        <td>${c.workload ?? '—'}</td>
        <td class="${c.pain_score != null && c.pain_score >= 6 ? 'cell-red' : ''}">${c.pain_score ?? '—'}</td>
        <td>${esc(c.pain_location || '—')}${(c.pain_symptoms && c.pain_symptoms.length) ? ` <span class="pill" title="${esc(c.pain_symptoms.join('; '))}">${c.pain_symptoms.length} symptom${c.pain_symptoms.length === 1 ? '' : 's'}</span>` : ''}</td>
      </tr>`).join('');

  const alerts = evaluateAthlete(a, checkins);
  const alertList = alerts.length
    ? alerts.map((al) => `<li class="alert ${al.severity}"><span>${al.icon}</span><div><strong>${esc(al.title)}</strong><br><span class="muted">${esc(al.detail)}</span></div></li>`).join('')
    : '<li class="alert info"><span>🟢</span><div><strong>No active alerts</strong></div></li>';

  return `
    <div class="detail-cols">
      <div class="charts">
        <div class="chart-card">${srpeChart(painSeries)}</div>
        <div class="chart-card">${painChart(painSeries)}</div>
      </div>
      <aside class="alerts-pane"><h3>🔔 Notifications &amp; Alerts</h3><ul class="alert-list">${alertList}</ul></aside>
    </div>
    <section class="panel"><h3>Training sessions — raw metrics</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>SGT</th><th>Intensity</th><th>sRPE</th><th>Dur</th><th>Workload</th><th>Pain</th><th>Location</th>
      </tr></thead><tbody>${rawRows || '<tr><td colspan="7" class="muted">No training data</td></tr>'}</tbody></table></div>
    </section>`;
}

/* ---------------------------- Weekly Trends tab -------------------------- */
// Top level: choose a category (Psychological / Physiological); each category
// then has its own per-metric sub-tabs. Everything is trended per ISO week.
function trendsPanel(a) {
  const catBar = `
    <div class="subtabs cat-tabs">
      <button class="subtab ${state.trendsCat === 'psych' ? 'active' : ''}" data-tcat="psych">🧠 Psychological</button>
      <button class="subtab ${state.trendsCat === 'physio' ? 'active' : ''}" data-tcat="physio">🫀 Physiological</button>
    </div>`;
  const body = state.trendsCat === 'physio' ? physioTrends(a) : psychTrends(a);
  return catBar + body;
}

// --- Psychological weekly trends (per questionnaire total score) ---
function psychTrends(a) {
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

  // One descriptor per questionnaire: how to build its chart + table cell.
  const QS = [
    { key: 'restq', sub: 'stress', label: '🔋 Stress (RESTQ)', fn: totals.restq, dp: 1, signed: true,
      opts: { title: 'RESTQ total — Recovery − Stress (higher is better)', min: -6, max: 6, ref: 0, refLabel: 'balanced', emptyMsg: 'No RESTQ submissions yet' } },
    { key: 'poms', sub: 'mood', label: '🎭 Mood (POMS)', fn: totals.poms, dp: 0, signed: false,
      opts: { title: 'POMS total — Mood Disturbance (lower is better)', ref: 100, refLabel: 'neutral 100', emptyMsg: 'No POMS submissions yet' } },
    { key: 'tsci', sub: 'confidence', label: '💪 Confidence (TSCI)', fn: totals.tsci, dp: 1, signed: false,
      opts: { title: 'TSCI total — Sport-Confidence (1–9, higher is better)', min: 1, max: 9, ref: 5, refLabel: 'midpoint 5', emptyMsg: 'No TSCI submissions yet' } },
    { key: 'sms', sub: 'motivation', label: '🚀 Motivation (SMS-II)', fn: totals.sms, dp: 1, signed: true,
      opts: { title: 'SMS-II total — Relative Autonomy Index (higher is better)', ref: 0, refLabel: '0', emptyMsg: 'No SMS-II submissions yet' } },
  ];

  // Psychology sub-tabs: All, then one per questionnaire.
  const subs = [{ sub: 'all', label: '📊 All' }, ...QS.map((q) => ({ sub: q.sub, label: q.label }))];
  const subBar = `<div class="subtabs">${subs.map((s) =>
    `<button class="subtab ${state.trendsSub === s.sub ? 'active' : ''}" data-tsub="${s.sub}">${s.label}</button>`).join('')}</div>`;

  const fmt = (v, dp, signed) => (v == null ? '—' : (signed && v > 0 ? '+' : '') + v.toFixed(dp));
  const chartCard = (q) => `<div class="chart-card">${weeklyTrendChart(mkSeries(q.fn), q.opts)}</div>`;

  const totalsTable = (list) => `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Week</th><th>#</th>${list.map((q) => `<th title="${esc(q.opts.title)}">${esc(q.label.replace(/^[^ ]+ /, ''))}</th>`).join('')}</tr></thead>
      <tbody>${weekList.slice().reverse().map((wk) => `
        <tr><td>${esc(wk.label)} <span class="muted small">(wk of ${esc(wk.start)})</span></td>
        <td>${wk.logs.length}</td>
        ${list.map((q) => `<td>${fmt(weekAvg(wk, q.fn), q.dp, q.signed)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;

  let body;
  if (state.trendsSub === 'all') {
    body = `
      <div class="charts">${QS.map(chartCard).join('')}</div>
      <section class="panel"><h3>📈 Weekly totals — ${esc(a.name)}</h3>${totalsTable(QS)}</section>`;
  } else {
    const q = QS.find((x) => x.sub === state.trendsSub);
    body = `
      <div class="charts">${chartCard(q)}</div>
      <section class="panel"><h3>📈 ${esc(q.label)} — weekly totals · ${esc(a.name)}</h3>${totalsTable([q])}</section>`;
  }

  return `
    <div class="muted small view-hint">Weekly trend of each questionnaire's <strong>total score</strong> (${weekList.length} week${weekList.length === 1 ? '' : 's'} with data). A week with multiple submissions is averaged.</div>
    ${subBar}
    ${body}`;
}

// --- Physiological weekly trends (key metrics averaged per ISO week) ---
function physioTrends(a) {
  const checkins = checkinsForAthlete(a.id);
  if (!checkins.length) return '<section class="panel"><p class="muted">No physiological data yet for this athlete, so there are no weekly trends to show. Athletes log these in the Daily &amp; Training logs of the Input app.</p></section>';

  // Group check-ins by ISO week (SGT-anchored).
  const weeks = new Map();
  for (const c of checkins) {
    const w = sgtWeek(c.timestampUtc);
    if (!weeks.has(w.key)) weeks.set(w.key, { ...w, items: [] });
    weeks.get(w.key).items.push(c);
  }
  const weekList = [...weeks.values()].sort((x, y) => (x.key < y.key ? -1 : 1));

  // Weekly average of a per-check-in field (ignoring missing values).
  const weekAvg = (wk, pick) => {
    const vals = wk.items.map(pick).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };

  // One descriptor per physiological metric: how to pull its value + chart it.
  const MS = [
    { sub: 'pain', label: '🤕 Pain (NPRS)', pick: (c) => c.pain_score, dp: 1,
      opts: { title: 'Pain — NPRS 0–10 (lower is better)', min: 0, max: 10, ref: 3, refLabel: 'watch ≥3', emptyMsg: 'No pain data yet' } },
    { sub: 'load', label: '🔥 Workload', pick: (c) => c.workload, dp: 0,
      opts: { title: 'Training workload — sRPE × min (per session)', emptyMsg: 'No training-load data yet' } },
    { sub: 'sleep', label: '😴 Sleep (h)', pick: (c) => (c.sleep_type !== 'Nap' ? c.sleep_hours : null), dp: 1,
      opts: { title: 'Overnight sleep — hours (7–10 h recommended)', min: 0, max: 12, ref: 7, refLabel: '7 h', emptyMsg: 'No sleep data yet' } },
    { sub: 'mass', label: '⚖️ Body mass', pick: (c) => c.body_mass_kg, dp: 1,
      opts: { title: 'Body mass — kg', emptyMsg: 'No body-mass data yet' } },
  ];

  const subs = [{ sub: 'all', label: '📊 All' }, ...MS.map((m) => ({ sub: m.sub, label: m.label }))];
  const subBar = `<div class="subtabs">${subs.map((s) =>
    `<button class="subtab ${state.trendsPhysioSub === s.sub ? 'active' : ''}" data-tpsub="${s.sub}">${s.label}</button>`).join('')}</div>`;

  const mkSeries = (pick) => weekList.map((wk) => ({ label: wk.label, value: weekAvg(wk, pick) }));
  const chartCard = (m) => `<div class="chart-card">${weeklyTrendChart(mkSeries(m.pick), m.opts)}</div>`;
  const fmt = (v, dp) => (v == null ? '—' : v.toFixed(dp));

  const totalsTable = (list) => `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Week</th><th>#</th>${list.map((m) => `<th title="${esc(m.opts.title)}">${esc(m.label.replace(/^[^ ]+ /, ''))}</th>`).join('')}</tr></thead>
      <tbody>${weekList.slice().reverse().map((wk) => `
        <tr><td>${esc(wk.label)} <span class="muted small">(wk of ${esc(wk.start)})</span></td>
        <td>${wk.items.length}</td>
        ${list.map((m) => `<td>${fmt(weekAvg(wk, m.pick), m.dp)}${m.opts.unit === '%' && weekAvg(wk, m.pick) != null ? '%' : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;

  let body;
  if (state.trendsPhysioSub === 'all') {
    body = `
      <div class="charts">${MS.map(chartCard).join('')}</div>
      <section class="panel"><h3>📈 Physiological weekly averages — ${esc(a.name)}</h3>${totalsTable(MS)}</section>`;
  } else {
    const m = MS.find((x) => x.sub === state.trendsPhysioSub) || MS[0];
    body = `
      <div class="charts">${chartCard(m)}</div>
      <section class="panel"><h3>📈 ${esc(m.label)} — weekly averages · ${esc(a.name)}</h3>${totalsTable([m])}</section>`;
  }

  return `
    <div class="muted small view-hint">Weekly average of each physiological metric (${weekList.length} week${weekList.length === 1 ? '' : 's'} with data). Multiple logs in a week are averaged.</div>
    ${subBar}
    ${body}`;
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
        <span class="kpi-label">🚀 Motivation (SMS-II RAI)</span>
        <span class="kpi-value">${sms && sms.rai != null ? (sms.rai > 0 ? '+' : '') + sms.rai.toFixed(1) : '—'}</span>
        <span class="kpi-sub">autonomy index (higher is better)</span>
      </div>
    </div>`;

  const sections = [
    { q: 'restq', title: '🔋 Stress — RESTQ-Sport', profile: restq ? restqProfileChart(restq) : null, trend: restqTrend.length ? restqBalanceChart(restqTrend) : null },
    { q: 'poms', title: '🎭 Mood — Profile of Mood States', profile: poms ? pomsProfileChart(poms) : null, trend: tmdTrend.length ? pomsTmdChart(tmdTrend) : null },
    { q: 'tsci', title: '💪 Confidence — Vealey TSCI', profile: null, trend: tsciTrend.length ? tsciChart(tsciTrend) : null },
    { q: 'sms', title: '🚀 Motivation — SMS-II', profile: sms ? smsProfileChart(sms) : null, trend: raiTrend.length ? smsRaiChart(raiTrend) : null },
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
