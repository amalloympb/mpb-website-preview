// Landing pages (Sell, Let, Landlord Services): two-step lead form, area chips, floating CTA and reveals.
// Relies on common.js for $, $$, validate, collect, sendLead, track and coverArea.
const nav = $('#nav'), progress = $('#progress'), fab = $('#fab');
const form = $('#get-started');
const panes = $$('.wz-pane', form), nextBtn = $('[data-next]', form), nextTxt = $('[data-next-txt]', form);
const backBtn = $('[data-back]', form), errEl = $('[data-err]', form), doneEl = $('[data-done]', form);
const locEl = form.elements.location, coverEl = $('[data-cover]', form);
const intent = form.dataset.intent, source = form.dataset.source;
let step = 0, busy = false, started = false;

const FINAL = intent === 'sell' ? 'Get my free valuation' : intent === 'let' ? 'Get my free rental appraisal' : 'Get my free management review';
const DONE_WHAT = {
  sell: 'to arrange your free valuation',
  let: 'to arrange your free rental appraisal',
  manage: 'to talk through your property management options'
};
const DONE_VIA = { phone: 'by phone', email: 'by email', text: 'by text message' };

const syncCover = () => {
  const area = locEl.value.trim() ? coverArea(locEl.value) : '';
  coverEl.textContent = area ? `\u2713 Great news \u2014 we have local experts covering ${area}.` : '';
  coverEl.classList.toggle('ok', !!area);
};

const show = (n, focus = true) => {
  step = Math.min(Math.max(n, 0), panes.length - 1);
  panes.forEach((p, i) => { p.hidden = i !== step; });
  $('[data-step-txt]', form).textContent = `Step ${step + 1} of ${panes.length}`;
  $('[data-bar]', form).style.width = (step + 1) / panes.length * 100 + '%';
  backBtn.hidden = step === 0;
  nextTxt.textContent = step < panes.length - 1 ? 'Continue' : FINAL;
  errEl.textContent = '';
  if (focus) $('h3', panes[step]).focus({ preventScroll: true });
};

const toForm = () => {
  if (form.getBoundingClientRect().top < 80 || form.getBoundingClientRect().top > innerHeight * 0.6) {
    form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
};

const showDone = (preview, d) => {
  const first = (d.name || '').split(/\s+/)[0];
  $('[data-done-title]', form).textContent = first ? `Thank you, ${first}` : 'Thank you';
  $('[data-done-msg]', form).textContent = `We've got your details, and a local expert will be in touch ${DONE_VIA[d.contact_pref] || ''} ${DONE_WHAT[intent]}.`.replace(/\s+/g, ' ').replace(' .', '.');
  $('[data-preview]', form).hidden = !preview;
  form.classList.add('is-done');
  doneEl.hidden = false;
  doneEl.focus({ preventScroll: true });
  try { sessionStorage.setItem('mpb-lead-done', '1'); } catch (e) {}
};

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (busy) return;
  const bad = validate(panes[step]);
  if (bad) { errEl.textContent = bad.msg; bad.el.focus(); return; }
  if (step < panes.length - 1) {
    track('mpb_lead_step', { step: step + 1, intent, source });
    show(step + 1);
    toForm();
    return;
  }
  const d = collect(form);
  if (form.elements.company_website.value) { showDone(false, d); return; }
  busy = true;
  nextBtn.disabled = true;
  nextTxt.textContent = 'Sending\u2026';
  try {
    const res = await sendLead('valuation', { ...d, source: form.dataset.source, consent_statement: $('.ck-t', panes[panes.length - 1]).textContent.trim() });
    track('mpb_lead_submit', { intent, source: form.dataset.source });
    showDone(res.preview, d);
  } catch (err) {
    errEl.textContent = 'Sorry, something went wrong sending your request. Please try again.';
  } finally {
    busy = false;
    nextBtn.disabled = false;
    if (!form.classList.contains('is-done')) nextTxt.textContent = step < panes.length - 1 ? 'Continue' : FINAL;
  }
});

backBtn.addEventListener('click', () => show(step - 1));
form.addEventListener('input', e => {
  clearInvalid(e);
  errEl.textContent = '';
  if (e.target === locEl) syncCover();
});
form.addEventListener('change', clearInvalid);
form.addEventListener('focusin', () => {
  if (started) return;
  started = true;
  track('mpb_lead_start', { intent, source });
});

// Pre-fill the location (area chips, ?loc=, or the soft nudge) and bring the form into view
const prefill = (loc, src) => {
  if (loc) { locEl.value = loc.slice(0, 60); syncCover(); }
  if (src) form.dataset.source = form.dataset.source.split(':')[0] + ':' + src;
  toForm();
  setTimeout(() => (loc && step === 0 ? $('select, input:not([type=hidden])', panes[0]) : locEl).focus({ preventScroll: true }), 450);
};
$$('[data-area]').forEach(b => b.addEventListener('click', () => { locEl.value = b.dataset.area; syncCover(); toForm(); setTimeout(() => locEl.focus({ preventScroll: true }), 450); }));
document.addEventListener('mpb:prefill', e => prefill(e.detail && e.detail.loc, e.detail && e.detail.src));
{
  const q = new URLSearchParams(location.search), loc = q.get('loc'), src = (q.get('src') || '').toLowerCase();
  if (loc) { locEl.value = loc.slice(0, 60); syncCover(); }
  if (/^[a-z0-9_-]{1,24}$/.test(src)) form.dataset.source = form.dataset.source.split(':')[0] + ':' + src;
}
show(0, false);
syncCover();

// One rAF-throttled scroll handler: nav, progress bar and the floating call to action
const cta = $('.lp-cta');
const inView = (el, vh) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; };
let ticking = false;
const onScroll = () => {
  ticking = false;
  const y = scrollY, vh = innerHeight, max = document.documentElement.scrollHeight - vh;
  nav.classList.toggle('solid', y > 30);
  progress.style.transform = `scaleX(${max > 0 ? Math.min(y / max, 1) : 0})`;
  fab.classList.toggle('show', y > vh * 0.7 && !inView(form, vh) && !(cta && inView(cta, vh)) && !form.classList.contains('is-done'));
};
const requestScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } };
onScroll();
addEventListener('scroll', requestScroll, { passive: true });
addEventListener('resize', requestScroll);

// Scroll reveals with a small stagger inside grids
const targets = $$('.sec-head, .lp-benefits article, .steps li, .lp-magnet, .lp-faq details, .lp-areas, .lp-areas-note, .stats-grid > div, .creds');
targets.forEach(el => {
  el.classList.add('reveal');
  const sibs = [...el.parentElement.children].filter(c => targets.includes(c));
  el.style.setProperty('--d', Math.min(sibs.indexOf(el), 5) * 0.08 + 's');
});
const io = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  en.target.classList.add('in');
  io.unobserve(en.target);
}), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
targets.forEach(el => io.observe(el));

// Pointer glow on the hero and cards
if (finePointer && !reduceMotion) {
  const hero = $('.hero');
  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty('--mx', (e.clientX - r.left) / r.width * 100 + '%');
    hero.style.setProperty('--my', (e.clientY - r.top) / r.height * 100 + '%');
  });
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('.lp-benefits article, .steps li');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--x', e.clientX - r.left + 'px');
    el.style.setProperty('--y', e.clientY - r.top + 'px');
  }, { passive: true });
}

$('#yr').textContent = new Date().getFullYear();
track('mpb_landing_view', { intent, source });
