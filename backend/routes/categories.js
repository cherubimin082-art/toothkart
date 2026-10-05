const router = require('express').Router();
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

async function withCounts(where = '', ...args) {
  return db.prepare(
    `SELECT c.id, c.name, c.icon, (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS products
     FROM categories c ${where} ORDER BY c.id`
  ).all(...args);
}

// Anyone: the storefront builds its category tiles from this
router.get('/', async (req, res) => res.json(await withCounts()));

// Admin: add a category
router.post('/', requireAdmin, async (req, res) => {
  const name = clean(req.body?.name, 60);
  const icon = clean(req.body?.icon, 8) || '🦷';
  if (!name) return res.status(400).json({ error: 'Please enter a category name' });
  if (await db.prepare('SELECT 1 AS x FROM categories WHERE name = ?').get(name)) return res.status(409).json({ error: `"${name}" already exists` });
  const info = await db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)').run(name, icon);
  res.status(201).json((await withCounts('WHERE c.id = ?', info.lastInsertRowid))[0]);
});

// Admin: rename or change the icon. Products in the category follow the new name.
router.patch('/:id', requireAdmin, async (req, res) => {
  const cat = await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const name = req.body?.name === undefined ? cat.name : clean(req.body.name, 60);
  const icon = req.body?.icon === undefined ? cat.icon : clean(req.body.icon, 8) || cat.icon;
  if (!name) return res.status(400).json({ error: 'Please enter a category name' });
  const clash = await db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name, cat.id);
  if (clash) return res.status(409).json({ error: `"${name}" already exists` });

  await db.transaction(async tx => {
    await tx.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?').run(name, icon, cat.id);
    if (name !== cat.name) await tx.prepare('UPDATE products SET category = ? WHERE category = ?').run(name, cat.name);
  });
  res.json((await withCounts('WHERE c.id = ?', cat.id))[0]);
});

// Admin: delete. Its products are kept and simply become uncategorised.
router.delete('/:id', requireAdmin, async (req, res) => {
  const cat = await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  await db.transaction(async tx => {
    await tx.prepare('UPDATE products SET category = NULL WHERE category = ?').run(cat.name);
    await tx.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
  });
  res.status(204).end();
});

module.exports = router;
