// Adds sample products if the catalog is empty:  npm run seed
// (Works on whichever database the server is configured for: the local file, or Turso if TURSO_* is set.)
const db = require('./database');

const sample = [
  ['LED Curing Light', 'Waldent', 'Composite', 4999, 30, 25],
  ['Apex Locator', 'SuperEndo', 'Endomotors', 7999, 25, 12],
  ['Nano Composite Kit', 'GC', 'Composite', 2999, 26, 40],
  ['High-Speed Airotor', 'NSK', 'Airotors', 10999, 23, 15],
  ['Rotary File Set', 'Dentsply', 'Rotary Files', 1899, 31, 60],
  ['Intra Oral Camera', 'Dentaltech', 'Intra Oral Camera', 8999, 28, 8],
  ['Impression Alginate', 'Prime', 'Impression Materials', 549, 27, 100],
  ['Suture Pack (12)', 'Mani', 'Sutures & Needles', 999, 25, 80],
  ['Tabletop Autoclave 18L', 'Waldent', 'Autoclave', 45999, 12, 4],
  ['Glass Ionomer Cement', 'GC', 'Cements', 1299, 15, 50],
  ['Ortho Bracket Kit', 'Dentaltech', 'Brackets', 2499, 20, 30],
  ['Implant Prosthetic Set', 'Dentsply', 'Implant Prosthetics', 15999, 10, 6],
];

(async () => {
  await db.ready();
  if ((await db.prepare('SELECT COUNT(*) AS n FROM products').get()).n > 0) {
    console.log('Catalog already has products, nothing to do.');
    return;
  }
  const ins = db.prepare(
    `INSERT INTO products (name, brand, category, description, price, discount_percent, stock) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [n, b, c, p, d, s] of sample) await ins.run(n, b, c, `${n} by ${b}. Sample product.`, p, d, s);
  console.log(`Added ${sample.length} sample products.`);
})()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => db.close());
