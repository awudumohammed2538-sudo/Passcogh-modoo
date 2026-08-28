import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

const PUBLIC_DIR = path.join(__dirname, "../public");
const DATA_DIR = path.join(__dirname, "../data");
const STORAGE_DIR = path.join(__dirname, "../storage");
const PDF_DIR = path.join(STORAGE_DIR, "pdfs");
const CURRICULUM_FILE = path.join(DATA_DIR, "passcogh_carriculum.json");

for (const dir of [DATA_DIR, STORAGE_DIR, PDF_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

/* =========================================================
   DATABASE
   ========================================================= */

const db = new Database(path.join(DATA_DIR, "passcogh.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'learner'
    CHECK(role IN ('learner','creator')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS course_enrolments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  progress INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, course_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'paystack',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pdf_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pdf_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pdf_id TEXT NOT NULL,
  payment_reference TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, course_id)
);
`);

/* =========================================================
   CONFIGURATION
   ========================================================= */

const CREATOR_EMAIL = String(
  process.env.CREATOR_EMAIL || "awudumohammedmodoo@gmail.com"
).trim().toLowerCase();

const SESSION_DAYS = 7;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSession(userId) {
  const rawToken = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  db.prepare(`
    INSERT INTO sessions(token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(tokenHash, userId, expiresAt);

  return rawToken;
}

function deleteExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function getRequestUser(req) {
  deleteExpiredSessions();

  const token = getBearerToken(req);
  if (!token) return null;

  const row = db.prepare(`
    SELECT users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now());

  return row || null;
}

function requireUser(req, res, next) {
  const user = getRequestUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });
  }

  req.user = user;
  next();
}

function requireCreator(req, res, next) {
  const user = getRequestUser(req);

  if (!user || user.role !== "creator") {
    return res.status(403).json({
      success: false,
      message: "Creator access denied."
    });
  }

  req.user = user;
  next();
}

function safeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/* =========================================================
   CURRICULUM
   ========================================================= */

function loadCurriculum() {
  if (!fs.existsSync(CURRICULUM_FILE)) {
    return {
      platform: "PASSCOGH-MODOO",
      error: "passcogh_carriculum.json was not found in the data folder.",
      levels: []
    };
  }

  try {
    return JSON.parse(fs.readFileSync(CURRICULUM_FILE, "utf8"));
  } catch (error) {
    console.error("Curriculum JSON error:", error);
    return {
      platform: "PASSCOGH-MODOO",
      error: "Curriculum JSON could not be read.",
      levels: []
    };
  }
}

function getLevels() {
  const curriculum = loadCurriculum();

  if (Array.isArray(curriculum.levels)) return curriculum.levels;
  if (Array.isArray(curriculum)) return curriculum;

  return [];
}

function getAllSubjects() {
  const subjects = [];

  for (const level of getLevels()) {
    const levelSubjects = Array.isArray(level.subjects)
      ? level.subjects
      : Array.isArray(level.courses)
        ? level.courses
        : [];

    for (const subject of levelSubjects) {
      subjects.push({
        ...subject,
        level: subject.level || level.name || level.id || ""
      });
    }
  }

  return subjects;
}

function findSubject(value) {
  const query = String(value || "").trim().toLowerCase();

  return getAllSubjects().find(subject => {
    const id = String(
      subject.id || subject.code || ""
    ).toLowerCase();

    const name = String(
      subject.name || subject.title || ""
    ).toLowerCase();

    return id === query || name === query;
  });
}

/* =========================================================
   COURSES
   ========================================================= */

const COURSES = [
  {
    id: "coding-programming",
    title: "Coding & Programming",
    description: "Learn programming foundations and practical coding.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "web-development",
    title: "Web Development",
    description: "Build websites using HTML, CSS and JavaScript.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "digital-skills",
    title: "Digital Skills",
    description: "Practical digital skills for school, work and life.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "data-excel",
    title: "Data & Excel",
    description: "Learn spreadsheets, formulas and useful data skills.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "graphic-design",
    title: "Graphic Design",
    description: "Learn practical design principles and digital graphics.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "entrepreneurship",
    title: "Entrepreneurship",
    description: "Learn business ideas, planning and practical entrepreneurship.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "digital-marketing",
    title: "Digital Marketing",
    description: "Learn practical online marketing and audience growth.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "study-exam-skills",
    title: "Study & Exam Skills",
    description: "Improve revision, exam technique and preparation.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  },
  {
    id: "ai-productivity",
    title: "AI & Productivity",
    description: "Learn responsible AI use and productivity techniques.",
    price: 20,
    currency: "GHS",
    certificateEnabled: true,
    published: true
  }
];

function findCourse(id) {
  const value = String(id || "").trim().toLowerCase();

  return COURSES.find(course =>
    course.id.toLowerCase() === value ||
    course.title.toLowerCase() === value
  );
}

/* =========================================================
   PDF / MATERIAL CATALOGUE
   ========================================================= */

const PDFS = [
  {
    id: "biology-revision-pack",
    title: "Biology Revision Pack",
    filename: "biology-revision-pack.pdf",
    price: 5,
    currency: "GHS"
  },
  {
    id: "chemistry-revision-pack",
    title: "Chemistry Revision Pack",
    filename: "chemistry-revision-pack.pdf",
    price: 5,
    currency: "GHS"
  },
  {
    id: "wassce-exam-guide",
    title: "WASSCE Exam Guide",
    filename: "wassce-exam-guide.pdf",
    price: 5,
    currency: "GHS"
  }
];

function findPdf(id) {
  const value = String(id || "").trim().toLowerCase();

  return PDFS.find(pdf =>
    pdf.id.toLowerCase() === value ||
    pdf.title.toLowerCase() === value
  );
}

/* =========================================================
   USER AUTHENTICATION
   ========================================================= */

app.post("/api/auth/register", (req, res) => {
  try {
    const email = safeEmail(req.body.email);
    const name = String(req.body.name || "").trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address."
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required."
      });
    }

    const role = email === CREATOR_EMAIL ? "creator" : "learner";

    db.prepare(`
      INSERT INTO users(email, name, role)
      VALUES (?, ?, ?)
    `).run(email, name, role);

    const user = db.prepare(
      "SELECT id,email,name,role,created_at FROM users WHERE email = ?"
    ).get(email);

    const token = createSession(user.id);

    res.status(201).json({
      success: true,
      user,
      token
    });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({
        success: false,
        message: "An account with that email already exists."
      });
    }

    console.error(error);
    res.status(500).json({
      success: false,
      message: "Registration failed."
    });
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = safeEmail(req.body.email);

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address."
    });
  }

  const user = db.prepare(
    "SELECT id,email,name,role,created_at FROM users WHERE email = ?"
  ).get(email);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Account not found. Please register first."
    });
  }

  const token = createSession(user.id);

  res.json({
    success: true,
    user,
    token
  });
});

app.post("/api/auth/logout", requireUser, (req, res) => {
  const token = getBearerToken(req);

  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }

  res.json({
    success: true,
    message: "Logged out."
  });
});

app.get("/api/auth/me", requireUser, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      created_at: req.user.created_at
    }
  });
});

/* =========================================================
   HEALTH
   ========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "PASSCOGH-MODOO backend is running",
    curriculumFile: path.basename(CURRICULUM_FILE),
    curriculumFileExists: fs.existsSync(CURRICULUM_FILE),
    levels: getLevels().length,
    subjects: getAllSubjects().length,
    paymentProvider: process.env.PAYSTACK_SECRET_KEY
      ? "configured"
      : "not_configured"
  });
});

/* =========================================================
   CURRICULUM API
   ========================================================= */

app.get("/api/curriculum", (req, res) => {
  res.json({
    success: true,
    curriculum: loadCurriculum()
  });
});

app.get("/api/levels", (req, res) => {
  res.json({
    success: true,
    levels: getLevels()
  });
});

app.get("/api/subjects", (req, res) => {
  res.json({
    success: true,
    subjects: getAllSubjects()
  });
});

app.get("/api/subjects/:subject", (req, res) => {
  const subject = findSubject(req.params.subject);

  if (!subject) {
    return res.status(404).json({
      success: false,
      message: "Subject not found."
    });
  }

  res.json({
    success: true,
    subject
  });
});

app.get("/api/subjects/:subject/topics", (req, res) => {
  const subject = findSubject(req.params.subject);

  if (!subject) {
    return res.status(404).json({
      success: false,
      message: "Subject not found."
    });
  }

  const topics = Array.isArray(subject.topics)
    ? subject.topics
    : Array.isArray(subject.units)
      ? subject.units
      : [];

  res.json({
    success: true,
    subject: subject.name || subject.title,
    topics
  });
});

app.get("/api/subjects/:subject/topics/:topic", (req, res) => {
  const subject = findSubject(req.params.subject);

  if (!subject) {
    return res.status(404).json({
      success: false,
      message: "Subject not found."
    });
  }

  const topics = Array.isArray(subject.topics)
    ? subject.topics
    : Array.isArray(subject.units)
      ? subject.units
      : [];

  const query = req.params.topic.toLowerCase();

  const topic = topics.find(item => {
    const id = String(item.id || "").toLowerCase();
    const name = String(
      item.name || item.title || ""
    ).toLowerCase();

    return id === query || name === query;
  });

  if (!topic) {
    return res.status(404).json({
      success: false,
      message: "Topic not found."
    });
  }

  res.json({
    success: true,
    subject: subject.name || subject.title,
    topic
  });
});

/* =========================================================
   QUESTIONS / PRACTICAL / EXAM GUIDE
   ========================================================= */

app.get("/api/questions", (req, res) => {
  const curriculum = loadCurriculum();

  const questions =
    Array.isArray(curriculum.questions)
      ? curriculum.questions
      : Array.isArray(curriculum.questionBank)
        ? curriculum.questionBank
        : [];

  res.json({
    success: true,
    questions
  });
});

app.get("/api/past-questions", (req, res) => {
  const curriculum = loadCurriculum();

  const pastQuestions =
    Array.isArray(curriculum.pastQuestions)
      ? curriculum.pastQuestions
      : [];

  res.json({
    success: true,
    pastQuestions
  });
});

app.get("/api/practical", (req, res) => {
  const curriculum = loadCurriculum();

  const practical =
    Array.isArray(curriculum.practical)
      ? curriculum.practical
      : Array.isArray(curriculum.practicalPreparation)
        ? curriculum.practicalPreparation
        : [];

  res.json({
    success: true,
    practical
  });
});

app.get("/api/exam-guides", (req, res) => {
  const curriculum = loadCurriculum();

  const examGuides =
    Array.isArray(curriculum.examGuides)
      ? curriculum.examGuides
      : [];

  res.json({
    success: true,
    examGuides
  });
});

/* =========================================================
   COURSES
   ========================================================= */

app.get("/api/courses", (req, res) => {
  res.json({
    success: true,
    courses: COURSES.filter(course => course.published)
  });
});

app.get("/api/courses/:id/access", requireUser, (req, res) => {
  const course = findCourse(req.params.id);

  if (!course) {
    return res.status(404).json({
      success: false,
      message: "Course not found."
    });
  }

  if (req.user.role === "creator") {
    return res.json({
      success: true,
      access: true,
      creator: true
    });
  }

  const enrolment = db.prepare(`
    SELECT *
    FROM course_enrolments
    WHERE user_id = ?
      AND course_id = ?
      AND status = 'active'
  `).get(req.user.id, course.id);

  res.json({
    success: true,
    access: Boolean(enrolment),
    enrolment: enrolment || null
  });
});

app.get("/api/enrolments", requireUser, (req, res) => {
  const enrolments = db.prepare(`
    SELECT *
    FROM course_enrolments
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id);

  res.json({
    success: true,
    enrolments
  });
});

/* =========================================================
   PAYSTACK
   ========================================================= */

async function initialisePaystackPayment({
  email,
  amount,
  reference,
  callbackUrl
}) {
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured on the server."
    );
  }

  const response = await fetch(
    "https://api.paystack.co/transaction/initialize",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount: Math.round(Number(amount) * 100),
        currency: "GHS",
        reference,
        callback_url: callbackUrl
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.status) {
    throw new Error(
      data.message || "Payment initialization failed."
    );
  }

  return data.data;
}

