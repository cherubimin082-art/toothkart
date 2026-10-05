const router = require('express').Router();
const db = require('../database');
const { requireAdmin, optionalAuth } = require('../middleware/auth');

// This endpoint is public, so cap how often one address can post (5 per hour) to stop it being used for spam
const hits = new Map();
const WINDOW = 60 * 60 * 1000, LIMIT = 5;
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (recent.length >= LIMIT) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}
setInterval(() => { for (const [ip, ts] of hits) if (ts.every(t => Date.now() - t >= WINDOW)) hits.delete(ip); }, WINDOW).unref();

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

// Anyone: suggest a product
router.post('/', optionalAuth, (req, res) => {
  const name = clean(req.body?.product_name, 150);
  const brand = clean(req.body?.brand, 100);
  const url = clean(req.body?.url, 500);
  const email = clean(req.body?.email, 150);
  const comment = clean(req.body?.comment, 1000);

  if (!name) return res.status(400).json({ error: 'Please enter the product name' });
  if (url && !/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'The link must start with http:// or https://' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'That email address does not look right' });
  if (tooMany(req.ip)) return res.status(429).json({ error: 'You have sent several suggestions already. Please try again later.' });

  db.prepare('INSERT INTO suggestions (user_id, product_name, brand, url, email, comment) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user?.id ?? null, name, brand || null, url || null, email || null, comment || null);
  res.status(201).json({ ok: true });
});

// Admin: review them
router.get('/', requireAdmin, (req, res) => {
  res.json(db.prepare(
    `SELECT s.*, u.name AS user_name FROM suggestions s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC`
  ).all());
});

router.patch('/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['new', 'reviewed', 'done'].includes(status)) return res.status(400).json({ error: 'status must be new, reviewed or done' });
  const info = db.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Suggestion not found' });
  res.json({ id: Number(req.params.id), status });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM suggestions WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Suggestion not found' });
  res.status(204).end();
});

module.exports = router;
