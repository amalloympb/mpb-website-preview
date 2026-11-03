const nav = $('#nav');

// One rAF-throttled scroll handler: nav, progress bar, floating CTA
const progress = $('#progress'), fab = $('#fab'), toolsEl = $('#tools'), wizEl = $('#valuation');
let ticking = false;
const inView = (el, vh) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; };
const onScroll = () => {
  ticking = false;
  const y = window.scrollY, vh = window.innerHeight;
  const max = document.documentElement.scrollHeight - vh;
  nav.classList.toggle('solid', y > 30);
  progress.style.transform = `scaleX(${max > 0 ? Math.min(y / max, 1) : 0})`;
  fab.classList.toggle('show', y > vh * 0.8 && y < max - 500 && !inView(toolsEl, vh) && !inView(wizEl, vh));
};
const requestScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } };
onScroll();
window.addEventListener('scroll', requestScroll, { passive: true });
window.addEventListener('resize', requestScroll);

// Hero form: the button label follows the chosen intent (submit is handled with the lead wizard below)
const heroForm = $('#heroForm'), goTxt = $('#goTxt');
heroForm.addEventListener('change', e => {
  if (e.target.name === 'intent') goTxt.textContent = e.target.value === 'let' ? 'Free appraisal' : 'Free valuation';
});

$$('.quick button[data-loc]').forEach(b => b.addEventListener('click', () => {
  const loc = $('#loc');
  loc.value = b.dataset.loc;
  loc.focus();
}));

// Scroll reveals with a small stagger inside grids
const targets = $$('.sec-head, .tabs, .svc, .svc-more a, .steps li, .how-grid > *, .linkrow, .area-list li, .wz-grid > *, .split > *, .stats-grid > div, .creds, .cta .wrap');
targets.forEach(el => {
  el.classList.add('reveal');
  const siblings = [...el.parentElement.children].filter(c => c.classList.contains('reveal') || targets.includes(c));
  el.style.setProperty('--d', Math.min(siblings.indexOf(el), 5) * 0.08 + 's');
});

const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    en.target.classList.add('in');
    io.unobserve(en.target);
    $$('[data-count]', en.target).forEach(countUp);
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
targets.forEach(el => io.observe(el));

function countUp(el) {
  const end = +el.dataset.count;
  if (reduceMotion) return;
  const t0 = performance.now(), dur = 900, from = Math.floor(end * 0.6);
  const tick = now => {
    const p = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(from + (end - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Pointer effects: hero glow + 3D tile tilt, and a cursor-following glow on cards
if (finePointer && !reduceMotion) {
  const hero = $('.hero'), art = $('#art');
  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    hero.style.setProperty('--mx', px * 100 + '%');
    hero.style.setProperty('--my', py * 100 + '%');
    art.style.setProperty('--rx', 10 - (py - 0.5) * 14 + 'deg');
    art.style.setProperty('--ry', -16 + (px - 0.5) * 20 + 'deg');
  });
  hero.addEventListener('pointerleave', () => {
    ['--rx', '--ry'].forEach(p => art.style.removeProperty(p));
  });

  // Delegated so the glow works for every card without per-element listeners
  const GLOW = '.svc, .svc-more a, .wz-opt, .steps li, .area-list a';
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest(GLOW);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--x', e.clientX - r.left + 'px');
    el.style.setProperty('--y', e.clientY - r.top + 'px');
  }, { passive: true });
}

// Toolkit: persona tabs, live calculators, compliance checklist
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const fmts = {
  gbp: v => gbp.format(Math.round(v)),
  pct: v => v.toFixed(1) + '%',
  pct0: v => Math.round(v) + '%'
};
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// England SDLT (residential): standard, first-time buyer (<= £500k) and the 5% additional-property surcharge
const sdlt = (price, type) => {
  const bands = type === 'ftb' && price <= 500000
    ? [[300000, 0], [500000, .05]]
    : [[125000, 0], [250000, .02], [925000, .05], [1500000, .1], [Infinity, .12]];
  let tax = 0, prev = 0;
  for (const [cap, rate] of bands) {
    if (price > prev) tax += (Math.min(price, cap) - prev) * rate;
    prev = cap;
  }
  if (type === 'extra' && price >= 40000) tax += price * .05;
  return tax;
};
const repay = (loan, rate, years) => {
  const n = years * 12, r = rate / 1200;
  if (loan <= 0 || n <= 0) return 0;
  return r ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n;
};
const ratio = (a, b) => b > 0 ? a / b * 100 : NaN;

