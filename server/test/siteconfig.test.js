'use strict';
// Go-live settings: the runtime config the browser reads (GTM and payment link), the cookie consent rules and the start-up warnings.
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DIARY_MODE = 'demo';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpb-cfg-'));
delete process.env.ALLOW_INDEXING;
delete process.env.GTM_ID;
delete process.env.PAYMENT_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createServer } = require('../server');
const { gtmId, paymentUrl, configScript, goLiveWarnings } = require('../siteconfig');
const consent = require('../../consent');

const ROOT = path.join(__dirname, '..', '..');
const evalConfig = src => { const w = {}; vm.runInNewContext(src, { window: w }); return JSON.parse(JSON.stringify(w.MPB_CONFIG)); };

let server, base;
test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });
test.afterEach(() => { delete process.env.GTM_ID; delete process.env.PAYMENT_URL; });

test('only a real GTM container id and an https payment page are accepted', () => {
  assert.equal(gtmId({ GTM_ID: ' GTM-53J2272 ' }), 'GTM-53J2272');
  for (const bad of ['', 'G-ABC123', 'gtm-53j2272', 'GTM-', 'GTM-53J2272";alert(1)//', 'UA-1234-1']) assert.equal(gtmId({ GTM_ID: bad }), '', bad);
  assert.equal(paymentUrl({ PAYMENT_URL: 'https://pay.example.com/mpb?x=1' }), 'https://pay.example.com/mpb?x=1');
  for (const bad of ['', 'http://pay.example.com', 'javascript:alert(1)', 'pay.example.com', '//pay.example.com']) assert.equal(paymentUrl({ PAYMENT_URL: bad }), '', bad);
});

test('the static config used by the preview keeps analytics and payments off', () => {
  const cfg = evalConfig(fs.readFileSync(path.join(ROOT, 'site-config.js'), 'utf8'));
  assert.deepEqual(cfg, { gtm: '', paymentUrl: '' });
});

test('http: /site-config.js is built from the environment and never cached', async () => {
  let r = await fetch(base + '/site-config.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(evalConfig(await r.text()), { gtm: '', paymentUrl: '' });

  process.env.GTM_ID = 'GTM-53J2272';
  process.env.PAYMENT_URL = 'https://pay.example.com/mpb';
  r = await fetch(base + '/site-config.js');
  assert.deepEqual(evalConfig(await r.text()), { gtm: 'GTM-53J2272', paymentUrl: 'https://pay.example.com/mpb' });

  process.env.GTM_ID = 'nonsense';
  process.env.PAYMENT_URL = 'http://insecure.example.com';
  assert.deepEqual(evalConfig(configScript()), { gtm: '', paymentUrl: '' });
});

test('every page loads the config and consent scripts before common.js', () => {
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  assert.ok(pages.length >= 30);
  for (const f of pages) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const at = n => html.indexOf(`<script src="${n}"></script>`);
    assert.ok(at('site-config.js') > 0 && at('site-config.js') < at('consent.js') && at('consent.js') < at('common.js'), f);
  }
});

test('consent: a stored choice is used only while it is valid and under a year old', () => {
  const now = Date.UTC(2026, 10, 18);
  const ok = JSON.stringify({ analytics: true, marketing: false, at: now - 30 * 864e5 });
  assert.deepEqual(consent.readChoice(ok, now), { analytics: true, marketing: false, at: now - 30 * 864e5 });
  assert.equal(consent.readChoice(JSON.stringify({ analytics: true, marketing: false, at: now - 400 * 864e5 }), now), null);
  for (const bad of [null, '', 'x', '{}', '{"analytics":"yes","marketing":true,"at":1}', JSON.stringify({ analytics: true, marketing: true })]) assert.equal(consent.readChoice(bad, now), null, String(bad));
});

test('consent: choices map onto Consent Mode v2 signals, with everything denied by default', () => {
  const denied = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
  assert.deepEqual(consent.modeFor(null), denied);
  assert.deepEqual(consent.modeFor({ analytics: false, marketing: false }), denied);
  assert.deepEqual(consent.modeFor({ analytics: true, marketing: false }), { ...denied, analytics_storage: 'granted' });
  assert.deepEqual(consent.modeFor({ analytics: false, marketing: true }), { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'denied' });
});

test('go-live warnings stay quiet on a test host and flag each missing setting once indexing is on', () => {
  assert.deepEqual(goLiveWarnings({}), []);
  assert.deepEqual(goLiveWarnings({ GTM_ID: '' }), []);

  const live = { ALLOW_INDEXING: '1', SITE_URL: 'https://www.mypropertybox.co.uk' };
  const w = goLiveWarnings(live);
  assert.equal(w.length, 2);
  assert.match(w.join('\n'), /GTM_ID/);
  assert.match(w.join('\n'), /PAYMENT_URL/);

  const ready = { ...live, GTM_ID: 'GTM-53J2272', PAYMENT_URL: 'https://pay.example.com/mpb' };
  assert.deepEqual(goLiveWarnings(ready), []);
});

test('go-live warnings catch a feed that would read the site itself', () => {
  const ready = { ALLOW_INDEXING: '1', SITE_URL: 'https://www.mypropertybox.co.uk', GTM_ID: 'GTM-53J2272', PAYMENT_URL: 'https://pay.example.com/mpb' };
  assert.match(goLiveWarnings({ ...ready, FEED_REFRESH_MINUTES: '30' }).join('\n'), /FEED_SOURCE_URL/);
  assert.match(goLiveWarnings({ ...ready, FEED_REFRESH_MINUTES: '30', FEED_SOURCE_URL: 'https://www.mypropertybox.co.uk/' }).join('\n'), /FEED_SOURCE_URL/);
  assert.deepEqual(goLiveWarnings({ ...ready, FEED_REFRESH_MINUTES: '30', FEED_SOURCE_URL: 'https://old.mypropertybox.co.uk' }), []);
  assert.deepEqual(goLiveWarnings(ready), []);
});
