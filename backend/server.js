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

/* =========================================================
   PASSCOGH-MODOO PATHS
   Expected project structure:
   project/
     public/index.html
     data/passcogh_curriculum.json
     data/passcogh.sqlite (created automatically)
     storage/pdfs/...
     server/server.js   OR server.js at project root
   ========================================================= */

const PUBLIC_DIR = path.join(__dirname, "../public");
const DATA_DIR = path.join(__dirname, "../data");
const STORAGE_DIR = path.join(__dirname, "../storage");
const PDF_DIR = path.join(STORAGE_DIR, "pdfs");
const CURRICULUM_FILE = path.join(DATA_DIR, "passcogh_curriculum.json");

/* If server.js is placed at the project root, use ./public and ./data. */
const ROOT_PUBLIC_DIR = path.join(__dirname, "public");
const ROOT_DATA_DIR = path.join(__dirname, "data");

const resolvedPublicDir = fs.existsSync(ROOT_PUBLIC_DIR) ? ROOT_PUBLIC_DIR : PUBLIC_DIR;
const resolvedDataDir = fs.existsSync(ROOT_DATA_DIR) ? ROOT_DATA_DIR : DATA_DIR;
const resolvedStorageDir = fs.existsSync(path.join(__dirname, "storage"))
  ? path.join(__dirname, "storage")
  : STORAGE_DIR;
const resolvedPdfDir = path.join(resolvedStorageDir, "pdfs");
const resolvedCurriculumFile = path.join(resolvedDataDir, "passcogh_curriculum.json");

