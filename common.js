// Shared by every page: DOM helpers, theme toggle, mobile menu and lead-capture plumbing.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// Theme toggle (initial value is set by the inline script in <head>)
const root = document.documentElement, themeBtn = $('#theme');
const syncTheme = () => themeBtn.setAttribute('aria-pressed', root.dataset.theme === 'dark');
syncTheme();
themeBtn.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('mpb-theme', next); } catch (e) {}
  syncTheme();
});

const burger = $('#burger'), menu = $('#menu');
$$('a', menu).forEach((a, i) => a.style.setProperty('--i', i));
const setMenu = open => {
  menu.classList.toggle('open', open);
  burger.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open);
  document.body.classList.toggle('menu-open', open);
};
burger.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
menu.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

// ---- Lead capture ----
// Leads go to the site's own server (/api/leads), which logs them and emails the right office.
// Set `endpoint` to send them somewhere else instead (CRM webhook, Formspree, Zapier... or the full URL of the server's /api/leads).
// On a static host with no server behind it (the GitHub Pages preview) the forms run in preview mode:
// the payload is logged to the console and nothing is sent.
const LEAD = { endpoint: '' };

// First-touch attribution, kept for the session so leads can be tied back to a campaign
const attribution = (() => {
  const KEY = 'mpb-attribution';
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    if (saved) return saved;
  } catch (e) {}
  const q = new URLSearchParams(location.search);
  const a = { landing: location.pathname + location.search, referrer: document.referrer };
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(k => { if (q.get(k)) a[k] = q.get(k); });
  try { sessionStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
  return a;
})();

// dataLayer events are ready for Google Tag Manager (not loaded on this page)
const track = (event, data = {}) => { (window.dataLayer = window.dataLayer || []).push({ event, ...data }); };

