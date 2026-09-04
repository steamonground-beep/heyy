// Simple signed session cookie (HMAC) so we don't need a JWT dependency.
const crypto = require('crypto');
const config = require('shared/config');

function secret() {
  const s = process.env.SESSION_SECRET || config.controlApiSecret;
  if (!s) throw new Error('SESSION_SECRET or CONTROL_API_SECRET is not set');
  return s;
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret())
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto
    .createHmac('sha256', secret())
    .update(data)
    .digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const SESSION_COOKIE = 'snakes_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

module.exports = { sign, verify, SESSION_COOKIE, MAX_AGE };
