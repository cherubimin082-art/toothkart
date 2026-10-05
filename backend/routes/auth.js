const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const sms = require('../sms');
const { sign, requireAuth } = require('../middleware/auth');

const publicUser = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, created_at: u.created_at });

router.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const mail = email.toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name.trim(), mail, bcrypt.hashSync(password, 10));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email && db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  if (user.blocked) return res.status(403).json({ error: 'Your account has been blocked. Please contact support.' });
  res.json({ token: sign(user), user: publicUser(user) });
});

// ---------- Mobile number + OTP ----------
const OTP_TTL = 5 * 60 * 1000;       // a code works for 5 minutes
const RESEND_AFTER = 30 * 1000;      // wait 30 seconds between texts to the same number
const HOUR = 60 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;        // per phone number
const MAX_WRONG_TRIES = 5;           // then the code is thrown away
const MAX_SENDS_PER_IP = 10;         // per address per hour
const SHOW_OTP = process.env.SHOW_OTP_IN_RESPONSE === 'true';
if (SHOW_OTP) console.warn('WARNING: SHOW_OTP_IN_RESPONSE=true, so login codes are returned to the browser. Use this only for local testing and turn it off before going live.');

// Accepts 9876543210, +91 98765 43210, 919876543210 or 09876543210. Returns the 10 digits, or null.
function normalizePhone(input) {
  let p = String(input ?? '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+91')) p = p.slice(3);
  else if (p.length === 12 && p.startsWith('91')) p = p.slice(2);
  else if (p.length === 11 && p.startsWith('0')) p = p.slice(1);
  return /^[6-9]\d{9}$/.test(p) ? p : null;
}

const hashCode = (phone, code) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${phone}:${code}`).digest('hex');

const ipHits = new Map();
function ipLimited(ip) {
  const now = Date.now();
  const recent = (ipHits.get(ip) || []).filter(t => now - t < HOUR);
  const limited = recent.length >= MAX_SENDS_PER_IP;
  if (!limited) recent.push(now);
  ipHits.set(ip, recent);
  return limited;
}
setInterval(() => { for (const [ip, ts] of ipHits) if (ts.every(t => Date.now() - t >= HOUR)) ipHits.delete(ip); }, HOUR).unref();

router.post('/otp/send', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  if (ipLimited(req.ip)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  const now = Date.now();
  const row = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone);
  if (row && now - row.last_sent < RESEND_AFTER) {
    const wait = Math.ceil((RESEND_AFTER - (now - row.last_sent)) / 1000);
    return res.status(429).json({ error: `Please wait ${wait} seconds before asking for another code`, retry_in: wait });
  }
  let windowStart = row?.window_start ?? now, sends = row?.sends ?? 0;
  if (now - windowStart > HOUR) { windowStart = now; sends = 0; }
  if (sends >= MAX_SENDS_PER_HOUR) return res.status(429).json({ error: 'Too many codes requested for this number. Please try again in an hour.' });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, last_sent, window_start, sends)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT (phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       last_sent = excluded.last_sent, window_start = excluded.window_start, sends = excluded.sends`
  ).run(phone, hashCode(phone, code), now + OTP_TTL, now, windowStart, sends + 1);

  try {
    await sms.sendOtp(phone, code);
  } catch (err) {
    console.error('SMS failed:', err.message);
    db.prepare('UPDATE otp_codes SET expires_at = 0, last_sent = 0 WHERE phone = ?').run(phone); // let them retry straight away
    return res.status(502).json({ error: 'We could not send the SMS. Please try again in a moment.' });
  }
  res.json({ ok: true, expires_in: OTP_TTL / 1000, resend_in: RESEND_AFTER / 1000, ...(SHOW_OTP ? { dev_code: code } : {}) });
});

router.post('/otp/verify', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code ?? '').trim();
  if (!phone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code we sent you' });

  const row = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone);
  if (!row || row.expires_at < Date.now()) return res.status(400).json({ error: 'That code has expired. Please request a new one.' });
  if (row.attempts >= MAX_WRONG_TRIES) return res.status(429).json({ error: 'Too many wrong attempts. Please request a new code.' });

  const expected = Buffer.from(row.code_hash, 'hex'), given = Buffer.from(hashCode(phone, code), 'hex');
  if (!crypto.timingSafeEqual(expected, given)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    const left = MAX_WRONG_TRIES - row.attempts - 1;
    return res.status(400).json({ error: left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong attempts. Please request a new code.' });
  }

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (user?.blocked) return res.status(403).json({ error: 'Your account has been blocked. Please contact support.' });
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone); // a code works once

  const created = !user;
  if (!user) {
    // First time with this number: create the account. It has no password, so only the OTP can open it.
    const name = String(req.body?.name ?? '').trim().slice(0, 80) || 'Customer';
    const info = db.prepare('INSERT INTO users (name, phone, password_hash) VALUES (?, ?, ?)')
      .run(name, phone, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10));
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }
  res.json({ token: sign(user), user: publicUser(user), created });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

router.post('/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.email) return res.status(400).json({ error: 'This account signs in with a mobile OTP and has no password' });
  if (!bcrypt.compareSync(String(current || ''), user.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), user.id);
  res.json({ ok: true });
});

module.exports = router;
