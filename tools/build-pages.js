#!/usr/bin/env node
// Generates the town and area landing pages (estate-agents-<slug>.html), areas.html, the HMO, student, contact,
// about and tenants pages, and the legal, careers and payments pages.
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

// ---- Lead form shared by town and service pages (behaviour lives in town.js) ----
const leadForm = o => `      <form class="wz lp-card" id="get-started" data-source="${o.source}"${o.town ? ` data-town="${esc(o.town)}"` : ''}${o.office ? ` data-office="${esc(o.office)}"` : ''}${o.fixedCta ? ` data-label="${esc(o.fixedCta)}"` : ''} novalidate aria-label="${esc(o.label)}">
        <div class="wz-pane">
          <h3 tabindex="-1">${esc(o.heading)}</h3>
          <p class="wz-sub">${esc(o.sub)}</p>
          <div class="fgrid">
            ${o.intent}
            <label class="fld full"><span class="lbl">${esc(o.locLabel || 'Property postcode or town')}</span><span class="inp"><input type="text" name="location" value="${esc(o.location || '')}" placeholder="e.g. DL1 5NA" autocomplete="off"${o.locOptional ? '' : ' required data-msg="Please tell us where the property is."'}></span><span class="hint wz-cover" data-cover aria-live="polite"></span></label>
            <label class="fld full"><span class="lbl">Full name</span><span class="inp"><input type="text" name="name" autocomplete="name" required data-msg="Please enter your name."></span></label>
            <label class="fld"><span class="lbl">Email</span><span class="inp"><input type="email" name="email" autocomplete="email" inputmode="email" required data-v="email" data-msg="Please enter your email address."></span></label>
            <label class="fld"><span class="lbl">Phone</span><span class="inp"><input type="tel" name="phone" autocomplete="tel" inputmode="tel" required data-v="phone" data-msg="${esc(o.phoneMsg || 'Please enter a phone number so we can arrange your visit.')}"></span></label>
            <div class="fld full"><span class="lbl">Best way to reach you</span>
              <div class="chips chips-sm" role="radiogroup" aria-label="Preferred contact method">
                <label class="chip"><input type="radio" name="contact_pref" value="phone" checked><span>Phone</span></label>
                <label class="chip"><input type="radio" name="contact_pref" value="email"><span>Email</span></label>
                <label class="chip"><input type="radio" name="contact_pref" value="text"><span>Text message</span></label>
              </div>
            </div>
          </div>
          <label class="ck"><input type="checkbox" name="consent" value="yes" required data-msg="Please tick the box to confirm you're happy for us to contact you."><span class="box"><svg class="ic"><use href="#i-check"/></svg></span><span class="ck-t"><small>I agree to My Property Box contacting me about this request. My details will be used as set out in the <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</small></span></label>
          <label class="ck"><input type="checkbox" name="marketing" value="yes"><span class="box"><svg class="ic"><use href="#i-check"/></svg></span><span class="ck-t"><small>Send me occasional property market updates. <em>(Optional)</em></small></span></label>
          <input type="text" name="company_website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        </div>

        <p class="wz-err" data-err role="alert"></p>
        <div class="wz-nav">
          <button type="submit" class="btn btn-navy" data-next><span data-next-txt>${esc(o.cta)}</span><svg class="ic"><use href="#i-arrow"/></svg></button>
        </div>
        <p class="lp-trust"><svg class="ic"><use href="#i-shield"/></svg> Free &middot; No obligation &middot; Your details stay private</p>
        <p class="call-note">Prefer to talk? ${o.call}</p>

        <div class="wz-done" data-done tabindex="-1" hidden>
          <span class="done-ic"><svg class="ic"><use href="#i-check"/></svg></span>
          <h3 data-done-title>Thank you</h3>
          <p data-done-msg></p>
          <p class="wz-preview" data-preview hidden>Preview mode: no lead destination is connected yet, so this request was not sent.</p>
          <div class="row">
            ${o.done}
          </div>
        </div>
      </form>`;

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

${leadForm({
    source: src, town: p.name, office: o.name,
    label: `Free valuation request for ${p.name}`,
    heading: `Free valuation in ${p.name}`,
    sub: 'Selling or letting? Tell us where to reach you and a local expert will be in touch.',
    intent: `<div class="fld full"><span class="lbl">I want to</span>
              <div class="chips chips-sm" role="radiogroup" aria-label="Sell or let">
                <label class="chip"><input type="radio" name="intent" value="sell" checked><span>Sell my home</span></label>
                <label class="chip"><input type="radio" name="intent" value="let"><span>Let my property</span></label>
              </div>
            </div>`,
    location: p.name,
    cta: 'Get my free valuation',
    call: `<button type="button" data-call="${o.id}">Call ${esc(o.name)} on ${o.phone}</button>`,
    done: `<a class="btn btn-navy" href="properties.html?section=sales&amp;q=${encodeURIComponent(q)}">Homes for sale in ${esc(p.name)}</a>
            <a class="btn btn-line" href="properties.html?section=lets&amp;q=${encodeURIComponent(q)}">Properties to let</a>`
  })}
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

// ---- HMO and student pages (landlord lead capture) ----
const GENERAL = 'General guidance for landlords in England, not legal advice. Check the rules that apply to your property with your local council or a qualified adviser.';
const faqLd = faq => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
});
const benefit = ([ic, h, p, link]) => `<article><svg class="ic"><use href="#i-${ic}"/></svg><h3>${esc(h)}</h3><p>${esc(p)}</p>${link ? `<a class="more" href="${link[0]}"${/^https?:/.test(link[0]) ? ' target="_blank" rel="noopener"' : ''}>${esc(link[1])} <svg class="ic"><use href="#i-arrow"/></svg></a>` : ''}</article>`;

