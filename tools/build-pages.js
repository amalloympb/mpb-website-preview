#!/usr/bin/env node
// Generates the town and area landing pages (estate-agents-<slug>.html) and areas.html.
// The header, footer, icon sprite, hero image and trust logos are lifted from sell.html and properties.html,
// and the office phone numbers from common.js, so the pages stay in step with the rest of the site.
// Run from anywhere: node tools/build-pages.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

// Non-ASCII becomes numeric entities so the output stays plain ASCII like the hand-written pages
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[^\x00-\x7f]/g, c => `&#${c.codePointAt(0)};`);
const json = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const tel = phone => '+44' + phone.replace(/\D/g, '').slice(1);

const OFFICES = new Function('return ' + read('common.js').match(/const OFFICES = (\[[\s\S]*?\n\]);/)[1])();
const officeById = Object.fromEntries(OFFICES.map(o => [o.id, o]));

// Each page is looked after by one office. Areas without an office use the one for their region.
// `match` is how the area appears in the listings feed (hub or town). `near` lists other pages to link to.
const PAGES = [
  { slug: 'darlington', name: 'Darlington', office: 'darlington', match: ['Darlington'], covers: 'Darlington, Newton Aycliffe, Bishop Auckland and Seaham', near: ['newton-aycliffe', 'bishop-auckland', 'durham', 'middlesbrough'] },
  { slug: 'newcastle', name: 'Newcastle', office: 'newcastle', match: ['Newcastle upon Tyne', 'Newcastle'], covers: 'Newcastle, Gosforth, Jesmond, Heaton and Ashington', near: ['gateshead', 'south-shields', 'sunderland', 'durham'] },
  { slug: 'northallerton', name: 'Northallerton', office: 'northallerton', match: ['Northallerton'], covers: 'Northallerton, Richmond, Catterick and the wider county', near: ['darlington', 'middlesbrough'] },
  { slug: 'carlisle', name: 'Carlisle', office: 'carlisle', match: ['Carlisle'], covers: 'Carlisle and the surrounding area', near: ['penrith', 'cockermouth', 'kendal'] },
  { slug: 'penrith', name: 'Penrith', office: 'penrith', match: ['Penrith'], covers: 'Penrith and the surrounding area', near: ['carlisle', 'kendal', 'cockermouth'] },
  { slug: 'kendal', name: 'Kendal', office: 'kendal', match: ['Kendal'], covers: 'Kendal and the surrounding area', near: ['penrith', 'carlisle'] },
  { slug: 'middlesbrough', name: 'Middlesbrough', office: 'darlington', match: ['Middlesbrough'], covers: 'Middlesbrough, Thornaby, Yarm and the wider Tees Valley', near: ['stockton-on-tees', 'hartlepool', 'darlington'] },
  { slug: 'stockton-on-tees', name: 'Stockton-on-Tees', office: 'darlington', match: ['Stockton-on-Tees'], covers: 'Stockton-on-Tees and the wider Tees Valley', near: ['middlesbrough', 'hartlepool', 'darlington'] },
  { slug: 'hartlepool', name: 'Hartlepool', office: 'darlington', match: ['Hartlepool'], covers: 'Hartlepool and the wider Tees Valley', near: ['middlesbrough', 'stockton-on-tees', 'durham'] },
  { slug: 'durham', name: 'Durham', office: 'darlington', match: ['Durham'], covers: 'Durham and the wider county', near: ['darlington', 'newton-aycliffe', 'bishop-auckland', 'sunderland'] },
  { slug: 'newton-aycliffe', name: 'Newton Aycliffe', office: 'darlington', match: ['Newton Aycliffe'], covers: 'Newton Aycliffe and the surrounding area', near: ['darlington', 'bishop-auckland', 'durham'] },
  { slug: 'bishop-auckland', name: 'Bishop Auckland', office: 'darlington', match: ['Bishop Auckland'], covers: 'Bishop Auckland and the surrounding area', near: ['darlington', 'newton-aycliffe', 'durham'] },
  { slug: 'sunderland', name: 'Sunderland', office: 'newcastle', match: ['Sunderland'], covers: 'Sunderland and the surrounding area', near: ['south-shields', 'gateshead', 'durham'] },
  { slug: 'gateshead', name: 'Gateshead', office: 'newcastle', match: ['Gateshead'], covers: 'Gateshead and the surrounding area', near: ['newcastle', 'south-shields', 'sunderland'] },
  { slug: 'south-shields', name: 'South Shields', office: 'newcastle', match: ['South Shields'], covers: 'South Shields and the surrounding area', near: ['gateshead', 'sunderland', 'newcastle'] },
  { slug: 'cockermouth', name: 'Cockermouth', office: 'carlisle', match: ['Cockermouth'], covers: 'Cockermouth and the surrounding area', near: ['carlisle', 'penrith'] }
];
const bySlug = Object.fromEntries(PAGES.map(p => [p.slug, p]));
PAGES.forEach(p => {
  if (!officeById[p.office]) throw new Error(`${p.slug}: unknown office ${p.office}`);
  p.near.forEach(n => { if (!bySlug[n]) throw new Error(`${p.slug}: unknown neighbour ${n}`); });
  // The lead source tag "town-<slug>" is limited to 24 characters by the landing pages
  if (!/^[a-z0-9-]{1,19}$/.test(p.slug)) throw new Error(`${p.slug}: slug is too long for the lead source tag`);
});
const fileOf = p => `estate-agents-${p.slug}.html`;

