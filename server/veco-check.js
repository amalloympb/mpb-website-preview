'use strict';
// Checks the Veco connection once credentials are in server/.env:
//   node server/veco-check.js            confirm the token, list offices and staff ids, count diary entries
//   node server/veco-check.js darlington only list staff whose name contains the text
// Prints names and ids only. Credentials are never printed.
const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env file */ }

const veco = require('./diary/veco');

(async () => {
  if (!veco.hasCredentials()) {
    console.log('No Veco credentials found. Add VECO_CLIENT_ID and VECO_CLIENT_SECRET to server/.env (see .env.example).');
    process.exit(1);
  }
  const filter = (process.argv[2] || '').toLowerCase();

  const offices = await veco.listResources(2);
  console.log('Token OK. Offices in Veco:');
  offices.forEach(o => console.log(`  ${String(o.id).padEnd(8)} ${o.title}`));

  const staff = await veco.listResources(1);
  const shown = staff.filter(s => !filter || String(s.title).toLowerCase().includes(filter));
  console.log(`\nStaff (${shown.length} of ${staff.length}). Put the ids whose diaries count for viewings in VECO_RESOURCE_IDS:`);
  shown.forEach(s => console.log(`  ${String(s.id).padEnd(8)} ${s.title}`));

  if (!veco.configured()) {
    console.log('\nVECO_RESOURCE_IDS is not set yet. Set it, then run this again to check the diaries.');
    return;
  }
  const { negotiators } = await veco.getBusy({ fresh: true });
  console.log('\nDiary entries in the next 14 days for VECO_RESOURCE_IDS:');
  negotiators.forEach(n => {
    const repeating = n.events.filter(e => e.rrule).length;
    const allDay = n.events.filter(e => e.allDay).length;
    const located = n.events.filter(e => typeof e.lat === 'number').length;
    console.log(`  ${n.id.padEnd(14)} ${String(n.events.length).padStart(3)} entries, ${repeating} repeating, ${allDay} all-day, ${located} with a map location`);
  });
})().catch(e => {
  console.error('\nVeco check failed:', e.message);
  if (/\(40[013]\)/.test(e.message)) console.error('Veco rejected the credentials or scope. Ask Veco to confirm the client is allowed the scheduler-service scope.');
  process.exit(1);
});
