# My Property Box: new website

Static site. No build step.

| Page | Purpose |
|---|---|
| `index.html` | Homepage: valuation form (hero), property search and new listings, free tools, areas |
| `sell.html`, `let.html` | Lead-gen landing pages for vendors and landlords (valuation forms, `?loc=` pre-fills the area) |
| `landlords.html` | Landlord route: service comparison (Let only / Rent collect / Fully managed), "switching agents is easy", compliance check |
| `hmo.html`, `student.html` | HMO landlord guidance and lead form; live student listings and a rental-appraisal form |
| `estate-agents-<town>.html`, `areas.html` | 16 town pages (local listings, nearest office, lead form, FAQ) and the "Areas we cover" index |
| `contact.html`, `about.html`, `tenants.html` | Replace the old-site contact, about and tenants pages: enquiry form and office numbers, company overview, renting guide |
| `privacy.html`, `cookies.html`, `terms.html`, `complaints.html` | Legal pages copied from the old site: privacy summary plus the full PDF (`assets/legal/privacy-policy.pdf`), cookies, website terms, in-house complaints procedure |
| `careers.html`, `payments.html` | Careers (no vacancies listed) and online payments (card payment opens on the old site, bank transfer details) |
| `properties.html` | Property search (grid, map, filters, saved homes, alerts) |
| `property.html?id=<id>` | Property page: gallery, 360 tour, map, cost guide, viewing booking, lead capture |

The nav is deliberately short: Sell, Let, Landlord Services, Areas we Cover, Property Search, Free Valuation.

### Generated pages

The town pages, `areas.html`, `hmo.html`, `student.html`, `contact.html`, `about.html`, `tenants.html` and the six
document pages (`privacy`, `cookies`, `terms`, `complaints`, `careers`, `payments`) are **generated**.
Edit `tools/build-pages.js` (town list, copy, FAQs, office assignments), then run:

```
node tools/build-pages.js
```

Never edit those HTML files by hand, as the next run overwrites them. The generator copies the header and footer from
`sell.html`, so change the footer in the six hand-written pages (`index`, `sell`, `let`, `landlords`, `properties`,
`property`) and re-run it. Behaviour lives in `town.js` and `town.css`.

## Run locally

Serve the folder over HTTP (the pages load `data/*.json`, so `file://` will not work). To get the
viewing-time picker as well, use the bundled server (Node 18+, no dependencies):

```
DIARY_MODE=demo node server/server.js        # PowerShell: $env:DIARY_MODE='demo'; node server/server.js
```

then open http://127.0.0.1:8080. Any static host (`npx serve .`) also works; the property page then simply
shows the plain date/time enquiry form instead of the picker.

## Viewing diary and bookings

The property page can offer real viewing times based on the negotiators' diaries.

- **Server side only.** The browser calls `GET /api/availability?property=<id>` and `POST /api/viewings`.
  CRM logins are read from environment variables (see `server/.env.example`) and never reach the site files.
  A static site cannot hold credentials, so do not put them in any `.js` or `.html` file.
- **Geo-aware slots** (`server/engine.js`, `server/geo.js`). Existing appointments are geocoded from their
  postcodes. Each slot is padded by estimated travel time from the previous and next appointment (or from the
  nearest office for the first of the day), and a slot is marked "team already in the area" when a negotiator is
  within ~3 miles around that time. Only postcodes (or outcodes with `GEOCODE_PRECISION=outcode`) are sent to
  postcodes.io. Other clients' addresses and negotiator names are never exposed to the browser.
- **Booking requests.** A request re-checks availability, then records the lead (`server/data/leads.jsonl`), places
  a temporary hold so the slot is not offered twice, and sends it on by email and `LEAD_WEBHOOK_URL` (see Lead
  capture). The visitor is told the time is *requested* and the team will confirm. Nothing is written back to the CRM.
- **Per-CRM adapters** (`server/diary/`):

