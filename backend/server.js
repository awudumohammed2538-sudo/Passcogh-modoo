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

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------
// SECURITY HEADERS
// ---------------------------------------------------------

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  next();
});

// ---------------------------------------------------------
// DATABASE
// ---------------------------------------------------------

const db = new Database(path.join(DATA_DIR, "passcogh.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'learner',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// ---------------------------------------------------------
// CURRICULUM
// ---------------------------------------------------------

const CURRICULUM_FILE = path.join(
  DATA_DIR,
  "passcogh_carriculum.json"
);

function loadCurriculum() {
  if (!fs.existsSync(CURRICULUM_FILE)) {
    return {
      platform: "PASSCOGH-MODOO",
      error:
        "passcogh_carriculum.json was not found in the data folder.",
      levels: []
    };
  }

  try {
    return JSON.parse(
      fs.readFileSync(CURRICULUM_FILE, "utf8")
    );
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

  if (Array.isArray(curriculum.levels)) {
    return curriculum.levels;
  }

  if (Array.isArray(curriculum)) {
    return curriculum;
  }

  return [];
}

function getAllSubjects() {
  const subjects = [];

  for (const level of getLevels()) {
    const levelSubjects =
      level.subjects ||
      level.courses ||
      [];

    for (const subject of levelSubjects) {
      subjects.push({
        ...subject,
        level:
          subject.level ||
          level.name ||
          level.id ||
          ""
      });
    }
  }

  return subjects;
}

function findSubject(subjectIdOrName) {
  const subjects = getAllSubjects();

  return subjects.find(subject => {
    const id = String(
      subject.id ||
      subject.code ||
      subject.name ||
      ""
    ).toLowerCase();

    const name = String(
      subject.name ||
      subject.title ||
      ""
    ).toLowerCase();

    const query =
      String(subjectIdOrName).toLowerCase();

    return id === query || name === query;
  });
}

// ---------------------------------------------------------
// COURSE DATA
// ---------------------------------------------------------

const COURSES = [
  {
    id: "coding-programming",
    title: "Coding & Programming",
    price: 20,
    currency: "GHS"
  },
  {
    id: "web-development",
    title: "Web Development",
    price: 20,
    currency: "GHS"
  },
  {
    id: "digital-skills",
    title: "Digital Skills",
    price: 20,
    currency: "GHS"
  },
  {
    id: "data-excel",
    title: "Data & Excel",
    price: 20,
    currency: "GHS"
  },
  {
    id: "graphic-design",
    title: "Graphic Design",
    price: 20,
    currency: "GHS"
  },
  {
    id: "entrepreneurship",
    title: "Entrepreneurship",
    price: 20,
    currency: "GHS"
  },
  {
    id: "digital-marketing",
    title: "Digital Marketing",
    price: 20,
    currency: "GHS"
  },
  {
    id: "study-exam-skills",
    title: "Study & Exam Skills",
    price: 20,
    currency: "GHS"
  },
  {
    id: "ai-productivity",
    title: "AI & Productivity",
    price: 20,
    currency: "GHS"
  }
];

// ---------------------------------------------------------
// PDF DATA
// ---------------------------------------------------------

const PDFS = [
  {
    id: "biology-revision-pack",
    title: "Biology Revision Pack",
    filename: "biology-revision-pack.pdf",
    price: 5
  },
  {
    id: "chemistry-revision-pack",
    title: "Chemistry Revision Pack",
    filename: "chemistry-revision-pack.pdf",
    price: 5
  },
  {
    id: "wassce-exam-guide",
    title: "WASSCE Exam Guide",
    filename: "wassce-exam-guide.pdf",
    price: 5
  }
];

function findCourse(id) {
  return COURSES.find(
    course =>
      course.id === id ||
      course.title.toLowerCase() ===
        String(id).toLowerCase()
  );
}

function findPdf(id) {
  return PDFS.find(
    pdf =>
      pdf.id === id ||
      pdf.title.toLowerCase() ===
        String(id).toLowerCase()
  );
}

// ---------------------------------------------------------
// USER / CREATOR
// ---------------------------------------------------------

const CREATOR_EMAIL =
  String(
    process.env.CREATOR_EMAIL ||
      "awudumohammedmodoo@gmail.com"
  )
    .trim()
    .toLowerCase();

function getOrCreateUser(email, name = "") {
  const cleanEmail =
    String(email || "")
      .trim()
      .toLowerCase();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("A valid email address is required.");
  }

  const role =
    cleanEmail === CREATOR_EMAIL
      ? "creator"
      : "learner";

  db.prepare(`
    INSERT INTO users (email, name, role)
    VALUES (?, ?, ?)
    ON CONFLICT(email)
    DO UPDATE SET
      name = CASE
        WHEN excluded.name != '' THEN excluded.name
        ELSE users.name
      END,
      role = CASE
        WHEN users.email = ? THEN 'creator'
        ELSE users.role
      END
  `).run(
    cleanEmail,
    name,
    role,
    CREATOR_EMAIL
  );

  return db
    .prepare(
      "SELECT * FROM users WHERE email = ?"
    )
    .get(cleanEmail);
}

function getRequestUser(req) {
  const email =
    req.headers["x-user-email"];

  if (!email) {
    return null;
  }

  try {
    return getOrCreateUser(email);
  } catch {
    return null;
  }
}

function requireUser(req, res, next) {
  const user = getRequestUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Valid user email is required."
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

// ---------------------------------------------------------
// HEALTH
// ---------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "PASSCOGH-MODOO backend is running",
    curriculumFileExists:
      fs.existsSync(CURRICULUM_FILE),
    paymentProvider:
      process.env.PAYSTACK_SECRET_KEY
        ? "configured"
        : "not_configured"
  });
});