for (const dir of [resolvedDataDir, resolvedStorageDir, resolvedPdfDir]) {
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

const db = new Database(path.join(resolvedDataDir, "passcogh.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'learner' CHECK(role IN ('learner','creator')),
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
const READING_MINUTES = 30;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSession(userId) {
  const rawToken = crypto.randomBytes(48).toString("hex");
  db.prepare(`
    INSERT INTO sessions(token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(hashToken(rawToken), userId, Date.now() + SESSION_DAYS * 86400000);
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
  return db.prepare(`
    SELECT users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) || null;
}

function requireUser(req, res, next) {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  req.user = user;
  next();
}

function requireCreator(req, res, next) {
  const user = getRequestUser(req);
  if (!user || user.role !== "creator") {
    return res.status(403).json({ success: false, message: "Creator access denied." });
  }
  req.user = user;
  next();
}

function safeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function safeId(value) {
  return String(value || "").trim().toLowerCase();
}

/* =========================================================
   CURRICULUM — MATCHES PASSCOGH-MODOO-Curriculum-v2
   levels is an ARRAY in v2. We also tolerate an object for
   older files so the server cannot collapse to Levels 0.
   ========================================================= */

function loadCurriculum() {
  if (!fs.existsSync(resolvedCurriculumFile)) {
    return {
      platform: "PASSCOGH-MODOO",
      version: "unknown",
      error: `Curriculum file not found: ${path.basename(resolvedCurriculumFile)}`,
      levels: []
    };
  }

  try {
    return JSON.parse(fs.readFileSync(resolvedCurriculumFile, "utf8"));
  } catch (error) {
    console.error("Curriculum JSON error:", error);
    return {
      platform: "PASSCOGH-MODOO",
      version: "unknown",
      error: "Curriculum JSON could not be read.",
      levels: []
    };
  }
}

function getLevels() {
  const curriculum = loadCurriculum();
  if (Array.isArray(curriculum.levels)) return curriculum.levels;
  if (curriculum.levels && typeof curriculum.levels === "object") {
    return Object.entries(curriculum.levels).map(([id, level]) => ({
      id,
      ...(level || {}),
      name: level?.name || id
    }));
  }
  if (Array.isArray(curriculum)) return curriculum;
  return [];
}

function getLevelByQuery(value) {
  const query = safeId(value);
  return getLevels().find(level =>
    safeId(level.id) === query || safeId(level.name) === query
  ) || null;
}

function getSubjectsForLevel(level) {
  if (!level || typeof level !== "object") return [];
  if (Array.isArray(level.subjects)) return level.subjects;
  if (Array.isArray(level.courses)) return level.courses;
  return [];
}

function getAllSubjects() {
  const subjects = [];
  for (const level of getLevels()) {
    for (const subject of getSubjectsForLevel(level)) {
      subjects.push({
        ...subject,
        level: subject.level || level.name || level.id || ""
      });
    }
  }
  return subjects;
}

function getTopicsForSubject(subject) {
  if (!subject || typeof subject !== "object") return [];
  if (Array.isArray(subject.topics)) return subject.topics;
  if (Array.isArray(subject.units)) return subject.units;
  return [];
}

function findSubject(value, levelValue = null) {
  const query = safeId(value);
  const pool = levelValue ? getSubjectsForLevel(getLevelByQuery(levelValue)) : getAllSubjects();
  return pool.find(subject => {
    const id = safeId(subject.id || subject.code);
    const name = safeId(subject.name || subject.title);
    return id === query || name === query;
  }) || null;
}

function findTopic(subject, value) {
  const query = safeId(value);
  return getTopicsForSubject(subject).find(topic => {
    const id = safeId(topic.id);
    const name = safeId(topic.name || topic.title || topic.topic);
    return id === query || name === query;
  }) || null;
}

function getTopicLesson(topic) {
  return topic?.lesson || topic?.content || topic?.notes || null;
}

/* =========================================================
   COURSES — skills path preserved from curriculum v2
   ========================================================= */

const DEFAULT_COURSES = [
  { id: "coding-programming", title: "Coding & Programming", description: "Learn programming foundations and practical coding.", price: 20, currency: "GHS", certificateEnabled: true, published: true },
  { id: "web-development", title: "Web Development", description: "Build websites using HTML, CSS and JavaScript.", price: 20, currency: "GHS", certificateEnabled: true, published: true },
  { id: "digital-skills", title: "Digital Skills", description: "Practical digital skills for school, work and life.", price: 20, currency: "GHS", certificateEnabled: true, published: true },
  { id: "data-excel", title: "Data & Excel", description: "Learn spreadsheets, formulas and useful data skills.", price: 20, currency: "GHS", certificateEnabled: true, published: true },
  { id: "graphic-design", title: "Graphic Design", description: "Learn practical design principles and digital graphics.", price: 20, currency: "GHS", certificateEnabled: true, published: true },
  { id: "entrepreneurship", title: "Entrepreneurship", description: "Learn business ideas, planning and practical entrepreneurship.", price: 20, currency: "GHS", certificateEnabled: true, published: true },
  { id: "digital-marketing", title: "Digital Marketing", description: "Learn practical online marketing and audience growth.", price: 20, currency: "GHS", certificateEnabled: true, published: true },
  { id: "ai-productivity", title: "AI & Productivity", description: "Learn responsible AI use and productivity techniques.", price: 20, currency: "GHS", certificateEnabled: true, published: true }
];

function getCourses() {
  const curriculum = loadCurriculum();
  const paths = curriculum?.skills_path?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return DEFAULT_COURSES;

  return paths.map(pathItem => {
    const existing = DEFAULT_COURSES.find(c => c.id === pathItem.id);
    return {
      ...(existing || {
        id: pathItem.id,
        title: pathItem.name || pathItem.id,
        description: "PASSCOGH-MODOO practical skills pathway.",
        price: 20,
        currency: "GHS",
        certificateEnabled: true,
        published: true
      }),
      title: pathItem.name || existing?.title || pathItem.id,
      skills: Array.isArray(pathItem.skills) ? pathItem.skills : []
    };
  });
}

function findCourse(id) {
  const value = safeId(id);
  return getCourses().find(course =>
    safeId(course.id) === value || safeId(course.title) === value
  ) || null;
}

/* =========================================================
   PDF CATALOGUE — curriculum v2 lists 7 catalogue items.
   Metadata can be overridden by environment/JSON later.
   ========================================================= */

const PDFS = [
  { id: "jhs-1-pdf", title: "JHS 1 PDF", filename: "jhs-1.pdf", price: 5, currency: "GHS" },
  { id: "jhs-2-pdf", title: "JHS 2 PDF", filename: "jhs-2.pdf", price: 5, currency: "GHS" },
  { id: "jhs-3-pdf", title: "JHS 3 PDF", filename: "jhs-3.pdf", price: 5, currency: "GHS" },
  { id: "shs-1-pdf", title: "SHS 1 PDF", filename: "shs-1.pdf", price: 5, currency: "GHS" },
  { id: "shs-2-pdf", title: "SHS 2 PDF", filename: "shs-2.pdf", price: 5, currency: "GHS" },
  { id: "shs-3-pdf", title: "SHS 3 PDF", filename: "shs-3.pdf", price: 5, currency: "GHS" },
  { id: "university-course-guide-pdf", title: "University & Course Guide PDF", filename: "university-course-guide.pdf", price: 5, currency: "GHS" }
];

function getPDFs() {
  const curriculum = loadCurriculum();
  const items = curriculum?.pdf_catalogue?.items;
  if (!Array.isArray(items)) return PDFS;
  return items.map((title, index) => {
    const id = safeId(title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `pdf-${index + 1}`;
    const existing = PDFS.find(pdf => safeId(pdf.title) === safeId(title));
    return existing || {
      id,
      title,
      filename: `${id}.pdf`,
      price: 5,
      currency: "GHS"
    };
  });
}

function findPdf(id) {
  const value = safeId(id);
  return getPDFs().find(pdf => safeId(pdf.id) === value || safeId(pdf.title) === value) || null;
}

/* =========================================================
   AUTHENTICATION
   ========================================================= */

app.post("/api/auth/register", (req, res) => {
  try {
    const email = safeEmail(req.body.email);
    const name = String(req.body.name || "").trim();
    if (!email) return res.status(400).json({ success: false, message: "Enter a valid email address." });
    if (!name) return res.status(400).json({ success: false, message: "Name is required." });

    const role = email === CREATOR_EMAIL ? "creator" : "learner";
    db.prepare(`INSERT INTO users(email,name,role) VALUES (?,?,?)`).run(email, name, role);
    const user = db.prepare(`SELECT id,email,name,role,created_at FROM users WHERE email=?`).get(email);
    const token = createSession(user.id);
    res.status(201).json({ success: true, user, token });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ success: false, message: "An account with that email already exists." });
    }
    console.error(error);
    res.status(500).json({ success: false, message: "Registration failed." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = safeEmail(req.body.email);
  if (!email) return res.status(400).json({ success: false, message: "Enter a valid email address." });
  const user = db.prepare(`SELECT id,email,name,role,created_at FROM users WHERE email=?`).get(email);
  if (!user) return res.status(401).json({ success: false, message: "Account not found. Please register first." });
  const token = createSession(user.id);
  res.json({ success: true, user, token });
});

app.post("/api/auth/logout", requireUser, (req, res) => {
  const token = getBearerToken(req);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
  res.json({ success: true, message: "Logged out." });
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
   HEALTH / DIAGNOSTICS
   ========================================================= */

app.get("/api/health", (req, res) => {
  const curriculum = loadCurriculum();
  const levels = getLevels();
  const subjects = getAllSubjects();
  const courses = getCourses();
  const pdfs = getPDFs();

  res.json({
    success: true,
    message: "PASSCOGH-MODOO backend is running",
    version: curriculum.version || "unknown",
    curriculumFile: path.basename(resolvedCurriculumFile),
    curriculumFileExists: fs.existsSync(resolvedCurriculumFile),
    curriculumShape: Array.isArray(curriculum.levels) ? "levels[]" : typeof curriculum.levels,
    levels: levels.length,
    subjects: subjects.length,
    shsSubjectsPerLevel: levels.filter(l => /^shs\s*[123]$/i.test(String(l.name || ""))).map(l => ({ level: l.name, subjects: getSubjectsForLevel(l).length })),
    courses: courses.length,
    pdfs: pdfs.length,
    skillsPath: Boolean(curriculum.skills_path?.enabled),
    universityGuidance: Boolean(curriculum.university_guidance?.enabled),
    formulaSummaries: Boolean(curriculum.platform_features?.formula_summaries),
    realLifeApplications: Boolean(curriculum.platform_features?.real_life_applications),
    paymentProvider: process.env.PAYSTACK_SECRET_KEY ? "configured" : "not_configured"
  });
});

/* =========================================================
   CURRICULUM API
   ========================================================= */

app.get("/api/curriculum", (req, res) => res.json({ success: true, curriculum: loadCurriculum() }));
app.get("/api/levels", (req, res) => res.json({ success: true, levels: getLevels() }));

app.get("/api/levels/:level", (req, res) => {
  const level = getLevelByQuery(req.params.level);
  if (!level) return res.status(404).json({ success: false, message: "Level not found." });
  res.json({ success: true, level, subjects: getSubjectsForLevel(level) });
});

app.get("/api/levels/:level/subjects", (req, res) => {
  const level = getLevelByQuery(req.params.level);
  if (!level) return res.status(404).json({ success: false, message: "Level not found." });
  res.json({ success: true, level: level.name || level.id, subjects: getSubjectsForLevel(level) });
});

app.get("/api/subjects", (req, res) => res.json({ success: true, subjects: getAllSubjects() }));

app.get("/api/subjects/:subject", (req, res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  if (!subject) return res.status(404).json({ success: false, message: "Subject not found." });
  res.json({ success: true, subject });
});

app.get("/api/subjects/:subject/topics", (req, res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  if (!subject) return res.status(404).json({ success: false, message: "Subject not found." });
  res.json({ success: true, subject: subject.name || subject.title, topics: getTopicsForSubject(subject) });
});

app.get("/api/subjects/:subject/topics/:topic", (req, res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  if (!subject) return res.status(404).json({ success: false, message: "Subject not found." });
  const topic = findTopic(subject, req.params.topic);
  if (!topic) return res.status(404).json({ success: false, message: "Topic not found." });
  res.json({ success: true, subject: subject.name || subject.title, topic, lesson: getTopicLesson(topic) });
});

/* =========================================================
   TOPIC LEARNING LAYER
   ========================================================= */

app.get("/api/learning/topic", (req, res) => {
  const subject = findSubject(req.query.subject, req.query.level || null);
  if (!subject) return res.status(404).json({ success: false, message: "Subject not found." });
  const topic = findTopic(subject, req.query.topic);
  if (!topic) return res.status(404).json({ success: false, message: "Topic not found." });

  const lesson = topic.lesson || {};
  res.json({
    success: true,
    subject: subject.name || subject.title,
    topic: topic.title || topic.name || topic.topic,
    lesson,
    real_life_application: lesson.real_life_application || topic.real_life_application || "",
    formula_summary: lesson.formula_summary || topic.formula_summary || [],
    memory_aid: lesson.memory_aid || topic.memory_aid || "",
    diagram: lesson.diagram || topic.diagram || "",
    examples: lesson.examples || [],
    practice: lesson.practice || [],
    answers: lesson.answers || []
  });
});

/* =========================================================
   QUESTIONS / PRACTICAL / EXAM GUIDE
   ========================================================= */

app.get("/api/questions", (req, res) => {
  const c = loadCurriculum();
  res.json({ success: true, questions: Array.isArray(c.questions) ? c.questions : Array.isArray(c.questionBank) ? c.questionBank : [] });
});

app.get("/api/past-questions", (req, res) => {
  const c = loadCurriculum();
  res.json({ success: true, pastQuestions: Array.isArray(c.pastQuestions) ? c.pastQuestions : [] });
});

app.get("/api/practical", (req, res) => {
  const c = loadCurriculum();
  res.json({ success: true, practical: Array.isArray(c.practical) ? c.practical : Array.isArray(c.practicalPreparation) ? c.practicalPreparation : [] });
});

app.get("/api/exam-guides", (req, res) => {
  const c = loadCurriculum();
  res.json({ success: true, examGuides: Array.isArray(c.examGuides) ? c.examGuides : [] });
});

app.get("/api/assessment", (req, res) => {
  const c = loadCurriculum();
  res.json({ success: true, assessmentSystem: c.assessment_system || {} });
});

/* =========================================================
   SKILLS PATH
   ========================================================= */

app.get("/api/skills-path", (req, res) => {
  const c = loadCurriculum();
  res.json({ success: true, skillsPath: c.skills_path || { enabled: false, paths: [] } });
});

app.get("/api/skills-path/:id", (req, res) => {
  const c = loadCurriculum();
  const paths = Array.isArray(c?.skills_path?.paths) ? c.skills_path.paths : [];
  const item = paths.find(p => safeId(p.id) === safeId(req.params.id) || safeId(p.name) === safeId(req.params.id));
  if (!item) return res.status(404).json({ success: false, message: "Skills path not found." });
  res.json({ success: true, path: item });
});

/* =========================================================
   UNIVERSITY & COURSE GUIDANCE
   The curriculum provides the rules and input fields. Actual
   institution ranking data must come from a maintained dataset.
   This API supports data files without inventing rankings.
   ========================================================= */

function loadInstitutionData() {
  const candidates = [
    path.join(resolvedDataDir, "institution.json"),
    path.join(resolvedDataDir, "institutions.json"),
    path.join(resolvedDataDir, "universities.json")
  ];

  const file = candidates.find(fs.existsSync);
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.institutions)) return parsed.institutions;
    if (Array.isArray(parsed.universities)) return parsed.universities;
    return [];
  } catch (error) {
    console.error("Institution data error:", error);
    return [];
  }
}

function normalizeResults(results) {
  if (!results || typeof results !== "object") return {};
  const output = {};
  for (const [key, value] of Object.entries(results)) {
    const n = Number(value);
    output[safeId(key)] = Number.isFinite(n) ? n : value;
  }
  return output;
}

function resultMatchesRequirement(result, requirement) {
  if (requirement == null) return false;
  if (typeof requirement === "string") return safeId(result) === safeId(requirement);
  if (typeof requirement === "number") return Number.isFinite(Number(result)) && Number(result) <= requirement;
  if (typeof requirement === "object") {
    const grade = safeId(result);
    if (Array.isArray(requirement.accepted)) return requirement.accepted.map(safeId).includes(grade);
    if (requirement.maxAggregate != null) return Number(result) <= Number(requirement.maxAggregate);
    if (requirement.minScore != null) return Number(result) >= Number(requirement.minScore);
  }
  return false;
}

function recommendationScore(program, results, preferences) {
  let score = 0;
  const reasons = [];
  const normalized = normalizeResults(results);

  const requirements = program.requirements || program.subjectRequirements || {};
  if (Array.isArray(program.requiredSubjects)) {
    for (const subject of program.requiredSubjects) {
      const value = normalized[safeId(subject)];
      if (value != null) { score += 20; reasons.push(`Result supplied for ${subject}.`); }
    }
  }
  if (requirements && typeof requirements === "object" && !Array.isArray(requirements)) {
    for (const [subject, requirement] of Object.entries(requirements)) {
      const value = normalized[safeId(subject)];
      if (value != null && resultMatchesRequirement(value, requirement)) {
        score += 30;
        reasons.push(`${subject} meets the stated requirement.`);
      } else if (value != null) {
        score -= 40;
        reasons.push(`${subject} may not meet the stated requirement.`);
      }
    }
  }

  const career = safeId(preferences?.career || preferences?.preferredCareer || "");
  const interests = Array.isArray(preferences?.programmeInterests) ? preferences.programmeInterests.map(safeId) : [];
  const tags = [
    ...(Array.isArray(program.careerAlignment) ? program.careerAlignment : []),
    ...(Array.isArray(program.careers) ? program.careers : []),
    ...(Array.isArray(program.tags) ? program.tags : [])
  ].map(safeId);

  if (career && tags.some(t => t.includes(career) || career.includes(t))) {
    score += 30;
    reasons.push("Programme aligns with the stated career interest.");
  }
  if (interests.some(i => tags.some(t => t.includes(i) || i.includes(t)))) {
    score += 20;
    reasons.push("Programme aligns with a stated programme interest.");
  }

  const region = safeId(preferences?.region || preferences?.preferredRegion || "");
  if (region) {
    const locations = [program.region, program.location, ...(Array.isArray(program.regions) ? program.regions : [])].map(safeId);
    if (locations.some(x => x.includes(region) || region.includes(x))) {
      score += 15;
      reasons.push("Location preference matches.");
    }
  }

  const work = safeId(preferences?.workNeeds || preferences?.outsideJobNeeds || "");
  if (work) {
    const flexibility = safeId(program.studyWorkFlexibility || program.flexibility || "");
    if (flexibility.includes("flex") || flexibility.includes(work)) {
      score += 15;
      reasons.push("Study/work flexibility matches the stated need.");
    }
  }

  return { score, reasons };
}

app.get("/api/university-guidance", (req, res) => {
  const c = loadCurriculum();
  res.json({
    success: true,
    guidance: c.university_guidance || { enabled: false },
    institutions: loadInstitutionData()
  });
});

app.get("/api/universities", (req, res) => {
  const institutions = loadInstitutionData();
  res.json({
    success: true,
    rankingDataAvailable: institutions.length > 0,
    institutions,
    message: institutions.length ? "Institution dataset loaded." : "No maintained institution dataset is installed yet; no rankings are invented."
  });
});

app.post("/api/university-guidance/recommend", (req, res) => {
  const c = loadCurriculum();
  const guidance = c.university_guidance || {};
  const results = req.body.results || req.body.wassceResults || {};
  const preferences = req.body.preferences || req.body;
  const institutions = loadInstitutionData();
  const programs = [];

  for (const institution of institutions) {
    const list = Array.isArray(institution.programmes)
      ? institution.programmes
      : Array.isArray(institution.programs)
        ? institution.programs
        : [];
    for (const program of list) {
      const match = recommendationScore(program, results, preferences);
      programs.push({
        institution: institution.name || institution.title || "",
        institutionData: institution,
        programme: program,
        score: match.score,
        reasons: match.reasons
      });
    }
  }

  programs.sort((a, b) => b.score - a.score);
  res.json({
    success: true,
    guidance,
    rankingDataAvailable: institutions.length > 0,
    recommendations: programs.slice(0, 50),
    message: institutions.length
      ? "Recommendations generated from the installed institution/programme dataset."
      : "The curriculum guidance system is active, but institution/programme data must be supplied before specific rankings or eligibility claims can be shown."
  });
});

/* =========================================================
   COURSES
   ========================================================= */

app.get("/api/courses", (req, res) => res.json({ success: true, courses: getCourses().filter(c => c.published !== false) }));

app.get("/api/courses/:id/access", requireUser, (req, res) => {
  const course = findCourse(req.params.id);
  if (!course) return res.status(404).json({ success: false, message: "Course not found." });
  if (req.user.role === "creator") return res.json({ success: true, access: true, creator: true });
  const enrolment = db.prepare(`SELECT * FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'`).get(req.user.id, course.id);
  res.json({ success: true, access: Boolean(enrolment), enrolment: enrolment || null });
});

app.get("/api/enrolments", requireUser, (req, res) => {
  res.json({ success: true, enrolments: db.prepare(`SELECT * FROM course_enrolments WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id) });
});

/* =========================================================
   PAYSTACK
   ========================================================= */

async function initialisePaystackPayment({ email, amount, reference, callbackUrl }) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not configured on the server.");

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      amount: Math.round(Number(amount) * 100),
      currency: "GHS",
      reference,
      callback_url: callbackUrl
    })
  });
  const data = await response.json();
  if (!response.ok || !data.status) throw new Error(data.message || "Payment initialization failed.");
  return data.data;
}

async function verifyPaystack(reference) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const data = await response.json();
  if (!response.ok || !data.status || !data.data) throw new Error(data.message || "Could not verify payment.");
  return data.data;
}

function baseUrl(req) {
  return String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

/* =========================================================
   COURSE PAYMENT
   ========================================================= */

app.post("/api/payments/course", requireUser, async (req, res) => {
  try {
    const course = findCourse(req.body.courseId);
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });

    if (req.user.role === "creator") {
      db.prepare(`INSERT INTO course_enrolments(user_id,course_id,status) VALUES (?,?,'active') ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`).run(req.user.id, course.id);
      return res.json({ success: true, enrolled: true, creator: true });
    }

    const existing = db.prepare(`SELECT * FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'`).get(req.user.id, course.id);
    if (existing) return res.json({ success: true, enrolled: true });

    const reference = `PASSCOGH-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO payments(reference,user_id,item_type,item_id,amount,currency) VALUES (?,?,'course',?,?,'GHS')`).run(reference, req.user.id, course.id, course.price);

    const payment = await initialisePaystackPayment({
      email: req.user.email,
      amount: course.price,
      reference,
      callbackUrl: `${baseUrl(req)}/payment/callback`
    });

    res.json({ success: true, paymentRequired: true, authorizationUrl: payment.authorization_url, accessCode: payment.access_code, reference });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message || "Course payment failed." });
  }
});

/* =========================================================
   PDF MATERIALS
   ========================================================= */

app.get("/api/pdfs", (req, res) => {
  res.json({ success: true, pdfs: getPDFs().map(pdf => ({ ...pdf, onlineReading: true, paidDownload: true })) });
});

app.post("/api/reading/start", requireUser, (req, res) => {
  const pdf = findPdf(req.body.pdfId);
  if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });

  const expiresAt = new Date(Date.now() + READING_MINUTES * 60000).toISOString();
  const result = db.prepare(`INSERT INTO reading_sessions(user_id,pdf_id,expires_at) VALUES (?,?,?)`).run(req.user.id, pdf.id, expiresAt);

  res.json({
    success: true,
    readingSessionStarted: true,
    readingSessionId: result.lastInsertRowid,
    pdfId: pdf.id,
    title: pdf.title,
    expiresAt,
    advertisementsEnabled: req.user.role !== "creator"
  });
});

