'use strict';
// Integration test for the API and static allow-list, using the demo diary. Run: node --test server/test
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DIARY_MODE = 'demo';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpb-'));
delete process.env.LEAD_WEBHOOK_URL;
process.env.RATE_BOOKINGS = '30';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

let server, base;
test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

const get = p => fetch(base + p);
const post = (body, headers = {}) => fetch(base + '/api/viewings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const PID = '56D453AF-3';
const person = { name: 'Test Person', email: 'test@example.com', phone: '07700 900123', consent: true, consent_statement: 'I agree' };

test('static: site files are served, private files are not', async () => {
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/property.html')).status, 200);
  assert.equal((await get('/data/properties.json')).status, 200);
  for (const p of ['/server/server.js', '/server/.env', '/server/data/leads-demo.jsonl', '/feed/sync.js', '/archive/', '/README.md', '/.env', '/%2e%2e/server/server.js', '/..%2fserver/server.js', '/data/../server/engine.js', '/index.html%00.png', '/package.json']) {
    const r = await get(p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
  }
  assert.equal((await get('/')).headers.get('x-content-type-options'), 'nosniff');
});

test('availability: demo slots for an available property', async () => {
  const r = await get('/api/availability?property=' + PID);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mode, 'demo');
  assert.ok(j.days.length >= 5);
  assert.ok(j.days.every(d => d.slots.length && d.slots.every(s => s.start && s.t && typeof s.nearby === 'boolean' && !('free' in s))));
});

test('availability: bad ids, unknown properties and non-bookable properties', async () => {
  assert.equal((await get('/api/availability?property=../x')).status, 400);
  assert.equal((await get('/api/availability?property=NOPE123')).status, 404);
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'properties.json'), 'utf8')).properties;
  const sold = all.find(p => p.status === 'sold');
  const j = await (await get('/api/availability?property=' + sold.id)).json();
  assert.deepEqual(j.days, []);
});

test('booking: validation, honeypot, success, double-booking and holds', async () => {
  const j = await (await get('/api/availability?property=' + PID)).json();
  const start = j.days[0].slots[0].start;
  assert.equal((await post({ property: PID, start, ...person, email: 'nope' })).status, 422);
  assert.equal((await post({ property: PID, start, ...person, consent: false })).status, 422);
  assert.equal((await post({ property: PID, start: 'not a date', ...person })).status, 422);
  assert.equal((await post('{oops')).status, 400);
  assert.equal((await post({ property: PID, start, ...person }, { 'Content-Type': 'text/plain' })).status, 415);
  const hp = await post({ property: PID, start, ...person, company_website: 'http://spam' });
  assert.equal(hp.status, 200);
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'leads-demo.jsonl')), 'honeypot stores nothing');

  const bogus = await post({ property: PID, start: '2026-01-01T10:00:00.000Z', ...person });
  assert.equal(bogus.status, 409);

  const ok = await post({ property: PID, start, ...person, message: 'Hi', attribution: { utm_source: 'x', evil: { a: 1 } } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.match(body.ref, /^MPB-[0-9A-F]{8}$/);
  assert.equal(body.demo, true);

  const rec = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'leads-demo.jsonl'), 'utf8').trim());
  assert.equal(rec.contact.email, 'test@example.com');
  assert.equal(rec.demo, true);
  assert.deepEqual(rec.attribution, { utm_source: 'x' });

  const again = await post({ property: PID, start, ...person });
  assert.equal(again.status, 409, 'same slot cannot be booked twice');
  const after = await (await get('/api/availability?property=' + PID)).json();
  assert.ok(!after.days.flatMap(d => d.slots).some(s => s.start === start), 'booked slot is no longer offered');
});

test('booking: concurrent requests for one slot yield exactly one booking', async () => {
  const j = await (await get('/api/availability?property=100990007665')).json();
  const start = j.days[1].slots[2].start;
  const rs = await Promise.all([1, 2, 3].map(() => post({ property: '100990007665', start, ...person })));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409, 409]);
});

test('booking: rate limit per client', async () => {
  process.env.RATE_BOOKINGS = '5'; // earlier tests already used more than this
  const r = await post({ property: PID, start: '2026-01-01T10:00:00.000Z', ...person });
  assert.equal(r.status, 429);
});
