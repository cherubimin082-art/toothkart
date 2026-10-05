const router = require('express').Router();
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeInvoice } = require('../invoice');

const round2 = n => Math.round(n * 100) / 100;

// What an admin may do next with an order. rejected / cancelled / delivered are final.
const NEXT = { pending: ['accepted', 'rejected'], accepted: ['shipped', 'cancelled'], shipped: ['delivered'] };
const INVOICE_STATUSES = ['accepted', 'shipped', 'delivered'];

function loadOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.invoice_no = 'TK-' + String(order.id).padStart(6, '0');
  order.account_removed = order.user_id === null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  return order;
}

const restock = order => {
  const put = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const i of order.items) if (i.product_id) put.run(i.quantity, i.product_id);
};

// Runs fn inside a transaction: either everything happens or nothing does
function atomically(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Customer: place an order from the current cart. Starts as "pending" until an admin accepts or rejects it.
router.post('/', requireAuth, (req, res) => {
  const { name, phone, address, pincode } = req.body || {};
  const payment = req.body?.payment_method ?? 'COD';
  const clean = s => String(s ?? '').trim();
  if (!clean(name) || !clean(address)) return res.status(400).json({ error: 'name and address are required' });
  if (!/^\d{10}$/.test(clean(phone))) return res.status(400).json({ error: 'phone must be 10 digits' });
  if (!/^\d{6}$/.test(clean(pincode))) return res.status(400).json({ error: 'pincode must be 6 digits' });
  if (!['COD', 'PREPAID'].includes(payment)) return res.status(400).json({ error: 'payment_method must be COD or PREPAID' });

  const rows = db.prepare(
    `SELECT c.quantity, p.id, p.name, p.price, p.discount_percent
     FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ?`
  ).all(req.user.id);
  if (!rows.length) return res.status(400).json({ error: 'Your cart is empty' });
  const customer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);

  try {
    const orderId = atomically(() => {
      let subtotal = 0, total = 0;
      const lines = rows.map(r => {
        const unit = round2(r.price * (1 - r.discount_percent / 100));
        subtotal += r.price * r.quantity;
        total += unit * r.quantity;
        return { ...r, unit };
      });
      subtotal = round2(subtotal);
      total = round2(total);

      const info = db.prepare(
        `INSERT INTO orders (user_id, customer_name, customer_email, payment_method, subtotal, discount, total,
                             ship_name, ship_phone, ship_address, ship_pincode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(req.user.id, customer.name, customer.email, payment, subtotal, round2(subtotal - total), total,
        clean(name), clean(phone), clean(address), clean(pincode));
      const id = Number(info.lastInsertRowid);

      const addItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, list_price, quantity) VALUES (?, ?, ?, ?, ?, ?)');
      const takeStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
      for (const l of lines) {
        if (takeStock.run(l.quantity, l.id, l.quantity).changes === 0) {
          throw Object.assign(new Error(`"${l.name}" is no longer available in that quantity`), { status: 409 });
        }
        addItem.run(id, l.id, l.name, l.unit, l.price, l.quantity);
      }
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
      return id;
    });
    res.status(201).json(loadOrder(orderId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// Customer: my orders
router.get('/', requireAuth, (req, res) => {
  const ids = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json(ids.map(o => loadOrder(o.id)));
});

// Admin: every order (optionally ?status=pending)
router.get('/admin/all', requireAdmin, (req, res) => {
  const { status } = req.query;
  const ids = status
    ? db.prepare('SELECT id FROM orders WHERE status = ? ORDER BY id DESC').all(status)
    : db.prepare('SELECT id FROM orders ORDER BY id DESC').all();
  res.json(ids.map(o => loadOrder(o.id)));
});

// Admin: accept / reject / ship / deliver / cancel. Rejecting or cancelling returns the stock.
router.patch('/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!(NEXT[order.status] || []).includes(status)) {
    return res.status(409).json({ error: `A ${order.status} order cannot be changed to ${status}` });
  }
  atomically(() => {
    db.prepare('UPDATE orders SET status = ?, reject_reason = ? WHERE id = ?')
      .run(status, status === 'rejected' ? reason || null : order.reject_reason, order.id);
    if (status === 'rejected' || status === 'cancelled') restock(order);
    if (status === 'delivered' && order.payment_method === 'COD') db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(order.id);
  });
  res.json(loadOrder(order.id));
});

// Admin: mark a (prepaid) payment as received, or undo it
router.patch('/:id/payment', requireAdmin, (req, res) => {
  const { payment_status } = req.body || {};
  if (!['paid', 'unpaid'].includes(payment_status)) return res.status(400).json({ error: 'payment_status must be paid or unpaid' });
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (['rejected', 'cancelled'].includes(order.status)) return res.status(409).json({ error: `A ${order.status} order has no payment to update` });
  db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(payment_status, order.id);
  res.json(loadOrder(order.id));
});

// Customer: cancel my own order, only while it is still waiting for the admin
router.patch('/:id/cancel', requireAuth, (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order || order.user_id !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending') return res.status(409).json({ error: 'Only orders that are still pending can be cancelled' });
  atomically(() => {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    restock(order);
  });
  res.json(loadOrder(order.id));
});

// PDF invoice: the customer who placed the order, or an admin. Available once the order is accepted.
router.get('/:id/invoice', requireAuth, (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order || (req.user.role !== 'admin' && order.user_id !== req.user.id)) return res.status(404).json({ error: 'Order not found' });
  if (!INVOICE_STATUSES.includes(order.status)) {
    return res.status(409).json({ error: 'The invoice is available once the order has been accepted' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ToothKart-Invoice-${order.invoice_no}.pdf"`);
  writeInvoice(order, res);
});

router.get('/:id', requireAuth, (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order || (req.user.role !== 'admin' && order.user_id !== req.user.id)) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

module.exports = router;
