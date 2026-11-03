// charts.js — tiny zero-dependency SVG chart renderers.
// Each returns an SVG string. Designed for small multi-series dashboards.

const NS = 'http://www.w3.org/2000/svg';
const W = 560, H = 240, P = { t: 20, r: 20, b: 44, l: 44 };

function scaleX(i, n) {
  const inner = W - P.l - P.r;
  return n <= 1 ? P.l + inner / 2 : P.l + (i / (n - 1)) * inner;
}
function scaleY(v, min, max) {
  const inner = H - P.t - P.b;
  if (max === min) return P.t + inner / 2;
  return P.t + inner - ((v - min) / (max - min)) * inner;
}

function axes(min, max, labels, { yFmt = (v) => v, title = '' } = {}) {
  const inner = H - P.t - P.b;
  let g = '';
  // y grid + labels (5 ticks)
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    const y = P.t + inner - (inner * k) / 4;
    g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" class="grid"/>`;
    g += `<text x="${P.l - 6}" y="${y + 4}" class="ytick">${yFmt(v)}</text>`;
  }
  // x labels (thin out if many)
  const step = Math.ceil(labels.length / 7) || 1;
  labels.forEach((lab, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const x = scaleX(i, labels.length);
    g += `<text x="${x}" y="${H - P.b + 16}" class="xtick">${lab}</text>`;
  });
  const titleEl = title ? `<text x="${W / 2}" y="12" class="chart-title">${title}</text>` : '';
  return titleEl + g;
}

function svgWrap(inner) {
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" xmlns="${NS}">${inner}</svg>`;
}

function path(points) {
  if (!points.length) return '';
  return 'M' + points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
}

function emptyChart(msg) {
  return svgWrap(`<text x="${W / 2}" y="${H / 2}" class="empty">${msg || 'No data yet'}</text>`);
}

/* 1. ROM progression vs 100% baseline */
export function romChart(series) {
  // series: [{ label, pct }]
  if (!series.length) return emptyChart('No ROM data yet');
  const labels = series.map((s) => s.label);
  const min = 0, max = 100;
  const pts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.pct, min, max) }));
  const baselineY = scaleY(100, min, max);
  const sixtyY = scaleY(60, min, max);
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-blue"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0) + '%', title: 'ROM Progression (% of baseline)' }) +
    `<line x1="${P.l}" y1="${baselineY}" x2="${W - P.r}" y2="${baselineY}" class="baseline"/>` +
    `<text x="${W - P.r}" y="${baselineY - 4}" class="ann">100% baseline</text>` +
    `<line x1="${P.l}" y1="${sixtyY}" x2="${W - P.r}" y2="${sixtyY}" class="threshold"/>` +
    `<text x="${W - P.r}" y="${sixtyY - 4}" class="ann red">60% alert</text>` +
    `<path d="${path(pts)}" class="line-blue"/>` + dots
  );
}

/* 2a. sRPE training load — bar chart (one bar per day) */
export function srpeChart(series) {
  // series: [{ label, srpe }]
  const data = series.filter((s) => s.srpe != null);
  if (!data.length) return emptyChart('No session RPE data yet');
  const labels = data.map((s) => s.label);
  const min = 0, max = 10;
  const inner = H - P.t - P.b;
  const bw = Math.max(6, ((W - P.l - P.r) / data.length) * 0.5);
  let bars = '';
  data.forEach((s, i) => {
    const x = scaleX(i, data.length);
    const y = scaleY(s.srpe, min, max);
    bars += `<rect x="${x - bw / 2}" y="${y}" width="${bw}" height="${P.t + inner - y}" class="bar-srpe"/>`;
  });
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'Session RPE per Day (1–10)' }) + bars
  );
}

/* 2b. Pain progression — line chart (NPRS per day) */
export function painChart(series) {
  // series: [{ label, pain }]
  const data = series.filter((s) => s.pain != null);
  if (!data.length) return emptyChart('No pain data yet');
  const labels = data.map((s) => s.label);
  const min = 0, max = 10;
  const pts = data.map((s, i) => ({ x: scaleX(i, data.length), y: scaleY(s.pain, min, max) }));
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-red"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'Pain Progression — NPRS per Day (0–10)' }) +
    `<path d="${path(pts)}" class="line-red"/>` + dots
  );
}

/* 3. Hydration & weight loss — pre/post bars + fluid loss % line */
export function hydrationChart(series) {
  // series: [{ label, pre, post, lossPct }]
  if (!series.length) return emptyChart('No weight data yet');
  const labels = series.map((s) => s.label);
  const weights = series.flatMap((s) => [s.pre, s.post]).filter((v) => v != null);
  const wMin = Math.floor(Math.min(...weights) - 1);
  const wMax = Math.ceil(Math.max(...weights) + 1);
  const inner = H - P.t - P.b;
  const bw = Math.max(5, ((W - P.l - P.r) / series.length) * 0.3);
  let bars = '';
  series.forEach((s, i) => {
    const x = scaleX(i, series.length);
    if (s.pre != null) {
      const y = scaleY(s.pre, wMin, wMax);
      bars += `<rect x="${x - bw - 1}" y="${y}" width="${bw}" height="${P.t + inner - y}" class="bar-pre"/>`;
    }
    if (s.post != null) {
      const y = scaleY(s.post, wMin, wMax);
      bars += `<rect x="${x + 1}" y="${y}" width="${bw}" height="${P.t + inner - y}" class="bar-post"/>`;
    }
  });
  return svgWrap(
    axes(wMin, wMax, labels, { yFmt: (v) => v.toFixed(1), title: 'Pre (dark) vs Post (light) Body Mass (kg)' }) +
    bars
  );
}

