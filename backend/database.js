const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'toothkart.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Orders keep a copy of the customer's name and email, and user_id becomes NULL if the account is removed,
// so order history and invoices survive when an admin deletes a user.
const ordersTable = name => `
CREATE TABLE IF NOT EXISTS ${name} (
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
);`;

db.exec(`
-- A customer signs in with email + password, or with a mobile number + OTP (then email is empty)
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
-- The list of categories an admin can choose from when adding a product. Products store the category name.
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon TEXT NOT NULL DEFAULT '🦷',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The list of brands an admin can choose from when adding a product. Products store the brand name.
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
${ordersTable('orders')}
-- Product requests from the storefront's "Suggest a product" form (visitors don't need an account)
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
-- One pending login code per phone number. Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  sends INTEGER NOT NULL DEFAULT 1
);
-- Prices and names are copied at purchase time so old orders stay correct if a product changes or is deleted
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  list_price REAL NOT NULL,
  quantity INTEGER NOT NULL
);
`);

// ---- Migrations for databases created by earlier versions ----
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'blocked')) {
  db.exec('ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
}

// SQLite cannot make a column optional in place, so an older users table is rebuilt (rows are copied as they are)
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'phone')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`INSERT INTO users_new (id, name, email, password_hash, role, blocked, created_at)
             SELECT id, name, email, password_hash, role, blocked, created_at FROM users`);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  console.log('Upgraded the users table (added mobile number sign-in).');
}

// SQLite cannot change a CHECK constraint in place, so an old orders table is rebuilt (old "placed" becomes "pending")
const ordersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get()?.sql || '';
if (!ordersSql.includes("'pending'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(ordersTable('orders_new'));
    db.exec(`
      INSERT INTO orders_new (id, user_id, customer_name, customer_email, status, payment_method, payment_status,
                              subtotal, discount, total, ship_name, ship_phone, ship_address, ship_pincode, created_at)
      SELECT o.id, o.user_id, u.name, u.email,
             CASE o.status WHEN 'placed' THEN 'pending' ELSE o.status END,
             'COD',
             CASE WHEN o.status = 'delivered' THEN 'paid' ELSE 'unpaid' END,
             o.subtotal, o.discount, o.total, o.ship_name, o.ship_phone, o.ship_address, o.ship_pincode, o.created_at
      FROM orders o LEFT JOIN users u ON u.id = o.user_id`);
    db.exec('DROP TABLE orders');
    db.exec('ALTER TABLE orders_new RENAME TO orders');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  console.log('Upgraded the orders table (placed -> pending).');
}

// First run with categories: start from the usual dental categories, plus any name products already use
if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
  const starters = [['Implant Prosthetics', '🦷'], ['Airotors', '💨'], ['Composite', '🧪'], ['Intra Oral Camera', '📷'],
    ['Endomotors', '⚙️'], ['Autoclave', '♨️'], ['Rotary Files', '📏'], ['Cements', '🧱'], ['Impression Materials', '🥣'],
    ['Brackets', '😁'], ['Sutures & Needles', '🪡'], ['Spare Parts', '🔩']];
  const add = db.prepare('INSERT OR IGNORE INTO categories (name, icon) VALUES (?, ?)');
  for (const [name, icon] of starters) add.run(name, icon);
  for (const { category } of db.prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category) != ''").all()) add.run(category.trim(), '🦷');
}

// First run with brands: start from the usual dental brands, plus any name products already use
if (db.prepare('SELECT COUNT(*) AS n FROM brands').get().n === 0) {
  const add = db.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)');
  for (const name of ['Waldent', 'NSK', 'Dentaltech', 'GC', 'SuperEndo', 'Dentsply', 'Prime', 'Mani']) add.run(name);
  for (const { brand } of db.prepare("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND TRIM(brand) != ''").all()) add.run(brand.trim());
}

// Seed the admin account once, from .env
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL.toLowerCase());
  if (!exists) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('Admin', ADMIN_EMAIL.toLowerCase(), bcrypt.hashSync(ADMIN_PASSWORD, 10), 'admin');
    console.log(`Seeded admin user ${ADMIN_EMAIL}`);
  }
}

module.exports = db;
