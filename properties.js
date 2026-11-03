// Property search: filters, autocomplete, grid/map views, shortlist and search alerts.
// Data comes from data/properties.json (written by feed/sync.js); see listing.js for the shared pieces.
(() => {
  const { el, icon, money, loadFeed, card, watchImages, favs, ago, valueOf, priceText, BANDS, norm, inSection } = MPB;
  const PAGE = 24;
  const LIVE_URL = 'https://www.mypropertybox.co.uk/results-gallery.php?section=';

  const SECTIONS = {
    sales: { tab: 'For sale', noun: 'for sale', head: 'homes for sale', soldLbl: 'Include sold' },
    lets: { tab: 'To let', noun: 'to let', head: 'properties to let', soldLbl: 'Include let agreed' },
    students: { tab: 'Students', noun: 'student lets', head: 'student properties', soldLbl: 'Include let agreed' }
  };
  const TYPES =  [['house', 'Houses'], ['flat', 'Flats & apartments'], ['bungalow', 'Bungalows'], ['room', 'Rooms'], ['land', 'Land'], ['commercial', 'Commercial'], ['other', 'Other']];
  const SORTS = ['new', 'price-asc', 'price-desc', 'beds-desc'];

  const form = $('#ps'), qIn = $('#q'), qClear = $('#qClear'), qList = $('#qList');
  const pmin = $('#pmin'), pmax = $('#pmax'), bedsSel = $('#beds'), typeSel = $('#type');
  const soldCb = $('#sold'), tourCb = $('#tour'), sortSel = $('#sort');
  const grid = $('#grid'), mapWrap = $('#mapWrap'), moreWrap = $('#moreWrap'), afc = $('#afc');
  const favBtn = $('#favBtn'), favN = $('#favN'), alertBtn = $('#alertBtn');

  const S = { section: 'sales', q: '', min: 0, max: 0, beds: 0, type: '', sold: false, tour: false, sort: 'new', view: 'grid', saved: false, shown: PAGE };
  let all = [], F = [], names = [], ready = false;

  const tokens = s => norm(s).split(' ').filter(Boolean);
  const gate =  p => p.status === 'available' || p.status === 'sstc' || S.sold;
  const priceOf = (p, s) => (s === 'sales' ? p.price : s === 'students' ? p.price_pppw : p.price_pcm);
  const matchLoc = (p, toks) => toks.every(t => p._p.includes(' ' + t));
  const opt = (v, t) => { const o = el('option', '', t); o.value = v; return o; };

  // ---- Filtering ----
  const compare = {
    new: (a, b) => a.rank - b.rank,
    'price-asc': (a, b) => cmpNum(valueOf(a), valueOf(b), 1) || a.rank - b.rank,
    'price-desc': (a, b) => cmpNum(valueOf(a), valueOf(b), -1) || a.rank - b.rank,
    'beds-desc': (a, b) => (b.beds ?? -1) - (a.beds ?? -1) || a.rank - b.rank
  };
  function cmpNum(x, y, dir) {
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  }

  const filtered = () => {
    if (S.saved) return all.filter(p => favs.has(p.id)).sort(compare[S.sort]);
    const toks = tokens(S.q), filterPrice = S.min || S.max;
    return all.filter(p => {
      if (!inSection(p, S.section) || !gate(p)) return false;
      if (S.tour && !p.has_tour) return false;
      if (toks.length && !matchLoc(p, toks)) return false;
      if (S.beds && !(p.beds != null && p.beds >= S.beds)) return false;
      if (S.type && p.category !== S.type) return false;
      if (filterPrice) {
        const v = priceOf(p, S.section);
        if (v == null || (S.min && v < S.min) || (S.max && v > S.max)) return false;
      }
      return true;
    }).sort(compare[S.sort]);
  };

  // ---- Form building ----
  const fillPrice = () => {
    const b = BANDS[S.section];
    [[pmin, 'No min', S.min], [pmax, 'No max', S.max]].forEach(([sel, none, cur]) => {
      sel.replaceChildren(opt('', none), ...b.vals.map(v => opt(v, money(v) + b.unit)));
      sel.value = cur ? String(cur) : '';
    });
  };
  const fillBeds = () => {
    bedsSel.replaceChildren(opt('', 'Any'), ...[1, 2, 3, 4, 5].map(n => opt(n, n + '+')));
    bedsSel.value = S.beds ? String(S.beds) : '';
  };
  const fillType = () => {
    const have = new Set(all.filter(p => inSection(p, S.section) && gate(p)).map(p => p.category));
    const list = TYPES.filter(([k]) => have.has(k));
    if (S.type && !have.has(S.type)) S.type = '';
    typeSel.replaceChildren(opt('', 'Any type'), ...list.map(([k, t]) => opt(k, t)));
    typeSel.value = S.type;
  };
  const buildNames = () => {
    const pool = all.filter(p => inSection(p, S.section) && gate(p));
    const seen = new Map();
    pool.forEach(p => [p.hub, p.town].forEach(n => { if (n && !seen.has(norm(n))) seen.set(norm(n), n); }));
    names = [...seen].map(([key, name]) => {
      const toks = key.split(' ');
      return { key, name, n: pool.filter(p => matchLoc(p, toks)).length };
    }).filter(x => x.n).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };
  const syncForm = () => {
    $$('input[name=section]', form).forEach(r => { r.checked = r.value === S.section; });
    qIn.value = S.q;
    qClear.hidden = !S.q;
    fillPrice(); fillBeds(); fillType();
    soldCb.checked = S.sold;
    tourCb.checked = S.tour;
    sortSel.value = S.sort;
    $('#soldLbl').textContent = SECTIONS[S.section].soldLbl;
  };
  const updateCounts = () => {
    Object.keys(SECTIONS).forEach(s => { $('#cnt-' + s).textContent = all.filter(p => inSection(p, s) && gate(p)).length; });
    const n = all.filter(p => inSection(p, S.section) && gate(p) && p.has_tour).length;
    $('#tourN').textContent = '(' + n + ')';
  };

  // ---- URL state ----
  const writeUrl = () => {
    const q = new URLSearchParams();
    q.set('section', S.section);
    if (S.q) q.set('q', S.q);
    if (S.min) q.set('min', S.min);
    if (S.max) q.set('max', S.max);
    if (S.beds) q.set('beds', S.beds);
    if (S.type) q.set('type', S.type);
    if (S.sold) q.set('sold', '1');
    if (S.tour) q.set('tour', '1');
    if (S.sort !== 'new') q.set('sort', S.sort);
    if (S.view === 'map') q.set('view', 'map');
    if (S.saved) q.set('saved', '1');
    try { history.replaceState(null, '', location.pathname + '?' + q); } catch (e) {}
  };
  const readUrl = () => {
    const q = new URLSearchParams(location.search);
    if (SECTIONS[q.get('section')]) S.section = q.get('section');
    S.q = (q.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const vals = BANDS[S.section].vals;
    const band = k => { const n = +q.get(k); return vals.includes(n) ? n : 0; };
    S.min = band('min'); S.max = band('max');
    if (S.min && S.max && S.min > S.max) S.max = 0;
    const b = +q.get('beds'); S.beds = b >= 1 && b <= 5 ? b : 0;
    S.type = TYPES.some(([k]) => k === q.get('type')) ? q.get('type') : '';
    S.sold = q.get('sold') === '1';
    S.tour = q.get('tour') === '1';
    if (SORTS.includes(q.get('sort'))) S.sort = q.get('sort');
    S.view = q.get('view') === 'map' ? 'map' : 'grid';
    S.saved = q.get('saved') === '1';
  };

  // ---- Rendering ----
  const skeleton = n => grid.replaceChildren(...Array.from({ length: n }, () => {
    const a = el('article', 'pc sk'), b = el('div', 'pc-body');
    a.setAttribute('aria-hidden', 'true');
    const lines = [el('i'), el('i'), el('i')];
    lines[0].style.width = '45%'; lines[1].style.width = '85%'; lines[2].style.width = '60%';
    b.append(...lines);
    a.append(el('div', 'pc-img'), b);
    return a;
  }));

  const areaLabel = () => {
    const t = tokens(S.q).join(' ');
    const hit = names.find(x => x.key === t);
    return hit ? hit.name : F[0] && F[0].hub ? F[0].hub : '';
  };
  const cta = landlord => {
    const area = areaLabel(), selling = S.section === 'sales';
    const box = el('div', 'pc-cta'), txt = el('div');
    let kick, head, body, label, page;
    if (landlord) {
      [kick, head, body, label, page] = ['Landlord?', 'Is your property working hard enough?', 'Free, no-obligation management review from your local My Property Box team.', 'Get my free review', 'landlords.html'];
    } else {
      kick = selling ? 'Thinking of selling?' : 'Own a property to let?';
      head = selling ? `What is your ${area || 'local'} home worth?` : `Landlord in ${area || 'the North'}? See what you could earn.`;
      body = selling ? 'Free, no-obligation valuation from your local My Property Box team.' : 'Free, no-obligation rental appraisal from your local My Property Box team.';
      label = selling ? 'Get my free valuation' : 'Get my free appraisal';
      page = selling ? 'sell.html' : 'let.html';
    }
    txt.append(el('p', 'kicker', kick), el('h3', '', head), el('p', '', body));
    const a = el('a', 'btn btn-mint', label);
    a.href = `${page}?loc=${encodeURIComponent(area)}&src=search#get-started`;
    a.addEventListener('click', () => track('mpb_search_cta', { section: S.section, variant: landlord ? 'landlord' : 'owner' }));
    box.append(txt, a);
    return box;
  };

  let rendered = 0;
  const renderGrid = append => {
    if (!append) { grid.replaceChildren(); rendered = 0; }
    const end = Math.min(S.shown, F.length), first = rendered;
    const frag = document.createDocumentFragment();
    for (let i = rendered; i < end; i++) {
      frag.append(card(F[i]));
      if (i === 5 || i === 17 || (i === F.length - 1 && F.length < 6)) frag.append(cta(i === 17 && S.section === 'sales'));
    }
    grid.append(frag);
    rendered = end;
    return first;
  };

  const emptyState = () => {
    const box = el('div', 'empty');
    const row = el('div', 'row');
    if (S.saved) {
      box.append(icon('i-heart'), el('h3', '', 'Nothing saved yet'), el('p', '', 'Tap the heart on any property to build a shortlist you can come back to.'));
      const b = el('button', 'btn btn-navy', 'Browse properties');
      b.type = 'button';
      b.addEventListener('click', () => { S.saved = false; apply(); });
      row.append(b);
    } else {
      box.append(icon('i-search'), el('h3', '', 'No properties match your search'), el('p', '', 'Try widening your price range, removing a filter or searching a nearby area. Or tell us what you are after and we will email you as soon as something suitable comes up.'));
      if (chips().length) {
        const b = el('button', 'btn btn-line', 'Clear filters');
        b.type = 'button';
        b.addEventListener('click', clearAll);
        row.append(b);
      }
      const a = el('button', 'btn btn-navy', 'Get alerts for this search');
      a.type = 'button';
      a.addEventListener('click', openAlert);
      row.append(a);
    }
    box.append(row);
    return box;
  };

  const chips = () => {
    const c = [], b = BANDS[S.section];
    if (S.q) c.push([S.q, () => { S.q = ''; }]);
    if (S.min) c.push(['From ' + money(S.min) + b.unit, () => { S.min = 0; }]);
    if (S.max) c.push(['Up to ' + money(S.max) + b.unit, () => { S.max = 0; }]);
    if (S.beds) c.push([S.beds + '+ bedrooms', () => { S.beds = 0; }]);
    if (S.type) c.push([(TYPES.find(t => t[0] === S.type) || [0, S.type])[1], () => { S.type = ''; }]);
    if (S.sold) c.push([SECTIONS[S.section].soldLbl, () => { S.sold = false; }]);
    if (S.tour) c.push(['360\u00b0 virtual tour', () => { S.tour = false; }]);
    return c;
  };
  const renderChips = () => {
    const list = S.saved ? [] : chips();
    afc.replaceChildren(...list.map(([label, clear]) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('aria-label', 'Remove filter: ' + label);
      b.append(icon('i-x'));
      b.addEventListener('click', () => { clear(); syncForm(); buildNames(); apply(); });
      return b;
    }));
    if (list.length > 1) {
      const b = el('button', 'afc-clear', 'Clear all');
      b.type = 'button';
      b.addEventListener('click', clearAll);
      afc.append(b);
    }
  };
  const clearAll = () => {
    Object.assign(S, { q: '', min: 0, max: 0, beds: 0, type: '', sold: false, tour: false });
    syncForm(); buildNames(); apply();
  };

  const render = () => {
    const n = F.length, sec = SECTIONS[S.section];
    const where = S.saved ? '' : S.q ? ' in ' + S.q : '';
    $('#resTitle').textContent = S.saved ? `Your shortlist (${n})` : n ? `${n} ${n === 1 ? 'property' : sec.head}${where}` : 'No properties found';
    $('#resSub').textContent = S.saved ? 'Saved on this device only.' : n && S.view === 'grid' ? `Showing ${Math.min(S.shown, n)} of ${n}` : '';
    favBtn.setAttribute('aria-pressed', S.saved);
    alertBtn.hidden = S.saved;
    renderChips();
    $$('.vt button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === S.view));
    const map = S.view === 'map' && n > 0;
    mapWrap.hidden = !map;
    grid.hidden = map;
    if (map) { moreWrap.hidden = true; drawMap(); return; }
    if (!n) { grid.replaceChildren(emptyState()); rendered = 0; moreWrap.hidden = true; return; }
    renderGrid(false);
    moreWrap.hidden = S.shown >= n;
    $('#moreTxt').textContent = `Showing ${Math.min(S.shown, n)} of ${n} properties`;
  };

  function apply(keepShown) {
    if (!ready) return;
    if (!keepShown) S.shown = PAGE;
    F = filtered();
    document.body.dataset.nudge = S.section === 'sales' ? 'sell' : 'let';
    updateCounts();
    render();
    writeUrl();
  }

  // ---- Autocomplete ----
  let sugItems = [], sugData = [], sugIdx = -1;
  const hideSug = () => {
    qList.hidden = true;
    qIn.setAttribute('aria-expanded', 'false');
    qIn.removeAttribute('aria-activedescendant');
    sugIdx = -1;
  };
  const setActive = i => {
    sugIdx = i;
    sugItems.forEach((li, k) => li.setAttribute('aria-selected', k === i));
    if (i >= 0) { qIn.setAttribute('aria-activedescendant', sugItems[i].id); sugItems[i].scrollIntoView({ block: 'nearest' }); }
    else qIn.removeAttribute('aria-activedescendant');
  };
  const showSug = () => {
    const v = norm(qIn.value);
    const list = (v ? names.filter(x => (' ' + x.key).includes(' ' + v)).sort((a, b) => (b.key.startsWith(v) - a.key.startsWith(v)) || b.n - a.n) : names).slice(0, 8);
    qList.replaceChildren();
    sugItems = [];
    sugData = list;
    if (!list.length) { hideSug(); return; }
    if (!v) { const h = el('li', 'sug-h', 'Popular areas'); h.setAttribute('role', 'presentation'); qList.append(h); }
    list.forEach((x, i) => {
      const li = el('li', '', x.name);
      li.id = 'sug-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.append(el('small', '', x.n + (x.n === 1 ? ' property' : ' properties')));
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(x.name); });
      qList.append(li);
      sugItems.push(li);
    });
    qList.hidden = false;
    qIn.setAttribute('aria-expanded', 'true');
    sugIdx = -1;
  };
  const choose = name => {
    clearTimeout(liveT);
    qIn.value = S.q = name;
    qClear.hidden = false;
    S.saved = false;
    hideSug();
    apply();
    track('mpb_search', { section: S.section, via: 'suggestion' });
  };

  let liveT;
  qIn.addEventListener('input', () => {
    qClear.hidden = !qIn.value;
    showSug();
    clearTimeout(liveT);
    liveT = setTimeout(() => { S.q = qIn.value.replace(/\s+/g, ' ').trim().slice(0, 60); S.saved = false; apply(); }, 250);
  });
  qIn.addEventListener('focus', () => { if (!qIn.value) showSug(); });
  qIn.addEventListener('click', () => { if (qList.hidden && !qIn.value) showSug(); });
  qIn.addEventListener('keydown', e => {
    const open = !qList.hidden;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) showSug(); else setActive((sugIdx + 1) % sugItems.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive(sugIdx <= 0 ? sugItems.length - 1 : sugIdx - 1);
    } else if (e.key === 'Enter' && open && sugIdx >= 0) {
      e.preventDefault();
      choose(sugData[sugIdx].name);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      hideSug();
    } else if (e.key === 'Tab') hideSug();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.ps-loc')) hideSug(); });
  qClear.addEventListener('click', () => {
    clearTimeout(liveT);
    qIn.value = S.q = '';
    qClear.hidden = true;
    qIn.focus();
    apply();
  });

  // ---- Controls ----
  const leaveSaved = () => { S.saved = false; };
  $$('input[name=section]', form).forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    Object.assign(S, { section: r.value, min: 0, max: 0, type: '' });
    leaveSaved();
    fillPrice(); fillType(); buildNames();
    $('#soldLbl').textContent = SECTIONS[S.section].soldLbl;
    apply();
    track('mpb_search_tab', { section: S.section });
  }));
  pmin.addEventListener('change', () => {
    S.min = +pmin.value || 0;
    if (S.min && S.max && S.min > S.max) { S.max = 0; pmax.value = ''; }
    leaveSaved(); apply();
  });
  pmax.addEventListener('change', () => {
    S.max = +pmax.value || 0;
    if (S.min && S.max && S.min > S.max) { S.min = 0; pmin.value = ''; }
    leaveSaved(); apply();
  });
  bedsSel.addEventListener('change', () => { S.beds = +bedsSel.value || 0; leaveSaved(); apply(); });
  typeSel.addEventListener('change', () => { S.type = typeSel.value; leaveSaved(); apply(); });
  soldCb.addEventListener('change', () => { S.sold = soldCb.checked; leaveSaved(); fillType(); buildNames(); apply(); });
  tourCb.addEventListener('change', () => { S.tour = tourCb.checked; leaveSaved(); apply(); });
  sortSel.addEventListener('change', () => { S.sort = sortSel.value; apply(); });

  form.addEventListener('submit', e => {
    e.preventDefault();
    clearTimeout(liveT);
    S.q = qIn.value.replace(/\s+/g, ' ').trim().slice(0, 60);
    leaveSaved();
    hideSug();
    apply();
    track('mpb_search', { section: S.section, has_location: !!S.q });
    const r = $('#results');
    r.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    r.focus({ preventScroll: true });
  });
  $('#editBtn').addEventListener('click', () => {
    form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    qIn.focus({ preventScroll: true });
  });

  $('#moreBtn').addEventListener('click', () => {
    S.shown += PAGE;
    const first = renderGrid(true);
    moreWrap.hidden = S.shown >= F.length;
    $('#moreTxt').textContent = `Showing ${Math.min(S.shown, F.length)} of ${F.length} properties`;
    $('#resSub').textContent = `Showing ${Math.min(S.shown, F.length)} of ${F.length}`;
    const next = $$('.pc', grid)[first];
    if (next) $('.pc-link', next).focus({ preventScroll: true });
    track('mpb_search_more');
  });

  favBtn.addEventListener('click', () => { S.saved = !S.saved; apply(); });
  const syncFavCount = () => { const n = favs.size(); favN.textContent = n; favN.dataset.n = n; };
  document.addEventListener('mpb-favs', () => {
    syncFavCount();
    if (S.saved) apply(true);
  });

  $$('.vt button').forEach(b => b.addEventListener('click', () => {
    if (S.view === b.dataset.view) return;
    S.view = b.dataset.view;
    apply();
    if (S.view === 'map') track('mpb_search_map');
  }));

  // ---- Map (Leaflet is loaded the first time the map is opened) ----
  let map, cluster, mapLib;
  const loadScript = src => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Could not load ' + src));
    document.head.append(s);
  });
  const loadMapLib = () => mapLib || (mapLib = (window.L ? Promise.resolve() : loadScript('vendor/leaflet/leaflet.js'))
    .then(() => (window.L.markerClusterGroup ? 0 : loadScript('vendor/leaflet/leaflet.markercluster.js')))
    .catch(e => { mapLib = null; throw e; }));
  const short = v =>  (v >= 1e6 ? '\u00a3' + +(v / 1e6).toFixed(2) + 'm' : v >= 1e4 ? '\u00a3' + Math.round(v / 1e3) + 'k' : money(v));
  const pinText = p => {
    if (p.section === 'sales') return p.price ? short(p.price) : 'POA';
    if (p.price_freq === 'pppw') return money(p.price_pppw ?? p.price) + ' pw';
    return money(p.price_pcm ?? p.price);
  };
  const popup = p => {
    const a = el('a', 'mp'), src = MPB.https(p.photo);
    a.href = MPB.propertyHref(p);
    if (src) { const i = el('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; a.append(i); }
    else a.append(MPB.placeholder());
    const b = el('span', 'mp-b');
    b.append(el('b', '', priceText(p)), el('span', '', p.address), el('em', '', 'View property'));
    a.append(b);
    return a;
  };

  async function drawMap() {
    const note = $('#mapNote');
    try {
      await loadMapLib();
    } catch (e) {
      S.view = 'grid';
      mapWrap.hidden = true; grid.hidden = false;
      MPB.toast('Sorry, the map could not load. Showing the list instead.');
      apply();
      return;
    }
    if (S.view !== 'map') return;
    if (!map) {
      map = L.map('map', { scrollWheelZoom: false, zoomControl: true }).setView([54.6, -1.6], 8);
      L.tileLayer(MPB.TILES.url, MPB.TILES.options).addTo(map);
      cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 50,
        iconCreateFunction: c => {
          const s = el('span', '', String(c.getChildCount()));
          return L.divIcon({ html: s, className: 'mk-cl', iconSize: [44, 44] });
        }
      }).addTo(map);
      map.on('click', () => map.scrollWheelZoom.enable());
      map.getContainer().addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    }
    map.invalidateSize();
    cluster.clearLayers();
    const pins = F.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number').map(p => {
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: 'mk', html: el('span', '', pinText(p)), iconSize: [0, 0] }),
        title: p.address + ', ' + priceText(p)
      });
      m.bindPopup(() => popup(p), { minWidth: 248, maxWidth: 248, autoPanPadding: [24, 24] });
      return m;
    });
    cluster.addLayers(pins);
    if (pins.length) map.fitBounds(cluster.getBounds().pad(0.12), { maxZoom: 14 });
    $('#resSub').textContent = `${pins.length} on the map`;
    note.textContent = 'Pin positions are approximate. Select a pin to see the property.';
  }

  // ---- Search alerts (lead capture) ----
  const al = $('#al'), alForm = $('#alForm'), alErr = $('#alErr'), alBody = $('#alBody'), alDone = $('#alDone');
  let alBusy = false;
  const searchObj = () => ({
    section: S.section, location: S.q || null, min_price: S.min || null, max_price: S.max || null,
    min_bedrooms: S.beds || null, property_type: S.type || null, include_sold: S.sold, with_360_tour: S.tour
  });
  const searchText = () => {
    const b = BANDS[S.section], bits = [SECTIONS[S.section].noun];
    if (S.q) bits.push('in ' + S.q);
    if (S.min && S.max) bits.push(`${money(S.min)} to ${money(S.max)}${b.unit}`);
    else if (S.min) bits.push('from ' + money(S.min) + b.unit);
    else if (S.max) bits.push('up to ' + money(S.max) + b.unit);
    if (S.beds) bits.push(S.beds + '+ bedrooms');
    if (S.type) bits.push((TYPES.find(t => t[0] === S.type) || [0, S.type])[1].toLowerCase());
    return bits.join(', ');
  };
  function openAlert() {
    alForm.reset();
    $$('[aria-invalid]', alForm).forEach(x => x.removeAttribute('aria-invalid'));
    alErr.textContent = '';
    alBody.hidden = false;
    alDone.hidden = true;
    $('#alTitle').textContent = S.section === 'sales' ? 'Be first to see new homes' : 'Be first to see new lettings';
    $('#alSub').textContent = `We\u2019ll email you when new properties come to market that match: ${searchText()}.`;
    al.showModal();
    $('input[name="email"]', alForm).focus();
    track('mpb_alert_open', { section: S.section });
  }
  alertBtn.addEventListener('click', openAlert);
  al.addEventListener('click', e => { if (e.target === al || e.target.closest('[data-close]')) al.close(); });
  alForm.addEventListener('input', e => { clearInvalid(e); alErr.textContent = ''; });
  alForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (alBusy) return;
    const bad = validate(alForm);
    if (bad) { alErr.textContent = bad.msg; bad.el.focus(); return; }
    let preview = false;
    if (!alForm.elements.company_website.value) {
      const btn = $('#alSubmit');
      alBusy = true; btn.disabled = true; btn.textContent = 'Sending\u2026';
      try {
        const res = await sendLead('alert', {
          source: 'property-search', search: searchObj(), search_text: searchText(), ...collect(alForm),
          consent_statement: $('.ck-t', alForm).textContent.trim()
        });
        preview = res.preview;
        track('mpb_alert_submit', { section: S.section });
      } catch (err) {
        alErr.textContent = 'Sorry, something went wrong. Please try again.';
        return;
      } finally {
        alBusy = false; btn.disabled = false; btn.textContent = 'Set up my alerts';
      }
    }
    $('#alPreview').hidden = !preview;
    alBody.hidden = true;
    alDone.hidden = false;
    alDone.focus();
  });

  // ---- Start ----
  watchImages(document);
  syncFavCount();
  skeleton(6);
  const start = () => loadFeed().then(feed => {
    all = feed.properties.map(p => Object.assign(p, { _p: ' ' + norm(`${p.locality} ${p.hub} ${p.town}`) }));
    const live = all.filter(p => p.status === 'available' || p.status === 'sstc').length;
    const when = ago(feed.generated);
    $('#feedMeta').textContent = `${live} properties available` + (when ? ` \u00b7 Updated ${when}` : '');
    readUrl();
    ready = true;
    syncForm();
    buildNames();
    apply();
  }).catch(() => {
    $('#feedMeta').textContent = 'We could not load the latest listings.';
    const box = el('div', 'empty'), row = el('div', 'row');
    const retry = el('button', 'btn btn-navy', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => { skeleton(6); start(); });
    const live = el('a', 'btn btn-line', 'View on mypropertybox.co.uk');
    live.href = LIVE_URL + S.section; live.target = '_blank'; live.rel = 'noopener';
    row.append(retry, live);
    box.append(icon('i-search'), el('h3', '', 'Properties are taking a moment'), el('p', '', 'Please check your connection and try again.'), row);
    grid.replaceChildren(box);
  });
  start();
})();
