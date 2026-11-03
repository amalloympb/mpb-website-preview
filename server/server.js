'use strict';
// My Property Box web server: serves the static site (allow-listed) and the viewing API.
// No dependencies. Configuration is read from environment variables or server/.env (never served).
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* no .env file */ }
})();

const http = require('http');
const crypto = require('crypto');
const { computeAvailability, londonParts } = require('./engine');
const { adapterFor, isDemo } = require('./diary');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const suffix = () => (isDemo() ? '-demo' : '');
const HOLDS_FILE = () => path.join(DATA_DIR, `holds${suffix()}.json`);
const LEADS_FILE = () => path.join(DATA_DIR, `leads${suffix()}.jsonl`);

const engineOpts = () => {
  const o = {};
  if (Number(process.env.VIEWING_DAYS) > 0) o.days = Math.min(20, Number(process.env.VIEWING_DAYS));
  if (process.env.VIEWING_LEAD_HOURS !== undefined && process.env.VIEWING_LEAD_HOURS !== '') o.leadHours = Number(process.env.VIEWING_LEAD_HOURS) || 0;
  if (process.env.CLOSED_DATES) o.closed = process.env.CLOSED_DATES.split(',').map(s => s.trim()).filter(Boolean);
  return o;
};

// ---- Properties (from the synced feed) ----
let index = { mtime: 0, map: new Map() };
async function getProperty(id) {
  const file = path.join(ROOT, 'data', 'properties.json');
  const st = await fs.promises.stat(file);
  if (st.mtimeMs !== index.mtime) {
    const j = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    index = { mtime: st.mtimeMs, map: new Map(j.properties.map(p => [String(p.id), p])) };
  }
  return index.map.get(String(id)) || null;
}

// ---- Holds: viewings requested through the site, so the same slot is not offered twice ----
let holds = null;
const readHolds = () => {
  if (!holds || holds.file !== HOLDS_FILE()) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(HOLDS_FILE(), 'utf8')); } catch (e) { /* none yet */ }
    holds = { file: HOLDS_FILE(), list };
  }
  holds.list = holds.list.filter(h => h.end > Date.now() - 86400000);
  return holds.list;
};
const saveHolds = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = HOLDS_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(holds.list));
  fs.renameSync(tmp, HOLDS_FILE());
};

async function availabilityFor(property, fresh) {
  const adapter = adapterFor(property);
  if (!adapter || property.status !== 'available' || typeof property.lat !== 'number') return null;
  const { negotiators } = await adapter.getBusy({ property, fresh });
  return computeAvailability({ negotiators, property: { id: String(property.id), lat: property.lat, lng: property.lng }, holds: readHolds(), opts: engineOpts() });
}

// ---- Helpers ----
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
};
const json = (res, status, obj, extra = {}) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });

const hits = new Map();
const limited = (key, max, windowMs) => {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
};
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600000)) hits.delete(k); }, 600000).unref();

const clientIp = req => {
  if (process.env.TRUST_PROXY) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress || 'unknown';
};

const readBody = (req, limit = 16384) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

let chain = Promise.resolve();
const locked = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function cleanAttribution(a) {
  const out = {};
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    for (const [k, v] of Object.entries(a).slice(0, 12)) if (typeof v === 'string' && k.length <= 30) out[k] = v.slice(0, 200);
  }
  return out;
}

// ---- API ----
async function availability(req, res, url) {
  if (limited('av:' + clientIp(req), 60, 60000)) return json(res, 429, { error: 'rate_limited' });
  const id = url.searchParams.get('property') || '';
  if (!ID_RE.test(id)) return json(res, 400, { error: 'bad_property' });
  const property = await getProperty(id);
  if (!property) return json(res, 404, { error: 'not_found' });
  const result = await availabilityFor(property, false).catch(e => { console.error('availability failed:', e.message); return null; });
  const days = result ? result.days.map(d => ({ date: d.date, slots: d.slots.map(s => ({ start: s.start, t: s.t, nearby: s.nearby })) })) : [];
  json(res, 200, { mode: isDemo() ? 'demo' : 'live', tz: 'Europe/London', days });
}

