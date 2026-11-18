// Runtime settings the browser needs (served as /site-config.js) and start-up checks for going live.
// Everything comes from environment variables, so the same files run as a test preview and as the live site.
const GTM_RE = /^GTM-[A-Z0-9]{4,12}$/;

const gtmId = (env = process.env) => (GTM_RE.test(String(env.GTM_ID || '').trim()) ? String(env.GTM_ID).trim() : '');

// Card payments go to a hosted page (Handepay), so only an https address is accepted.
function paymentUrl(env = process.env) {
  try {
    const u = new URL(String(env.PAYMENT_URL || '').trim());
    return u.protocol === 'https:' ? u.href : '';
  } catch (e) { return ''; }
}

const publicConfig = (env = process.env) => ({ gtm: gtmId(env), paymentUrl: paymentUrl(env) });

const configScript = (env = process.env) => `window.MPB_CONFIG=${JSON.stringify(publicConfig(env))};\n`;

const origin = v => { try { return new URL(v).origin; } catch (e) { return ''; } };

// Things that are fine on a test site but would hurt a live one. Only reported once indexing is on, i.e. when the site is meant to be public.
function goLiveWarnings(env = process.env) {
  if (!/^(1|true|yes)$/i.test(env.ALLOW_INDEXING || '')) return [];
  const out = [];
  const site = origin(env.SITE_URL || 'https://www.mypropertybox.co.uk');
  if (!gtmId(env)) out.push('GTM_ID is not set (or is not a GTM-XXXX id), so Google Tag Manager and the cookie banner are off and nothing is being measured.');
  if (!paymentUrl(env)) out.push('PAYMENT_URL is not set, so "Pay by card" still points at the old site\'s payment.php. That page disappears when the domain moves here.');
  const source = origin(env.FEED_SOURCE_URL || '') || (env.FEED_SOURCE_URL ? '' : 'https://www.mypropertybox.co.uk');
  if (env.FEED_REFRESH_MINUTES && source && source === site) {
    out.push(`The property feed refresh reads ${source}, which is this site. Set FEED_SOURCE_URL to the old site (for example https://old.mypropertybox.co.uk) or the listings will go blank.`);
  }
  return out;
}

module.exports = { gtmId, paymentUrl, publicConfig, configScript, goLiveWarnings };
