const router = require('express').Router();
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

function withCounts(where = '', ...args) {
  return db.prepare(
    `SELECT b.id, b.name, (SELECT COUNT(*) FROM products p WHERE p.brand = b.name) AS products
     FROM brands b ${where} ORDER BY b.id`
  ).all(...args);
}

// Anyone: the storefront builds its "Top Brands" strip from this
router.get('/', (req, res) => res.json(withCounts()));

router.post('/', requireAdmin, (req, res) => {
  const name = clean(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Please enter a brand name' });
  if (db.prepare('SELECT 1 FROM brands WHERE name = ?').get(name)) return res.status(409).json({ error: `"${name}" already exists` });
  const info = db.prepare('INSERT INTO brands (name) VALUES (?)').run(name);
  res.status(201).json(withCounts('WHERE b.id = ?', info.lastInsertRowid)[0]);
});

// Rename: products of that brand follow the new name
router.patch('/:id', requireAdmin, (req, res) => {
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  const name = clean(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Please enter a brand name' });
  if (db.prepare('SELECT id FROM brands WHERE name = ? AND id != ?').get(name, brand.id)) return res.status(409).json({ error: `"${name}" already exists` });

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE brands SET name = ? WHERE id = ?').run(name, brand.id);
    if (name !== brand.name) db.prepare('UPDATE products SET brand = ? WHERE brand = ?').run(name, brand.name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(withCounts('WHERE b.id = ?', brand.id)[0]);
});

// Delete: its products are kept and simply have no brand
router.delete('/:id', requireAdmin, (req, res) => {
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE products SET brand = NULL WHERE brand = ?').run(brand.name);
    db.prepare('DELETE FROM brands WHERE id = ?').run(brand.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(204).end();
});

module.exports = router;
