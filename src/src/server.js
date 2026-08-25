require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

if (!DATABASE_URL) console.warn("DATABASE_URL is not configured.");
if (!JWT_SECRET) console.warn("JWT_SECRET is not configured.");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && !/localhost|127\.0\.0\.1/.test(DATABASE_URL)
    ? { rejectUnauthorized: false } : false
});

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
    : true,
  credentials: true
}));
app.use(express.json({
  limit: "1mb",
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

const curriculumPath = path.join(__dirname, "..", "data", "curriculum.json");
const curriculum = fs.existsSync(curriculumPath)
  ? JSON.parse(fs.readFileSync(curriculumPath, "utf8"))
  : { courses: [] };

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      subject TEXT NOT NULL,
      product_code TEXT NOT NULL,
      amount_pesewas INTEGER NOT NULL,
      reference TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL DEFAULT 'manual',
      provider_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unlocked_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS entitlements_user_idx
      ON entitlements(user_id);

    CREATE TABLE IF NOT EXISTS payment_submissions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      subject TEXT NOT NULL,
      amount_pesewas INTEGER NOT NULL,
      transaction_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS payment_submissions_status_idx
      ON payment_submissions(status);
  `);
}

function normalizeLevel(level) {
  const v = String(level || "").toLowerCase();
  if (["shs", "secondary"].includes(v)) return "shs";
  if (["university", "college", "uni"].includes(v)) return "university";
  if (["jhs", "junior"].includes(v)) return "jhs";
  return null;
}

function priceFor(level) {
  if (level === "shs") return 100;        // GH¢1.00
  if (level === "university") return 500; // GH¢5.00
  return 100;
}

function productCode(level, subject) {
  return `${level}:${String(subject).trim().toLowerCase()}`;
}

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session." });
  }
}

function admin(req, res, next) {
  if (!ADMIN_PASSWORD_HASH)
    return res.status(503).json({ error: "Admin credentials are not configured." });

  const key = String(req.headers["x-admin-key"] || "");
  bcrypt.compare(key, ADMIN_PASSWORD_HASH)
    .then(ok => ok ? next() : res.status(403).json({ error: "Forbidden." }))
    .catch(() => res.status(500).json({ error: "Admin authentication failed." }));
}

async function hasAccess(userId, level, subject) {
  const r = await query(
    `SELECT 1 FROM entitlements
     WHERE user_id=$1 AND product_code=$2 AND status='paid'
     LIMIT 1`,
    [userId, productCode(level, subject)]
  );
  return r.rowCount > 0;
}

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, service: "PASSCOGH-MODOO", database: "connected" });
  } catch {
    res.status(503).json({ ok: false, service: "PASSCOGH-MODOO", database: "unavailable" });
  }
});

app.get("/api/curriculum", (req, res) => res.json(curriculum));

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 8)
    return res.status(400).json({ error: "Name, email and an 8+ character password are required." });

  try {
    const hash = await bcrypt.hash(String(password), 12);
    const r = await query(
      `INSERT INTO users(name,email,password_hash)
       VALUES($1,lower($2),$3)
       RETURNING id,name,email,role`,
      [String(name).trim(), String(email).trim(), hash]
    );
    const user = r.rows[0];
    res.status(201).json({ user, token: signToken(user) });
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ error: "An account with that email already exists." });
    console.error(e);
    res.status(500).json({ error: "Unable to create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required." });

  const r = await query(
    `SELECT * FROM users WHERE email=lower($1) LIMIT 1`,
    [String(email).trim()]
  );
  if (!r.rowCount) return res.status(401).json({ error: "Invalid email or password." });

  const user = r.rows[0];
  if (!(await bcrypt.compare(String(password), user.password_hash)))
    return res.status(401).json({ error: "Invalid email or password." });

  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token: signToken(user)
  });
});

app.get("/api/me", auth, async (req, res) => {
  const r = await query(
    `SELECT id,name,email,role,created_at FROM users WHERE id=$1`,
    [req.user.sub]
  );
  if (!r.rowCount) return res.status(404).json({ error: "User not found." });
  res.json(r.rows[0]);
});

app.get("/api/access/check", auth, async (req, res) => {
  const level = normalizeLevel(req.query.level);
  const subject = req.query.subject;
  if (!level || !subject)
    return res.status(400).json({ error: "Level and subject are required." });

  res.json({
    access: await hasAccess(req.user.sub, level, subject),
    firstTopicFree: true
  });
});

app.post("/api/payments/manual-momo", auth, async (req, res) => {
  const level = normalizeLevel(req.body?.level);
  const subject = String(req.body?.subject || "").trim();
  const transactionId = String(req.body?.transactionId || "").trim();

  if (!level || !subject || !transactionId)
    return res.status(400).json({ error: "Level, subject and transaction ID are required." });

  if (!/^[A-Za-z0-9_-]{6,80}$/.test(transactionId))
    return res.status(400).json({ error: "Invalid transaction ID format." });

  const dup = await query(
    `SELECT 1 FROM payment_submissions WHERE transaction_id=$1 LIMIT 1`,
    [transactionId]
  );
  if (dup.rowCount)
    return res.status(409).json({ error: "That transaction ID was already submitted." });

  await query(
    `INSERT INTO payment_submissions
      (user_id,level,subject,amount_pesewas,transaction_id)
     VALUES($1,$2,$3,$4,$5)`,
    [req.user.sub, level, subject, priceFor(level), transactionId]
  );

  res.status(201).json({
    status: "pending",
    message: "Payment submitted for verification."
  });
});

app.post("/api/payments/paystack/initialize", auth, async (req, res) => {
  if (!PAYSTACK_SECRET_KEY)
    return res.status(503).json({ error: "Paystack is not configured." });

  const level = normalizeLevel(req.body?.level);
  const subject = String(req.body?.subject || "").trim();
  if (!level || !subject)
    return res.status(400).json({ error: "Level and subject are required." });

  const amount = priceFor(level);
  const userR = await query(`SELECT email FROM users WHERE id=$1`, [req.user.sub]);
  const reference = `PSG-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  await query(
    `INSERT INTO entitlements
      (user_id,level,subject,product_code,amount_pesewas,reference,status,provider)
     VALUES($1,$2,$3,$4,$5,$6,'pending','paystack')`,
    [req.user.sub, level, subject, productCode(level, subject), amount, reference]
  );

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: userR.rows[0].email,
      amount,
      reference,
      callback_url: `${APP_URL}/payment/callback`,
      metadata: { user_id: String(req.user.sub), level, subject }
    })
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    await query(`UPDATE entitlements SET status='failed' WHERE reference=$1`, [reference]);
    return res.status(502).json({ error: "Unable to initialize payment." });
  }

  res.json({ authorization_url: data.data.authorization_url, reference });
});

