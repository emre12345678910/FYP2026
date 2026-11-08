// dashboard.js — Coach DASHBOARD (output only, read-only).
// Tabs:
//   🫀 Physiological  → sub-tabs: Daily · Training · Pain & Symptoms
//   🧠 Psychological  → RESTQ / POMS / TSCI / SMS-II scored results & charts
// Reads from the same localStorage the Athlete Input app writes to.
import {
  getAthletes, checkinsForAthlete, mentalLogsForAthlete,
  bpCategory, formatHoursMinutes, formatSgt, sgtDay, sgtWeek, sgtNow,
  hydrationMlForDay, hydrationGoalMl,
  getOverride, exportData, importData, pullState, startSync, isShared, resolveBackend, activeBackend,
} from './store.js?v=16';
import { evaluateAthlete, readinessTier, evaluateReadinessStatus, tierMeta } from './alerts.js?v=16';
import {
  srpeChart, painChart, sleepChart, hydrationWeekChart, bpWeekChart, bodyMassWeekChart,
  restqProfileChart, restqBalanceChart, pomsProfileChart, pomsTmdChart,
  tsciChart, smsProfileChart, smsRaiChart, weeklyTrendChart,
} from './charts.js?v=16';
import {
  QUESTIONNAIRES, scoreRestq, scorePoms, scoreTsci, scoreSms,
} from './psych.js?v=16';

const root = document.getElementById('app');
// tab: 'physio' | 'psych' ; physioSub: 'daily' | 'training' | 'pain'
let state = {
  tab: 'physio', physioSub: 'daily',
  // Weekly Trends: category (psych | physio) + a per-metric sub-tab for each.
  trendsCat: 'psych', trendsSub: 'all', trendsPhysioSub: 'all',
  selectedAthlete: null, rosterFilter: 'All', selectedMentalLog: null,
};

