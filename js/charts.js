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
  const max = Math.max(10, Math.ceil(Math.max(...series.map((s) => s.hours ?? 0))));
  const pts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.hours ?? 0, min, max), hours: s.hours }));
  const eightY = scaleY(8, min, max);
  // dots coloured against the >8h recommendation
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-${p.hours == null ? 'green' : p.hours < 6 ? 'red' : p.hours < 8 ? 'yellow' : 'green'}"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0) + 'h', title: 'Sleep per Day (hours)' }) +
    `<line x1="${P.l}" y1="${eightY}" x2="${W - P.r}" y2="${eightY}" class="baseline"/>` +
    `<text x="${W - P.r}" y="${eightY - 4}" class="ann">8h recommended</text>` +
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