// ---------------------------------------------------------
// CURRICULUM API
// ---------------------------------------------------------

app.get("/api/curriculum", (req, res) => {
  const curriculum = loadCurriculum();

  res.json({
    success: true,
    curriculum
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
  const subject =
    findSubject(req.params.subject);

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

app.get(
  "/api/subjects/:subject/topics",
  (req, res) => {
    const subject =
      findSubject(req.params.subject);

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found."
      });
    }

    const topics =
      subject.topics ||
      subject.units ||
      [];

    res.json({
      success: true,
      subject: subject.name,
      topics
    });
  }
);

app.get(
  "/api/subjects/:subject/topics/:topic",
  (req, res) => {
    const subject =
      findSubject(req.params.subject);

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found."
      });
    }

    const topics =
      subject.topics ||
      subject.units ||
      [];

    const topic =
      topics.find(item => {
        const value =
          String(
            item.id ||
            item.name ||
            item.title ||
            ""
          ).toLowerCase();

        return (
          value ===
          req.params.topic.toLowerCase()
        );
      });

    if (!topic) {
      return res.status(404).json({
        success: false,
        message: "Topic not found."
      });
    }

    res.json({
      success: true,
      subject: subject.name,
      topic
    });
  }
);

// ---------------------------------------------------------
// COURSES
// ---------------------------------------------------------

app.get("/api/courses", (req, res) => {
  res.json({
    success: true,
    courses: COURSES
  });
});

app.get(
  "/api/courses/:id/access",
  requireUser,
  (req, res) => {
    if (req.user.role === "creator") {
      return res.json({
        success: true,
        access: true,
        creator: true
      });
    }

    const enrolment =
      db.prepare(`
        SELECT *
        FROM course_enrolments
        WHERE user_id = ?
        AND course_id = ?
        AND status = 'active'
      `).get(
        req.user.id,
        req.params.id
      );

    res.json({
      success: true,
      access: Boolean(enrolment),
      enrolment: enrolment || null
    });
  }
);

// ---------------------------------------------------------
// PAYSTACK INITIALISATION
// ---------------------------------------------------------

async function initialisePaystackPayment({
  email,
  amount,
  reference,
  callbackUrl
}) {
  const secret =
    process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured on the server."
    );
  }

  const response =
    await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          email,
          amount: amount * 100,
          currency: "GHS",
          reference,
          callback_url: callbackUrl
        })
      }
    );

  const data =
    await response.json();

  if (!response.ok || !data.status) {
    throw new Error(
      data.message ||
        "Payment initialization failed."
    );
  }

  return data.data;
}

// ---------------------------------------------------------
// COURSE PAYMENT
// ---------------------------------------------------------