| Source | State |
|---|---|
| Demo (`DIARY_MODE=demo`) | Deterministic sample diaries, clearly labelled "Demo availability" on the page |
| Veco | Read-only adapter built from the Veco Plus scheduler API, used only for properties whose feed `source` is `veco`. Veco's identity server advertises the `client_credentials` grant and the `scheduler-service` scope, but a client must be issued by Veco (`VECO_CLIENT_ID`, `VECO_CLIENT_SECRET`). Then run `node server/veco-check.js` to confirm the token and list the staff ids for `VECO_RESOURCE_IDS`. Bookings are still recorded as requests, not written into the Veco diary (needs Veco's create-appointment or lead endpoint) |
| Jupix, MRI, Cumbria offices | No adapter yet (needs their API access); these properties fall back to the plain enquiry form |

  Add a source by creating `server/diary/<name>.js` that exports `{ name, configured(), getBusy({ fresh }) }`
  (`getBusy` resolves to the negotiators and their events, as in `mock.js` / `veco.js`), and choosing it in
  `server/diary/index.js`.
- **Tests:** `node --test --test-concurrency=1 server/test/engine.test.js server/test/api.test.js server/test/veco.test.js server/test/mail.test.js server/test/leads.test.js server/test/leads-cap.test.js feed/test/rightmove.test.js`
- **Deploying:** run behind HTTPS with `HOST=0.0.0.0` and `TRUST_PROXY=1`. Keep `server/.env` and `server/data/`
  private (they are in `.gitignore`, and the server refuses to serve `server/`, `feed/` and dotfiles).
- Unverified until tested on real Veco data: recurrence numbering, time zone handling of repeating events and
  all-day event representation.

## Property feed

`feed/sync.js` writes `data/properties.json` (search) and `data/p/<id>.json` (one file per property page)
from two sources, merged and de-duplicated:

- **`site`**: the live mypropertybox.co.uk listings, which already merge the CRMs (Jupix, Veco, MRI).
- **`rightmove`**: the public Rightmove branch pages for **Carlisle (90144)** and **Penrith (90147)**: sales
  (including sold STC) and lettings (including let agreed), with photos, floorplans, EPC, key features and 360 tours.
  Rightmove listings link back to their Rightmove page ("View on Rightmove").

```
node feed/sync.js                          # both sources
node feed/sync.js --adapter=site           # one source only
node --test feed/test/rightmove.test.js    # adapter tests
```

- **Refresh every 30 minutes.** `.github/workflows/pages.yml` runs `node feed/sync.js` on a `*/30 * * * *` schedule
  and redeploys. Listings are not committed back, so the repo history stays small. A failed scheduled refresh
  skips the deploy, so the live site keeps its last good data. On a push, a failed refresh falls back to the
  committed `data/`. Run it on demand from the Actions tab (**Run workflow**).
  - GitHub cron is best effort (runs can start a few minutes late) and GitHub switches scheduled workflows off
    after 60 days with no repository activity.
  - For Azure or self-hosting, run `node feed/sync.js` from cron or Task Scheduler instead.
- **More Rightmove branches.** Set `RIGHTMOVE_BRANCHES="90144:Carlisle,90147:Penrith,<id>:<name>"`. The branch id is
  the number at the end of the branch's Rightmove URL.
- **Safe by design.** The Rightmove adapter identifies itself, waits at least 0.8s between requests, retries
  politely and caches details. If Rightmove blocks a request, changes its page format or returns an incomplete
  list, that branch keeps its previous listings (a `::warning::` appears on the Actions run) and nothing else is
  affected. Listings kept this way are only as fresh as the last good run, so check the Actions log if the
  Cumbria listings look out of date.
- **Terms.** Rightmove's terms restrict automated collection of its site, and the page markup can change without
  notice. Treat this as a stop-gap. The dependable source is your CRM's own feed (Reapit or Jupix for Cumbria),
  added as another adapter in `ADAPTERS` in `feed/sync.js` that returns `{ list, detail }` in the normalised shape
  described at the top of the file. That needs the vendor's API credentials and documentation.
- Where a feed leaves the rent frequency blank, a rent under £300 is treated as weekly (student lets).

## Hosting

**GitHub Pages preview** (current test link): `.github/workflows/pages.yml` publishes the static site on every push and
every 30 minutes (after a feed refresh), with `noindex` added. Pages cannot run the viewing API, so property pages show
the plain date/time enquiry form instead of the diary-based time picker.

**Azure App Service** runs the same files plus the Node server, so the viewing-time API works:

```
az login
./deploy/azure-deploy.ps1 -AppName <globally-unique-name>
```

