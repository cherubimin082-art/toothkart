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
    // same rule as the Revenue tab: refunded orders are not revenue
    n(`SELECT ROUND(COALESCE(SUM(total), 0), 2) AS n FROM orders o WHERE status IN ('accepted', 'shipped', 'delivered')
       AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = o.id AND r.status = 'refunded')`),
  ]);
  const pendingReturns = await n("SELECT COUNT(*) AS n FROM returns WHERE status IN ('requested', 'approved')");
  res.json({ products, customers, blockedUsers, onOffer, lowStock, cartItems, orders, pendingOrders, pendingReturns, newSuggestions, revenue });
});

// ---------- Revenue and profit analytics ----------
// Counted orders: accepted / shipped / delivered, and not refunded after a return. Profit uses the cost recorded on
// the order line; for older lines without one it falls back to the product's current cost. Lines with no cost at all
// are left out of profit (and "profit coverage" says how much of the revenue is covered).
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sqlTime = d => d.toISOString().slice(0, 19).replace('T', ' ');
const COUNTED = `o.status IN ('accepted', 'shipped', 'delivered') AND o.created_at >= ? AND o.created_at < ?
  AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = o.id AND r.status = 'refunded')`;
const LINES = `(SELECT oi.name, oi.product_id, oi.quantity, oi.unit_price, COALESCE(oi.cost_price, p.cost_price) AS cost,
                       p.category, p.brand, o.created_at, o.id AS order_id
                FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
                WHERE ${COUNTED}) x`;
const REV = 'unit_price * quantity';
const PROFIT = 'CASE WHEN cost IS NOT NULL THEN (unit_price - cost) * quantity END';
const REV_KNOWN = 'CASE WHEN cost IS NOT NULL THEN unit_price * quantity END';