app.post(
  "/api/payments/course",
  requireUser,
  async (req, res) => {
    try {
      const course =
        findCourse(req.body.courseId);

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found."
        });
      }

      if (req.user.role === "creator") {
        db.prepare(`
          INSERT OR IGNORE INTO course_enrolments
          (user_id, course_id, status)
          VALUES (?, ?, 'active')
        `).run(
          req.user.id,
          course.id
        );

        return res.json({
          success: true,
          enrolled: true,
          creator: true
        });
      }

      const existing =
        db.prepare(`
          SELECT *
          FROM course_enrolments
          WHERE user_id = ?
          AND course_id = ?
          AND status = 'active'
        `).get(
          req.user.id,
          course.id
        );

      if (existing) {
        return res.json({
          success: true,
          enrolled: true
        });
      }

      const reference =
        `PASSCOGH-${crypto.randomUUID()}`;

      db.prepare(`
        INSERT INTO payments
        (reference, user_id, item_type, item_id, amount)
        VALUES (?, ?, 'course', ?, ?)
      `).run(
        reference,
        req.user.id,
        course.id,
        course.price
      );

      const baseUrl =
        process.env.PUBLIC_BASE_URL ||
        `${req.protocol}://${req.get("host")}`;

      const payment =
        await initialisePaystackPayment({
          email: req.user.email,
          amount: course.price,
          reference,
          callbackUrl:
            `${baseUrl}/payment/callback`
        });

      res.json({
        success: true,
        paymentRequired: true,
        authorizationUrl:
          payment.authorization_url,
        reference
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ---------------------------------------------------------
// PDF LIBRARY
// ---------------------------------------------------------

app.get("/api/pdfs", (req, res) => {
  res.json({
    success: true,
    pdfs: PDFS.map(pdf => ({
      id: pdf.id,
      title: pdf.title,
      price: pdf.price,
      onlineReading: true,
      paidDownload: true
    }))
  });
});

// ---------------------------------------------------------
// FREE ONLINE READING
// ---------------------------------------------------------

app.post(
  "/api/reading/start",
  requireUser,
  (req, res) => {
    const pdf =
      findPdf(req.body.pdfId);

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "PDF not found."
      });
    }

    const expires =
      new Date(
        Date.now() +
          30 * 60 * 1000
      ).toISOString();

    db.prepare(`
      INSERT INTO reading_sessions
      (user_id, pdf_id, expires_at)
      VALUES (?, ?, ?)
    `).run(
      req.user.id,
      pdf.id,
      expires
    );

    res.json({
      success: true,
      readingSessionStarted: true,
      advertisementsEnabled:
        req.user.role !== "creator",
      expiresAt: expires
    });
  }
);

// ---------------------------------------------------------
// CHECK PAID DOWNLOAD ACCESS
// ---------------------------------------------------------

app.get(
  "/api/pdfs/:id/download-access",
  requireUser,
  (req, res) => {
    const pdf =
      findPdf(req.params.id);

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

    const purchase =
      db.prepare(`
        SELECT *
        FROM pdf_purchases
        WHERE user_id = ?
        AND pdf_id = ?
      `).get(
        req.user.id,
        pdf.id
      );

    res.json({
      success: true,
      allowed: Boolean(purchase)
    });
  }
);

// ---------------------------------------------------------
// PDF PAYMENT
// ---------------------------------------------------------

app.post(
  "/api/payments/pdf",
  requireUser,
  async (req, res) => {
    try {
      const pdf =
        findPdf(req.body.pdfId);

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

      const existing =
        db.prepare(`
          SELECT *
          FROM pdf_purchases
          WHERE user_id = ?
          AND pdf_id = ?
        `).get(
          req.user.id,
          pdf.id
        );

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
        (reference, user_id, item_type, item_id, amount)
        VALUES (?, ?, 'pdf', ?, ?)
      `).run(
        reference,
        req.user.id,
        pdf.id,
        pdf.price
      );

      const baseUrl =
        process.env.PUBLIC_BASE_URL ||
        `${req.protocol}://${req.get("host")}`;

      const payment =
        await initialisePaystackPayment({
          email: req.user.email,
          amount: pdf.price,
          reference,
          callbackUrl:
            `${baseUrl}/payment/callback`
        });

      res.json({
        success: true,
        paymentRequired: true,
        authorizationUrl:
          payment.authorization_url,
        reference
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ---------------------------------------------------------
// VERIFY PAYSTACK PAYMENT
// ---------------------------------------------------------

app.get(
  "/api/payments/verify/:reference",
  requireUser,
  async (req, res) => {
    try {
      const secret =
        process.env.PAYSTACK_SECRET_KEY;

      if (!secret) {
        return res.status(503).json({
          success: false,
          message:
            "Payment provider is not configured."
        });
      }

      const reference =
        req.params.reference;

      const payment =
        db.prepare(`
          SELECT *
          FROM payments
          WHERE reference = ?
          AND user_id = ?
        `).get(
          reference,
          req.user.id
        );

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Payment record not found."
        });
      }

      const response =
        await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          {
            headers: {
              Authorization:
                `Bearer ${secret}`
            }
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.status ||
        !data.data
      ) {
        return res.status(400).json({
          success: false,
          message:
            data.message ||
            "Could not verify payment."
        });
      }

      const transaction =
        data.data;

      const expectedAmount =
        payment.amount * 100;

      if (
        transaction.status !== "success" ||
        transaction.currency !== "GHS" ||
        Number(transaction.amount) !==
          expectedAmount
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Payment verification failed."
        });
      }

      db.prepare(`
        UPDATE payments
        SET status = 'success',
            verified_at = CURRENT_TIMESTAMP
        WHERE reference = ?
      `).run(reference);

      if (payment.item_type === "course") {

        db.prepare(`
          INSERT OR IGNORE INTO course_enrolments
          (user_id, course_id, status)
          VALUES (?, ?, 'active')
        `).run(
          payment.user_id,
          payment.item_id
        );
      }

      if (payment.item_type === "pdf") {

        db.prepare(`
          INSERT OR IGNORE INTO pdf_purchases
          (user_id, pdf_id, payment_reference)
          VALUES (?, ?, ?)
        `).run(
          payment.user_id,
          payment.item_id,
          reference
        );
      }

      res.json({
        success: true,
        verified: true,
        itemType:
          payment.item_type,
        itemId:
          payment.item_id
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Payment verification error."
      });
    }
  }
);

