const router = require('express').Router();
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { withPrice } = require('./products');

router.use(requireAuth);

async function readCart(userId) {
  const rows = await db.prepare(
    `SELECT c.quantity, p.* FROM cart_items c JOIN products p ON p.id = c.product_id
     WHERE c.user_id = ? ORDER BY c.id`
  ).all(userId);
  const items = rows.map(({ quantity, ...p }) => {
    const prod = withPrice(p);
    return { product: prod, quantity, line_total: Math.round(prod.final_price * quantity * 100) / 100 };
  });
  const sum = f => Math.round(items.reduce((s, i) => s + f(i), 0) * 100) / 100;
  const subtotal = sum(i => i.product.price * i.quantity);
  const total = sum(i => i.line_total);
  return { items, count: items.reduce((n, i) => n + i.quantity, 0), subtotal, discount: Math.round((subtotal - total) * 100) / 100, total };
}

const validQty = q => Number.isInteger(q) && q > 0 && q <= 99;

router.get('/', async (req, res) => res.json(await readCart(req.user.id)));

// Add (or increase) an item
router.post('/', async (req, res) => {
  const productId = Number(req.body?.productId);
  const qty = req.body?.quantity === undefined ? 1 : Number(req.body.quantity);
  if (!Number.isInteger(productId) || !validQty(qty)) return res.status(400).json({ error: 'productId and quantity (1-99) required' });

  const p = await db.prepare('SELECT id, stock FROM products WHERE id = ?').get(productId);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const existing = await db.prepare('SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
  const newQty = (existing?.quantity || 0) + qty;
  if (newQty > p.stock) return res.status(409).json({ error: `Only ${p.stock} in stock` });

  await db.prepare(
    `INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = excluded.quantity`
  ).run(req.user.id, productId, newQty);
  res.status(201).json(await readCart(req.user.id));
});

// Set an exact quantity
router.patch('/:productId', async (req, res) => {
  const qty = Number(req.body?.quantity);
  if (!validQty(qty)) return res.status(400).json({ error: 'quantity must be 1-99' });
  const p = await db.prepare('SELECT stock FROM products WHERE id = ?').get(req.params.productId);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (qty > p.stock) return res.status(409).json({ error: `Only ${p.stock} in stock` });
  const info = await db.prepare('UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?')
    .run(qty, req.user.id, req.params.productId);
  if (!info.changes) return res.status(404).json({ error: 'Item not in cart' });
  res.json(await readCart(req.user.id));
});

router.delete('/:productId', async (req, res) => {
  await db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
  res.json(await readCart(req.user.id));
});

router.delete('/', async (req, res) => {
  await db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  res.json(await readCart(req.user.id));
});

module.exports = router;
