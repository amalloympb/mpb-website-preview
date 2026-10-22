'use strict';
// Pure slot engine: expands recurring diary events and finds viewing slots that leave enough
// travel time between a negotiator's appointments. No I/O, so it is easy to test.
const { travelMins, nearestOffice, haversine } = require('./geo');

const TZ = 'Europe/London';
const DAY = 86400000;
const MIN = 60000;
const MAX_ITER = 20000;

const DEFAULTS = {
  days: 10,          // working days offered
  leadHours: 3,      // earliest bookable time from now
  slotMins: 30,      // slot length and grid step
  buffer: 10,        // minutes added to modelled travel
  flatBuffer: 20,    // gap needed next to an appointment with no known location
  nearMiles: 3,      // "team already in your area" radius
  nearWindowMins: 90, // ...and how close in time the neighbouring appointment must be
  // JS weekday (0 = Sunday) -> [open, close] in minutes after midnight, Europe/London
  hours: { 1: [540, 1050], 2: [540, 1050], 3: [540, 1050], 4: [540, 1050], 5: [540, 1050], 6: [540, 780] },
  closed: []         // 'YYYY-MM-DD' dates with no viewings (bank holidays etc.)
};

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
const pad = n => String(n).padStart(2, '0');
const toMs = v => (typeof v === 'number' ? v : Date.parse(v));
const ymd = d => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const dateKey = p => `${p.year}-${pad(p.month)}-${pad(p.day)}`;

function londonParts(ms) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value;
  return o;
}