const calcs = {
  vendor: v => {
    const fee = v.price * v.fee / 100, costs = fee + v.legal + v.other;
    const net = v.price - v.mortgage - costs;
    const bm = clamp(ratio(v.mortgage, v.price) || 0, 0, 100);
    const bc = clamp(ratio(costs, v.price) || 0, 0, 100 - bm);
    return { net, keep: ratio(net, v.price), fee, other: v.legal + v.other, mortgage: v.mortgage, bm, bc, bt: 100 - bm - bc };
  },
  landlord: v => {
    const annual = v.rent * 12, collected = annual * (1 - clamp(v.void, 0, 52) / 52);
    const running = collected * (v.mgmt + v.maint) / 100;
    const net = collected - running - v.costs;
    return { net, monthly: net / 12, collected, running, gross: ratio(annual, v.value), nety: ratio(net, v.value), after: (net - v.mortgage * 12) / 12 };
  },
  tenant: v => {
    const people = Math.max(1, Math.round(v.people));
    const annual = v.unit === 'pppw' ? v.rent * people * 52 : v.rent * 12;
    const weeks = annual >= 50000 ? 6 : 5;
    const monthly = annual / 12, weekly = annual / 52, share = monthly / people;
    const deposit = weekly * weeks, needed = share * 30;
    let verdict = '';
    if (v.income > 0 && needed > 0) verdict = v.income >= needed
      ? '\u2713 Your income meets the typical standard.'
      : 'Below the typical standard \u2014 a UK guarantor may help.';
    return { needed, verdict, monthly, share, deposit, depnote: `(${weeks} weeks)`, holding: weekly, movein: (monthly + deposit) / people };
  },
  buyer: v => {
    const stamp = sdlt(v.price, v.type), loan = Math.max(0, v.price - v.deposit);
    return {
      monthly: repay(loan, v.rate, v.term), loan, ltv: ratio(loan, v.price), stamp, dep: v.deposit, costs: v.costs,
      cash: v.deposit + stamp + v.costs,
      note: v.type === 'ftb' && v.price > 500000 ? 'First-time buyer relief doesn\u2019t apply above \u00a3500,000.' : ''
    };
  },
  investor: v => {
    const annual = v.mode === 'hmo' ? v.rooms * v.pw * 52 : v.rent * 12;
    const collected = annual * (1 - clamp(v.void, 0, 52) / 52);
    const net = collected - collected * (v.mgmt + v.maint) / 100 - v.costs;
    const deposit = v.price * clamp(v.dep, 0, 100) / 100, loan = v.price - deposit, stamp = sdlt(v.price, 'extra');
    const mortgage = v.mtype === 'rep' ? repay(loan, v.rate, 25) * 12 : loan * v.rate / 100;
    const cash = deposit + stamp + v.buy, flow = net - mortgage;
    return { flow: flow / 12, flowYr: flow, cash, stamp, gross: ratio(annual, v.price), nety: ratio(net, v.price), coc: ratio(flow, cash), icr: ratio(annual, loan * .055) };
  }
};

const readForm = form => {
  const v = {};
  [...form.elements].forEach(el => {
    if (!el.name || (el.type === 'radio' && !el.checked)) return;
    v[el.name] = el.tagName === 'SELECT' || el.type === 'radio' ? el.value : Math.max(parseFloat(el.value) || 0, 0);
  });
  return v;
};

