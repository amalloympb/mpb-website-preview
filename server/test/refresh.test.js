'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startFeedRefresh } = require('../refresh');

const quiet = () => { const l = { logs: [], warns: [] }; l.log = m => l.logs.push(m); l.warn = m => l.warns.push(m); return l; };
const later = () => new Promise(r => setTimeout(r, 10));

test('feed refresh is off unless minutes is set', () => {
  assert.equal(startFeedRefresh({}), null);
  assert.equal(startFeedRefresh({ minutes: '' }), null);
  assert.equal(startFeedRefresh({ minutes: '0' }), null);
});

test('feed refresh never runs below five minutes apart', () => {
  const r = startFeedRefresh({ minutes: 1, firstDelayMs: 1e9, run: async () => ({ ok: true }), log: quiet() });
  assert.equal(r.every, 5 * 60000);
  r.stop();
  const r30 = startFeedRefresh({ minutes: '30', firstDelayMs: 1e9, run: async () => ({ ok: true }), log: quiet() });
  assert.equal(r30.every, 30 * 60000);
  r30.stop();
});

test('feed refresh does not overlap runs and survives failures', async () => {
  const log = quiet();
  let calls = 0, release;
  const gate = new Promise(r => { release = r; });
  const r = startFeedRefresh({ minutes: 30, firstDelayMs: 1e9, log, run: async () => { calls++; await gate; return { ok: false, tail: 'a\nb\nc\nd' }; } });
  const first = r.tick();
  assert.equal(await r.tick(), false);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(log.warns.length, 1);
  assert.match(log.warns[0], /keeping the previous listings/);
  assert.doesNotMatch(log.warns[0], /\ba \|/);
  r.stop();
});

test('feed refresh reports a thrown error instead of crashing', async () => {
  const log = quiet();
  const r = startFeedRefresh({ minutes: 30, firstDelayMs: 1e9, log, run: async () => { throw new Error('boom'); } });
  await r.tick();
  await later();
  assert.match(log.warns[0], /boom/);
  r.stop();
});
