# ToothKart

An online store for dental supplies. Customers browse and order; an admin manages the catalog, orders, users and more.

## What it does

**For customers**
- Browse products by category and brand, search, see discounts
- Sign in with email and password, or with a mobile number and an OTP
- Cart, checkout (cash on delivery or prepaid), order tracking
- A personal dashboard with their orders, PDF invoices and profile
- A "Suggest a product" form (no account needed)

**For the admin** (at `/admin`)
- Catalog: products with image upload, price, discount and stock; categories; brands
- Orders: accept, reject, ship, deliver or cancel; mark prepaid payments as received; download PDF invoices
- Users: block, unblock or remove accounts
- Review product suggestions

## Tech

Plain HTML, CSS and JavaScript for the storefront (`frontend/`), and Node.js with Express and SQLite for the server (`backend/`). There is no build step and no separate database to install.

```
frontend/   storefront and customer dashboard
backend/
  server.js        starts the server
  database.js      tables and upgrades
  routes/          the API (auth, products, categories, brands, cart, orders, suggestions, admin)
  middleware/      sign-in checks
  admin/           the admin dashboard
  invoice.js       PDF invoices
  sms.js           sends OTP texts
```

## Run it

You need [Node.js](https://nodejs.org) 22.5 or newer.

```bash
cd backend
npm install
cp .env.example .env     # then edit .env (see below)
npm start
```

Open http://localhost:4000 for the store and http://localhost:4000/admin for the admin.

Optional: `npm run seed` adds a few sample products.

## Settings (`backend/.env`)

| Setting | What it is |
| --- | --- |
| `PORT` | Port to run on (default 4000) |
| `JWT_SECRET` | A long random string that signs logins. **Required.** Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Used **once**, the first time the server starts, to create the admin account |
| `SMS_PROVIDER` | `console` (prints OTP codes in the server window, for testing), `2factor` or `twilio` |
| `SHOW_OTP_IN_RESPONSE` | `true` also shows the OTP on the website. **For local testing only. Keep it `false` in real use.** |
| `TWOFACTOR_API_KEY`, `TWOFACTOR_TEMPLATE_NAME` | For `SMS_PROVIDER=2factor` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | For `SMS_PROVIDER=twilio` |

The `.env` file and the database (`backend/toothkart.db`) hold secrets and customer data. They are ignored by git and must never be committed.

## Changing the admin password

```bash
cd backend
npm run reset-admin
```

It asks for the new password with the typing hidden. Changing `ADMIN_PASSWORD` in `.env` later has no effect, because that value is only read when the admin account is first created.

## Before going live

- Set a strong admin password (`npm run reset-admin`) and a long random `JWT_SECRET`.
- Set `SHOW_OTP_IN_RESPONSE=false` and connect a real SMS provider.
- Serve the site over HTTPS.
- Back up `backend/toothkart.db` and `backend/uploads/` regularly.
- Prepaid orders are marked paid by the admin by hand. No online payment gateway is connected.
