// Where the server keeps its files. Locally this is the backend folder. On a host with a persistent disk,
// set DATA_DIR to the disk's path (for example /var/data) so the database and uploaded images survive restarts.
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const uploadDir = path.join(dataDir, 'uploads');
const dbFile = process.env.DB_FILE || path.join(dataDir, 'toothkart.db');
const isProduction = process.env.NODE_ENV === 'production';

fs.mkdirSync(uploadDir, { recursive: true });

// A real deployment must not start in a setup that would expose customers
function checkProduction() {
  if (!isProduction) return;
  const problems = [];
  if (process.env.SHOW_OTP_IN_RESPONSE === 'true') problems.push('SHOW_OTP_IN_RESPONSE is true, which would show login codes to anyone. Set it to false.');
  if (String(process.env.JWT_SECRET || '').length < 32) problems.push('JWT_SECRET is missing or shorter than 32 characters.');
  if (problems.length) {
    console.error('Refusing to start in production:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  if ((process.env.SMS_PROVIDER || 'console') === 'console') {
    console.warn('NOTE: SMS_PROVIDER is "console", so OTP texts are not really sent. Mobile OTP sign-in will not work for customers until you set a real provider.');
  }
}

module.exports = { dataDir, uploadDir, dbFile, isProduction, checkProduction };
