'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../sync');

const OLD_PAGE = `<p>1 properties found</p><a href="results-gallery.php?section=sales&page=1">1</a>
  <div class="col-xl-3 col-lg-4"><a href="property-details.php?section=sales&amp;id=abc123"><img src="https://media2.jupix.co.uk/x.jpg" alt="photo of property"></a>
  <h3 class="address">1 Park Road, Darlington</h3><p class="bedrooms">3 bedroom house</p><p class="price">&pound;150,000</p></div>`;

async function withFetch(pages, fn) {
  const real = global.fetch, seen = [];
  global.fetch = async url => { seen.push(String(url)); const body = pages(String(url)); return { ok: true, status: 200, text: async () => body }; };
  try { return await fn(seen); } finally { global.fetch = real; }
}
async function withEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FEED_SOURCE_URL'), old = process.env.FEED_SOURCE_URL;
  if (value === undefined) delete process.env.FEED_SOURCE_URL; else process.env.FEED_SOURCE_URL = value;
  try { return await fn(); } finally { if (had) process.env.FEED_SOURCE_URL = old; else delete process.env.FEED_SOURCE_URL; }
}

test('the listings source defaults to the public site and can be pointed elsewhere', () => {
  assert.equal(sync.sourceBase(''), 'https://www.mypropertybox.co.uk');
  assert.equal(sync.sourceBase(undefined), 'https://www.mypropertybox.co.uk');
  assert.equal(sync.sourceBase(' https://old.mypropertybox.co.uk/ '), 'https://old.mypropertybox.co.uk');
  assert.throws(() => sync.sourceBase('old.mypropertybox.co.uk'), /FEED_SOURCE_URL/);
  assert.throws(() => sync.sourceBase('ftp://old.example'), /FEED_SOURCE_URL/);
});

test('a source that is not the old site is refused instead of publishing an empty feed', async () => {
  assert.doesNotThrow(() => sync.assertOldSitePage(OLD_PAGE, 'https://x'));
  assert.throws(() => sync.assertOldSitePage('<html><title>Properties | My Property Box</title></html>', 'https://x'), /FEED_SOURCE_URL/);
  await withEnv('https://old.example.test', () => withFetch(() => '<html>the new site</html>', async () => {
    await assert.rejects(sync.ADAPTERS.site(), /FEED_SOURCE_URL/);
  }));
});

test('listings are read from the configured source but keep public links', async () => {
  const EMPTY = '<p>0 properties found</p><a href="results-gallery.php?section=lets&page=1">1</a>';
  const pages = url => (/results-gallery/.test(url) ? (/section=sales/.test(url) ? OLD_PAGE : EMPTY) : /results-map/.test(url) ? '' : '<div id="details"><ul><li>Garden</li></ul></div>');
  await withEnv('https://old.example.test', () => withFetch(pages, async seen => {
    const { list, detail } = await sync.ADAPTERS.site();
    assert.ok(seen.length && seen.every(u => u.startsWith('https://old.example.test/')), seen.join('\n'));
    assert.equal(list.length, 1);
    assert.equal(list[0].url, 'https://www.mypropertybox.co.uk/property-details.php?section=sales&id=abc123');
    seen.length = 0;
    await detail(list[0]);
    assert.deepEqual(seen, ['https://old.example.test/property-details.php?section=sales&id=abc123']);
  }));
});
