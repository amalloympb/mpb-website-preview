'use strict';
// Run with: node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { londonToUtc, expand, computeAvailability } = require('../engine');
const { travelMins, extractPostcode, haversine } = require('../geo');

const utc = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
const iso = ms => new Date(ms).toISOString();
const PROP = { id: 'P1', lat: 54.53, lng: -1.55 };
const NOW = utc(2026, 10, 22, 6, 0); // Thu 22 Oct 2026, 07:00 BST
const slotsOn = (res, date) => ((res.days.find(d => d.date === date) || {}).slots || []).map(s => s.t);
const avail = (negotiators, extra = {}) => computeAvailability({ negotiators, property: PROP, now: NOW, ...extra });

test('londonToUtc handles BST and GMT', () => {
  assert.equal(iso(londonToUtc(2026, 10, 23, 10, 0)), '2026-10-23T09:00:00.000Z');
  assert.equal(iso(londonToUtc(2026, 10, 26, 10, 0)), '2026-10-26T10:00:00.000Z');
  assert.equal(iso(londonToUtc(2026, 3, 30, 9, 0)), '2026-03-30T08:00:00.000Z');
});

test('geo: postcode extraction, distance and travel model', () => {
  assert.deepEqual(extractPostcode('Flat 2, 14 High Row, Darlington dl3 7qe'), { outcode: 'DL3', postcode: 'DL3 7QE' });
  assert.equal(extractPostcode('Client call'), null);
  assert.ok(Math.abs(haversine({ lat: 54.5233, lng: -1.5528 }, { lat: 54.9783, lng: -1.6178 }) - 31.6) < 1.5);
  assert.ok(travelMins({ lat: 54.5, lng: -1.5 }, { lat: 54.5, lng: -1.5 }) >= 5);
  assert.ok(travelMins({ lat: 54.5, lng: -1.5 }, { lat: 54.9, lng: -1.6 }) > travelMins({ lat: 54.5, lng: -1.5 }, { lat: 54.55, lng: -1.5 }));
});

test('expand: single event overlaps the window or not', () => {
  const ev = { start: '2026-10-23T09:00:00Z', end: '2026-10-23T10:00:00Z' };
  assert.equal(expand(ev, utc(2026, 10, 23), utc(2026, 10, 24)).length, 1);
  assert.equal(expand(ev, utc(2026, 10, 24), utc(2026, 10, 25)).length, 0);
});

test('expand: daily series from the past honours interval and exdate', () => {
  const ev = {
    start: '2026-10-19T09:00:00Z', end: '2026-10-19T09:30:00Z',
    rrule: { freq: 'Daily', interval: 2, dtstart: '2026-10-19T09:00:00Z' }, exdate: ['2026-10-23T09:00:00Z']
  };
  const got = expand(ev, utc(2026, 10, 20), utc(2026, 10, 28)).map(o => iso(o.start).slice(0, 10));
  assert.deepEqual(got, ['2026-10-21', '2026-10-25', '2026-10-27']);
});

test('expand: weekly series keeps the London wall-clock time across the DST change', () => {
  const ev = {
    start: '2026-10-19T09:00:00Z', end: '2026-10-19T09:30:00Z', // 10:00 BST
    rrule: { freq: 'Weekly', interval: 1, dtstart: '2026-10-19T09:00:00Z' }
  };
  const got = expand(ev, utc(2026, 10, 24), utc(2026, 11, 9)).map(o => iso(o.start));
  assert.deepEqual(got, ['2026-10-26T10:00:00.000Z', '2026-11-02T10:00:00.000Z']);
});

test('expand: byweekday (strings and rrule.js numbers) and count', () => {
  const mk = byweekday => ({
    start: '2026-10-19T09:00:00Z', end: '2026-10-19T09:30:00Z',
    rrule: { freq: 'Weekly', interval: 1, byweekday, count: 3, dtstart: '2026-10-19T09:00:00Z' }
  });
  for (const by of [['mo', 'we'], [0, 2]]) {
    const got = expand(mk(by), utc(2026, 10, 20), utc(2026, 12, 1)).map(o => iso(o.start).slice(0, 10));
    assert.deepEqual(got, ['2026-10-21', '2026-10-26']);
  }
});

test('expand: monthly skips short months and until stops the series', () => {
  const ev = {
    start: '2026-01-31T10:00:00Z', end: '2026-01-31T11:00:00Z',
    rrule: { freq: 'Monthly', interval: 1, dtstart: '2026-01-31T10:00:00Z', until: '2026-05-01T00:00:00Z' }
  };
  const got = expand(ev, utc(2026, 1, 1), utc(2026, 12, 31)).map(o => iso(o.start).slice(0, 10));
  assert.deepEqual(got, ['2026-01-31', '2026-03-31']);
});

