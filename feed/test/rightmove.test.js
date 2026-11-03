'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../sync');
const rm = require('../rightmove');

const pageHtml = arr => `<html><script>window.__PAGE_MODEL = ${JSON.stringify({ data: JSON.stringify(arr) })};</script><body>}{</body></html>`;
const nextHtml = (searchResults) => `<script id="__NEXT_DATA__" type="application/json">\uFEFF${JSON.stringify({ props: { pageProps: { searchResults } } })}</script>`;
const sale = (id, over = {}) => ({
  id, bedrooms: 3, numberOfImages: 12, displayAddress: `${id} High Street, Penrith, Cumbria`, summary: 'A house.', propertySubType: 'Detached',
  propertyTypeFullDescription: '3 bedroom detached house for sale', location: { latitude: 54.664, longitude: -2.752 },
  images: [{ srcUrl: 'https://media.rightmove.co.uk:443/dir/crop/10:9-16:9/property-photo/aa/1/x_max_476x317.jpeg', url: 'property-photo/aa/1/x.jpeg' }],
  price: { displayPrices: [{ displayPrice: '£250,000', displayPriceQualifier: 'Guide Price' }] }, displayStatus: '', students: false,
  virtualTours: [], firstVisibleDate: '2026-10-29T12:00:00Z', updateDate: '2026-10-29T12:05:00Z', ...over
});
const make = (opts = {}) => rm.create(h, { gap: 0, branches: [{ id: 90147, name: 'Penrith' }], ...opts });

test('pageModel resolves the flattened page data, ignoring braces inside strings', () => {
  const arr = [{ propertyData: 1 }, { keyFeatures: 2, gone: -1, nothing: -2, note: 5 }, [3, 4], 'Feature A', 'Feature B', 'has } and { inside'];
  const m = rm.pageModel(pageHtml(arr));
  assert.deepEqual(m.propertyData.keyFeatures, ['Feature A', 'Feature B']);
  assert.equal(m.propertyData.gone, undefined);
  assert.equal(m.propertyData.nothing, null);
  assert.equal(m.propertyData.note, 'has } and { inside');
  assert.throws(() => rm.pageModel('<html></html>'), /PAGE_MODEL/);
});

test('nextData tolerates the leading BOM and rejects block pages', () => {
  assert.equal(rm.nextData(nextHtml({ resultCount: 1 })).props.pageProps.searchResults.resultCount, 1);
  assert.throws(() => rm.nextData('<html>Access denied</html>'), /NEXT_DATA/);
});

test('media URLs are restricted to Rightmove https and thumbnails use the 656px size', () => {
  assert.equal(rm.mediaUrl('property-photo/a/b.jpeg'), 'https://media.rightmove.co.uk/property-photo/a/b.jpeg');
  assert.equal(rm.mediaUrl('https://media.rightmove.co.uk:443/x/y.jpg'), 'https://media.rightmove.co.uk/x/y.jpg');
  assert.equal(rm.mediaUrl('https://evil.example/x.jpg'), '');
  assert.equal(rm.mediaUrl('https://media.rightmove.co.uk/x.jpg?a=<script>'), '');
  assert.match(rm.thumbUrl({ srcUrl: 'https://media.rightmove.co.uk:443/dir/crop/10:9-16:9/p/a_max_476x317.jpeg' }), /a_max_656x437\.jpeg$/);
});

test('statusOf maps Rightmove labels to feed statuses', () => {
  assert.equal(rm.statusOf('Sold STC'), 'sstc');
  assert.equal(rm.statusOf('Under offer'), 'sstc');
  assert.equal(rm.statusOf('Let agreed'), 'let-agreed');
  assert.equal(rm.statusOf(''), 'available');
});

