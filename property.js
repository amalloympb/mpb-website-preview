// Individual property page: gallery, 360 tour, details, cost guides and lead capture.
// Rendered client-side from data/properties.json + data/p/<id>.json (see feed/sync.js).
(() => {
  const { el, icon, money, https, loadFeed, loadDetail, ID_RX, priceParts, priceText, bedsText, statusText, isOff, valuationHref, similar, card, watchImages, placeholder, syncFavs, toast } = MPB;
  const id = new URLSearchParams(location.search).get('id') || '';
  const state = $('#state'), prop = $('#prop');
  const SECTION_LABEL = { sales: 'For sale', lets: 'To let', students: 'Student lets' };
  const TOUR_NAMES = { 'tour.giraffe360.com': 'Giraffe360', 'my.matterport.com': 'Matterport', 'kuula.co': 'Kuula', 'view.ricoh360.com': 'Ricoh360' };
  const scroll = node => node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  const opt = (v, t) => { const o = el('option', '', t); o.value = v; return o; };
  const secKey = p => (p.students ? 'students' : p.section);

  // ---- Head metadata ----
  const meta = (key, content, prop) => {
    const sel = `meta[${prop ? 'property' : 'name'}="${key}"]`;
    let m = $(sel);
    if (!m) { m = document.createElement('meta'); m.setAttribute(prop ? 'property' : 'name', key); document.head.append(m); }
    m.setAttribute('content', content);
  };
  const setSeo = (p, d, photos) => {
    const url = new URL('property.html?id=' + encodeURIComponent(p.id), location.href).href;
    const text = (d.summary || d.description.split('\n\n')[0] || '').replace(/\s+/g, ' ').trim();
    const desc = text.length > 157 ? text.slice(0, 157).replace(/\s+\S*$/, '') + '\u2026' : text
      || `${bedsText(p)} ${p.type || 'property'} ${p.section === 'sales' ? 'for sale' : 'to let'} in ${p.hub || p.town}. View photos and book a viewing.`;
    const title = `${p.address} | ${p.section === 'sales' ? 'For sale' : 'To let'} ${priceText(p)} | My Property Box`;
    document.title = title;
    meta('description', desc);
    $('link[rel=canonical]').href = url;
    meta('og:title', title, true); meta('og:description', desc, true); meta('og:url', url, true); meta('og:type', 'website', true);
    meta('twitter:card', 'summary_large_image');
    if (photos[0]) meta('og:image', photos[0], true);
    const off = isOff(p), ld = {
      '@context': 'https://schema.org', '@type': 'RealEstateListing', name: p.address, url, description: desc, image: photos.slice(0, 6),
      offers: {
        '@type': 'Offer', priceCurrency: 'GBP', availability: off ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        ...(p.section === 'sales' ? { price: p.price || undefined } : { priceSpecification: { '@type': 'UnitPriceSpecification', price: p.price_pcm ?? p.price, priceCurrency: 'GBP', unitCode: 'MON' } })
      },
      about: {
        '@type': 'Residence', numberOfBedrooms: p.beds ?? undefined,
        address: { '@type': 'PostalAddress', streetAddress: p.address, addressLocality: p.town, addressCountry: 'GB' },
        geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng }
      }
    };
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(ld);
    document.head.append(s);
  };

  // ---- Lightbox (photos and floorplans) ----
  const lb = $('#lb'), lbImg = $('#lbImg'), lbErr = $('#lbErr'), lbThumbs = $('#lbThumbs'), lbStage = $('#lbStage');
  let lbItems = [], lbI = 0, lbLabel = '';
  const lbShow = i => {
    const n = lbItems.length;
    lbI = (i + n) % n;
    const it = lbItems[lbI];
    lbErr.hidden = true; lbImg.hidden = false;
    lbImg.src = it.src; lbImg.alt = it.alt;
    $('#lbCount').textContent = `${lbLabel} ${lbI + 1} / ${n}`;
    $$('button', lbThumbs).forEach((b, k) => b.setAttribute('aria-current', k === lbI));
    const cur = $('[aria-current=true]', lbThumbs);
    if (cur) lbThumbs.scrollTo({ left: cur.offsetLeft - lbThumbs.clientWidth / 2 + cur.clientWidth / 2 });
    [lbI + 1, lbI - 1].forEach(k => { const nx = lbItems[(k + n) % n]; if (nx) new Image().src = nx.src; });
  };
  lbImg.addEventListener('error', () => { lbImg.hidden = true; lbErr.hidden = false; });
  const openLb = (items, i, label, kind) => {
    lbItems = items; lbLabel = label;
    lbThumbs.replaceChildren(...(items.length > 1 ? items.map((it, k) => {
      const b = el('button'), im = el('img');
      b.type = 'button'; b.setAttribute('aria-label', `${label} ${k + 1}`);
      im.src = it.src; im.alt = ''; im.loading = 'lazy';
      b.append(im);
      b.addEventListener('click', () => lbShow(k));
      return b;
    }) : []));
    lb.classList.toggle('plans', kind === 'plans');
    $('#lbPrev').hidden = $('#lbNext').hidden = items.length < 2;
    lb.showModal();
    lbShow(i);
    $('#lbNext').hidden || $('#lbNext').focus({ preventScroll: true });
    track('mpb_gallery_open', { kind, id });
  };
  $('#lbPrev').addEventListener('click', () => lbShow(lbI - 1));
  $('#lbNext').addEventListener('click', () => lbShow(lbI + 1));
  lb.addEventListener('keydown', e => {
    if (lbItems.length < 2) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbShow(lbI - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbShow(lbI + 1); }
  });
  lb.addEventListener('click', e => { if (e.target === lb || e.target === lbStage || e.target.closest('[data-close]')) lb.close(); });
  let swipeX = null;
  lbStage.addEventListener('pointerdown', e => { swipeX = e.target.closest('button') ? null : e.clientX; });
  lbStage.addEventListener('pointerup', e => {
    if (swipeX == null || lbItems.length < 2) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 50) lbShow(lbI + (dx < 0 ? 1 : -1));
  });

  // ---- Maps ----
  const loadLeaflet = () => window.L ? Promise.resolve() : new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js'; s.onload = ok; s.onerror = () => fail(new Error('Leaflet failed to load'));
    document.head.append(s);
  });
  const initMap = p => {
    const box = $('#pmap');
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') { $('#mapSec').hidden = true; return; }
    const start = async () => {
      try { await loadLeaflet(); } catch (e) { box.replaceChildren(el('p', 'map-fail', 'The map could not be loaded.')); return; }
      const map = L.map(box, { scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false }).setView([p.lat, p.lng], 15);
      L.tileLayer(MPB.TILES.url, MPB.TILES.options).addTo(map);
      const acc = getComputedStyle(root).getPropertyValue('--acc').trim() || '#2f8f77';
      L.circle([p.lat, p.lng], { radius: 220, color: acc, weight: 2, fillColor: acc, fillOpacity: 0.18 }).addTo(map);
      L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: acc, fillOpacity: 1 }).addTo(map);
      map.on('click', () => map.scrollWheelZoom.enable());
      box.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' });
      io.observe(box);
    } else start();
  };

  // ---- 360 tour ----
  const tourFrame = (url, address) => {
    const f = el('iframe');
    f.src = url;
    f.title = '360\u00b0 virtual tour of ' + address;
    f.setAttribute('allow', 'fullscreen; xr-spatial-tracking; gyroscope; accelerometer');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-pointer-lock');
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    return f;
  };
  const setupTour = (p, d, photos) => {
    $('#tourSec').hidden = false;
    $('#tourBtn').hidden = false;
    const host = new URL(d.tour).hostname, stage = $('#tourStage'), name = TOUR_NAMES[host] || '';
    $('#tourNew').href = $('#tdNew').href = d.tour;
    if (name) $('#tourNote').textContent = `Drag to look around and tap the arrows to move between rooms. Tour by ${name}.`;
    if (photos[0]) { const im = el('img', 'tour-poster'); im.src = photos[0]; im.alt = ''; im.loading = 'lazy'; stage.prepend(im); }

    let live = false;
    const launch = () => {
      if (live) return;
      live = true;
      stage.classList.add('is-live');
      const load = el('p', 'tour-load', 'Loading tour\u2026');
      const f = tourFrame(d.tour, p.address);
      f.addEventListener('load', () => load.remove());
      stage.append(load, f);
      f.focus();
      track('mpb_tour_open', { id, via: 'inline' });
    };
    $('#tourPlay').addEventListener('click', launch);
    const go = () => { scroll($('#tourSec')); setTimeout(launch, reduceMotion ? 0 : 450); };
    $('#tourBtn').addEventListener('click', go);
    $('#barTour').hidden = false;
    $('#barTour').addEventListener('click', go);

    const dlg = $('#tourDlg'), body = $('#tdBody');
    $('#tourFs').addEventListener('click', () => {
      $('#tdTitle').textContent = '360\u00b0 tour \u00b7 ' + p.address;
      body.replaceChildren(tourFrame(d.tour, p.address));
      dlg.showModal();
      track('mpb_tour_open', { id, via: 'fullscreen' });
    });
    dlg.addEventListener('click', e => { if (e.target.closest('[data-close]')) dlg.close(); });
    dlg.addEventListener('close', () => body.replaceChildren());
    return go;
  };

  // ---- Page sections ----
  const crumbs = p => {
    const sk = secKey(p), nav = $('#crumbs'), sep = () => el('span', 'sep', '/');
    const link = (t, h) => { const a = el('a', '', t); a.href = h; return a; };
    nav.replaceChildren(link('Home', 'index.html'), sep(), link(SECTION_LABEL[sk], 'properties.html?section=' + sk));
    if (p.hub) nav.append(sep(), link(p.hub, `properties.html?section=${sk}&q=${encodeURIComponent(p.hub)}`));
    const cur = el('span', '', p.address);
    cur.setAttribute('aria-current', 'page');
    nav.append(sep(), cur);
  };

  const gallery = (p, photos, d, goTour) => {
    const n = photos.length, grid = $('#galGrid'), pills = $('#galPills');
    const items = photos.map((src, i) => ({ src, alt: `${p.address}, photo ${i + 1} of ${n}` }));
    const shown = n >= 5 ? 5 : n === 4 ? 3 : n;
    grid.dataset.n = shown;
    if (!n) {
      const e = el('div', 'gal-empty'); e.append(placeholder());
      grid.append(e);
    }
    photos.slice(0, shown).forEach((src, i) => {
      const b = el('button', 'gal-i' + (i === 0 ? ' main' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', `Open photo ${i + 1} of ${n}`);
      const im = el('img');
      im.src = src; im.alt = ''; im.decoding = 'async';
      if (i) im.loading = 'lazy';
      b.append(im);
      if (i === shown - 1 && n > shown) b.append(el('span', 'gal-more', `+${n - shown} photo${n - shown === 1 ? '' : 's'}`));
      b.addEventListener('click', () => openLb(items, i, 'Photo', 'photos'));
      grid.append(b);
    });
    if (d.tour && n) grid.append(el('span', 'gal-360', '360\u00b0 tour'));
    // If the lead photo cannot load (usually the CRM image host is down) show one tidy placeholder instead of a mosaic of them
    grid.addEventListener('error', e => {
      if (!(e.target instanceof HTMLImageElement)) return;
      const tile = e.target.closest('.gal-i');
      if (tile && tile.classList.contains('main')) {
        grid.dataset.n = 1;
        grid.querySelectorAll('.gal-i').forEach(t => t.remove());
        const empty = el('div', 'gal-empty');
        empty.append(placeholder());
        grid.prepend(empty);
        const first = $('.gal-pill', pills);
        if (first && /^Photos/.test(first.textContent)) first.remove();
      } else e.target.replaceWith(placeholder());
    }, true);

    const pill = (iconId, text, fn) => {
      const b = el('button', 'gal-pill');
      b.type = 'button';
      b.append(icon(iconId), document.createTextNode(text));
      b.addEventListener('click', fn);
      pills.append(b);
    };
    if (n) pill('i-camera', `Photos \u00b7 ${n}`, () => openLb(items, 0, 'Photo', 'photos'));
    if (d.tour) pill('i-360', '360\u00b0 tour', goTour);
    if (d.floorplans.length) pill('i-plan', 'Floorplan', () => scroll($('#planSec')));
    pill('i-map', 'Map', () => scroll($('#mapSec')));
  };

  const header = (p, off) => {
    const sk = secKey(p), pr = priceParts(p), st = $('#ppSt');
    const badge = p.status !== 'available' ? statusText(p) : p.students ? 'Student let' : '';
    if (badge) { st.hidden = false; st.textContent = badge; st.className = 'pp-st st-' + p.status; }
    const price = $('#ppPrice');
    price.replaceChildren();
    if (pr.qual) price.append(el('small', '', pr.qual));
    price.append(el('b', '', pr.main));
    if (pr.unit) price.append(el('span', '', pr.unit));
    if (pr.sub) price.append(el('span', 'pp-sub', pr.sub));
    $('#ppTitle').textContent = p.address;
    const m = $('#ppMeta');
    m.replaceChildren();
    const chip = (i, t) => { const s = el('span'); s.append(icon(i), document.createTextNode(t)); m.append(s); };
    if (p.beds != null) chip('i-bed', bedsText(p));
    if (p.type) chip('i-grid', p.type);
    if (p.hub || p.town) chip('i-pin', p.hub || p.town);
    const w = $('#ppWarn');
    const warn = off ? (p.section === 'sales' ? 'This property has been sold and is no longer available.' : 'This property has been let and is no longer available.')
      : p.status === 'sstc' ? 'This property is sold subject to contract. You can still register your interest in case the sale falls through.'
      : p.status === 'let-agreed' ? 'A tenant has been found. You can still register your interest in case it becomes available again.' : '';
    w.hidden = !warn;
    w.textContent = warn;
    $('#ppFav').dataset.fav = p.id;
    const live = $('#ppLive');
    live.href = https(p.url) || 'https://www.mypropertybox.co.uk/';
    if (p.source === 'rightmove') live.textContent = 'View on Rightmove';
    return sk;
  };

  const facts = p => {
    const rows = [['Bedrooms', p.beds == null ? '' : p.beds === 0 ? 'Studio' : String(p.beds)], ['Property type', p.type], ['Area', p.hub || p.town], ['Status', statusText(p)], ['Reference', p.id]];
    $('#facts').replaceChildren(...rows.filter(r => r[1]).map(([k, v]) => {
      const box = el('div');
      box.append(el('dt', '', k), el('dd', '', v));
      return box;
    }));
  };

  const features = d => {
    if (!d.highlights.length) return;
    $('#featSec').hidden = false;
    $('#feat').replaceChildren(...d.highlights.slice(0, 24).map(t => {
      const li = el('li');
      li.append(icon('i-check'), el('span', '', t.charAt(0).toUpperCase() + t.slice(1)));
      return li;
    }));
  };

  const description = d => {
    const norm = s => s.replace(/\s+/g, ' ').trim();
    let paras = d.description.split(/\n{2,}/).map(norm).filter(Boolean);
    let summaryAdded = false;
    if (d.summary && (!paras.length || !norm(d.description).includes(norm(d.summary).slice(0, 80)))) { paras.unshift(norm(d.summary)); summaryAdded = true; }
    if (!paras.length) return;
    $('#descSec').hidden = false;
    const box = $('#desc');
    const isHead = t => t.length <= 120 && /[A-Z]/.test(t) && t === t.toUpperCase();
    const li = paras.findIndex(t => !isHead(t));
    const leadOk = li >= 0 && (summaryAdded || (paras[li].length < 260 && paras.length > li + 1));
    box.replaceChildren(...paras.map((t, i) => el('p', isHead(t) ? 'pd-sub' : i === li && leadOk ? 'pd-lead' : '', t)));
    const more = $('#descMore');
    if (paras.join(' ').length > 900) {
      box.classList.add('clamp');
      more.hidden = false;
      more.addEventListener('click', () => {
        const open = box.classList.toggle('clamp') === false;
        more.textContent = open ? 'Show less' : 'Read more';
        more.setAttribute('aria-expanded', open);
      });
    }
  };

  const floorplans = (p, d) => {
    if (d.floorplans.length) {
      $('#planSec').hidden = false;
      const items = d.floorplans.map((src, i) => ({ src, alt: `${p.address}, floorplan ${i + 1}` }));
      $('#plan').replaceChildren(...items.slice(0, 4).map((it, i) => {
        const b = el('button', 'pp-plan');
        b.type = 'button';
        b.setAttribute('aria-label', `Open floorplan ${i + 1} full size`);
        const im = el('img');
        im.src = it.src; im.alt = ''; im.loading = 'lazy';
        const cap = el('span');
        cap.append(icon('i-expand'), document.createTextNode('View full size'));
        b.append(im, cap);
        b.addEventListener('click', () => openLb(items, i, 'Floorplan', 'plans'));
        return b;
      }));
    }
    if (d.epc) { $('#epcSec').hidden = false; $('#epcLink').href = d.epc; }
  };

  // ---- Cost guides ----
  const salesCalc = (p, focusEnquiry) => {
    if (!p.price) return;
    $('#calcSales').hidden = false;
    const dep = $('#dep'), term = $('#term'), rate = $('#rate');
    term.replaceChildren(...[10, 15, 20, 25, 30, 35, 40].map(y => opt(y, y + ' years')));
    term.value = '25';
    const update = () => {
      const pc = +dep.value, loan = p.price * (1 - pc / 100), n = +term.value * 12;
      const r = Math.min(Math.max(+rate.value || 0, 0), 15) / 1200;
      const mo = r ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n;
      $('#depV').textContent = `${pc}% (${money(p.price * pc / 100)})`;
      $('#mo').textContent = money(mo);
      $('#moSub').textContent = `per month, borrowing ${money(loan)} over ${term.value} years`;
    };
    [dep, term, rate].forEach(x => x.addEventListener('input', update));
    update();
    $('#mortBtn').addEventListener('click', () => focusEnquiry({ type: 'question', position: 'needs mortgage advice', message: 'I\u2019d like to talk to a mortgage adviser about this property.' }));
  };

  const letsCalc = p => {
    const monthly = p.price_pcm || (p.price_freq === 'pcm' ? p.price : 0);
    if (!monthly) return;
    const weekly = p.price_freq === 'pppw' ? (p.price_pppw ?? p.price) : p.price_freq === 'pw' ? p.price : monthly * 12 / 52;
    const deposit = weekly * 5;
    const rows = [['Monthly rent', money(monthly)], ['Maximum deposit (5 weeks)', money(deposit)], ['Estimated to move in', money(monthly + deposit)]];
    const perPerson = p.students || p.price_freq === 'pppw';
    if (!perPerson) rows.push(['Typical income guide', money(monthly * 30) + ' a year']);
    $('#calcLets').hidden = false;
    $('#cost').replaceChildren(...rows.map(([k, v], i) => {
      const box = el('div', i === 2 ? 'total' : '');
      box.append(el('dt', '', k), el('dd', '', v));
      return box;
    }));
    $('#costNote').textContent = (perPerson ? 'Figures are per person. ' : '') + 'A guide only: the first month\u2019s rent plus a deposit of up to 5 weeks\u2019 rent (the cap under the Tenant Fees Act 2019 in England). ' + (perPerson ? '' : 'The income guide is 30 times the monthly rent. ') + 'Final figures are confirmed by the team before you sign anything.';
  };

  // ---- Enquiry (lead capture) ----
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const enquiry = (p, off, d) => {
    const form = $('#enq'), err = $('#enqErr'), done = $('#enqDone'), sk = secKey(p);
    const reg = p.status === 'sstc' || p.status === 'let-agreed';
    const lead = { property_id: p.id, property_address: p.address, property_section: sk, property_price: priceText(p), property_status: p.status, property_crm: p.source, property_url: p.url, has_360_tour: !!d.tour };

    // Shared: send people who cannot enquire (sold or let) towards a valuation and similar-property alerts
    if (off) {
      $('#enqLive').hidden = true;
      $('#enqOff').hidden = false;
      const sales = p.section === 'sales';
      $('#offKick').textContent = sales ? 'Sold' : 'Let';
      $('#offTitle').textContent = sales ? 'Thinking of selling a home like this?' : 'Own a property you could rent out?';
      $('#offSub').textContent = sales ? 'This property has been sold. Find out what yours is worth with a free, no-obligation valuation from the team that sold it.'
        : 'This property has been let. Find out what yours could earn with a free, no-obligation rental valuation.';
      $('#offVal').href = valuationHref(p, 'sold');
      $('#offVal').addEventListener('click', () => track('mpb_sold_valuation_click', { id }));
      const sim = $('#simForm'), simErr = $('#simErr');
      let simBusy = false;
      sim.addEventListener('input', e => { clearInvalid(e); simErr.textContent = ''; });
      sim.addEventListener('submit', async e => {
        e.preventDefault();
        if (simBusy) return;
        const bad = validate(sim);
        if (bad) { simErr.textContent = bad.msg; bad.el.focus(); return; }
        let preview = false;
        if (!sim.elements.company_website.value) {
          const btn = $('#simSubmit');
          simBusy = true; btn.disabled = true; btn.textContent = 'Sending\u2026';
          try {
            const res = await sendLead('alert', {
              source: 'property-sold', ...lead, search_text: `Similar ${SECTION_LABEL[sk].toLowerCase()} in ${p.hub || p.town}`,
              search: { section: sk, location: p.hub || p.town, category: p.category, beds: p.beds }, ...collect(sim),
              consent_statement: $('.ck-t', sim).textContent.trim()
            });
            preview = res.preview;
            track('mpb_alert_submit', { section: sk, via: 'property' });
          } catch (x) {
            simErr.textContent = 'Sorry, something went wrong. Please try again.';
            return;
          } finally { simBusy = false; btn.disabled = false; btn.textContent = 'Alert me'; }
        }
        $('#simPreview').hidden = !preview;
        sim.hidden = true;
        $('#simDone').hidden = false;
        $('#simDone').focus();
      });
      return () => { scroll($('#enquire')); };
    }

    $('#enqTitle').textContent = reg ? 'Register your interest' : sk === 'sales' ? 'Book a viewing' : 'Request a viewing';
    $('#enqSub').textContent = reg ? 'Leave your details and we\u2019ll contact you if it becomes available again.' : 'Leave your details and a member of the team will be in touch to arrange it.';
    $('#chipA').textContent = reg ? 'Register interest' : sk === 'sales' ? 'Book a viewing' : 'Request a viewing';
    $('#enqSubmit').textContent = reg ? 'Register interest' : 'Send enquiry';
    $('input[name=enquiry_type][value=viewing]', form).value = reg ? 'interest' : 'viewing';
    $('#vDate').min = $('#mDate').min = today();

    const type = () => $('input[name=enquiry_type]:checked', form).value;
    const baseLabel = $('#enqSubmit').textContent;
    let picker = null; // set when live diary times load; otherwise the plain date/time fields stay
    const applyType = () => {
      const slots = !!picker && type() === 'viewing';
      $$('[data-for]', form).forEach(f => {
        const k = f.dataset.for;
        const show = k === 'viewing' ? type() === 'viewing' && !picker : k === 'lets' ? p.section === 'lets' : p.section === 'sales';
        f.hidden = !show;
        $$('input, select', f).forEach(i => { i.disabled = !show; });
      });
      $('#vp').hidden = !slots;
      const chosen = slots && picker.selected();
      $('#enqSubmit').textContent = chosen ? `Request ${chosen.short}` : slots ? 'Request viewing' : baseLabel;
    };
    applyType();
    if (!reg && window.MPBViewing) {
      MPBViewing.load(p.id, { host: $('#vp'), onChange: applyType }).then(pk => {
        if (!pk) return;
        picker = pk;
        $('.pp-side').classList.add('has-vp');
        applyType();
      });
    }
    form.addEventListener('change', e => { if (e.target.name === 'enquiry_type') applyType(); });
    form.addEventListener('input', e => { clearInvalid(e); err.textContent = ''; });
    let opened = false;
    form.addEventListener('focusin', () => { if (!opened) { opened = true; track('mpb_enquiry_open', { id, section: sk }); } });

    let busy = false;
    const previewTxt = $('#enqPreview').textContent;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      const slotMode = !!picker && type() === 'viewing';
      const chosen = slotMode ? picker.selected() : null;
      if (slotMode && !chosen) {
        err.textContent = 'Please choose a day and time for your viewing.';
        $('#vp').scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        return;
      }
      const bad = validate(form);
      if (bad) { err.textContent = bad.msg; bad.el.focus(); return; }
      const vd = form.elements.viewing_date, md = form.elements.move_in_date;
      const past = [vd, md].find(x => x && !x.disabled && x.value && x.value < today());
      if (past) { err.textContent = 'Please choose a date that is today or later.'; past.focus(); return; }
      const data = collect(form);
      let preview = false, booked = null;
      if (!form.elements.company_website.value) {
        busy = true;
        const btn = $('#enqSubmit'), label = btn.textContent;
        btn.disabled = true; btn.textContent = 'Sending\u2026';
        try {
          if (slotMode) {
            const { name, email, phone, message, buyer_position, occupants, move_in_date } = data;
            booked = await picker.book({ name, email, phone, message, buyer_position, occupants, move_in_date, consent: true, consent_statement: $('.ck-t', form).textContent.trim() });
            preview = !!booked.demo;
            track('mpb_viewing_request', { id, section: sk, mode: booked.demo ? 'demo' : 'live' });
          } else {
            const res = await sendLead('enquiry', { source: 'property-page', ...lead, ...data, consent_statement: $('.ck-t', form).textContent.trim() });
            preview = res.preview;
            track('mpb_enquiry_submit', { id, section: sk, enquiry_type: data.enquiry_type });
          }
        } catch (x) {
          err.textContent = x.code === 'taken' ? 'Sorry, that time has just been taken. Please choose another.'
            : x.code === 'rate' ? 'You have made a few requests in a short time. Please try again shortly.'
            : 'Sorry, something went wrong. Please try again.';
          return;
        } finally { busy = false; btn.disabled = false; btn.textContent = label; if (slotMode) applyType(); }
      }
      const first = (data.name || '').split(/\s+/)[0].slice(0, 30);
      $('#doneH').textContent = first ? `Thank you, ${first}` : 'Thank you';
      $('#doneP').textContent = chosen ? `We\u2019ve requested a viewing of ${p.address} on ${chosen.long}.${booked ? ` Your reference is ${booked.ref}.` : ''} A member of the team will confirm it with you shortly.`
        : data.enquiry_type === 'viewing' ? `We\u2019ve received your viewing request for ${p.address}. A member of the team will be in touch to confirm a time.`
        : data.enquiry_type === 'interest' ? 'We\u2019ve registered your interest and will contact you if this property becomes available again.'
        : 'We\u2019ve got your question and a member of the team will reply shortly.';
      $('#doneVal').href = valuationHref(p, 'property');
      $('#enqPreview').textContent = booked && booked.demo ? 'Demo mode: these times are sample data, and the request was only recorded on this test server, not sent to the team.' : previewTxt;
      $('#enqPreview').hidden = !preview;
      form.hidden = true;
      $('#enqKick').hidden = $('#enqTitle').hidden = $('#enqSub').hidden = true;
      done.hidden = false;
      done.focus();
      if (matchMedia('(max-width: 900px)').matches) done.scrollIntoView({ block: 'center' });
    });

    // Opens the form from elsewhere on the page (mobile bar, mortgage button)
    return (o = {}) => {
      if (o.type) { const r = $(`input[name=enquiry_type][value=${o.type}]`, form) || $('input[name=enquiry_type]', form); r.checked = true; applyType(); }
      if (o.position && form.elements.buyer_position) form.elements.buyer_position.value = o.position;
      if (o.message && !form.elements.message.value) form.elements.message.value = o.message;
      scroll($('#enquire'));
      if (!form.hidden) setTimeout(() => (picker && type() === 'viewing' ? $('.vp-day input:checked', form) || form.elements.name : form.elements.name).focus({ preventScroll: true }), reduceMotion ? 0 : 450);
    };
  };

  // ---- Page-level pieces ----
  const share = p => {
    $('#ppShare').addEventListener('click', async () => {
      const data = { title: p.address, text: `${priceText(p)} \u00b7 ${p.address}`, url: location.href.split('#')[0] };
      try {
        if (navigator.share) { await navigator.share(data); track('mpb_share', { id, via: 'native' }); return; }
      } catch (e) { if (e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(data.url); toast('Link copied to clipboard'); track('mpb_share', { id, via: 'copy' }); }
      catch (e) { toast('Copy the link from your address bar to share'); }
    });
    $('#ppPrint').addEventListener('click', () => window.print());
  };

  const bar = (p, off, focusEnquiry) => {
    const b = $('#ppBar'), pr = priceParts(p);
    $('#barPrice').replaceChildren(...[pr.qual && el('small', '', pr.qual), el('b', '', pr.main + (pr.unit ? ' ' + pr.unit : ''))].filter(Boolean));
    const btn = $('#barBtn');
    btn.textContent = off ? 'Free valuation' : p.status === 'sstc' || p.status === 'let-agreed' ? 'Register interest' : 'Book a viewing';
    btn.addEventListener('click', () => (off ? (location.href = valuationHref(p, 'sold')) : focusEnquiry()));
    b.hidden = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => b.classList.toggle('away', e.isIntersecting), { threshold: 0.1 }).observe($('#enquire'));
    }
  };

  const bottom = (p, off, feed, sk) => {
    const sims = similar(p, feed.properties, 3);
    if (sims.length) {
      $('#sim').replaceChildren(...sims.map(card));
      $('#simAll').href = `properties.html?section=${sk}` + (p.hub ? '&q=' + encodeURIComponent(p.hub) : '');
      $('#simSec').hidden = false;
    }
    const area = p.hub || p.town || 'your area', selling = p.section === 'sales';
    $('#ctaKick').textContent = selling ? 'Thinking of selling?' : 'Own a property to let?';
    $('#ctaH').textContent = selling ? `What is your ${area} home worth?` : `Landlord in ${area}? See what you could earn.`;
    $('#ctaBtn').href = valuationHref(p, off ? 'sold' : 'property');
    $('#ctaBtn').addEventListener('click', () => track('mpb_property_cta', { id }));
    $('#ppCta').hidden = false;
  };

  // ---- States ----
  const showState = (title, text, buttons) => {
    state.removeAttribute('aria-busy');
    const box = el('div', 'empty pp-empty'), row = el('div', 'row');
    box.append(icon('i-search'), el('h3', '', title), el('p', '', text));
    buttons.forEach(([t, href, cls]) => { const a = el('a', 'btn ' + cls, t); a.href = href; row.append(a); });
    box.append(row);
    state.replaceChildren(box);
  };
  const notFound = () => {
    document.title = 'Property not found | My Property Box';
    meta('robots', 'noindex');
    showState('We couldn\u2019t find that property', 'It may have been removed, or the link may be out of date. Search our latest properties or ask us for a valuation.',
      [['Search properties', 'properties.html', 'btn-navy'], ['Free valuation', 'index.html#valuation', 'btn-line']]);
  };
  const loadError = () => showState('Property details are taking a moment', 'Please check your connection and try again.',
    [['Try again', location.href, 'btn-navy'], ['Search properties', 'properties.html', 'btn-line']]);

  // ---- Start ----
  const render = (p, d, feed) => {
    const off = isOff(p), photos = d.photos.length ? d.photos : (https(p.photo) ? [https(p.photo)] : []);
    document.body.dataset.nudge = p.section === 'sales' ? 'sell' : 'let';
    setSeo(p, d, photos);
    crumbs(p);
    const sk = header(p, off);
    state.hidden = true;
    prop.hidden = false;
    let goTour = () => {};
    if (d.tour) goTour = setupTour(p, d, photos);
    gallery(p, photos, d, goTour);
    facts(p); features(d); description(d); floorplans(p, d);
    const focusEnquiry = enquiry(p, off, d);
    if (p.section === 'sales') salesCalc(p, focusEnquiry); else letsCalc(p);
    initMap(p);
    share(p);
    bar(p, off, focusEnquiry);
    bottom(p, off, feed, sk);
    watchImages(document);
    syncFavs(prop);
    track('mpb_property_view', { id, section: sk, status: p.status, has_tour: !!d.tour });
  };

  (async () => {
    if (!ID_RX.test(id)) return notFound();
    let feed;
    try { feed = await loadFeed(); } catch (e) { return loadError(); }
    const p = feed.byId.get(id);
    if (!p) return notFound();
    let d;
    try { d = await loadDetail(id); }
    catch (e) { d = { photos: [], floorplans: [], highlights: [], summary: '', description: '', tour: '', epc: '' }; }
    render(p, d, feed);
  })();
})();