/* 4. Sleep progression — line chart of hours slept per day, with a 6h guide */
export function sleepChart(series) {
  // series: [{ label, hours }]
  if (!series.length) return emptyChart('No sleep data yet');
  const labels = series.map((s) => s.label);
  const min = 0;
  const max = Math.max(11, Math.ceil(Math.max(...series.map((s) => s.hours ?? 0))));
  const pts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.hours ?? 0, min, max), hours: s.hours }));
  const lowY = scaleY(7, min, max);
  const highY = scaleY(10, min, max);
  // dots: within the 7–10h band = green, below 7 = yellow, above 10 = red
  const dots = pts.map((p) => {
    const cls = p.hours == null ? 'green' : p.hours > 10 ? 'red' : p.hours < 7 ? 'yellow' : 'green';
    return `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-${cls}"/>`;
  }).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0) + 'h', title: 'Overnight Sleep per Night (hours)' }) +
    `<line x1="${P.l}" y1="${highY}" x2="${W - P.r}" y2="${highY}" class="threshold"/>` +
    `<text x="${W - P.r}" y="${highY - 4}" class="ann red">10h</text>` +
    `<line x1="${P.l}" y1="${lowY}" x2="${W - P.r}" y2="${lowY}" class="threshold"/>` +
    `<text x="${W - P.r}" y="${lowY - 4}" class="ann red">7h</text>` +
    `<path d="${path(pts)}" class="line-green"/>` + dots
  );
}

/* 5. Nutrition & fueling overview — workload bars + fueled/under markers */
export function nutritionChart(series) {
  // series: [{ label, workload, fueled }]
  if (!series.length) return emptyChart('No session/nutrition data yet');
  const labels = series.map((s) => s.label);
  const max = Math.max(10, ...series.map((s) => s.workload ?? 0));
  const min = 0;
  const inner = H - P.t - P.b;
  const bw = Math.max(6, ((W - P.l - P.r) / series.length) * 0.5);
  let bars = '';
  series.forEach((s, i) => {
    const x = scaleX(i, series.length);
    const y = scaleY(s.workload ?? 0, min, max);
    bars += `<rect x="${x - bw / 2}" y="${y}" width="${bw}" height="${P.t + inner - y}" class="${s.fueled ? 'bar-fueled' : 'bar-underfuel'}"/>`;
    bars += `<text x="${x}" y="${y - 4}" class="barlabel">${s.fueled ? '✓' : '✕'}</text>`;
  });
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'Session Workload (sRPE×min) · ✓ fueled / ✕ under-fueled' }) +
    bars
  );
}

/* ======================= Psychological charts ======================= */

// Horizontal profile chart used by RESTQ & POMS. `rows` = [{ label, value, cls }].
// `min`/`max` set the value axis; `mid` draws an optional reference line.
function profileBars(rows, { min, max, title, unit = '', mid = null } = {}) {
  if (!rows.length) return emptyChart('No data yet');
  const PL = 150, PR = 24, PT = 26, PB = 20;
  const rowH = 22, gap = 8;
  const h = PT + PB + rows.length * (rowH + gap);
  const innerW = W - PL - PR;
  const sx = (v) => PL + ((v - min) / (max - min)) * innerW;
  let g = title ? `<text x="${W / 2}" y="14" class="chart-title">${title}</text>` : '';
  // axis ticks
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    const x = sx(v);
    g += `<line x1="${x}" y1="${PT}" x2="${x}" y2="${h - PB}" class="grid"/>`;
    g += `<text x="${x}" y="${h - PB + 14}" class="xtick">${v.toFixed(unit === '%' ? 0 : 1)}${unit}</text>`;
  }
  if (mid != null) {
    const mx = sx(mid);
    g += `<line x1="${mx}" y1="${PT}" x2="${mx}" y2="${h - PB}" class="threshold"/>`;
  }
  rows.forEach((r, i) => {
    const y = PT + i * (rowH + gap);
    const bw = r.value == null ? 0 : Math.max(0, sx(r.value) - PL);
    g += `<text x="${PL - 8}" y="${y + rowH / 2 + 4}" class="row-label">${r.label}</text>`;
    g += `<rect x="${PL}" y="${y}" width="${innerW}" height="${rowH}" class="track"/>`;
    g += `<rect x="${PL}" y="${y}" width="${bw}" height="${rowH}" class="bar-${r.cls || 'blue'}"/>`;
    if (r.value != null) g += `<text x="${PL + bw + 6}" y="${y + rowH / 2 + 4}" class="bar-val">${r.value.toFixed(1)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" class="chart" xmlns="${NS}">${g}</svg>`;
}

// RESTQ-Sport profile: every scale as a bar, coloured by stress (red) vs
// recovery (green). Scale 0–6.
export function restqProfileChart(score) {
  if (!score || !score.scales) return emptyChart('No RESTQ data yet');
  const rows = score.scales.map((s) => ({
    label: s.name,
    value: s.score,
    cls: s.group === 'stress' ? 'red' : 'green',
  }));
  return profileBars(rows, { min: 0, max: 6, title: 'RESTQ-Sport Profile — Stress (red) vs Recovery (green)', mid: 3 });
}

// RESTQ stress vs recovery index trend over time. series = [{ label, stress, recovery }].
export function restqBalanceChart(series) {
  if (!series.length) return emptyChart('No RESTQ data yet');
  const labels = series.map((s) => s.label);
  const min = 0, max = 6;
  const sPts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.stress ?? 0, min, max) }));
  const rPts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.recovery ?? 0, min, max) }));
  const sDots = sPts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-red"/>`).join('');
  const rDots = rPts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-green"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'RESTQ Trend — Stress (red) vs Recovery (green)' }) +
    `<path d="${path(sPts)}" class="line-red"/>` + sDots +
    `<path d="${path(rPts)}" class="line-green"/>` + rDots
  );
}

