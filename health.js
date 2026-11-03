// Landlord compliance check: seven questions, then contact details, then a personal checklist (a gated lead magnet).
// Relies on common.js for $, $$, validate, collect, sendLead, track and reduceMotion.
(() => {
  const form = $('#health-form');
  if (!form) return;

  // General guidance on common requirements for private landlords in England. Not legal advice.
  const ITEMS = [
    { k: 'gas', t: 'Gas safety certificate', q: 'Is there a gas safety certificate from the last 12 months?', s: 'Or the property has no gas appliances.',
      g: 'Where there are gas appliances, a Gas Safe registered engineer needs to check them every 12 months, and tenants should be given a copy of the record.' },
    { k: 'eicr', t: 'Electrical safety report', q: 'Is there an electrical installation condition report (EICR) from the last 5 years?',
      g: 'Private tenancies in England need an EICR from a qualified person at least every 5 years, with a copy given to tenants. Any faults it flags need dealing with in the timescale it sets.' },
    { k: 'epc', t: 'Energy performance certificate', q: 'Does the property have a valid EPC?',
      g: 'You generally need a valid EPC (they last 10 years) before marketing a property to let. Minimum rating rules apply and are under review, so check the current requirement for your property.' },
    { k: 'alarms', t: 'Smoke and carbon monoxide alarms', q: 'Are working smoke alarms fitted on every floor, with carbon monoxide alarms where needed?',
      g: 'You need a working smoke alarm on each floor used as living space, and a carbon monoxide alarm in rooms with a fixed combustion appliance (gas cookers are excepted). Test them at the start of each tenancy.' },
    { k: 'deposit', t: 'Deposit protection', q: 'Is the tenant\u2019s deposit protected in a government-approved scheme?', s: 'Or no deposit was taken.',
      g: 'A deposit generally has to be protected within 30 days of receiving it, and the tenant given the prescribed information. Getting this wrong can lead to penalties and affect your ability to regain possession.' },
    { k: 'rtr', t: 'Right to rent checks', q: 'Were right to rent checks done on every adult tenant before they moved in?',
      g: 'Landlords in England must check each adult tenant\u2019s right to rent before the tenancy starts and keep copies of the documents. Penalties can apply if checks are missed.' },
    { k: 'licence', t: 'Licensing', q: 'Do you know whether the property needs a council licence, and is it in place if so?', s: 'Answer yes if no licence is needed.',
      g: 'Some HMOs need a licence, and some councils require licences for other rented homes in selected areas. Check with your local council whether yours does.' }
  ];
  const ANSWERS = [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']];

  const qs = $('[data-qs]', form);
  ITEMS.forEach(it => {
    const fs = document.createElement('fieldset');
    fs.className = 'hq';
    const lg = document.createElement('legend');
    lg.textContent = it.q;
    if (it.s) { const sm = document.createElement('small'); sm.textContent = it.s; lg.append(' ', sm); }
    const grp = document.createElement('div');
    grp.className = 'chips chips-sm';
    ANSWERS.forEach(([v, label]) => {
      const l = document.createElement('label');
      l.className = 'chip';
      const i = document.createElement('input');
      i.type = 'radio'; i.name = 'q_' + it.k; i.value = v; i.required = true;
      i.dataset.msg = 'Please answer every question so your checklist is accurate.';
      const sp = document.createElement('span');
      sp.textContent = label;
      l.append(i, sp);
      grp.append(l);
    });
    fs.append(lg, grp);
    qs.append(fs);
  });

  const panes = $$('.wz-pane', form), nextBtn = $('[data-next]', form), nextTxt = $('[data-next-txt]', form);
  const backBtn = $('[data-back]', form), errEl = $('[data-err]', form), doneEl = $('[data-done]', form);
  const countEl = $('[data-count]', form), source = form.dataset.source;
  const FINAL = 'Show my checklist';
  let step = 0, busy = false, started = false;

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
  const toTop = () => {
    const r = form.getBoundingClientRect();
    if (r.top < 80 || r.top > innerHeight * 0.5) form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };
  const answered = () => ITEMS.filter(it => form.elements['q_' + it.k].value).length;
  const syncCount = () => { countEl.textContent = `${answered()} of ${ITEMS.length} answered`; };

  const li = (cls, title, tag, text) => {
    const el = document.createElement('li');
    if (cls === 'ok') {
      el.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>';
      el.append(title);
      return el;
    }
    const b = document.createElement('b');
    b.append(title);
    const t = document.createElement('span');
    t.className = 'hc-tag ' + cls;
    t.textContent = tag;
    b.append(t);
    const p = document.createElement('p');
    p.textContent = text;
    el.append(b, p);
    return el;
  };

  const TIERS = [
    [7, 'Looking good', 'Everything you told us about is in place. Most of these expire, so keep the renewal dates somewhere you will see them.'],
    [5, 'Nearly there', 'Most of the basics are covered. The items below are worth sorting soon.'],
    [3, 'A few gaps to close', 'Some important items need attention. The list below shows where to start.'],
    [0, 'Worth a proper look', 'There is a fair amount to check. Don\u2019t worry, it is all fixable, and the list below shows where to start.']
  ];

  const showResults = (preview, d, score, ans) => {
    const tier = TIERS.find(t => score >= t[0]);
    const first = (d.name || '').split(/\s+/)[0];
    $('[data-score]', form).textContent = score;
    $('[data-res-title]', form).textContent = tier[1];
    $('[data-res-msg]', form).textContent = (first ? first + ', ' : '') + (first ? tier[2].charAt(0).toLowerCase() + tier[2].slice(1) : tier[2]);
    const todo = $('[data-todo]', form), ok = $('[data-ok]', form);
    todo.replaceChildren(); ok.replaceChildren();
    ITEMS.forEach(it => {
      const a = ans[it.k];
      if (a === 'yes') ok.append(li('ok', it.t));
      else todo.append(li(a === 'no' ? 'no' : 'q', it.t, a === 'no' ? 'Needs action' : 'Check this', it.g));
    });
    $('[data-todo-wrap]', form).hidden = !todo.children.length;
    $('[data-ok-wrap]', form).hidden = !ok.children.length;
    $('[data-preview]', form).hidden = !preview;
    form.classList.add('is-done');
    doneEl.hidden = false;
    doneEl.focus({ preventScroll: true });
    toTop();
    try { sessionStorage.setItem('mpb-lead-done', '1'); } catch (e) {}
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const bad = validate(panes[step]);
    if (bad) { errEl.textContent = bad.msg; bad.el.focus(); return; }
    if (step < panes.length - 1) {
      track('mpb_lead_step', { step: step + 1, intent: 'compliance_check', source });
      show(step + 1);
      toTop();
      return;
    }
    const d = collect(form);
    const ans = {};
    ITEMS.forEach(it => { ans[it.k] = d['q_' + it.k]; delete d['q_' + it.k]; });
    const score = ITEMS.filter(it => ans[it.k] === 'yes').length;
    const outstanding = ITEMS.filter(it => ans[it.k] !== 'yes').map(it => it.k);
    if (form.elements.company_website.value) { showResults(false, d, score, ans); return; }
    busy = true;
    nextBtn.disabled = true;
    nextTxt.textContent = 'Sending\u2026';
    try {
      const res = await sendLead('compliance_check', { ...d, answers: ans, score, outstanding, source, consent_statement: $('.ck-t', panes[panes.length - 1]).textContent.trim() });
      track('mpb_lead_submit', { intent: 'compliance_check', source, score });
      showResults(res.preview, d, score, ans);
    } catch (err) {
      errEl.textContent = 'Sorry, something went wrong sending your request. Please try again.';
    } finally {
      busy = false;
      nextBtn.disabled = false;
      if (!form.classList.contains('is-done')) nextTxt.textContent = step < panes.length - 1 ? 'Continue' : FINAL;
    }
  });

  backBtn.addEventListener('click', () => show(step - 1));
  form.addEventListener('input', e => { clearInvalid(e); errEl.textContent = ''; });
  form.addEventListener('change', e => { clearInvalid(e); syncCount(); });
  form.addEventListener('focusin', () => {
    if (started) return;
    started = true;
    track('mpb_lead_start', { intent: 'compliance_check', source });
  });
  $('[data-redo]', form).addEventListener('click', () => {
    form.reset();
    form.classList.remove('is-done');
    doneEl.hidden = true;
    syncCount();
    show(0);
    toTop();
  });

  show(0, false);
  syncCount();
})();