- Needs the Azure CLI and a signed-in account. The script shows the subscription and asks before creating anything:
  a resource group, a Linux App Service plan (default `B1`, `-Sku F1` for the free tier) and a Node 20 web app.
- It zips only what the site needs (pages, `assets/`, `data/`, `vendor/`, `server/` without tests, data or `.env`),
  adds `noindex` (use `-Index` at launch), deploys, and checks `/api/health`. `-PackageOnly` builds the zip and touches
  nothing in Azure.
- App settings it sets: `HOST=0.0.0.0`, `TRUST_PROXY=1`, `DIARY_MODE=demo` (`-DiaryMode live` omits it) and
  `DATA_DIR` / `GEOCACHE_FILE` under `/home/mpb-data`, which survives redeploys. HTTPS only, TLS 1.2, FTPS off.
- Add CRM secrets afterwards as app settings, never in code:
  `az webapp config appsettings set -n <app> -g rg-mpb-preview --settings VECO_CLIENT_ID=... VECO_CLIENT_SECRET=... VECO_RESOURCE_IDS=...`
- **The property feed on Azure is a snapshot** of `data/` at deploy time. To refresh it every 30 minutes, run
  `node feed/sync.js` on a schedule and redeploy (for example a scheduled GitHub Actions job using
  `azure/webapps-deploy`, or an Azure Function / Logic App). That is not set up yet.
- Remove everything when finished: `az group delete --name rg-mpb-preview`.
- Checked without an Azure subscription: the zip builds with Linux-style paths, the extracted package starts with the
  production settings and serves the pages and `/api/health`, and the script stops cleanly when not signed in. It has
  not yet been run against a real subscription.

## Lead capture

All forms (valuation wizard, viewing/question/interest enquiries, sold-property alerts, search alerts, calculators,
the header callback request) post JSON via `sendLead()` in `common.js` to **`POST /api/leads`** on the site's own
server (`server/server.js`). There it is validated, written to the private log (`server/data/leads.jsonl`), and
emailed to the right office (`server/mail.js`).

- **Where the email goes.** Recipients are set only in server settings, never from the form. `LEAD_EMAIL_TO` is the
  default inbox. `LEAD_EMAIL_DARLINGTON`, `_NEWCASTLE`, `_NORTHALLERTON`, `_CARLISLE`, `_PENRITH` and `_KENDAL`
  override it for that office (the lead's office comes from the town page, the callback office choice, or the
  property: Rightmove rows by branch, the rest the nearest office). `LEAD_EMAIL_CC` is copied on everything.
  **Reply** in the mail client goes to the visitor. Nothing is guessed: with no inbox set, nothing is sent.