// ---- Shared chunks lifted from the existing pages ----
const sell = read('sell.html'), props = read('properties.html');
const pick = (src, rx, what) => { const m = src.match(rx); if (!m) throw new Error(`Could not find ${what}`); return m[0]; };

const symbols = new Map();
[sell, props].forEach(src => { for (const m of src.matchAll(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g)) symbols.set(m[1], m[0]); });
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">\n  <defs>\n    ${[...symbols.values()].join('\n    ')}\n  </defs>\n</svg>`;
const HEADER = pick(sell, /<header class="nav"[\s\S]*?<\/header>/, 'header').replace(' aria-current="page"', '');
const FOOTER = pick(sell, /<footer class="footer">[\s\S]*?<\/footer>/, 'footer');
const HERO_IMG = pick(sell, /<div class="hero-media"[\s\S]*?<\/div>/, 'hero image');
const MINI = pick(sell, /<div class="lp-mini">[\s\S]*?<\/div>/, 'trust logos');
const CTA_IMG = pick(sell, /<div class="cta-bg"[\s\S]*?<\/div>/, 'CTA image');
const OG_IMG = 'https://images.unsplash.com/photo-1691829120775-0b56db1c2e0c?w=1200&h=630&auto=format&fit=crop&q=70';

const head = ({ title, desc, file, ld = [] }) => `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#134165">
<link rel="canonical" href="${file}" id="canon">
<meta property="og:type" content="website">
<meta property="og:site_name" content="My Property Box">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="" id="ogurl">
<meta property="og:image" content="${OG_IMG}">
<meta name="twitter:card" content="summary_large_image">
<script>(function(){var u=location.origin+location.pathname;document.getElementById('canon').href=u;document.getElementById('ogurl').content=u})()</script>
${ld.map(o => `<script type="application/ld+json">${json(o)}</script>`).join('\n')}
<link rel="icon" type="image/png" sizes="64x64" href="assets/favicon.png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="landing.css">
<link rel="stylesheet" href="listing.css">
<link rel="stylesheet" href="town.css">
<script>document.documentElement.classList.add('js');try{var t=localStorage.getItem('mpb-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body class="lp">
<a class="skip" href="#main">Skip to content</a>
<div class="progress" id="progress" aria-hidden="true"></div>

${SPRITE}

${HEADER}
`;

const tail = fab => `
<a class="fab" id="fab" href="${fab}"><svg class="ic"><use href="#i-bolt"/></svg> Free valuation</a>

${FOOTER}

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script src="common.js"></script>
<script src="listing.js"></script>
<script src="town.js"></script>
</body>
</html>
`;

const ctaBand = (h2, p, primary, second) => `  <section class="cta lp-cta tn-quiet" id="contact">
    ${CTA_IMG}
    <div class="wrap">
      <h2>${h2}</h2>
      <p>${p}</p>
      <div class="row center">
        ${primary}
        ${second}
      </div>
    </div>
  </section>`;