app.get("/api/pdfs/:id/download-access", requireUser, (req, res) => {
  const pdf = findPdf(req.params.id);
  if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });
  if (req.user.role === "creator") return res.json({ success: true, allowed: true, creator: true });
  const purchase = db.prepare(`SELECT * FROM pdf_purchases WHERE user_id=? AND pdf_id=?`).get(req.user.id, pdf.id);
  res.json({ success: true, allowed: Boolean(purchase) });
});

app.post("/api/payments/pdf", requireUser, async (req, res) => {
  try {
    const pdf = findPdf(req.body.pdfId);
    if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });
    if (req.user.role === "creator") return res.json({ success: true, downloadAllowed: true, creator: true });

    const existing = db.prepare(`SELECT * FROM pdf_purchases WHERE user_id=? AND pdf_id=?`).get(req.user.id, pdf.id);
    if (existing) return res.json({ success: true, downloadAllowed: true });

    const reference = `PASSCOGH-PDF-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO payments(reference,user_id,item_type,item_id,amount,currency) VALUES (?,?,'pdf',?,?,'GHS')`).run(reference, req.user.id, pdf.id, pdf.price);

    const payment = await initialisePaystackPayment({
      email: req.user.email,
      amount: pdf.price,
      reference,
      callbackUrl: `${baseUrl(req)}/payment/callback`
    });

    res.json({ success: true, paymentRequired: true, authorizationUrl: payment.authorization_url, accessCode: payment.access_code, reference });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message || "PDF payment failed." });
  }
});

