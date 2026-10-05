const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + TYPES[file.mimetype]),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    TYPES[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG or WebP images allowed')),
});

const withPrice = p => ({
  ...p,
  image_url: p.image ? `/uploads/${p.image}` : null,
  final_price: Math.round(p.price * (1 - p.discount_percent / 100) * 100) / 100,
});

const removeImage = name => name && fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});

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

// Public: list with search / filters / pagination
router.get('/', (req, res) => {
  const { q, category, brand } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const where = [], args = [];
  if (q) { where.push('(name LIKE ? OR brand LIKE ? OR description LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (brand) { where.push('brand = ?'); args.push(brand); }
  if (req.query.onOffer === 'true') where.push('discount_percent > 0');
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM products ${clause}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM products ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, (page - 1) * limit);
  res.json({ total, page, limit, products: rows.map(withPrice) });
});

router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(withPrice(p));
});

// Admin: create (multipart/form-data, optional "image" file)
// Returns the category exactly as listed, or undefined if it is not in the list
const listedBrand = name => db.prepare('SELECT name FROM brands WHERE name = ?').get(name)?.name;
const listedCategory = name => db.prepare('SELECT name FROM categories WHERE name = ?').get(name)?.name;

router.post('/', requireAdmin, upload.single('image'), (req, res) => {
  const d = parseBody(req.body);
  if (!d) { removeImage(req.file?.filename); return res.status(400).json({ error: INVALID }); }
  d.category = d.category && listedCategory(d.category);
  if (!d.category) { removeImage(req.file?.filename); return res.status(400).json({ error: INVALID_CATEGORY }); }
  if (d.brand) {
    d.brand = listedBrand(d.brand);
    if (!d.brand) { removeImage(req.file?.filename); return res.status(400).json({ error: INVALID_BRAND }); }
  }
  const info = db.prepare(
    `INSERT INTO products (name, brand, category, description, price, discount_percent, stock, image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(d.name, d.brand, d.category, d.description, d.price, d.discount_percent, d.stock, req.file?.filename ?? null);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(withPrice(p));
});

// Admin: update. Missing fields keep their current value; a new image replaces the old one.
router.put('/:id', requireAdmin, upload.single('image'), (req, res) => {
  const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!cur) { removeImage(req.file?.filename); return res.status(404).json({ error: 'Product not found' }); }
  const d = parseBody({ ...cur, ...req.body });
  if (!d) { removeImage(req.file?.filename); return res.status(400).json({ error: INVALID }); }
  if (d.category) {
    d.category = listedCategory(d.category);
    if (!d.category) { removeImage(req.file?.filename); return res.status(400).json({ error: INVALID_CATEGORY }); }
  }
  if (d.brand) {
    d.brand = listedBrand(d.brand);
    if (!d.brand) { removeImage(req.file?.filename); return res.status(400).json({ error: INVALID_BRAND }); }
  }
  const image = req.file ? req.file.filename : cur.image;
  db.prepare(
    `UPDATE products SET name=?, brand=?, category=?, description=?, price=?, discount_percent=?, stock=?, image=? WHERE id=?`
  ).run(d.name, d.brand, d.category, d.description, d.price, d.discount_percent, d.stock, image, cur.id);
  if (req.file) removeImage(cur.image);
  res.json(withPrice(db.prepare('SELECT * FROM products WHERE id = ?').get(cur.id)));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(cur.id);
  removeImage(cur.image);
  res.status(204).end();
});

module.exports = router;
module.exports.withPrice = withPrice;