function athleteById(id) { return getAthletes().find((a) => a.id === id); }
function syncBadge() {
  const b = activeBackend();
  if (b === 'firebase') return '<span class="sync-badge on">☁ Cloud sync on</span>';
  if (b === 'server') return '<span class="sync-badge on">🖧 LAN sync on</span>';
  return '<span class="sync-badge off">📴 This device only</span>';
}
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
      <div class="tz">🕒 SGT (UTC+8) · ${syncBadge()}</div>
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
      <button class="subtab ${state.physioSub === 'pain' ? 'active' : ''}" data-sub="pain">🤕 Pain &amp; Symptoms</button>
    </div>`;
  const panel = state.physioSub === 'training' ? trainingPanel(a, checkins)
    : state.physioSub === 'pain' ? painPanel(a, checkins)
    : dailyPanel(a, checkins);
  return subBar + panel;
}

// A reusable "aspect" block: a weekly/daily chart card + a log table, matching
// the athlete-side History style (chart on top, log below).
function aspectSection(title, chartHtml, tableHtml) {
  return `<section class="panel">
    <h3>${title}</h3>
    <div class="hist-chart">${chartHtml}</div>
    ${tableHtml}
  </section>`;
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

/* ------------------- Coach interpretation helpers ----------------------- */
// Hydration: hydrated the day BEFORE? + today's % of goal.
function hydrationInsight(a) {
  const todayKey = sgtNow().date;
  const yKey = sgtDay(new Date(Date.now() - 86400000).toISOString());
  const goal = hydrationGoalMl(a, 0).total; // baseline goal (no exercise bonus)
  const yMl = hydrationMlForDay(a.id, yKey);
  const tMl = hydrationMlForDay(a.id, todayKey);
  const yPct = goal > 0 ? Math.round((yMl / goal) * 100) : 0;
  const tPct = goal > 0 ? Math.round((tMl / goal) * 100) : 0;
  const hydrated = yMl >= goal;
  const dayLabel = yKey.slice(5).replace('-', '/'); // MM/DD -> M/D-ish
  return {
    status: hydrated ? 'Hydrated' : 'Dehydrated',
    cls: hydrated ? 'green' : 'red',
    dayLabel,                       // the date the status refers to
    yesterdayDetail: `${yMl} / ${goal} ml (${yPct}%)`,
    today: `${tMl} / ${goal} ml — ${tPct}% of goal today`,
  };
}

// Sleep interpretation from the most recent overnight sleep.
function sleepInsight(checkins) {
  const nights = checkins.filter((c) => c.sleep_type !== 'Nap' && c.sleep_hours != null);
  if (!nights.length) return null;
  const h = nights[nights.length - 1].sleep_hours;
  if (h >= 9) return { label: 'Excellent sleep', cls: 'green-dark', hours: h };
  if (h >= 7) return { label: 'Sufficient sleep', cls: 'green', hours: h };
  return { label: 'Underslept', cls: 'red', hours: h };
}

// Body mass: current + previous (with dates) + an AI-style insight.
function bodyMassInsight(checkins) {
  const list = checkins.filter((c) => c.body_mass_kg != null);
  if (!list.length) return null;
  const latest = list[list.length - 1];
  const prev = list.length > 1 ? list[list.length - 2] : null;
  // Trend over up to the last 5 recordings
  const recent = list.slice(-5).map((c) => c.body_mass_kg);
  const spread = Math.max(...recent) - Math.min(...recent);
  const delta = prev ? latest.body_mass_kg - prev.body_mass_kg : null;
  const goal = recent.length >= 2 ? recent[0] : null; // naive: earliest in window as a reference

  let insight;
  if (recent.length < 2) {
    insight = 'Only one recording so far — more data needed to spot a trend.';
  } else if (spread <= 1.0) {
    insight = "Athlete's body mass has been maintained properly over the last few recordings.";
  } else if (delta != null && Math.abs(delta) >= 1.5) {
    insight = "Athlete's body mass is noticeably different compared to previous weeks — worth reviewing load & nutrition.";
  } else if (delta != null && delta < 0) {
    insight = 'Athlete is trending down and is on track toward a lower target body mass.';
  } else {
    insight = "Athlete's body mass is drifting slightly compared to previous weeks.";
  }
  const diffPct = (prev && prev.body_mass_kg) ? (delta / prev.body_mass_kg) * 100 : null;
  return {
    currentKg: latest.body_mass_kg, currentDate: formatSgt(latest.timestampUtc),
    prevKg: prev ? prev.body_mass_kg : null, prevDate: prev ? formatSgt(prev.timestampUtc) : null,
    delta, diffPct, insight,
  };
}

// Blood pressure: latest reading's category.
function bpInsight(checkins) {
  const list = checkins.filter((c) => c.bp_systolic != null && c.bp_diastolic != null);
  if (!list.length) return null;
  const c = list[list.length - 1];
  const cat = bpCategory(c.bp_systolic, c.bp_diastolic);
  return { reading: `${c.bp_systolic}/${c.bp_diastolic} mmHg`, cat };
}

// The big combined interpretation box for the Daily sub-tab.
function dailyInsightBox(a, checkins) {
  const hyd = hydrationInsight(a);
  const slp = sleepInsight(checkins);
  const bm = bodyMassInsight(checkins);
  const bp = bpInsight(checkins);

  const row = (title, inner) => `<div class="insight-row"><div class="insight-k">${title}</div><div class="insight-v">${inner}</div></div>`;

  return `
  <section class="insight-box">
    <h2>🧠 Coach Insights <span class="muted small">· ${esc(a.name)}</span></h2>
    ${row('💧 Hydration', `
      <div><strong>${esc(hyd.dayLabel)}</strong> — <span class="tier ${hyd.cls}">${hyd.status}</span></div>
      <div class="muted small">That day: ${esc(hyd.yesterdayDetail)}</div>
      <div class="hydration-today-big">Today: ${esc(hyd.today)}</div>`)}
    ${row('😴 Sleep', slp
      ? `<span class="tier ${slp.cls}">${slp.label}</span> <span class="muted small">· ${slp.hours} h latest night</span>`
      : '<span class="muted">No overnight sleep logged yet.</span>')}
    ${row('⚖️ Body Mass', bm
      ? `<strong>${bm.currentKg} kg</strong> <span class="muted small">(${esc(bm.currentDate)})</span>
         ${bm.prevKg != null ? `<div class="muted small">Previous: ${bm.prevKg} kg (${esc(bm.prevDate)})</div>` : ''}
         ${bm.delta != null ? `<div>Change vs previous: <strong class="${bm.delta > 0 ? 'cell-up' : bm.delta < 0 ? 'cell-down' : ''}">${bm.delta > 0 ? '+' : ''}${bm.delta.toFixed(1)} kg${bm.diffPct != null ? ` (${bm.diffPct > 0 ? '+' : ''}${bm.diffPct.toFixed(1)}%)` : ''}</strong></div>` : ''}
         <div class="insight-ai">💡 ${esc(bm.insight)}</div>`
      : '<span class="muted">No body-mass recordings yet.</span>')}
    ${row('🩺 Blood Pressure', bp
      ? `<strong>${esc(bp.reading)}</strong> ${bp.cat ? `<span class="tier ${bp.cat.cls}">${bp.cat.label}</span>` : ''}`
      : '<span class="muted">No blood-pressure readings yet.</span>')}
  </section>`;
}

/* ---- Daily sub-tab: body mass, BP, sleep, hydration, nutrition ---- */
function dailyPanel(a, checkins) {
  if (!checkins.length) return `${dailyInsightBox(a, checkins)}<section class="panel"><p class="muted">No daily data yet for this athlete.</p></section>`;
  const days = groupByDay(checkins);

  // --- series for each daily aspect ---
  const sleepSeries = days.map((d) => ({ label: d.label, hours: avg(d.items.filter((c) => c.sleep_type !== 'Nap'), (c) => c.sleep_hours) })).filter((d) => d.hours != null);
  const bmSeries = days.map((d) => ({ label: d.label, kg: avg(d.items, (c) => c.body_mass_kg) })).filter((d) => d.kg != null);
  const bpDays = days.map((d) => ({ label: d.label, sys: avg(d.items, (c) => c.bp_systolic), dia: avg(d.items, (c) => c.bp_diastolic) })).filter((d) => d.sys != null && d.dia != null);
  // Hydration is per-day in its own store — build a weekly series like the athlete history.
  const goalMl = hydrationGoalMl(a, 0).total;
  const last7 = last7Days().map((d) => ({ label: d.label, ml: hydrationMlForDay(a.id, d.key) }));

  return `
    ${dailyInsightBox(a, checkins)}
    ${aspectSection('💧 Hydration', hydrationWeekChart(last7, goalMl), hydrationLogTable(a))}
    ${aspectSection('⚖️ Body Mass', bodyMassWeekChart(bmSeries), bodyMassLogTable(checkins))}
    ${aspectSection('🩺 Blood Pressure', bpWeekChart(bpDays), bpLogTable(checkins))}
    ${aspectSection('😴 Sleep', sleepChart(sleepSeries), sleepLogTable(checkins))}`;
}

// 7 SGT days ending today (for hydration weekly series).
function last7Days() {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = sgtDay(d.toISOString());
    out.push({ key, label: key.slice(5) });
  }
  return out;
}

function hydrationLogTable(a) {
  const goalMl = hydrationGoalMl(a, 0).total;
  const rows = last7Days().slice().reverse().map((d) => {
    const ml = hydrationMlForDay(a.id, d.key);
    const pct = goalMl > 0 ? Math.round((ml / goalMl) * 100) : 0;
    const ok = ml >= goalMl;
    return `<tr><td>${esc(d.label)}</td><td>${(ml / 1000).toFixed(1)} L</td><td>${pct}%</td>
      <td><span class="tier ${ok ? 'green' : 'red'}">${ok ? 'Hydrated' : 'Dehydrated'}</span></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Day</th><th>Intake</th><th>% of goal</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function sleepLogTable(checkins) {
  const nights = checkins.filter((c) => c.sleep_type !== 'Nap' && c.sleep_hours != null).slice().reverse();
  if (!nights.length) return '<p class="muted">No overnight sleep logged yet.</p>';
  const rows = nights.map((c) => {
    const h = c.sleep_hours;
    const tier = h >= 9 ? ['green-dark', 'Excellent'] : h >= 7 ? ['green', 'Sufficient'] : ['red', 'Underslept'];
    return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td><td>${c.sleep_start && c.sleep_end ? esc(c.sleep_start + '–' + c.sleep_end) : '—'}</td>
      <td>${c.sleep_minutes != null ? formatHoursMinutes(c.sleep_minutes) : h + ' h'}</td><td><span class="tier ${tier[0]}">${tier[1]}</span></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Window</th><th>Duration</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Log-table helpers (shared, no <section> wrapper — used inside aspectSection).
function bodyMassLogTable(checkins) {
  const list = checkins.filter((c) => c.body_mass_kg != null).slice().reverse();
  if (!list.length) return '<p class="muted">No body-mass recordings yet.</p>';
  const rows = list.map((c, i) => {
    const prev = list[i + 1];
    const delta = prev && prev.body_mass_kg != null ? c.body_mass_kg - prev.body_mass_kg : null;
    const pct = (delta != null && prev.body_mass_kg) ? (delta / prev.body_mass_kg) * 100 : null;
    const deltaStr = delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg${pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}`;
    return `<tr><td>${esc(formatSgt(c.timestampUtc))}</td><td>${c.body_mass_kg} kg</td><td class="${delta != null && delta < 0 ? 'cell-down' : delta > 0 ? 'cell-up' : ''}">${deltaStr}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time (SGT)</th><th>Body mass</th><th>Δ vs prev (kg / %)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

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

// Pain & Symptoms interpretation for the coach.
const EXTREME_SYMPTOMS = ['Sharp / sudden pain during movement', 'Localised joint swelling', 'Head knock with dizziness / confusion'];
const SLIGHT_SYMPTOMS = ['General dull muscle tightness / stiffness / fatigue', 'Visible instability'];

function painInsight(checkins) {
  const painLogs = checkins.filter((c) => c.pain_score != null || (c.pain_symptoms && c.pain_symptoms.length) || c.pain_location);
  if (!painLogs.length) return null;
  const latest = painLogs[painLogs.length - 1];
  const symptoms = latest.pain_symptoms || [];
  const score = latest.pain_score;

  // Days injured: count distinct SGT days with a pain report in an ongoing run
  // ending at the latest report (simple: distinct days across all pain logs).
  const injuredDays = new Set(painLogs.map((c) => c.sgtDay || sgtDay(c.timestampUtc))).size;

  // Severity recommendation from symptoms.
  const hasExtreme = symptoms.some((s) => EXTREME_SYMPTOMS.includes(s));
  const hasSlight = symptoms.some((s) => SLIGHT_SYMPTOMS.includes(s));
  let recommendation, recCls;
  if (hasExtreme) { recommendation = 'Unable to exercise (extreme injury)'; recCls = 'red'; }
  else if (hasSlight) { recommendation = 'Light exercise (slight injury)'; recCls = 'yellow'; }
  else { recommendation = 'No limiting symptoms reported'; recCls = 'green'; }

  // Pain-level descriptor.
  let painLabel, painCls;
  if (score == null) { painLabel = '—'; painCls = ''; }
  else if (score >= 7) { painLabel = 'Severe pain (sharp pain)'; painCls = 'red'; }
  else if (score >= 4) { painLabel = 'Moderate pain'; painCls = 'yellow'; }
  else if (score >= 1) { painLabel = 'Slight pain'; painCls = 'yellow'; }
  else { painLabel = 'No pain'; painCls = 'green'; }

  // If pain >=7, also flag "(sharp pain)" beside the recommendation.
  const recSuffix = (score != null && score >= 7) ? ' (sharp pain)' : '';

  return {
    injuredDays, symptoms, score, painLabel, painCls,
    recommendation: recommendation + recSuffix, recCls,
    location: latest.pain_location,
    at: formatSgt(latest.timestampUtc),
  };
}

function painInsightBox(checkins) {
  const p = painInsight(checkins);
  if (!p) return `<section class="insight-box"><h2>🤕 Pain &amp; Symptoms</h2><p class="muted">No pain or symptoms logged yet.</p></section>`;
  const row = (title, inner) => `<div class="insight-row"><div class="insight-k">${title}</div><div class="insight-v">${inner}</div></div>`;
  return `
  <section class="insight-box">
    <h2>🤕 Pain &amp; Symptoms</h2>
    ${row('Days injured', `<strong>${p.injuredDays}</strong> day${p.injuredDays === 1 ? '' : 's'} with a logged pain report`)}
    ${row('Pain level', `<span class="tier ${p.painCls}">${esc(p.painLabel)}</span>${p.score != null ? ` <span class="muted small">· NPRS ${p.score}/10</span>` : ''}${p.location ? ` <span class="muted small">· ${esc(p.location)}</span>` : ''}`)}
    ${row('Symptoms', p.symptoms.length ? p.symptoms.map((s) => `<span class="pill">${esc(s)}</span>`).join(' ') : '<span class="muted">none reported</span>')}
    ${row('Recommendation', `<span class="tier ${p.recCls}">${esc(p.recommendation)}</span>`)}
    <div class="muted small insight-foot">Latest report: ${esc(p.at)}</div>
  </section>`;
}

/* ---- Pain & Symptoms sub-tab ---- */
function painPanel(a, checkins) {
  const days = groupByDay(checkins);
  const painSeries = days.map((d) => ({ label: d.label, pain: avg(d.items, (c) => c.pain_score) })).filter((d) => d.pain != null);
  const painLogs = checkins.filter((c) => c.pain_score != null || (c.pain_symptoms && c.pain_symptoms.length) || c.pain_location).slice().reverse();
  const logTable = painLogs.length ? `
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Pain</th><th>Location</th><th>Period</th><th>Symptoms</th><th>Actions</th></tr></thead>
      <tbody>${painLogs.map((c) => `<tr>
        <td>${esc(formatSgt(c.timestampUtc))}</td>
        <td class="${c.pain_score != null && c.pain_score >= 6 ? 'cell-red' : ''}">${c.pain_score ?? '—'}</td>
        <td>${esc(c.pain_location || '—')}</td><td>${esc(c.pain_period || '—')}</td>
        <td>${(c.pain_symptoms || []).map((s) => `<span class="pill">${esc(s)}</span>`).join(' ') || '—'}</td>
        <td>${esc(c.pain_actions || '—')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No pain or symptoms logged yet.</p>';
  return `
    ${painInsightBox(checkins)}
    ${aspectSection('🤕 Pain trend (NPRS per day)', painChart(painSeries), logTable)}`;
}

// AI-style interpretation of how hard the most recent training was for the athlete.
function trainingInsight(checkins) {
  const sessions = checkins.filter((c) => c.srpe != null || c.duration_mins != null || c.intensity_level);
  if (!sessions.length) return null;
  const c = sessions[sessions.length - 1];
  const srpe = c.srpe, dur = c.duration_mins, load = c.workload, type = c.intensity_level;

  // Difficulty bucket from sRPE (session RPE 1–10).
  let difficulty, dCls;
  if (srpe == null) { difficulty = 'Not rated'; dCls = ''; }
  else if (srpe >= 9) { difficulty = 'Maximal / very hard'; dCls = 'red'; }
  else if (srpe >= 7) { difficulty = 'Hard'; dCls = 'red'; }
  else if (srpe >= 5) { difficulty = 'Moderate'; dCls = 'yellow'; }
  else if (srpe >= 3) { difficulty = 'Light'; dCls = 'green'; }
  else { difficulty = 'Very easy / recovery'; dCls = 'green'; }

  // A plain-language description combining type, RPE, duration and workload,
  // benchmarked against the athlete's own recent average workload.
  const recentLoads = sessions.map((s) => s.workload).filter((v) => v != null);
  const avgLoad = recentLoads.length ? recentLoads.reduce((s, v) => s + v, 0) / recentLoads.length : null;
  let vsAvg = '';
  if (load != null && avgLoad) {
    const ratio = load / avgLoad;
    vsAvg = ratio >= 1.3 ? ' — a notably bigger load than their recent average'
      : ratio <= 0.7 ? ' — a lighter load than their recent average'
      : ' — in line with their recent average load';
  }
  const parts = [];
  if (type) parts.push(`${type} session`);
  if (dur != null) parts.push(`${dur} min`);
  if (srpe != null) parts.push(`RPE ${srpe}/10`);
  if (load != null) parts.push(`workload ${load} (sRPE×min)`);
  const describe = parts.length ? parts.join(' · ') : 'session logged';

  const narrative = srpe == null
    ? `Logged a ${type || 'training'} session${dur != null ? ` of ${dur} min` : ''}, but no RPE was given, so perceived difficulty is unknown.`
    : `This was a ${difficulty.toLowerCase()} session for the athlete (RPE ${srpe}/10)${dur != null ? ` lasting ${dur} min` : ''}${load != null ? `, giving a training load of ${load}${vsAvg}` : ''}.`;

  return { difficulty, dCls, describe, narrative, at: formatSgt(c.timestampUtc) };
}

function trainingInsightBox(checkins) {
  const t = trainingInsight(checkins);
  if (!t) return `<section class="insight-box"><h2>🔥 Training Load</h2><p class="muted">No training sessions logged yet.</p></section>`;
  const row = (title, inner) => `<div class="insight-row"><div class="insight-k">${title}</div><div class="insight-v">${inner}</div></div>`;
  return `
  <section class="insight-box">
    <h2>🔥 Training Load</h2>
    ${row('Difficulty', `<span class="tier ${t.dCls}">${esc(t.difficulty)}</span>`)}
    ${row('Session', `<strong>${esc(t.describe)}</strong>`)}
    ${row('Interpretation', `<div class="insight-ai">💡 ${esc(t.narrative)}</div>`)}
    <div class="muted small insight-foot">Latest session: ${esc(t.at)}</div>
  </section>`;
}

/* ---- Training sub-tab: training load ---- */
function trainingPanel(a, checkins) {
  if (!checkins.length) return `${trainingInsightBox(checkins)}<section class="panel"><p class="muted">No training data yet for this athlete.</p></section>`;
  const days = groupByDay(checkins);
  const srpeSeries = days.map((d) => ({ label: d.label, srpe: avg(d.items, (c) => c.srpe) })).filter((d) => d.srpe != null);

  const rawRows = checkins.filter((c) => c.srpe != null || c.intensity_level || c.duration_mins != null)
    .slice().reverse().map((c) => `<tr>
        <td>${esc(formatSgt(c.timestampUtc))}</td>
        <td>${esc(c.intensity_level || '—')}</td>
        <td>${c.srpe ?? '—'}</td>
        <td>${c.duration_mins ?? '—'}</td>
        <td>${c.workload ?? '—'}</td>
      </tr>`).join('');

  const alerts = evaluateAthlete(a, checkins);
  const alertList = alerts.length
    ? alerts.map((al) => `<li class="alert ${al.severity}"><span>${al.icon}</span><div><strong>${esc(al.title)}</strong><br><span class="muted">${esc(al.detail)}</span></div></li>`).join('')
    : '<li class="alert info"><span>🟢</span><div><strong>No active alerts</strong></div></li>';

  return `
    ${trainingInsightBox(checkins)}
    <div class="detail-cols">
      <div class="charts">
        <div class="chart-card">${srpeChart(srpeSeries)}</div>
      </div>
      <aside class="alerts-pane"><h3>🔔 Notifications &amp; Alerts</h3><ul class="alert-list">${alertList}</ul></aside>
    </div>
    <section class="panel"><h3>Training sessions — raw metrics</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>SGT</th><th>Intensity</th><th>sRPE</th><th>Dur</th><th>Workload</th>
      </tr></thead><tbody>${rawRows || '<tr><td colspan="5" class="muted">No training data</td></tr>'}</tbody></table></div>
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

  // Weekly hydration % of goal: average, across the 7 days of that ISO week, of
  // each day's intake as a % of the athlete's baseline daily goal. Hydration is
  // stored per-day (not per check-in), so it has its own week-value function.
  const goalMl = hydrationGoalMl(a, 0).total;
  const weekHydrationPct = (wk) => {
    if (goalMl <= 0) return null;
    const start = new Date(wk.start + 'T00:00:00Z');
    let sum = 0, n = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const ml = hydrationMlForDay(a.id, key);
      if (ml > 0) { sum += (ml / goalMl) * 100; n += 1; }
    }
    return n ? sum / n : null;
  };

  // One descriptor per physiological metric: how to pull its value + chart it.
  // Most use `pick` (per-check-in); hydration uses `weekValue` (per-week).
  const MS = [
    { sub: 'pain', label: '🤕 Pain (NPRS)', pick: (c) => c.pain_score, dp: 1,
      opts: { title: 'Pain — NPRS 0–10 (lower is better)', min: 0, max: 10, ref: 3, refLabel: 'watch ≥3', emptyMsg: 'No pain data yet' } },
    { sub: 'load', label: '🔥 Workload', pick: (c) => c.workload, dp: 0,
      opts: { title: 'Training workload — sRPE × min (per session)', emptyMsg: 'No training-load data yet' } },
    { sub: 'sleep', label: '😴 Sleep (h)', pick: (c) => (c.sleep_type !== 'Nap' ? c.sleep_hours : null), dp: 1,
      opts: { title: 'Overnight sleep — hours (7–10 h recommended)', min: 0, max: 12, ref: 7, refLabel: '7 h', emptyMsg: 'No sleep data yet' } },
    { sub: 'mass', label: '⚖️ Body mass', pick: (c) => c.body_mass_kg, dp: 1,
      opts: { title: 'Body mass — kg', emptyMsg: 'No body-mass data yet' } },
    { sub: 'hydration', label: '💧 Hydration %', weekValue: weekHydrationPct, dp: 0, unit: '%',
      opts: { title: 'Hydration — % of daily goal (100% = goal met)', min: 0, max: 150, ref: 100, refLabel: '100% goal', unit: '%', emptyMsg: 'No hydration data yet' } },
  ];

  // Value for a week, from either a per-check-in pick or a per-week function.
  const metricValue = (wk, m) => (m.weekValue ? m.weekValue(wk) : weekAvg(wk, m.pick));

  const subs = [{ sub: 'all', label: '📊 All' }, ...MS.map((m) => ({ sub: m.sub, label: m.label }))];
  const subBar = `<div class="subtabs">${subs.map((s) =>
    `<button class="subtab ${state.trendsPhysioSub === s.sub ? 'active' : ''}" data-tpsub="${s.sub}">${s.label}</button>`).join('')}</div>`;

  const mkSeries = (m) => weekList.map((wk) => ({ label: wk.label, value: metricValue(wk, m) }));
  const chartCard = (m) => `<div class="chart-card">${weeklyTrendChart(mkSeries(m), m.opts)}</div>`;
  const fmt = (v, dp) => (v == null ? '—' : v.toFixed(dp));

  const totalsTable = (list) => `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Week</th><th>#</th>${list.map((m) => `<th title="${esc(m.opts.title)}">${esc(m.label.replace(/^[^ ]+ /, ''))}</th>`).join('')}</tr></thead>
      <tbody>${weekList.slice().reverse().map((wk) => `
        <tr><td>${esc(wk.label)} <span class="muted small">(wk of ${esc(wk.start)})</span></td>
        <td>${wk.items.length}</td>
        ${list.map((m) => { const v = metricValue(wk, m); return `<td>${fmt(v, m.dp)}${m.unit === '%' && v != null ? '%' : ''}</td>`; }).join('')}</tr>`).join('')}
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
