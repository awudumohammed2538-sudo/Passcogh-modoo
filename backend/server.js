import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);

// Project structure expected by this server:
// data/passcogh_curriculum.json
// public/index.html
const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const PDF_DIR = path.join(STORAGE_DIR, "pdfs");
const CURRICULUM_FILE = path.join(DATA_DIR, "passcogh_curriculum.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

let pool = null;

async function connectDatabase() {
  if (!process.env.DATABASE_URL) return;
  try {
    const { Pool } = await import("pg");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000
    });
    await pool.query("SELECT 1");
    console.log("PostgreSQL connected");
  } catch (error) {
    console.error("PostgreSQL connection failed:", error.message);
    pool = null;
  }
}

function email(value) {
  return String(value || "").trim().toLowerCase();
}

function creatorEmail() {
  return email(process.env.CREATOR_EMAIL || "awudumohammedmodoo@gmail.com");
}

function curriculumExists() {
  return fs.existsSync(CURRICULUM_FILE);
}

function readCurriculum() {
  if (!curriculumExists()) {
    return {
      platform: "PASSCOGH-MODOO",
      error: "data/passcogh_curriculum.json was not found.",
      levels: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(CURRICULUM_FILE, "utf8"));
  } catch (error) {
    console.error("Curriculum JSON error:", error.message);
    return {
      platform: "PASSCOGH-MODOO",
      error: "The curriculum JSON could not be parsed.",
      levels: []
    };
  }
}

function levels() {
  const data = readCurriculum();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.levels)) return data.levels;
  return [];
}

function subjects() {
  const result = [];
  for (const level of levels()) {
    const list = level.subjects || level.courses || [];
    if (!Array.isArray(list)) continue;
    for (const subject of list) {
      result.push({
        ...subject,
        level: subject.level || level.name || level.id || ""
      });
    }
  }
  return result;
}

function findSubject(value) {
  const q = String(value || "").trim().toLowerCase();
  return subjects().find((s) => {
    const id = String(s.id || s.code || "").toLowerCase();
    const name = String(s.name || s.title || "").toLowerCase();
    return id === q || name === q;
  });
}

const COURSES = [
  ["coding-programming", "Coding & Programming"],
  ["web-development", "Web Development"],
  ["digital-skills", "Digital Skills"],
  ["data-excel", "Data & Excel"],
  ["graphic-design", "Graphic Design"],
  ["entrepreneurship", "Entrepreneurship"],
  ["digital-marketing", "Digital Marketing"],
  ["study-exam-skills", "Study & Exam Skills"],
  ["ai-productivity", "AI & Productivity"]
].map(([id, title]) => ({ id, title, price: 20, currency: "GHS", certificateEnabled: true }));

const PDFS = [
  { id: "biology-revision-pack", title: "Biology Revision Pack", filename: "biology-revision-pack.pdf", price: 5 },
  { id: "chemistry-revision-pack", title: "Chemistry Revision Pack", filename: "chemistry-revision-pack.pdf", price: 5 },
  { id: "wassce-exam-guide", title: "WASSCE Exam Guide", filename: "wassce-exam-guide.pdf", price: 5 }
];

function userFromRequest(req) {
  const userEmail = email(req.headers["x-user-email"]);
  if (!userEmail || !userEmail.includes("@")) return null;
  return {
    email: userEmail,
    name: String(req.headers["x-user-name"] || ""),
    role: userEmail === creatorEmail() ? "creator" : "learner"
  };
}

function requireUser(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ success: false, message: "Valid user email is required." });
  req.user = user;
  next();
}

function requireCreator(req, res, next) {
  const user = userFromRequest(req);
  if (!user || user.role !== "creator") {
    return res.status(403).json({ success: false, message: "Creator access denied." });
  }
  req.user = user;
  next();
}

// Health check
app.get("/api/health", async (req, res) => {
  let database = "not_configured";
  if (pool) {
    try {
      await pool.query("SELECT 1");
      database = "connected";
    } catch {
      database = "connection_failed";
    }
  }
  res.json({
    success: true,
    message: "PASSCOGH-MODOO backend is running",
    curriculumFileExists: curriculumExists(),
    curriculumFile: "data/passcogh_curriculum.json",
    database,
    paymentProvider: process.env.PAYSTACK_SECRET_KEY ? "configured" : "not_configured"
  });
});

// Curriculum API
app.get("/api/curriculum", (req, res) => {
  res.json({ success: true, curriculum: readCurriculum() });
});

app.get("/api/levels", (req, res) => {
  res.json({ success: true, levels: levels() });
});

app.get("/api/subjects", (req, res) => {
  res.json({ success: true, subjects: subjects() });
});

app.get("/api/subjects/:subject", (req, res) => {
  const subject = findSubject(req.params.subject);
  if (!subject) return res.status(404).json({ success: false, message: "Subject not found." });
  res.json({ success: true, subject });
});

app.get("/api/subjects/:subject/topics", (req, res) => {
  const subject = findSubject(req.params.subject);
  if (!subject) return res.status(404).json({ success: false, message: "Subject not found." });
  res.json({
    success: true,
    subject: subject.name || subject.title,
    topics: subject.topics || subject.units || []
  });
});

app.get("/api/subjects/:subject/topics/:topic", (req, res) => {
  const subject = findSubject(req.params.subject);
  if (!subject) return res.status(404).json({ success: false, message: "Subject not found." });
  const topic = (subject.topics || subject.units || []).find((t) => {
    return String(t.id || t.name || t.title || "").toLowerCase() === String(req.params.topic).toLowerCase();
  });
  if (!topic) return res.status(404).json({ success: false, message: "Topic not found." });
  res.json({ success: true, subject: subject.name || subject.title, topic });
});

