const router = require('express').Router();
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeInvoice } = require('../invoice');

const round2 = n => Math.round(n * 100) / 100;

// What an admin may do next with an order. rejected / cancelled / delivered are final.
const NEXT = { pending: ['accepted', 'rejected'], accepted: ['shipped', 'cancelled'], shipped: ['delivered'] };
const INVOICE_STATUSES = ['accepted', 'shipped', 'delivered'];

// Adds the items (and a few derived fields) to a list of order rows using one query, however many orders there are
async function withItems(orders) {
  if (!orders.length) return orders;
  const ids = orders.map(o => o.id);
  const items = await db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
  const byId = new Map(orders.map(o => [o.id, o]));
  for (const o of orders) {
    o.invoice_no = 'TK-' + String(o.id).padStart(6, '0');
    o.account_removed = o.user_id === null;
    o.items = [];
  }
  for (const it of items) byId.get(it.order_id).items.push(it);
  const returns = await db.prepare(`SELECT * FROM returns WHERE order_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  for (const o of orders) o.return_request = null;
  for (const r of returns) byId.get(r.order_id).return_request = r;
  for (const o of orders) o.return_open_until = returnDeadline(o);
  return orders;
}

// Returns are accepted for 7 days after delivery (see the Returns page)
const RETURN_DAYS = 7;
const RETURN_REASONS = ['Wrong product received', 'Damaged product', 'Unused and sealed, no longer needed'];
const parseUtc = s => new Date(String(s).replace(' ', 'T') + 'Z');
function returnDeadline(o) {
  if (o.status !== 'delivered') return null;
  const from = parseUtc(o.delivered_at || o.created_at);
  return new Date(from.getTime() + RETURN_DAYS * 86400000).toISOString();
}

async function loadOrder(id) {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return order ? (await withItems([order]))[0] : null;
}

const restock = async (tx, order) => {
  const put = tx.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const i of order.items) if (i.product_id) await put.run(i.quantity, i.product_id);
};

// Customer: place an order from the current cart. Starts as "pending" until an admin accepts or rejects it.
router.post('/', requireAuth, async (req, res) => {
  const { name, phone, address, pincode } = req.body || {};
  const payment = req.body?.payment_method ?? 'COD';
  const clean = s => String(s ?? '').trim();
  if (!clean(name) || !clean(address)) return res.status(400).json({ error: 'name and address are required' });
  if (!/^\d{10}$/.test(clean(phone))) return res.status(400).json({ error: 'phone must be 10 digits' });
  if (!/^\d{6}$/.test(clean(pincode))) return res.status(400).json({ error: 'pincode must be 6 digits' });
  if (!['COD', 'PREPAID'].includes(payment)) return res.status(400).json({ error: 'payment_method must be COD or PREPAID' });

  const rows = await db.prepare(
    `SELECT c.quantity, p.id, p.name, p.price, p.discount_percent, p.cost_price
     FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ?`
  ).all(req.user.id);
  if (!rows.length) return res.status(400).json({ error: 'Your cart is empty' });
  const customer = await db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);

  try {
    // One transaction: either the whole order is placed or nothing changes
    const orderId = await db.transaction(async tx => {
      let subtotal = 0, total = 0;
      const lines = rows.map(r => {
        const unit = round2(r.price * (1 - r.discount_percent / 100));
        subtotal += r.price * r.quantity;
        total += unit * r.quantity;
        return { ...r, unit };
      });
      subtotal = round2(subtotal);
      total = round2(total);

      const info = await tx.prepare(
        `INSERT INTO orders (user_id, customer_name, customer_email, payment_method, subtotal, discount, total,
                             ship_name, ship_phone, ship_address, ship_pincode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(req.user.id, customer.name, customer.email, payment, subtotal, round2(subtotal - total), total,
        clean(name), clean(phone), clean(address), clean(pincode));
      const id = info.lastInsertRowid;

      const addItem = tx.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, list_price, quantity, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const takeStock = tx.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
      for (const l of lines) {
        if ((await takeStock.run(l.quantity, l.id, l.quantity)).changes === 0) {
          throw Object.assign(new Error(`"${l.name}" is no longer available in that quantity`), { status: 409 });
        }
        await addItem.run(id, l.id, l.name, l.unit, l.price, l.quantity, l.cost_price);
      }
      await tx.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
      return id;
    });
    res.status(201).json(await loadOrder(orderId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// Customer: my orders
router.get('/', requireAuth, async (req, res) => {
  res.json(await withItems(await db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id)));
});

// Admin: every order (optionally ?status=pending)
router.get('/admin/all', requireAdmin, async (req, res) => {
  const { status } = req.query;
  const rows = status
    ? await db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC').all(status)
    : await db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json(await withItems(rows));
});

// Admin: accept / reject / ship / deliver / cancel. Rejecting or cancelling returns the stock.
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
  const order = await loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!(NEXT[order.status] || []).includes(status)) {
    return res.status(409).json({ error: `A ${order.status} order cannot be changed to ${status}` });
  }
  await db.transaction(async tx => {
    await tx.prepare('UPDATE orders SET status = ?, reject_reason = ?, delivered_at = ? WHERE id = ?')
      .run(status, status === 'rejected' ? reason || null : order.reject_reason,
        status === 'delivered' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : order.delivered_at, order.id);
    if (status === 'rejected' || status === 'cancelled') await restock(tx, order);
    if (status === 'delivered' && order.payment_method === 'COD') await tx.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(order.id);
  });
  res.json(await loadOrder(order.id));
});