async function booking(req, res) {
  const ip = clientIp(req);
  if (limited('bk:' + ip, Number(process.env.RATE_BOOKINGS) || 6, 600000)) return json(res, 429, { error: 'rate_limited' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'unsupported_media_type' });
  let b;
  try { b = JSON.parse(await readBody(req)); } catch (e) { return json(res, e.status || 400, { error: e.status === 413 ? 'too_large' : 'bad_json' }); }
  if (!b || typeof b !== 'object') return json(res, 400, { error: 'bad_json' });

  if (str(b.company_website, 100)) return json(res, 200, { ok: true, ref: 'MPB-00000000' }); // honeypot: pretend success, store nothing

  const id = str(b.property, 40), name = str(b.name, 80), email = str(b.email, 120), phone = str(b.phone, 30);
  const consent = b.consent === true || b.consent === 'yes';
  const startMs = typeof b.start === 'string' ? Date.parse(b.start) : NaN;
  const fail = (field, error = 'invalid') => json(res, 422, { error, field });
  if (!ID_RE.test(id)) return fail('property');
  if (!Number.isFinite(startMs)) return fail('start');
  if (name.length < 2) return fail('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('email');
  if (phone && !/^[0-9+()\s-]{7,20}$/.test(phone)) return fail('phone');
  if (!consent) return fail('consent');
  const move = str(b.move_in_date, 10);
  if (move && !/^\d{4}-\d{2}-\d{2}$/.test(move)) return fail('move_in_date');

  const property = await getProperty(id);
  if (!property) return json(res, 404, { error: 'not_found' });

  const out = await locked(async () => {
    const av = await availabilityFor(property, true);
    const slot = av && av.days.flatMap(d => d.slots).find(s => s.start === new Date(startMs).toISOString());
    if (!slot) return { status: 409, body: { error: 'slot_unavailable' } };
    const chosen = slot.free.find(f => f.nearby) || slot.free[0];
    const ref = 'MPB-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const demo = isDemo();
    const p = londonParts(startMs);
    const record = {
      type: 'viewing_booking', ref, received: new Date().toISOString(), demo,
      source: 'property-page-picker',
      property: { id: String(property.id), address: property.address, section: property.section, price: property.price_text, status: property.status, crm: property.source, url: property.url },
      slot: { start: slot.start, end: new Date(startMs + 30 * 60000).toISOString(), local: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${slot.t}` },
      contact: { name, email, phone, message: str(b.message, 600), buyer_position: str(b.buyer_position, 60), occupants: str(b.occupants, 20), move_in_date: move },
      consent: true, consent_statement: str(b.consent_statement, 800), attribution: cleanAttribution(b.attribution)
    };
    let stored = '';
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(LEADS_FILE(), JSON.stringify(record) + '\n');
      stored = 'file';
    } catch (e) { console.error('lead file write failed:', e.message); }
    if (process.env.LEAD_WEBHOOK_URL && !demo) {
      try {
        const r = await fetch(process.env.LEAD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record), signal: AbortSignal.timeout(8000) });
        if (r.ok) stored = 'webhook'; else console.error('lead webhook responded', r.status);
      } catch (e) { console.error('lead webhook failed:', e.message); }
    }
    if (!stored) return { status: 502, body: { error: 'not_stored' } };
    readHolds().push({ id: ref, property_id: String(property.id), negotiator: chosen.id, start: startMs, end: startMs + 30 * 60000, lat: property.lat, lng: property.lng, created: Date.now() });
    try { saveHolds(); } catch (e) { console.error('holds write failed:', e.message); }
    return { status: 200, body: { ok: true, ref, start: slot.start, date: record.slot.local.slice(0, 10), t: slot.t, demo, stored } };
  });
  json(res, out.status, out.body);
}

// ---- Static files (allow-list) ----
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',   '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.pdf': 'application/pdf'
};
const PRIVATE_DIRS = new Set(['server', 'feed', 'archive', 'node_modules']);

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  if (rel.includes('\0') || rel.includes('\\')) return send(res, 400, 'Bad request');
  if (rel.endsWith('/')) rel += 'index.html';
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(s => s.startsWith('.') || s === '..') || PRIVATE_DIRS.has(parts[0])) return send(res, 404, 'Not found');
  let file = path.resolve(ROOT, ...parts);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');
  let st = await fs.promises.stat(file).catch(() => null);
  if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = await fs.promises.stat(file).catch(() => null); }
  const ext = path.extname(file).toLowerCase();
  if (!st || !st.isFile() || !TYPES[ext] || (ext === '.json' && parts[0] !== 'data')) return send(res, 404, 'Not found');
  const cacheable = !['.html', '.js', '.css', '.json'].includes(ext);
  res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': TYPES[ext], 'Content-Length': st.size, 'Cache-Control': cacheable ? 'public, max-age=86400' : 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ---- Server ----
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const origin = process.env.ALLOWED_ORIGIN;
        if (origin && req.headers.origin === origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
          if (req.method === 'OPTIONS') return send(res, 204, '');
        }
        if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, mode: isDemo() ? 'demo' : 'live' });
        if (url.pathname === '/api/availability' && req.method === 'GET') return await availability(req, res, url);
        if (url.pathname === '/api/viewings' && req.method === 'POST') return await booking(req, res);
        return json(res, 404, { error: 'not_found' });
      }
      await serveStatic(req, res, url.pathname);
    } catch (e) {
      console.error('request failed:', req.method, String(req.url).split('?')[0], e.message);
      if (!res.headersSent) json(res, 500, { error: 'server_error' }); else res.destroy();
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080, host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => {
    console.log(`My Property Box site on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  (diary: ${isDemo() ? 'DEMO data' : 'live adapters only'})`);
  });
}

module.exports = { createServer };