// Courses
app.get("/api/courses", (req, res) => {
  res.json({ success: true, courses: COURSES });
});

app.get("/api/courses/:id/access", requireUser, (req, res) => {
  if (req.user.role === "creator") {
    return res.json({ success: true, access: true, creator: true });
  }
  res.json({ success: true, access: false, message: "Course access requires enrollment/payment." });
});

// Paystack
async function initializePaystack({ emailAddress, amount, reference, callbackUrl }) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not configured on the server.");

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: emailAddress,
      amount: Math.round(Number(amount) * 100),
      currency: "GHS",
      reference,
      callback_url: callbackUrl
    })
  });

  const data = await response.json();
  if (!response.ok || !data.status) throw new Error(data.message || "Paystack initialization failed.");
  return data.data;
}

app.post("/api/payments/course", requireUser, async (req, res) => {
  try {
    const course = COURSES.find((c) => c.id === req.body.courseId);
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });
    if (req.user.role === "creator") return res.json({ success: true, enrolled: true, creator: true });

    const reference = `PASSCOGH-${crypto.randomUUID()}`;
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const payment = await initializePaystack({
      emailAddress: req.user.email,
      amount: course.price,
      reference,
      callbackUrl: `${baseUrl}/payment/callback`
    });

    res.json({ success: true, paymentRequired: true, authorizationUrl: payment.authorization_url, reference });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/payments/pdf", requireUser, async (req, res) => {
  try {
    const pdf = PDFS.find((p) => p.id === req.body.pdfId);
    if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });
    if (req.user.role === "creator") return res.json({ success: true, downloadAllowed: true, creator: true });

    const reference = `PASSCOGH-PDF-${crypto.randomUUID()}`;
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const payment = await initializePaystack({
      emailAddress: req.user.email,
      amount: pdf.price,
      reference,
      callbackUrl: `${baseUrl}/payment/callback`
    });

    res.json({ success: true, paymentRequired: true, authorizationUrl: payment.authorization_url, reference });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/payments/verify/:reference", requireUser, async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(503).json({ success: false, message: "Payment provider is not configured." });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(req.params.reference)}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });
    const data = await response.json();
    if (!response.ok || !data.status || !data.data) {
      return res.status(400).json({ success: false, message: data.message || "Could not verify payment." });
    }

    const transaction = data.data;
    res.json({
      success: true,
      verified: transaction.status === "success" && transaction.currency === "GHS",
      reference: transaction.reference,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency
    });
  } catch {
    res.status(500).json({ success: false, message: "Payment verification error." });
  }
});

app.get("/payment/callback", (req, res) => {
  const reference = String(req.query.reference || "").replace(/[<>&"]/g, "");
  if (!reference) return res.status(400).send("Payment reference is missing.");
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PASSCOGH-MODOO Payment</title></head><body style="font-family:system-ui;padding:30px;text-align:center"><h2>Payment received</h2><p>Your payment is being verified.</p><p>Reference: ${reference}</p></body></html>`);
});

// PDFs: reading is free; download access is paid for learners and free for creator.
app.get("/api/pdfs", (req, res) => {
  res.json({
    success: true,
    pdfs: PDFS.map((p) => ({ ...p, onlineReading: true, paidDownload: true }))
  });
});

app.post("/api/reading/start", requireUser, (req, res) => {
  const pdf = PDFS.find((p) => p.id === req.body.pdfId);
  if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });
  res.json({
    success: true,
    readingSessionStarted: true,
    advertisementsEnabled: req.user.role !== "creator",
    pdfId: pdf.id
  });
});

app.get("/api/pdfs/:id/download-access", requireUser, (req, res) => {
  const pdf = PDFS.find((p) => p.id === req.params.id);
  if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });
  res.json({
    success: true,
    allowed: req.user.role === "creator",
    paymentRequired: req.user.role !== "creator"
  });
});

app.get("/api/pdfs/:id/download", requireUser, (req, res) => {
  const pdf = PDFS.find((p) => p.id === req.params.id);
  if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });
  if (req.user.role !== "creator") return res.status(403).json({ success: false, message: "Paid download access is required." });

  const filePath = path.join(PDF_DIR, pdf.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "Protected PDF file is not uploaded yet." });
  res.download(filePath, pdf.filename);
});

// Creator access
app.get("/api/creator/access", requireCreator, (req, res) => {
  res.json({
    success: true,
    creator: true,
    email: req.user.email,
    role: req.user.role,
    unlimitedAccess: true,
    freeCourseAccess: true,
    freePdfDownload: true,
    advertisementsDisabled: true
  });
});

app.get("/api/creator/dashboard", requireCreator, (req, res) => {
  res.json({
    success: true,
    creator: true,
    curriculumFileExists: curriculumExists(),
    database: pool ? "connected" : "not_connected"
  });
});

// Frontend
app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res) => {
  const indexFile = path.join(PUBLIC_DIR, "index.html");
  if (!fs.existsSync(indexFile)) return res.status(404).send("PASSCOGH-MODOO index.html was not found.");
  res.sendFile(indexFile);
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ success: false, message: "PASSCOGH-MODOO server error." });
});

async function start() {
  await connectDatabase();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PASSCOGH-MODOO backend running on port ${PORT}`);
    console.log(`Curriculum: ${curriculumExists() ? "FOUND" : "MISSING"}`);
    console.log(`Paystack: ${process.env.PAYSTACK_SECRET_KEY ? "CONFIGURED" : "NOT CONFIGURED"}`);
  });
}

start().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
