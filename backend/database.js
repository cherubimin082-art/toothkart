// The database. Locally it is a SQLite file; on Vercel it is Turso (a hosted SQLite). Both speak the same SQL.
// Every call is asynchronous:   const row = await db.prepare('SELECT ...').get(arg1, arg2);
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const { dbUrl, dbAuthToken } = require('./config');

const client = createClient({ url: dbUrl, authToken: dbAuthToken });

const toObject = (rs, row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]));

// Gives the same prepare().get/all/run shape on top of either the plain client or an open transaction
function wrap(execute) {
  const go = (sql, args) => execute({ sql, args });
  return {
    prepare: sql => ({
      get: async (...args) => { const rs = await go(sql, args); return rs.rows[0] ? toObject(rs, rs.rows[0]) : undefined; },
      all: async (...args) => { const rs = await go(sql, args); return rs.rows.map(r => toObject(rs, r)); },
      run: async (...args) => {
        const rs = await go(sql, args);
        return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid) };
      },
    }),
  };
}

// Runs fn inside one transaction: either everything in it happens or nothing does
async function transaction(fn) {
  const tx = await client.transaction('write');
  try {
    const out = await fn(wrap(a => tx.execute(a)));
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  } finally {
    tx.close();
  }
}

// Orders keep a copy of the customer's name and email, and user_id becomes NULL if the account is removed,
// so order history and invoices survive when an admin deletes a user.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon TEXT NOT NULL DEFAULT '🦷',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  description TEXT,
  price REAL NOT NULL CHECK (price >= 0),
  discount_percent REAL NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'shipped', 'delivered', 'cancelled')),
  reject_reason TEXT,
  payment_method TEXT NOT NULL DEFAULT 'COD' CHECK (payment_method IN ('COD', 'PREPAID')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  subtotal REAL NOT NULL,
  discount REAL NOT NULL,
  total REAL NOT NULL,
  ship_name TEXT NOT NULL,
  ship_phone TEXT NOT NULL,
  ship_address TEXT NOT NULL,
  ship_pincode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  list_price REAL NOT NULL,
  quantity INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  url TEXT,
  email TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'done')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  sends INTEGER NOT NULL DEFAULT 1
);
-- Per-visitor request counting (kept in the database because a serverless function has no shared memory)
CREATE TABLE IF NOT EXISTS rate_hits (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_hits_key ON rate_hits (key, at);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand);
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
`;

const db = { ...wrap(a => client.execute(a)), transaction };

async function seedLists() {
  // First run: start from the usual dental categories and brands, plus any name products already use
  if ((await db.prepare('SELECT COUNT(*) AS n FROM categories').get()).n === 0) {
    const starters = [['Implant Prosthetics', '🦷'], ['Airotors', '💨'], ['Composite', '🧪'], ['Intra Oral Camera', '📷'],
      ['Endomotors', '⚙️'], ['Autoclave', '♨️'], ['Rotary Files', '📏'], ['Cements', '🧱'], ['Impression Materials', '🥣'],
      ['Brackets', '😁'], ['Sutures & Needles', '🪡'], ['Spare Parts', '🔩']];
    const add = db.prepare('INSERT OR IGNORE INTO categories (name, icon) VALUES (?, ?)');
    for (const [name, icon] of starters) await add.run(name, icon);
    for (const { category } of await db.prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category) != ''").all()) await add.run(category.trim(), '🦷');
  }
  if ((await db.prepare('SELECT COUNT(*) AS n FROM brands').get()).n === 0) {
    const add = db.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)');
    for (const name of ['Waldent', 'NSK', 'Dentaltech', 'GC', 'SuperEndo', 'Dentsply', 'Prime', 'Mani']) await add.run(name);
    for (const { brand } of await db.prepare("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND TRIM(brand) != ''").all()) await add.run(brand.trim());
  }
}

// Seed the admin account once, from ADMIN_EMAIL / ADMIN_PASSWORD
async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const email = ADMIN_EMAIL.toLowerCase();
  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return;
  const info = await db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('Admin', email, bcrypt.hashSync(ADMIN_PASSWORD, 10), 'admin');
  if (info.changes) console.log(`Seeded admin user ${ADMIN_EMAIL}`);
}

// Runs once per server instance (and once per cold start on Vercel). Safe to run again and again.
let readyPromise = null;
db.ready = () => {
  if (!readyPromise) {
    readyPromise = (async () => {
      await client.executeMultiple(SCHEMA);
      await seedLists();
      await seedAdmin();
    })().catch(err => { readyPromise = null; throw err; }); // try again on the next request
  }
  return readyPromise;
};
db.close = () => client.close();

module.exports = db;