test('toListing maps a sale to the feed shape', () => {
  const l = make().toListing(sale(94000001, { displayStatus: 'Sold STC' }), { channel: 'BUY', section: 'sales' }, { id: 90147 });
  assert.equal(l.id, 'rm-94000001');
  assert.equal(l.source, 'rightmove');
  assert.equal(l.section, 'sales');
  assert.equal(l.status, 'sstc');
  assert.equal(l.price, 250000);
  assert.equal(l.price_qualifier, 'Guide Price');
  assert.equal(l.beds, 3);
  assert.equal(l.type, 'detached house');
  assert.equal(l.category, 'house');
  assert.equal(l.town, 'Penrith');
  assert.equal(l.hub, 'Penrith');
  assert.equal(l.url, 'https://www.rightmove.co.uk/properties/94000001');
  assert.match(l.photo, /_max_656x437\.jpeg$/);
  assert.equal(l.rm_branch, 90147);
  assert.equal(l.has_tour, false);
});

test('toListing maps a student let with weekly prices, and tolerates missing coordinates', () => {
  const p = sale(94000002, { students: true, location: null, propertyTypeFullDescription: '5 bedroom house to rent', price: { displayPrices: [{ displayPrice: '£120 pw', displayPriceQualifier: '' }] }, displayStatus: 'Let agreed', virtualTours: [{ url: 'https://tour.giraffe360.com/' + 'a'.repeat(32) }, { url: 'https://my.giraffe360.com/3dflp/abc' }] });
  const l = make().toListing(p, { channel: 'LET', section: 'lets' }, { id: 90147 });
  assert.equal(l.section, 'lets');
  assert.equal(l.students, true);
  assert.equal(l.status, 'let-agreed');
  assert.equal(l.price_freq, 'pw');
  assert.equal(l.price_pcm, 520);
  assert.equal(l.lat, null);
  assert.equal(l.hub, '');
  assert.equal(l.has_tour, true);
});

test('toListing rejects bad ids and falls back from a generic "property" type', () => {
  assert.equal(make().toListing(sale('abc'), { channel: 'BUY', section: 'sales' }, { id: 1 }), null);
  const lodge = make().toListing(sale(94000003, { propertyTypeFullDescription: '2 bedroom property for sale', propertySubType: 'Not Specified', displayAddress: 'Lodge 3, Holiday Park, Penrith' }), { channel: 'BUY', section: 'sales' }, { id: 1 });
  assert.equal(lodge.category, 'other');
  assert.equal(lodge.type, 'lodge');
});

test('toDetail cleans the description, keeps allow-listed tours and EPCs only', () => {
  const g = 'b'.repeat(32);
  const d = make().toDetail({
    text: { description: 'Lovely home with garden.<br /><br />\rThe accommodation &amp; more.<br /><br /><b>Council tax</b> band C' },
    keyFeatures: ['Garden', '  No chain  '],
    images: [{ url: 'https://media.rightmove.co.uk/property-photo/a/1.jpeg' }, { url: 'https://evil.example/a.jpg' }],
    floorplans: [{ url: 'https://media.rightmove.co.uk/property-floorplan/a/1.jpeg' }],
    virtualTours: [{ url: 'https://my.giraffe360.com/3dflp/xyz' }, { url: `https://tour.giraffe360.com/${g}` }],
    epcGraphs: [{ url: 'https://media.rightmove.co.uk/property-epc/a/1.png' }]
  }, { id: 'rm-1', photo: '' });
  assert.equal(d.summary, 'Lovely home with garden.');
  assert.equal(d.description, 'The accommodation & more.\n\nCouncil tax band C');
  assert.deepEqual(d.highlights, ['Garden', 'No chain']);
  assert.deepEqual(d.photos, ['https://media.rightmove.co.uk/property-photo/a/1.jpeg']);
  assert.equal(d.tour, `https://tour.giraffe360.com/${g}/`);
  assert.equal(d.epc, 'https://media.rightmove.co.uk/property-epc/a/1.png');
  const none = make().toDetail({ text: {}, epcGraphs: [{ url: 'https://evil.example/e.png' }], virtualTours: [{ url: 'https://evil.example/t' }] }, { id: 'rm-2', photo: '' });
  assert.equal(none.tour, '');
  assert.equal(none.epc, '');
});