async function summary(since, until) {
  const o = await db.prepare(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(SUM(o.discount), 0) AS discounts,
            COALESCE(SUM(CASE WHEN o.payment_method = 'COD' THEN o.total END), 0) AS cod,
            COALESCE(SUM(CASE WHEN o.payment_method = 'PREPAID' THEN o.total END), 0) AS prepaid,
            COALESCE(SUM(CASE WHEN o.payment_status = 'unpaid' THEN o.total END), 0) AS unpaid
     FROM orders o WHERE ${COUNTED}`).get(since, until);
  const l = await db.prepare(
    `SELECT COALESCE(SUM(quantity), 0) AS units, COALESCE(SUM(${REV_KNOWN}), 0) AS rev_known,
            COALESCE(SUM(CASE WHEN cost IS NOT NULL THEN cost * quantity END), 0) AS cost
     FROM ${LINES}`).get(since, until);
  const revenue = round2(o.revenue), profit = round2(l.rev_known - l.cost);
  return {
    revenue, orders: o.orders, units: l.units, discounts: round2(o.discounts),
    avg_order: o.orders ? round2(revenue / o.orders) : 0,
    cost: round2(l.cost), profit,
    margin: l.rev_known ? round2((profit / l.rev_known) * 100) : null,
    coverage: revenue ? Math.min(100, round2((l.rev_known / revenue) * 100)) : null,
    cod: round2(o.cod), prepaid: round2(o.prepaid), unpaid: round2(o.unpaid),
  };
}

router.get('/analytics', async (req, res) => {
  const range = ['7', '30', '90', '365', 'all'].includes(req.query.range) ? req.query.range : '30';
  const now = new Date();
  const until = sqlTime(new Date(now.getTime() + 864e5));
  let since, prevSince = null;
  if (range === 'all') since = '1970-01-01 00:00:00';
  else {
    since = sqlTime(new Date(now.getTime() - Number(range) * 864e5));
    prevSince = sqlTime(new Date(now.getTime() - 2 * Number(range) * 864e5));
  }

  const current = await summary(since, until);
  const previous = prevSince ? await summary(prevSince, since) : null;
  const change = (a, b) => (b ? round2(((a - b) / Math.abs(b)) * 100) : null);

  // Trend: one point per day (up to 90 days) or per month
  const first = (await db.prepare('SELECT MIN(created_at) AS t FROM orders').get()).t;
  const monthly = range === 'all' || Number(range) > 90;
  const len = monthly ? 7 : 10;
  const series = await db.prepare(
    `SELECT substr(created_at, 1, ${len}) AS bucket, COALESCE(SUM(${REV}), 0) AS revenue,
            COALESCE(SUM(${PROFIT}), 0) AS profit, COUNT(DISTINCT order_id) AS orders
     FROM ${LINES} GROUP BY bucket ORDER BY bucket`).all(since, until);
  const byBucket = new Map(series.map(s => [s.bucket, s]));
  const points = [];
  const start = range === 'all' ? (first ? new Date(first.replace(' ', 'T') + 'Z') : now) : new Date(since.replace(' ', 'T') + 'Z');
  for (let d = new Date(start); ; ) {
    const key = d.toISOString().slice(0, len);
    if (!points.length || points[points.length - 1].bucket !== key) {
      const s = byBucket.get(key);
      points.push({ bucket: key, revenue: round2(s?.revenue), profit: round2(s?.profit), orders: s?.orders || 0 });
    }
    if (key >= now.toISOString().slice(0, len)) break;
    if (monthly) d.setUTCMonth(d.getUTCMonth() + 1, 1); else d.setUTCDate(d.getUTCDate() + 1);
  }

  const group = async (col, limit) => (await db.prepare(
    `SELECT ${col} AS label, COALESCE(SUM(quantity), 0) AS units, COALESCE(SUM(${REV}), 0) AS revenue,
            COALESCE(SUM(${PROFIT}), 0) AS profit, COALESCE(SUM(${REV_KNOWN}), 0) AS rev_known
     FROM ${LINES} GROUP BY label ORDER BY revenue DESC LIMIT ${limit}`).all(since, until))
    .map(r => ({ label: r.label, units: r.units, revenue: round2(r.revenue), profit: r.rev_known ? round2(r.profit) : null }));

  const statusRows = await db.prepare('SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status').all(since, until);
  const returnRows = await db.prepare(
    `SELECT r.status, COUNT(*) AS n, COALESCE(SUM(o.total), 0) AS amount FROM returns r JOIN orders o ON o.id = r.order_id
     WHERE r.created_at >= ? AND r.created_at < ? GROUP BY r.status`).all(since, until);
  const returnsTotal = returnRows.reduce((s, r) => s + r.n, 0);
  const delivered = statusRows.find(s => s.status === 'delivered')?.n || 0;

  const buyers = await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT o.user_id FROM orders o WHERE ${COUNTED} AND o.user_id IS NOT NULL GROUP BY o.user_id)`).get(since, until);
  const repeat = await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT o.user_id FROM orders o WHERE ${COUNTED} AND o.user_id IS NOT NULL GROUP BY o.user_id HAVING COUNT(*) > 1)`).get(since, until);
  const newCustomers = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND created_at >= ? AND created_at < ?").get(since, until)).n;
  const inv = await db.prepare(
    `SELECT COALESCE(SUM(stock), 0) AS units, COALESCE(SUM(stock * price * (1 - discount_percent / 100.0)), 0) AS retail,
            COALESCE(SUM(CASE WHEN cost_price IS NOT NULL THEN stock * cost_price END), 0) AS at_cost,
            SUM(CASE WHEN cost_price IS NULL THEN 1 ELSE 0 END) AS missing_cost, COUNT(*) AS products
     FROM products`).get();

  res.json({
    range, granularity: monthly ? 'month' : 'day',
    current, previous,
    changes: previous ? { revenue: change(current.revenue, previous.revenue), profit: change(current.profit, previous.profit), orders: change(current.orders, previous.orders) } : null,
    series: points,
    top_products: await group('name', 8),
    categories: await group("COALESCE(category, 'Uncategorised')", 8),
    brands: await group("COALESCE(brand, 'No brand')", 6),
    statuses: statusRows.map(s => ({ status: s.status, orders: s.n, amount: round2(s.amount) })),
    returns: {
      requests: returnsTotal, rate: delivered ? round2((returnsTotal / delivered) * 100) : null,
      refunded_orders: returnRows.find(r => r.status === 'refunded')?.n || 0,
      refunded_amount: round2(returnRows.find(r => r.status === 'refunded')?.amount),
      pending: (returnRows.find(r => r.status === 'requested')?.n || 0) + (returnRows.find(r => r.status === 'approved')?.n || 0),
    },
    customers: { buyers: buyers.n, repeat: repeat.n, new: newCustomers },
    inventory: { units: inv.units, retail_value: round2(inv.retail), cost_value: round2(inv.at_cost), missing_cost: inv.missing_cost || 0, products: inv.products },
  });
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
