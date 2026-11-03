/*
  Rightmove adapter for feed/sync.js
  ----------------------------------
  Reads the PUBLIC Rightmove pages of My Property Box's own branches (Carlisle and Penrith by default) so that listings
  from offices that are not yet in the CRM-backed site feed still appear in the new search.

  Rightmove offers no read API for agents (its datafeeds are push-only) and its terms restrict automated collection, so
  this adapter is deliberately small and polite:
    - only our own branches, ~2 search pages per branch per run, plus one detail page per NEW or CHANGED listing
    - requests are spaced >= 800 ms apart, with an identifying User-Agent
    - it never throws: a failed branch keeps its previous listings, so a Rightmove outage or markup change cannot empty the site
  Replace it with the CRM feed (Reapit / Jupix) as soon as that is available, then run `node feed/sync.js --adapter=site`.

  Branches: edit DEFAULT_BRANCHES, or set RIGHTMOVE_BRANCHES="90144:Carlisle,90147:Penrith,<id>:<name>"
  (the id is the number at the end of the branch's Rightmove URL).
*/
'use strict';

const HOST = 'https://www.rightmove.co.uk';
const DEFAULT_BRANCHES = [{ id: 90144, name: 'Carlisle' }, { id: 90147, name: 'Penrith' }];
const GAP_MS = 800;
const CHANNELS = [{ channel: 'BUY', section: 'sales' }, { channel: 'LET', section: 'lets' }];

function parseBranches(env) {
  const list = String(env || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [id, ...name] = s.split(':');
    return { id: Number(id), name: name.join(':').trim() || 'Branch' };
  }).filter(b => Number.isInteger(b.id) && b.id > 0);
  return list.length ? list : DEFAULT_BRANCHES;
}

const searchUrl = (b, channel, index) => {
  const name = encodeURIComponent(b.name);
  const loc = `locationIdentifier=BRANCH%5E${b.id}`;
  const base = channel === 'BUY'
    ? `${HOST}/property-for-sale/find/My-Property-Box/${name}.html?${loc}&includeSSTC=true&_includeSSTC=on`
    : `${HOST}/property-to-rent/find/My-Property-Box/${name}.html?${loc}&propertyStatus=all&includeLetAgreed=true&_includeLetAgreed=on`;
  return index ? `${base}&index=${index}` : base;
};

// ---------- parsing the two JSON payloads Rightmove embeds in its pages ----------
function nextData(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no __NEXT_DATA__ (blocked or page layout changed)');
  return JSON.parse(m[1].replace(/^\uFEFF/, ''));
}

// Property pages carry `window.__PAGE_MODEL = {"data":"<devalue-flattened JSON>"}`: values are indexes into one array
function pageModel(html) {
  const key = 'window.__PAGE_MODEL = ';
  const at = String(html).indexOf(key);
  if (at < 0) throw new Error('no __PAGE_MODEL (blocked or page layout changed)');
  const start = at + key.length;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = j + 1; break; }
  }
  if (end < 0) throw new Error('unterminated __PAGE_MODEL');
  const arr = JSON.parse(JSON.parse(html.slice(start, end)).data);
  const memo = new Map();
  const rev = i => {
    if (i === -1) return undefined;
    if (i === -2) return null;
    if (i < 0) return NaN;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (v === null || typeof v !== 'object') { memo.set(i, v); return v; }
    if (Array.isArray(v)) { const a = []; memo.set(i, a); for (const x of v) a.push(rev(x)); return a; }
    const o = {}; memo.set(i, o); for (const k of Object.keys(v)) o[k] = rev(v[k]); return o;
  };
  return rev(0);
}

