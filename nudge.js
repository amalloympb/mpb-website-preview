/* Soft valuation nudge: a small, dismissable card that appears once per session.
   It only asks for a postcode or town and sends the visitor to the right form.
   Nothing is stored or sent until they submit the form and give consent. */
(() => {
  'use strict';

  const KEY = 'mpb-nudge';
  const COPY = {
    sell: { page: 'sell.html', k: 'Thinking of selling?', h: 'What could your home sell for?', p: 'Get a free, no-obligation valuation from a local expert.', btn: 'Get my valuation' },
    let: { page: 'let.html', k: 'Thinking of letting?', h: 'What could your property rent for?', p: 'Get a free rental appraisal from a local expert.', btn: 'Get my appraisal' },
    landlord: { page: 'landlords.html', k: 'Landlords', h: 'Is your portfolio working hard enough?', p: 'Request a free management review from a local expert.', btn: 'Get my review' }
  };

  const seen = () => {
    try { return !!(sessionStorage.getItem(KEY) || sessionStorage.getItem('mpb-lead-done')); } catch (e) { return false; }
  };
  const mark = () => { try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* storage blocked */ } };
  const log = (name, data) => { if (typeof track === 'function') track(name, data); };

  if (seen()) return;

  const formEl = document.getElementById('get-started');
  let engaged = false;
  if (formEl) formEl.addEventListener('focusin', () => { engaged = true; });

  let node = null, shown = false;
  const start = Date.now();

  const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const blocked = () => engaged || document.querySelector('dialog[open], .lb.open, .lb[aria-hidden="false"]') || (formEl && inView(formEl));

  const build = copy => {
    const el = document.createElement('aside');
    el.className = 'nudge';
    el.setAttribute('aria-label', copy.h);
    el.innerHTML =
      '<button type="button" class="nudge-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '<span class="nudge-k"></span><h3></h3><p></p>' +
      '<form novalidate><label class="fld"><span class="lbl" style="position:absolute;left:-9999px">Property postcode or town</span>' +
      '<span class="inp"><input type="text" name="loc" placeholder="Postcode or town" autocomplete="off" maxlength="60"></span></label>' +
      '<p class="nudge-err" role="alert"></p>' +
      '<button type="submit" class="btn btn-navy"><span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>' +
      '<small>We only use this to point you to the right local team.</small></form>';
    el.querySelector('.nudge-k').textContent = copy.k;
    el.querySelector('h3').textContent = copy.h;
    el.querySelector('p').textContent = copy.p;
    el.querySelector('.btn span').textContent = copy.btn;
    return el;
  };

  const hide = () => {
    if (!node) return;
    const n = node;
    node = null;
    n.classList.remove('in');
    document.body.classList.remove('nudge-open');
    setTimeout(() => n.remove(), 600);
  };

  const show = trigger => {
    if (shown || seen()) return;
    const copy = COPY[document.body.dataset.nudge];
    if (!copy) return;
    if (blocked()) { if (trigger === 'timer') setTimeout(() => show('timer'), 15000); return; }
    shown = true;
    mark();
    node = build(copy);
    if (document.getElementById('ppBar')) node.classList.add('lift');
    document.body.appendChild(node);
    requestAnimationFrame(() => requestAnimationFrame(() => { node.classList.add('in'); document.body.classList.add('nudge-open'); }));
    log('mpb_nudge_view', { trigger, variant: document.body.dataset.nudge });

    const input = node.querySelector('input'), err = node.querySelector('.nudge-err');
    node.querySelector('.nudge-x').addEventListener('click', () => { log('mpb_nudge_dismiss'); hide(); });
    node.addEventListener('keydown', e => { if (e.key === 'Escape') { log('mpb_nudge_dismiss'); hide(); } });
    node.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const loc = input.value.trim();
      if (loc.length < 2) { err.textContent = 'Please enter a postcode or town.'; input.focus(); return; }
      log('mpb_nudge_submit', { variant: document.body.dataset.nudge });
      if (formEl) {
        hide();
        document.dispatchEvent(new CustomEvent('mpb:prefill', { detail: { loc, src: 'nudge' } }));
      } else {
        location.href = copy.page + '?loc=' + encodeURIComponent(loc) + '&src=nudge#get-started';
      }
    });
    input.addEventListener('input', () => { err.textContent = ''; });
  };

  setTimeout(() => show('timer'), 40000);

  // Desktop exit intent, only after the visitor has had a proper look around
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    document.addEventListener('mouseout', e => {
      if (!e.relatedTarget && e.clientY <= 0 && Date.now() - start > 10000) show('exit');
    });
  }
})();