const tween = (el, to, f) => {
  cancelAnimationFrame(el._raf);
  if (!isFinite(to)) { el.textContent = '\u2013'; el._v = undefined; return; }
  const from = el._v === undefined ? to : el._v;
  el._v = to;
  if (reduceMotion || from === to) { el.textContent = f(to); return; }
  const t0 = performance.now();
  const step = now => {
    const p = Math.min((now - t0) / 380, 1);
    el.textContent = f(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
};

$$('form.calc').forEach(form => {
  const fn = calcs[form.dataset.calc], outs = $$('[data-out]', form), sr = $('[data-sr]', form);
  const head = $('.out-head', form), big = $('.out-big', form);
  let timer = 0;
  const run = () => {
    const r = fn(readForm(form));
    outs.forEach(el => {
      const val = r[el.dataset.out], kind = el.dataset.fmt;
      if (kind === 'text') { el.textContent = val; return; }
      if (kind === 'bar') { el.style.width = val + '%'; return; }
      tween(el, val, fmts[kind]);
      if (el.dataset.tone !== undefined) {
        const ok = val >= +el.dataset.tone;
        el.classList.toggle('t-pos', ok);
        el.classList.toggle('t-neg', !ok && isFinite(val));
      }
    });
    clearTimeout(timer);
    timer = setTimeout(() => { sr.textContent = `${head.textContent}: ${big.textContent}`; }, 800);
  };
  const syncMode = () => {
    const mode = form.elements.mode && form.elements.mode.value;
    $$('[data-show]', form).forEach(el => { el.hidden = el.dataset.show !== mode; });
  };
  form.addEventListener('input', () => { syncMode(); run(); });
  form.addEventListener('submit', e => e.preventDefault());
  syncMode();
  run();
});

const tabs = $$('.tab'), panels = $$('.panel');
const activate = (name, focus) => {
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
    if (on) t.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  panels.forEach(p => { p.hidden = p.dataset.panel !== name; });
};
tabs.forEach((t, i) => {
  t.addEventListener('click', () => activate(t.dataset.tab));
  t.addEventListener('keydown', e => {
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    activate(tabs[(to + tabs.length) % tabs.length].dataset.tab, true);
  });
});
const openFromHash = () => {
  const m = location.hash.match(/^#tool-(\w+)$/);
  if (!m || !tabs.some(t => t.dataset.tab === m[1])) return;
  activate(m[1]);
  $('#tools').scrollIntoView();
};
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#tool-"]');
  if (!a) return;
  e.preventDefault();
  history.replaceState(null, '', a.getAttribute('href'));
  openFromHash();
});
window.addEventListener('hashchange', openFromHash);
openFromHash();

const ckBoxes = $$('[data-ck]'), ckRing = $('#ckRing'), ckN = $('#ckN'), ckMsg = $('#ckMsg');
const ckKey = 'mpb-checklist';
try {
  const saved = JSON.parse(localStorage.getItem(ckKey)) || [];
  ckBoxes.forEach(b => { b.checked = saved.includes(b.dataset.ck); });
} catch (e) {}
const ckSync = () => {
  const n = ckBoxes.filter(b => b.checked).length;
  ckRing.style.setProperty('--p', n / ckBoxes.length * 100);
  ckRing.style.opacity = n ? 1 : 0;
  ckN.textContent = n;
  ckMsg.textContent = n === 0 ? 'Tick off what you already have in place.'
    : n === ckBoxes.length ? 'All ticked \u2014 nice work. Keep dates in your diary.'
    : `${ckBoxes.length - n} to go. Gaps here are what we help landlords close.`;
};
$('#ckList').addEventListener('change', () => {
  try { localStorage.setItem(ckKey, JSON.stringify(ckBoxes.filter(b => b.checked).map(b => b.dataset.ck))); } catch (e) {}
  ckSync();
});
$('#ckReset').addEventListener('click', () => {
  ckBoxes.forEach(b => { b.checked = false; });
  try { localStorage.removeItem(ckKey); } catch (e) {}
  ckSync();
});
ckSync();

// Valuation wizard
const wz = $('#wz'), wzPanes = $$('.wz-pane', wz), wzNext = $('#wzNext'), wzNextTxt = $('#wzNextTxt');
const wzBack = $('#wzBack'), wzErr = $('#wzErr'), wzLoc = $('#wzLoc'), wzCover = $('#wzCover'), wzDone = $('#wzDone');
const wzIntent = () => wz.elements.intent.value;
let wzI = 0, wzBusy = false, wzSource = 'direct', wzAuto = 0;

const syncCover = () => {
  const area = wzLoc.value.trim() ? coverArea(wzLoc.value) : '';
  wzCover.textContent = area ? `\u2713 Great news \u2014 we have local experts covering ${area}.` : '';
  wzCover.classList.toggle('ok', !!area);
};

// Show only the fields that apply to the chosen intent (and disable the rest so they are not sent)
const syncIntent = () => {
  const it = wzIntent();
  $$('[data-for]', wz).forEach(g => {
    const on = g.dataset.for.split(' ').includes(it);
    g.hidden = !on;
    $$('input, select', g).forEach(c => { c.disabled = !on; });
  });
  wzNextTxt.textContent = wzI < wzPanes.length - 1 ? 'Continue'
    : it === 'let' || it === 'manage' ? 'Get my free appraisal' : 'Get my free valuation';
};

const showStep = (n, focus = true) => {
  wzI = clamp(n, 0, wzPanes.length - 1);
  wzPanes.forEach((p, i) => { p.hidden = i !== wzI; });
  $('#wzStep').textContent = `Step ${wzI + 1} of ${wzPanes.length}`;
  $('#wzBar').style.width = (wzI + 1) / wzPanes.length * 100 + '%';
  wzBack.hidden = wzI === 0;
  wzErr.textContent = '';
  syncIntent();
  if (focus) $('h3', wzPanes[wzI]).focus({ preventScroll: true });
};

const goStep = n => {
  showStep(n);
  if (wz.getBoundingClientRect().top < 80) wz.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
};

const DONE_WHAT = {
  sell: 'to arrange your free valuation',
  let: 'to arrange your free rental appraisal',
  manage: 'to talk through your property management options',
  unsure: 'to talk through your options'
};
const DONE_VIA = { phone: 'by phone', email: 'by email', text: 'by text message' };

const showDone = (preview, d) => {
  const first = (d.name || '').split(/\s+/)[0];
  $('#wzDoneTitle').textContent = first ? `Thank you, ${first}` : 'Thank you';
  $('#wzDoneMsg').textContent = `We've got your details, and a local expert will be in touch ${DONE_VIA[d.contact_pref] || ''} ${DONE_WHAT[d.intent] || ''}.`.replace(/\s+/g, ' ').replace(' .', '.');
  $('#wzPreview').hidden = !preview;
  wz.classList.add('is-done');
  wzDone.hidden = false;
  wzDone.focus({ preventScroll: true });
};

const resetWizard = () => {
  wz.reset();
  wz.classList.remove('is-done');
  wzDone.hidden = true;
  showStep(0, false);
  syncCover();
};

wz.addEventListener('submit', async e => {
  e.preventDefault();
  if (wzBusy) return;
  const bad = validate(wzPanes[wzI]);
  if (bad) { wzErr.textContent = bad.msg; bad.el.focus(); return; }
  if (wzI < wzPanes.length - 1) {
    track('mpb_lead_step', { step: wzI + 1, intent: wzIntent() });
    goStep(wzI + 1);
    return;
  }
  const d = collect(wz);
  if (wz.elements.company_website.value) { showDone(false, d); return; }
  wzBusy = true;
  wzNext.disabled = true;
  wzNextTxt.textContent = 'Sending\u2026';
  try {
    const res = await sendLead('valuation', { source: wzSource, ...d, consent_statement: $('.ck-t', wz).textContent.trim() });
    track('mpb_lead_submit', { intent: d.intent, source: wzSource });
    showDone(res.preview, d);
  } catch (err) {
    wzErr.textContent = 'Sorry, something went wrong sending your request. Please try again.';
  } finally {
    wzBusy = false;
    wzNext.disabled = false;
    syncIntent();
  }
});

wzBack.addEventListener('click', () => goStep(wzI - 1));
wz.addEventListener('change', e => { if (e.target.name === 'intent') syncIntent(); });
wz.addEventListener('input', e => {
  clearInvalid(e);
  wzErr.textContent = '';
  if (e.target === wzLoc) syncCover();
});
// A mouse click on an option card moves straight on; keyboard users press Continue
wz.addEventListener('click', e => {
  if (wzI !== 0 || e.detail === 0 || !e.target.closest('.wz-opt')) return;
  clearTimeout(wzAuto);
  wzAuto = setTimeout(() => { if (wzI === 0 && wzIntent()) wz.requestSubmit(); }, 220);
});

const openWizard = ({ intent, loc, beds, source, scroll } = {}) => {
  if (wz.classList.contains('is-done')) resetWizard();
  const prev = wzIntent();
  if (intent) {
    const r = $(`input[name="intent"][value="${intent}"]`, wz);
    if (r) r.checked = true;
  }
  if (loc) { wzLoc.value = loc; syncCover(); }
  if (beds) {
    const sel = wz.elements.bedrooms;
    if ([...sel.options].some(o => o.value === beds)) sel.value = beds;
  }
  if (source) wzSource = source;
  syncIntent();
  if (wzIntent() && (wzI === 0 || wzIntent() !== prev)) showStep(1);
  if (scroll) wizEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
};

heroForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(heroForm);
  openWizard({ intent: f.get('intent'), loc: (f.get('location') || '').trim(), beds: f.get('bedrooms'), source: 'hero', scroll: true });
});