// ---- Town and area pages ----
const faqs = (p, o) => [
  [`Do you cover ${p.name}?`, p.office === p.slug
    ? `Yes. ${p.name} is home to one of our offices. Call ${o.phone} or request a free valuation above and your local team will be in touch.`
    : `Yes. ${p.name} is covered by our ${o.name} office. Call ${o.phone} or request a free valuation above and a local expert will be in touch.`],
  ['Is the valuation really free?', 'Yes. Your valuation or rental appraisal is free and there is no obligation to instruct us afterwards.'],
  [`How much does it cost to sell or let in ${p.name}?`, 'Fees depend on the service and your property. You will get a clear written quote after your free valuation, so there are no surprises.'],
  ['Will my property be on Rightmove?', 'Yes. We market properties on Rightmove and on our own property search, with 360\u00b0 virtual tours on sales listings where available.'],
  [`Can I search for properties in ${p.name} on your website?`, `Yes. Use our property search to see homes for sale and to let in ${p.name}, with photos, maps and virtual tours.`]
];

const townPage = p => {
  const o = officeById[p.office], own = p.office === p.slug, file = fileOf(p);
  const title = `Estate Agents in ${p.name} | Sales & Lettings | My Property Box`;
  const desc = `Estate and letting agents in ${p.name}. Free valuations and rental appraisals, homes for sale and to let, and 360\u00b0 virtual tours. Call ${o.phone}.`;
  const faq = faqs(p, o);
  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'RealEstateAgent',
      name: `My Property Box ${o.name}`, telephone: tel(o.phone), url: 'https://www.mypropertybox.co.uk/',
      areaServed: { '@type': 'City', name: p.name },
      parentOrganization: { '@type': 'Organization', name: 'My Property Box Ltd', url: 'https://www.mypropertybox.co.uk/' }
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
    }
  ];
  const q = p.match[0];
  const src = `town-${p.slug}`;
  const near = p.near.map(s => bySlug[s]);

  return head({ title, desc, file, ld }) + `
<main id="main">

  <section class="hero lp-hero" id="start">
    ${HERO_IMG}
    <div class="wrap hero-inner lp-grid">
      <div class="lp-copy">
        <p class="eyebrow">Estate &amp; letting agents &middot; ${esc(p.name)}</p>
        <h1>Estate agents in <em>${esc(p.name)}.</em></h1>
        <p class="lead">Selling or letting in ${esc(p.name)}? ${own ? `Your local ${esc(o.name)} team` : `Our ${esc(o.name)} team`} offers free valuations and rental appraisals, and markets properties on Rightmove and our own search with 360&deg; virtual tours.</p>
        <ul class="lp-pts">
          <li><svg class="ic"><use href="#i-check"/></svg>Free, no-obligation valuations and rental appraisals</li>
          <li><svg class="ic"><use href="#i-pin"/></svg><span>${own ? `Your local ${esc(o.name)} office` : `Covered by our ${esc(o.name)} office`}: <a href="tel:${tel(o.phone)}" data-office="${o.id}">${o.phone}</a></span></li>
          <li><svg class="ic"><use href="#i-360"/></svg>Listed on Rightmove and our own property search</li>
        </ul>
        ${MINI}
      </div>

      <form class="wz lp-card" id="get-started" data-source="${src}" data-town="${esc(p.name)}" data-office="${esc(o.name)}" novalidate aria-label="Free valuation request for ${esc(p.name)}">
        <div class="wz-pane">
          <h3 tabindex="-1">Free valuation in ${esc(p.name)}</h3>
          <p class="wz-sub">Selling or letting? Tell us where to reach you and a local expert will be in touch.</p>
          <div class="fgrid">
            <div class="fld full"><span class="lbl">I want to</span>
              <div class="chips chips-sm" role="radiogroup" aria-label="Sell or let">
                <label class="chip"><input type="radio" name="intent" value="sell" checked><span>Sell my home</span></label>
                <label class="chip"><input type="radio" name="intent" value="let"><span>Let my property</span></label>
              </div>
            </div>
            <label class="fld full"><span class="lbl">Property postcode or town</span><span class="inp"><input type="text" name="location" value="${esc(p.name)}" placeholder="e.g. DL1 5NA" autocomplete="off" required data-msg="Please tell us where the property is."></span><span class="hint wz-cover" data-cover aria-live="polite"></span></label>
            <label class="fld full"><span class="lbl">Full name</span><span class="inp"><input type="text" name="name" autocomplete="name" required data-msg="Please enter your name."></span></label>
            <label class="fld"><span class="lbl">Email</span><span class="inp"><input type="email" name="email" autocomplete="email" inputmode="email" required data-v="email" data-msg="Please enter your email address."></span></label>
            <label class="fld"><span class="lbl">Phone</span><span class="inp"><input type="tel" name="phone" autocomplete="tel" inputmode="tel" required data-v="phone" data-msg="Please enter a phone number so we can arrange your visit."></span></label>
            <div class="fld full"><span class="lbl">Best way to reach you</span>
              <div class="chips chips-sm" role="radiogroup" aria-label="Preferred contact method">
                <label class="chip"><input type="radio" name="contact_pref" value="phone" checked><span>Phone</span></label>
                <label class="chip"><input type="radio" name="contact_pref" value="email"><span>Email</span></label>
                <label class="chip"><input type="radio" name="contact_pref" value="text"><span>Text message</span></label>
              </div>
            </div>
          </div>
          <label class="ck"><input type="checkbox" name="consent" value="yes" required data-msg="Please tick the box to confirm you're happy for us to contact you."><span class="box"><svg class="ic"><use href="#i-check"/></svg></span><span class="ck-t"><small>I agree to My Property Box contacting me about this request. My details will be used as set out in the <a href="https://www.mypropertybox.co.uk/privacy/" target="_blank" rel="noopener">Privacy Policy</a>.</small></span></label>
          <label class="ck"><input type="checkbox" name="marketing" value="yes"><span class="box"><svg class="ic"><use href="#i-check"/></svg></span><span class="ck-t"><small>Send me occasional property market updates. <em>(Optional)</em></small></span></label>
          <input type="text" name="company_website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        </div>

        <p class="wz-err" data-err role="alert"></p>
        <div class="wz-nav">
          <button type="submit" class="btn btn-navy" data-next><span data-next-txt>Get my free valuation</span><svg class="ic"><use href="#i-arrow"/></svg></button>
        </div>
        <p class="lp-trust"><svg class="ic"><use href="#i-shield"/></svg> Free &middot; No obligation &middot; Your details stay private</p>
        <p class="call-note">Prefer to talk? <button type="button" data-call="${o.id}">Call ${esc(o.name)} on ${o.phone}</button></p>

        <div class="wz-done" data-done tabindex="-1" hidden>
          <span class="done-ic"><svg class="ic"><use href="#i-check"/></svg></span>
          <h3 data-done-title>Thank you</h3>
          <p data-done-msg></p>
          <p class="wz-preview" data-preview hidden>Preview mode: no lead destination is connected yet, so this request was not sent.</p>
          <div class="row">
            <a class="btn btn-navy" href="properties.html?section=sales&amp;q=${encodeURIComponent(q)}">Homes for sale in ${esc(p.name)}</a>
            <a class="btn btn-line" href="properties.html?section=lets&amp;q=${encodeURIComponent(q)}">Properties to let</a>
          </div>
        </div>
      </form>
    </div>
  </section>

  <section class="trust lp-trust-strip" id="tnStats" aria-label="${esc(p.name)} at a glance" hidden>
    <div class="wrap stats">
      <div class="stats-grid">
        <div data-stat="sales"><b>0</b><small>Homes for sale in ${esc(p.name)}</small></div>
        <div data-stat="lets"><b>0</b><small>Properties to let in ${esc(p.name)}</small></div>
        <div data-stat="third" class="tn-word"><b>Rightmove</b><small>Plus our own property search</small></div>
        <div><b>&pound;0</b><small>Cost of your valuation</small></div>
      </div>
    </div>
  </section>

  <section class="section" id="homes" aria-labelledby="homes-title">
    <div class="wrap" id="tnLive" data-match="${esc(p.match.join('|'))}" data-town="${esc(p.name)}" data-q="${esc(q)}">
      <header class="sec-head">
        <p class="kicker">Property in ${esc(p.name)}</p>
        <h2 id="homes-title">Latest in <em>${esc(p.name)}.</em></h2>
        <p class="sub">Fresh from our property search. Open any listing for photos, a map, virtual tours where available, and to request a viewing.</p>
      </header>
      <div class="tn-block" data-listings="sales">
        <div class="tn-head"><h3>Homes for sale in ${esc(p.name)}</h3><a class="tn-all" href="properties.html?section=sales&amp;q=${encodeURIComponent(q)}">Search all &rarr;</a></div>
        <div class="pg-grid" aria-live="polite"></div>
      </div>
      <div class="tn-block" data-listings="lets">
        <div class="tn-head"><h3>Properties to let in ${esc(p.name)}</h3><a class="tn-all" href="properties.html?section=lets&amp;q=${encodeURIComponent(q)}">Search all &rarr;</a></div>
        <div class="pg-grid" aria-live="polite"></div>
      </div>
    </div>
  </section>

  <section class="section alt" aria-label="Free valuation">
    <div class="wrap">
      <div class="lp-magnet">
        <div>
          <p class="kicker">Own a property in ${esc(p.name)}?</p>
          <h2>Find out what it could <em>achieve.</em></h2>
          <p>A free, no-obligation sales valuation or rental appraisal from your local team. It takes about a minute to ask.</p>
        </div>
        <div class="row">
          <a class="btn btn-mint" href="#get-started" data-set="sell">Value my home</a>
          <a class="btn btn-ghost" href="#get-started" data-set="let">Appraise my rental</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="how" aria-labelledby="how-title">
    <div class="wrap">
      <header class="sec-head">
        <p class="kicker">How we help</p>
        <h2 id="how-title">Whether you are selling, letting <em>or renting out.</em></h2>
        <p class="sub">Local advice for ${esc(p.name)} vendors, landlords and tenants.</p>
      </header>
      <div class="lp-benefits">
        <article><svg class="ic"><use href="#i-home"/></svg><h3>Selling in ${esc(p.name)}</h3><p>A free valuation from a local expert, then a clear plan to sell. Your home is marketed on Rightmove and our own property search.</p><a class="more" href="sell.html">How selling works <svg class="ic"><use href="#i-arrow"/></svg></a></article>
        <article><svg class="ic"><use href="#i-key"/></svg><h3>Letting in ${esc(p.name)}</h3><p>A free rental appraisal, then the level of service that suits you, whether you want help finding a tenant or full management.</p><a class="more" href="let.html">How letting works <svg class="ic"><use href="#i-arrow"/></svg></a></article>
        <article><svg class="ic"><use href="#i-shield"/></svg><h3>Landlord services</h3><p>Compare our services, switch agents with minimal fuss, and check your rental is compliant with our free guided checklist.</p><a class="more" href="landlords.html">Landlord services <svg class="ic"><use href="#i-arrow"/></svg></a></article>
      </div>
    </div>
  </section>

  <section class="section alt" id="office" aria-labelledby="office-title">
    <div class="wrap tn-office">
      <div>
        <header class="sec-head">
          <p class="kicker">Your local team</p>
          <h2 id="office-title">${own ? `Our ${esc(o.name)} <em>office.</em>` : `Covered by our <em>${esc(o.name)}</em> office.`}</h2>
          <p class="sub">${own ? `Call the ${esc(o.name)} team` : `${esc(p.name)} is looked after by our ${esc(o.name)} team, who cover ${esc(p.covers)}. Call them`}, or ask for a callback and we will ring you.</p>
        </header>
        ${near.length ? `<div class="tn-also">
          <h3>Also covering</h3>
          <div class="lp-areas">
            ${near.map(n => `<a href="${fileOf(n)}"><svg class="ic"><use href="#i-pin"/></svg>${esc(n.name)}</a>`).join('\n            ')}
          </div>
        </div>` : ''}
      </div>
      <div class="tn-card">
        <p class="kicker">${esc(o.name)} office</p>
        <h3>${esc(o.area.replace(/ & /g, ' and '))}</h3>
        <a class="tn-phone" href="tel:${tel(o.phone)}" data-office="${o.id}">${o.phone}</a>
        <p>Speak to your local team about selling, letting or managing a property.</p>
        <div class="row">
          <a class="btn btn-navy" href="tel:${tel(o.phone)}" data-office="${o.id}">Call ${esc(o.name)}</a>
          <button type="button" class="btn btn-line" data-call="${o.id}" data-callback="true">Request a callback</button>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="faq" aria-labelledby="faq-title">
    <div class="wrap lp-faq-wrap">
      <header class="sec-head">
        <p class="kicker">Questions</p>
        <h2 id="faq-title">Before you <em>decide.</em></h2>
        <p class="sub">Straight answers to what ${esc(p.name)} customers ask us most.</p>
      </header>
      <div>
        <div class="lp-faq">
          ${faq.map(([qn, a]) => `<details><summary>${esc(qn)}</summary><p>${esc(a)}</p></details>`).join('\n          ')}
        </div>
      </div>
    </div>
  </section>

${ctaBand(`Ready to talk to a <em>${esc(p.name)}</em> expert?`, 'Free, no-obligation, and handled by your local team.', '<a class="btn btn-mint" href="#get-started" data-set="sell">Get my free valuation</a>', `<a class="btn btn-ghost" href="tel:${tel(o.phone)}" data-office="${o.id}">Call ${o.phone}</a>`)}
</main>
` + tail('#get-started');
};