const servicePage = c => {
  const toForm = c.form ? '#get-started' : 'index.html#valuation';
  const html = head({ title: c.title, desc: c.desc, file: c.file, ld: [faqLd(c.faq)] }) + `
<main id="main">

  <section class="hero lp-hero" id="start">
    ${HERO_IMG}
    <div class="wrap hero-inner${c.form ? ' lp-grid' : ''}">
      <div class="lp-copy">
        <p class="eyebrow">${c.eyebrow}</p>
        <h1>${c.h1}</h1>
        <p class="lead">${esc(c.lead)}</p>
        <ul class="lp-pts">
          ${c.pts.map(([ic, t]) => `<li><svg class="ic"><use href="#i-${ic}"/></svg>${t}</li>`).join('\n          ')}
        </ul>${c.form ? '' : `
        <div class="row">
          ${c.heroRow}
        </div>`}
        ${MINI}
      </div>
${c.form ? `
${leadForm(c.form)}
` : ''}    </div>
  </section>
${c.live || ''}${c.info ? `
  <section class="section" id="info" aria-labelledby="info-title">
    <div class="wrap">
      <header class="sec-head">
        <p class="kicker">${esc(c.info.kicker)}</p>
        <h2 id="info-title">${c.info.h2}</h2>
        <p class="sub">${esc(c.info.sub)}</p>
      </header>
      <div class="lp-benefits${c.info.four ? ' four' : ''}">
        ${c.info.cards.map(benefit).join('\n        ')}
      </div>${c.info.note ? `
      <p class="lp-tier-note">${esc(c.info.note)}</p>` : ''}
    </div>
  </section>
` : ''}${c.magnet ? `
  <section class="section alt" aria-label="${esc(c.magnet.kicker)}">
    <div class="wrap">
      <div class="lp-magnet">
        <div>
          <p class="kicker">${esc(c.magnet.kicker)}</p>
          <h2>${c.magnet.h2}</h2>
          <p>${esc(c.magnet.p)}</p>
        </div>
        <div class="row">
          <a class="btn btn-mint" href="${toForm}">${esc(c.magnet.cta)}</a>
          <a class="btn btn-ghost" href="${c.magnet.second[0]}">${esc(c.magnet.second[1])}</a>
        </div>
      </div>
    </div>
  </section>
` : ''}${c.more ? `
  <section class="section" id="more" aria-labelledby="more-title">
    <div class="wrap">
      <header class="sec-head">
        <p class="kicker">${esc(c.more.kicker)}</p>
        <h2 id="more-title">${c.more.h2}</h2>
        <p class="sub">${esc(c.more.sub)}</p>
      </header>
      <div class="lp-benefits${c.more.four ? ' four' : ''}">
        ${c.more.cards.map(benefit).join('\n        ')}
      </div>
    </div>
  </section>
` : ''}
  <section class="section${c.more ? ' alt' : ''}" id="faq" aria-labelledby="faq-title">
    <div class="wrap lp-faq-wrap">
      <header class="sec-head">
        <p class="kicker">Questions</p>
        <h2 id="faq-title">${c.faqH2 || 'Before you <em>decide.</em>'}</h2>
        <p class="sub">${esc(c.faqSub)}</p>
      </header>
      <div>
        <div class="lp-faq">
          ${c.faq.map(([qn, a]) => `<details><summary>${esc(qn)}</summary><p>${esc(a)}</p></details>`).join('\n          ')}
        </div>
      </div>
    </div>
  </section>

${ctaBand(c.cta.h2, c.cta.p, c.cta.primary, c.cta.second)}
</main>
` + tail(toForm);
  // Pages without a form send the header and floating buttons to the homepage valuation form
  return c.form ? html : html.replace(/href="#get-started"/g, 'href="index.html#valuation"');
};

const CALL_US = '<button type="button" data-call>Call your local office</button>';
const hiddenIntent = v => `<input type="hidden" name="intent" value="${v}">`;

const officeCards = () => OFFICES.map(o => {
  const own = bySlug[o.id];
  return `<article class="tn-card">
          <p class="kicker">${esc(o.name)} office</p>
          <h3>${esc(o.area.replace(/ & /g, ' and '))}</h3>
          <a class="tn-phone" href="tel:${tel(o.phone)}" data-office="${o.id}">${o.phone}</a>${own ? `
          <ul class="tn-links">
            <li><a href="${fileOf(own)}">Estate agents in ${esc(own.name)} <svg class="ic"><use href="#i-arrow"/></svg></a></li>
          </ul>` : ''}
        </article>`;
}).join('\n        ');

const REGISTERED = 'My Property Box Ltd is registered in England & Wales. Registered office: Alton House, 27-31 Grange Road, Darlington, County Durham, DL1 5NA. Company number 08140860.';