/* =========================================================
   PAYMENT VERIFICATION
   ========================================================= */

app.get("/api/payments/verify/:reference", requireUser, async (req, res) => {
  try {
    const reference = req.params.reference;
    const payment = db.prepare(`SELECT * FROM payments WHERE reference=? AND user_id=?`).get(reference, req.user.id);
    if (!payment) return res.status(404).json({ success: false, message: "Payment record not found." });

    if (payment.status === "success") {
      return res.json({ success: true, verified: true, itemType: payment.item_type, itemId: payment.item_id, reference });
    }

    const transaction = await verifyPaystack(reference);
    const expectedAmount = Number(payment.amount) * 100;
    if (transaction.status !== "success" || String(transaction.currency).toUpperCase() !== "GHS" || Number(transaction.amount) !== expectedAmount) {
      return res.status(400).json({ success: false, verified: false, message: "Payment verification failed." });
    }

    const tx = db.transaction(() => {
      db.prepare(`UPDATE payments SET status='success', verified_at=CURRENT_TIMESTAMP WHERE reference=?`).run(reference);
      if (payment.item_type === "course") {
        db.prepare(`INSERT INTO course_enrolments(user_id,course_id,status) VALUES (?,?,'active') ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`).run(payment.user_id, payment.item_id);
      }
      if (payment.item_type === "pdf") {
        db.prepare(`INSERT OR IGNORE INTO pdf_purchases(user_id,pdf_id,payment_reference) VALUES (?,?,?)`).run(payment.user_id, payment.item_id, reference);
      }
    });
    tx();

    res.json({ success: true, verified: true, itemType: payment.item_type, itemId: payment.item_id, reference });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message || "Payment verification failed." });
  }
});