async function verifyPaystack(reference) {
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured."
    );
  }

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: {
        Authorization: `Bearer ${secret}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.status || !data.data) {
    throw new Error(
      data.message || "Could not verify payment."
    );
  }

  return data.data;
}

/* =========================================================
   COURSE PAYMENT
   ========================================================= */

app.post("/api/payments/course", requireUser, async (req, res) => {
  try {
    const course = findCourse(req.body.courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found."
      });
    }

    if (req.user.role === "creator") {
      db.prepare(`
        INSERT INTO course_enrolments(user_id, course_id, status)
        VALUES (?, ?, 'active')
        ON CONFLICT(user_id, course_id)
        DO UPDATE SET status='active'
      `).run(req.user.id, course.id);

      return res.json({
        success: true,
        enrolled: true,
        creator: true
      });
    }

    const existing = db.prepare(`
      SELECT *
      FROM course_enrolments
      WHERE user_id = ?
        AND course_id = ?
        AND status = 'active'
    `).get(req.user.id, course.id);

    if (existing) {
      return res.json({
        success: true,
        enrolled: true
      });
    }

    const reference = `PASSCOGH-${crypto.randomUUID()}`;

    db.prepare(`
      INSERT INTO payments
      (reference,user_id,item_type,item_id,amount,currency)
      VALUES (?,?,'course',?,?, 'GHS')
    `).run(
      reference,
      req.user.id,
      course.id,
      course.price
    );

    const baseUrl =
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;

    const payment = await initialisePaystackPayment({
      email: req.user.email,
      amount: course.price,
      reference,
      callbackUrl: `${baseUrl}/payment/callback`
    });

    res.json({
      success: true,
      paymentRequired: true,
      authorizationUrl: payment.authorization_url,
      accessCode: payment.access_code,
      reference
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================================================
   PDF MATERIALS
   ========================================================= */

app.get("/api/pdfs", (req, res) => {
  res.json({
    success: true,
    pdfs: PDFS.map(pdf => ({
      id: pdf.id,
      title: pdf.title,
      price: pdf.price,
      currency: pdf.currency,
      onlineReading: true,
      paidDownload: true
    }))
  });
});

app.post("/api/reading/start", requireUser, (req, res) => {
  const pdf = findPdf(req.body.pdfId);

  if (!pdf) {
    return res.status(404).json({
      success: false,
      message: "PDF not found."
    });
  }

  const expiresAt = new Date(
    Date.now() + 30 * 60 * 1000
  ).toISOString();

  db.prepare(`
    INSERT INTO reading_sessions
    (user_id,pdf_id,expires_at)
    VALUES (?,?,?)
  `).run(
    req.user.id,
    pdf.id,
    expiresAt
  );

  res.json({
    success: true,
    readingSessionStarted: true,
    pdfId: pdf.id,
    expiresAt,
    advertisementsEnabled: req.user.role !== "creator"
  });
});

app.get("/api/pdfs/:id/download-access", requireUser, (req, res) => {
  const pdf = findPdf(req.params.id);

  if (!pdf) {
    return res.status(404).json({
      success: false,
      message: "PDF not found."
    });
  }

  if (req.user.role === "creator") {
    return res.json({
      success: true,
      allowed: true,
      creator: true
    });
  }

  const purchase = db.prepare(`
    SELECT *
    FROM pdf_purchases
    WHERE user_id = ?
      AND pdf_id = ?
  `).get(req.user.id, pdf.id);

  res.json({
    success: true,
    allowed: Boolean(purchase)
  });
});

app.post("/api/payments/pdf", requireUser, async (req, res) => {
  try {
    const pdf = findPdf(req.body.pdfId);

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "PDF not found."
      });
    }

    if (req.user.role === "creator") {
      return res.json({
        success: true,
        downloadAllowed: true,
        creator: true
      });
    }

    const existing = db.prepare(`
      SELECT *
      FROM pdf_purchases
      WHERE user_id = ?
        AND pdf_id = ?
    `).get(req.user.id, pdf.id);

    if (existing) {
      return res.json({
        success: true,
        downloadAllowed: true
      });
    }

    const reference =
      `PASSCOGH-PDF-${crypto.randomUUID()}`;

    db.prepare(`
      INSERT INTO payments
      (reference,user_id,item_type,item_id,amount,currency)
      VALUES (?,?,'pdf',?,?, 'GHS')
    `).run(
      reference,
      req.user.id,
      pdf.id,
      pdf.price
    );

    const baseUrl =
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;

    const payment = await initialisePaystackPayment({
      email: req.user.email,
      amount: pdf.price,
      reference,
      callbackUrl: `${baseUrl}/payment/callback`
    });

    res.json({
      success: true,
      paymentRequired: true,
      authorizationUrl: payment.authorization_url,
      accessCode: payment.access_code,
      reference
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================================================
   PAYMENT VERIFICATION
   ========================================================= */

app.get("/api/payments/verify/:reference", requireUser, async (req, res) => {
  try {
    const reference = req.params.reference;

    const payment = db.prepare(`
      SELECT *
      FROM payments
      WHERE reference = ?
        AND user_id = ?
    `).get(reference, req.user.id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found."
      });
    }

    const transaction = await verifyPaystack(reference);

    const expectedAmount = Number(payment.amount) * 100;

    if (
      transaction.status !== "success" ||
      transaction.currency !== "GHS" ||
      Number(transaction.amount) !== expectedAmount
    ) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: "Payment verification failed."
      });
    }

    db.prepare(`
      UPDATE payments
      SET status='success', verified_at=CURRENT_TIMESTAMP
      WHERE reference=?
    `).run(reference);

    if (payment.item_type === "course") {
      db.prepare(`
        INSERT INTO course_enrolments(user_id,course_id,status)
        VALUES (?,?,'active')
        ON CONFLICT(user_id,course_id)
        DO UPDATE SET status='active'
      `).run(
        payment.user_id,
        payment.item_id
      );
    }

    if (payment.item_type === "pdf") {
      db.prepare(`
        INSERT OR IGNORE INTO pdf_purchases
        (user_id,pdf_id,payment_reference)
        VALUES (?,?,?)
      `).run(
        payment.user_id,
        payment.item_id,
        reference
      );
    }

    res.json({
      success: true,
      verified: true,
      itemType: payment.item_type,
      itemId: payment.item_id,
      reference
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/payment/callback", (req, res) => {
  const reference = req.query.reference;

  if (!reference) {
    return res.status(400).send("Payment reference is missing.");
  }

  res.send(`
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PASSCOGH-MODOO Payment</title>
</head>
<body style="font-family:system-ui;padding:30px;text-align:center">
<h2>Payment received</h2>
<p>Your payment is being verified.</p>
<p>You can return to PASSCOGH-MODOO.</p>
<script>
window.setTimeout(function () {
  window.location.href = "/";
}, 2500);
</script>
</body>
</html>
  `);
});

/* =========================================================
   SECURE PDF DOWNLOAD
   ========================================================= */

app.get("/api/pdfs/:id/download", requireUser, (req, res) => {
  const pdf = findPdf(req.params.id);

  if (!pdf) {
    return res.status(404).json({
      success: false,
      message: "PDF not found."
    });
  }

  if (req.user.role !== "creator") {
    const purchase = db.prepare(`
      SELECT *
      FROM pdf_purchases
      WHERE user_id = ?
        AND pdf_id = ?
    `).get(req.user.id, pdf.id);

    if (!purchase) {
      return res.status(403).json({
        success: false,
        message: "Paid download access is required."
      });
    }
  }

  const filePath = path.join(PDF_DIR, pdf.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: "The protected PDF has not been uploaded yet."
    });
  }

  res.download(filePath, pdf.filename);
});

/* =========================================================
   COURSE PROGRESS
   ========================================================= */

app.post("/api/courses/:id/progress", requireUser, (req, res) => {
  const course = findCourse(req.params.id);

  if (!course) {
    return res.status(404).json({
      success: false,
      message: "Course not found."
    });
  }

  if (req.user.role !== "creator") {
    const access = db.prepare(`
      SELECT *
      FROM course_enrolments
      WHERE user_id=?
        AND course_id=?
        AND status='active'
    `).get(req.user.id, course.id);

    if (!access) {
      return res.status(403).json({
        success: false,
        message: "You must be enrolled first."
      });
    }
  }

  let progress = Number(req.body.progress);

  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return res.status(400).json({
      success: false,
      message: "Progress must be between 0 and 100."
    });
  }

  progress = Math.round(progress);

  db.prepare(`
    INSERT INTO course_enrolments
    (user_id,course_id,progress,status)
    VALUES (?,?,'active')
  `).run(
    req.user.id,
    course.id,
    progress
  );

  db.prepare(`
    UPDATE course_enrolments
    SET progress=?,
        completed_at=CASE
          WHEN ?=100 THEN COALESCE(completed_at,CURRENT_TIMESTAMP)
          ELSE completed_at
        END
    WHERE user_id=? AND course_id=?
  `).run(
    progress,
    progress,
    req.user.id,
    course.id
  );

  res.json({
    success: true,
    progress
  });
});

/* =========================================================
   CERTIFICATES
   ========================================================= */

app.post("/api/courses/:id/certificate", requireUser, (req, res) => {
  const course = findCourse(req.params.id);

  if (!course) {
    return res.status(404).json({
      success: false,
      message: "Course not found."
    });
  }

  const enrolment = db.prepare(`
    SELECT *
    FROM course_enrolments
    WHERE user_id=?
      AND course_id=?
      AND status='active'
  `).get(req.user.id, course.id);

  if (
    req.user.role !== "creator" &&
    (!enrolment || Number(enrolment.progress) < 100)
  ) {
    return res.status(403).json({
      success: false,
      message: "Complete the course before requesting a certificate."
    });
  }

  const existing = db.prepare(`
    SELECT *
    FROM certificates
    WHERE user_id=? AND course_id=?
  `).get(req.user.id, course.id);

  if (existing) {
    return res.json({
      success: true,
      certificate: existing
    });
  }

  const certificateNo =
    `PASSCOGH-${new Date().getFullYear()}-${crypto
      .randomBytes(6)
      .toString("hex")
      .toUpperCase()}`;

  db.prepare(`
    INSERT INTO certificates
    (certificate_no,user_id,course_id)
    VALUES (?,?,?)
  `).run(
    certificateNo,
    req.user.id,
    course.id
  );

  const certificate = db.prepare(`
    SELECT *
    FROM certificates
    WHERE certificate_no=?
  `).get(certificateNo);

  res.json({
    success: true,
    certificate
  });
});

app.get("/api/certificates/:certificateNo", (req, res) => {
  const certificate = db.prepare(`
    SELECT
      certificates.certificate_no,
      certificates.issued_at,
      users.name,
      users.email,
      certificates.course_id
    FROM certificates
    JOIN users ON users.id=certificates.user_id
    WHERE certificates.certificate_no=?
  `).get(req.params.certificateNo);

  if (!certificate) {
    return res.status(404).json({
      success: false,
      valid: false,
      message: "Certificate not found."
    });
  }

  const course = findCourse(certificate.course_id);

  res.json({
    success: true,
    valid: true,
    certificate: {
      ...certificate,
      course_title: course?.title || certificate.course_id
    }
  });
});

/* =========================================================
   CREATOR
   ========================================================= */

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
  const users = db.prepare(
    "SELECT COUNT(*) AS count FROM users"
  ).get().count;

  const enrolments = db.prepare(
    "SELECT COUNT(*) AS count FROM course_enrolments"
  ).get().count;

  const successfulPayments = db.prepare(
    "SELECT COUNT(*) AS count FROM payments WHERE status='success'"
  ).get().count;

  const certificates = db.prepare(
    "SELECT COUNT(*) AS count FROM certificates"
  ).get().count;

  res.json({
    success: true,
    users,
    enrolments,
    successfulPayments,
    certificates,
    curriculumFile: fs.existsSync(CURRICULUM_FILE),
    curriculumLevels: getLevels().length,
    curriculumSubjects: getAllSubjects().length
  });
});

/* =========================================================
   STATIC WEBSITE
   ========================================================= */

app.use(express.static(PUBLIC_DIR));

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use((error, req, res, next) => {
  console.error("PASSCOGH-MODOO server error:", error);

  res.status(500).json({
    success: false,
    message: "PASSCOGH-MODOO server error."
  });
});

/* =========================================================
   START
   ========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PASSCOGH-MODOO running on port ${PORT}`);
  console.log(
    `Curriculum file: ${
      fs.existsSync(CURRICULUM_FILE) ? "FOUND" : "MISSING"
    }`
  );
  console.log(
    `Paystack: ${
      process.env.PAYSTACK_SECRET_KEY ? "CONFIGURED" : "NOT CONFIGURED"
    }`
  );
});