const offsetAt = ms => {
  const p = londonParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

// Europe/London wall-clock time -> UTC milliseconds (DST aware)
function londonToUtc(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetAt(guess);
  const off2 = offsetAt(t);
  if (guess - off2 !== t) t = guess - off2;
  return t;
}

const londonKey = ms => dateKey(londonParts(ms));
const addDays = (p, n) => ymd(new Date(Date.UTC(p.year, p.month - 1, p.day + n)));
const dow = p => new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();

// ---- Recurrence expansion ----
const DOW = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

function weekdays(r, startDow) {
  const out = new Set();
  for (const x of [].concat(r.byweekday == null ? [] : r.byweekday)) {
    const v = x && typeof x === 'object' ? (x.weekday != null ? x.weekday : x.day) : x;
    if (typeof v === 'number') out.add((v + 1) % 7); // rrule.js numbering: 0 = Monday
    else if (typeof v === 'string' && DOW[v.slice(0, 2).toLowerCase()] !== undefined) out.add(DOW[v.slice(0, 2).toLowerCase()]);
  }
  return out.size ? [...out] : [startDow];
}

function* seriesDates(r, st, horizon) {
  const interval = Math.max(1, Number(r.interval) || 1);
  const freq = String(r.freq).toLowerCase();
  const start = Date.UTC(st.year, st.month - 1, st.day);
  const startDow = new Date(start).getUTCDay();
  let guard = 0;
  if (freq.startsWith('dai')) {
    for (let k = 0; guard++ < MAX_ITER; k++) {
      const t = start + k * interval * DAY;
      yield ymd(new Date(t));
      if (t > horizon) return;
    }
  } else if (freq.startsWith('week')) {
    const days = weekdays(r, startDow).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const monday = start - ((startDow + 6) % 7) * DAY;
    for (let w = 0; guard++ < MAX_ITER; w += interval) {
      for (const d of days) {
        const t = monday + (w * 7 + ((d + 6) % 7)) * DAY;
        if (t >= start) yield ymd(new Date(t));
      }
      if (monday + w * 7 * DAY > horizon) return;
    }
  } else if (freq.startsWith('month') || freq.startsWith('year')) {
    const step = freq.startsWith('year') ? 12 : 1;
    for (let k = 0; guard++ < MAX_ITER; k += interval * step) {
      const y = st.year + Math.floor((st.month - 1 + k) / 12), m0 = (st.month - 1 + k) % 12;
      if (st.day <= new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()) yield { year: y, month: m0 + 1, day: st.day };
      if (Date.UTC(y, m0, 1) > horizon) return;
    }
  } else {
    yield { year: st.year, month: st.month, day: st.day };
  }
}

// Returns the occurrences of one diary event that overlap [winStart, winEnd), as {start,end,allDay,lat,lng}
function expand(ev, winStart, winEnd) {
  const s = toMs(ev.start);
  let e = toMs(ev.end);
  if (!Number.isFinite(s)) return [];
  if (!Number.isFinite(e) || e < s) e = s;
  if (ev.allDay && e <= s) e = s + DAY;
  const dur = e - s;
  const base = { allDay: !!ev.allDay, lat: ev.lat, lng: ev.lng };
  // All-day events cover whole London dates (end exclusive). Adding 12h snaps both UTC-midnight and
  // London-midnight timestamps to the intended date.
  const span = (a, b) => (ev.allDay ? { d0: londonKey(a + 12 * 60 * MIN), d1: londonKey(b + 12 * 60 * MIN) } : {});
  const r = ev.rrule;
  if (!r || !r.freq) return e > winStart && s < winEnd ? [{ ...base, ...span(s, e), start: s, end: e }] : [];

  const ex = [].concat(ev.exdate || []);
  const exMin = new Set(ex.filter(x => String(x).length > 10).map(x => Math.round(toMs(x) / MIN)));
  const exDay = new Set(ex.filter(x => String(x).length <= 10).map(String));
  const st = londonParts(r.dtstart ? toMs(r.dtstart) : s);
  const until = r.until ? toMs(r.until) : Infinity;
  const count = Number(r.count) > 0 ? Number(r.count) : Infinity;
  const out = [];
  let n = 0;
  for (const d of seriesDates(r, st, winEnd)) {
    const t = londonToUtc(d.year, d.month, d.day, ev.allDay ? 0 : st.hour, ev.allDay ? 0 : st.minute);
    if (t > until || ++n > count || t >= winEnd) break;
    if (t + dur <= winStart) continue;
    if (exMin.has(Math.round(t / MIN)) || exDay.has(dateKey(d))) continue;
    out.push({ ...base, ...span(t, t + dur), start: t, end: t + dur });
  }
  return out;
}

// ---- Availability ----
function workingDays(now, o) {
  const closed = new Set(o.closed);
  const t0 = londonParts(now);
  const list = [];
  for (let i = 0; i < 60 && list.length < o.days; i++) {
    const d = addDays(t0, i);
    const hrs = o.hours[dow(d)];
    if (!hrs || closed.has(dateKey(d))) continue;
    const next = addDays(d, 1);
    list.push({
      key: dateKey(d),
      midnight: londonToUtc(d.year, d.month, d.day),
      nextMidnight: londonToUtc(next.year, next.month, next.day),
      open: londonToUtc(d.year, d.month, d.day, 0, hrs[0]),
      close: londonToUtc(d.year, d.month, d.day, 0, hrs[1])
    });
  }
  return list;
}

// Is negotiator n free for [s,e)? Returns {nearby} when free, otherwise null.
function check(n, s, e, day, prop, o) {
  let prev = null, next = null;
  for (const ev of n.occ) {
    if (ev.allDay) {
      if (day.key >= ev.d0 && (day.key < ev.d1 || ev.d1 <= ev.d0)) return null;
      continue;
    }
    if (ev.start < e && ev.end > s) return null;
    if (ev.end <= s && ev.end > day.midnight && (!prev || ev.end > prev.end)) prev = ev;
    if (ev.start >= e && ev.start < day.nextMidnight && (!next || ev.start < next.start)) next = ev;
  }
  const located = ev => ev.lat != null && ev.lng != null;
  const gapOk = (ev, mins) => mins >= (located(ev) ? travelMins(ev, prop) + o.buffer : o.flatBuffer);
  if (prev) { if (!gapOk(prev, (s - prev.end) / MIN)) return null; }
  else if ((s - day.open) / MIN < travelMins(n.base, prop)) return null;
  if (next && !gapOk(next, (next.start - e) / MIN)) return null;
  const near = (ev, gapMins) => ev && located(ev) && gapMins <= o.nearWindowMins && haversine(ev, prop) <= o.nearMiles;
  return { nearby: !!(near(prev, prev && (s - prev.end) / MIN) || near(next, next && (next.start - e) / MIN)) };
}

// negotiators: [{id, base?:{lat,lng}, events:[{start,end,allDay,rrule,exdate,lat,lng}]}]
// property: {id, lat, lng}; holds: [{property_id, negotiator, start, end, lat, lng}] (ms)
function computeAvailability({ negotiators, property, holds = [], now = Date.now(), opts = {} }) {
  const o = { ...DEFAULTS, ...opts };
  const days = workingDays(now, o);
  if (!days.length) return { days: [] };
  const winStart = days[0].midnight - DAY, winEnd = days[days.length - 1].nextMidnight + DAY;
  const base = nearestOffice(property);
  const pool = negotiators.map(n => {
    const occ = [];
    for (const ev of n.events || []) occ.push(...expand(ev, winStart, winEnd));
    for (const h of holds) if (h.negotiator === n.id) occ.push({ start: h.start, end: h.end, lat: h.lat, lng: h.lng });
    occ.sort((a, b) => a.start - b.start || a.end - b.end);
    return { id: n.id, base: n.base || base, occ };
  });
  const mine = holds.filter(h => h.property_id === property.id);
  const earliest = now + o.leadHours * 60 * MIN;
  const out = [];
  for (const day of days) {
    const slots = [];
    for (let s = day.open; s + o.slotMins * MIN <= day.close; s += o.slotMins * MIN) {
      const e = s + o.slotMins * MIN;
      if (s < earliest || mine.some(h => h.start < e && h.end > s)) continue;
      const free = [];
      for (const n of pool) { const r = check(n, s, e, day, property, o); if (r) free.push({ id: n.id, nearby: r.nearby }); }
      if (!free.length) continue;
      const p = londonParts(s);
      slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), t: `${pad(p.hour)}:${pad(p.minute)}`, nearby: free.some(f => f.nearby), free });
    }
    if (slots.length) out.push({ date: day.key, slots });
  }
  return { days: out };
}

module.exports = { DEFAULTS, TZ, londonParts, londonToUtc, londonKey, expand, computeAvailability };
