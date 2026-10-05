const router = require('express').Router();
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

function withCounts(where = '', ...args) {
  return db.prepare(
    `SELECT c.id, c.name, c.icon, (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS products
     FROM categories c ${where} ORDER BY c.id`
  ).all(...args);
}

// Anyone: the storefront builds its category tiles from this
router.get('/', (req, res) => res.json(withCounts()));

// Admin: add a category
router.post('/', requireAdmin, (req, res) => {
  const name = clean(req.body?.name, 60);
  const icon = clean(req.body?.icon, 8) || '🦷';
  if (!name) return res.status(400).json({ error: 'Please enter a category name' });
  if (db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name)) return res.status(409).json({ error: `"${name}" already exists` });
  const info = db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)').run(name, icon);
  res.status(201).json(withCounts('WHERE c.id = ?', info.lastInsertRowid)[0]);
});

// Admin: rename or change the icon. Products in the category follow the new name.
router.patch('/:id', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const name = req.body?.name === undefined ? cat.name : clean(req.body.name, 60);
  const icon = req.body?.icon === undefined ? cat.icon : clean(req.body.icon, 8) || cat.icon;
  if (!name) return res.status(400).json({ error: 'Please enter a category name' });
  const clash = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name, cat.id);
  if (clash) return res.status(409).json({ error: `"${name}" already exists` });

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?').run(name, icon, cat.id);
    if (name !== cat.name) db.prepare('UPDATE products SET category = ? WHERE category = ?').run(name, cat.name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(withCounts('WHERE c.id = ?', cat.id)[0]);
});

// Admin: delete. Its products are kept and simply become uncategorised.
router.delete('/:id', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE products SET category = NULL WHERE category = ?').run(cat.name);
    db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(204).end();
});

module.exports = router;