// Admin: mark a (prepaid) payment as received, or undo it
router.patch('/:id/payment', requireAdmin, async (req, res) => {
  const { payment_status } = req.body || {};
  if (!['paid', 'unpaid'].includes(payment_status)) return res.status(400).json({ error: 'payment_status must be paid or unpaid' });
  const order = await loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (['rejected', 'cancelled'].includes(order.status)) return res.status(409).json({ error: `A ${order.status} order has no payment to update` });
  await db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(payment_status, order.id);
  res.json(await loadOrder(order.id));
});

// Customer: cancel my own order, only while it is still waiting for the admin
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order || order.user_id !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending') return res.status(409).json({ error: 'Only orders that are still pending can be cancelled' });
  await db.transaction(async tx => {
    await tx.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    await restock(tx, order);
  });
  res.json(await loadOrder(order.id));
});

// Customer: ask to return a delivered order, within 7 days of delivery
router.post('/:id/return', requireAuth, async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order || order.user_id !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'delivered') return res.status(409).json({ error: 'Only delivered orders can be returned' });
  if (order.return_request) return res.status(409).json({ error: 'A return has already been requested for this order' });
  if (Date.now() > new Date(order.return_open_until).getTime()) {
    return res.status(409).json({ error: `The ${RETURN_DAYS}-day return window for this order has ended` });
  }
  const reason = String(req.body?.reason ?? '').trim();
  const details = String(req.body?.details ?? '').trim().slice(0, 500);
  if (!RETURN_REASONS.includes(reason)) return res.status(400).json({ error: 'Please choose a reason for the return' });
  await db.prepare('INSERT INTO returns (order_id, user_id, reason, details) VALUES (?, ?, ?, ?)')
    .run(order.id, req.user.id, reason, details || null);
  res.status(201).json(await loadOrder(order.id));
});

// Admin: approve / reject a return request, then mark it refunded
const RETURN_NEXT = { requested: ['approved', 'rejected'], approved: ['refunded'] };
router.patch('/:id/return', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  const note = String(req.body?.note ?? '').trim().slice(0, 200);
  const order = await loadOrder(req.params.id);
  if (!order || !order.return_request) return res.status(404).json({ error: 'Return request not found' });
  if (!(RETURN_NEXT[order.return_request.status] || []).includes(status)) {
    return res.status(409).json({ error: `A ${order.return_request.status} return cannot be changed to ${status}` });
  }
  await db.prepare("UPDATE returns SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, note || order.return_request.admin_note, order.return_request.id);
  res.json(await loadOrder(order.id));
});

// PDF invoice: the customer who placed the order, or an admin. Available once the order is accepted.
router.get('/:id/invoice', requireAuth, async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order || (req.user.role !== 'admin' && order.user_id !== req.user.id)) return res.status(404).json({ error: 'Order not found' });
  if (!INVOICE_STATUSES.includes(order.status)) {
    return res.status(409).json({ error: 'The invoice is available once the order has been accepted' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ToothKart-Invoice-${order.invoice_no}.pdf"`);
  writeInvoice(order, res);
});

router.get('/:id', requireAuth, async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order || (req.user.role !== 'admin' && order.user_id !== req.user.id)) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

module.exports = router;
