'use strict';
// A tiny in-process SMTP server for tests. Captures messages; can offer STARTTLS, AUTH, and reject recipients.
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');
const pfx = () => fs.readFileSync(path.join(FIXTURES, 'localhost.pfx'));
const secureContext = () => tls.createSecureContext({ pfx: pfx(), passphrase: 'test' });

function parseMessage(raw) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const headers = {};
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) (headers[line.slice(0, i).toLowerCase()] ||= []).push(line.slice(i + 1).trim());
  }
  const body = rest.join('\r\n\r\n');
  const text = /base64/i.test((headers['content-transfer-encoding'] || [''])[0]) ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') : body;
  return { headers, text, raw };
}

// opts: { starttls, implicitTls, auth: 'PLAIN LOGIN', credentials: { user, pass }, rejectRcpt: /regex/ }
async function fakeSmtp(opts = {}) {
  const messages = [];
  const commands = [];

  function session(sock, isTls, greet) {
    let buf = '', mode = 'cmd', cur = { rcpt: [], lines: [] };
    const w = s => sock.write(s + '\r\n');
    const ok = () => !opts.credentials || (cur.user === opts.credentials.user && cur.pass === opts.credentials.pass);
    const onData = d => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (mode === 'data') {
          if (line === '.') { messages.push({ from: cur.from, rcpt: cur.rcpt, user: cur.user, tls: isTls, ...parseMessage(cur.lines.join('\r\n')) }); cur = { rcpt: [], lines: [], user: cur.user, pass: cur.pass }; mode = 'cmd'; w('250 queued'); }
          else cur.lines.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        if (mode === 'login-user') { cur.user = Buffer.from(line, 'base64').toString(); mode = 'login-pass'; w('334 UGFzc3dvcmQ6'); continue; }
        if (mode === 'login-pass') { cur.pass = Buffer.from(line, 'base64').toString(); mode = 'cmd'; ok() ? w('235 authenticated') : w('535 bad credentials'); continue; }
        const [verb, ...rest] = line.split(' ');
        commands.push(verb.toUpperCase());
        switch (verb.toUpperCase()) {
          case 'EHLO':
            w('250-fake.test');
            if (opts.starttls && !isTls) w('250-STARTTLS');
            if (opts.auth && (isTls || !opts.starttls)) w('250-AUTH ' + opts.auth);
            w('250 8BITMIME');
            break;
          case 'STARTTLS': {
            w('220 ready');
            sock.removeListener('data', onData);
            session(new tls.TLSSocket(sock, { isServer: true, secureContext: secureContext() }), true, false);
            return;
          }
          case 'AUTH': {
            const [mech, initial] = rest;
            if (mech.toUpperCase() === 'PLAIN') {
              const [, user, pass] = Buffer.from(initial || '', 'base64').toString().split('\0');
              Object.assign(cur, { user, pass });
              ok() ? w('235 authenticated') : w('535 bad credentials');
            } else if (mech.toUpperCase() === 'LOGIN') { mode = 'login-user'; w('334 VXNlcm5hbWU6'); }
            else w('504 unsupported');
            break;
          }
          case 'MAIL': cur.from = /<([^>]*)>/.exec(line)[1]; w('250 ok'); break;
          case 'RCPT': {
            const a = /<([^>]*)>/.exec(line)[1];
            if (opts.rejectRcpt && opts.rejectRcpt.test(a)) { w('550 no such user'); break; }
            cur.rcpt.push(a); w('250 ok'); break;
          }
          case 'DATA': mode = 'data'; w('354 go'); break;
          case 'QUIT': w('221 bye'); sock.end(); break;
          default: w('500 unknown');
        }
      }
    };
    sock.on('data', onData);
    sock.on('error', () => {});
    if (greet) w('220 fake.test ESMTP');
  }

  const server = opts.implicitTls
    ? tls.createServer({ pfx: pfx(), passphrase: 'test' }, s => session(s, true, true))
    : net.createServer(s => session(s, false, true));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port, messages, commands,
    ca: new (require('crypto').X509Certificate)(fs.readFileSync(path.join(FIXTURES, 'localhost.cer'))).toString(),
    close: () => new Promise(r => { server.close(r); server.closeAllConnections?.(); })
  };
}

module.exports = { fakeSmtp };