const SERVICE_PAGES = [
  {
    file: 'hmo.html',
    title: 'HMO Landlords | Lettings & Management | My Property Box',
    desc: 'Letting or managing an HMO or multi-let property in the North East, North Yorkshire or Cumbria? Get a free management review from My Property Box.',
    eyebrow: 'HMO &amp; multi-let landlords',
    h1: 'Lettings and management for <em>HMO landlords.</em>',
    lead: 'Shared houses and multi-let properties come with more rules and more to manage. Tell us about your property and a local expert will talk through your options.',
    pts: [
      ['check', 'Free, no-obligation management review'],
      ['pin', 'Local teams across the North East, North Yorkshire and Cumbria'],
      ['shield', '<a href="landlords.html#health">Free guided compliance check for landlords</a>']
    ],
    form: {
      source: 'hmo', label: 'Free HMO management review request', heading: 'Free HMO management review',
      sub: 'Tell us about your property and where to reach you. A local expert will be in touch.',
      intent: hiddenIntent('manage'), cta: 'Get my free management review', call: CALL_US,
      done: '<a class="btn btn-navy" href="landlords.html">Landlord services</a>\n            <a class="btn btn-line" href="landlords.html#health">Free compliance check</a>'
    },
    info: {
      kicker: 'HMO essentials', note: GENERAL, h2: 'The essentials, <em>at a glance.</em>',
      sub: 'Requirements depend on your property and your council, so always check the details that apply to you.',
      cards: [
        ['key', 'Licensing', 'Larger HMOs need a mandatory licence, and many councils also run additional or selective licensing schemes. Rules differ by council, so check yours before you let.'],
        ['bolt', 'Fire safety', 'Working smoke and heat alarms, clear escape routes and, in many HMOs, fire doors and emergency lighting. A fire risk assessment is a sensible starting point.'],
        ['shield', 'Gas and electrical safety', 'A gas safety certificate every year where there is a gas supply, and an electrical installation condition report at least every five years.'],
        ['home', 'Room sizes and facilities', 'Minimum bedroom sizes, plus enough kitchens, bathrooms and toilets for the number of people living there.'],
        ['check', 'Management duties', 'HMO managers have extra duties, including keeping shared areas clean and safe, maintaining facilities and giving tenants an emergency contact.'],
        ['pin', 'Tenancies and deposits', 'Protect deposits in a government-approved scheme, give the prescribed information, and carry out right to rent checks.']
      ]
    },
    magnet: {
      kicker: 'Own an HMO?', h2: 'Let us take a look at <em>your property.</em>',
      p: 'A free, no-obligation management review from your local team. It takes about a minute to ask.',
      cta: 'Get my free review', second: ['landlords.html#health', 'Free compliance check']
    },
    more: {
      kicker: 'How we help', h2: 'Support for <em>landlords.</em>', sub: 'Everything for landlords in one place.',
      cards: [
        ['key', 'Landlord services', 'Compare our landlord services and see how switching agents works.', ['landlords.html', 'Landlord services']],
        ['shield', 'Free compliance check', 'Work through our guided checklist and see where your rental stands.', ['landlords.html#health', 'Start the check']],
        ['pin', 'Your local office', 'Find your nearest office and speak to the team that covers your area.', ['areas.html', 'Areas we cover']]
      ]
    },
    faqSub: 'Straight answers to what HMO landlords ask us most.',
    faq: [
      ['What is an HMO?', 'In England, a house in multiple occupation (HMO) is generally a property let to three or more people who are not from the same household and who share facilities such as a kitchen or bathroom.'],
      ['Do I need a licence for my HMO?', 'Larger HMOs, generally those let to five or more people from more than one household, need a mandatory licence. Many councils also require licences for smaller HMOs. Check with your local council.'],
      ['Is the management review really free?', 'Yes. Your management review is free and there is no obligation to instruct us afterwards.'],
      ['Is this legal advice?', GENERAL]
    ],
    cta: {
      h2: 'Ready to talk about your <em>HMO?</em>', p: 'Free, no-obligation, and handled by your local team.',
      primary: '<a class="btn btn-mint" href="#get-started">Get my free review</a>',
      second: '<button type="button" class="btn btn-ghost" data-call>Call us</button>'
    }
  },
  {
    file: 'student.html',
    title: 'Student Lets | Student Properties & Landlord Appraisals | My Property Box',
    desc: 'Browse current student properties, or get a free rental appraisal for your student let from My Property Box.',
    eyebrow: 'Student lets',
    h1: 'Student lets, <em>made simple.</em>',
    lead: 'Looking for a student home, or letting a property to students? Browse our current student properties, or tell us about yours for a free rental appraisal.',
    pts: [
      ['home', 'Browse current student properties, with rent shown per person per week'],
      ['check', 'Free, no-obligation rental appraisal for landlords'],
      ['pin', 'Local teams across the North East, North Yorkshire and Cumbria']
    ],
    form: {
      source: 'student', label: 'Free student-let rental appraisal request', heading: 'Free student-let appraisal',
      sub: 'Landlords: tell us about your property and where to reach you. A local expert will be in touch.',
      intent: hiddenIntent('let'), cta: 'Get my free rental appraisal', call: CALL_US,
      done: '<a class="btn btn-navy" href="properties.html?section=students">Search student properties</a>\n            <a class="btn btn-line" href="landlords.html">Landlord services</a>'
    },
    live: `
  <section class="section" id="homes" aria-labelledby="homes-title">
    <div class="wrap" id="tnLive">
      <header class="sec-head">
        <p class="kicker">Student properties</p>
        <h2 id="homes-title">Available <em>now.</em></h2>
        <p class="sub">Our latest student lets. Open any listing for photos, a map and to request a viewing.</p>
      </header>
      <div class="tn-block" data-listings="students">
        <div class="tn-head"><h3>Latest student properties</h3><a class="tn-all" href="properties.html?section=students">Search all &rarr;</a></div>
        <div class="pg-grid" aria-live="polite"></div>
      </div>
    </div>
  </section>
`,
    info: {
      kicker: 'For landlords', note: GENERAL, h2: 'Letting to students? <em>Know the basics.</em>',
      sub: 'A few things worth knowing before you let a property to students.',
      cards: [
        ['key', 'Tenancies and guarantors', 'Students often rent as a group. A joint tenancy makes everyone responsible for the whole rent, and many landlords ask for a guarantor.'],
        ['pin', 'Plan around the academic year', 'Student lets often follow the academic year, so it pays to start early.'],
        ['shield', 'HMO rules', 'A house let to three or more sharing students may be an HMO, with extra licensing and safety rules.', ['hmo.html', 'HMO landlords']]
      ]
    },
    magnet: {
      kicker: 'Own a student property?', h2: 'Find out what it could <em>achieve.</em>',
      p: 'A free, no-obligation rental appraisal from your local team. It takes about a minute to ask.',
      cta: 'Get my free appraisal', second: ['landlords.html', 'Landlord services']
    },
    faqSub: 'Straight answers to what students and landlords ask us most.',
    faq: [
      ['Are student properties HMOs?', 'Often, yes. A property let to three or more students sharing facilities may be an HMO, so licensing and safety rules can apply. See our HMO page for more.'],
      ['How is student rent shown?', 'Student rents are usually shown per person per week (pppw). Our property search shows this where the listing provides it.'],
      ['Is the rental appraisal free?', 'Yes. Your rental appraisal is free and there is no obligation to instruct us afterwards.'],
      ['Is this legal advice?', GENERAL]
    ],
    cta: {
      h2: 'Find a student home, <em>or let yours.</em>', p: 'Search our student properties, or ask for a free rental appraisal.',
      primary: '<a class="btn btn-mint" href="properties.html?section=students">Search student properties</a>',
      second: '<a class="btn btn-ghost" href="#get-started">Get my free appraisal</a>'
    }
  },
  {
    file: 'contact.html',
    title: 'Contact Us | Offices & Phone Numbers | My Property Box',
    desc: 'Contact your local My Property Box office. Call us, or send an enquiry about selling, letting, landlord services or renting a home.',
    eyebrow: 'Contact us',
    h1: 'Get in <em>touch.</em>',
    lead: 'Call your local office, or send us an enquiry and the right local team will get back to you.',
    pts: [
      ['pin', 'Local offices across the North East, North Yorkshire and Cumbria'],
      ['check', 'Free valuations and rental appraisals'],
      ['home', 'Selling, letting, landlord services or renting: we can help']
    ],
    form: {
      source: 'contact', label: 'Contact enquiry', heading: 'Send us an enquiry',
      sub: 'Tell us how we can help and where to reach you.',
      intent: `<div class="fld full"><span class="lbl">I am interested in</span>
              <div class="chips chips-sm" role="radiogroup" aria-label="What can we help with">
                <label class="chip"><input type="radio" name="intent" value="sell" required data-msg="Please choose what we can help with."><span>Selling</span></label>
                <label class="chip"><input type="radio" name="intent" value="let"><span>Letting</span></label>
                <label class="chip"><input type="radio" name="intent" value="manage"><span>Landlord services</span></label>
                <label class="chip"><input type="radio" name="intent" value="rent"><span>Renting a home</span></label>
                <label class="chip"><input type="radio" name="intent" value="other"><span>Something else</span></label>
              </div>
            </div>`,
      locLabel: 'Postcode or town (optional)', locOptional: true,
      phoneMsg: 'Please enter a phone number so we can get back to you.',
      cta: 'Send my enquiry', fixedCta: 'Send my enquiry', call: CALL_US,
      done: '<a class="btn btn-navy" href="properties.html">Search properties</a>\n            <a class="btn btn-line" href="areas.html">Areas we cover</a>'
    },
    live: `
  <section class="section" id="offices" aria-labelledby="offices-title">
    <div class="wrap">
      <header class="sec-head">
        <p class="kicker">Our offices</p>
        <h2 id="offices-title">Call your <em>local team.</em></h2>
        <p class="sub">Choose the office nearest to you, or the one that covers your area.</p>
      </header>
      <div class="tn-hubs">
        ${officeCards()}
      </div>
      <p class="lp-tier-note">${esc(REGISTERED)}</p>
    </div>
  </section>
`,
    faqH2: 'Common <em>questions.</em>',
    faqSub: 'Quick answers before you get in touch.',
    faq: [
      ['Which office should I contact?', 'Call the office closest to your property, or find the office for your area on our Areas we cover page.'],
      ['How do I get a valuation?', 'Use the free valuation form on our homepage, or send an enquiry above. Your valuation or rental appraisal is free with no obligation.'],
      ['Can I arrange a viewing online?', 'Yes. Open any property in our search and use the viewing request form. Your local team will confirm the time with you.'],
      ['Where is your registered office?', REGISTERED]
    ],
    cta: {
      h2: 'Prefer to <em>talk it through?</em>', p: 'Call your local office and speak to the team that covers your area.',
      primary: '<button type="button" class="btn btn-mint" data-call>Call us</button>',
      second: '<a class="btn btn-ghost" href="areas.html">Areas we cover</a>'
    }
  },
  {
    file: 'tenants.html',
    title: 'Tenants | Homes to Rent & Student Properties | My Property Box',
    desc: 'Find homes to rent and student properties across the North East, North Yorkshire and Cumbria, request a viewing online, or contact your local My Property Box office.',
    eyebrow: 'Tenants',
    h1: 'Find your next <em>rental.</em>',
    lead: 'Search homes to rent across the North East, North Yorkshire and Cumbria, request a viewing online, or call your local office.',
    pts: [
      ['home', 'Search homes to rent, with photos and maps'],
      ['cal', 'Request a viewing straight from any listing'],
      ['users', 'Student properties shown with rent per person per week']
    ],
    heroRow: '<a class="btn btn-mint" href="properties.html?section=lets">Search properties to let</a>\n          <a class="btn btn-ghost" href="properties.html?section=students">Student properties</a>',
    info: {
      kicker: 'For tenants', h2: 'Everything for <em>renting.</em>', four: true,
      sub: 'Find a home, get in touch, or make a payment.',
      cards: [
        ['search', 'Find a home', 'Search all of our properties to let, with photos, maps and key details.', ['properties.html?section=lets', 'Properties to let']],
        ['users', 'Student properties', 'Browse student lets, with rent shown per person per week where available.', ['properties.html?section=students', 'Student properties']],
        ['pin', 'Already renting with us?', 'Call the office that looks after your area. You will find every office number on our contact page.', ['contact.html#offices', 'Contact your office']],
        ['key', 'Online payments', 'Use our online payments page. Not sure which payment applies to you? Call your local office.', ['payments.html', 'Online payments']]
      ]
    },
    magnet: {
      kicker: 'Landlord?', h2: 'Own a property you could <em>let out?</em>',
      p: 'Get a free, no-obligation rental appraisal from your local team.',
      cta: 'Get my free rental appraisal', second: ['landlords.html', 'Landlord services']
    },
    faqH2: 'Common <em>questions.</em>',
    faqSub: 'Quick answers for tenants.',
    faq: [
      ['How do I arrange a viewing?', 'Open any property to let and use the viewing request form. Your local team will confirm the time with you.'],
      ['How is rent shown?', 'Rent is usually shown per calendar month (pcm). Student properties are usually shown per person per week (pppw).'],
      ['Who do I contact if I already rent with you?', 'Call your local office. You will find the number for your area on our contact page.'],
      ['Where can I make an online payment?', 'Use our online payments page. If you are not sure which payment applies to you, please call your local office.']
    ],
    cta: {
      h2: 'Find your next <em>home.</em>', p: 'Search our properties to let, or get in touch with your local office.',
      primary: '<a class="btn btn-mint" href="properties.html?section=lets">Search properties to let</a>',
      second: '<a class="btn btn-ghost" href="contact.html">Contact us</a>'
    }
  },
  {
    file: 'about.html',
    title: 'About Us | Estate & Letting Agents | My Property Box',
    desc: 'My Property Box is an estate and letting agency covering the North East, North Yorkshire and Cumbria, for homeowners, landlords and tenants.',
    eyebrow: 'About us',
    h1: 'Local estate and letting agents, <em>built around you.</em>',
    lead: 'My Property Box is an estate and letting agency covering the North East, North Yorkshire and Cumbria, with a complete property service for homeowners, landlords and tenants.',
    pts: [
      ['home', 'Residential sales and lettings'],
      ['key', 'Student accommodation and HMO property management'],
      ['pin', 'Local teams across the North East, North Yorkshire and Cumbria']
    ],
    heroRow: '<a class="btn btn-mint" href="index.html#valuation">Get my free valuation</a>\n          <a class="btn btn-ghost" href="contact.html">Contact us</a>',
    info: {
      kicker: 'What we do', h2: 'A complete <em>property service.</em>', four: true,
      sub: 'From marketing and maintenance to compliance and communication.',
      cards: [
        ['home', 'Sales', 'Free valuations, marketing on Rightmove and our own search, and 360\u00b0 virtual tours on sales listings where available.', ['sell.html', 'Sell with us']],
        ['key', 'Lettings', 'Free rental appraisals and a choice of how much you want us to manage.', ['let.html', 'Let with us']],
        ['shield', 'Landlord services', 'Compare our services, switch agents with minimal fuss, and check your rental is compliant.', ['landlords.html', 'Landlord services']],
        ['users', 'Student and HMO', 'Student accommodation and HMO property management.', ['hmo.html', 'HMO landlords']]
      ]
    },
    more: {
      kicker: 'Local expertise, modern tools', h2: 'Technology that <em>helps.</em>', sub: 'Tools that make buying, selling, renting and letting simpler.',
      cards: [
        ['360', 'Property search and tours', 'Search homes to buy and rent, with maps and 360\u00b0 virtual tours on selected sales.', ['properties.html', 'Search properties']],
        ['cal', 'Request a viewing online', 'Pick a property and request a viewing. Your local team will confirm the time with you.', ['properties.html', 'Find a property']],
        ['calc', 'Free landlord calculators', 'Work out yields, costs and more, and email the results to yourself.', ['index.html#tools', 'Free calculators']]
      ]
    },
    faqH2: 'Common <em>questions.</em>',
    faqSub: 'A few quick answers about My Property Box.',
    faq: [
      ['Which areas do you cover?', 'We have offices in Darlington, Newcastle, Northallerton, Carlisle, Penrith and Kendal, and cover the towns around them. See our Areas we cover page for the full list.'],
      ['Do you handle both sales and lettings?', 'Yes. We handle residential sales and lettings, as well as student accommodation and HMO property management.'],
      ['Is the valuation free?', 'Yes. Your valuation or rental appraisal is free and there is no obligation to instruct us afterwards.'],
      ['How can I speak to someone?', 'Call your local office or send an enquiry. You will find every office number on our contact page.']
    ],
    cta: {
      h2: 'Let\u2019s talk about <em>your property.</em>', p: 'Free, no-obligation, and handled by your local team.',
      primary: '<a class="btn btn-mint" href="index.html#valuation">Get my free valuation</a>',
      second: '<button type="button" class="btn btn-ghost" data-call>Call us</button>'
    }
  }
];

