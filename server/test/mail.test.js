'use strict';
// Unit tests for the SMTP sender and lead formatting. Run: node --test server/test/mail.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const mail = require('../mail');
const { fakeSmtp } = require('./fake-smtp');

const FROM = { addr: 'website@example.com', name: 'My Property Box website' };
const rec = (over = {}) => ({
  type: 'valuation', ref: 'MPB-TEST0001', received: '2026-10-22T13:05:00.000Z', office: 'darlington',
  fields: { name: 'Jo Bloggs', email: 'jo@example.com', phone: '07700 900123', intent: 'sell', address: '1 High Street, Darlington', bedrooms: '3', marketing: false },
  consent_statement: 'I agree to be contacted', attribution: { utm_source: 'google', landing: '/sell.html' }, page: 'https://example.test/sell.html', ...over
});

test('formatLead: subject, key fields first, consent and source details', () => {
  const m = mail.formatLead(rec());
  assert.equal(m.subject, 'Valuation request (sell): 1 High Street, Darlington - Jo Bloggs');
  assert.equal(m.replyTo, 'jo@example.com');
  assert.match(m.text, /Reference: MPB-TEST0001/);
  assert.match(m.text, /Received: 22 Oct 2026, 14:05 \(UK time\)/);
  assert.match(m.text, /Office: Darlington/);
  assert.ok(m.text.indexOf('Name: Jo Bloggs') < m.text.indexOf('Bedrooms: 3'), 'key fields come first');
  assert.match(m.text, /Marketing consent: No/);
  assert.match(m.text, /Consent given: "I agree to be contacted"/);
  assert.match(m.text, /Utm source: google/);
  assert.match(m.text, /Reply to this email/);
});

test('formatLead: viewing bookings say the diary was not updated', () => {
  const m = mail.formatLead(mail.viewingRecord({
    ref: 'MPB-AB12CD34', received: '2026-10-22T09:00:00.000Z', consent_statement: 'ok', attribution: {},
    property: { address: '5 Park Road, Darlington', price: '£950 pcm', url: 'https://example.test/p/1', crm: 'veco' },
    slot: { local: '2026-10-24 11:30' }, contact: { name: 'Sam', email: 'sam@example.com', phone: '', message: 'Is parking included?', buyer_position: '', occupants: '2', move_in_date: '' }
  }, { lat: 54.52, lng: -1.55 }));
  assert.equal(m.subject, 'Viewing request: 5 Park Road, Darlington - Sam');
  assert.match(m.text, /Requested slot: 2026-10-24 11:30 \(UK time\)/);
  assert.match(m.text, /NOT been added to the diary/);
  assert.match(m.text, /Office: Darlington/);
  assert.ok(!/Buyer position/.test(m.text), 'empty fields are left out');
});

test('office routing: ids and names are accepted, nothing else', () => {
  assert.equal(mail.officeId('darlington'), 'darlington');
  assert.equal(mail.officeId('Newcastle'), 'newcastle');
  assert.equal(mail.officeId(' Penrith '), 'penrith');
  assert.equal(mail.officeId('darlington\r\nBcc: evil@example.com'), '');
  assert.equal(mail.officeId('cockermouth'), '');
  assert.equal(mail.officeId(undefined), '');
  assert.equal(mail.officeForProperty({ rm_branch: 90144 }), 'carlisle');
  assert.equal(mail.officeForProperty({ rm_branch: 90147 }), 'penrith');
  assert.equal(mail.officeForProperty({ lat: 54.97, lng: -1.61 }), 'newcastle');
  assert.equal(mail.officeForProperty({ lat: 51.5, lng: -0.12 }), '', 'too far from any office');
  assert.equal(mail.officeForProperty({}), '');
});