let noLeadApi = location.protocol === 'file:';
const sendLead = async (type, data) => {
  const payload = { ...data, lead_type: type, submitted_at: new Date().toISOString(), page: location.href, attribution };
  const preview = async () => {
    console.info('[My Property Box] Lead captured in preview mode (not sent):', payload);
    await new Promise(r => setTimeout(r, 600));
    return { preview: true };
  };
  if (!LEAD.endpoint && noLeadApi) return preview();
  const res = await fetch(LEAD.endpoint || '/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  // No server behind this host (a static site): 404/405/501 mean preview mode. Real failures still raise an error.
  if (!LEAD.endpoint && [404, 405, 501].includes(res.status)) { noLeadApi = true; return preview(); }
  if (!res.ok) throw new Error('Lead endpoint responded ' + res.status);
  const out = await res.json().catch(() => ({}));
  return { preview: !!out.demo };
};

const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const isUkPhone = v => /^(?:\+?44|0)\d{9,10}$/.test(v.replace(/\(0\)/, '').replace(/[\s()-]/g, ''));
const GROUPS = '.wz-opts, .chips, .ck';

// Validates the visible fields in `scope`; marks them aria-invalid and returns the first problem
const validate = scope => {
  $$('[aria-invalid]', scope).forEach(el => el.removeAttribute('aria-invalid'));
  let first = null;
  const fail = (el, msg) => {
    (el.closest(GROUPS) || el).setAttribute('aria-invalid', 'true');
    first = first || { el, msg };
  };
  $$('input, select', scope).forEach(el => {
    if (el.disabled || el.closest('[hidden]') || el.classList.contains('hp')) return;
    if (el.type === 'radio') {
      if (el.required && !$$(`input[type=radio][name="${el.name}"]`, scope).some(r => r.checked)) fail(el, el.dataset.msg);
      return;
    }
    if (el.type === 'checkbox') {
      if (el.required && !el.checked) fail(el, el.dataset.msg);
      return;
    }
    const v = el.value.trim();
    if (!v) { if (el.required) fail(el, el.dataset.msg); return; }
    if (el.dataset.v === 'email' && !isEmail(v)) fail(el, 'Please enter a valid email address.');
    else if (/^phone/.test(el.dataset.v || '') && !isUkPhone(v)) fail(el, 'Please enter a valid UK phone number.');
  });
  return first;
};

const clearInvalid = e => {
  e.target.removeAttribute('aria-invalid');
  const g = e.target.closest(GROUPS);
  if (g) g.removeAttribute('aria-invalid');
};

const collect = form => {
  const d = {};
  $$('input, select, textarea', form).forEach(el => {
    if (!el.name || el.disabled || el.classList.contains('hp') || el.closest('[data-skip]') || (el.type === 'radio' && !el.checked)) return;
    if (el.type === 'checkbox') { d[el.name] = el.checked; return; }
    const v = el.value.trim();
    if (v) d[el.name] = v;
  });
  return d;
};

// Does a postcode or town fall inside our patch? Positive hints only: we never tell anyone we don't cover them.
const COVER_TOWNS = [
  ['Cumbria', ['carlisle', 'penrith', 'kendal', 'cockermouth', 'cumbria']],
  ['North Yorkshire', ['northallerton', 'catterick', 'thirsk', 'bedale', 'north yorkshire']],
  ['County Durham & Darlington', ['darlington', 'durham', 'newton aycliffe', 'bishop auckland', 'seaham']],
  ['Newcastle & Northumberland', ['newcastle', 'gosforth', 'jesmond', 'heaton', 'fenham', 'ashington', 'northumberland']],
  ['Tees Valley & Middlesbrough', ['middlesbrough', 'thornaby', 'yarm', 'tees valley']]
];
const coverArea = raw => {
  const t = raw.trim().toUpperCase();
  const pc = t.match(/^([A-Z]{1,2})(\d{1,2})[A-Z]?\s*\d[A-Z]{2}$/) || t.match(/^([A-Z]{1,2})(\d{1,2})[A-Z]?$/);
  if (pc) {
    const a = pc[1], n = +pc[2];
    if (a === 'CA' || (a === 'LA' && n >= 8 && n <= 23)) return 'Cumbria';
    if (a === 'NE') return 'Newcastle & Northumberland';
    if (a === 'DL') return n >= 6 && n <= 11 ? 'North Yorkshire' : 'County Durham & Darlington';
    if (a === 'YO' && n === 7) return 'North Yorkshire';
    if (a === 'DH' || (a === 'SR' && n === 7)) return 'County Durham & Darlington';
    if (a === 'TS') return 'Tees Valley & Middlesbrough';
    return '';
  }
  const s = t.toLowerCase();
  const hit = COVER_TOWNS.find(([, names]) => names.some(n => new RegExp(`\\b${n}\\b`).test(s)));
  return hit ? hit[0] : '';
};

// ---- Offices and phone numbers ----
// Our own office lines. These are deliberately NOT the tracking numbers shown on Rightmove.
// The footer markup on each page repeats the same numbers, so update both when one changes.
const OFFICES = [
  { id: 'darlington', name: 'Darlington', area: 'County Durham & Tees Valley', phone: '01325 582 101', lat: 54.5233, lng: -1.5528 },
  { id: 'newcastle', name: 'Newcastle', area: 'Tyne & Wear and Northumberland', phone: '0191 212 0400', lat: 54.9783, lng: -1.6178 },
  { id: 'northallerton', name: 'Northallerton', area: 'North Yorkshire', phone: '01609 777 757', lat: 54.3381, lng: -1.4343 },
  { id: 'carlisle', name: 'Carlisle', area: 'Cumbria', phone: '01228 810 799', lat: 54.8951, lng: -2.9382 },
  { id: 'penrith', name: 'Penrith', area: 'Cumbria', phone: '01768 840 619', lat: 54.6641, lng: -2.7527 },
  { id: 'kendal', name: 'Kendal', area: 'Cumbria', phone: '01539 885 699', lat: 54.3283, lng: -2.7487 }
];
const telHref = phone => 'tel:+44' + phone.replace(/\D/g, '').slice(1);

// Which office looks after a listing: Rightmove rows know their branch, the rest use the nearest office
// by straight-line distance (null when nothing is within range, e.g. a missing position).
const RM_BRANCH_OFFICE = { 90144: 'carlisle', 90147: 'penrith' };
const officeFor = p => {
  if (!p) return null;
  const byBranch = RM_BRANCH_OFFICE[p.rm_branch];
  if (byBranch) return OFFICES.find(o => o.id === byBranch);
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;
  const rad = d => (d * Math.PI) / 180;
  const miles = o => {
    const h = Math.sin(rad(o.lat - p.lat) / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(o.lat)) * Math.sin(rad(o.lng - p.lng) / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const best = OFFICES.reduce((a, o) => (miles(o) < miles(a) ? o : a));
  return miles(best) <= 45 ? best : null;
};

const PHONE_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';

// Header "Call us" button and the call / callback dialog (built here so every page gets it from one place)
(() => {
  const tools = $('.nav-tools');
  if (!tools) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'callbtn';
  btn.id = 'callBtn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-label', 'Call us');
  btn.innerHTML = `${PHONE_IC}<span>Call us</span>`;
  tools.prepend(btn);

  const dlg = document.createElement('dialog');
  dlg.className = 'cap call-dlg';
  dlg.id = 'call';
  dlg.setAttribute('aria-labelledby', 'callTitle');
  dlg.innerHTML = `
    <div class="call-in">
      <button type="button" class="cap-x" data-close aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
      <div id="callBody">
        <p class="kicker">Speak to us</p>
        <h3 id="callTitle">Call your local office</h3>
        <p class="cap-sub">Tap a number to call, or request a callback below.</p>
        <ul class="call-list">
          ${OFFICES.map(o => `<li><a href="${telHref(o.phone)}" data-office="${o.id}"><span class="call-ic">${PHONE_IC}</span><span class="call-who"><b>${o.name}</b><small>${o.area.replace(/&/g, '&amp;')}</small></span><span class="call-num">${o.phone}</span></a></li>`).join('')}
        </ul>
        <details class="call-cb" id="callCb">
          <summary>Request a callback instead</summary>
          <form id="callForm" novalidate>
            <div class="fgrid">
              <label class="fld"><span class="lbl">Your name</span><span class="inp"><input type="text" name="name" autocomplete="name" required data-msg="Please tell us your name."></span></label>
              <label class="fld"><span class="lbl">Phone</span><span class="inp"><input type="tel" name="phone" autocomplete="tel" inputmode="tel" required data-v="phone" data-msg="Please enter a valid UK phone number."></span></label>
              <label class="fld full"><span class="lbl">Which office?</span><span class="inp"><select name="office"><option value="">Whichever is nearest</option>${OFFICES.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}</select></span></label>
            </div>
            <label class="ck"><input type="checkbox" name="consent" value="yes" required data-msg="Please tick the box so we can call you back."><span class="box"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></span><span class="ck-t"><small>I agree to My Property Box calling me back about this request, as set out in the <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</small></span></label>
            <input type="text" name="company_website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
            <p class="wz-err" id="callErr" role="alert"></p>
            <button type="submit" class="btn btn-navy" id="callSubmit">Request a callback</button>
          </form>
        </details>
      </div>
      <div class="cap-done" id="callDone" tabindex="-1" hidden>
        <span class="done-ic"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></span>
        <h3>Thank you</h3>
        <p>We&rsquo;ve got your request and a member of the team will call you back.</p>
        <p class="wz-preview" id="callPreview" hidden>Preview mode: no lead destination is connected yet, so this was not sent.</p>
        <div class="row"><button type="button" class="btn btn-navy" data-close>Close</button></div>
      </div>
    </div>`;
  document.body.append(dlg);

  const form = $('#callForm'), err = $('#callErr'), body = $('#callBody'), done = $('#callDone'), cb = $('#callCb');
  let busy = false;

  const open = (officeId = '', showForm = false) => {
    form.reset();
    $$('[aria-invalid]', form).forEach(el => el.removeAttribute('aria-invalid'));
    err.textContent = '';
    body.hidden = false;
    done.hidden = true;
    cb.open = showForm;
    if (officeId) form.elements.office.value = officeId;
    if (menu.classList.contains('open')) setMenu(false);
    if (!dlg.open) dlg.showModal();
    track('mpb_call_open', { office: officeId || 'any' });
  };

  btn.addEventListener('click', () => open());
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-call]');
    if (!t) return;
    e.preventDefault();
    open(t.dataset.call, t.dataset.callback === 'true');
  });
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    const a = e.target.closest('a[data-office]');
    if (a) track('mpb_call_click', { office: a.dataset.office });
  });
  form.addEventListener('input', e => { clearInvalid(e); err.textContent = ''; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const bad = validate(form);
    if (bad) { err.textContent = bad.msg; bad.el.focus(); return; }
    let preview = false;
    if (!form.elements.company_website.value) {
      const submit = $('#callSubmit');
      busy = true; submit.disabled = true; submit.textContent = 'Sending\u2026';
      try {
        const res = await sendLead('callback', {
          source: 'header-call', ...collect(form),
          consent_statement: $('.ck-t', form).textContent.trim()
        });
        preview = res.preview;
        track('mpb_callback_submit');
      } catch (x) {
        err.textContent = 'Sorry, something went wrong. Please try again, or call us on one of the numbers above.';
        return;
      } finally { busy = false; submit.disabled = false; submit.textContent = 'Request a callback'; }
    }
    $('#callPreview').hidden = !preview;
    body.hidden = true;
    done.hidden = false;
    done.focus();
  });
})();

// Static "Prefer to talk?" notes get their phone icon from the one definition above
$$('.call-note').forEach(n => n.insertAdjacentHTML('afterbegin', PHONE_IC + ' '));
