const jwt = require('jsonwebtoken');
const db = require('../database');

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is not set (see .env.example)');

const sign = user => jwt.sign({ id: user.id, role: user.role }, secret, { expiresIn: '7d' });

// The token only proves who someone is. Role, blocked and removed status are re-checked in the database on
// every request, so blocking or deleting a user locks them out immediately instead of when their token expires.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = await db.prepare('SELECT id, role, blocked FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  if (user.blocked) return res.status(403).json({ error: 'Account blocked' });
  req.user = { id: user.id, role: user.role };
  next();
}

// For public endpoints that behave slightly differently for signed-in users. Never rejects the request.
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), secret);
      const user = await db.prepare('SELECT id, role, blocked FROM users WHERE id = ?').get(payload.id);
      if (user && !user.blocked) req.user = { id: user.id, role: user.role };
    } catch { /* treated as signed out */ }
  }
  next();
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

module.exports = { sign, requireAuth, requireAdmin, optionalAuth };
