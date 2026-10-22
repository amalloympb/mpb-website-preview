#!/usr/bin/env node
/*
  My Property Box - property feed sync
  ------------------------------------
  Builds the files the search page reads:
    data/properties.json   one lightweight record per listing (search + cards + map)
    data/p/<id>.json       full detail per listing (gallery, highlights, description)

  Rightmove cannot be used as a source: its datafeeds are push-only and its terms forbid scraping.
  The source of truth is the CRM (Jupix for sales, Veco for lettings, MRI for students/lettings), so every source is an
  "adapter" that returns listings in the normalised shape below. Run this on a schedule (e.g. every 15 minutes):

      node feed/sync.js                  # full sync, details cached in feed/cache.json
      node feed/sync.js --adapter=site   # (default) read the live mypropertybox.co.uk site, which already merges the CRMs

  To add a direct CRM adapter (Jupix, Veco, MRI, Reapit), add a function to ADAPTERS that returns
  { list: [Listing], detail: async (listing) => Detail } and select it with --adapter=<name>.

  Listing: { id, source ('jupix'|'veco'|'mri'), section ('sales'|'lets'), students, url, address, town, hub, locality, lat, lng,
             price, price_text, price_qualifier, price_freq, price_pcm, price_pppw, beds, type, category, status, rank,
             photo, photo_count, has_tour }
  Detail:  { id, photos[], floorplans[], highlights[], summary, description, tour, epc }
           tour = https URL of a 360 tour on an allow-listed provider (Giraffe360, Matterport, Kuula, Ricoh360) or ''.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data');
const DETAIL_DIR = path.join(OUT, 'p');
const CACHE = path.join(__dirname, 'cache.json');
const BASE = 'https://www.mypropertybox.co.uk';
const SECTIONS = ['sales', 'lets', 'students'];
const UA = 'MyPropertyBox-FeedSync/1.0 (own-site data sync)';
const DETAIL_V = 6; // bump when the Detail shape or its cleaning changes so cached details are refetched
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));

// ---------- helpers ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', eacute: 'é', egrave: 'è', agrave: 'à', acirc: 'â', ocirc: 'ô', uuml: 'ü', ouml: 'ö', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', deg: '°', middot: '·', times: '×', frac12: '½' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }
  return ENT[e.toLowerCase()] ?? m;
});
const text = html => fixMojibake(decode(html.replace(/<[^>]*>/g, ' '))).replace(/\s+/g, ' ').trim();

// Some CRM copy is UTF-8 that was re-read as Windows-1252 ("cafÃ©s", "donâ€™t"); repair those runs, leave anything else alone
const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const CONT = '[\\u0080-\\u00BF\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201E\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122]';
const MOJIBAKE = new RegExp(`[\\u00C2-\\u00DF]${CONT}|[\\u00E0-\\u00EF]${CONT}{2}|[\\u00F0-\\u00F4]${CONT}{3}`, 'g');
const fixMojibake = s => s.replace(MOJIBAKE, run => {
  const bytes = Uint8Array.from(run, ch => CP1252[ch.codePointAt(0)] ?? ch.codePointAt(0));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return run; }
});
// Agents paste markup into the description: **bold**, *emphasis*, |-separated bullets and the odd unclosed tag
const tidy = s => fixMojibake(s)
  .replace(/<\/?[a-z][^<>]*(?:>|$)/gi, ' ')
  .replace(/\*{2,}([^*]+?)\*{2,}/g, ' $1 ')
  .replace(/\*([^*\n]{1,140}?)\*/g, '$1')
  .replace(/\*{2,}/g, '')
  .replace(/\s*\|\s*/g, ' \u00b7 ');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      if (i === tries) throw new Error(`${url}: ${e.message}`);
      await sleep(400 * i);
    }
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// ---------- normalisation ----------
const POSTCODE_TAIL = /\s*\b[A-Z]{1,2}\d{1,2}[A-Z]?(?:\s*\d[A-Z]{2})?$/i;
const COUNTY = /^(?:count(?:r)?y durham|co\.? durham|durham county|north yorkshire|tyne (?:and|&) wear|cumbria|northumberland|west yorkshire|cleveland|teesside|tees valley|united kingdom|uk|england)$/i;
const STREETISH = /\b(?:road|street|avenue|lane|close|drive|view|way|terrace|crescent|place|grove|gardens|court|mews|square|row|walk|rise|park)$/i;
const TOWN_ALIASES = { 'newcastle upon tyne': 'Newcastle upon Tyne', 'newcastle upoon tyne': 'Newcastle upon Tyne', newcastle: 'Newcastle upon Tyne', 'newcastle-upon-tyne': 'Newcastle upon Tyne', 'stockton on tees': 'Stockton-on-Tees', 'stockton-on-tees': 'Stockton-on-Tees', stockton: 'Stockton-on-Tees', 'chester-le-street': 'Chester Le Street' };

