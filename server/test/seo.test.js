'use strict';
// SEO: static audit of every page, robots.txt, sitemap.xml, property <head> tags, canonical host, compression and the 404 page.
// Run: node --test server/test
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
process.env.DIARY_MODE = 'demo';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpb-seo-'));
delete process.env.ALLOW_INDEXING;
delete process.env.SITE_URL;
delete process.env.TRUST_PROXY;

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const seo = require('../seo');
const { audit } = require('../../tools/seo-check');

const ROOT = path.join(__dirname, '..', '..');
const FEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'properties.json'), 'utf8')).properties;
const LIVE = FEED.find(p => p.status === 'available' && p.section === 'sales' && p.source !== 'rightmove');
const SOLD = FEED.find(p => p.status === 'sold');
const BASE = 'https://www.mypropertybox.co.uk';

let server, base;
test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });
test.afterEach(() => { delete process.env.ALLOW_INDEXING; delete process.env.SITE_URL; });

const get = (p, opts) => fetch(base + p, { redirect: 'manual', ...opts });
const rawGet = (p, headers) => new Promise((resolve, reject) => {
  http.get(base + p, { headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

test('every page passes the SEO audit', () => {
  const { problems, pages } = audit();
  assert.ok(pages >= 30, 'pages were found');
  assert.deepEqual(problems, []);
});

test('sitemap lists pages and live properties only, with escaped absolute URLs', () => {
  const xml = seo.sitemapXml({ files: ['index.html', 'sell.html'], properties: [{ id: 'a&b', status: 'available' }, { id: 'gone', status: 'sold' }, { id: 'let1', status: 'let' }, { id: 'stc', status: 'sstc' }, { id: 'la', status: 'let-agreed' }] });
  assert.match(xml, /<loc>https:\/\/www\.mypropertybox\.co\.uk\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/www\.mypropertybox\.co\.uk\/sell\.html<\/loc>/);
  assert.match(xml, /property\.html\?id=a%26b/);
  assert.match(xml, /id=stc/);
  assert.match(xml, /id=la</);
  assert.ok(!/id=gone|id=let1/.test(xml), 'sold and let properties are left out');
  assert.ok(!/index\.html|property\.html<|404\.html/.test(xml));
});

test('robots.txt blocks everything until indexing is switched on', () => {
  assert.equal(seo.robotsTxt({ allow: false }), 'User-agent: *\nDisallow: /\n');
  const on = seo.robotsTxt({ allow: true });
  assert.match(on, /Allow: \//);
  assert.match(on, /Disallow: \/api\//);
  assert.match(on, new RegExp(`Sitemap: ${BASE}/sitemap\\.xml`));
});

test('canonical host: other names go to the live domain, local and IP hosts are left alone', () => {
  assert.equal(seo.canonicalRedirect('mypropertybox.co.uk', '/sell.html?x=1'), BASE + '/sell.html?x=1');
  assert.equal(seo.canonicalRedirect('mpb-test.azurewebsites.net', '/'), BASE + '/');
  assert.equal(seo.canonicalRedirect('www.mypropertybox.co.uk', '/'), null);
  assert.equal(seo.canonicalRedirect('WWW.MyPropertyBox.co.uk:443', '/'), null);
  for (const h of ['localhost:8080', '127.0.0.1:3000', '10.0.0.4', '', undefined]) assert.equal(seo.canonicalRedirect(h, '/'), null, String(h));
});

test('property tags: title, description, canonical, share image, listing data', () => {
  const html = fs.readFileSync(path.join(ROOT, 'property.html'), 'utf8');
  const p = { id: 'x1', section: 'sales', address: 'Flat $1 <b>&</b> "Rd"', town: 'Darlington', price: 250000, price_qualifier: 'Guide price', status: 'available', beds: 2, type: 'Flat', lat: 54.5, lng: -1.5, photo: 'https://img.example/p.jpg' };
  const out = seo.injectProperty(html, seo.propertyMeta(p, { summary: 'A lovely flat.', photos: ['https://img.example/a.jpg', 'http://insecure/b.jpg'] }));
  assert.match(out, /<title>Flat \$1 &lt;b&gt;&amp;&lt;\/b&gt; &quot;Rd&quot; \| For sale Guide price \u00a3250,000 \| My Property Box<\/title>/);
  assert.match(out, /<meta name="description" content="A lovely flat\.">/);
  assert.match(out, new RegExp(`<link rel="canonical" href="${BASE}/property\\.html\\?id=x1">`));
  assert.match(out, /<meta property="og:image" content="https:\/\/img\.example\/a\.jpg">/);
  assert.match(out, /<meta name="twitter:image" content="https:\/\/img\.example\/a\.jpg">/);
  assert.ok(!/noindex/.test(out));
  assert.ok(!/insecure/.test(out), 'only https images are used');
  const ld = JSON.parse(/<script type="application\/ld\+json" id="ld-property">([\s\S]*?)<\/script>/.exec(out)[1]);
  assert.equal(ld['@type'], 'RealEstateListing');
  assert.equal(ld.offers.price, 250000);
  assert.equal(ld.offers.availability, 'https://schema.org/InStock');
  assert.equal(ld.about.numberOfBedrooms, 2);
  assert.equal((out.match(/<title>/g) || []).length, 1);
});

test('property tags: sold properties are noindex, unknown ids are noindex, markup cannot break out of the script tag', () => {
  const html = fs.readFileSync(path.join(ROOT, 'property.html'), 'utf8');
  const sold = seo.injectProperty(html, seo.propertyMeta({ id: 's', section: 'lets', address: 'A </script><script>alert(1)</script>', town: 'X', price_pcm: 500, price_freq: 'pcm', status: 'let' }));
  assert.match(sold, /<meta name="robots" content="noindex,follow">/);
  assert.match(sold, /SoldOut/);
  assert.ok(!/<\/script><script>alert/.test(sold));
  assert.match(seo.injectProperty(html, { missing: true }), /<meta name="robots" content="noindex">/);
});

test('http: preview mode sends noindex everywhere and robots.txt disallows all', async () => {
  const r = await get('/sell.html');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(await (await get('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
});

test('http: live mode drops the noindex header and serves robots.txt and sitemap.xml', async () => {
  process.env.ALLOW_INDEXING = '1';
  process.env.SITE_URL = 'http://127.0.0.1:' + server.address().port;
  const r = await get('/sell.html');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), null);
  const robots = await (await get('/robots.txt')).text();
  assert.match(robots, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  const s = await get('/sitemap.xml');
  assert.equal(s.status, 200);
  assert.match(s.headers.get('content-type'), /xml/);
  const xml = await s.text();
  assert.ok(xml.includes(`property.html?id=${encodeURIComponent(LIVE.id)}`));
  assert.ok(!xml.includes(`id=${encodeURIComponent(SOLD.id)}<`), 'sold property is not listed');
  assert.ok(xml.includes('/estate-agents-darlington.html'));
});

test('http: live mode sends other hostnames to the canonical one, but not the API', async () => {
  process.env.ALLOW_INDEXING = '1';
  const r = await rawGet('/sell.html?a=1', { host: 'mypropertybox.co.uk' });
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, BASE + '/sell.html?a=1');
  assert.equal((await rawGet('/api/health', { host: 'mypropertybox.co.uk' })).status, 200);
});

test('http: property page carries that listing\'s tags, and an unknown id is a real 404', async () => {
  const ok = await get('/property.html?id=' + encodeURIComponent(LIVE.id));
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.ok(html.includes(`<link rel="canonical" href="${BASE}/property.html?id=${encodeURIComponent(LIVE.id)}">`));
  assert.ok(html.includes('For sale'));
  assert.ok(!html.includes('<title>Property details'));
  const off = await get('/property.html?id=' + encodeURIComponent(SOLD.id));
  assert.equal(off.status, 200);
  assert.match(await off.text(), /<meta name="robots" content="noindex,follow">/);
  const gone = await get('/property.html?id=nope-123');
  assert.equal(gone.status, 404);
  assert.match(await gone.text(), /<meta name="robots" content="noindex">/);
});

test('http: old URLs get a 301', async () => {
  const a = await get('/buying/');
  assert.equal(a.status, 301);
  assert.equal(a.headers.get('location'), '/properties.html?section=sales');
  const b = await get('/property-details.php?section=sales&id=' + encodeURIComponent(LIVE.id));
  assert.equal(b.headers.get('location'), '/property.html?id=' + encodeURIComponent(LIVE.id));
  assert.equal((await get('/sell')).headers.get('location'), '/sell.html');
  assert.equal((await get('/index.html')).headers.get('location'), '/');
  assert.equal((await get('/article/eviction-ban-extended-until-the-end-of-march/')).status, 301);
});

test('http: unknown pages get the branded 404 page with a base href; unknown files get plain 404', async () => {
  const r = await get('/no/such/page');
  assert.equal(r.status, 404);
  const html = await r.text();
  assert.match(html, /<base href="\/">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  const f = await get('/assets/missing.png');
  assert.equal(f.status, 404);
  assert.equal(await f.text(), 'Not found');
  assert.equal((await get('/tools/seo-check.js')).status, 404);
});

test('http: text assets are compressed and revalidate with ETag', async () => {
  const gz = await rawGet('/data/properties.json', { 'accept-encoding': 'gzip' });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(JSON.parse(zlib.gunzipSync(gz.body)).properties.length, FEED.length);
  const br = await rawGet('/styles.css', { 'accept-encoding': 'br, gzip' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(zlib.brotliDecompressSync(br.body).toString('utf8'), fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'));
  const plain = await rawGet('/styles.css', {});
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.match(plain.headers.vary, /Accept-Encoding/);
  const again = await rawGet('/styles.css', { 'if-none-match': plain.headers.etag });
  assert.equal(again.status, 304);
  const png = await rawGet('/assets/favicon.png', { 'accept-encoding': 'gzip' });
  assert.equal(png.headers['content-encoding'], undefined, 'images are not recompressed');
});
