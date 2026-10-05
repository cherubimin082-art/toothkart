const router = require('express').Router();
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/stats', (req, res) => {
  const n = sql => db.prepare(sql).get().n;
  res.json({
    products: n('SELECT COUNT(*) AS n FROM products'),
    customers: n("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'"),
    blockedUsers: n('SELECT COUNT(*) AS n FROM users WHERE blocked = 1'),
    onOffer: n('SELECT COUNT(*) AS n FROM products WHERE discount_percent > 0'),
    lowStock: n('SELECT COUNT(*) AS n FROM products WHERE stock <= 5'),
    cartItems: n('SELECT COALESCE(SUM(quantity), 0) AS n FROM cart_items'),
    orders: n('SELECT COUNT(*) AS n FROM orders'),
    newSuggestions: n("SELECT COUNT(*) AS n FROM suggestions WHERE status = 'new'"),
    pendingOrders: n("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
    revenue: n("SELECT ROUND(COALESCE(SUM(total), 0), 2) AS n FROM orders WHERE status IN ('accepted', 'shipped', 'delivered')"),
  });
});

router.get('/users', (req, res) => {
  res.json(db.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.blocked, u.created_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders
     FROM users u ORDER BY u.id DESC`
  ).all());
});

// Admin accounts can't be blocked or removed from here, which also stops an admin locking themselves out
function customerOr(res, id) {
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return null; }
  if (user.role === 'admin') { res.status(403).json({ error: 'Admin accounts cannot be blocked or removed' }); return null; }
  return user;
}

router.patch('/users/:id/block', (req, res) => {
  const user = customerOr(res, req.params.id);
  if (!user) return;
  const blocked = req.body?.blocked ? 1 : 0;
  db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, user.id);
  res.json({ id: user.id, blocked });
});

// Removes the account and their cart. Their past orders stay (with the name and email saved on each order).
router.delete('/users/:id', (req, res) => {
  const user = customerOr(res, req.params.id);
  if (!user) return;
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.status(204).end();
});

module.exports = router;