app.get("/payment/callback", (req, res) => {
  const reference = String(req.query.reference || "");
  if (!reference) return res.status(400).send("Payment reference is missing.");

  res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PASSCOGH-MODOO Payment</title></head>
<body style="font-family:system-ui;padding:30px;text-align:center"><h2>Payment received</h2><p>Your payment is being verified.</p><p>Please return to PASSCOGH-MODOO.</p>
<script>window.setTimeout(function(){ window.location.href = "/?payment_reference=${encodeURIComponent(reference)}"; }, 1800);</script></body></html>`);
});

/* =========================================================
   SECURE PDF DOWNLOAD
   ========================================================= */

app.get("/api/pdfs/:id/download", requireUser, (req, res) => {
  const pdf = findPdf(req.params.id);
  if (!pdf) return res.status(404).json({ success: false, message: "PDF not found." });

  if (req.user.role !== "creator") {
    const purchase = db.prepare(`SELECT * FROM pdf_purchases WHERE user_id=? AND pdf_id=?`).get(req.user.id, pdf.id);
    if (!purchase) return res.status(403).json({ success: false, message: "Paid download access is required." });
  }

  const filePath = path.join(resolvedPdfDir, path.basename(pdf.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "The protected PDF has not been uploaded yet." });
  res.download(filePath, pdf.filename);
});

/* =========================================================
   COURSE PROGRESS
   Fixed previous SQL mismatch: INSERT now supplies all four
   required values and uses UPSERT safely.
   ========================================================= */

app.post("/api/courses/:id/progress", requireUser, (req, res) => {
  const course = findCourse(req.params.id);
  if (!course) return res.status(404).json({ success: false, message: "Course not found." });

  if (req.user.role !== "creator") {
    const access = db.prepare(`SELECT * FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'`).get(req.user.id, course.id);
    if (!access) return res.status(403).json({ success: false, message: "You must be enrolled first." });
  }

  let progress = Number(req.body.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) return res.status(400).json({ success: false, message: "Progress must be between 0 and 100." });
  progress = Math.round(progress);

  db.prepare(`
    INSERT INTO course_enrolments(user_id,course_id,status,progress,completed_at)
    VALUES (?,?,'active',?,CASE WHEN ?=100 THEN CURRENT_TIMESTAMP ELSE NULL END)
    ON CONFLICT(user_id,course_id)
    DO UPDATE SET
      status='active',
      progress=excluded.progress,
      completed_at=CASE
        WHEN excluded.progress=100 THEN COALESCE(course_enrolments.completed_at,CURRENT_TIMESTAMP)
        ELSE course_enrolments.completed_at
      END
  `).run(req.user.id, course.id, progress, progress);

  res.json({ success: true, progress });
});

