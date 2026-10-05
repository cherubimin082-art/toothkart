const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

config.checkProduction();
const app = express();

// Behind Vercel / Render the real visitor address arrives in X-Forwarded-For. Set TRUST_PROXY=true (or a hop count)
// there, otherwise every visitor looks like the proxy and the per-address limits would hit everyone at once.
if (process.env.TRUST_PROXY) {
  const t = process.env.TRUST_PROXY;
  app.set('trust proxy', t === 'true' ? true : /^\d+$/.test(t) ? Number(t) : t);
}

app.use(cors());
app.use(express.json());

// For the host's health check
app.get('/api/health', (req, res) => {
  require('./database').prepare('SELECT 1').get();
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

app.use('/uploads', express.static(config.uploadDir));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
// The storefront lives in ../frontend; the backend folder itself (.env, database) is never served
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'MulterError' || /images allowed/.test(err.message)) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`ToothKart running at http://localhost:${port}`));
