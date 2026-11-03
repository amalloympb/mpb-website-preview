// Homepage property search and latest listings. Data comes from data/properties.json via listing.js.
(() => {
  const form = $('#homeSearch');
  if (!form || typeof MPB === 'undefined') return;
  const { el, loadFeed, card, watchImages, BANDS, money, inSection } = MPB;
  const grid = $('#hsGrid'), qIn = $('#hsQ'), pmin = $('#hsMin'), pmax = $('#hsMax'), beds = $('#hsBeds');
  const head = $('#hsHead'), viewAll = $('#hsAll'), pop = $('#hsPop'), places = $('#hsPlaces');

  const COPY = {
    sales: { head: 'Latest homes for sale', cta: ['Thinking of selling?', 'What is your home worth?', 'Free, no-obligation valuation from your local My Property Box team.', 'Get my free valuation', 'sell.html'] },
    lets: { head: 'Latest properties to let', cta: ['Own a property to let?', 'See what your property could earn.', 'Free, no-obligation rental appraisal from your local My Property Box team.', 'Get my free appraisal', 'let.html'] },
    students: { head: 'Latest student lets', cta: ['Landlord?', 'Is your property working hard enough?', 'Free, no-obligation management review from your local My Property Box team.', 'Get my free review', 'landlords.html'] }
  };
  let section = 'sales', feed = null;

  const opt = (v, t) => { const o = el('option', '', t); o.value = v; return o; };
  const isLive = p => p.status === 'available' || p.status === 'sstc';
  const live = s => feed.properties.filter(p => inSection(p, s) && isLive(p));

  // Six newest available homes with a photo, no more than two from any one hub so the grid shows the spread of our areas
  const latest = s => {
    const pool = live(s).filter(p => p.status === 'available' && p.photo).sort((a, b) => a.rank - b.rank);
    const out = [], used = {};
    pool.forEach(p => {
      const k = p.hub || p.town;
      used[k] = (used[k] || 0) + 1;
      if (used[k] <= 2 && out.length < 6) out.push(p);
    });
    pool.forEach(p => { if (out.length < 6 && !out.includes(p)) out.push(p); });
    return out;
  };

  const tally = s => {
    const hubs = new Map(), names = new Map();
    live(s).forEach(p => {
      if (p.hub) hubs.set(p.hub, (hubs.get(p.hub) || 0) + 1);
      [p.hub, p.town].forEach(n => { if (n) names.set(n, (names.get(n) || 0) + 1); });
    });
    const top = m => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { hubs: top(hubs).slice(0, 8), names: top(names).slice(0, 60).map(x => x[0]) };
  };

  const skeleton = () => grid.replaceChildren(...Array.from({ length: 6 }, () => {
    const a = el('article', 'pc sk'), b = el('div', 'pc-body');
    a.setAttribute('aria-hidden', 'true');
    const lines = [el('i'), el('i'), el('i')];
    lines[0].style.width = '45%'; lines[1].style.width = '85%'; lines[2].style.width = '60%';
    b.append(...lines);
    a.append(el('div', 'pc-img'), b);
    return a;
  }));

  const cta = s => {
    const [kick, h, body, label, page] = COPY[s].cta;
    const box = el('div', 'pc-cta'), txt = el('div');
    txt.append(el('p', 'kicker', kick), el('h3', '', h), el('p', '', body));
    const a = el('a', 'btn btn-mint', label);
    a.href = `${page}?src=home-search#get-started`;
    a.addEventListener('click', () => track('mpb_search_cta', { section: s, variant: 'home' }));
    box.append(txt, a);
    return box;
  };

  const message = (title, text) => {
    const box = el('div', 'empty'), row = el('div', 'row');
    const a = el('a', 'btn btn-navy', 'Search all properties');
    a.href = 'properties.html?section=' + section;
    row.append(a);
    box.append(el('h3', '', title), el('p', '', text), row);
    grid.replaceChildren(box);
  };

  const fillPrice = () => {
    const b = BANDS[section];
    [[pmin, 'No min'], [pmax, 'No max']].forEach(([sel, none]) => sel.replaceChildren(opt('', none), ...b.vals.map(v => opt(v, money(v) + b.unit))));
  };

  const render = () => {
    const s = section, t = tally(s), items = latest(s);
    head.textContent = COPY[s].head;
    viewAll.textContent = `View all ${live(s).length} \u2192`;
    viewAll.href = 'properties.html?section=' + s;
    fillPrice();
    places.replaceChildren(...t.names.map(n => opt(n, '')));
    pop.replaceChildren(...(t.hubs.length ? [el('span', '', 'Popular:')] : []), ...t.hubs.map(([n, c]) => {
      const a = el('a', '', n + ' ');
      a.href = `properties.html?section=${s}&q=${encodeURIComponent(n)}`;
      a.append(el('small', '', String(c)));
      return a;
    }));
    if (!items.length) return message('No properties listed right now', 'New properties are added all the time. Search all of our listings, or ask us to let you know first.');
    grid.replaceChildren(...items.map(card), cta(s));
  };

  form.addEventListener('change', e => {
    if (e.target.name !== 'section' || !feed) return;
    section = e.target.value;
    render();
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = new URLSearchParams({ section });
    const loc = qIn.value.replace(/\s+/g, ' ').trim().slice(0, 60);
    let lo = +pmin.value, hi = +pmax.value;
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
    if (loc) q.set('q', loc);
    if (lo) q.set('min', lo);
    if (hi) q.set('max', hi);
    if (+beds.value) q.set('beds', beds.value);
    track('mpb_home_search', { section, location: !!loc, price: !!(lo || hi), beds: !!+beds.value });
    location.href = 'properties.html?' + q;
  });

  watchImages(grid);
  skeleton();
  const start = () => loadFeed().then(f => { feed = f; render(); }).catch(() => {
    message('We could not load the listings', 'Please try again in a moment, or search all of our properties.');
  });
  start();
})();