/* =========================================================
   CERTIFICATES
   ========================================================= */

app.post("/api/courses/:id/certificate", requireUser, (req, res) => {
  const course = findCourse(req.params.id);
  if (!course) return res.status(404).json({ success: false, message: "Course not found." });

  const enrolment = db.prepare(`SELECT * FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'`).get(req.user.id, course.id);
  if (req.user.role !== "creator" && (!enrolment || Number(enrolment.progress) < 100)) {
    return res.status(403).json({ success: false, message: "Complete the course before requesting a certificate." });
  }

  const existing = db.prepare(`SELECT * FROM certificates WHERE user_id=? AND course_id=?`).get(req.user.id, course.id);
  if (existing) return res.json({ success: true, certificate: existing });

  const certificateNo = `PASSCOGH-${new Date().getFullYear()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  db.prepare(`INSERT INTO certificates(certificate_no,user_id,course_id) VALUES (?,?,?)`).run(certificateNo, req.user.id, course.id);
  const certificate = db.prepare(`SELECT * FROM certificates WHERE certificate_no=?`).get(certificateNo);
  res.json({ success: true, certificate });
});

app.get("/api/certificates/:certificateNo", (req, res) => {
  const certificate = db.prepare(`
    SELECT certificates.certificate_no, certificates.issued_at, users.name, users.email, certificates.course_id
    FROM certificates JOIN users ON users.id=certificates.user_id
    WHERE certificates.certificate_no=?
  `).get(req.params.certificateNo);
  if (!certificate) return res.status(404).json({ success: false, valid: false, message: "Certificate not found." });
  const course = findCourse(certificate.course_id);
  res.json({ success: true, valid: true, certificate: { ...certificate, course_title: course?.title || certificate.course_id } });
});

/* =========================================================
   CREATOR ACCESS / DASHBOARD
   ========================================================= */

app.get("/api/creator/access", requireCreator, (req, res) => {
  res.json({ success: true, creator: true, email: req.user.email, role: req.user.role, unlimitedAccess: true, freeCourseAccess: true, freePdfDownload: true, advertisementsDisabled: true });
});

app.get("/api/creator/dashboard", requireCreator, (req, res) => {
  res.json({
    success: true,
    users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    enrolments: db.prepare("SELECT COUNT(*) AS count FROM course_enrolments").get().count,
    successfulPayments: db.prepare("SELECT COUNT(*) AS count FROM payments WHERE status='success'").get().count,
    certificates: db.prepare("SELECT COUNT(*) AS count FROM certificates").get().count,
    curriculumFile: fs.existsSync(resolvedCurriculumFile),
    curriculumLevels: getLevels().length,
    curriculumSubjects: getAllSubjects().length,
    courses: getCourses().length,
    pdfs: getPDFs().length,
    skillsPath: Boolean(loadCurriculum()?.skills_path?.enabled),
    universityGuidance: Boolean(loadCurriculum()?.university_guidance?.enabled)
  });
});

/* =========================================================
   STATIC WEBSITE
   ========================================================= */

if (fs.existsSync(resolvedPublicDir)) {
  app.use(express.static(resolvedPublicDir));
  app.get("/{*splat}", (req, res) => {
    const indexFile = path.join(resolvedPublicDir, "index.html");
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
    res.status(404).send("PASSCOGH-MODOO website is not installed in the public folder.");
  });
} else {
  app.get("/", (req, res) => res.status(404).send("PASSCOGH-MODOO public folder is missing."));
}

/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use((error, req, res, next) => {
  console.error("PASSCOGH-MODOO server error:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ success: false, message: "PASSCOGH-MODOO server error." });
});

/* =========================================================
   START
   ========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  const c = loadCurriculum();
  console.log(`PASSCOGH-MODOO running on port ${PORT}`);
  console.log(`Curriculum file: ${fs.existsSync(resolvedCurriculumFile) ? "FOUND" : "MISSING"}`);
  console.log(`Curriculum shape: ${Array.isArray(c.levels) ? "levels[]" : typeof c.levels}`);
  console.log(`Levels: ${getLevels().length}`);
  console.log(`Subjects: ${getAllSubjects().length}`);
  console.log(`Courses: ${getCourses().length}`);
  console.log(`PDF catalogue: ${getPDFs().length}`);
  console.log(`Paystack: ${process.env.PAYSTACK_SECRET_KEY ? "CONFIGURED" : "NOT CONFIGURED"}`);
});