// ---------- URL safety ----------
const MEDIA_RX = /^https:\/\/media\.rightmove\.co\.uk\/[\w\-./:%@+~]+$/;
const mediaUrl = u => {
  let s = String(u || '').trim().replace('media.rightmove.co.uk:443', 'media.rightmove.co.uk');
  if (s && !/^https?:/i.test(s)) s = 'https://media.rightmove.co.uk/' + s.replace(/^\/+/, '');
  return MEDIA_RX.test(s) ? s : '';
};
// Card thumbnails: the 476px crop Rightmove serves on its own results page is soft on retina, so ask for its 656px size
const thumbUrl = img => {
  const s = mediaUrl(img && img.srcUrl);
  return /_max_\d+x\d+\.(?:jpe?g|png|webp)$/i.test(s) ? s.replace(/_max_\d+x\d+\./, '_max_656x437.') : s || mediaUrl(img && img.url);
};
const parseUrl = raw => { try { const u = new URL(String(raw || '').trim()); return u.protocol === 'https:' && !u.username ? u : null; } catch (e) { return null; } };

const statusOf = display => {
  const s = String(display || '').toLowerCase();
  if (/sold stc|under offer|reserved/.test(s)) return 'sstc';
  if (/let agreed/.test(s)) return 'let-agreed';
  if (/^sold\b/.test(s)) return 'sold';
  if (/^let\b/.test(s)) return 'let';
  return 'available';
};