// Any link with data-intent / data-loc, or to #valuation, opens the wizard (the link's own anchor does the scrolling)
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-intent], a[data-loc], a[href="#valuation"]');
  if (!a) return;
  const host = a.closest('[id]');
  openWizard({ intent: a.dataset.intent, loc: a.dataset.loc, source: host ? host.id : 'page' });
});

// Arriving from the property pages, e.g. index.html?intent=sell&loc=Darlington&src=property#valuation
{
  const q = new URLSearchParams(location.search), it = q.get('intent');
  const SRC = { search: 'property-search', property: 'property-page', sold: 'property-sold' };
  if (['sell', 'let', 'manage', 'unsure'].includes(it)) openWizard({ intent: it, loc: (q.get('loc') || '').slice(0, 60), source: SRC[q.get('src')] || 'page' });
}

// "Email me this" dialog for the calculators and the compliance checklist
const cap = $('#cap'), capForm = $('#capForm'), capErr = $('#capErr'), capBody = $('#capBody'), capDone = $('#capDone');
const CAP = {
  vendor: ['Email me my sale breakdown', 'sell'],
  landlord: ['Email me my rental income report', 'let'],
  investor: ['Email me my investment summary', 'let'],
  buyer: ['Email me my buying costs', 'buy'],
  tenant: ['Email me my move-in costs', 'rent'],
  checklist: ['Email me my compliance checklist', 'manage']
};
let capCtx = null, capBusy = false;