test('list() reads every page of a branch and ranks newest first', async () => {
  const second = { resultCount: 3, properties: [sale(94000013, { firstVisibleDate: '2026-10-01T00:00:00Z' })], pagination: { options: [] } };
  const first = { resultCount: 3, properties: [sale(94000011, { firstVisibleDate: '2026-10-20T00:00:00Z' }), sale(94000012, { firstVisibleDate: '2026-10-28T00:00:00Z' })], pagination: { options: [{ value: '0' }, { value: '24' }] } };
  const seen = [];
  const fetchText = async url => {
    seen.push(url);
    if (url.includes('property-to-rent')) return nextHtml({ resultCount: 0, properties: [], pagination: { options: [] } });
    return nextHtml(url.includes('index=24') ? second : first);
  };
  const { list } = await make({ fetchText }).list();
  assert.deepEqual(list.map(l => l.id), ['rm-94000012', 'rm-94000011', 'rm-94000013']);
  assert.deepEqual(list.map(l => l.rank), [0, 1, 2]);
  assert.equal(seen.length, 3);
});

test('list() keeps previous listings when Rightmove fails or returns a partial page', async () => {
  const prev = [
    { id: 'rm-1', source: 'rightmove', section: 'lets', rm_branch: 90147, address: 'x' },
    { id: 'rm-2', source: 'rightmove', section: 'sales', rm_branch: 90147, address: 'y' },
    { id: 'abc', source: 'jupix', section: 'sales', address: 'z' }
  ];
  const partial = nextHtml({ resultCount: 10, properties: [sale(94000021)], pagination: { options: [] } });
  const fetchText = async url => {
    if (url.includes('property-to-rent')) { const e = new Error('HTTP 403'); e.status = 403; throw e; }
    return partial;
  };
  const warn = console.warn; console.warn = () => {};
  let out;
  try { out = await make({ fetchText, prev }).list(); } finally { console.warn = warn; }
  assert.deepEqual(out.list.map(l => l.id).sort(), ['rm-1', 'rm-2']);
  assert.ok(out.list.every(l => l._keep));
  assert.equal(out.problems.length, 2);
});

test('mergeSources keeps the first source on duplicates and interleaves ranks', () => {
  const a = (id, rank, addr = `${id} Road, Darlington`) => ({ id, section: 'sales', address: addr, town: 'Darlington', hub: 'Darlington', rank });
  const site = { list: [a('s1', 0), a('s2', 1), a('s3', 2), a('s4', 3)] };
  const rmSrc = { list: [a('rm-1', 0, 's2 Road, Darlington'), a('rm-2', 1, '9 Other Street, Darlington')] };
  const out = h.mergeSources([site, rmSrc]);
  assert.deepEqual(out.map(l => l.id).sort(), ['rm-2', 's1', 's2', 's3', 's4']);
  const byRank = [...out].sort((x, y) => x.rank - y.rank).map(l => l.id);
  assert.ok(byRank.indexOf('rm-2') < byRank.length - 1, 'rightmove listing is not pushed to the very end');
  assert.ok(out.every(l => !('_src' in l) && !('_pos' in l)));
});

test('parseBranches reads RIGHTMOVE_BRANCHES and falls back to the defaults', () => {
  assert.deepEqual(rm.parseBranches('90144:Carlisle, 123:Cockermouth ,bad,0:x'), [{ id: 90144, name: 'Carlisle' }, { id: 123, name: 'Cockermouth' }]);
  assert.deepEqual(rm.parseBranches(''), rm.DEFAULT_BRANCHES);
  assert.match(rm.searchUrl({ id: 90144, name: 'Carlisle' }, 'BUY', 24), /BRANCH%5E90144.*includeSSTC=true.*&index=24$/);
  assert.match(rm.searchUrl({ id: 90144, name: 'Carlisle' }, 'LET'), /property-to-rent.*includeLetAgreed=true/);
});
