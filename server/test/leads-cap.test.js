'use strict';
// The hourly cap keeps a flood of submissions out of the mailbox while still logging every lead.
const os = require('os');
const fs = require('fs');
const path = require('path');
delete process.env.DIARY_MODE;
delete process.env.LEAD_WEBHOOK_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpb-cap-'));
process.env.RATE_LEADS = '200';
process.env.RATE_LEADS_GLOBAL = '2';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { fakeSmtp } = require('./fake-smtp');

test('past the hourly cap, leads are logged but not emailed', async () => {
  const smtp = await fakeSmtp();
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_ALLOW_INSECURE: '1', MAIL_FROM: 'web@example.com', LEAD_EMAIL_TO: 'info@example.com' });
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const body = { lead_type: 'callback', name: 'Jo', phone: '07700 900123', consent: true };
    const out = [];
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(r.status, 200);
      out.push((await r.json()).channels.join('+'));
    }
    assert.deepEqual(out, ['file+email', 'file+email', 'file', 'file']);
    assert.equal(smtp.messages.length, 2);
    assert.equal(fs.readFileSync(path.join(process.env.DATA_DIR, 'leads.jsonl'), 'utf8').trim().split('\n').length, 4);
  } finally {
    server.close();
    await smtp.close();
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
});
