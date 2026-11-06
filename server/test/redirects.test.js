'use strict';
// Every URL of the old mypropertybox.co.uk site must 301 to a page that exists on this one. Run: node --test server/test
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyRedirect, articleTarget } = require('../redirects');
const { pageFiles } = require('../seo');

const ROOT = path.join(__dirname, '..', '..');
const FEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'properties.json'), 'utf8')).properties;
const IDS = new Map(FEED.map(p => [String(p.id), p]));
const PAGES = new Set(pageFiles(ROOT));
const ctx = { ids: IDS, pages: PAGES };
const OLD = fs.readFileSync(path.join(__dirname, 'fixtures', 'old-urls.txt'), 'utf8').split(/\r?\n/).filter(Boolean);

const existing = to => {
  const file = to.split('?')[0] === '/' ? 'index.html' : to.split('?')[0].slice(1);
  return fs.existsSync(path.join(ROOT, file));
};

test('old pages and news articles all redirect to pages that exist', () => {
  assert.ok(OLD.length > 80);
  for (const p of OLD) {
    const to = legacyRedirect(p, '', ctx);
    assert.ok(to, `${p} has no redirect`);
    assert.ok(existing(to), `${p} -> ${to} does not exist`);
  }
});

test('property-details.php goes to the matching property, or to search when the id is gone', () => {
  for (const p of FEED.slice(0, 50)) {
    assert.equal(legacyRedirect('/property-details.php', `?id=${p.id}`, ctx), '/property.html?id=' + encodeURIComponent(p.id));
  }
  assert.equal(legacyRedirect('/property-details.php', '?section=lets&id=gone', ctx), '/properties.html?section=lets');
  assert.equal(legacyRedirect('/property-details.php', '?id=gone', ctx), '/properties.html?section=sales');
});

test('old search pages keep the sales/lets section', () => {
  assert.equal(legacyRedirect('/results-gallery.php', '?section=lettings&page=3', ctx), '/properties.html?section=lets');
  assert.equal(legacyRedirect('/results-gallery.php', '?section=sales', ctx), '/properties.html?section=sales');
  assert.equal(legacyRedirect('/buying/', '', ctx), '/properties.html?section=sales');
  assert.equal(legacyRedirect('/renting', '', ctx), '/properties.html?section=lets');
});

test('articles go to the most relevant page', () => {
  assert.equal(articleTarget('eviction-ban-extended-until-the-end-of-march'), 'landlords.html');
  assert.equal(articleTarget('reasons-to-invest-in-newcastle'), 'estate-agents-newcastle.html');
  assert.equal(articleTarget('the-darlington-monopoly-board'), 'estate-agents-darlington.html');
  assert.equal(articleTarget('Selling Your Home Ten Practical Ways to Attract Families'), 'sell.html');
  assert.equal(articleTarget('complete-guide-to-buying-a-house'), 'properties.html?section=sales');
});

test('bare page names get their .html, and current URLs are left alone', () => {
  assert.equal(legacyRedirect('/sell', '', ctx), '/sell.html');
  assert.equal(legacyRedirect('/hmo', '', ctx), '/hmo.html');
  assert.equal(legacyRedirect('/index.html', '', ctx), '/');
  for (const p of ['/', '/sell.html', '/properties.html', '/property.html', '/assets/logo-mpb.png', '/data/properties.json', '/robots.txt', '/api/health', '/nope']) {
    assert.equal(legacyRedirect(p, '', ctx), null, p);
  }
});

test('malformed paths do not throw', () => {
  assert.equal(legacyRedirect('/%E0%A4%A', '', ctx), null);
});
