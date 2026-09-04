// Shared auth/limits logic used by the web control API and the worker.
const crypto = require('crypto');
const config = require('./config');

function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Authorize a request's bearer token as a registered worker.
// Returns the worker row or null.
async function authorizeWorker(authHeader, db) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  if (!config.controlApiSecret) return null;
  if (!constantTimeEqual(token, config.controlApiSecret)) return null;
  return { id: 'verified-worker' };
}

// Decide the tier for a user by discounting their Discord role.
// paidRole param is read from the role cache when available.
module.exports = {
  authorizeWorker,
  constantTimeEqual,
};