test('config and recipients come from the environment only', () => {
  assert.equal(mail.config({}), null);
  assert.equal(mail.config({ SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@example.com' }), null, 'no recipient');
  assert.equal(mail.config({ SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'not-an-address', LEAD_EMAIL_TO: 'a@example.com' }), null, 'bad sender');
  const c = mail.config({ SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'My Property Box <web@example.com>', LEAD_EMAIL_TO: 'info@example.com' });
  assert.equal(c.port, 587);
  assert.equal(c.secure, false);
  assert.deepEqual(c.from, { addr: 'web@example.com', name: 'My Property Box' });
  assert.equal(mail.config({ SMTP_HOST: 'h', SMTP_SECURE: 'true', MAIL_FROM: 'web@example.com', LEAD_EMAIL_DARLINGTON: 'd@example.com' }).port, 465, 'an office inbox alone is enough');

  const env = { LEAD_EMAIL_TO: 'info@example.com, bad address', LEAD_EMAIL_DARLINGTON: 'dar@example.com; dar2@example.com', LEAD_EMAIL_CC: 'boss@example.com, dar@example.com' };
  assert.deepEqual(mail.recipientsFor('darlington', env), { to: ['dar@example.com', 'dar2@example.com'], cc: ['boss@example.com'] });
  assert.deepEqual(mail.recipientsFor('newcastle', env), { to: ['info@example.com'], cc: ['boss@example.com', 'dar@example.com'] });
  assert.deepEqual(mail.recipientsFor('', env).to, ['info@example.com']);
});

const send = async (srv, over = {}, r = rec()) => {
  const { subject, text, replyTo } = mail.formatLead(r);
  const data = mail.buildMessage({ from: FROM, to: ['office@example.com'], cc: [], replyTo, subject, text });
  const cfg = { host: 'localhost', port: srv.port, secure: false, user: '', pass: '', insecure: true, ca: srv.ca, ...over };
  return mail.smtpSend(cfg, { from: FROM.addr, to: ['office@example.com'], data }, 5000);
};

test('smtp: plain delivery (explicitly allowed) carries the right envelope, headers and UTF-8 body', async () => {
  const srv = await fakeSmtp();
  try {
    await send(srv, {}, rec({ fields: { ...rec().fields, name: 'Zoë Müller', message: 'Line one\nLine two\n.leading dot' } }));
    assert.equal(srv.messages.length, 1);
    const m = srv.messages[0];
    assert.equal(m.from, 'website@example.com');
    assert.deepEqual(m.rcpt, ['office@example.com']);
    assert.match(m.headers.subject[0], /^=\?UTF-8\?B\?/, 'non-ASCII subject is encoded');
    assert.equal(m.headers['reply-to'][0], 'jo@example.com');
    assert.equal(m.headers['content-type'][0], 'text/plain; charset=utf-8');
    assert.match(m.text, /Name: Zoë Müller/);
    assert.match(m.text, /\.leading dot/);
  } finally { await srv.close(); }
});

test('smtp: refuses to send without TLS unless explicitly allowed', async () => {
  const srv = await fakeSmtp();
  try {
    await assert.rejects(send(srv, { insecure: false }), /STARTTLS/);
    assert.equal(srv.messages.length, 0);
  } finally { await srv.close(); }
});

test('smtp: STARTTLS upgrade, then AUTH PLAIN (only offered after TLS)', async () => {
  const srv = await fakeSmtp({ starttls: true, auth: 'PLAIN LOGIN', credentials: { user: 'web@example.com', pass: 's3cret' } });
  try {
    await send(srv, { insecure: false, user: 'web@example.com', pass: 's3cret' });
    assert.equal(srv.messages.length, 1);
    assert.equal(srv.messages[0].tls, true);
    assert.equal(srv.messages[0].user, 'web@example.com');
    assert.deepEqual(srv.commands.slice(0, 3), ['EHLO', 'STARTTLS', 'EHLO']);
  } finally { await srv.close(); }
});

test('smtp: implicit TLS (port 465 style) with AUTH LOGIN', async () => {
  const srv = await fakeSmtp({ implicitTls: true, auth: 'LOGIN', credentials: { user: 'u', pass: 'p' } });
  try {
    await send(srv, { secure: true, insecure: false, user: 'u', pass: 'p' });
    assert.equal(srv.messages.length, 1);
    assert.equal(srv.messages[0].tls, true);
  } finally { await srv.close(); }
});

test('smtp: untrusted certificates are rejected', async () => {
  const srv = await fakeSmtp({ starttls: true });
  try {
    await assert.rejects(send(srv, { insecure: false, ca: undefined }));
    assert.equal(srv.messages.length, 0);
  } finally { await srv.close(); }
});

test('smtp: bad credentials fail without leaking the password; rejected recipients fail', async () => {
  const srv = await fakeSmtp({ starttls: true, auth: 'PLAIN', credentials: { user: 'u', pass: 'right' }, rejectRcpt: /blocked@/ });
  try {
    await assert.rejects(send(srv, { insecure: false, user: 'u', pass: 'wrong-pass' }), e => /535/.test(e.message) && !/wrong-pass/.test(e.message));
    const { subject, text } = mail.formatLead(rec());
    const data = mail.buildMessage({ from: FROM, to: ['blocked@example.com'], cc: [], subject, text });
    await assert.rejects(mail.smtpSend({ host: 'localhost', port: srv.port, secure: false, user: 'u', pass: 'right', ca: srv.ca }, { from: FROM.addr, to: ['blocked@example.com'], data }, 5000), /550/);
    assert.equal(srv.messages.length, 0);
  } finally { await srv.close(); }
});

test('smtp: connection problems reject instead of hanging', async () => {
  const srv = await fakeSmtp();
  const port = srv.port;
  await srv.close();
  await assert.rejects(send({ port, ca: srv.ca }), /ECONNREFUSED|connect/i);
});

test('headers: line breaks in visitor-supplied text cannot add headers or recipients', async () => {
  const srv = await fakeSmtp();
  try {
    const evil = 'Eve\r\nBcc: evil@example.com\r\nX-Injected: yes';
    await send(srv, {}, rec({ fields: { ...rec().fields, name: evil, message: evil, address: evil }, office: 'darlington' }));
    const m = srv.messages[0];
    assert.deepEqual(m.rcpt, ['office@example.com']);
    assert.equal(m.headers.bcc, undefined);
    assert.equal(m.headers['x-injected'], undefined);
    assert.ok(!/[\r\n]/.test(m.headers.subject.join('')));
    assert.match(m.text, /Bcc: evil@example.com/, 'it is just text in the body');
  } finally { await srv.close(); }
});

test('sendLeadEmail: not configured is a quiet no-op', async () => {
  assert.deepEqual(await mail.sendLeadEmail(rec(), {}), { sent: false, reason: 'not_configured' });
});
