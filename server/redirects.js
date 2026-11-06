'use strict';
// 301 redirects from the URLs of the previous mypropertybox.co.uk site, so rankings and bookmarks carry over to this one.
// legacyRedirect() returns the new path (plus query) or null when the request is not a legacy URL.

const SALES = 'properties.html?section=sales', LETS = 'properties.html?section=lets';

const PAGES = {
  '/about': 'about.html', '/careers': 'careers.html', '/complaints': 'complaints.html', '/contact': 'contact.html',
  '/cookies-policy': 'cookies.html', '/privacy': 'privacy.html', '/terms': 'terms.html', '/payment': 'payments.html', '/payment.php': 'payments.html',
  '/selling': 'sell.html', '/buying': SALES, '/sales-properties': SALES, '/properties': 'properties.html', '/renting': LETS, '/rent-properties': LETS,
  '/property-management-landlords': 'landlords.html',
  '/hmo-specialists': 'hmo.html', '/hmo-staging': 'hmo.html',
  '/student-hmo-specialists': 'student.html', '/students': 'student.html',
  '/contact/letting-agents-darlington': 'estate-agents-darlington.html',
  '/contact/letting-agents-newcastle-upon-tyne': 'estate-agents-newcastle.html',
  '/darlington': 'estate-agents-darlington.html', '/newcastle': 'estate-agents-newcastle.html', '/carlisle': 'estate-agents-carlisle.html',
  '/penrith': 'estate-agents-penrith.html', '/cockermouth': 'estate-agents-cockermouth.html', '/middlesbrough': 'estate-agents-middlesbrough.html',
  '/bishop-auckland': 'estate-agents-bishop-auckland.html', '/newton-aycliffe': 'estate-agents-newton-aycliffe.html',
  '/southshields': 'estate-agents-south-shields.html', '/south-shields': 'estate-agents-south-shields.html',
  '/catterick': 'estate-agents-northallerton.html', '/richmond': 'estate-agents-northallerton.html',
  '/thornaby': 'estate-agents-middlesbrough.html', '/yarm': 'estate-agents-middlesbrough.html',
  '/staveley': 'estate-agents-kendal.html',
  '/news': 'index.html', '/data': 'index.html', '/404': 'index.html', '/index': 'index.html', '/index.php': 'index.html', '/index.html': 'index.html'
};

// The old news articles are not carried over; each one goes to the most relevant page instead.
function articleTarget(slug) {
  const s = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (/landlord|tenan|evict|(^|-)rent(er|al|ing)?(-|$)|buy-to-let|let-your|electrical|universal-credit|legal-update/.test(s)) return 'landlords.html';
  if (/(^|-)selling(-|$)/.test(s)) return 'sell.html';
  if (/newcastle/.test(s)) return 'estate-agents-newcastle.html';
  if (/darlington/.test(s)) return 'estate-agents-darlington.html';
  if (/buy|first-home|stamp-duty|property-market/.test(s)) return SALES;
  return 'index.html';
}

const sectionOf = v => (/let|rent/i.test(v || '') ? 'lets' : 'sales');
const dest = file => (file === 'index.html' ? '/' : '/' + file);

// ctx.ids: Set of property ids in the feed. ctx.pages: Set of page file names that exist.
function legacyRedirect(pathname, search, ctx) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { return null; }
  const key = (p.replace(/\/+$/, '') || '/').toLowerCase();
  const q = new URLSearchParams(search || '');

  if (key === '/property-details.php') {
    const id = q.get('id') || '';
    if (ctx.ids.has(id)) return '/property.html?id=' + encodeURIComponent(id);
    return '/properties.html?section=' + sectionOf(q.get('section'));
  }
  if (key === '/results-gallery.php' || key === '/results-map.php' || key === '/results.php') return '/properties.html?section=' + sectionOf(q.get('section'));

  const art = /^\/article\/(.+)$/.exec(p.replace(/\/+$/, ''));
  if (art) return dest(articleTarget(art[1]));

  if (/^\/newcastle\/[^/]+$/.test(key)) return dest('estate-agents-newcastle.html');

  if (Object.prototype.hasOwnProperty.call(PAGES, key)) return dest(PAGES[key]);

  // Plain /sell, /hmo and so on, without the .html
  const bare = /^\/([a-z0-9-]+)$/.exec(key);
  if (bare && ctx.pages.has(bare[1] + '.html') && bare[1] !== 'index') return '/' + bare[1] + '.html' + (search || '');
  return null;
}

module.exports = { legacyRedirect, articleTarget };
