# PASSCOGH-MODOO production backend

## Upload structure

Extract this ZIP. Keep the folders exactly like this:

PASSCOGH-MODOO/
- public/index.html
- data/curriculum.json
- src/server.js
- package.json
- .env.example
- README.md

Your existing PASSCOGH-MODOO frontend should be copied to:
public/index.html

## Render

Create a Web Service connected to the GitHub repository.

Build command:
npm install

Start command:
npm start

Use Node 20+.

Create a PostgreSQL database and add its connection string as DATABASE_URL.

Add the variables in .env.example to Render's Environment settings. Do NOT commit .env.

## Paystack

Put the server-side Paystack secret key in PAYSTACK_SECRET_KEY.

Webhook:
https://YOUR-DOMAIN/api/paystack/webhook

Never put the secret key inside index.html.

## Manual MoMo

The backend records a student's transaction ID as pending.
Admin can list submissions:
GET /api/admin/payment-submissions

Admin can approve:
POST /api/admin/payment-submissions/:id/approve

Send the administrator password in the x-admin-key header. Only its bcrypt hash belongs in ADMIN_PASSWORD_HASH.

## Security

Use HTTPS, a strong random JWT_SECRET, a strong admin password, a real PostgreSQL database, and a restricted CORS_ORIGIN. Back up the database.

## Important examination-content rule

Do not call generated questions official WASSCE questions. Only call past questions or marking schemes official after their provenance and permissions have been verified.
