// Sends the login code by SMS. Pick the provider with SMS_PROVIDER in .env:
//   console (default)  prints the message in the server window. For local testing, nothing is really sent.
//   2factor            sends a real SMS through 2Factor.in. Needs TWOFACTOR_API_KEY; TWOFACTOR_TEMPLATE_NAME is optional.
//   twilio             sends a real SMS. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID).
// To use another provider (MSG91, Fast2SMS, ...) add a branch to sendOtp below.
const provider = (process.env.SMS_PROVIDER || 'console').toLowerCase();

async function sendOtp(phone, code) {
  const text = `${code} is your ToothKart verification code. It is valid for 5 minutes. Do not share it with anyone.`;

  if (provider === 'console') {
    console.log(`\n[SMS to +91${phone}] ${text}\n`);
    return;
  }

  if (provider === '2factor') {
    const key = process.env.TWOFACTOR_API_KEY;
    if (!key) throw new Error('SMS_PROVIDER=2factor but TWOFACTOR_API_KEY is not set in .env');
    const template = process.env.TWOFACTOR_TEMPLATE_NAME;
    const base = process.env.TWOFACTOR_BASE_URL || 'https://2factor.in';
    // The key is part of the URL, so the URL is never logged or put in an error message
    const url = `${base}/API/V1/${encodeURIComponent(key)}/SMS/+91${phone}/${code}${template ? '/' + encodeURIComponent(template) : ''}`;
    let res, body;
    try {
      res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10000) });
      body = await res.json().catch(() => ({}));
    } catch (err) {
      throw new Error(`2Factor could not be reached (${err.name})`);
    }
    if (!res.ok || body.Status !== 'Success') throw new Error(`2Factor did not accept the message (HTTP ${res.status}): ${String(body.Details ?? 'no details').slice(0, 200)}`);
    return;
  }

  if (provider === 'twilio') {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: auth, TWILIO_FROM: from, TWILIO_MESSAGING_SERVICE_SID: service } = process.env;
    if (!sid || !auth || !(from || service)) throw new Error('Twilio is selected but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are not all set');
    const body = new URLSearchParams({ To: `+91${phone}`, Body: text });
    if (service) body.set('MessagingServiceSid', service); else body.set('From', from);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Twilio rejected the message (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return;
  }

  throw new Error(`Unknown SMS_PROVIDER "${provider}"`);
}

module.exports = { sendOtp, provider };