// ---- Document pages: legal text, careers and payments ----
// Body copy is the wording published on the current mypropertybox.co.uk pages, kept as close to verbatim as possible.
const slugify = s => s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const docPage = c => {
  const toc = [];
  const body = c.body.replace(/<h2>([\s\S]*?)<\/h2>/g, (m, t) => {
    const id = slugify(t);
    toc.push([id, t]);
    return `<h2 id="${id}">${t}</h2>`;
  });
  const hasToc = c.toc && toc.length >= 3;
  const html = head({ title: c.title, desc: c.desc, file: c.file }) + `
<main id="main">

  <section class="hero lp-hero doc-hero" id="start">
    ${HERO_IMG}
    <div class="wrap hero-inner">
      <div class="lp-copy">
        <p class="eyebrow">${esc(c.eyebrow)}</p>
        <h1>${c.h1}</h1>
        <p class="lead">${esc(c.lead)}</p>
      </div>
    </div>
  </section>

  <section class="section" aria-label="${esc(c.eyebrow)}">
    <div class="wrap doc-wrap${hasToc ? ' has-toc' : ''}">${hasToc ? `
      <nav class="doc-toc" aria-label="On this page">
        <h2>On this page</h2>
        <ol>
          ${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('\n          ')}
        </ol>
      </nav>` : ''}
      <div class="doc-body${c.wide ? ' wide' : ''}">
${body}
      </div>
    </div>
  </section>

${ctaBand('Questions? <em>Talk to us.</em>', 'Your local team can help with anything on this page.', '<a class="btn btn-mint" href="contact.html">Contact us</a>', '<button type="button" class="btn btn-ghost" data-call>Call us</button>')}
</main>
` + tail('index.html#valuation');
  return html.replace(/href="#get-started"/g, 'href="index.html#valuation"').replace(/[^\x00-\x7f]/g, ch => `&#${ch.codePointAt(0)};`);
};

