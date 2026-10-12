#!/usr/bin/env node
/*  Scalp Radar shared server
    Runs ONE copy of the scanner, both demo accounts and the Trade Agent 24/7, whether or not anyone
    is watching, and serves the same live results to every device. Only the owner (PIN) can change things.

    Start:  npm install   then   npm start          (needs Node.js 18 or newer)
    Open:   http://localhost:8080   (or http://<server-ip>:8080 from another device)
*/
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = __dirname, DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json'), CONFIG_FILE = path.join(DATA, 'config.json');
fs.mkdirSync(DATA, { recursive: true });

/* ---------- config: port + owner PIN ---------- */
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
if (process.env.SR_PIN) cfg.pin = String(process.env.SR_PIN);
if (!cfg.pin) { cfg.pin = String(crypto.randomInt(100000, 999999)); }
cfg.port = Number(process.env.PORT || cfg.port || 8080);
fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));

const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);
const readPage = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------- persistent browser storage for the engine ---------- */
let saved = {};
try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
function persist(win) {
  try {
    const o = {}; const ls = win.localStorage;
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); o[k] = ls.getItem(k); }
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(o)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  } catch (e) { log('Could not save state:', e.message); }
}

/* ---------- the engine: the real scanner page, running headless ---------- */
class Loader extends ResourceLoader {
  fetch(url, opts) {
    const u = new URL(url);
    if (u.hostname !== 'engine.local') return null;
    const name = path.basename(u.pathname);
    if (name === 'server-config.js') return Promise.resolve(Buffer.from(''));
    try { return Promise.resolve(fs.readFileSync(path.join(ROOT, name))); } catch (e) { return Promise.resolve(Buffer.from('')); }
  }
}
let engine = null, startedAt = Date.now();
function startEngine() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => log('page error:', e.message));
  vc.on('warn', (...a) => log('page warn:', ...a));
  const fetchImpl = global.__SR_FETCH__ || fetch;          // tests can inject a fake exchange
  const dom = new JSDOM(readPage('scalp-radar.html'), {
    url: 'http://engine.local/index.html', runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.SR_ENGINE = true;
      for (const k in saved) { try { w.localStorage.setItem(k, saved[k]); } catch (e) {} }
      w.fetch = fetchImpl; w.AbortController = AbortController;
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      w.alert = () => {}; w.confirm = () => false; w.prompt = () => null;
    }
  });
  engine = dom; startedAt = Date.now();
  log('Engine started: scanning, both demo accounts and the Trade Agent now run on this server.');
}

/* ---------- snapshots: what every viewer sees ---------- */
let ver = 0, lastJson = '', lastGz = null;
function snapshot() {
  const SR = engine && engine.window.SR; if (!SR) return;
  try {
    const json = JSON.stringify(SR.snapshot());
    if (json !== lastJson) { lastJson = json; ver++; lastGz = zlib.gzipSync(Buffer.from(JSON.stringify({ v: ver, state: JSON.parse(json) }))); }
  } catch (e) { log('snapshot failed:', e.message); }
}

/* ---------- watchdog: keep scanning even if a scan gets stuck ---------- */
function watchdog() {
  const w = engine && engine.window; if (!w || !w.SR) return;
  try {
    const st = JSON.parse(lastJson || '{}'), every = ((st.S && st.S.refresh) || 3) * 60e3;
    if (st.S && st.S.auto !== false && !st.scanning && st.last && Date.now() - st.last > every * 3 + 120e3) { log('Scan overdue, starting one.'); w.SR.cmd('scan'); }
  } catch (e) {}
}

/* ---------- HTTP ---------- */
const fails = new Map();   // ip -> {n, until}
const pinOk = p => { const a = Buffer.from(String(p || '')), b = Buffer.from(cfg.pin); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const inject = html => html.replace('<script src="server-config.js"></script>', '<script>window.SR_SERVER=location.origin</script>');
function send(res, code, body, type, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }, extra || {}));
  res.end(body);
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), ip = (req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').toString();
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/scalp-radar.html')) return send(res, 200, inject(readPage('scalp-radar.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/agent.html') return send(res, 200, inject(readPage('agent.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/agent-core.js') return send(res, 200, readPage('agent-core.js'), 'application/javascript; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/server-config.js') return send(res, 200, '', 'application/javascript; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/api/health') { const st = JSON.parse(lastJson || '{}'); return send(res, 200, JSON.stringify({ ok: !!(engine && engine.window.SR), version: ver, lastScan: st.last || null, upSince: startedAt }), 'application/json'); }
    if (req.method === 'GET' && u.pathname === '/api/state') {
      if (!lastGz) snapshot();
      if (!lastGz) return send(res, 503, JSON.stringify({ error: 'Engine is starting' }), 'application/json');
      if (Number(u.searchParams.get('v')) === ver) return send(res, 204, '');
      if (/gzip/.test(req.headers['accept-encoding'] || '')) return send(res, 200, lastGz, 'application/json', { 'Content-Encoding': 'gzip' });
      return send(res, 200, zlib.gunzipSync(lastGz), 'application/json');
    }
    if (req.method === 'POST' && u.pathname === '/api/cmd') {
      const f = fails.get(ip); if (f && f.until > Date.now()) return send(res, 429, JSON.stringify({ error: 'Too many wrong PINs' }), 'application/json');
      let body = ''; for await (const ch of req) { body += ch; if (body.length > 2e6) return send(res, 413, 'Too large'); }
      let j; try { j = JSON.parse(body); } catch (e) { return send(res, 400, JSON.stringify({ error: 'Bad JSON' }), 'application/json'); }
      if (!pinOk(j.pin)) { const n = (f ? f.n : 0) + 1; fails.set(ip, { n, until: n >= 5 ? Date.now() + 10 * 60e3 : 0 }); log(`Wrong PIN from ${ip} (${n})`); return send(res, 401, JSON.stringify({ error: 'Wrong PIN' }), 'application/json'); }
      fails.delete(ip);
      const out = await engine.window.SR.cmd(String(j.type), j.payload || {});
      log(`Owner action: ${j.type}`, out && out.ok ? '' : JSON.stringify(out));
      persist(engine.window); setTimeout(snapshot, 200);
      return send(res, 200, JSON.stringify(out || { ok: false }), 'application/json');
    }
    send(res, 404, 'Not found');
  } catch (e) { log('request error:', e.message); send(res, 500, 'Server error'); }
});

startEngine();
setInterval(snapshot, 3000);
setInterval(() => engine && persist(engine.window), 10000);
setInterval(watchdog, 60000);
const stop = () => { log('Saving and stopping…'); if (engine) persist(engine.window); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('uncaughtException', e => log('uncaught:', e && e.stack || e));
process.on('unhandledRejection', e => log('unhandled:', e && e.message || e));

server.listen(cfg.port, () => {
  log(`Scalp Radar shared server on http://localhost:${cfg.port}`);
  log(`Owner PIN: ${cfg.pin}   (change it in data/config.json, then restart)`);
});
module.exports = { server, getEngine: () => engine, snapshot };