// POMS mood profile (latest): subscales as bars. Score = subscale sum (0–12
// for a 3-item short form). Vigour drawn green, negative moods red.
export function pomsProfileChart(score) {
  if (!score || !score.subscales) return emptyChart('No POMS data yet');
  const max = Math.max(12, ...score.subscales.map((s) => s.score ?? 0));
  const rows = score.subscales.map((s) => ({
    label: s.name,
    value: s.score,
    cls: s.polarity === 'positive' ? 'green' : 'red',
  }));
  return profileBars(rows, { min: 0, max, title: 'POMS Mood Profile — Vigour (green) vs negative moods (red)' });
}

// POMS Total Mood Disturbance trend. series = [{ label, tmd }]. Lower = better.
export function pomsTmdChart(series) {
  if (!series.length) return emptyChart('No POMS data yet');
  const labels = series.map((s) => s.label);
  const vals = series.map((s) => s.tmd ?? 100);
  const min = Math.min(80, Math.floor(Math.min(...vals) - 5));
  const max = Math.max(120, Math.ceil(Math.max(...vals) + 5));
  const pts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.tmd ?? 100, min, max) }));
  const baseY = scaleY(100, min, max);
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-blue"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'POMS Total Mood Disturbance (lower is better)' }) +
    `<line x1="${P.l}" y1="${baseY}" x2="${W - P.r}" y2="${baseY}" class="baseline"/>` +
    `<text x="${W - P.r}" y="${baseY - 4}" class="ann">neutral 100</text>` +
    `<path d="${path(pts)}" class="line-blue"/>` + dots
  );
}

// TSCI confidence trend (mean 1–9). series = [{ label, score }].
export function tsciChart(series) {
  if (!series.length) return emptyChart('No confidence data yet');
  const labels = series.map((s) => s.label);
  const min = 1, max = 9;
  const pts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.score ?? 1, min, max) }));
  const midY = scaleY(5, min, max);
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-green"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'TSCI Sport-Confidence (1–9, higher is better)' }) +
    `<line x1="${P.l}" y1="${midY}" x2="${W - P.r}" y2="${midY}" class="threshold"/>` +
    `<text x="${W - P.r}" y="${midY - 4}" class="ann">midpoint 5</text>` +
    `<path d="${path(pts)}" class="line-green"/>` + dots
  );
}

// SMS-6 motivation profile (latest): 6 subscales, self-determined → amotivation.
// score 1–7.
export function smsProfileChart(score) {
  if (!score || !score.subscales) return emptyChart('No motivation data yet');
  const rows = score.subscales.map((s) => ({
    label: s.name,
    value: s.score,
    cls: s.raiWeight > 0 ? 'green' : 'red',
  }));
  return profileBars(rows, { min: 1, max: 7, title: 'SMS-6 Motivation Profile — autonomous (green) vs controlled (red)', mid: 4 });
}

// SMS-6 Relative Autonomy Index trend. series = [{ label, rai }]. Higher = more
// self-determined motivation.
export function smsRaiChart(series) {
  if (!series.length) return emptyChart('No motivation data yet');
  const labels = series.map((s) => s.label);
  const vals = series.map((s) => s.rai ?? 0);
  const bound = Math.max(10, Math.ceil(Math.max(...vals.map(Math.abs)) + 2));
  const min = -bound, max = bound;
  const pts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.rai ?? 0, min, max) }));
  const zeroY = scaleY(0, min, max);
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-blue"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'SMS-6 Relative Autonomy Index (higher is better)' }) +
    `<line x1="${P.l}" y1="${zeroY}" x2="${W - P.r}" y2="${zeroY}" class="baseline"/>` +
    `<path d="${path(pts)}" class="line-blue"/>` + dots
  );
}