const PRIVACY_SECTIONS = ['Who we are', 'What data we collect', 'How do we collect personal data', 'How we use personal data', 'Who we share your personal data with', 'Where we keep your data', 'Overseas transfers of your personal data', 'For how long we keep your data', 'Your rights in relation to your personal information', 'Complaints and contact details', 'Updates to this notice'];

const DOC_PAGES = [
  {
    file: 'privacy.html', toc: false,
    title: 'Privacy Policy | My Property Box',
    desc: 'How My Property Box Ltd collects, uses and protects your personal data, and how to contact our data protection officer.',
    eyebrow: 'Legal',
    h1: 'Privacy <em>policy</em>',
    lead: 'We are committed to the protection of personal data and take this very seriously.',
    body: `        <p>This page summarises our privacy policy. The full policy is available to read or download as a PDF.</p>
        <dl class="doc-facts">
          <div><dt>Data controller</dt><dd>My Property Box Ltd, company number 08140860</dd></div>
          <div><dt>Responsible for data protection</dt><dd>Operations Team, Alton House, 27-31 Grange Road, Darlington, County Durham, DL1 5NA</dd></div>
          <div><dt>Data protection officer</dt><dd><a href="mailto:aidan@mypropertybox.co.uk">aidan@mypropertybox.co.uk</a></dd></div>
          <div><dt>Last updated</dt><dd>August 2024</dd></div>
        </dl>
        <div class="row">
          <a class="btn btn-navy" href="assets/legal/privacy-policy.pdf" target="_blank" rel="noopener">Read the full Privacy Policy (PDF)</a>
        </div>
        <h2>What the policy covers</h2>
        <p>When we collect and use your personal information we are subject to the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018. For the purposes of these laws we are the controller of your personal data. The full policy sets out:</p>
        <ol class="doc-list">
          ${PRIVACY_SECTIONS.map((s, i) => `<li><b>${i + 1}</b><span>${s}</span></li>`).join('\n          ')}
        </ol>
        <h2>Complaints and contact details</h2>
        <p>If you have any complaints about the way we use your personal data, please contact the data protection officer at <a href="mailto:aidan@mypropertybox.co.uk">aidan@mypropertybox.co.uk</a>, who will try to resolve the issue. If we cannot resolve it, you have the right to complain to the Information Commissioner&rsquo;s Office (ICO).</p>
        <p>You can also write to the Data Protection Officer, My Property Box Ltd, 27 Grange Rd, Darlington DL1 5NA.</p>
        <p>Our <a href="cookies.html">cookies policy</a> and <a href="terms.html">website terms of use</a> also apply to your use of this website.</p>`
  },
  {
    file: 'cookies.html', toc: false,
    title: 'Cookies Policy | My Property Box',
    desc: 'How the My Property Box website uses cookies and how to control them in your browser.',
    eyebrow: 'Legal',
    h1: 'Cookies <em>policy</em>',
    lead: 'We are committed to protecting your privacy.',
    body: `        <h2>Privacy Policy</h2>
        <p>We are committed to protecting your privacy. We will only use the information that we collect about you lawfully (in accordance with the Data Protection Act 1998 and the EU Privacy and Communications Directive). This includes information submitted voluntarily by you through a form or gathered automatically as you visit this website.</p>
        <p>You should not submit any sensitive or private information through this website except through acknowledged secure areas. The owners of this website accept no responsibility for data submitted through insecure areas of this website.</p>
        <p>By submitting your contact details to us, we may contact you or send you marketing materials. We will give you the chance to refuse any marketing email from us in the future.</p>
        <h2>Our Use of Cookies</h2>
        <p>This website uses cookies which are stored on your browser. You can usually modify your browser settings to prevent this happening. However, by disabling cookies, or certain types of cookie, you may hinder your user experience on this and other websites, or prevent them from working entirely.</p>
        <p>The only way you can however disable ALL cookies from any website is to disable accepting cookies from them in your browser. Although we can&rsquo;t help you with that we do suggest consulting the Help section of your browser or taking a look at <a href="https://www.aboutcookies.org" target="_blank" rel="noopener nofollow">the About Cookies website</a> which offers guidance for all modern browsers section.</p>
        <p>Some cookies used on this website are essential in order to enable you to move around the website and use its features, such as accessing secure areas of the website. Without these cookies, services you have asked for, like shopping baskets or e-billing, cannot be provided.</p>
        <p>Some cookies used on this website collect information about how visitors use a website, for instance which pages visitors go to most often, and if they get error messages from web pages.</p>
        <p>These cookies don&rsquo;t collect information that identifies a visitor. All information these cookies collect is aggregated and therefore anonymous. It is only used to improve how a website works.</p>
        <p>Some cookies used on this website allow the website to remember choices you make (such as your user name, language or the region you are in) and provide enhanced, more personal features.</p>
        <p>These cookies can also be used to remember changes you have made to text size, fonts and other parts of web pages that you can customise. They may also be used to provide services you have asked for such as watching a video or commenting on a blog. The information these cookies collect may be anonymised and they cannot track your browsing activity on other websites.</p>
        <p>Cookies may also be used to improve the user experience and to enable some of the functionality provided by this website.</p>
        <p>Please note that some cookies may be placed by third party service providers who perform some of these functions (or other services) for us. Cookies are used on this website for the following third party services: HitsLink Analytics, Google Analytics, LinkedIn Follow button, Facebook Like Button, Twitter Follow button, Google +1 button, AddThis social bookmarking tool, YouTube videos, Olark LiveChat Services, Macromedia Flash and there are many many more. Some of these services may be used to track your behaviour on other websites and we have no control over this.</p>
        <p>By continuing to use this website without adjusting your browser&rsquo;s cookie settings, you agree that we can place these cookies on your device.</p>
        <p>Don&rsquo;t forget, if you follow the help at <a href="https://www.aboutcookies.org" target="_blank" rel="noopener nofollow">the About Cookies website</a> then you should be able to view what cookies our site is using and you can then make up your mind whether or not you want to accept them or not, remember, you have the control and power to block cookies from ANY and ALL websites you visit using your browser.</p>
        <p>As is true with most websites, our server will automatically log data regarding each visit such as your IP address, browser type, referring/exit pages, and operating system. We may use this information to monitor server errors, server administration or to monitor visitor behaviour. It is not possible for this to be disabled on a per-user basis so you must leave this website if you do not agree to this happening.</p>
        <p>This privacy policy applies to this website only and does not apply to any websites that this website may link to.</p>
        <p>If you have any questions/comments about privacy, you should <a href="contact.html">contact us</a>.</p>`
  },
  {
    file: 'terms.html', toc: true,
    title: 'Website Terms of Use | My Property Box',
    desc: 'The terms and conditions that apply to your use of the My Property Box website.',
    eyebrow: 'Legal',
    h1: 'Website <em>terms of use</em>',
    lead: 'Please read these terms and conditions carefully, as they affect your legal rights.',
    body: `        <p>These terms and conditions apply between you, the User of this Website (including any sub-domains, unless expressly excluded by their own terms and conditions), and My Property Box Ltd, the owner and operator of this Website. Please read these terms and conditions carefully, as they affect your legal rights. Your agreement to comply with and be bound by these terms and conditions is deemed to occur upon your first use of the Website. If you do not agree to be bound by these terms and conditions, you should stop using the Website immediately.</p>
        <p>In these terms and conditions, <strong>User</strong> or <strong>Users</strong> means any third party that accesses the Website and is not either (i) employed by My Property Box Ltd and acting in the course of their employment or (ii) engaged as a consultant or otherwise providing services to My Property Box Ltd and accessing the Website in connection with the provision of such services.</p>
        <p>You must be at least 18 years of age to use this Website. By using the Website and agreeing to these terms and conditions, you represent and warrant that you are at least 18 years of age.</p>
        <h2>Intellectual property and acceptable use</h2>
        <ol>
          <li>All Content included on the Website, unless uploaded by Users, is the property of My Property Box Ltd, our affiliates or other relevant third parties. In these terms and conditions, Content means any text, graphics, images, audio, video, software, data compilations, page layout, underlying code and software and any other form of information capable of being stored in a computer that appears on or forms part of this Website, including any such content uploaded by Users. By continuing to use the Website you acknowledge that such Content is protected by copyright, trademarks, database rights and other intellectual property rights. Nothing on this site shall be construed as granting, by implication, estoppel, or otherwise, any license or right to use any trademark, logo or service mark displayed on the site without the owner&rsquo;s prior written permission</li>
          <li>You may, for your own personal, non-commercial use only, do the following:
            <ul><li>retrieve, display and view the Content on a computer screen</li></ul>
          </li>
          <li>You must not otherwise reproduce, modify, copy, distribute or use for commercial purposes any Content without the written permission of My Property Box Ltd.</li>
        </ol>
        <h2>Prohibited use</h2>
        <ol start="4">
          <li>You may not use the Website for any of the following purposes:
            <ol>
              <li>in any way which causes, or may cause, damage to the Website or interferes with any other person&rsquo;s use or enjoyment of the Website;</li>
              <li>in any way which is harmful, unlawful, illegal, abusive, harassing, threatening or otherwise objectionable or in breach of any applicable law, regulation, governmental order;</li>
              <li>making, transmitting or storing electronic copies of Content protected by copyright without the permission of the owner.</li>
            </ol>
          </li>
        </ol>
        <h2>Links to other websites</h2>
        <ol start="5">
          <li>This Website may contain links to other sites. Unless expressly stated, these sites are not under the control of My Property Box Ltd or that of our affiliates.</li>
          <li>We assume no responsibility for the content of such Websites and disclaim liability for any and all forms of loss or damage arising out of the use of them.</li>
          <li>The inclusion of a link to another site on this Website does not imply any endorsement of the sites themselves or of those in control of them.</li>
        </ol>
        <h2>Privacy Policy and Cookies Policy</h2>
        <ol start="8">
          <li>Use of the Website is also governed by our <a href="privacy.html">Privacy Policy</a> and <a href="cookies.html">Cookies Policy</a>, which are incorporated into these terms and conditions by this reference.</li>
        </ol>
        <h2>Availability of the Website and disclaimers</h2>
        <ol start="9">
          <li>Any online facilities, tools, services or information that My Property Box Ltd makes available through the Website (the Service) is provided &quot;as is&quot; and on an &quot;as available&quot; basis. We give no warranty that the Service will be free of defects and/or faults. To the maximum extent permitted by the law, we provide no warranties (express or implied) of fitness for a particular purpose, accuracy of information, compatibility and satisfactory quality. My Property Box Ltd is under no obligation to update information on the Website.</li>
          <li>Whilst My Property Box Ltd uses reasonable endeavours to ensure that the Website is secure and free of errors, viruses and other malware, we give no warranty or guaranty in that regard and all Users take responsibility for their own security, that of their personal details and their computers.</li>
          <li>My Property Box Ltd accepts no liability for any disruption or non-availability of the Website.</li>
          <li>My Property Box Ltd reserves the right to alter, suspend or discontinue any part (or the whole of) the Website including, but not limited to, any products and/or services available. These terms and conditions shall continue to apply to any modified version of the Website unless it is expressly stated otherwise.</li>
        </ol>
        <h2>Limitation of liability</h2>
        <ol start="13">
          <li>Nothing in these terms and conditions will: (a) limit or exclude our or your liability for death or personal injury resulting from our or your negligence, as applicable; (b) limit or exclude our or your liability for fraud or fraudulent misrepresentation; or (c) limit or exclude any of our or your liabilities in any way that is not permitted under applicable law.</li>
          <li>We will not be liable to you in respect of any losses arising out of events beyond our reasonable control.</li>
          <li>To the maximum extent permitted by law, My Property Box Ltd accepts no liability for any of the following:
            <ol>
              <li>any business losses, such as loss of profits, income, revenue, anticipated savings, business, contracts, goodwill or commercial opportunities;</li>
              <li>loss or corruption of any data, database or software;</li>
              <li>any special, indirect or consequential loss or damage.</li>
            </ol>
          </li>
        </ol>
        <h2>General</h2>
        <ol start="16">
          <li>You may not transfer any of your rights under these terms and conditions to any other person. We may transfer our rights under these terms and conditions where we reasonably believe your rights will not be affected.</li>
          <li>These terms and conditions may be varied by us from time to time. Such revised terms will apply to the Website from the date of publication. Users should check the terms and conditions regularly to ensure familiarity with the then current version.</li>
          <li>These terms and conditions together with the Privacy Policy and Cookies Policy contain the whole agreement between the parties relating to its subject matter and supersede all prior discussions, arrangements or agreements that might have taken place in relation to the terms and conditions.</li>
          <li>The Contracts (Rights of Third Parties) Act 1999 shall not apply to these terms and conditions and no third party will have any right to enforce or rely on any provision of these terms and conditions.</li>
          <li>If any court or competent authority finds that any provision of these terms and conditions (or part of any provision) is invalid, illegal or unenforceable, that provision or part-provision will, to the extent required, be deemed to be deleted, and the validity and enforceability of the other provisions of these terms and conditions will not be affected.</li>
          <li>Unless otherwise agreed, no delay, act or omission by a party in exercising any right or remedy will be deemed a waiver of that, or any other, right or remedy.</li>
          <li>This Agreement shall be governed by and interpreted according to the law of England and Wales and all disputes arising under the Agreement (including non-contractual disputes or claims) shall be subject to the exclusive jurisdiction of the English and Welsh.</li>
        </ol>
        <h2>My Property Box Ltd details</h2>
        <ol start="23">
          <li>My Property Box Ltd is a company incorporated in England and Wales with registered number 08140860 whose registered address is 27 Grange Rd, Darlington DL1 5NA and it operates the Website mypropertybox.co.uk.</li>
        </ol>
        <p>You can contact My Property Box Ltd by email on <a href="mailto:info@mypropertybox.co.uk">info@mypropertybox.co.uk</a></p>`
  },
  {
    file: 'complaints.html', toc: false,
    title: 'Complaints Procedure | My Property Box',
    desc: 'How to make a complaint to My Property Box, what happens next, and how to contact The Property Ombudsman.',
    eyebrow: 'Legal',
    h1: 'In-house <em>complaints procedure</em>',
    lead: 'We are committed to providing a professional service to all our clients and customers. When something goes wrong, we need you to tell us about it.',
    body: `        <p>This will help us to improve our standards.</p>
        <p>If you have a complaint, please put it in writing (email accepted to <a href="mailto:contact@mypropertybox.co.uk">contact@mypropertybox.co.uk</a>), including as much detail as possible. We will then respond in line with the timeframes set out below (if you feel we have not sought to address your complaints within eight weeks, you may be able to refer your complaint to the Property Ombudsman to consider without our final viewpoint on the matter).</p>
        <h2>What will happen next?</h2>
        <ul>
          <li>We will send you a letter or email acknowledging receipt of you complaint within three working days of receiving it, enclosing a copy of this procedure.</li>
          <li>We will then investigate your complaint. This will normally be dealt with by the office manager who will review your file and speak to the member of staff who dealt with you. A formal written outcome of our investigation will be sent to you within 15 working days of sending the acknowledgement letter.</li>
          <li>If, at this stage, you are still not satisfied, you should contact us again and we will arrange for a separate review to take place by a senior member of staff.</li>
          <li>We will write to you within 15 working days of receiving your request for a review, confirming our final viewpoint on the matter.</li>
        </ul>
        <p>If you still remain dissatisfied, you can then contact The Property Ombudsman to request an independent review:</p>
        <address>The Property Ombudsman Ltd<br>Milford House<br>43-45 Milford Street<br>Salisbury<br>Wiltshire<br>SP1 2BP<br><a href="tel:+441722333306">01722 333 306</a><br><a href="https://www.tpos.co.uk" target="_blank" rel="noopener">www.tpos.co.uk</a></address>
        <p>Please note the following:</p>
        <p>You will need to submit your complaint to The Property Ombudsman within 12 months of receiving our final viewpoint letter, including any evidence to support your case.</p>
        <p>The Property Ombudsman requires that all complaints are addressed through this in-house complaints procedure, before being submitted for an independent review.</p>`
  },
  {
    file: 'careers.html', toc: false,
    title: 'Careers | My Property Box',
    desc: 'Careers at My Property Box, an estate and letting agency across the North East, North Yorkshire and Cumbria.',
    eyebrow: 'Careers',
    h1: 'Careers at <em>My Property Box</em>',
    lead: 'Are you looking to join one of the leading lettings and estate agencies in the North East and North Yorkshire? Look no further than My Property Box.',
    body: `        <h2>Training</h2>
        <p>All of our staff are trained weekly, ranging from single lets to HMOs, <abbr title="Serviced accommodation">SA</abbr>, <abbr title="Rent to rent">R2R</abbr>, or commercial to residential conversions. Along with the ever-changing legislation that comes with the property industry.</p>
        <h2>Current vacancies</h2>
        <p class="doc-note">We don&rsquo;t have any job vacancies at the moment.</p>
        <p>If you would like to get in touch, you will find every office on our contact page.</p>
        <div class="row">
          <a class="btn btn-navy" href="contact.html">Contact us</a>
        </div>`
  },
  {
    file: 'payments.html', toc: false, wide: true,
    title: 'Online Payments | My Property Box',
    desc: 'Pay My Property Box by debit or credit card through our secure payment form, or by bank transfer.',
    eyebrow: 'Tenants',
    h1: 'Online <em>payments</em>',
    lead: 'Pay by debit or credit card, or transfer the money directly from your bank account.',
    body: `        <div class="doc-split">
          <article class="doc-card">
            <p class="kicker">Debit or credit card</p>
            <h2>Pay by card</h2>
            <p>For a one-off payment by debit card or credit card, use our secure payment form. It opens on our main website, where you choose the payment type: deposit, rent or other.</p>
            <a class="btn btn-navy" href="https://www.mypropertybox.co.uk/payment.php" target="_blank" rel="noopener">Pay by card</a>
          </article>
          <article class="doc-card">
            <p class="kicker">Bank transfer</p>
            <h2>Pay directly into our account</h2>
            <p>If you prefer to pay directly from your bank account, you can pay into our bank using these details.</p>
            <dl class="doc-facts big">
              <div><dt>Sort code</dt><dd>20-25-29</dd></div>
              <div><dt>Account number</dt><dd>33775119</dd></div>
            </dl>
          </article>
        </div>
        <p class="doc-note">Not sure which payment applies to you? Call your local office before you pay.</p>
        <div class="row">
          <button type="button" class="btn btn-line" data-call>Call your local office</button>
        </div>`
  }
];

PAGES.forEach(p => write(fileOf(p), townPage(p)));
SERVICE_PAGES.forEach(c => write(c.file, servicePage(c)));
DOC_PAGES.forEach(c => write(c.file, docPage(c)));
write('areas.html', areasPage());
console.log(`Wrote ${PAGES.length} town pages, ${SERVICE_PAGES.length} service pages, ${DOC_PAGES.length} document pages and areas.html`);