// ---------------------------------------------------------
// PAYMENT CALLBACK
// ---------------------------------------------------------

app.get(
  "/payment/callback",
  (req, res) => {
    const reference =
      req.query.reference;

    if (!reference) {
      return res.status(400).send(
        "Payment reference is missing."
      );
    }

    res.send(`
      <!doctype html>
      <html>
      <head>
        <meta name="viewport"
              content="width=device-width,initial-scale=1">
        <title>PASSCOGH-MODOO Payment</title>
      </head>
      <body style="font-family:system-ui;padding:30px;text-align:center">
        <h2>Payment received</h2>
        <p>Your payment is being verified.</p>
        <p>You may return to PASSCOGH-MODOO.</p>
      </body>
      </html>
    `);
  }
);

// ---------------------------------------------------------
// SECURE PDF DOWNLOAD
// ---------------------------------------------------------

app.get(
  "/api/pdfs/:id/download",
  requireUser,
  (req, res) => {
    const pdf =
      findPdf(req.params.id);

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "PDF not found."
      });
    }

    if (req.user.role !== "creator") {

      const purchase =
        db.prepare(`
          SELECT *
          FROM pdf_purchases
          WHERE user_id = ?
          AND pdf_id = ?
        `).get(
          req.user.id,
          pdf.id
        );

      if (!purchase) {
        return res.status(403).json({
          success: false,
          message:
            "Paid download access is required."
        });
      }
    }

    const filePath =
      path.join(
        PDF_DIR,
        pdf.filename
      );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message:
          "The protected PDF file has not been uploaded yet."
      });
    }

    res.download(
      filePath,
      pdf.filename
    );
  }
);

// ---------------------------------------------------------
// COURSE PROGRESS
// ---------------------------------------------------------

app.post(
  "/api/courses/:id/progress",
  requireUser,
  (req, res) => {
    const course =
      findCourse(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found."
      });
    }

    if (req.user.role !== "creator") {

      const access =
        db.prepare(`
          SELECT *
          FROM course_enrolments
          WHERE user_id = ?
          AND course_id = ?
          AND status = 'active'
        `).get(
          req.user.id,
          course.id
        );

      if (!access) {
        return res.status(403).json({
          success: false,
          message:
            "You must be enrolled first."
        });
      }
    }

    let progress =
      Number(req.body.progress);

    if (
      !Number.isFinite(progress) ||
      progress < 0 ||
      progress > 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Progress must be between 0 and 100."
      });
    }

    progress =
      Math.round(progress);

    db.prepare(`
      INSERT INTO course_enrolments
      (user_id, course_id, progress, status)
      VALUES (?, ?, ?, 'active')
      ON CONFLICT(user_id, course_id)
      DO UPDATE SET
        progress = excluded.progress
    `).run(
      req.user.id,
      course.id,
      progress
    );

    res.json({
      success: true,
      progress
    });
  }
);

