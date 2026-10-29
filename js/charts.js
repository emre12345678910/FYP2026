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

/* 2. Pain & Intensity overlay — bars = sRPE, line = pain */
export function painIntensityChart(series) {
  // series: [{ label, srpe, pain }]
  if (!series.length) return emptyChart('No session/pain data yet');
  const labels = series.map((s) => s.label);
  const min = 0, max = 10;
  const inner = H - P.t - P.b;
  const bw = Math.max(6, ((W - P.l - P.r) / series.length) * 0.5);
  let bars = '';
  series.forEach((s, i) => {
    const x = scaleX(i, series.length);
    const y = scaleY(s.srpe ?? 0, min, max);
    bars += `<rect x="${x - bw / 2}" y="${y}" width="${bw}" height="${P.t + inner - y}" class="bar-srpe"/>`;
  });
  const painPts = series.map((s, i) => ({ x: scaleX(i, series.length), y: scaleY(s.pain ?? 0, min, max) }));
  const dots = painPts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot-red"/>`).join('');
  return svgWrap(
    axes(min, max, labels, { yFmt: (v) => v.toFixed(0), title: 'sRPE (bars) vs Pain NPRS (line)' }) +
    bars + `<path d="${path(painPts)}" class="line-red"/>` + dots
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

/* 4. Sleep vs recovery matrix — scatter: x=duration, y=quality, colour=readiness */
export function sleepMatrixChart(points) {
  // points: [{ hours, quality, tier }]  tier: green|yellow|red
  if (!points.length) return emptyChart('No sleep data yet');
  const xMin = 0, xMax = 12, yMin = 0, yMax = 10;
  const sx = (v) => P.l + (v / xMax) * (W - P.l - P.r);
  const sy = (v) => scaleY(v, yMin, yMax);
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const y = scaleY((yMax * k) / 4, yMin, yMax);
    grid += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" class="grid"/>`;
    grid += `<text x="${P.l - 6}" y="${y + 4}" class="ytick">${((yMax * k) / 4).toFixed(0)}</text>`;
  }
  for (let h = 0; h <= 12; h += 2) {
    const x = sx(h);
    grid += `<text x="${x}" y="${H - P.b + 16}" class="xtick">${h}h</text>`;
  }
  // 6h deprivation guide line
  grid += `<line x1="${sx(6)}" y1="${P.t}" x2="${sx(6)}" y2="${H - P.b}" class="threshold"/>`;
  grid += `<text x="${sx(6) + 2}" y="${P.t + 10}" class="ann red">6h</text>`;
  const dots = points.map((p) =>
    `<circle cx="${sx(p.hours)}" cy="${sy(p.quality)}" r="5" class="dot-${p.tier}"/>`
  ).join('');
  return svgWrap(
    `<text x="${W / 2}" y="12" class="chart-title">Sleep Duration (x) vs Quality (y) · colour = readiness</text>` +
    grid + dots
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
