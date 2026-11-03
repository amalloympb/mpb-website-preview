'use strict';
// Veco adapter: request shape and response mapping, with fetch stubbed (no network, no real data).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.GEOCODE = 'off';
process.env.GEOCACHE_FILE = path.join(os.tmpdir(), `mpb-geo-${process.pid}.json`);
process.env.VECO_RESOURCE_IDS = '101, 102';
process.env.VECO_TOKEN = 'test-token';

const veco = require('../diary/veco');

test('configured only with resources and credentials', () => {
  assert.equal(veco.configured(), true);
  const t = process.env.VECO_TOKEN;
  delete process.env.VECO_TOKEN;
  assert.equal(veco.configured(), false);
  process.env.VECO_TOKEN = t;
});

test('getBusy posts the scheduler query and groups events per negotiator', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ([
      { id: 'a', resourceId: 101, title: 'x', start: '2026-10-23T09:00:00Z', end: '2026-10-23T09:30:00Z', allDay: false, extendedProps: { location: '1 High Row, Darlington DL3 7QE' } },
      { id: 'b', resourceId: '102', start: '2026-10-23T00:00:00Z', end: '2026-10-24T00:00:00Z', allDay: true, rrule: null, exdate: [] },
      { id: 'c', resourceId: 999, start: '2026-10-23T09:00:00Z', end: '2026-10-23T09:30:00Z' }
    ]) };
  };
  const { negotiators } = await veco.getBusy({ fresh: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/scheduler\/Appointments\/1\/$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.resources, [101, 102]);
  assert.deepEqual(body.status, ['0', '1', '3']);
  assert.match(body.fromDate, /^\d{4}-\d{2}-\d{2}T00:00$/);
  assert.deepEqual(negotiators.map(n => [n.id, n.events.length]), [['veco-101', 1], ['veco-102', 1]]);
  assert.equal(negotiators[1].events[0].allDay, true);
  assert.equal(negotiators[0].events[0].lat, undefined, 'geocoding off: no coordinates, no remote calls');
});

test('client credentials: token request asks for scheduler-service, then lists resources with the bearer token', async () => {
  const keep = process.env.VECO_TOKEN;
  delete process.env.VECO_TOKEN;
  process.env.VECO_CLIENT_ID = 'cid';
  process.env.VECO_CLIENT_SECRET = 'csecret';
  assert.equal(veco.hasCredentials(), true);
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (/\/connect\/token$/.test(url)) return { ok: true, status: 200, json: async () => ({ access_token: 'cc-token', expires_in: 3600 }) };
    return { ok: true, status: 200, json: async () => ({ name: 'Users', resources: [{ id: 7, title: 'A Negotiator' }] }) };
  };
  const list = await veco.listResources(1);
  assert.deepEqual(list, [{ id: 7, title: 'A Negotiator' }]);
  assert.equal(calls[0].init.method, 'POST');
  const form = new URLSearchParams(String(calls[0].init.body));
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('scope'), 'scheduler-service');
  assert.match(calls[1].url, /\/api\/scheduler\/Appointments\/resources\/\?context=1$/);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer cc-token');
  delete process.env.VECO_CLIENT_ID;
  delete process.env.VECO_CLIENT_SECRET;
  process.env.VECO_TOKEN = keep;
});

test('getBusy surfaces Veco errors without leaking credentials', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => veco.getBusy({ fresh: true }), e => /401/.test(e.message) && !/test-token/.test(e.message));
});
