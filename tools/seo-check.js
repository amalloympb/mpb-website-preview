#!/usr/bin/env node
'use strict';
// SEO and link audit for the static pages. `node tools/seo-check.js` prints problems and exits 1 if there are any.
// The same checks run in server/test/seo.test.js so a regression fails the build.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = (process.env.SITE_URL || 'https://www.mypropertybox.co.uk').replace(/\/+$/, '');

const decode = s => String(s || '')
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|deg|pound|middot|ndash|mdash);/g, (m, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '\u00b0', pound: '\u00a3', middot: '\u00b7', ndash: '\u2013', mdash: '\u2014' }[n]));
const text = s => decode(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? decode(m[2] !== undefined ? m[2] : m[3]) : null; };
const metaContent = (html, key, val) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if (attr(m[0], key) === val) return attr(m[0], 'content');
  return null;
};

// Pages whose title/description are filled in per listing, so they are not compared with the others
const DYNAMIC = new Set(['property.html']);
const LIMITS = { titleMin: 20, titleMax: 70, descMin: 70, descMax: 165 };

const expectedCanonical = file => SITE + '/' + (file === 'index.html' ? '' : file);

function pageList(root = ROOT) {
  return fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== '404.html').sort();
}

function audit(root = ROOT) {
  const problems = [];
  const warnings = [];
  const add = (list, file, msg) => list.push(`${file}: ${msg}`);
  const nf = path.join(root, '404.html');
  if (!fs.existsSync(nf)) add(problems, '404.html', 'missing (the server shows it for unknown pages)');
  else if (!/<meta name="robots" content="noindex"/i.test(fs.readFileSync(nf, 'utf8'))) add(problems, '404.html', 'must be noindex');
  const files = pageList(root);
  const titles = new Map(), descs = new Map();
  const inbound = new Map(files.map(f => [f, 0]));

  for (const file of files) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const body = html.slice(html.indexOf('</head>'));
    const P = m => add(problems, file, m), W = m => add(warnings, file, m);

    if (!/<html[^>]*\blang="en-GB"/i.test(html)) P('missing lang="en-GB"');
    if (/noindex/i.test(head)) P('source contains noindex (the host adds it for previews)');

    const title = text((/<title>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || '');
    if (!title) P('missing <title>');
    else {
      if (!DYNAMIC.has(file)) {
        if (title.length < LIMITS.titleMin || title.length > LIMITS.titleMax) P(`title is ${title.length} characters (want ${LIMITS.titleMin}-${LIMITS.titleMax}): "${title}"`);
        if (titles.has(title)) P(`title duplicates ${titles.get(title)}`); else titles.set(title, file);
      }
    }
    const desc = metaContent(head, 'name', 'description');
    if (!desc) P('missing meta description');
    else if (!DYNAMIC.has(file)) {
      if (desc.length < LIMITS.descMin || desc.length > LIMITS.descMax) P(`description is ${desc.length} characters (want ${LIMITS.descMin}-${LIMITS.descMax})`);
      if (descs.has(desc)) P(`description duplicates ${descs.get(desc)}`); else descs.set(desc, file);
    }

    const canon = (/<link\b[^>]*rel="canonical"[^>]*>/i.exec(head) || [])[0];
    const canonHref = canon ? attr(canon, 'href') : null;
    if (!canonHref) P('missing canonical');
    else if (canonHref !== expectedCanonical(file)) P(`canonical is "${canonHref}", expected "${expectedCanonical(file)}"`);

    const og = k => metaContent(head, 'property', k);
    if (file !== 'property.html') {
      if (!og('og:title')) P('missing og:title');
      if (!og('og:description')) P('missing og:description');
      if (og('og:url') !== expectedCanonical(file)) P(`og:url is "${og('og:url')}", expected "${expectedCanonical(file)}"`);
      if (!/^https:\/\//.test(og('og:image') || '')) P('og:image must be an absolute https URL');
      if (!metaContent(head, 'name', 'twitter:card')) P('missing twitter:card');
    }
    if (/location\.origin/.test(head)) P('a script rewrites canonical from location.origin (it must stay fixed to the live domain)');

    for (const m of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { const o = JSON.parse(m[1]); if (!o['@context']) P('JSON-LD without @context'); } catch (e) { P('JSON-LD does not parse: ' + e.message); }
    }

    const h1 = (body.match(/<h1\b/gi) || []).length;
    if (h1 !== 1) P(`has ${h1} <h1> elements (want 1)`);

    let imgs = 0, noAlt = 0, noSize = 0;
    for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
      imgs++;
      if (attr(m[0], 'alt') === null) noAlt++;
      if (!attr(m[0], 'width') || !attr(m[0], 'height')) noSize++;
    }
    if (noAlt) P(`${noAlt} of ${imgs} <img> have no alt attribute`);
    if (noSize) W(`${noSize} of ${imgs} <img> have no width/height (layout shift)`);

    if (/https?:\/\/(www\.)?mypropertybox\.co\.uk\/(images|results-gallery\.php|property-details\.php)/i.test(html)) {
      P('links to or loads assets from the old site (they disappear when this site replaces it)');
    }
    if (/https?:\/\/(www\.)?mypropertybox\.co\.uk\/payment\.php/i.test(html)) {
      W('card payment form still points at www.mypropertybox.co.uk/payment.php; set PAYMENT_URL to wherever the form lives before cut-over');
    }

    for (const m of html.matchAll(/\b(?:href|src)\s*=\s*"([^"]+)"/gi)) {
      const ref = decode(m[1]);
      if (!ref || /^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) || ref.includes('${')) continue;
      const clean = ref.split('#')[0].split('?')[0];
      if (!clean) continue;
      const target = path.join(root, clean);
      if (!fs.existsSync(target)) { P(`broken link or asset: ${ref}`); continue; }
      if (inbound.has(clean) && clean !== file) inbound.set(clean, inbound.get(clean) + 1);
    }
  }
  for (const [f, n] of inbound) if (n === 0 && f !== 'index.html' && f !== 'property.html') add(warnings, f, 'no other page links here (orphan)');
  return { problems, warnings, pages: files.length };
}

module.exports = { audit, pageList, expectedCanonical, SITE, LIMITS, decode, text, attr, metaContent };

if (require.main === module) {
  const { problems, warnings, pages } = audit();
  const show = (label, list) => { if (list.length) { console.log(`\n${label} (${list.length})`); list.forEach(l => console.log('  ' + l)); } };
  show('PROBLEMS', problems);
  show('WARNINGS', warnings);
  console.log(`\n${pages} pages checked: ${problems.length} problems, ${warnings.length} warnings`);
  process.exit(problems.length ? 1 : 0);
}
