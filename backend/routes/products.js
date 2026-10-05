const router = require('express').Router();
const multer = require('multer');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { saveImage, removeImage, imageUrl, EXT } = require('../storage');

// The image is held in memory first (3 MB at most), checked, then handed to storage (disk or Vercel Blob)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG or WebP images allowed')),
});

const withPrice = p => ({
  ...p,
  image_url: imageUrl(p.image),
  final_price: Math.round(p.price * (1 - p.discount_percent / 100) * 100) / 100,
});

function parseBody(body) {
  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const out = {
    name: body.name?.trim(),
    brand: body.brand?.trim() || null,
    category: body.category?.trim() || null,
    description: body.description?.trim() || null,
    price: num(body.price),
    discount_percent: num(body.discount_percent, 0),
    stock: num(body.stock, 0),
  };
  const bad =
    !out.name || !Number.isFinite(out.price) || out.price < 0 ||
    !Number.isFinite(out.discount_percent) || out.discount_percent < 0 || out.discount_percent > 100 ||
    !Number.isInteger(out.stock) || out.stock < 0;
  return bad ? null : out;
}

const INVALID_BRAND = 'Choose a brand from the list (add it under Brands first if it is new)';
const INVALID_CATEGORY = 'Choose a category from the list (add it under Categories first if it is new)';
const INVALID = 'name, price (>=0), discount_percent (0-100) and stock (whole number >=0) are required';

// Return the name exactly as listed, or undefined if it is not in the list (capitals are forgiven)
const listedBrand = async name => (await db.prepare('SELECT name FROM brands WHERE name = ?').get(name))?.name;
const listedCategory = async name => (await db.prepare('SELECT name FROM categories WHERE name = ?').get(name))?.name;

// Public: list with search / filters / pagination
router.get('/', async (req, res) => {
  const { q, category, brand } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const where = [], args = [];
  if (q) { where.push('(name LIKE ? OR brand LIKE ? OR description LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (brand) { where.push('brand = ?'); args.push(brand); }
  if (req.query.onOffer === 'true') where.push('discount_percent > 0');
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [{ n: total }, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM products ${clause}`).get(...args),
    db.prepare(`SELECT * FROM products ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit),
  ]);
  res.json({ total, page, limit, products: rows.map(withPrice) });
});

router.get('/:id', async (req, res) => {
  const p = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(withPrice(p));
});

// Admin: create (multipart/form-data, optional "image" file). Everything is checked before the image is stored.
router.post('/', requireAdmin, upload.single('image'), async (req, res) => {
  const d = parseBody(req.body);
  if (!d) return res.status(400).json({ error: INVALID });
  d.category = d.category && await listedCategory(d.category);
  if (!d.category) return res.status(400).json({ error: INVALID_CATEGORY });
  if (d.brand) {
    d.brand = await listedBrand(d.brand);
    if (!d.brand) return res.status(400).json({ error: INVALID_BRAND });
  }
  const image = req.file ? await saveImage(req.file) : null;
  let info;
  try {
    info = await db.prepare(
      `INSERT INTO products (name, brand, category, description, price, discount_percent, stock, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(d.name, d.brand, d.category, d.description, d.price, d.discount_percent, d.stock, image);
  } catch (err) {
    await removeImage(image); // do not leave an orphan image behind
    throw err;
  }
  res.status(201).json(withPrice(await db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid)));
});

// Admin: update. Missing fields keep their current value; a new image replaces the old one.
router.put('/:id', requireAdmin, upload.single('image'), async (req, res) => {
  const cur = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Product not found' });
  const d = parseBody({ ...cur, ...req.body });
  if (!d) return res.status(400).json({ error: INVALID });
  if (d.category) {
    d.category = await listedCategory(d.category);
    if (!d.category) return res.status(400).json({ error: INVALID_CATEGORY });
  }
  if (d.brand) {
    d.brand = await listedBrand(d.brand);
    if (!d.brand) return res.status(400).json({ error: INVALID_BRAND });
  }
  const image = req.file ? await saveImage(req.file) : cur.image;
  try {
    await db.prepare(
      `UPDATE products SET name=?, brand=?, category=?, description=?, price=?, discount_percent=?, stock=?, image=? WHERE id=?`
    ).run(d.name, d.brand, d.category, d.description, d.price, d.discount_percent, d.stock, image, cur.id);
  } catch (err) {
    if (req.file) await removeImage(image);
    throw err;
  }
  if (req.file) await removeImage(cur.image);
  res.json(withPrice(await db.prepare('SELECT * FROM products WHERE id = ?').get(cur.id)));
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Product not found' });
  await db.transaction(async tx => {
    await tx.prepare('DELETE FROM cart_items WHERE product_id = ?').run(cur.id);
    await tx.prepare('UPDATE order_items SET product_id = NULL WHERE product_id = ?').run(cur.id); // past orders keep the name and price
    await tx.prepare('DELETE FROM products WHERE id = ?').run(cur.id);
  });
  await removeImage(cur.image);
  res.status(204).end();
});

module.exports = router;
module.exports.withPrice = withPrice;
