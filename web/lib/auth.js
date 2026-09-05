// Helpers to read the current session from a Next.js route handler.
const { verify, SESSION_COOKIE } = require('./session');

// Get the session payload out of the request cookies, if valid.
function getSession(req) {
  let token = null;

  // Next.js route handlers: req.cookies is a RequestCookies object.
  if (req && req.cookies && typeof req.cookies.get === 'function') {
    const c = req.cookies.get(SESSION_COOKIE);
    if (c && c.value) token = c.value;
  }

  // Fallback: raw header parsing (plain Node req or Headers).
  if (!token && req) {
    const getHeader = (name) => {
      if (req.headers && typeof req.headers.get === 'function') return req.headers.get(name);
      return req.headers ? req.headers[name] : undefined;
    };
    const raw = getHeader('cookie') || '';
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i === -1) continue;
      if (part.slice(0, i).trim() === SESSION_COOKIE) {
        token = decodeURIComponent(part.slice(i + 1).trim());
        break;
      }
    }
  }

  return token ? verify(token) : null;
}

// Get the user row for the current signed-in session, or null.
async function getCurrentUser(req, db) {
  const session = getSession(req);
  if (!session || !session.userId) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [session.userId]);
  const user = rows.length ? rows[0] : null;
  if (!user || user.banned) return null;
  // Add username property for compatibility with instance URL generation
  if (user) {
    user.username = user.discord_username || 'unknown';
  }
  return user;
}

module.exports = { getSession, getCurrentUser };
