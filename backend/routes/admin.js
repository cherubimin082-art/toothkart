const router = require('express').Router();
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  const n = async sql => (await db.prepare(sql).get()).n;
  const [products, customers, blockedUsers, onOffer, lowStock, cartItems, orders, pendingOrders, newSuggestions, revenue] = await Promise.all([
    n('SELECT COUNT(*) AS n FROM products'),
    n("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'"),
    n('SELECT COUNT(*) AS n FROM users WHERE blocked = 1'),
    n('SELECT COUNT(*) AS n FROM products WHERE discount_percent > 0'),
    n('SELECT COUNT(*) AS n FROM products WHERE stock <= 5'),
    n('SELECT COALESCE(SUM(quantity), 0) AS n FROM cart_items'),
    n('SELECT COUNT(*) AS n FROM orders'),
    n("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
    n("SELECT COUNT(*) AS n FROM suggestions WHERE status = 'new'"),
    n("SELECT ROUND(COALESCE(SUM(total), 0), 2) AS n FROM orders WHERE status IN ('accepted', 'shipped', 'delivered')"),
  ]);
  res.json({ products, customers, blockedUsers, onOffer, lowStock, cartItems, orders, pendingOrders, newSuggestions, revenue });
});

router.get('/users', async (req, res) => {
  res.json(await db.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.blocked, u.created_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders
     FROM users u ORDER BY u.id DESC`
  ).all());
});

// Admin accounts can't be blocked or removed from here, which also stops an admin locking themselves out
async function customerOr(res, id) {
  const user = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return null; }
  if (user.role === 'admin') { res.status(403).json({ error: 'Admin accounts cannot be blocked or removed' }); return null; }
  return user;
}

router.patch('/users/:id/block', async (req, res) => {
  const user = await customerOr(res, req.params.id);
  if (!user) return;
  const blocked = req.body?.blocked ? 1 : 0;
  await db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, user.id);
  res.json({ id: user.id, blocked });
});

// Removes the account and their cart. Their past orders stay (with the name and email saved on each order).
router.delete('/users/:id', async (req, res) => {
  const user = await customerOr(res, req.params.id);
  if (!user) return;
  await db.transaction(async tx => {
    await tx.prepare('DELETE FROM cart_items WHERE user_id = ?').run(user.id);
    await tx.prepare('UPDATE orders SET user_id = NULL WHERE user_id = ?').run(user.id);
    await tx.prepare('UPDATE suggestions SET user_id = NULL WHERE user_id = ?').run(user.id);
    await tx.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  });
  res.status(204).end();
});

module.exports = router;