function create(h, opts = {}) {
  const branches = opts.branches || parseBranches(process.env.RIGHTMOVE_BRANCHES);
  const prev = (opts.prev || []).filter(r => r && r.source === 'rightmove');
  const gap = opts.gap ?? GAP_MS;
  let gate = Promise.resolve();
  const slot = () => { const p = gate.then(() => h.sleep(gap)); gate = p; return p; };

  const fetchText = opts.fetchText || (async url => {
    const res = await fetch(url, { headers: { 'User-Agent': h.UA, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.8' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.text();
  });
  const page = async (url, tries = 3) => {
    for (let i = 1; ; i++) {
      await slot();
      try { return await fetchText(url); }
      catch (e) {
        if (i >= tries || (e.status && e.status < 500 && e.status !== 429)) throw new Error(`${url.replace(HOST, '')}: ${e.message}`);
        await h.sleep(1500 * i);
      }
    }
  };

  function toListing(p, ch, branch) {
    const rid = String(p.id);
    if (!/^\d{5,12}$/.test(rid)) return null;
    const section = ch.section;
    const dp = (p.price && p.price.displayPrices && p.price.displayPrices[0]) || {};
    const a = h.parseAddress(String(p.displayAddress || ''));
    if (!a.address) return null;
    const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const loc = p.location || {};
    const [lat, lng] = num(loc.latitude) != null && num(loc.longitude) != null ? [loc.latitude, loc.longitude] : [null, null];
    const hub = h.nearestHub(lat, lng);
    const t = h.parseType(String(p.propertyTypeFullDescription || p.propertySubType || '').replace(/\s+(?:for sale|to rent)$/i, ''));
    // "2 bedroom property" says nothing: fall back to Rightmove's own sub-type (Detached, Lodge, Land...), or spot holiday lodges
    if (!t.type || /^property$/i.test(t.type)) {
      const sub = String(p.propertySubType || '').trim().toLowerCase();
      if (sub && !/^(?:property|not specified)$/.test(sub)) { t.type = sub; t.category = /lodge|park home|caravan|static|mobile/.test(sub) ? 'other' : h.categoryOf(sub); }
      else if (/\b(?:lodge|holiday park|caravan|park home)\b/i.test(`${a.address} ${p.summary || ''}`)) { t.type = 'lodge'; t.category = 'other'; }
      else if (/^property$/i.test(t.type)) { t.type = ''; t.category = ''; }
    }
    const tours = (p.virtualTours || []).map(v => parseUrl(v && v.url)).filter(u => u && h.TOUR_HOSTS.test(u.hostname));
    const photo = thumbUrl((p.images || [])[0]);
    return {
      id: 'rm-' + rid, source: 'rightmove', section, ...(p.students ? { students: true } : {}),
      url: `${HOST}/properties/${rid}`, ...a, town: a.town || hub, hub, lat, lng,
      ...h.parsePrice([dp.displayPriceQualifier, dp.displayPrice].filter(Boolean).join(' '), section),
      ...t, beds: t.beds ?? (Number.isInteger(p.bedrooms) ? p.bedrooms : null),
      status: statusOf(p.displayStatus), rank: 0, photo, photo_count: photo ? Number(p.numberOfImages) || 1 : 0, has_tour: tours.length > 0,
      rm_branch: branch.id, _rev: String(p.updateDate || ''), _added: String(p.firstVisibleDate || '')
    };
  }

  async function searchBranch(b, ch) {
    const base = searchUrl(b, ch.channel);
    const read = html => nextData(html).props.pageProps.searchResults;
    const first = read(await page(base));
    const total = Number(first.resultCount) || 0;
    const props = [...(first.properties || [])];
    const pages = ((first.pagination && first.pagination.options) || []).map(o => Number(o.value)).filter(n => n > 0);
    for (const i of pages) props.push(...(read(await page(searchUrl(b, ch.channel, i))).properties || []));
    const seen = new Set();
    const rows = props.filter(p => p && !seen.has(p.id) && seen.add(p.id)).map(p => toListing(p, ch, b)).filter(Boolean);
    if (total && rows.length < total * 0.9) throw new Error(`parsed ${rows.length} of ${total} listings, refusing a partial result`);
    return rows;
  }

  async function list() {
    const out = [];
    const problems = [];
    for (const b of branches) {
      for (const ch of CHANNELS) {
        try { out.push(...await searchBranch(b, ch)); }
        catch (e) {
          const kept = prev.filter(r => r.rm_branch === b.id && r.section === ch.section).map(r => ({ ...r, _keep: true }));
          problems.push(`${b.name} ${ch.section}: ${e.message} (kept ${kept.length} previous listings)`);
          out.push(...kept);
        }
      }
    }
    const seen = new Set();
    const unique = out.filter(l => !seen.has(l.id) && seen.add(l.id));
    // newest first within each section (kept rows have no date, so they sort last)
    const rank = {};
    unique.sort((x, y) => (y._added || '').localeCompare(x._added || '')).forEach(l => { l.rank = rank[l.section] = (rank[l.section] ?? -1) + 1; });
    problems.forEach(m => console.warn(`  rightmove: ${m}`));
    if (problems.length && process.env.GITHUB_ACTIONS) console.log(`::warning title=Rightmove feed::${problems.join(' | ').replace(/[\r\n]+/g, ' ')}`);
    return { list: unique, problems };
  }

  function toDetail(pd, l) {
    const raw = String((pd.text && pd.text.description) || '');
    const paras = raw.split(/<br\s*\/?>\s*(?:<br\s*\/?>\s*)+|<\/p>/i)
      .map(p => h.tidy(h.decode(p.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))).replace(/\s+/g, ' ').trim())
      .filter(p => p.length > 1);
    // Agents open with a one-line strapline; show it as the summary when it is followed by the full description
    const summary = paras.length > 1 && paras[0].length <= 400 ? paras.shift() : '';
    const photos = [...new Set((pd.images || []).map(i => mediaUrl(i && i.url)).filter(Boolean))];
    const floorplans = [...new Set((pd.floorplans || []).map(f => mediaUrl(f && f.url)).filter(Boolean))];
    const highlights = (pd.keyFeatures || []).map(s => h.tidy(String(s)).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20);
    let tour = '';
    for (const v of pd.virtualTours || []) {
      const u = parseUrl(v && v.url);
      if (u && h.TOUR_HOSTS.test(u.hostname)) { tour = h.canonTour(u, String(v.url)); if (tour) break; }
    }
    const epc = (pd.epcGraphs || []).map(e => parseUrl(mediaUrl(e && e.url))).find(u => u && h.EPC_HOSTS.test(u.hostname));
    return { id: l.id, photos: photos.length ? photos : l.photo ? [l.photo] : [], floorplans, highlights, summary, description: paras.join('\n\n'), tour, epc: epc ? epc.href : '' };
  }

  async function detail(l) {
    const rid = l.id.replace(/^rm-/, '');
    const model = pageModel(await page(`${HOST}/properties/${rid}`));
    if (!model || !model.propertyData) throw new Error('no propertyData in page model');
    return toDetail(model.propertyData, l);
  }

  return { list, detail, toListing, toDetail };
}

module.exports = { create, parseBranches, searchUrl, nextData, pageModel, mediaUrl, thumbUrl, statusOf, DEFAULT_BRANCHES };
