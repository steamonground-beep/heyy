// Worker authorization helper for the Vercel control API.
const crypto = require('crypto');
const config = require('./config');

function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Authorize a request's bearer token as a registered worker.
async function authorizeWorker(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  if (!config.controlApiSecret) return null;
  if (!constantTimeEqual(token, config.controlApiSecret)) return null;
  return { id: 'verified-worker' };
}

module.exports = {
  authorizeWorker,
  constantTimeEqual,
};