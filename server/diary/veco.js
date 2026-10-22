'use strict';
// Veco Plus diary adapter (read-only). Built from the scheduler API the Veco web app itself uses.
//
// Credentials come only from environment variables and are never logged or sent to the browser:
//   VECO_CLIENT_ID / VECO_CLIENT_SECRET  OAuth client-credentials pair issued by Veco (ask Veco for API access)
//   VECO_TOKEN                           optional short-lived bearer token (testing only)
//   VECO_RESOURCE_IDS                    comma-separated Veco user ids whose diaries count for viewings
//   VECO_API_BASE / VECO_IDENTITY_URL / VECO_SCOPE   optional overrides
const { geocode } = require('../geo');
const { londonParts, londonKey } = require('../engine');

const cfg = () => ({
  base: (process.env.VECO_API_BASE || 'https://api.all.veco.plus').replace(/\/$/, ''),
  identity: (process.env.VECO_IDENTITY_URL || 'https://identity.all.veco.plus').replace(/\/$/, ''),
  id: process.env.VECO_CLIENT_ID || '',
  secret: process.env.VECO_CLIENT_SECRET || '',
  scope: process.env.VECO_SCOPE || '',
  token: process.env.VECO_TOKEN || '',
  resources: (process.env.VECO_RESOURCE_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
});

const configured = () => {
  const c = cfg();
  return c.resources.length > 0 && !!(c.token || (c.id && c.secret));
};

let tok = { value: '', exp: 0 };
async function token(c) {
  if (c.token) return c.token;
  if (tok.value && Date.now() < tok.exp - 30000) return tok.value;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret });
  if (c.scope) body.set('scope', c.scope);
  const res = await fetch(`${c.identity}/connect/token`, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Veco token request failed (${res.status})`);
  const j = await res.json();
  tok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 };
  return tok.value;
}

const idOf = v => (/^\d+$/.test(v) ? Number(v) : v);
const cache = new Map();

// Fetches every selected negotiator's diary for the next 14 days (cached 60s; the booking step passes fresh:true)
async function fetchPool(fresh) {
  const c = cfg();
  const t0 = londonParts(Date.now());
  const from = londonKey(Date.now());
  const to = londonKey(Date.UTC(t0.year, t0.month - 1, t0.day + 14, 12));
  const key = `${c.resources.join(',')}|${from}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.data;

  const res = await fetch(`${c.base}/api/scheduler/Appointments/1/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(c)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromDate: `${from}T00:00`, toDate: to, status: ['0', '1', '3'],
      showResponsible: true, showInvited: true, showDeclined: false, resources: c.resources.map(idOf), type: null, tagIds: []
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Veco diary request failed (${res.status})`);
  const list = await res.json();
  const places = await geocode(list.map(a => (a.extendedProps && a.extendedProps.location) || ''));
  const byId = new Map(c.resources.map(r => [String(r), []]));
  list.forEach((a, i) => {
    const bucket = byId.get(String(a.resourceId));
    if (!bucket) return;
    bucket.push({
      start: a.start, end: a.end, allDay: !!a.allDay, rrule: a.rrule || null, exdate: a.exdate || [],
      lat: places[i] ? places[i].lat : undefined, lng: places[i] ? places[i].lng : undefined
    });
  });
  const data = [...byId].map(([id, events]) => ({ id: 'veco-' + id, events }));
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function getBusy({ fresh } = {}) {
  return { negotiators: await fetchPool(!!fresh) };
}

module.exports = { name: 'veco', configured, getBusy };
