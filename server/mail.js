'use strict';
// Emails website leads to the right office. A small SMTP client (no dependencies) plus lead formatting and routing.
// Recipients come only from environment settings, never from the request, so the form cannot be used to send mail elsewhere.
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');
const { haversine } = require('./geo');

const OFFICES = [
  { id: 'darlington', name: 'Darlington', lat: 54.5233, lng: -1.5528 },
  { id: 'newcastle', name: 'Newcastle', lat: 54.9783, lng: -1.6178 },
  { id: 'northallerton', name: 'Northallerton', lat: 54.3381, lng: -1.4343 },
  { id: 'carlisle', name: 'Carlisle', lat: 54.8951, lng: -2.9382 },
  { id: 'penrith', name: 'Penrith', lat: 54.6641, lng: -2.7527 },
  { id: 'kendal', name: 'Kendal', lat: 54.3283, lng: -2.7487 }
];
const RM_BRANCH_OFFICE = { 90144: 'carlisle', 90147: 'penrith' };

// Forms send either the office id (callback) or its name (town pages); anything else means "no office".
const officeId = v => {
  const k = String(v || '').toLowerCase().replace(/[^a-z]/g, '');
  return OFFICES.some(o => o.id === k) ? k : '';
};

// Same rule as the browser: Rightmove rows know their branch, the rest use the nearest office within 45 miles.
const officeForProperty = p => {
  if (!p) return '';
  if (RM_BRANCH_OFFICE[p.rm_branch]) return RM_BRANCH_OFFICE[p.rm_branch];
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return '';
  const best = OFFICES.reduce((a, o) => (haversine(o, p) < haversine(a, p) ? o : a));
  return haversine(best, p) <= 45 ? best.id : '';
};

// ---- Addresses and headers ----
const ADDR = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isAddress = v => typeof v === 'string' && v.length <= 254 && ADDR.test(v);
const oneLine = s => String(s).replace(/[\r\n\0]+/g, ' ').trim();
const list = v => String(v || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);

function parseFrom(v) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>]+)>\s*$/.exec(String(v || ''));
  const addr = (m ? m[2] : String(v || '')).trim();
  if (!isAddress(addr)) return null;
  const name = oneLine((m && m[1]) || 'My Property Box website').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'My Property Box website';
  return { addr, name };
}

