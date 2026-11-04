'use strict';
// Integration tests for POST /api/leads in live mode with a fake SMTP server. Run: node --test server/test/leads.test.js
const os = require('os');
const fs = require('fs');
const path = require('path');
delete process.env.DIARY_MODE;
delete process.env.LEAD_WEBHOOK_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpb-leads-'));
process.env.RATE_LEADS = '200';
process.env.RATE_LEADS_GLOBAL = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { fakeSmtp } = require('./fake-smtp');

let server, base, smtp;
const LOG = () => path.join(process.env.DATA_DIR, 'leads.jsonl');
const logged = () => (fs.existsSync(LOG()) ? fs.readFileSync(LOG(), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);

test.before(async () => {
  smtp = await fakeSmtp();
  Object.assign(process.env, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_ALLOW_INSECURE: '1', MAIL_FROM: 'My Property Box <website@example.com>',
    LEAD_EMAIL_TO: 'info@example.com', LEAD_EMAIL_DARLINGTON: 'darlington@example.com'
  });
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await smtp.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

const post = (body, headers = {}) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const valuation = (over = {}) => ({
  lead_type: 'valuation', source: 'town-page', name: 'Jo Bloggs', email: 'jo@example.com', phone: '07700 900123', intent: 'sell', address: '1 High Street, Darlington',
  consent: true, consent_statement: 'I agree', submitted_at: '2026-10-22T10:00:00Z', page: 'https://example.test/', attribution: { utm_source: 'google' }, ...over
});

test('a valuation lead is logged and emailed to the named office, replying goes to the visitor', async () => {
  const r = await post(valuation({ office: 'Darlington' }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.demo, false);
  assert.deepEqual(j.channels, ['file', 'email']);
  assert.match(j.ref, /^MPB-[0-9A-F]{8}$/);
  const m = smtp.messages.at(-1);
  assert.deepEqual(m.rcpt, ['darlington@example.com']);
  assert.equal(m.from, 'website@example.com');
  assert.equal(m.headers['reply-to'][0], 'jo@example.com');
  assert.match(m.headers.subject[0], /Valuation request \(sell\): 1 High Street, Darlington - Jo Bloggs/);
  assert.match(m.text, /Reference: MPB-/);
  assert.match(m.text, /Phone: 07700 900123/);
  const rec = logged().at(-1);
  assert.equal(rec.ref, j.ref);
  assert.equal(rec.office, 'darlington');
  assert.equal(rec.fields.email, 'jo@example.com');
});

test('a lead with no (or an unknown) office goes to the default inbox', async () => {
  for (const office of [undefined, '', 'Atlantis']) {
    const before = smtp.messages.length;
    const r = await post(valuation({ office }));
    assert.equal(r.status, 200);
    assert.equal(smtp.messages.length, before + 1);
    assert.deepEqual(smtp.messages.at(-1).rcpt, ['info@example.com']);
  }
});

test('every lead type from the site is accepted, including nested values', async () => {
  for (const lead_type of ['enquiry', 'callback', 'valuation', 'compliance_check', 'alert', 'report']) {
    const r = await post(valuation({ lead_type, search: { section: 'lettings', beds: 2 }, answers: { gas: 'yes', eicr: 'no' }, outstanding: ['EICR', 'Smoke alarms'] }));
    assert.equal(r.status, 200, lead_type);
  }
  const m = smtp.messages.at(-1);
  assert.match(m.text, /Search: Section: lettings; Beds: 2/);
  assert.match(m.text, /Outstanding items: EICR, Smoke alarms/);
});

test('validation: type, consent, contact details and format', async () => {
  const bad = async (body, field, status = 422) => {
    const before = smtp.messages.length, lines = logged().length;
    const r = await post(body);
    assert.equal(r.status, status, JSON.stringify(field));
    if (field) assert.equal((await r.json()).field, field);
    assert.equal(smtp.messages.length, before);
    assert.equal(logged().length, lines);
  };
  await bad(valuation({ lead_type: 'newsletter' }), 'lead_type');
  await bad(valuation({ lead_type: undefined }), 'lead_type');
  await bad(valuation({ consent: false }), 'consent');
  await bad(valuation({ consent: undefined }), 'consent');
  await bad(valuation({ consent: 'yes' }), 'consent');
  await bad(valuation({ email: 'not an email' }), 'email');
  await bad(valuation({ email: 'a"b@example.com' }), 'email');
  await bad(valuation({ email: undefined, phone: undefined }), 'email');
  await bad(valuation({ phone: 'call me' }), 'phone');
  await bad([1, 2], null, 400);
  await bad('{nope', null, 400);
  await bad('null', null, 400);
  const r = await post(valuation(), { 'Content-Type': 'text/plain' });
  assert.equal(r.status, 415);
});

test('phone-only leads are accepted', async () => {
  const r = await post(valuation({ email: undefined }));
  assert.equal(r.status, 200);
  assert.equal(smtp.messages.at(-1).headers['reply-to'], undefined);
});

test('oversized requests are refused', async () => {
  const r = await post(valuation({ message: 'x'.repeat(40000) }));
  assert.equal(r.status, 413);
});

test('visitor text cannot add recipients or headers', async () => {
  const evil = 'x\r\nBcc: evil@example.com';
  const r = await post(valuation({ name: evil, message: evil, office: 'darlington\r\nBcc: evil@example.com', 'bad key\r\n': 'x' }));
  assert.equal(r.status, 200);
  const m = smtp.messages.at(-1);
  assert.deepEqual(m.rcpt, ['info@example.com'], 'an invalid office falls back to the default inbox');
  assert.equal(m.headers.bcc, undefined);
  assert.ok(!/bad key/.test(m.text));
});

test('the honeypot looks like success but stores and sends nothing', async () => {
  const before = smtp.messages.length, lines = logged().length;
  const r = await post(valuation({ company_website: 'http://spam.example' }));
  assert.equal(r.status, 200);
  assert.equal(smtp.messages.length, before);
  assert.equal(logged().length, lines);
});

test('if email fails the lead is still kept in the log', async () => {
  const port = process.env.SMTP_PORT;
  process.env.SMTP_PORT = '1';
  try {
    const lines = logged().length;
    const r = await post(valuation({ name: 'Kept Lead' }));
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).channels, ['file']);
    assert.equal(logged().length, lines + 1);
  } finally { process.env.SMTP_PORT = port; }
});

test('with no email configured the lead is only logged', async () => {
  const saved = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    const before = smtp.messages.length;
    const r = await post(valuation());
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).channels, ['file']);
    assert.equal(smtp.messages.length, before);
  } finally { process.env.SMTP_HOST = saved; }
});

test('demo mode only logs, never emails, and tells the page it is a preview', async () => {
  process.env.DIARY_MODE = 'demo';
  try {
    const before = smtp.messages.length;
    const r = await post(valuation());
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.demo, true);
    assert.deepEqual(j.channels, ['file']);
    assert.equal(smtp.messages.length, before);
    assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'leads-demo.jsonl')));
  } finally { delete process.env.DIARY_MODE; }
});

test('GET /api/leads is not a route', async () => {
  assert.equal((await fetch(base + '/api/leads')).status, 404);
});
