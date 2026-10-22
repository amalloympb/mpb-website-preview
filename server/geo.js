'use strict';
// Geo helpers: distance, a simple road-travel model, UK postcode extraction and cached geocoding.
const fs = require('fs');
const path = require('path');

// Approximate town-centre positions, used as the assumed start point of a negotiator's day.
const OFFICES = [
  { id: 'darlington', name: 'Darlington', lat: 54.5233, lng: -1.5528 },
  { id: 'newcastle', name: 'Newcastle', lat: 54.9783, lng: -1.6178 },
  { id: 'northallerton', name: 'Northallerton', lat: 54.3381, lng: -1.4343 },
  { id: 'carlisle', name: 'Carlisle', lat: 54.8951, lng: -2.9382 },
  { id: 'penrith', name: 'Penrith', lat: 54.6641, lng: -2.7527 },
  { id: 'kendal', name: 'Kendal', lat: 54.3283, lng: -2.7487 },
  { id: 'cockermouth', name: 'Cockermouth', lat: 54.6615, lng: -3.3637 }
];

const rad = d => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Straight-line miles x 1.3 for road distance, ~25 mph for short urban hops and ~40 mph for longer runs.
function travelMins(a, b) {
  const road = haversine(a, b) * 1.3;
  const mph = road < 5 ? 25 : 40;
  return Math.max(5, Math.ceil((road / mph) * 60));
}

function nearestOffice(p) {
  return OFFICES.reduce((best, o) => (haversine(o, p) < haversine(best, p) ? o : best), OFFICES[0]);
}

function extractPostcode(text) {
  const m = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(String(text || ''));
  return m ? { outcode: m[1].toUpperCase(), postcode: `${m[1]} ${m[2]}`.toUpperCase() } : null;
}

// ---- Geocoding (postcodes.io) with a persistent server-side cache ----
const CACHE_FILE = process.env.GEOCACHE_FILE || path.join(__dirname, 'data', 'geocache.json');
let cache = null;

const loadCache = () => {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { cache = {}; }
  return cache;
};

const saveCache = () => {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) { /* cache is an optimisation only */ }
};

const api = async (method, p, body) => {
  const res = await fetch('https://api.postcodes.io' + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000)
  });
  const json = await res.json().catch(() => null);
  if (!json || res.status >= 500) throw new Error('geocoder unavailable');
  return json;
};

// Resolves free-text locations to {lat,lng} (or null). Only the postcode, or just its outcode when
// GEOCODE_PRECISION=outcode, leaves the server. Set GEOCODE=off to disable remote lookups entirely.
async function geocode(texts, opts = {}) {
  const precision = opts.precision || process.env.GEOCODE_PRECISION || 'full';
  const remote = opts.remote !== undefined ? opts.remote : process.env.GEOCODE !== 'off';
  const c = loadCache();
  const keys = texts.map(t => {
    const x = extractPostcode(t);
    return x ? (precision === 'outcode' ? x.outcode : x.postcode) : null;
  });
  const missing = [...new Set(keys.filter(k => k && !(k in c)))];
  if (missing.length && remote) {
    try {
      if (precision === 'outcode') {
        await Promise.all(missing.map(async k => {
          const j = await api('GET', `/outcodes/${encodeURIComponent(k)}`);
          c[k] = j.status === 200 && j.result ? [j.result.latitude, j.result.longitude] : null;
        }));
      } else {
        for (let i = 0; i < missing.length; i += 100) {
          const batch = missing.slice(i, i + 100);
          const j = await api('POST', '/postcodes', { postcodes: batch });
          (j.result || []).forEach((r, n) => {
            c[batch[n]] = r && r.result && r.result.latitude != null ? [r.result.latitude, r.result.longitude] : null;
          });
        }
      }
      saveCache();
    } catch (e) { /* leave uncached; events without coordinates get a flat buffer */ }
  }
  return keys.map(k => (k && c[k] ? { lat: c[k][0], lng: c[k][1] } : null));
}

module.exports = { OFFICES, haversine, travelMins, nearestOffice, extractPostcode, geocode };