const snapshot = (tool, calc) => {
  if (tool === 'checklist') {
    const items = ckBoxes.map(b => ({ item: $('b', b.closest('label')).textContent, done: b.checked }));
    return { done: items.filter(i => i.done).map(i => i.item), missing: items.filter(i => !i.done).map(i => i.item) };
  }
  return {
    inputs: readForm(calc),
    results: {
      headline: $('.out-head', calc).textContent.trim(),
      value: $('.out-big', calc).textContent.trim(),
      rows: $$('.rows > div', calc).map(r => ({ label: $('dt', r).textContent.trim(), value: $('dd', r).textContent.trim() }))
    }
  };
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-capture]');
  if (!b || cap.open) return;
  const calc = b.closest('form.calc');
  const tool = b.dataset.capture || (calc && calc.dataset.calc);
  if (!CAP[tool]) return;
  capCtx = { tool, extra: snapshot(tool, calc) };
  capForm.reset();
  $$('[aria-invalid]', capForm).forEach(el => el.removeAttribute('aria-invalid'));
  capErr.textContent = '';
  capBody.hidden = false;
  capDone.hidden = true;
  $('#capTitle').textContent = CAP[tool][0];
  cap.showModal();
  $('input[name="email"]', capForm).focus();
  track('mpb_capture_open', { tool });
});

cap.addEventListener('click', e => { if (e.target === cap || e.target.closest('[data-close]')) cap.close(); });
capForm.addEventListener('input', e => { clearInvalid(e); capErr.textContent = ''; });
capForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (capBusy || !capCtx) return;
  const bad = validate(capForm);
  if (bad) { capErr.textContent = bad.msg; bad.el.focus(); return; }
  const d = collect(capForm);
  let preview = false;
  if (!capForm.elements.company_website.value) {
    const btn = $('#capSubmit');
    capBusy = true;
    btn.disabled = true;
    btn.textContent = 'Sending\u2026';
    try {
      const res = await sendLead('report', {
        source: 'tool', tool: capCtx.tool, intent: CAP[capCtx.tool][1], ...d, ...capCtx.extra,
        consent_statement: $('.ck-t', capForm).textContent.trim()
      });
      preview = res.preview;
      track('mpb_capture_submit', { tool: capCtx.tool });
    } catch (err) {
      capErr.textContent = 'Sorry, something went wrong. Please try again.';
      return;
    } finally {
      capBusy = false;
      btn.disabled = false;
      btn.textContent = 'Send me the report';
    }
  }
  $('#capDoneMsg').textContent = `We'll email your report to ${d.email}.`;
  $('#capPreview').hidden = !preview;
  capBody.hidden = true;
  capDone.hidden = false;
  capDone.focus();
});

syncCover();
showStep(0, false);

$('#yr').textContent = new Date().getFullYear();
