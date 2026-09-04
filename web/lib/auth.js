// Helpers to read the current session from a Next.js route handler.
const { verify, SESSION_COOKIE } = require('./session');

// Get the session payload out of the request cookies, if valid.
function getSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const i = c.indexOf('=');
      const k = c.slice(0, i).trim();
      const v = c.slice(i + 1).trim();
      return [k, decodeURIComponent(v)];
    })
  );
  const token = cookies[SESSION_COOKIE];
  return token ? verify(token) : null;
}

// Get the user row for the current signed-in session, or null.
async function getCurrentUser(req, db) {
  const session = getSession(req);
  if (!session || !session.userId) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [session.userId]);
  return rows.length ? rows[0] : null;
}

module.exports = { getSession, getCurrentUser };
