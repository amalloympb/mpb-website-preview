// Town and area pages: live local listings, a one-step lead form, floating CTA and reveals.
// Relies on common.js ($, $$, validate, collect, sendLead, track, clearInvalid, coverArea, reduceMotion) and listing.js (MPB).
(() => {
  const nav = $('#nav'), progress = $('#progress'), fab = $('#fab'), form = $('#get-started');
  const DONE_VIA = { phone: 'by phone', email: 'by email', text: 'by text message' };
  const LABEL = { sell: 'Get my free valuation', let: 'Get my free rental appraisal', manage: 'Get my free management review' };
  const WHAT = { sell: 'to arrange your free valuation', let: 'to arrange your free rental appraisal', manage: 'to talk through your property management options' };

  if (form) {
    const err = $('[data-err]', form), done = $('[data-done]', form);
    const btn = $('[data-next]', form), btnTxt = $('[data-next-txt]', form);
    const locEl = form.elements.location, coverEl = $('[data-cover]', form);
    const intent = () => form.elements.intent.value;
    let busy = false, started = false;

    const syncCover = () => {
      const area = locEl.value.trim() ? coverArea(locEl.value) : '';
      coverEl.textContent = area ? `\u2713 Great news \u2014 we have local experts covering ${area}.` : '';
      coverEl.classList.toggle('ok', !!area);
    };
    const syncLabel = () => { btnTxt.textContent = LABEL[intent()]; };

    const setIntent = v => {
      const r = $(`input[name=intent][value=${v}]`, form);
      if (!r) return;
      r.checked = true;
      syncLabel();
    };

    form.addEventListener('change', e => {
      clearInvalid(e);
      if (e.target.name === 'intent') syncLabel();
    });
    form.addEventListener('input', e => {
      clearInvalid(e);
      err.textContent = '';
      if (e.target === locEl) syncCover();
    });
    form.addEventListener('focusin', () => {
      if (started) return;
      started = true;
      track('mpb_lead_start', { intent: intent(), source: form.dataset.source });
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      const bad = validate(form);
      if (bad) { err.textContent = bad.msg; bad.el.focus(); return; }
      const d = collect(form);
      const showDone = preview => {
        const first = (d.name || '').split(/\s+/)[0];
        $('[data-done-title]', form).textContent = first ? `Thank you, ${first}` : 'Thank you';
        $('[data-done-msg]', form).textContent = `We've got your details, and ${form.dataset.office ? `your local ${form.dataset.office} team` : 'a local expert'} will be in touch ${DONE_VIA[d.contact_pref] || ''} ${WHAT[d.intent]}.`.replace(/\s+/g, ' ');
        $('[data-preview]', form).hidden = !preview;
        form.classList.add('is-done');
        done.hidden = false;
        done.focus({ preventScroll: true });
        try { sessionStorage.setItem('mpb-lead-done', '1'); } catch (x) {}
      };
      if (form.elements.company_website.value) { showDone(false); return; }
      busy = true;
      btn.disabled = true;
      btnTxt.textContent = 'Sending\u2026';
      try {
        const res = await sendLead('valuation', {
          ...d,
          ...(form.dataset.town ? { town: form.dataset.town } : {}),
          ...(form.dataset.office ? { office: form.dataset.office } : {}),
          source: form.dataset.source,
          consent_statement: $('.ck-t', form).textContent.trim()
        });
        track('mpb_lead_submit', { intent: d.intent, source: form.dataset.source });
        showDone(res.preview);
      } catch (x) {
        err.textContent = 'Sorry, something went wrong sending your request. Please try again.';
      } finally {
        busy = false;
        btn.disabled = false;
        if (!form.classList.contains('is-done')) syncLabel();
      }
    });

    // Links like <a href="#get-started" data-set="let"> pre-select Sell or Let and bring the form into view
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-set]');
      if (!a) return;
      setIntent(a.dataset.set);
      track('mpb_town_cta', { intent: a.dataset.set, source: form.dataset.source });
      setTimeout(() => $('input[name=name]', form).focus({ preventScroll: true }), 450);
    });

    syncCover();
    syncLabel();
    track('mpb_landing_view', { intent: 'town', source: form.dataset.source });
  }

  // Live local listings
  const blocks = $$('[data-listings]');
  if (blocks.length && typeof MPB !== 'undefined') {
    const { el, loadFeed, card, watchImages, inSection, norm } = MPB;
    const root = $('#tnLive');
    const names = (root.dataset.match || '').split('|').filter(Boolean).map(norm);
    const town = root.dataset.town, q = root.dataset.q;
    const here = p => !names.length || names.includes(norm(p.hub)) || names.includes(norm(p.town));
    const isLive = p => p.status === 'available' || p.status === 'sstc';

    const skeleton = grid => grid.replaceChildren(...Array.from({ length: 3 }, () => {
      const a = el('article', 'pc sk'), b = el('div', 'pc-body');
      a.setAttribute('aria-hidden', 'true');
      const lines = [el('i'), el('i'), el('i')];
      lines[0].style.width = '45%'; lines[1].style.width = '85%'; lines[2].style.width = '60%';
      b.append(...lines);
      a.append(el('div', 'pc-img'), b);
      return a;
    }));
    blocks.forEach(b => { const g = $('.pg-grid', b); watchImages(g); skeleton(g); });

    const NONE = {
      sales: { what: 'for sale', ask: 'Thinking of selling?', set: 'sell' },
      lets: { what: 'to let', ask: 'Thinking of letting?', set: 'let' },
      students: { what: 'available', ask: 'Own a student property?', set: 'let' }
    };
    const empty = (s, grid) => {
      const box = el('div', 'empty'), row = el('div', 'row'), n = NONE[s];
      const all = el('a', 'btn btn-navy', 'Search all properties');
      all.href = 'properties.html?section=' + s;
      const val = el('a', 'btn btn-line', n.ask);
      val.href = '#get-started';
      val.dataset.set = n.set;
      row.append(all, val);
      box.append(el('h3', '', `Nothing ${n.what}${town ? ' in ' + town : ''} right now`), el('p', '', 'New properties are added all the time. Search all of our listings, or tell us what you are looking for and we will let you know first.'), row);
      grid.replaceChildren(box);
    };

    loadFeed().then(feed => {
      const counts = {};
      blocks.forEach(b => {
        const s = b.dataset.listings, grid = $('.pg-grid', b), all = $('.tn-all', b);
        const live = feed.properties.filter(p => inSection(p, s) && isLive(p) && here(p));
        counts[s] = live.length;
        all.href = `properties.html?section=${s}${q ? '&q=' + encodeURIComponent(q) : ''}`;
        all.textContent = live.length ? `View all ${live.length} \u2192` : 'Search all properties \u2192';
        if (!live.length) { empty(s, grid); return; }
        const pool = live.filter(p => p.status === 'available').sort((a, c) => a.rank - c.rank);
        const withPhoto = pool.filter(p => p.photo), rest = pool.filter(p => !p.photo);
        const items = [...withPhoto, ...rest, ...live.filter(p => p.status !== 'available')].slice(0, 3);
        grid.replaceChildren(...items.map(card));
      });
      const tours = feed.properties.filter(p => inSection(p, 'sales') && isLive(p) && here(p) && p.has_tour).length;
      const strip = $('#tnStats');
      if (strip) {
        const set = (k, v, small) => { const c = $(`[data-stat=${k}]`, strip); $('b', c).textContent = v; c.classList.toggle('tn-word', /\D/.test(v)); if (small) $('small', c).textContent = small; };
        if (counts.sales) set('sales', String(counts.sales)); else set('sales', 'Sales', `Free valuations in ${town}`);
        if (counts.lets) set('lets', String(counts.lets)); else set('lets', 'Lettings', `Free rental appraisals in ${town}`);
        if (tours) set('third', String(tours), tours === 1 ? 'Sale with a 360\u00b0 virtual tour' : 'Sales with 360\u00b0 virtual tours');
        strip.hidden = false;
      }
    }).catch(() => {
      blocks.forEach(b => {
        const grid = $('.pg-grid', b), box = el('div', 'empty'), row = el('div', 'row');
        const a = el('a', 'btn btn-navy', 'Search all properties');
        a.href = 'properties.html?section=' + b.dataset.listings;
        row.append(a);
        box.append(el('h3', '', 'We could not load the listings'), el('p', '', 'Please try again in a moment, or search all of our properties.'), row);
        grid.replaceChildren(box);
      });
    });
  }

  // One rAF-throttled scroll handler: nav, progress bar and the floating call to action
  const quiet = $$('#get-started, .tn-quiet');
  const inView = (n, vh) => { const r = n.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; };
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = scrollY, vh = innerHeight, max = document.documentElement.scrollHeight - vh;
    nav.classList.toggle('solid', y > 30);
    progress.style.transform = `scaleX(${max > 0 ? Math.min(y / max, 1) : 0})`;
    if (fab) fab.classList.toggle('show', y > vh * 0.7 && !quiet.some(n => inView(n, vh)) && !(form && form.classList.contains('is-done')));
  };
  const requestScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } };
  onScroll();
  addEventListener('scroll', requestScroll, { passive: true });
  addEventListener('resize', requestScroll);

  // Scroll reveals with a small stagger inside grids
  const targets = $$('.sec-head, .lp-benefits article, .tn-card, .lp-faq details, .lp-magnet, .lp-areas');
  targets.forEach(n => {
    n.classList.add('reveal');
    const sibs = [...n.parentElement.children].filter(c => targets.includes(c));
    n.style.setProperty('--d', Math.min(sibs.indexOf(n), 5) * 0.08 + 's');
  });
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    en.target.classList.add('in');
    io.unobserve(en.target);
  }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(n => io.observe(n));

  $('#yr').textContent = new Date().getFullYear();
})();
