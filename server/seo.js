'use strict';
// SEO layer: the indexing switch, robots.txt, sitemap.xml, canonical host and the per-property <head> tags for property.html.
// Everything here is a pure function of its inputs (and the environment), so it is tested directly in test/seo.test.js.
const fs = require('fs');
const path = require('path');

const site = () => (process.env.SITE_URL || 'https://www.mypropertybox.co.uk').replace(/\/+$/, '');
// Search engines are kept out unless this is switched on, so a test or staging host can never be indexed by accident.
const indexingAllowed = () => /^(1|true|yes)$/i.test(process.env.ALLOW_INDEXING || '');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = n => '\u00a3' + Math.round(n).toLocaleString('en-GB');

// ---- Sitemap and robots ----
const NOT_PAGES = new Set(['property.html', '404.html']);
const LISTED = new Set(['available', 'sstc', 'let-agreed']);

const pageFiles = root => fs.readdirSync(root).filter(f => f.endsWith('.html') && !NOT_PAGES.has(f)).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
const pageUrl = (file, base = site()) => (file === 'index.html' ? base + '/' : `${base}/${file}`);
const propertyUrl = (p, base = site()) => `${base}/property.html?id=${encodeURIComponent(p.id)}`;

function sitemapXml({ files, properties, base = site() }) {
  const urls = [...files.map(f => pageUrl(f, base)), ...properties.filter(p => LISTED.has(p.status)).map(p => propertyUrl(p, base))].slice(0, 50000);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

function robotsTxt({ allow, base = site() }) {
  if (!allow) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
}

// ---- Canonical host ----
// Once the site is live, every other hostname (the apex domain, the *.azurewebsites.net name) is sent to the canonical one,
// so search engines only ever see a single copy of each page.
function canonicalRedirect(host, target, base = site()) {
  if (!host) return null;
  const want = new URL(base);
  const have = String(host).split(',')[0].trim().toLowerCase();
  const name = have.replace(/:\d+$/, '');
  if (name === want.host.toLowerCase() || name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || /^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return null;
  return base + target;
}

// ---- Property pages ----
const bedsText = p => (p.beds == null ? '' : p.beds === 0 ? 'Studio' : p.beds + (p.beds === 1 ? ' bedroom' : ' bedrooms'));
const priceText = p => {
  if (p.section === 'sales') return [p.price_qualifier || '', p.price ? money(p.price) : 'POA'].filter(Boolean).join(' ');
  const f = p.price_freq;
  if (f === 'pppw') return `${money(p.price_pppw ?? p.price)} pppw`;
  if (f === 'pw') return `${money(p.price)} pw`;
  return `${money(p.price_pcm ?? p.price)} pcm`;
};
const isOff = p => p.status === 'sold' || p.status === 'let';
const https = u => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');

function propertyMeta(p, d = {}, base = site()) {
  const url = propertyUrl(p, base), sale = p.section === 'sales', where = p.hub || p.town;
  const lead = String(d.summary || String(d.description || '').split('\n\n')[0] || '').replace(/\s+/g, ' ').trim();
  const description = lead
    ? (lead.length > 157 ? lead.slice(0, 157).replace(/\s+\S*$/, '') + '\u2026' : lead)
    : `${[bedsText(p), p.type || 'property'].filter(Boolean).join(' ')} ${sale ? 'for sale' : 'to let'}${where ? ' in ' + where : ''}. View photos and book a viewing.`;
  const title = `${p.address} | ${sale ? 'For sale' : 'To let'} ${priceText(p)} | My Property Box`;
  const photos = [...(Array.isArray(d.photos) ? d.photos : []), p.photo].map(https).filter(Boolean);
  const off = isOff(p);
  const ld = {
    '@context': 'https://schema.org', '@type': 'RealEstateListing', name: p.address, url, description,
    ...(photos.length ? { image: photos.slice(0, 6) } : {}),
    offers: {
      '@type': 'Offer', priceCurrency: 'GBP', availability: off ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      ...(sale ? (p.price ? { price: p.price } : {}) : { priceSpecification: { '@type': 'UnitPriceSpecification', price: p.price_pcm ?? p.price, priceCurrency: 'GBP', unitCode: 'MON' } })
    },
    about: {
      '@type': 'Residence', ...(p.beds != null ? { numberOfBedrooms: p.beds } : {}),
      address: { '@type': 'PostalAddress', streetAddress: p.address, addressLocality: p.town, addressCountry: 'GB' },
      ...(typeof p.lat === 'number' && typeof p.lng === 'number' ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {})
    }
  };
  return { title, description, canonical: url, image: photos[0] || '', robots: off ? 'noindex,follow' : '', ld };
}

// Rewrites the generic <head> of property.html for one listing. `m` is propertyMeta() output, or { missing: true } for an unknown id.
function injectProperty(html, m) {
  const rep = (re, to) => { html = html.replace(re, () => to); };
  let extra = '';
  if (m.missing) extra = '<meta name="robots" content="noindex">';
  else {
    rep(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`);
    rep(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(m.description)}">`);
    rep(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(m.canonical)}">`);
    rep(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(m.title)}">`);
    rep(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(m.description)}">`);
    rep(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(m.canonical)}">`);
    if (m.image) {
      rep(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(m.image)}">`);
      extra += `<meta name="twitter:image" content="${esc(m.image)}">\n`;
    }
    if (m.robots) extra += `<meta name="robots" content="${m.robots}">\n`;
    extra += `<script type="application/ld+json" id="ld-property">${JSON.stringify(m.ld).replace(/</g, '\\u003c')}</script>`;
  }
  return html.replace('</head>', () => `${extra}\n</head>`);
}

// The 404 page is served from arbitrary paths, so its relative links need a base.
const withBase = html => html.replace('<head>', () => '<head>\n<base href="/">');

module.exports = { site, indexingAllowed, pageFiles, pageUrl, propertyUrl, sitemapXml, robotsTxt, canonicalRedirect, propertyMeta, injectProperty, withBase, LISTED, NOT_PAGES };
