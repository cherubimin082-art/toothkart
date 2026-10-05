const router = require('express').Router();
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

async function withCounts(where = '', ...args) {
  return db.prepare(
    `SELECT b.id, b.name, (SELECT COUNT(*) FROM products p WHERE p.brand = b.name) AS products
     FROM brands b ${where} ORDER BY b.id`
  ).all(...args);
}

// Anyone: the storefront builds its "Top Brands" strip from this
router.get('/', async (req, res) => res.json(await withCounts()));

router.post('/', requireAdmin, async (req, res) => {
  const name = clean(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Please enter a brand name' });
  if (await db.prepare('SELECT 1 AS x FROM brands WHERE name = ?').get(name)) return res.status(409).json({ error: `"${name}" already exists` });
  const info = await db.prepare('INSERT INTO brands (name) VALUES (?)').run(name);
  res.status(201).json((await withCounts('WHERE b.id = ?', info.lastInsertRowid))[0]);
});

// Rename: products of that brand follow the new name
router.patch('/:id', requireAdmin, async (req, res) => {
  const brand = await db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  const name = clean(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Please enter a brand name' });
  if (await db.prepare('SELECT id FROM brands WHERE name = ? AND id != ?').get(name, brand.id)) return res.status(409).json({ error: `"${name}" already exists` });

  await db.transaction(async tx => {
    await tx.prepare('UPDATE brands SET name = ? WHERE id = ?').run(name, brand.id);
    if (name !== brand.name) await tx.prepare('UPDATE products SET brand = ? WHERE brand = ?').run(name, brand.name);
  });
  res.json((await withCounts('WHERE b.id = ?', brand.id))[0]);
});

// Delete: its products are kept and simply have no brand
router.delete('/:id', requireAdmin, async (req, res) => {
  const brand = await db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  await db.transaction(async tx => {
    await tx.prepare('UPDATE products SET brand = NULL WHERE brand = ?').run(brand.name);
    await tx.prepare('DELETE FROM brands WHERE id = ?').run(brand.id);
  });
  res.status(204).end();
});

module.exports = router;
