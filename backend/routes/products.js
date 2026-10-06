const router = require('express').Router();
const multer = require('multer');
const db = require('../database');
const { requireAdmin, optionalAuth } = require('../middleware/auth');
const { saveImage, removeImage, imageUrl, EXT } = require('../storage');

// The image is held in memory first (3 MB at most), checked, then handed to storage (disk or Vercel Blob)
const MAX_IMAGES = 8;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_IMAGES },
  fileFilter: (req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG or WebP images allowed')),
});
const uploadImages = upload.array('images', MAX_IMAGES);

// The cost price is the shop's own number: it is only included for admins (admin = true), never in public responses or the cart
const withPrice = (p, admin = false) => {
  const { cost_price, ...rest } = p;
  return {
    ...rest,
    ...(admin ? { cost_price } : {}),
    image_url: imageUrl(p.image),
    final_price: Math.round(p.price * (1 - p.discount_percent / 100) * 100) / 100,
  };
};

// Adds `images: [{ id, url }]` (main picture first) to each product, using one query for the whole list
async function withImages(products) {
  if (!products.length) return products;
  const ids = products.map(p => p.id);
  const rows = await db.prepare(
    `SELECT id, product_id, image FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY position, id`
  ).all(...ids);
  const by = new Map(products.map(p => [p.id, (p.images = [])]));
  for (const r of rows) by.get(r.product_id).push({ id: r.id, url: imageUrl(r.image) });
  return products;
}
const loadOne = async (id, admin = false) => {
  const p = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  return p ? (await withImages([withPrice(p, admin)]))[0] : null;
};

// Saves every uploaded file; if one fails the ones already saved are removed again
async function saveAll(files) {
  const saved = [];
  try {
    for (const f of files || []) saved.push(await saveImage(f));
    return saved;
  } catch (err) {
    await Promise.all(saved.map(removeImage));
    throw err;
  }
}

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
    // optional: blank means "not set"
    cost_price: body.cost_price === undefined || body.cost_price === null || body.cost_price === '' ? null : Number(body.cost_price),
  };
  const bad = (out.cost_price !== null && (!Number.isFinite(out.cost_price) || out.cost_price < 0)) ||
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
router.get('/', optionalAuth, async (req, res) => {
  const admin = req.user?.role === 'admin';
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
  res.json({ total, page, limit, products: await withImages(rows.map(r => withPrice(r, admin))) });
});

router.get('/:id', optionalAuth, async (req, res) => {
  const p = await loadOne(req.params.id, req.user?.role === 'admin');
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
});

// Admin: create (multipart/form-data, optional "images" files, up to 8). Everything is checked before images are stored.
router.post('/', requireAdmin, uploadImages, async (req, res) => {
  const d = parseBody(req.body);
  if (!d) return res.status(400).json({ error: INVALID });
  d.category = d.category && await listedCategory(d.category);
  if (!d.category) return res.status(400).json({ error: INVALID_CATEGORY });
  if (d.brand) {
    d.brand = await listedBrand(d.brand);
    if (!d.brand) return res.status(400).json({ error: INVALID_BRAND });
  }
  const images = await saveAll(req.files);
  let id;
  try {
    id = await db.transaction(async tx => {
      const info = await tx.prepare(
        `INSERT INTO products (name, brand, category, description, price, discount_percent, stock, cost_price, image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(d.name, d.brand, d.category, d.description, d.price, d.discount_percent, d.stock, d.cost_price, images[0] || null);
      for (const [pos, image] of images.entries()) {
        await tx.prepare('INSERT INTO product_images (product_id, image, position) VALUES (?, ?, ?)').run(info.lastInsertRowid, image, pos);
      }
      return info.lastInsertRowid;
    });
  } catch (err) {
    await Promise.all(images.map(removeImage)); // do not leave orphan images behind
    throw err;
  }
  res.status(201).json(await loadOne(id, true));
});

// Admin: update. Missing fields keep their current value.
// New files in "images" are added to the gallery; "remove_images" (JSON list of image ids) removes some;
// "main_image" (an image id) makes that one the main picture.
router.put('/:id', requireAdmin, uploadImages, async (req, res) => {
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
  let remove = [];
  try { remove = JSON.parse(req.body.remove_images || '[]').map(Number); } catch { return res.status(400).json({ error: 'remove_images must be a list of image ids' }); }
  const existing = await db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position, id').all(cur.id);
  const gone = existing.filter(i => remove.includes(i.id));
  const kept = existing.filter(i => !remove.includes(i.id));
  if (kept.length + (req.files || []).length > MAX_IMAGES) {
    return res.status(400).json({ error: `A product can have at most ${MAX_IMAGES} images` });
  }
  const main = Number(req.body.main_image);
  const mainFirst = kept.find(i => i.id === main);
  const order = mainFirst ? [mainFirst, ...kept.filter(i => i !== mainFirst)] : kept;

  const added = await saveAll(req.files);
  try {
    await db.transaction(async tx => {
      await tx.prepare(`UPDATE products SET name=?, brand=?, category=?, description=?, price=?, discount_percent=?, stock=?, cost_price=? WHERE id=?`)
        .run(d.name, d.brand, d.category, d.description, d.price, d.discount_percent, d.stock, d.cost_price, cur.id);
      for (const i of gone) await tx.prepare('DELETE FROM product_images WHERE id = ?').run(i.id);
      for (const [pos, i] of order.entries()) await tx.prepare('UPDATE product_images SET position = ? WHERE id = ?').run(pos, i.id);
      for (const [k, image] of added.entries()) {
        await tx.prepare('INSERT INTO product_images (product_id, image, position) VALUES (?, ?, ?)').run(cur.id, image, order.length + k);
      }
      const first = order[0]?.image ?? added[0] ?? null;
      await tx.prepare('UPDATE products SET image = ? WHERE id = ?').run(first, cur.id);
    });
  } catch (err) {
    await Promise.all(added.map(removeImage));
    throw err;
  }
  await Promise.all(gone.map(i => removeImage(i.image)));
  res.json(await loadOne(cur.id, true));
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Product not found' });
  const gallery = await db.prepare('SELECT image FROM product_images WHERE product_id = ?').all(cur.id);
  await db.transaction(async tx => {
    await tx.prepare('DELETE FROM cart_items WHERE product_id = ?').run(cur.id);
    await tx.prepare('UPDATE order_items SET product_id = NULL WHERE product_id = ?').run(cur.id); // past orders keep the name and price
    await tx.prepare('DELETE FROM products WHERE id = ?').run(cur.id);
  });
  await Promise.all([...new Set([cur.image, ...gallery.map(g => g.image)])].map(removeImage));
  res.status(204).end();
});

module.exports = router;
module.exports.withPrice = withPrice;
