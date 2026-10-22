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
// Point `endpoint` at anything that accepts a JSON POST (CRM webhook, Formspree, Zapier...).
// While it is empty the forms run in preview mode: the payload is logged to the console and nothing is sent.
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

const sendLead = async (type, data) => {
  const payload = { ...data, lead_type: type, submitted_at: new Date().toISOString(), page: location.href, attribution };
  if (!LEAD.endpoint) {
    console.info('[My Property Box] Lead captured in preview mode (not sent):', payload);
    await new Promise(r => setTimeout(r, 600));
    return { preview: true };
  }
  const res = await fetch(LEAD.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Lead endpoint responded ' + res.status);
  return { preview: false };
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