// ---------------------------------------------------------
// CERTIFICATE
// ---------------------------------------------------------

app.post(
  "/api/courses/:id/certificate",
  requireUser,
  (req, res) => {
    const course =
      findCourse(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found."
      });
    }

    const enrolment =
      db.prepare(`
        SELECT *
        FROM course_enrolments
        WHERE user_id = ?
        AND course_id = ?
        AND status = 'active'
      `).get(
        req.user.id,
        course.id
      );

    if (
      req.user.role !== "creator" &&
      (!enrolment ||
        enrolment.progress < 100)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Complete the course before requesting a certificate."
      });
    }

    const existing =
      db.prepare(`
        SELECT *
        FROM certificates
        WHERE user_id = ?
        AND course_id = ?
      `).get(
        req.user.id,
        course.id
      );

    if (existing) {
      return res.json({
        success: true,
        certificate: existing
      });
    }

    const certificateNo =
      `PASSCOGH-${new Date().getFullYear()}-${crypto
        .randomBytes(5)
        .toString("hex")
        .toUpperCase()}`;

    const result =
      db.prepare(`
        INSERT INTO certificates
        (certificate_no, user_id, course_id)
        VALUES (?, ?, ?)
      `).run(
        certificateNo,
        req.user.id,
        course.id
      );

    const certificate =
      db.prepare(`
        SELECT *
        FROM certificates
        WHERE id = ?
      `).get(result.lastInsertRowid);

    res.json({
      success: true,
      certificate
    });
  }
);

// ---------------------------------------------------------
// CERTIFICATE VERIFICATION
// ---------------------------------------------------------

app.get(
  "/api/certificates/:certificateNo",
  (req, res) => {
    const certificate =
      db.prepare(`
        SELECT
          certificates.certificate_no,
          certificates.issued_at,
          users.name,
          users.email,
          course_enrolments.course_id
        FROM certificates
        JOIN users
          ON users.id = certificates.user_id
        LEFT JOIN course_enrolments
          ON course_enrolments.user_id =
             certificates.user_id
         AND course_enrolments.course_id =
             certificates.course_id
        WHERE certificates.certificate_no = ?
      `).get(
        req.params.certificateNo
      );

    if (!certificate) {
      return res.status(404).json({
        success: false,
        valid: false,
        message:
          "Certificate not found."
      });
    }

    res.json({
      success: true,
      valid: true,
      certificate
    });
  }
);

// ---------------------------------------------------------
// CREATOR ACCESS
// ---------------------------------------------------------

app.get(
  "/api/creator/access",
  requireCreator,
  (req, res) => {
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
  }
);

// ---------------------------------------------------------
// CREATOR DASHBOARD DATA
// ---------------------------------------------------------

app.get(
  "/api/creator/dashboard",
  requireCreator,
  (req, res) => {
    const users =
      db.prepare(
        "SELECT COUNT(*) AS count FROM users"
      ).get().count;

    const enrolments =
      db.prepare(
        "SELECT COUNT(*) AS count FROM course_enrolments"
      ).get().count;

    const payments =
      db.prepare(
        "SELECT COUNT(*) AS count FROM payments WHERE status='success'"
      ).get().count;

    const certificates =
      db.prepare(
        "SELECT COUNT(*) AS count FROM certificates"
      ).get().count;

    res.json({
      success: true,
      users,
      enrolments,
      successfulPayments: payments,
      certificates,
      curriculumFile:
        fs.existsSync(CURRICULUM_FILE)
    });
  }
);

// ---------------------------------------------------------
// STATIC WEBSITE
// ---------------------------------------------------------

app.use(
  express.static(PUBLIC_DIR)
);

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      PUBLIC_DIR,
      "index.html"
    )
  );
});

// ---------------------------------------------------------
// ERROR HANDLER
// ---------------------------------------------------------

app.use(
  (error, req, res, next) => {
    console.error(error);

    res.status(500).json({
      success: false,
      message:
        "PASSCOGH-MODOO server error."
    });
  }
);

// ---------------------------------------------------------
// START
// ---------------------------------------------------------

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `PASSCOGH-MODOO running on port ${PORT}`
    );

    console.log(
      `Curriculum file: ${
        fs.existsSync(CURRICULUM_FILE)
          ? "FOUND"
          : "MISSING"
      }`
    );

    console.log(
      `Paystack: ${
        process.env.PAYSTACK_SECRET_KEY
          ? "CONFIGURED"
          : "NOT CONFIGURED"
      }`
    );
  }
);