// RFC 2047 encoded words, kept under 75 characters each.
function encodeHeader(s) {
  s = oneLine(s);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let cur = '';
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch) > 45) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map(w => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

// ---- Configuration ----
// Returns null unless SMTP is set up and at least one recipient is configured.
function config(env = process.env) {
  const from = parseFrom(env.MAIL_FROM);
  const to = list(env.LEAD_EMAIL_TO).filter(isAddress);
  const anyOffice = OFFICES.some(o => list(env['LEAD_EMAIL_' + o.id.toUpperCase()]).some(isAddress));
  if (!env.SMTP_HOST || !from || !(to.length || anyOffice)) return null;
  const secure = /^(1|true|yes)$/i.test(env.SMTP_SECURE || '');
  return {
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || (secure ? 465 : 587), secure,
    user: env.SMTP_USER || '', pass: env.SMTP_PASS || '',
    insecure: /^(1|true|yes)$/i.test(env.SMTP_ALLOW_INSECURE || ''),
    from, to
  };
}

function recipientsFor(office, env = process.env) {
  const own = list(env['LEAD_EMAIL_' + String(office || '').toUpperCase()]).filter(isAddress);
  const main = own.length ? own : list(env.LEAD_EMAIL_TO).filter(isAddress);
  const cc = list(env.LEAD_EMAIL_CC).filter(isAddress).filter(a => !main.includes(a));
  return { to: main, cc };
}

// ---- Formatting ----
const TYPE_LABEL = {
  enquiry: 'Property enquiry', callback: 'Callback request', valuation: 'Valuation request',
  compliance_check: 'Landlord compliance check', alert: 'Property alert sign-up', report: 'Calculator report request',
  viewing_booking: 'Viewing request'
};
const LABELS = {
  name: 'Name', email: 'Email', phone: 'Phone', contact_pref: 'Best way to contact', intent: 'Looking to', enquiry_type: 'Enquiry type',
  message: 'Message', office: 'Office', town: 'Town', address: 'Address', postcode: 'Postcode', bedrooms: 'Bedrooms', property_type: 'Property type',
  timeline: 'Timeline', reason: 'Reason', buyer_position: 'Buyer position', occupants: 'Occupants', move_in_date: 'Move-in date',
  viewing_date: 'Preferred date', viewing_time: 'Preferred time', viewing_slot: 'Requested slot', property_address: 'Property',
  property_price: 'Price', property_section: 'Listing type', property_status: 'Status', property_url: 'Link', property_crm: 'CRM', property_id: 'Property ID',
  has_360_tour: '360 tour', search_text: 'Search', score: 'Score', outstanding: 'Outstanding items', tool: 'Calculator', source: 'Form',
  listed_elsewhere: 'Listed elsewhere', managed_by: 'Currently managed by', portfolio: 'Portfolio size', marketing: 'Marketing consent'
};
const FIRST = ['name', 'email', 'phone', 'contact_pref', 'enquiry_type', 'intent', 'message', 'property_address', 'viewing_slot', 'viewing_date', 'viewing_time', 'address', 'postcode', 'town'];
const HIDE = new Set(['lead_type', 'submitted_at', 'office', 'page', 'attribution', 'consent_statement', 'consent', 'company_website', 'ref', 'received']);

const label = k => LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
function show(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.map(show).join(', ');
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${label(k)}: ${show(x)}`).join('; ');
  return String(v);
}
const when = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (UK time)';
};

// rec: { type, ref, received, office, fields, consent_statement, attribution, page, note }
function formatLead(rec) {
  const f = rec.fields || {};
  const who = f.name || f.email || f.phone || 'website visitor';
  const kind = rec.type === 'enquiry' && f.enquiry_type === 'interest' ? 'Register of interest' : (TYPE_LABEL[rec.type] || 'Website lead');
  const what = f.property_address || f.address || f.town || '';
  const subject = oneLine(`${kind}${f.intent && rec.type === 'valuation' ? ` (${f.intent})` : ''}: ${what ? `${what} - ` : ''}${who}`).slice(0, 150);

  const keys = [...FIRST.filter(k => k in f), ...Object.keys(f).filter(k => !FIRST.includes(k) && !HIDE.has(k))].filter(k => !HIDE.has(k) && f[k] !== '' && f[k] != null);
  const lines = [`New ${kind.toLowerCase()} from the My Property Box website.`, ''];
  if (rec.ref) lines.push(`Reference: ${rec.ref}`);
  lines.push(`Received: ${when(rec.received)}`);
  if (rec.office) lines.push(`Office: ${(OFFICES.find(o => o.id === rec.office) || {}).name || rec.office}`);
  lines.push('');
  for (const k of keys) lines.push(`${label(k)}: ${show(f[k]).slice(0, 1500)}`);
  if (rec.note) lines.push('', rec.note);
  if (rec.consent_statement) lines.push('', `Consent given: "${String(rec.consent_statement).slice(0, 600)}"`);
  const a = rec.attribution && typeof rec.attribution === 'object' ? Object.entries(rec.attribution).filter(([, v]) => v) : [];
  if (rec.page || a.length) {
    lines.push('', '--');
    if (rec.page) lines.push(`Page: ${String(rec.page).slice(0, 300)}`);
    for (const [k, v] of a) lines.push(`${label(k)}: ${String(v).slice(0, 200)}`);
  }
  const replyTo = isAddress(f.email) ? f.email : '';
  if (replyTo) lines.push('', 'Reply to this email to answer the customer directly.');
  return { subject, text: lines.join('\r\n'), replyTo };
}

function buildMessage({ from, to, cc, replyTo, subject, text }) {
  const domain = from.addr.split('@')[1];
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');
  const head = [
    `From: "${from.name}" <${from.addr}>`,
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'Auto-Submitted: auto-generated',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64'
  ];
  return head.join('\r\n') + '\r\n\r\n' + body;
}

// ---- SMTP ----
function reader(socket) {
  let buf = '', parts = [], err = null, waiter = null;
  const done = [];
  const flush = () => {
    if (!waiter || !(done.length || err)) return;
    const w = waiter; waiter = null;
    if (done.length) w.resolve(done.shift()); else w.reject(err);
  };
  const onData = d => {
    buf += d.toString('latin1');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      const m = /^(\d{3})([ -])?(.*)$/.exec(line);
      if (!m) continue;
      parts.push(m[3]);
      if (m[2] !== '-') { done.push({ code: Number(m[1]), lines: parts }); parts = []; }
    }
    flush();
  };
  const fail = e => { err = err || e; flush(); };
  socket.on('data', onData);
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('SMTP connection closed')));
  return {
    next: () => new Promise((resolve, reject) => { waiter = { resolve, reject }; flush(); }),
    detach: () => socket.removeListener('data', onData)
  };
}

async function smtpSend(cfg, { from, to, data }, timeout = 15000) {
  const ca = cfg.ca ? { ca: cfg.ca } : {}; // set only by tests, to trust a local certificate
  let socket = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...ca }) : net.connect({ host: cfg.host, port: cfg.port });
  socket.setTimeout(timeout, () => socket.destroy(new Error('SMTP timeout')));
  let rd = reader(socket);
  const expect = async (codes, what) => {
    const r = await rd.next();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${what} failed: ${r.code} ${r.lines.join(' ').slice(0, 160)}`);
    return r;
  };
  const cmd = (line, codes, what) => { socket.write(line + '\r\n'); return expect(codes, what); };
  try {
    await expect([220], 'greeting');
    const name = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
    let ehlo = await cmd(`EHLO ${name}`, [250], 'EHLO');
    if (!cfg.secure) {
      if (ehlo.lines.some(l => /^STARTTLS\b/i.test(l))) {
        await cmd('STARTTLS', [220], 'STARTTLS');
        rd.detach();
        socket = tls.connect({ socket, servername: cfg.host, ...ca });
        socket.setTimeout(timeout, () => socket.destroy(new Error('SMTP timeout')));
        rd = reader(socket);
        ehlo = await cmd(`EHLO ${name}`, [250], 'EHLO');
      } else if (!cfg.insecure) {
        throw new Error('SMTP server does not offer STARTTLS, so nothing was sent');
      }
    }
    if (cfg.user) {
      const line = ehlo.lines.find(l => /^AUTH[ =]/i.test(l)) || '';
      const mechs = line.toUpperCase().split(/[ =]/).slice(1);
      const b64 = s => Buffer.from(s, 'utf8').toString('base64');
      if (!mechs.length || mechs.includes('PLAIN')) {
        await cmd('AUTH PLAIN ' + b64(`\0${cfg.user}\0${cfg.pass}`), [235], 'AUTH');
      } else if (mechs.includes('LOGIN')) {
        await cmd('AUTH LOGIN', [334], 'AUTH');
        await cmd(b64(cfg.user), [334], 'AUTH');
        await cmd(b64(cfg.pass), [235], 'AUTH');
      } else {
        throw new Error('SMTP server offers no supported sign-in method: ' + mechs.join(' '));
      }
    }
    await cmd(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
    for (const r of to) await cmd(`RCPT TO:<${r}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');
    socket.write(data.replace(/^\./gm, '..') + '\r\n.\r\n');
    await expect([250], 'message');
    try { socket.write('QUIT\r\n'); } catch (e) { /* already accepted */ }
  } catch (e) {
    if (!e.message) e.message = `SMTP connection to ${cfg.host}:${cfg.port} failed: ${(e.errors && e.errors[0] && e.errors[0].code) || e.code || 'unknown error'}`;
    throw e;
  } finally {
    socket.destroy();
  }
}

// Emails a lead. Resolves { sent: false } when mail is not configured; throws if sending fails.
async function sendLeadEmail(rec, env = process.env) {
  const cfg = config(env);
  if (!cfg) return { sent: false, reason: 'not_configured' };
  const { to, cc } = recipientsFor(rec.office, env);
  if (!to.length) return { sent: false, reason: 'no_recipient' };
  const { subject, text, replyTo } = formatLead(rec);
  const data = buildMessage({ from: cfg.from, to, cc, replyTo, subject, text });
  await smtpSend(cfg, { from: cfg.from.addr, to: [...to, ...cc], data });
  return { sent: true, to: [...to, ...cc] };
}

const NOTE_UNDIARISED = 'A slot has been held on the website so it is not offered twice. It has NOT been added to the diary automatically: please confirm the time with the customer and add it to the diary.';

// Turns a stored viewing booking (see server.js) into an email record.
function viewingRecord(r, property) {
  const c = r.contact, p = r.property;
  return {
    type: 'viewing_booking', ref: r.ref, received: r.received, office: officeForProperty(property),
    fields: {
      name: c.name, email: c.email, phone: c.phone, message: c.message, buyer_position: c.buyer_position, occupants: c.occupants, move_in_date: c.move_in_date,
      property_address: p.address, property_price: p.price, property_url: p.url, property_crm: p.crm, viewing_slot: `${r.slot.local} (UK time)`
    },
    note: NOTE_UNDIARISED, consent_statement: r.consent_statement, attribution: r.attribution
  };
}

module.exports = { OFFICES, officeId, officeForProperty, config, recipientsFor, formatLead, buildMessage, viewingRecord, smtpSend, sendLeadEmail, isAddress };
