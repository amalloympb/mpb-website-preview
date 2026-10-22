# My Property Box: new website

Static site. No build step.

| Page | Purpose |
|---|---|
| `index.html` | Homepage: valuation wizard, free tools, areas |
| `sell.html`, `let.html`, `landlords.html` | Lead-gen landing pages for vendors and landlords (valuation forms, `?loc=` pre-fills the area) |
| `properties.html` | Property search (grid, map, filters, saved homes, alerts) |
| `property.html?id=<id>` | Property page: gallery, 360 tour, map, cost guide, viewing booking, lead capture |

The nav is deliberately short: Sell, Let, Landlord Services, Areas we Cover, Property Search, Free Valuation.

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
  a temporary hold so the slot is not offered twice, and POSTs to `LEAD_WEBHOOK_URL` if set. The visitor is told
  the time is *requested* and the team will confirm. Nothing is written back to the CRM.
- **Per-CRM adapters** (`server/diary/`):

| Source | State |
|---|---|
| Demo (`DIARY_MODE=demo`) | Deterministic sample diaries, clearly labelled "Demo availability" on the page |
| Veco | Read-only adapter built from the Veco Plus scheduler API. Needs an API client from Veco (`VECO_CLIENT_ID`, `VECO_CLIENT_SECRET`, `VECO_RESOURCE_IDS`). Token flow is unverified until Veco issues one |
| Jupix, MRI, Cumbria offices | No adapter yet (needs their API access); these properties fall back to the plain enquiry form |

  Add a source by creating `server/diary/<name>.js` that exports `{ name, configured(), getBusy({ fresh }) }`
  (`getBusy` resolves to the negotiators and their events, as in `mock.js` / `veco.js`), and choosing it in
  `server/diary/index.js`.
- **Tests:** `node --test server/test/engine.test.js server/test/api.test.js server/test/veco.test.js`
- **Deploying:** run behind HTTPS with `HOST=0.0.0.0` and `TRUST_PROXY=1`. Keep `server/.env` and `server/data/`
  private (they are in `.gitignore`, and the server refuses to serve `server/`, `feed/` and dotfiles).
- Unverified until tested on real Veco data: recurrence numbering, time zone handling of repeating events and
  all-day event representation.

## Property feed

Rightmove only accepts listings pushed to it, so it cannot be read from. The listings come from the
CRMs (Jupix, Veco, MRI) instead. `feed/sync.js` writes `data/properties.json` (search) and
`data/p/<id>.json` (one file per property page).

```
node feed/sync.js                 # default adapter: reads the live mypropertybox.co.uk site, which merges the CRMs
node feed/sync.js --adapter=site
```

- **Schedule it** (cron / Task Scheduler / GitHub Action), for example every 15 minutes, then publish `data/`.
  A full first run takes about a minute; later runs only fetch changed listings (`feed/cache.json`).
- **Direct CRM adapters** (Jupix, Veco, MRI, later Reapit): add a function to `ADAPTERS` in `feed/sync.js` that
  returns `{ list, detail }` in the normalised shape described at the top of the file. These need each
  vendor's API credentials and documentation.
- Where a feed leaves the rent frequency blank, a rent under £300 is treated as weekly (student lets).

## Lead capture

All forms (valuation wizard, viewing/question/interest enquiries, sold-property alerts, search alerts) post JSON via
`sendLead()` in `common.js`. In `LEAD.endpoint` (also in `common.js`), set any URL that accepts a JSON POST: a CRM
webhook, Zapier, Formspree and so on. **While it is empty the forms run in preview mode and nothing is sent.**
Each lead carries the property, price, CRM, whether it has a 360 tour, consent wording and attribution.
`dataLayer` events are pushed for Google Tag Manager.

## Before going live

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
