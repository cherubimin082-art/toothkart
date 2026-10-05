// Sets a new password for an admin account:   npm run reset-admin
// The password is typed at a hidden prompt, so it never appears on screen or in your command history.
// (ADMIN_PASSWORD in .env is only used the very first time the admin account is created.)
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./database');

// Answers typed at the keyboard, or lines piped in from a script
let piped = null;
function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    // Not a keyboard: read all of the input once and hand it out a line at a time
    if (piped === null) piped = fs.readFileSync(0, 'utf8').replace(/^﻿/, '').split(/\r?\n/); // some Windows shells add an invisible BOM
    if (!piped.length) { console.error('\nNo more input was given. Nothing was changed.'); process.exit(1); }
    return Promise.resolve(piped.shift());
  }

  return new Promise(resolve => {
    let value = '';
    if (hidden) stdin.setRawMode(true); // keys are read one by one and never shown
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = () => {
      stdin.off('data', onKey);
      if (hidden) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    const onKey = chunk => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return finish();
        if (c === '\u0003') { if (hidden) stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ') { value += c; if (!hidden) process.stdout.write(c); }
      }
    };
    stdin.on('data', onKey);
  });
}

(async () => {
  await db.ready();
  const admins = await db.prepare("SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY id").all();
  if (!admins.length) { console.error('There is no admin account yet. Start the server once to create it.'); process.exit(1); }

  let admin = admins[0];
  if (admins.length > 1) {
    console.log('Admin accounts:\n' + admins.map(a => `  ${a.email}`).join('\n'));
    const email = (await ask('Which one? (email): ')).trim().toLowerCase();
    admin = admins.find(a => a.email === email);
    if (!admin) { console.error('No admin with that email.'); process.exit(1); }
  }
  console.log(`Resetting the password for ${admin.email}`);

  const pw = await ask('New password (at least 10 characters): ', { hidden: true });
  if (pw.length < 10) { console.error('That is too short. Use at least 10 characters.'); process.exit(1); }
  if (process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD) { console.error('That is the same as ADMIN_PASSWORD in your .env file, which is a starting value. Choose a different one.'); process.exit(1); }
  const again = await ask('Type it again to confirm: ', { hidden: true });
  if (again !== pw) { console.error('The two passwords do not match. Nothing was changed.'); process.exit(1); }

  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, 10), admin.id);
  console.log('\nDone. The new password works the next time you sign in. Anyone already signed in stays signed in until they sign out.');
  process.exit(0);
})();
