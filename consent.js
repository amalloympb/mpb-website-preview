// Cookie consent (Google Consent Mode v2) and the Google Tag Manager loader.
// Nothing is loaded and no banner is shown unless a container id is set in site-config.js (GTM_ID on the server).
// Consent starts as denied; Google tags stay quiet until the visitor says yes, and the choice is remembered.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.start();
})(typeof window !== 'undefined' ? window : globalThis, function (win) {
  const KEY = 'mpb-consent';
  const MAX_AGE = 365 * 864e5;
  const GTM_RE = /^GTM-[A-Z0-9]{4,12}$/;

  const modeFor = c => {
    const analytics = c && c.analytics ? 'granted' : 'denied', ads = c && c.marketing ? 'granted' : 'denied';
    return { ad_storage: ads, ad_user_data: ads, ad_personalization: ads, analytics_storage: analytics };
  };

  // A stored choice only counts while it is well formed and under a year old.
  const readChoice = (raw, now = Date.now()) => {
    try {
      const c = JSON.parse(raw);
      if (c && typeof c.analytics === 'boolean' && typeof c.marketing === 'boolean' && typeof c.at === 'number' && now - c.at < MAX_AGE) return c;
    } catch (e) {}
    return null;
  };

  function start() {
    const doc = win.document;
    const id = String((win.MPB_CONFIG || {}).gtm || '').trim();
    if (!GTM_RE.test(id)) return;

    const layer = win.dataLayer = win.dataLayer || [];
    // Google's tags read the arguments object itself, so this cannot be an arrow function.
    const gtag = function () { layer.push(arguments); };
    const store = {
      get: () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
      set: v => { try { localStorage.setItem(KEY, v); } catch (e) {} }
    };

    gtag('consent', 'default', Object.assign(modeFor(null), { wait_for_update: 500 }));
    let saved = readChoice(store.get());
    if (saved) gtag('consent', 'update', modeFor(saved));

    layer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const s = doc.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id);
    doc.head.appendChild(s);

    let banner = null, opener = null;
    const decide = c => {
      saved = { analytics: !!c.analytics, marketing: !!c.marketing, at: Date.now() };
      store.set(JSON.stringify(saved));
      gtag('consent', 'update', modeFor(saved));
      layer.push({ event: 'mpb_consent', analytics: saved.analytics, marketing: saved.marketing });
      close();
    };
    const close = () => {
      if (!banner) return;
      banner.remove();
      banner = null;
      if (opener && doc.contains(opener)) opener.focus();
      opener = null;
    };

    const open = (focusPanel, from) => {
      if (banner) return;
      opener = from || null;
      banner = doc.createElement('section');
      banner.className = 'cc';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-labelledby', 'cc-t');
      banner.setAttribute('aria-describedby', 'cc-d');
      banner.innerHTML = `
        <div class="wrap cc-in">
          <div class="cc-copy">
            <h2 id="cc-t">Your cookie choices</h2>
            <p id="cc-d">We use essential storage to make this site work. With your permission we would also use analytics and advertising cookies from Google to see how the site is used and to measure our marketing. You can change your mind at any time. <a href="cookies.html">Cookies policy</a></p>
          </div>
          <div class="cc-panel" id="cc-panel" hidden>
            <label class="cc-row"><input type="checkbox" checked disabled><span><b>Essential</b> Needed for the site to work. Always on.</span></label>
            <label class="cc-row"><input type="checkbox" id="cc-a"><span><b>Analytics</b> Helps us see which pages are used and improve them.</span></label>
            <label class="cc-row"><input type="checkbox" id="cc-m"><span><b>Advertising</b> Lets us measure our adverts and show you relevant ones.</span></label>
          </div>
          <div class="cc-acts">
            <button type="button" class="cc-btn" data-cc="reject">Reject all</button>
            <button type="button" class="cc-btn" data-cc="accept">Accept all</button>
            <button type="button" class="cc-link" data-cc="choose" aria-expanded="false" aria-controls="cc-panel">Choose</button>
          </div>
        </div>`;
      doc.body.appendChild(banner);
      const panel = banner.querySelector('#cc-panel'), choose = banner.querySelector('[data-cc=choose]');
      const a = banner.querySelector('#cc-a'), m = banner.querySelector('#cc-m');
      if (saved) { a.checked = saved.analytics; m.checked = saved.marketing; }
      const setPanel = show => {
        panel.hidden = !show;
        choose.setAttribute('aria-expanded', String(show));
        choose.textContent = show ? 'Save my choices' : 'Choose';
        choose.dataset.cc = show ? 'save' : 'choose';
      };
      banner.addEventListener('click', e => {
        const t = e.target.closest('[data-cc]');
        if (!t) return;
        const act = t.dataset.cc;
        if (act === 'accept') decide({ analytics: true, marketing: true });
        else if (act === 'reject') decide({ analytics: false, marketing: false });
        else if (act === 'choose') { setPanel(true); a.focus(); }
        else if (act === 'save') decide({ analytics: a.checked, marketing: m.checked });
      });
      banner.addEventListener('keydown', e => { if (e.key === 'Escape' && saved) close(); });
      if (focusPanel) { setPanel(true); a.focus(); }
    };

    if (!saved) open(false);

    // "Cookie settings" links (the cookies page and the footer) reopen the panel so a choice can be changed or withdrawn.
    const footer = doc.querySelector('.footer .legal-links');
    if (footer && !footer.querySelector('[data-cookie-settings]')) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'cc-foot';
      b.setAttribute('data-cookie-settings', '');
      b.textContent = 'Cookie settings';
      footer.appendChild(b);
    }
    doc.querySelectorAll('[data-cookie-settings]').forEach(el => { el.hidden = false; });
    doc.addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('[data-cookie-settings]');
      if (t) { e.preventDefault(); open(true, t); }
    });
  }

  return { start, readChoice, modeFor, GTM_RE, KEY };
});