app.get("/api/payments/paystack/verify/:reference", auth, async (req, res) => {
  if (!PAYSTACK_SECRET_KEY)
    return res.status(503).json({ error: "Paystack is not configured." });

  const reference = String(req.params.reference);
  const own = await query(
    `SELECT * FROM entitlements WHERE reference=$1 AND user_id=$2 LIMIT 1`,
    [reference, req.user.sub]
  );
  if (!own.rowCount)
    return res.status(404).json({ error: "Payment reference not found." });

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
  );
  const data = await response.json();

  if (!response.ok || !data.status)
    return res.status(502).json({ error: "Unable to verify payment." });

  const paid =
    data.data.status === "success" &&
    Number(data.data.amount) === Number(own.rows[0].amount_pesewas);

  if (paid) {
    await query(
      `UPDATE entitlements
       SET status='paid',provider_id=$1,unlocked_at=NOW()
       WHERE reference=$2 AND user_id=$3`,
      [String(data.data.id), reference, req.user.sub]
    );
  }

  res.json({ paid, status: data.data.status, reference });
});

app.post("/api/paystack/webhook", async (req, res) => {
  if (!PAYSTACK_SECRET_KEY) return res.sendStatus(503);

  const signature = String(req.headers["x-paystack-signature"] || "");
  const expected = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(req.rawBody || Buffer.from(""))
    .digest("hex");

  if (!signature || signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.sendStatus(401);
  }

  if (req.body?.event === "charge.success") {
    const d = req.body.data;
    const r = await query(
      `SELECT * FROM entitlements WHERE reference=$1 LIMIT 1`,
      [d.reference]
    );

    if (r.rowCount && Number(d.amount) === Number(r.rows[0].amount_pesewas)) {
      await query(
        `UPDATE entitlements
         SET status='paid',provider_id=$1,unlocked_at=NOW()
         WHERE reference=$2`,
        [String(d.id), d.reference]
      );
    }
  }

  res.sendStatus(200);
});

app.get("/api/admin/payment-submissions", admin, async (req, res) => {
  const r = await query(`
    SELECT p.*,u.name,u.email
    FROM payment_submissions p
    JOIN users u ON u.id=p.user_id
    ORDER BY p.created_at DESC
    LIMIT 200
  `);
  res.json(r.rows);
});

app.post("/api/admin/payment-submissions/:id/approve", admin, async (req, res) => {
  const r = await query(
    `SELECT * FROM payment_submissions WHERE id=$1 LIMIT 1`,
    [req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Submission not found." });

  const p = r.rows[0];
  const reference = `MOMO-${p.transaction_id}`;

  await query(
    `UPDATE payment_submissions
     SET status='approved',reviewed_by='admin',reviewed_at=NOW()
     WHERE id=$1`,
    [p.id]
  );

  await query(
    `INSERT INTO entitlements
      (user_id,level,subject,product_code,amount_pesewas,reference,status,provider,provider_id,unlocked_at)
     VALUES($1,$2,$3,$4,$5,$6,'paid','manual_momo',$7,NOW())
     ON CONFLICT(reference)
     DO UPDATE SET status='paid',unlocked_at=NOW()`,
    [
      p.user_id,
      p.level,
      p.subject,
      productCode(p.level, p.subject),
      p.amount_pesewas,
      reference,
      p.transaction_id
    ]
  );

  res.json({ ok: true });
});

app.get("/api/admin/stats", admin, async (req, res) => {
  const [users, paid, pending] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM users`),
    query(`SELECT COALESCE(SUM(amount_pesewas),0)::int AS total
           FROM entitlements WHERE status='paid'`),
    query(`SELECT COUNT(*)::int AS count
           FROM payment_submissions WHERE status='pending'`)
  ]);

  res.json({
    users: users.rows[0].count,
    revenue_pesewas: paid.rows[0].total,
    pending_momo: pending.rows[0].count
  });
});

app.get("/payment/callback", (req, res) => {
  res.send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PASSCOGH-MODOO Payment</title></head>
<body style="font-family:Arial,sans-serif;padding:30px">
<h2>Payment received</h2>
<p>Return to PASSCOGH-MODOO. Your payment will be verified automatically.</p>
</body></html>`);
});

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*splat", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

initDb()
  .then(() => app.listen(PORT, () =>
    console.log(`PASSCOGH-MODOO running on port ${PORT}`)
  ))
  .catch(err => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
