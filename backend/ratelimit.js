// "No more than `limit` requests per `windowMs` for this key". The counts live in the database, so they hold even
// when the server is many short-lived Vercel functions that do not share memory.
const db = require('./database');

const LONGEST_WINDOW = 60 * 60 * 1000;

// Returns true when the key is over the limit. A request that is allowed is counted; one that is refused is not.
async function limited(key, limit, windowMs) {
  const now = Date.now();
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND at >= ?').get(key, now - windowMs);
  if (n >= limit) return true;
  await db.prepare('INSERT INTO rate_hits (key, at) VALUES (?, ?)').run(key, now);
  if (Math.random() < 0.05) await db.prepare('DELETE FROM rate_hits WHERE at < ?').run(now - LONGEST_WINDOW); // tidy up now and then
  return false;
}

module.exports = { limited };
