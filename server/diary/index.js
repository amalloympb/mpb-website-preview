'use strict';
// Chooses the diary adapter for a property. The feed's `source` (jupix, veco, mri) says which CRM holds it.
// Adapters that are not configured return null and the site falls back to the normal enquiry form.
const mock = require('./mock');
const veco = require('./veco');

const demo = () => (process.env.DIARY_MODE || '').toLowerCase() === 'demo';

function adapterFor(property) {
  if (demo()) return mock;
  if (property.source === 'veco' && veco.configured()) return veco;
  return null; // jupix and mri: not connected yet
}

module.exports = { adapterFor, isDemo: demo };