- **Mail settings.** `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS by default; `SMTP_SECURE=true` for 465), `SMTP_USER`,
  `SMTP_PASS` and `MAIL_FROM` (see `server/.env.example`). It refuses to send without TLS. Microsoft 365 needs SMTP
  AUTH enabled for the mailbox and Google Workspace needs an app password, so check that with whoever manages the
  email. If SMTP is awkward, point `LEAD_WEBHOOK_URL` at Zapier, Make or Power Automate instead.
- **Safety.** Every lead is logged first, so a mail failure never loses one. A mail failure is logged and the
  visitor still sees success. Limits: 10 leads per IP per 10 minutes (`RATE_LEADS`) and 200 emails per hour overall
  (`RATE_LEADS_GLOBAL`), after which leads are logged but not emailed. Bodies over 32 KB, unknown lead types, a
  missing consent tick or no valid email or phone are refused.
- **Preview mode.** With `DIARY_MODE=demo` leads are only logged and the page says it is a preview. On a static host
  with no server (the GitHub Pages preview) `/api/leads` does not exist, so the forms log the payload to the console
  and send nothing. To post from a static site to a server elsewhere, set `LEAD.endpoint` in `common.js` to that
  server's full `/api/leads` URL and set `ALLOWED_ORIGIN` on the server.
- **Booking requests** use the same delivery. The email says clearly that the slot is held on the website but **not**
  in the diary, so staff confirm it and add it by hand.
- **Tests:** `node --test server/test/mail.test.js server/test/leads.test.js server/test/leads-cap.test.js`. They use
  a fake SMTP server (including STARTTLS and AUTH, with a throwaway `localhost` certificate in `server/test/fixtures`).
  Nothing has been tried against a real mailbox yet: send a test lead through the real server once `server/.env` is set.

Each lead carries the property, price, CRM, whether it has a 360 tour, consent wording and attribution.
`dataLayer` events are pushed for Google Tag Manager.

## Office phone numbers and callbacks

The six official office numbers (Darlington, Newcastle, Northallerton, Carlisle, Penrith, Kendal) live in `OFFICES`
in `common.js`. That list drives the header **Call us** dialog (tap-to-call plus a callback request, sent as a
`callback` lead) and each property's "nearest office" line. The footers of the six HTML pages repeat the numbers
as plain markup, so update them there too if a number changes. Rightmove tracking numbers are deliberately not used.

## Before going live

- **Switch lead delivery on.** The Azure test app runs with `DIARY_MODE=demo`, which logs leads but never emails them.
  For real leads: remove `DIARY_MODE` (deploy with `-DiaryMode live`), set the `SMTP_*`, `MAIL_FROM` and
  `LEAD_EMAIL_*` settings, then submit a test lead and check it arrives. Without them the server prints a warning at
  startup and leads only go to the private log.
- **Confirm the facts.** The homepage and landing pages still say "seven offices" and list Cockermouth, but only six
  offices have a confirmed number (the footer and call dialog show those six). The "15+ years", "£50m" and
  "39-second valuation" claims have no evidence in this repo. The legal entity wording (My Property Box Ltd, MPB
  North West Ltd, Acorn) needs checking. Nothing here invents opening hours, fees, reviews or named staff.
- **Office assignments for town pages** are an inference (for example Durham, Hartlepool, Middlesbrough and Stockton
  to Darlington, Sunderland, Gateshead and South Shields to Newcastle, Cockermouth to Carlisle). Correct them in
  `tools/build-pages.js`.
- **Landlord service tiers** on `landlords.html` are a draft with no prices. Confirm what each tier includes.
- **Compliance check and HMO/student guidance** is general England-based guidance marked "not legal advice". Have it
  reviewed.
- **Legal pages are copies of the old site's documents, not legal advice.** Have them reviewed before launch:
  - Privacy: the page summarises the policy (last updated August 2024) and links the full PDF, which is hosted in
    `assets/legal/`. Supply the Word version if you want a full HTML page.
  - Cookies: the wording is outdated (it cites the Data Protection Act 1998, Flash, Olark and HitsLink) and the site
    has no cookie consent banner. Rewrite it and add a banner.
  - Terms: the old page headed one section "Winch & Co Holdings Ltd details", which looks like a template error. It
    now reads "My Property Box Ltd details". Clause 22 ends "exclusive jurisdiction of the English and Welsh", which
    looks truncated (probably missing "courts"). It is kept verbatim until confirmed.
  - Payments: the card button still opens `mypropertybox.co.uk/payment.php`, and that form posts to a
    `payments.handepay.co.uk/devtools/sigtest.php` URL, which looks like a test endpoint. Check it with Handepay and
    your developer. The bank sort code and account number were copied from the old page and need confirming.
  - Careers: says there are no vacancies. Add roles when there are some.
- **Still on the old site:** the instant valuation tool (it sends `X-Frame-Options: SAMEORIGIN`, so it cannot be
  embedded; the hero form is the on-site replacement) and the card payment form. Move these before the old domain is
  switched off.
- Add a `sitemap.xml`, `robots.txt` and the real canonical domain, and remove the `noindex` injection.

- Set `LEAD.endpoint`. Alerts also need a back end (or CRM automation) to send the emails.
- Rotate any CRM password that has been shared in chat or email, and use dedicated API or service accounts.
- Get Veco API credentials (and Jupix / MRI / Cumbria diary access) so live viewing times replace the demo data.
- Have the consent and privacy wording reviewed.
- Map tiles use public OpenStreetMap, which is fine for launch-level traffic. For heavy use switch `MPB.TILES`
  in `listing.js` to a keyed provider (MapTiler, Stadia, Mapbox).
- Pages are rendered in the browser. For SEO and social link previews, render the property pages server-side
  (or pre-generate them from `data/p/*.json`).
- Photos are hot-linked from the CRM image hosts.
- `vendor/leaflet` holds Leaflet and Leaflet.markercluster (licences included).