test('availability: empty diary, grid, Sunday closed, lead time and DST', () => {
  const res = avail([{ id: 'a', events: [] }]);
  assert.ok(!res.days.some(d => d.date === '2026-10-25'), 'no Sunday');
  assert.equal(res.days.length, 10);
  const thu = slotsOn(res, '2026-10-22');
  assert.ok(thu[0] >= '10:00', 'three hour lead time applied');
  const sat = slotsOn(res, '2026-10-24');
  assert.equal(sat[sat.length - 1], '12:30');
  const fri = res.days.find(d => d.date === '2026-10-23').slots[0];
  const mon = res.days.find(d => d.date === '2026-10-26').slots[0];
  assert.equal(fri.t, mon.t);
  assert.equal(iso(Date.parse(fri.start) - 0).slice(11, 16), '08:' + fri.t.slice(3)); // BST: 09:xx local is 08:xx UTC
  assert.equal(iso(Date.parse(mon.start)).slice(11, 16), fri.t); // GMT after the clocks go back
});

test('availability: first slot of the day allows travel from the office', () => {
  const far = { id: 'a', base: { lat: 54.9, lng: -2.9 }, events: [] }; // Carlisle start, property near Darlington
  const slots = slotsOn(avail([far]), '2026-10-23');
  assert.ok(slots[0] > '10:00', `first slot ${slots[0]} should be well after opening`);
});

test('availability: overlapping appointment blocks, travel pads a distant one', () => {
  const near = { lat: 54.531, lng: -1.551 };
  const farAway = { lat: 54.9, lng: -2.9 }; // Carlisle
  const day = d => `2026-10-23T${d}:00Z`; // 08:00Z = 09:00 BST
  const diary = loc => [{ id: 'a', events: [{ start: day('09:00'), end: day('10:00'), ...loc }] }]; // 10:00-11:00 BST
  const withNear = slotsOn(avail(diary(near)), '2026-10-23');
  assert.ok(!withNear.includes('10:00') && !withNear.includes('10:30'));
  assert.ok(withNear.includes('11:30'), 'nearby appointment needs only a short gap');
  const withFar = slotsOn(avail(diary(farAway)), '2026-10-23');
  assert.ok(!withFar.includes('11:30') && !withFar.includes('12:00'), 'a long drive blocks the following slots');
  assert.ok(withFar.includes('14:30'));
});

test('availability: unlocated appointment uses a flat buffer', () => {
  const res = avail([{ id: 'a', events: [{ start: '2026-10-23T09:00:00Z', end: '2026-10-23T10:00:00Z' }] }]); // ends 11:00 BST
  const t = slotsOn(res, '2026-10-23');
  assert.ok(!t.includes('11:00'));
  assert.ok(t.includes('11:30'));
});

test('availability: all-day event blocks that day only, exclusive end respected', () => {
  const res = avail([{ id: 'a', events: [{ start: '2026-10-23T00:00:00Z', end: '2026-10-24T00:00:00Z', allDay: true }] }]);
  assert.equal(slotsOn(res, '2026-10-23').length, 0);
  assert.ok(slotsOn(res, '2026-10-24').length > 0);
});

test('availability: a slot is offered if any negotiator is free', () => {
  const busy = { id: 'a', events: [{ start: '2026-10-23T08:00:00Z', end: '2026-10-23T16:30:00Z' }] };
  const free = { id: 'b', events: [] };
  assert.equal(slotsOn(avail([busy]), '2026-10-23').length, 0);
  const both = avail([busy, free]).days.find(d => d.date === '2026-10-23');
  assert.ok(both.slots.every(s => s.free.length === 1 && s.free[0].id === 'b'));
});

test('availability: nearby flag when an adjacent appointment is within 3 miles', () => {
  const ev = { start: '2026-10-23T09:00:00Z', end: '2026-10-23T10:00:00Z', lat: 54.54, lng: -1.56 };
  const res = avail([{ id: 'a', events: [ev] }]);
  const s = res.days.find(d => d.date === '2026-10-23').slots;
  assert.equal(s.find(x => x.t === '11:30').nearby, true);
  assert.equal(s.find(x => x.t === '14:00').nearby, false);
});

test('availability: holds block the same property and the held negotiator', () => {
  const hold = { property_id: 'P1', negotiator: 'a', start: utc(2026, 10, 23, 9, 0), end: utc(2026, 10, 23, 9, 30), lat: PROP.lat, lng: PROP.lng };
  const res = avail([{ id: 'a', events: [] }, { id: 'b', events: [] }], { holds: [hold] });
  assert.ok(!slotsOn(res, '2026-10-23').includes('10:00'), 'same property cannot be double booked');
  const other = avail([{ id: 'a', events: [] }, { id: 'b', events: [] }], { holds: [{ ...hold, property_id: 'P2' }] });
  const s10 = other.days.find(d => d.date === '2026-10-23').slots.find(s => s.t === '10:00');
  assert.deepEqual(s10.free.map(f => f.id), ['b'], 'held negotiator is busy for another property');
});

test('availability: closed dates are skipped', () => {
  const res = avail([{ id: 'a', events: [] }], { opts: { closed: ['2026-10-23'] } });
  assert.ok(!res.days.some(d => d.date === '2026-10-23'));
});
