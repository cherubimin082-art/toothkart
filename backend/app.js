// The ToothKart server as an Express app. Locally, server.js starts it; on Vercel, api/index.js runs it as a function.
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

// Check the settings first: loading the database module below opens the database straight away
config.checkProduction();
const db = require('./database');
const app = express();

// Behind Vercel (or any proxy) the real visitor address arrives in X-Forwarded-For. Without this every visitor
// would look like the proxy, and the per-address limits would hit everyone at once.
if (process.env.TRUST_PROXY) {
  const t = process.env.TRUST_PROXY;
  app.set('trust proxy', t === 'true' ? true : /^\d+$/.test(t) ? Number(t) : t);
} else if (config.isServerless) {
  app.set('trust proxy', true);
}

app.use(cors());
app.use(express.json());

// Make sure the tables exist (once per server instance) before any request is handled
app.use('/api', async (req, res, next) => { await db.ready(); next(); });

app.get('/api/health', async (req, res) => {
  await db.prepare('SELECT 1 AS ok').get();
  res.json({ ok: true });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/brands', require('./routes/brands'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/suggestions', require('./routes/suggestions'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Locally this server also serves the website (including /admin) and any locally saved images.
// On Vercel the website is served by Vercel itself and images live in Vercel Blob.
if (!config.isServerless) {
  app.use('/uploads', express.static(config.uploadDir));
  app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions: ['html'] }));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'MulterError' || /images allowed/.test(err.message)) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

module.exports = app;