// ---- Areas index ----
const areasPage = () => {
  const file = 'areas.html';
  const title = 'Areas We Cover | Estate & Letting Agents in the North | My Property Box';
  const desc = 'Estate and letting agents across the North East, North Yorkshire and Cumbria. Find your local My Property Box office and the towns it covers.';
  const cards = OFFICES.map(o => {
    const own = bySlug[o.id];
    const towns = [own, ...PAGES.filter(p => p.office === o.id && p !== own)].filter(Boolean);
    return `<article class="tn-card">
          <p class="kicker">${esc(o.name)} office</p>
          <h3>${esc(o.area.replace(/ & /g, ' and '))}</h3>
          <a class="tn-phone" href="tel:${tel(o.phone)}" data-office="${o.id}">${o.phone}</a>
          <ul class="tn-links">
            ${towns.map(t => `<li><a href="${fileOf(t)}">Estate agents in ${esc(t.name)} <svg class="ic"><use href="#i-arrow"/></svg></a></li>`).join('\n            ')}
          </ul>
        </article>`;
  });
  const html = head({ title, desc, file }) + `
<main id="main">

  <section class="hero lp-hero" id="start">
    ${HERO_IMG}
    <div class="wrap hero-inner">
      <div class="lp-copy">
        <p class="eyebrow">Areas we cover</p>
        <h1>Local experts, <em>wherever you are</em> in the North.</h1>
        <p class="lead">My Property Box looks after sales and lettings across the North East, North Yorkshire and Cumbria. Find your nearest office and the towns it covers.</p>
        <div class="row">
          <a class="btn btn-mint" href="index.html#valuation">Get my free valuation</a>
          <a class="btn btn-ghost" href="properties.html">Search properties</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="offices" aria-labelledby="offices-title">
    <div class="wrap">
      <header class="sec-head">
        <p class="kicker">Our offices</p>
        <h2 id="offices-title">Find your <em>local team.</em></h2>
        <p class="sub">Choose your nearest town for homes for sale and to let, a free valuation, and your local office number.</p>
      </header>
      <div class="tn-hubs">
        ${cards.join('\n        ')}
      </div>
    </div>
  </section>

${ctaBand('Not sure which office is <em>yours?</em>', 'Tell us where your property is and we will match you with the right local team.', '<a class="btn btn-mint" href="index.html#valuation">Get my free valuation</a>', '<button type="button" class="btn btn-ghost" data-call>Call us</button>')}
</main>
` + tail('index.html#valuation');
  // The header's Free Valuation button points at this page's form on the town pages; there is no form here
  return html.replace(/href="#get-started"/g, 'href="index.html#valuation"');
};

PAGES.forEach(p => write(fileOf(p), townPage(p)));
write('areas.html', areasPage());
console.log(`Wrote ${PAGES.length} town pages and areas.html`);
