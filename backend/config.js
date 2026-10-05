// Settings that depend on where the server runs.
//   Locally: the database is a file in the backend folder and product images go in backend/uploads.
//   On Vercel: the database is Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) and images go to Vercel Blob
//              (BLOB_READ_WRITE_TOKEN), because a Vercel function has no disk that keeps files.
const path = require('path');

const isServerless = !!process.env.VERCEL;
const isProduction = process.env.NODE_ENV === 'production' || isServerless;

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const uploadDir = path.join(dataDir, 'uploads');
const dbFile = process.env.DB_FILE || path.join(dataDir, 'toothkart.db');

// A hosted database wins if one is configured; otherwise use the local file
const dbUrl = process.env.TURSO_DATABASE_URL || 'file:' + dbFile.replace(/\\/g, '/');
const dbAuthToken = process.env.TURSO_AUTH_TOKEN || undefined;
const usesBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// A real deployment must not start in a setup that would expose customers or lose their data
function checkProduction() {
  if (!isProduction) return;
  const problems = [];
  if (process.env.SHOW_OTP_IN_RESPONSE === 'true') problems.push('SHOW_OTP_IN_RESPONSE is true, which would show login codes to anyone. Set it to false.');
  if (String(process.env.JWT_SECRET || '').length < 32) problems.push('JWT_SECRET is missing or shorter than 32 characters.');
  if (isServerless && !process.env.TURSO_DATABASE_URL) problems.push('TURSO_DATABASE_URL is not set. A Vercel function cannot keep a database file, so data would be lost.');
  if (isServerless && !usesBlob) problems.push('BLOB_READ_WRITE_TOKEN is not set, so product images could not be saved.');
  if (problems.length) {
    const msg = 'Refusing to start in production:\n - ' + problems.join('\n - ');
    if (isServerless) throw new Error(msg); // a function cannot exit(); the error shows in the logs instead
    console.error(msg);
    process.exit(1);
  }
  if ((process.env.SMS_PROVIDER || 'console') === 'console') {
    console.warn('NOTE: SMS_PROVIDER is "console", so OTP texts are not really sent. Mobile OTP sign-in is switched off for customers until you set a real provider.');
  }
}

module.exports = { isServerless, isProduction, dataDir, uploadDir, dbFile, dbUrl, dbAuthToken, usesBlob, checkProduction };
