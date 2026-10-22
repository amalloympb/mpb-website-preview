'use strict';
// Demo diary: deterministic, made-up appointments so the booking flow can be shown without a CRM.
// Nothing here reads real data.
const { londonToUtc, londonParts } = require('../engine');
const { nearestOffice } = require('../geo');

const mulberry = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = s => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

const NEGOTIATORS = ['demo-1', 'demo-2', 'demo-3'];

async function getBusy({ property, now = Date.now() }) {
  const office = nearestOffice(property);
  const t0 = londonParts(now);
  const negotiators = NEGOTIATORS.map((id, i) => {
    const events = [];
    for (let d = 0; d < 21; d++) {
      const day = new Date(Date.UTC(t0.year, t0.month - 1, t0.day + d));
      const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, dd = day.getUTCDate();
      const rnd = mulberry(hash(`${property.id}|${i}|${y}-${m}-${dd}`));
      if (rnd() < 0.06) { // the odd day out of the office
        events.push({ start: londonToUtc(y, m, dd), end: londonToUtc(y, m, dd + 1), allDay: true });
        continue;
      }
      let cursor = 9 * 60 + Math.floor(rnd() * 4) * 30;
      for (let k = 0, n = 2 + Math.floor(rnd() * 3); k < n && cursor < 16 * 60; k++) {
        const len = [30, 45, 60][Math.floor(rnd() * 3)];
        const miles = rnd() < 0.35 ? rnd() * 2.5 : 2 + rnd() * 14; // some close to the property, some further out
        const a = rnd() * Math.PI * 2;
        events.push({
          start: londonToUtc(y, m, dd, 0, cursor), end: londonToUtc(y, m, dd, 0, cursor + len),
          lat: property.lat + (Math.sin(a) * miles) / 69, lng: property.lng + (Math.cos(a) * miles) / 40
        });
        cursor += len + 30 * (1 + Math.floor(rnd() * 5));
      }
    }
    if (i === 0) { // a weekly team meeting, to exercise recurrence
      events.push({ start: '2026-01-05T09:00:00Z', end: '2026-01-05T09:30:00Z', rrule: { freq: 'Weekly', interval: 1, byweekday: ['mo'], dtstart: '2026-01-05T09:00:00Z' } });
    }
    return { id, base: office, events };
  });
  return { negotiators };
}

module.exports = { name: 'mock', configured: () => true, getBusy };
