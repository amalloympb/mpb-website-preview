'use strict';
// Re-runs feed/sync.js on a timer so the Node host keeps listings fresh without a redeploy.
// Off unless FEED_REFRESH_MINUTES is set. A failed run leaves the previous listings in place.
const { spawn } = require('child_process');
const path = require('path');

const SYNC = path.join(__dirname, '..', 'feed', 'sync.js');
const MIN_MINUTES = 5;
const TIMEOUT_MS = 10 * 60 * 1000;

function runSync() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SYNC], { cwd: path.dirname(SYNC), stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = d => { tail = (tail + d).slice(-1500); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, tail: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, tail }); });
  });
}

function startFeedRefresh({ minutes, firstDelayMs = 60000, run = runSync, log = console } = {}) {
  if (!(Number(minutes) > 0)) return null;
  const every = Math.max(MIN_MINUTES, Number(minutes)) * 60000;
  let running = false;
  const tick = async () => {
    if (running) return false;
    running = true;
    try {
      const r = await run();
      if (r.ok) log.log('Property feed refreshed');
      else log.warn('Property feed refresh failed, keeping the previous listings. ' + String(r.tail || '').trim().split('\n').slice(-3).join(' | '));
    } catch (e) {
      log.warn('Property feed refresh failed, keeping the previous listings. ' + e.message);
    } finally { running = false; }
    return true;
  };
  const first = setTimeout(tick, firstDelayMs);
  const timer = setInterval(tick, every);
  first.unref();
  timer.unref();
  return { tick, every, stop() { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { startFeedRefresh, runSync };
