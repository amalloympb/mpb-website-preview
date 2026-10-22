// Shared by the search page (properties.html) and the property page (property.html):
// feed access, formatting, the property card and the favourites shortlist.
const MPB = (() => {
  const FEED = 'data/properties.json';
  const ID_RX = /^[\w-]{3,64}$/;
  const FAV_KEY = 'mpb-favs';
  const NS = 'http://www.w3.org/2000/svg';
  // Embeddable 360 tour providers and EPC hosts; the sync applies the same lists, this is the client-side backstop.
  const TOUR_RX = /^(?:tour\.giraffe360\.com|my\.matterport\.com|kuula\.co|view\.ricoh360\.com)$/;
  const EPC_RX = /^(?:find-energy-certificate\.service\.gov\.uk|epc\.jupix\.co\.uk|media2\.jupix\.co\.uk)$/;

  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const icon = (id, cls) => {
    const s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    u.setAttribute('href', '#' + id);
    s.append(u);
    return s;
  };
  const https = (u, hosts) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' && (!hosts || hosts.test(x.hostname)) ? x.href : '';
    } catch (e) { return ''; }
  };
  const money = n => '\u00a3' + Math.round(n).toLocaleString('en-GB');

  // ---- Feed ----
  let feedP;
  const loadFeed = () => feedP || (feedP = fetch(FEED, { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => {
      if (!j || !Array.isArray(j.properties)) throw new Error('Unexpected feed format');
      j.byId = new Map(j.properties.map(p => [p.id, p]));
      return j;
    })
    .catch(e => { feedP = null; throw e; }));

  const details = new Map();
  const cleanDetail = d => {
    const arr = v => (Array.isArray(v) ? v : []);
    const str = v => (typeof v === 'string' ? v : '');
    return {
      photos: arr(d.photos).map(u => https(u)).filter(Boolean),
      floorplans: arr(d.floorplans).map(u => https(u)).filter(Boolean),
      highlights: arr(d.highlights).map(str).filter(Boolean),
      summary: str(d.summary),
      description: str(d.description),
      tour: https(str(d.tour), TOUR_RX),
      epc: https(str(d.epc), EPC_RX)
    };
  };
  const loadDetail = id => {
    if (!ID_RX.test(id)) return Promise.reject(new Error('Invalid property id'));
    if (!details.has(id)) {
      details.set(id, fetch('data/p/' + id + '.json')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(cleanDetail)
        .catch(e => { details.delete(id); throw e; }));
    }
    return details.get(id);
  };

  // ---- Formatting ----
  const propertyHref = p => 'property.html?id=' + encodeURIComponent(p.id);

  const priceParts = p => {
    if (p.section === 'sales') return { qual: p.price_qualifier || '', main: p.price ? money(p.price) : 'POA', unit: '', sub: '' };
    const f = p.price_freq, pcmNote = p.price_pcm ? '\u2248 ' + money(p.price_pcm) + ' pcm' : '';
    if (f === 'pppw') return { qual: '', main: money(p.price_pppw ?? p.price), unit: 'pppw', sub: pcmNote };
    if (f === 'pw') return { qual: '', main: money(p.price), unit: 'pw', sub: pcmNote };
    return { qual: '', main: money(p.price_pcm ?? p.price), unit: 'pcm', sub: '' };
  };
  const priceText = p => {
    const x = priceParts(p);
    return [x.qual, x.main, x.unit].filter(Boolean).join(' ');
  };
  const bedsText = p => (p.beds == null ? '' : p.beds === 0 ? 'Studio' : p.beds + (p.beds === 1 ? ' bedroom' : ' bedrooms'));

  const STATUS = {
    available: p => (p.section === 'sales' ? 'For sale' : p.students ? 'Student let' : 'To let'),
    sstc: () => 'Sold STC', sold: () => 'Sold', 'let-agreed': () => 'Let agreed', let: () => 'Let'
  };
  const statusText = p => (STATUS[p.status] ? STATUS[p.status](p) : '');
  const isOff = p => p.status === 'sold' || p.status === 'let';
  const valueOf = p => (p.section === 'sales' ? p.price : p.price_pcm ?? p.price);

  const ago = iso => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'just now';
    const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
  };

  const valuationHref = (p, src) => {
    const page = p.section === 'sales' ? 'sell.html' : 'let.html';
    return `${page}?loc=${encodeURIComponent(p.hub || p.town || '')}&src=${src}#get-started`;
  };

  // Closest active listings in the same section: same hub first, then price, type and bedrooms
  const similar = (p, all, n = 3) => {
    const base = valueOf(p) || 1;
    const score = x => (x.hub === p.hub ? 0 : 2)
      + Math.abs(Math.log((valueOf(x) || base) / base))
      + (x.category === p.category ? 0 : 0.5)
      + (x.beds != null && p.beds != null ? Math.abs(x.beds - p.beds) * 0.15 : 0);
    return all
      .filter(x => x.id !== p.id && x.section === p.section && !!x.students === !!p.students && x.status === 'available')
      .map(x => [score(x), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(a => a[1]);
  };

  // ---- Cards ----
  const placeholder = () => {
    const d = el('div', 'pc-ph');
    d.append(icon('lg-home'), el('span', '', 'Photos coming soon'));
    return d;
  };

  const card = p => {
    const off = isOff(p);
    const art = el('article', 'pc' + (off ? ' is-off' : ''));
    const media = el('div', 'pc-img');
    const src = https(p.photo);
    if (src) {
      const img = el('img');
      img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      media.append(img);
    } else media.append(placeholder());

    const badge = p.status !== 'available' ? statusText(p) : p.students ? 'Student let' : '';
    if (badge) media.append(el('span', 'pc-badge st-' + p.status, badge));
    if (p.photo_count > 1) {
      const n = el('span', 'pc-n');
      n.append(icon('i-camera'), document.createTextNode(String(p.photo_count)));
      media.append(n);
    }
    if (p.has_tour) {
      const t = el('span', 'pc-tour');
      t.append(icon('i-360'), document.createTextNode('360\u00b0 tour'));
      media.append(t);
    }
    const fav = el('button', 'pc-fav');
    fav.type = 'button';
    fav.dataset.fav = p.id;
    fav.setAttribute('aria-label', 'Save to shortlist');
    fav.setAttribute('aria-pressed', favs.has(p.id));
    fav.append(icon('i-heart'));
    media.append(fav);

    const body = el('div', 'pc-body');
    const pr = priceParts(p), price = el('div', 'pc-price');
    if (pr.qual) price.append(el('small', '', pr.qual));
    price.append(el('b', '', pr.main));
    if (pr.unit) price.append(el('span', '', pr.unit));
    const h = el('h3', 'pc-title'), a = el('a', 'pc-link', p.address);
    a.href = propertyHref(p);
    h.append(a);
    const meta = el('p', 'pc-meta');
    if (p.beds != null) { const s = el('span'); s.append(icon('i-bed'), document.createTextNode(bedsText(p))); meta.append(s); }
    if (p.type) meta.append(el('span', '', p.type));
    body.append(price, h, meta);
    art.append(media, body);
    return art;
  };

  // Swap broken CRM images for the placeholder
  const watchImages = root => root.addEventListener('error', e => {
    const i = e.target;
    if (!(i instanceof HTMLImageElement) || !i.closest('.pc-img, .mp')) return;
    i.replaceWith(placeholder());
  }, true);

  // ---- Toast ----
  let toastT;
  const toast = msg => {
    const t = $('#toast');
    if (!t) return;
    const host = $('dialog[open]') || document.body; // dialogs sit in the top layer, so the toast must live inside them
    if (t.parentNode !== host) host.append(t);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2800);
  };

  // ---- Shortlist (favourites, stored on this device only) ----
  const favs = (() => {
    let set = new Set();
    try {
      const a = JSON.parse(localStorage.getItem(FAV_KEY));
      if (Array.isArray(a)) set = new Set(a.filter(x => typeof x === 'string' && ID_RX.test(x)).slice(0, 200));
    } catch (e) {}
    return {
      has: id => set.has(id),
      all: () => [...set],
      size: () => set.size,
      toggle(id) {
        if (!ID_RX.test(id)) return false;
        let on;
        if (set.has(id)) { set.delete(id); on = false; }
        else { if (set.size >= 200) set.delete(set.values().next().value); set.add(id); on = true; }
        try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch (e) {}
        document.dispatchEvent(new CustomEvent('mpb-favs', { detail: { id, on } }));
        return on;
      }
    };
  })();
  const syncFavs = (root = document) => $$('[data-fav]', root).forEach(b => {
    const on = favs.has(b.dataset.fav), t = $('[data-t]', b);
    b.setAttribute('aria-pressed', on);
    if (t) t.textContent = on ? b.dataset.on : b.dataset.off;
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    const on = favs.toggle(b.dataset.fav);
    syncFavs();
    toast(on ? 'Saved to your shortlist' : 'Removed from your shortlist');
    track('mpb_favourite', { on });
  });

  const yr = $('#yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // OpenStreetMap's public tiles suit launch-level traffic; move to a keyed provider (MapTiler, Stadia, Mapbox) before heavy use
  const TILES = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' } };

  return {
    ID_RX, el, icon, https, money, loadFeed, loadDetail, propertyHref, priceParts, priceText, bedsText, statusText, isOff,
    valueOf, ago, valuationHref, similar, placeholder, card, watchImages, toast, favs, syncFavs, TILES
  };
})();