// Main towns we have offices or stock around; used to tag every listing with its nearest hub from its coordinates
const HUBS = [
  ['Darlington', 54.5236, -1.5527], ['Newcastle upon Tyne', 54.9783, -1.6178], ['Middlesbrough', 54.5742, -1.2350],
  ['Stockton-on-Tees', 54.5704, -1.3181], ['Hartlepool', 54.6892, -1.2126], ['Durham', 54.7761, -1.5733],
  ['Sunderland', 54.9069, -1.3838], ['Gateshead', 54.9526, -1.6014], ['South Shields', 54.9986, -1.4323],
  ['Northallerton', 54.3386, -1.4349], ['Newton Aycliffe', 54.6186, -1.5692], ['Bishop Auckland', 54.6567, -1.6787],
  ['Carlisle', 54.8925, -2.9329], ['Penrith', 54.6641, -2.7527], ['Kendal', 54.3280, -2.7459], ['Cockermouth', 54.6628, -3.3623]
];
const km = (aLat, aLng, bLat, bLng) => {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const nearestHub = (lat, lng) => {
  if (lat == null) return '';
  const best = HUBS.map(([n, a, b]) => [n, km(lat, lng, a, b)]).sort((x, y) => x[1] - y[1])[0];
  return best[1] <= 15 ? best[0] : '';
};

function parseAddress(raw) {
  const parts = raw.split(',').map(s => s.replace(/\s+/g, ' ').replace(/\.+$/, '').trim()).filter(Boolean);
  const places = parts.map(p => p.replace(POSTCODE_TAIL, '').trim()).filter(p => p && !COUNTY.test(p));
  const cand = places.length > 1 && !STREETISH.test(places[places.length - 1]) ? places[places.length - 1] : '';
  return {
    address: parts.join(', '),
    town: TOWN_ALIASES[cand.toLowerCase()] || cand,
    locality: raw.toLowerCase().replace(/\s+/g, ' ')
  };
}

function parsePrice(raw, section) {
  const t = text(raw);
  const num = t.match(/£\s*([\d,]+(?:\.\d+)?)/);
  const price = num ? Math.round(parseFloat(num[1].replace(/,/g, ''))) : null;
  const qualifier = num ? t.slice(0, t.indexOf('£')).trim() : t;
  const f = t.match(/\(?\b(pcm|pppw|pw|pa)\b\)?/i);
  // Some CRM feeds leave the frequency blank ("£135 ()"); a whole-property rent under £300 can only be weekly.
  const fallback = section === 'students' ? 'pppw' : section === 'lets' ? (price != null && price < 300 ? 'pppw' : 'pcm') : null;
  const freq = f ? f[1].toLowerCase() : fallback;
  const sale = section === 'sales';
  const wk = freq === 'pppw' || freq === 'pw';
  return {
    price, price_text: t, price_qualifier: price == null ? '' : qualifier, price_freq: sale ? null : freq,
    price_pcm: sale || price == null ? null : Math.round(wk ? price * 52 / 12 : price),
    price_pppw: sale || price == null ? null : Math.round(wk ? price : price * 12 / 52)
  };
}

const categoryOf = s => {
  const lc = s.toLowerCase();
  if (/\b(flat|apartment|maisonette|studio|penthouse)\b/.test(lc)) return 'flat';
  if (/\bbungalow\b/.test(lc)) return 'bungalow';
  if (/shared|hmo|\brooms?\b|student/.test(lc)) return 'room';
  if (/\b(house|cottage|terrace[d]?|detached|semi|villa|townhouse|town house|mews|farmhouse|barn|lodge|link)\b/.test(lc)) return 'house';
  if (/\b(land|plot)\b/.test(lc)) return 'land';
  if (/commercial|\b(shop|office|retail|industrial|warehouse|premises)\b/.test(lc)) return 'commercial';
  return '';
};

function parseType(raw) {
  const t = text(raw);
  const m = t.match(/^(\d+)\s*bed(?:room)?s?\b\s*(.*)$/i);
  const studio = /^studio\b/i.test(t);
  const type = m ? m[2].trim() : studio ? t.replace(/^studio\s*/i, '').trim() || 'Studio' : t;
  const beds = m ? +m[1] : studio ? 0 : null;
  return { beds, type, category: categoryOf(type || (studio ? 'studio' : '')) };
}

// Some CRM feeds (Veco) carry no property type: infer it from the address and the marketing copy
const CATEGORY_LABEL = { flat: 'Flat', house: 'House', bungalow: 'Bungalow', room: 'Room', land: 'Land', commercial: 'Commercial' };
function inferType(l, d) {
  if (l.category) return l;
  const cat = categoryOf([l.address, d && d.summary, d && d.highlights.join(' '), d && d.description.slice(0, 600)].filter(Boolean).join(' '));
  return { ...l, category: cat || 'other', type: l.type || CATEGORY_LABEL[cat] || '' };
}

const sourceOf = url => /jupix/i.test(url) ? 'jupix' : /veco/i.test(url) ? 'veco' : /salesandlettings|mri/i.test(url) ? 'mri' : 'other';
const safeId = id => /^[\w-]{3,64}$/.test(id);
const httpsOnly = u => /^https:\/\//i.test(u) ? u : '';

// ---------- adapter: live site ----------
function parseCards(html, section) {
  return html.split('<div class="col-xl-3').slice(1).map(chunk => {
    const href = chunk.match(/property-details\.php\?([^"]+)"/);
    if (!href) return null;
    const id = new URLSearchParams(decode(href[1])).get('id');
    if (!id || !safeId(id)) return null;
    const img = chunk.match(/<img src="(https:[^"]+)" alt="photo of property"/);
    const badge = chunk.match(/\/images\/([a-z-]+)-badge\.png/);
    const addr = chunk.match(/<h3 class="address">([\s\S]*?)<\/h3>/);
    const bed = chunk.match(/<p class="bedrooms">([\s\S]*?)<\/p>/);
    const price = chunk.match(/<p class="price">([\s\S]*?)<\/p>/);
    if (!addr) return null;
    return { id, section, badge: badge ? badge[1] : '', photo: img ? httpsOnly(img[1]) : '', addr: text(addr[1]), bed: bed ? bed[1] : '', price: price ? price[1] : '' };
  }).filter(Boolean);
}

async function siteSection(section) {
  const first = await get(`${BASE}/results-gallery.php?section=${section}&ddm_order=2&page=1`);
  const total = +(first.match(/<p>\s*(\d+)\s+properties found/) || [])[1] || 0;
  const pages = Math.max(1, ...[...first.matchAll(/[?&;]page=(\d+)/g)].map(m => +m[1]));
  const rest = await pool(Array.from({ length: pages - 1 }, (_, i) => i + 2), 4, p => get(`${BASE}/results-gallery.php?section=${section}&ddm_order=2&page=${p}`));
  const cards = [first, ...rest].flatMap(h => parseCards(h, section));
  const seen = new Set();
  const unique = cards.filter(c => !seen.has(c.id) && seen.add(c.id));
  if (total && unique.length < total * 0.9) throw new Error(`${section}: parsed ${unique.length} of ${total} listings, refusing to publish a partial feed`);

  const mapHtml = await get(`${BASE}/results-map.php?section=${section}&ddm_order=2`);
  const coords = new Map();
  mapHtml.split('google.maps.LatLng(').slice(1).forEach(chunk => {
    const m = chunk.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\)/);
    const id = (chunk.match(/property-details\.php\?[^'"]*?[?&;]id=([\w-]+)/) || [])[1];
    if (m && id && !coords.has(id)) coords.set(id, [+m[1], +m[2]]);
  });
  return unique.map((c, rank) => {
    const a = parseAddress(c.addr);
    const [lat, lng] = coords.get(c.id) || [null, null];
    const hub = nearestHub(lat, lng);
    const status = c.badge === 'sstc' ? 'sstc' : c.badge === 'let-agreed' ? 'let-agreed' : c.badge === 'sold' ? 'sold' : c.badge === 'let' ? 'let' : 'available';
    return { id: c.id, source: sourceOf(c.photo), section, url: `${BASE}/property-details.php?section=${section}&id=${encodeURIComponent(c.id)}`, ...a, town: a.town || hub, hub, lat, lng, ...parsePrice(c.price, section), ...parseType(c.bed), status, rank, photo: c.photo, photo_count: c.photo ? 1 : 0 };
  });
}

// The student properties are the same CRM records as some lettings: keep one listing and flag it
function mergeStudents(list) {
  const byId = new Map();
  for (const l of list) {
    const prev = byId.get(l.id);
    if (!prev) byId.set(l.id, l);
    else if (l.section === 'students') prev.students = true;
    else { l.students = true; byId.set(l.id, l); }
  }
  return [...byId.values()].map(l => (l.section === 'students' ? { ...l, students: true } : l));
}

const UNICODE_NOISE = /[\u0900-\u097F]+/g; // stray Devanagari characters in some CRM copy

// Only these providers are embedded as a 360 tour / linked as an EPC; anything else in the CRM data is dropped.
const TOUR_HOSTS = /^(?:tour\.giraffe360\.com|my\.matterport\.com|kuula\.co|view\.ricoh360\.com)$/;
const EPC_HOSTS = /^(?:find-energy-certificate\.service\.gov\.uk|epc\.jupix\.co\.uk|media2\.jupix\.co\.uk)$/;

// CRM links are hand-typed, so tolerate "www.https://...", "http://", stray whitespace and a swapped Tour/EPC label
function cleanLink(raw) {
  const s = decode(raw).trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?=https?:?\/*)/i, '').replace(/^(https?):?\/*/i, '').replace(/^www\./i, '');
  try {
    const u = new URL('https://' + s);
    u.hash = '';
    return u.protocol === 'https:' && !u.username ? u : null;
  } catch (e) { return null; }
}
function extractLinks(html) {
  let tour = '', epc = '';
  for (const m of html.matchAll(/<a\b[^>]*class="[^"]*\bbutton\b[^"]*"[^>]*>/gi)) {
    const h = (m[0].match(/href="([^"]*)"/i) || [])[1];
    const u = h && cleanLink(h);
    if (!u) continue;
    if (!tour && TOUR_HOSTS.test(u.hostname)) tour = canonTour(u, h);
    else if (!epc && EPC_HOSTS.test(u.hostname)) epc = u.href;
  }
  return { tour, epc };
}
// Giraffe tour ids are 32 hex chars; CRM users sometimes paste a leading space or the whole URL twice
function canonTour(u, raw) {
  if (u.hostname !== 'tour.giraffe360.com') return u.href;
  const id = decode(raw).split('giraffe360.com/').pop().match(/[0-9a-f]{32}/i);
  return id ? `https://tour.giraffe360.com/${id[0].toLowerCase()}/` : '';
}

function parseDetail(html, l) {
  const slider = (html.match(/<div class="lazy slider">([\s\S]*?)<div class="thumbs slider">/) || [])[1] || '';
  const photos = [...new Set([...slider.matchAll(/<img src="(https:[^"]+)"/g)].map(m => httpsOnly(m[1])).filter(Boolean))];
  const floorplans = [...new Set([...html.matchAll(/<a [^>]*href="(https:[^"]+)"[^>]*class="[^"]*floorplans[^"]*"/g)].map(m => httpsOnly(m[1])).filter(Boolean))];
  const hl = (html.match(/<div id="details"[\s\S]*?<ul>([\s\S]*?)<\/ul>/) || [])[1] || '';
  const highlights = [...hl.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => text(m[1])).filter(Boolean);
  const descHtml = (html.match(/id="propertyDescription"([\s\S]*?)id="propertymapContainer"/) || [])[1] || '';
  const clean = s => tidy(s).replace(UNICODE_NOISE, '').replace(/\s{2,}/g, ' ').trim();
  // Agents shout headlines and disclaimers as *CAPS* / **CAPS**; give each its own paragraph
  const CAPS = /\*{1,3}([A-Z0-9][A-Z0-9 ,.'&\u00a3\/()\-:!?]{5,160}?)\*{1,3}/g;
  // ...and paste the key-features list on the end as "a|b|c" (Veco); it duplicates the highlights, so cut it
  const hlLow = highlights.map(h => h.toLowerCase());
  const dropBullets = p => {
    if ((p.match(/\|/g) || []).length < 2) return p;
    const segs = p.split('|').map(s => s.trim());
    const hit = s => hlLow.find(h => h && s.toLowerCase().endsWith(h));
    const f = segs.findIndex(hit);
    if (f < 0 || segs.filter(hit).length < 2) return p;
    const lead = segs[f].slice(0, segs[f].length - hit(segs[f]).length);
    const rest = segs.slice(f + 1).filter(s => !hit(s) && s.length > 80);
    return [...segs.slice(0, f), lead, ...rest].map(s => s.trim()).filter(Boolean).join(' ');
  };
  const summaryRaw = clean(text((descHtml.match(/<p class="bold">([\s\S]*?)<\/p>/) || [])[1] || ''));
  const body = descHtml.replace(/^[\s\S]*?<\/h2>/, '').replace(/<p class="bold">[\s\S]*?<\/p>/, '');
  const paras = body.split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>|<br\s*\/?>(?=\s*<strong>)/i)
    .map(p => decode(p.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' '))
    .flatMap(p => dropBullets(p).split(CAPS))
    .map(clean)
    .filter(p => p.length > 1);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const summary = summaryRaw && norm(paras.join(' ')).includes(norm(summaryRaw).slice(0, 80)) ? '' : summaryRaw;
  const dedup = paras.filter((p, i) => paras.indexOf(p) === i && p !== summary);
  const { tour, epc } = extractLinks(html);
  return { id: l.id, photos: photos.length ? photos : l.photo ? [l.photo] : [], floorplans, highlights, summary, description: dedup.join('\n\n'), tour, epc };
}

const ADAPTERS = {
  async site() {
    const lists = [];
    for (const s of SECTIONS) lists.push(await siteSection(s));
    const list = mergeStudents(lists.flat());
    const detail = async l => parseDetail(await get(l.url), l);
    return { list, detail };
  }
};

// ---------- main ----------
(async () => {
  const name = args.adapter || 'site';
  if (!ADAPTERS[name]) throw new Error(`Unknown adapter "${name}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  const started = Date.now();
  const { list, detail } = await ADAPTERS[name]();
  console.log(`Listings: ${list.length} (${SECTIONS.map(s => s + ' ' + list.filter(l => l.section === s).length).join(', ')})`);

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) {}
  const sig = l => [DETAIL_V, l.price_text, l.status, l.photo, l.address, l.type].join('|');
  const todo = list.filter(l => !cache[l.id] || cache[l.id].sig !== sig(l));
  console.log(`Fetching ${todo.length} detail pages (${list.length - todo.length} unchanged, cached)`);

  let failed = 0;
  await pool(todo, 5, async l => {
    try { cache[l.id] = { sig: sig(l), detail: await detail(l) }; }
    catch (e) { failed++; console.warn('  detail failed:', l.id, e.message); }
  });

  fs.mkdirSync(DETAIL_DIR, { recursive: true });
  const live = new Set(list.map(l => l.id));
  for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
  for (const f of fs.readdirSync(DETAIL_DIR)) if (!live.has(f.replace(/\.json$/, ''))) fs.unlinkSync(path.join(DETAIL_DIR, f));

  const out = list.map(l => {
    const d = cache[l.id] && cache[l.id].detail;
    const full = inferType(l, d);
    if (d) {
      fs.writeFileSync(path.join(DETAIL_DIR, l.id + '.json'), JSON.stringify(d));
      return { ...full, photo_count: d.photos.length || l.photo_count, has_tour: !!d.tour };
    }
    return full;
  });

  const tmp = path.join(OUT, 'properties.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify({ generated: new Date().toISOString(), adapter: name, count: out.length, properties: out }));
  fs.renameSync(tmp, path.join(OUT, 'properties.json'));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`Wrote data/properties.json (${out.length}) in ${((Date.now() - started) / 1000).toFixed(1)}s${failed ? `, ${failed} detail pages failed (will retry next run)` : ''}`);
})().catch(e => { console.error('SYNC FAILED:', e.message); process.exit(1); });
