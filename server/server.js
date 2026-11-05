// server.js — zero-dependency local-network prototype backend.
// Serves the static site AND a tiny shared-data REST API backed by a JSON file.
//
// Run:   node server/server.js            (from the project root)
//   or:  node server.js                   (from inside the server/ folder)
//
// Then on THIS machine:        http://localhost:8080/
// On a phone/laptop on the     http://<this-machine-LAN-IP>:8080/
//   same Wi-Fi:                (the script prints the exact address on start)
//
// Data is stored in server/data.json so it survives restarts.
//
// API:
//   GET  /api/state         → { <key>: <value>, ... } for all known keys
//   PUT  /api/state/:key    → body is the raw JSON value; stored under that key
//
// This is a PROTOTYPE: no auth, no TLS. Fine for a trusted local network / demo.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');            // project root (static files)
const DATA_FILE = path.join(__dirname, 'data.json');   // shared data store
const PORT = process.env.PORT || 8080;

const KEYS = [
  'eastside_fc_athletes_v1',
  'eastside_fc_checkins_v1',
  'eastside_fc_mental_v1',
  'eastside_fc_overrides_v1',
  'eastside_fc_hydration_v1',
];
// Which keys are arrays of records (merged by id) vs maps (merged by key).
const ARRAY_KEYS = new Set(['eastside_fc_athletes_v1', 'eastside_fc_checkins_v1', 'eastside_fc_mental_v1']);

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Merge an incoming value into the stored value so a poll from one device can't
// wipe a record another device just added. Arrays merge by id (incoming wins on
// conflict); maps (overrides/hydration) shallow-merge with incoming winning.
function mergeValue(key, existing, incoming) {
  if (ARRAY_KEYS.has(key)) {
    const byId = new Map();
    for (const r of Array.isArray(existing) ? existing : []) if (r && r.id) byId.set(r.id, r);
    for (const r of Array.isArray(incoming) ? incoming : []) if (r && r.id) byId.set(r.id, r);
    return [...byId.values()];
  }
  return { ...(existing || {}), ...(incoming || {}) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  // prevent path traversal outside the project root
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  // --- API: get full shared state ---
  if (req.method === 'GET' && url === '/api/state') {
    const data = readData();
    const out = {};
    for (const k of KEYS) out[k] = data[k] ?? (ARRAY_KEYS.has(k) ? [] : {});
    return sendJson(res, 200, out);
  }

  // --- API: update one key (merge) ---
  if (req.method === 'PUT' && url.startsWith('/api/state/')) {
    const key = decodeURIComponent(url.slice('/api/state/'.length));
    if (!KEYS.includes(key)) return sendJson(res, 400, { error: 'unknown key' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      let incoming;
      try { incoming = JSON.parse(body || 'null'); }
      catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
      const data = readData();
      data[key] = mergeValue(key, data[key], incoming);
      writeData(data);
      return sendJson(res, 200, { ok: true, key, count: Array.isArray(data[key]) ? data[key].length : Object.keys(data[key]).length });
    });
    return;
  }

  // --- otherwise: static files ---
  return serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  console.log('\n🥊  Eastside FC prototype server running\n');
  console.log(`   On this machine:   http://localhost:${PORT}/`);
  for (const a of addrs) console.log(`   On your network:   http://${a}:${PORT}/   ← open this on your friend's device`);
  console.log(`\n   Athlete Daily Log: .../          (index.html — default)`);
  console.log(`   Coach dashboard:   .../dashboard.html`);
  console.log(`   Shared data file:  ${DATA_FILE}\n`);
});
