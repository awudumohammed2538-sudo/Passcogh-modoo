import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);

const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DIAGRAM_DIR = path.join(DATA_DIR, "diagrams");
const STORAGE_DIR = path.join(ROOT, "storage");
const PDF_DIR = path.join(STORAGE_DIR, "pdfs");

const CURRICULUM_CANDIDATES = [
  path.join(DATA_DIR, "passcogh_curriculum.json"),
  path.join(DATA_DIR, "passcogh_carriculum.json"),
  path.join(DATA_DIR, "curriculum.json"),
  path.join(DATA_DIR, "curriculum", "curriculum.json"),
  path.join(DATA_DIR, "curriculum", "official-registry.json")
];

const UNIVERSITY_CANDIDATES = [
  path.join(DATA_DIR, "institution.json"),
  path.join(DATA_DIR, "institutions.json"),
  path.join(DATA_DIR, "universities.json"),
  path.join(DATA_DIR, "university.json")
];

for (const d of [STORAGE_DIR, PDF_DIR]) fs.mkdirSync(d, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is missing or too short. Add a strong JWT_SECRET in Render Environment Variables.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined,
  max: Number(process.env.DB_POOL_MAX || 10)
});

const CREATOR_EMAIL = String(
  process.env.CREATOR_EMAIL || "awudumohammedmodoo@gmail.com"
).trim().toLowerCase();

const VERSION = "4.0.0";
const READING_AD_INTERVAL_MINUTES = 5;
const JHS_SHS_TOPIC_PDF_PRICE = 1;
const PRE_UNIVERSITY_CHECK_PRICE = 5;
const SKILLS_COURSE_PRICE = 20;

const SKILLS_COURSES = [
  ["coding-fundamentals", "Coding Fundamentals", "HTML, CSS, JavaScript and website foundations."],
  ["programming-basics", "Programming Basics", "Problem solving, algorithms, variables and functions."],
  ["web-development", "Web Development", "Build responsive websites and understand frontend development."],
  ["digital-design", "Digital Design", "Design principles, visual communication and digital graphics."],
  ["digital-marketing", "Digital Marketing", "Content strategy, online branding and analytics basics."],
  ["cybersecurity-basics", "Cybersecurity Basics", "Safe computing, privacy, phishing awareness and security."],
  ["data-excel", "Data & Excel", "Spreadsheets, formulas, analysis and useful data skills."],
  ["entrepreneurship", "Entrepreneurship", "Business ideas, planning and practical entrepreneurship."]
].map(([id, title, description]) => ({
  id, title, description, price: SKILLS_COURSE_PRICE, currency: "GHS",
  certificateEnabled: true, published: true
}));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "4mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true, legacyHeaders: false }));

function safeEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
function safeText(v, fallback = "") {
  return String(v ?? fallback).trim();
}
function slug(v) {
  return safeText(v).toLowerCase().normalize("NFKD")
    .replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function arr(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    return Object.entries(v).map(([id, x]) =>
      x && typeof x === "object" ? { id, ...x } : { id, name: id, description: String(x) }
    );
  }
  return [];
}
function first(obj, keys, fallback = "") {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  return fallback;
}

function locateFirst(candidates) {
  return candidates.find(f => fs.existsSync(f)) || null;
}
function curriculumFile() {
  return locateFirst(CURRICULUM_CANDIDATES);
}
function universityFile() {
  return locateFirst(UNIVERSITY_CANDIDATES);
}
function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("JSON read error:", file, e.message); return null; }
}

let curriculumCache = { file: null, mtime: 0, data: null };
function loadCurriculum() {
  const file = curriculumFile();
  if (!file) return {
    platform: "PASSCOGH-MODOO", version: "unknown",
    error: "No curriculum JSON was found.",
    levels: [], questions: [], pastQuestions: [], practical: [], examGuides: []
  };
  const stat = fs.statSync(file);
  if (curriculumCache.file === file && curriculumCache.mtime === stat.mtimeMs && curriculumCache.data) {
    return curriculumCache.data;
  }
  const raw = readJson(file);
  if (!raw) return {
    platform: "PASSCOGH-MODOO", version: "unknown",
    error: "Curriculum JSON could not be read.",
    levels: [], questions: [], pastQuestions: [], practical: [], examGuides: []
  };
  const c = Array.isArray(raw) ? { platform: "PASSCOGH-MODOO", levels: raw } : raw;
  c.levels = arr(c.levels);
  c.questions = arr(c.questions || c.questionBank);
  c.pastQuestions = arr(c.pastQuestions);
  c.practical = arr(c.practical || c.practicalPreparation);
  c.examGuides = arr(c.examGuides);
  curriculumCache = { file, mtime: stat.mtimeMs, data: c };
  return c;
}

function getLevels() { return arr(loadCurriculum().levels); }
function levelMatches(level, q) {
  const x = slug(q);
  return [level?.id, level?.code, level?.name, level?.title, level?.level]
    .some(v => slug(v) === x);
}
function getSubjectsFromLevel(level) {
  return arr(level?.subjects || level?.courses || level?.subjectList);
}
function getAllSubjects() {
  const out = [];
  for (const level of getLevels()) {
    for (const subject of getSubjectsFromLevel(level)) {
      if (!subject || typeof subject !== "object") continue;
      out.push({
        ...subject,
        level: subject.level || level.name || level.title || level.level || level.id || "",
        levelId: subject.levelId || level.id || slug(level.name || level.title || "")
      });
    }
  }
  return out;
}
function findSubject(q) {
  const x = slug(q);
  return getAllSubjects().find(s =>
    slug(s.id || s.code) === x || slug(s.name || s.title) === x
  ) || null;
}
function getTopics(subject) {
  if (!subject) return [];
  return arr(subject.topics || subject.units || subject.sections || subject.chapters);
}
function findTopic(subject, q) {
  const x = slug(q);
  return getTopics(subject).find(t =>
    slug(t?.id || t?.code) === x || slug(t?.name || t?.title) === x
  ) || null;
}
function getLesson(topic) {
  if (!topic) return {};
  if (topic.lesson && typeof topic.lesson === "object") return topic.lesson;
  return topic;
}
function getFormulas(topic) {
  const l = getLesson(topic);
  return arr(l.formula_summary || l.formulas || l.formulaSheet || l.keyFormulas);
}
function getApplications(topic) {
  const l = getLesson(topic);
  return arr(l.real_life_application || l.realLifeApplications || l.ghana_application);
}

let diagramCache = { stamp: 0, items: [] };
function normalizeWords(v) {
  return slug(v).split("-").filter(x => x.length >= 2);
}
function scanDiagrams() {
  if (!fs.existsSync(DIAGRAM_DIR)) return [];
  const files = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (/\.(png|jpe?g|webp|gif|svg)$/i.test(name.name)) files.push(full);
    }
  };
  walk(DIAGRAM_DIR);
  const stamp = files.length ? Math.max(...files.map(f => fs.statSync(f).mtimeMs)) : 0;
  if (stamp === diagramCache.stamp && diagramCache.items.length === files.length) return diagramCache.items;
  diagramCache = {
    stamp,
    items: files.map(full => ({
      filename: path.basename(full),
      relativePath: path.relative(ROOT, full).replaceAll(path.sep, "/"),
      url: `/data/diagrams/${path.relative(DIAGRAM_DIR, full).replaceAll(path.sep, "/")}`,
      tokens: normalizeWords(path.basename(full))
    }))
  };
  return diagramCache.items;
}
function scoreDiagram(diagram, subject, topic) {
  const wanted = [...normalizeWords(subject?.name || subject?.title), ...normalizeWords(topic?.name || topic?.title)];
  if (!wanted.length) return 0;
  const joined = diagram.tokens;
  return wanted.reduce((score, w) => score + (joined.includes(w) ? 3 : 0), 0);
}
function diagramsFor(subject, topic) {
  return scanDiagrams()
    .map(d => ({ ...d, score: scoreDiagram(d, subject, topic) }))
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename))
    .slice(0, 12)
    .map(({ tokens, ...d }) => d);
}

function getSkillsPath() {
  const c = loadCurriculum();
  const raw = c.skills_path || c.skillsPath;
  return {
    enabled: raw?.enabled !== false,
    name: raw?.name || "PASSCOGH-MODOO Skills Path",
    description: raw?.description || "",
    paths: arr(raw?.paths || raw)
  };
}
function loadUniversities() {
  const file = universityFile();
  const raw = readJson(file);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return arr(raw.universities || raw.institutions || raw.data);
}
function loadUniversityCourses() {
  const c = loadCurriculum();
  const raw = c.university_courses || c.universityCourses || c.tertiary_courses;
  return arr(raw);
}
function getPdfCatalogue() {
  const c = loadCurriculum();
  const raw = c.pdf_catalogue || c.pdfCatalogue || {};
  return {
    enabled: raw.enabled !== false,
    reading: "free inside website",
    download: "paid",
    creator_access: "free",
    items: arr(raw.items)
  };
}
function topicPdf(topic, subject, level) {
  const title = `${subject?.name || subject?.title || "Subject"} — ${topic?.name || topic?.title || "Topic"}`;
  return {
    id: `topic-${slug(level)}-${slug(subject?.name || subject?.title)}-${slug(topic?.id || topic?.name || topic?.title)}`,
    title,
    level: level || "",
    subject: subject?.name || subject?.title || "",
    topic: topic?.name || topic?.title || "",
    price: /^(jhs|shs)/i.test(String(level || "")) ? JHS_SHS_TOPIC_PDF_PRICE : JHS_SHS_TOPIC_PDF_PRICE,
    currency: "GHS",
    onlineReading: true,
    paidDownload: true
  };
}
function allPdfs() {
  const catalogue = getPdfCatalogue();
  const result = [];
  for (const item of catalogue.items) {
    const x = typeof item === "string" ? { title: item } : item;
    const id = String(x.id || slug(x.title || x.name));
    result.push({
      id, title: String(x.title || x.name || id),
      filename: String(x.filename || `${id}.pdf`),
      price: Number.isFinite(Number(x.price)) ? Number(x.price) : JHS_SHS_TOPIC_PDF_PRICE,
      currency: "GHS", onlineReading: true, paidDownload: true
    });
  }
  return result;
}
function findPdf(id) {
  const q = slug(id);
  return allPdfs().find(p => slug(p.id) === q || slug(p.title) === q) || null;
}
function findStoredPdf(pdf) {
  if (!pdf) return null;
  const safe = path.basename(pdf.filename);
  const candidates = [
    path.join(PDF_DIR, safe),
    path.join(DATA_DIR, "pdfs", safe),
    path.join(DATA_DIR, safe)
  ];
  return candidates.find(f => fs.existsSync(f)) || null;
}

function tokenFromRequest(req) {
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  const cookie = String(req.headers.cookie || "").split(";").map(x => x.trim())
    .find(x => x.startsWith("pcm_token="));
  return cookie ? decodeURIComponent(cookie.slice("pcm_token=".length)) : null;
}
async function currentUser(req) {
  const raw = tokenFromRequest(req);
  if (!raw) return null;
  try {
    const decoded = jwt.verify(raw, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      "SELECT id,email,name,role,created_at FROM users WHERE id=$1", [decoded.sub]
    );
    return rows[0] || null;
  } catch { return null; }
}
async function auth(req, res, next) {
  req.user = await currentUser(req);
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });
  next();
}
async function creator(req, res, next) {
  req.user = await currentUser(req);
  if (!req.user || !["creator", "owner", "admin"].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Creator access denied." });
  }
  next();
}
function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}
function setCookie(res, token) {
  res.setHeader("Set-Cookie",
    `pcm_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

async function ensureDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'learner',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reference TEXT UNIQUE NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      amount_ghc NUMERIC(10,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GHS',
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL DEFAULT 'paystack',
      paystack_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS pdf_purchases(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pdf_id TEXT NOT NULL,
      payment_reference TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,pdf_id)
    );
    CREATE TABLE IF NOT EXISTS reading_sessions(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pdf_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS course_enrolments(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      progress INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,course_id)
    );
    CREATE TABLE IF NOT EXISTS certificates(
      id BIGSERIAL PRIMARY KEY,
      certificate_no TEXT UNIQUE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,course_id)
    );
    CREATE TABLE IF NOT EXISTS student_progress(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      level_id TEXT NOT NULL DEFAULT '',
      subject_id TEXT NOT NULL DEFAULT '',
      topic_id TEXT NOT NULL DEFAULT '',
      progress INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,level_id,subject_id,topic_id)
    );
    CREATE TABLE IF NOT EXISTS quiz_attempts(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_type TEXT NOT NULL,
      subject TEXT,
      score NUMERIC(10,2) NOT NULL DEFAULT 0,
      total NUMERIC(10,2) NOT NULL DEFAULT 0,
      answers JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS university_checks(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reference TEXT UNIQUE NOT NULL,
      amount_ghc NUMERIC(10,2) NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'pending',
      input JSONB NOT NULL DEFAULT '{}',
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function requirePaystack() {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
}
async function paystackInitialize({ email, amount, reference, callbackUrl }) {
  requirePaystack();
  const r = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email, amount: Math.round(Number(amount) * 100), currency: "GHS",
      reference, callback_url: callbackUrl
    })
  });
  const d = await r.json();
  if (!r.ok || !d.status) throw new Error(d.message || "Payment initialization failed.");
  return d.data;
}
async function paystackVerify(reference) {
  requirePaystack();
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
  });
  const d = await r.json();
  if (!r.ok || !d.status || !d.data) throw new Error(d.message || "Payment verification failed.");
  return d.data;
}
async function completePayment(payment) {
  await pool.query(
    "UPDATE payments SET status='success',paystack_status='success',verified_at=NOW() WHERE reference=$1",
    [payment.reference]
  );
  if (payment.item_type === "course") {
    await pool.query(
      `INSERT INTO course_enrolments(user_id,course_id,status,progress)
       VALUES($1,$2,'active',0)
       ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`,
      [payment.user_id, payment.item_id]
    );
  }
  if (payment.item_type === "pdf") {
    await pool.query(
      `INSERT INTO pdf_purchases(user_id,pdf_id,payment_reference)
       VALUES($1,$2,$3) ON CONFLICT(user_id,pdf_id) DO NOTHING`,
      [payment.user_id, payment.item_id, payment.reference]
    );
  }
  if (payment.item_type === "university_check") {
    await pool.query(
      "UPDATE university_checks SET status='success' WHERE reference=$1",
      [payment.reference]
    );
  }
}

app.get("/api/health", async (req, res) => {
  const c = loadCurriculum();
  const lv = getLevels(), ss = getAllSubjects();
  const diagrams = scanDiagrams();
  const universities = loadUniversities();
  const universityCourses = loadUniversityCourses();
  let topics = 0, lessons = 0, formulas = 0, applications = 0;
  for (const s of ss) for (const t of getTopics(s)) {
    topics++;
    const l = getLesson(t);
    if (Object.keys(l).length) lessons++;
    formulas += getFormulas(t).length;
    applications += getApplications(t).length;
  }
  let database = "PostgreSQL";
  try { await pool.query("SELECT 1"); } catch { database = "PostgreSQL-unavailable"; }
  res.json({
    success: true, service: "PASSCOGH-MODOO", version: VERSION, database,
    curriculumFile: curriculumFile() ? path.relative(ROOT, curriculumFile()).replaceAll(path.sep, "/") : null,
    curriculumFileExists: !!curriculumFile(),
    curriculumShape: Array.isArray(c) ? "array" : "object",
    levels: lv.length, subjects: ss.length, topics, lessons,
    formulaEntries: formulas, realLifeApplications: applications,
    diagrams: diagrams.length, diagramDirectory: "data/diagrams",
    diagramLibraryReady: diagrams.length > 0,
    skillsPath: getSkillsPath().enabled,
    skillsPaths: getSkillsPath().paths.length,
    courses: SKILLS_COURSES.length,
    universityGuidance: true,
    universityDatasetAvailable: universities.length > 0 || universityCourses.length > 0,
    institutions: universities.length, universityCourses: universityCourses.length,
    onlineReading: "free", freeOnlineReading: true,
    readingAdIntervalMinutes: READING_AD_INTERVAL_MINUTES,
    jhsShsTopicPdfPriceCedis: JHS_SHS_TOPIC_PDF_PRICE,
    preUniversityCheckPriceCedis: PRE_UNIVERSITY_CHECK_PRICE,
    skillsCoursePriceCedis: SKILLS_COURSE_PRICE,
    creatorFreeUnlimited: true,
    waecPastQuestionsAuthorised: false,
    paymentProvider: process.env.PAYSTACK_SECRET_KEY ? "configured" : "not_configured"
  });
});

app.get("/api/curriculum", (req, res) => res.json({ success: true, curriculum: loadCurriculum() }));
app.get("/api/levels", (req, res) => res.json({ success: true, levels: getLevels() }));
app.get("/api/levels/:level", (req, res) => {
  const x = getLevels().find(l => levelMatches(l, req.params.level));
  if (!x) return res.status(404).json({ success: false, message: "Level not found." });
  res.json({ success: true, level: x });
});
app.get("/api/levels/:level/subjects", (req, res) => {
  const x = getLevels().find(l => levelMatches(l, req.params.level));
  if (!x) return res.status(404).json({ success: false, message: "Level not found." });
  res.json({ success: true, level: x.name || x.title || x.id, subjects: getSubjectsFromLevel(x) });
});
app.get("/api/subjects", (req, res) => {
  const list = getAllSubjects();
  const level = req.query.level ? slug(req.query.level) : "";
  res.json({ success: true, subjects: level ? list.filter(s => slug(s.level) === level || slug(s.levelId) === level) : list });
});
app.get("/api/subjects/:subject", (req, res) => {
  const s = findSubject(req.params.subject);
  if (!s) return res.status(404).json({ success: false, message: "Subject not found." });
  res.json({ success: true, subject: s });
});
app.get("/api/subjects/:subject/topics", (req, res) => {
  const s = findSubject(req.params.subject);
  if (!s) return res.status(404).json({ success: false, message: "Subject not found." });
  res.json({ success: true, subject: s.name || s.title, level: s.level, topics: getTopics(s) });
});
app.get("/api/subjects/:subject/topics/:topic", (req, res) => {
  const s = findSubject(req.params.subject), t = s && findTopic(s, req.params.topic);
  if (!s) return res.status(404).json({ success: false, message: "Subject not found." });
  if (!t) return res.status(404).json({ success: false, message: "Topic not found." });
  res.json({ success: true, subject: s.name || s.title, level: s.level, topic: t, diagrams: diagramsFor(s, t) });
});
app.get("/api/subjects/:subject/topics/:topic/lesson", (req, res) => {
  const s = findSubject(req.params.subject), t = s && findTopic(s, req.params.topic);
  if (!s) return res.status(404).json({ success: false, message: "Subject not found." });
  if (!t) return res.status(404).json({ success: false, message: "Topic not found." });
  res.json({
    success: true, subject: s.name || s.title, level: s.level,
    topic: t, lesson: getLesson(t), diagrams: diagramsFor(s, t),
    sections: {
      lesson: getLesson(t).lesson || getLesson(t).content || "",
      keyTerms: getLesson(t).key_terms || getLesson(t).keyTerms || [],
      concepts: getLesson(t).concepts || [],
      ghanaApplication: getLesson(t).ghana_application || getLesson(t).real_life_application || [],
      examples: getLesson(t).examples || [],
      howToDraw: getLesson(t).how_to_draw || getLesson(t).howToDraw || "",
      formulas: getFormulas(t),
      commonMistakes: getLesson(t).common_mistakes || getLesson(t).commonMistakes || [],
      memoryAid: getLesson(t).memory_aid || getLesson(t).memoryAid || "",
      practical: getLesson(t).practical || [],
      practice: getLesson(t).practice || [],
      wassceStyle: getLesson(t).wassce_style || getLesson(t).wassceStyle || [],
      predicted2027: getLesson(t).predicted_2027 || getLesson(t).predicted2027 || [],
      answers: getLesson(t).answers || getLesson(t).answerGuide || []
    }
  });
});
app.get("/api/subjects/:subject/topics/:topic/formulas", (req, res) => {
  const s = findSubject(req.params.subject), t = s && findTopic(s, req.params.topic);
  if (!s || !t) return res.status(404).json({ success: false, message: "Subject or topic not found." });
  res.json({ success: true, formulas: getFormulas(t) });
});
app.get("/api/subjects/:subject/topics/:topic/application", (req, res) => {
  const s = findSubject(req.params.subject), t = s && findTopic(s, req.params.topic);
  if (!s || !t) return res.status(404).json({ success: false, message: "Subject or topic not found." });
  res.json({ success: true, realLifeApplications: getApplications(t) });
});

app.get("/api/topics/:subjectId", (req, res) => {
  const s = findSubject(req.params.subjectId);
  if (!s) return res.status(404).json({ success: false, message: "Subject not found." });
  res.json({ success: true, subject: s.name || s.title, topics: getTopics(s) });
});
app.get("/api/lessons/:topicId", (req, res) => {
  for (const s of getAllSubjects()) {
    const t = findTopic(s, req.params.topicId);
    if (t) return res.json({ success: true, subject: s.name || s.title, level: s.level, topic: t, lesson: getLesson(t), diagrams: diagramsFor(s, t) });
  }
  res.status(404).json({ success: false, message: "Lesson/topic not found." });
});

app.get("/api/diagrams", (req, res) => {
  let list = scanDiagrams();
  if (req.query.q) {
    const q = normalizeWords(req.query.q);
    list = list.filter(d => q.some(w => d.tokens.includes(w)));
  }
  res.json({ success: true, count: list.length, diagrams: list.map(({tokens, ...x}) => x) });
});
app.get("/api/diagrams/topic/:subject/:topic", (req, res) => {
  const s = findSubject(req.params.subject), t = s && findTopic(s, req.params.topic);
  if (!s || !t) return res.status(404).json({ success: false, message: "Subject or topic not found." });
  res.json({ success: true, diagrams: diagramsFor(s, t) });
});

app.get("/api/assessment-system", (req, res) => res.json({ success: true, assessmentSystem: loadCurriculum().assessment_system || {} }));
app.get("/api/lesson-template", (req, res) => res.json({ success: true, lessonTemplate: loadCurriculum().lesson_template || {} }));
app.get("/api/questions", (req, res) => res.json({ success: true, questions: loadCurriculum().questions }));
app.get("/api/past-questions", (req, res) => res.json({ success: true, pastQuestions: [], authorised: false, message: "Genuine WAEC papers remain disabled until an authorised/licensed source or permission is available." }));
app.get("/api/practical", (req, res) => res.json({ success: true, practical: loadCurriculum().practical }));
app.get("/api/exam-guides", (req, res) => res.json({ success: true, examGuides: loadCurriculum().examGuides }));

app.get("/api/skills-path", (req, res) => res.json({ success: true, skillsPath: getSkillsPath(), courses: SKILLS_COURSES }));
app.get("/api/skills-path/:id", (req, res) => {
  const p = getSkillsPath().paths.find(x => slug(x.id || x.name || x.title) === slug(req.params.id));
  if (!p) return res.status(404).json({ success: false, message: "Skills path not found." });
  res.json({ success: true, skillsPath: p });
});
app.get("/api/courses", (req, res) => res.json({ success: true, courses: SKILLS_COURSES }));
app.get("/api/courses/:id", (req, res) => {
  const c = SKILLS_COURSES.find(x => slug(x.id) === slug(req.params.id) || slug(x.title) === slug(req.params.id));
  if (!c) return res.status(404).json({ success: false, message: "Course not found." });
  res.json({ success: true, course: c });
});

app.get("/api/universities", (req, res) => res.json({
  success: true, available: loadUniversities().length > 0,
  universities: loadUniversities()
}));
app.get("/api/institutions", (req, res) => res.json({ success: true, institutions: loadUniversities(), available: loadUniversities().length > 0 }));
app.get("/api/university-courses", (req, res) => res.json({ success: true, available: loadUniversityCourses().length > 0, courses: loadUniversityCourses() }));
app.get("/api/university-guidance", (req, res) => res.json({
  success: true, enabled: true, checkPriceCedis: PRE_UNIVERSITY_CHECK_PRICE,
  datasetAvailable: loadUniversities().length > 0 || loadUniversityCourses().length > 0,
  institutions: loadUniversities(), courses: loadUniversityCourses()
}));

function normalizeResults(body) {
  return body?.results || body?.grades || body?.subjects || body || {};
}
function simpleCourseMatch(input) {
  const courses = loadUniversityCourses();
  if (!courses.length) return [];
  const text = JSON.stringify(input).toLowerCase();
  return courses.map(c => {
    const words = String(c.title || c.name || "").toLowerCase().split(/\s+/);
    const score = words.reduce((n, w) => n + (w.length > 3 && text.includes(w) ? 10 : 0), 0);
    return { ...c, recommendationScore: score };
  }).sort((a,b) => b.recommendationScore - a.recommendationScore);
}
app.post("/api/university-guidance/match", async (req, res) => {
  const input = normalizeResults(req.body);
  const institutions = loadUniversities(), courses = simpleCourseMatch(input);
  res.json({
    success: true, priceCedis: PRE_UNIVERSITY_CHECK_PRICE,
    datasetAvailable: institutions.length > 0 || courses.length > 0,
    resultsReceived: input, institutions,
    suitableCourses: courses,
    message: courses.length
      ? "Recommendations are based only on the currently loaded institution/course dataset."
      : "No university/course dataset is loaded yet; no eligibility claim is being made."
  });
});
app.post("/api/university/recommend", async (req, res) => {
  const input = normalizeResults(req.body);
  const institutions = loadUniversities(), courses = simpleCourseMatch(input);
  res.json({ success: true, resultsReceived: input, qualifiedCourses: courses, universityRanking: institutions, datasetAvailable: institutions.length > 0 || courses.length > 0 });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = safeEmail(req.body.email), name = safeText(req.body.name);
    if (!email || !name) return res.status(400).json({ success:false, message:"Valid email and name are required." });
    const password = safeText(req.body.password);
    const role = email === CREATOR_EMAIL ? "creator" : "learner";
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;
    const { rows } = await pool.query(
      `INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4)
       RETURNING id,email,name,role,created_at`, [email,name,passwordHash,role]
    );
    const token = signToken(rows[0]); setCookie(res, token);
    res.status(201).json({ success:true, user:rows[0], token });
  } catch (e) {
    if (String(e.message).includes("duplicate key")) return res.status(409).json({success:false,message:"An account with that email already exists."});
    console.error(e); res.status(500).json({success:false,message:"Registration failed."});
  }
});
app.post("/api/auth/login", async (req, res) => {
  const email = safeEmail(req.body.email), password = safeText(req.body.password);
  if (!email) return res.status(400).json({success:false,message:"Enter a valid email address."});
  const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(email)=LOWER($1)", [email]);
  const u = rows[0];
  if (!u) return res.status(401).json({success:false,message:"Account not found. Please register first."});
  if (u.password_hash && !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({success:false,message:"Incorrect password."});
  const safe = {id:u.id,email:u.email,name:u.name,role:u.role,created_at:u.created_at};
  const token = signToken(safe); setCookie(res, token);
  res.json({success:true,user:safe,token});
});
app.post("/api/auth/logout", auth, async (req,res) => {
  const t = tokenFromRequest(req);
  if (t) await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days') ON CONFLICT(token_hash) DO NOTHING", [req.user.id, crypto.createHash("sha256").update(t).digest("hex")]);
  res.setHeader("Set-Cookie","pcm_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
  res.json({success:true});
});
app.get("/api/auth/me", auth, (req,res) => res.json({success:true,user:req.user}));
app.get("/api/me", auth, (req,res) => res.json({success:true,user:req.user}));
app.get("/api/account", auth, (req,res) => res.json({success:true,user:req.user}));

app.get("/api/progress", auth, async (req,res) => {
  const { rows } = await pool.query("SELECT * FROM student_progress WHERE user_id=$1 ORDER BY updated_at DESC",[req.user.id]);
  res.json({success:true,progress:rows});
});
app.post("/api/progress", auth, async (req,res) => {
  const b=req.body, progress=Math.max(0,Math.min(100,Math.round(Number(b.progress)||0)));
  const {rows}=await pool.query(
    `INSERT INTO student_progress(user_id,level_id,subject_id,topic_id,progress)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(user_id,level_id,subject_id,topic_id)
     DO UPDATE SET progress=EXCLUDED.progress,updated_at=NOW()
     RETURNING *`,
    [req.user.id,safeText(b.levelId),safeText(b.subjectId),safeText(b.topicId),progress]
  );
  res.json({success:true,progress:rows[0]});
});

app.get("/api/courses/:id/access", auth, async (req,res) => {
  const c=SKILLS_COURSES.find(x=>slug(x.id)===slug(req.params.id)||slug(x.title)===slug(req.params.id));
  if(!c)return res.status(404).json({success:false,message:"Course not found."});
  if(["creator","owner","admin"].includes(req.user.role))return res.json({success:true,access:true,creator:true});
  const {rows}=await pool.query("SELECT * FROM course_enrolments WHERE user_id=$1 AND course_id=$2",[req.user.id,c.id]);
  res.json({success:true,access:!!rows[0],enrolment:rows[0]||null});
});
app.get("/api/enrolments", auth, async (req,res) => {
  const {rows}=await pool.query("SELECT * FROM course_enrolments WHERE user_id=$1 ORDER BY created_at DESC",[req.user.id]);
  res.json({success:true,enrolments:rows});
});
app.post("/api/courses/:id/progress", auth, async (req,res) => {
  const c=SKILLS_COURSES.find(x=>slug(x.id)===slug(req.params.id)||slug(x.title)===slug(req.params.id));
  if(!c)return res.status(404).json({success:false,message:"Course not found."});
  const p=Math.max(0,Math.min(100,Math.round(Number(req.body.progress)||0)));
  if(!["creator","owner","admin"].includes(req.user.role)){
    const {rows}=await pool.query("SELECT 1 FROM course_enrolments WHERE user_id=$1 AND course_id=$2 AND status='active'",[req.user.id,c.id]);
    if(!rows[0])return res.status(403).json({success:false,message:"You must be enrolled first."});
  }
  const {rows}=await pool.query(
    `INSERT INTO course_enrolments(user_id,course_id,status,progress,completed_at)
     VALUES($1,$2,'active',$3,CASE WHEN $3=100 THEN NOW() ELSE NULL END)
     ON CONFLICT(user_id,course_id) DO UPDATE SET status='active',progress=EXCLUDED.progress,
       completed_at=CASE WHEN EXCLUDED.progress=100 THEN COALESCE(course_enrolments.completed_at,NOW()) ELSE course_enrolments.completed_at END
     RETURNING *`,[req.user.id,c.id,p]
  );
  res.json({success:true,progress:rows[0]});
});

app.post("/api/payments/course", auth, async (req,res) => {
  try {
    const c=SKILLS_COURSES.find(x=>slug(x.id)===slug(req.body.courseId)||slug(x.title)===slug(req.body.courseId));
    if(!c)return res.status(404).json({success:false,message:"Course not found."});
    if(["creator","owner","admin"].includes(req.user.role))return res.json({success:true,access:true,creator:true});
    const reference=`PASSCOGH-COURSE-${crypto.randomUUID()}`;
    await pool.query("INSERT INTO payments(user_id,reference,item_type,item_id,amount_ghc) VALUES($1,$2,'course',$3,$4)",[req.user.id,reference,c.id,c.price]);
    const p=await paystackInitialize({email:req.user.email,amount:c.price,reference,callbackUrl:`${req.protocol}://${req.get("host")}/payment/callback`});
    res.json({success:true,paymentRequired:true,reference,authorizationUrl:p.authorization_url});
  } catch(e) { console.error(e); res.status(500).json({success:false,message:e.message}); }
});

app.get("/api/pdfs", (req,res) => {
  res.json({success:true,reading:"free",download:"paid",readingAdIntervalMinutes:READING_AD_INTERVAL_MINUTES,pdfs:allPdfs()});
});
app.get("/api/materials", (req,res) => {
  res.json({success:true,reading:"free",download:"paid",materials:allPdfs()});
});
app.get("/api/pdfs/:id", (req,res) => {
  const p=findPdf(req.params.id);
  if(!p)return res.status(404).json({success:false,message:"PDF not found."});
  res.json({success:true,pdf:p});
});
app.post("/api/reading/start", auth, async (req,res) => {
  const p=findPdf(req.body.pdfId);
  if(!p)return res.status(404).json({success:false,message:"PDF not found."});
  const expires=new Date(Date.now()+READING_AD_INTERVAL_MINUTES*60_000);
  await pool.query("INSERT INTO reading_sessions(user_id,pdf_id,expires_at) VALUES($1,$2,$3)",[req.user.id,p.id,expires]);
  res.json({success:true,freeOnlineReading:true,readingSessionStarted:true,pdfId:p.id,expiresAt:expires.toISOString(),advertisementsEnabled:!["creator","owner","admin"].includes(req.user.role),adIntervalMinutes:READING_AD_INTERVAL_MINUTES});
});
app.get("/api/pdfs/:id/read", auth, async (req,res) => {
  const p=findPdf(req.params.id), file=findStoredPdf(p);
  if(!p)return res.status(404).json({success:false,message:"PDF not found."});
  if(!file)return res.status(404).json({success:false,message:"The protected PDF file is not uploaded yet."});
  if(!["creator","owner","admin"].includes(req.user.role)){
    const {rows}=await pool.query("SELECT 1 FROM reading_sessions WHERE user_id=$1 AND pdf_id=$2 AND expires_at>NOW() ORDER BY id DESC LIMIT 1",[req.user.id,p.id]);
    if(!rows[0])return res.status(403).json({success:false,message:"Start a free online reading session first."});
  }
  res.setHeader("Content-Type","application/pdf"); res.setHeader("Content-Disposition","inline"); res.setHeader("Cache-Control","private,no-store");
  fs.createReadStream(file).pipe(res);
});
app.get("/api/pdfs/:id/download-access", auth, async (req,res) => {
  const p=findPdf(req.params.id);
  if(!p)return res.status(404).json({success:false,message:"PDF not found."});
  if(["creator","owner","admin"].includes(req.user.role))return res.json({success:true,allowed:true,creator:true});
  const {rows}=await pool.query("SELECT 1 FROM pdf_purchases WHERE user_id=$1 AND pdf_id=$2",[req.user.id,p.id]);
  res.json({success:true,allowed:!!rows[0],priceCedis:p.price});
});
app.post("/api/payments/pdf", auth, async (req,res) => {
  try {
    const p=findPdf(req.body.pdfId);
    if(!p)return res.status(404).json({success:false,message:"PDF not found."});
    if(["creator","owner","admin"].includes(req.user.role))return res.json({success:true,downloadAllowed:true,creator:true});
    const old=await pool.query("SELECT 1 FROM pdf_purchases WHERE user_id=$1 AND pdf_id=$2",[req.user.id,p.id]);
    if(old.rows[0])return res.json({success:true,downloadAllowed:true,alreadyPurchased:true});
    const reference=`PASSCOGH-PDF-${crypto.randomUUID()}`;
    await pool.query("INSERT INTO payments(user_id,reference,item_type,item_id,amount_ghc) VALUES($1,$2,'pdf',$3,$4)",[req.user.id,reference,p.id,p.price]);
    const x=await paystackInitialize({email:req.user.email,amount:p.price,reference,callbackUrl:`${req.protocol}://${req.get("host")}/payment/callback`});
    res.json({success:true,paymentRequired:true,reference,authorizationUrl:x.authorization_url});
  } catch(e) { console.error(e); res.status(500).json({success:false,message:e.message}); }
});
app.get("/api/download/:id", auth, async (req,res) => {
  req.params.id = req.params.id;
  const p=findPdf(req.params.id), file=findStoredPdf(p);
  if(!p)return res.status(404).json({success:false,message:"PDF not found."});
  const owner=["creator","owner","admin"].includes(req.user.role);
  if(!owner){
    const {rows}=await pool.query("SELECT 1 FROM pdf_purchases WHERE user_id=$1 AND pdf_id=$2",[req.user.id,p.id]);
    if(!rows[0])return res.status(403).json({success:false,message:"Paid download access is required."});
  }
  if(!file)return res.status(404).json({success:false,message:"The protected PDF file is not uploaded yet."});
  res.setHeader("Cache-Control","private,no-store"); res.download(file,path.basename(file));
});
app.get("/api/pdfs/:id/download", auth, async (req,res) => {
  req.url = `/api/download/${encodeURIComponent(req.params.id)}`;
  const p=findPdf(req.params.id), file=findStoredPdf(p);
  if(!p)return res.status(404).json({success:false,message:"PDF not found."});
  const owner=["creator","owner","admin"].includes(req.user.role);
  if(!owner){
    const {rows}=await pool.query("SELECT 1 FROM pdf_purchases WHERE user_id=$1 AND pdf_id=$2",[req.user.id,p.id]);
    if(!rows[0])return res.status(403).json({success:false,message:"Paid download access is required."});
  }
  if(!file)return res.status(404).json({success:false,message:"The protected PDF file is not uploaded yet."});
  res.setHeader("Cache-Control","private,no-store"); res.download(file,path.basename(file));
});

app.get("/api/payments/verify/:reference", auth, async (req,res) => {
  try {
    const {rows}=await pool.query("SELECT * FROM payments WHERE reference=$1 AND user_id=$2",[req.params.reference,req.user.id]);
    const payment=rows[0]; if(!payment)return res.status(404).json({success:false,message:"Payment record not found."});
    if(payment.status==="success")return res.json({success:true,verified:true,itemType:payment.item_type,itemId:payment.item_id});
    const t=await paystackVerify(payment.reference);
    if(t.status!=="success" || String(t.currency).toUpperCase()!=="GHS" || Number(t.amount)!==Math.round(Number(payment.amount_ghc)*100))
      return res.status(400).json({success:false,verified:false,message:"Payment verification failed."});
    await completePayment(payment);
    res.json({success:true,verified:true,itemType:payment.item_type,itemId:payment.item_id,reference:payment.reference});
  } catch(e) { console.error(e); res.status(500).json({success:false,message:e.message}); }
});
app.get("/payment/callback", (req,res) => {
  const ref=String(req.query.reference||"").replace(/[^a-zA-Z0-9._:-]/g,"");
  res.send(`<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>PASSCOGH-MODOO</h2><p>Payment returned. Please return to the platform to complete verification.</p><p>Reference: ${ref}</p></body></html>`);
});

app.post("/api/courses/:id/certificate", auth, async (req,res) => {
  const c=SKILLS_COURSES.find(x=>slug(x.id)===slug(req.params.id)||slug(x.title)===slug(req.params.id));
  if(!c)return res.status(404).json({success:false,message:"Course not found."});
  const owner=["creator","owner","admin"].includes(req.user.role);
  const {rows}=await pool.query("SELECT * FROM course_enrolments WHERE user_id=$1 AND course_id=$2 AND status='active'",[req.user.id,c.id]);
  if(!owner && (!rows[0] || Number(rows[0].progress)<100))return res.status(403).json({success:false,message:"Complete the course before requesting a certificate."});
  const old=await pool.query("SELECT * FROM certificates WHERE user_id=$1 AND course_id=$2",[req.user.id,c.id]);
  if(old.rows[0])return res.json({success:true,certificate:old.rows[0]});
  const no=`PASSCOGH-${new Date().getFullYear()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  const x=await pool.query("INSERT INTO certificates(certificate_no,user_id,course_id) VALUES($1,$2,$3) RETURNING *",[no,req.user.id,c.id]);
  res.json({success:true,certificate:x.rows[0]});
});
app.get("/api/certificates/:certificateNo", async (req,res) => {
  const {rows}=await pool.query(
    `SELECT c.certificate_no,c.issued_at,u.name,u.email,c.course_id
     FROM certificates c JOIN users u ON u.id=c.user_id WHERE c.certificate_no=$1`,
    [req.params.certificateNo]
  );
  if(!rows[0])return res.status(404).json({success:false,valid:false,message:"Certificate not found."});
  const c=SKILLS_COURSES.find(x=>x.id===rows[0].course_id);
  res.json({success:true,valid:true,certificate:{...rows[0],course_title:c?.title||rows[0].course_id}});
});

app.get("/api/creator/access", creator, (req,res) => res.json({
  success:true,creator:true,email:req.user.email,role:req.user.role,
  unlimitedAccess:true,freeCourseAccess:true,freePdfDownload:true,
  freeOnlineReading:true,advertisementsDisabled:true
}));
app.get("/api/creator/dashboard", creator, async (req,res) => {
  const counts = {};
  for (const [key,sql] of Object.entries({
    users:"SELECT COUNT(*)::int count FROM users",
    enrolments:"SELECT COUNT(*)::int count FROM course_enrolments",
    payments:"SELECT COUNT(*)::int count FROM payments WHERE status='success'",
    certificates:"SELECT COUNT(*)::int count FROM certificates",
    pdfPurchases:"SELECT COUNT(*)::int count FROM pdf_purchases"
  })) counts[key]=(await pool.query(sql)).rows[0].count;
  const c=loadCurriculum();
  res.json({
    success:true,...counts,
    curriculumFile:!!curriculumFile(),levels:getLevels().length,
    subjects:getAllSubjects().length,
    diagrams:scanDiagrams().length,courses:SKILLS_COURSES.length,
    universityDatasetAvailable:loadUniversities().length>0||loadUniversityCourses().length>0,
    curriculumVersion:c.version||null
  });
});
app.get("/api/creator/curriculum", creator, (req,res) => res.json({success:true,curriculum:loadCurriculum()}));
app.get("/api/creator/payments", creator, async (req,res) => {
  const {rows}=await pool.query("SELECT p.*,u.email,u.name FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC");
  res.json({success:true,payments:rows});
});

/* Compatibility aliases used by existing frontage versions. */
app.get("/api/search", (req,res) => {
  const q=slug(req.query.q||"");
  if(!q)return res.json({success:true,results:[]});
  const results=[];
  for(const s of getAllSubjects()) {
    if(slug(s.name||s.title).includes(q))results.push({type:"subject",subject:s});
    for(const t of getTopics(s)) if(slug(t.name||t.title).includes(q))results.push({type:"topic",subject:s.name||s.title,topic:t});
  }
  res.json({success:true,results:results.slice(0,50)});
});

app.use("/data/diagrams", express.static(DIAGRAM_DIR, {
  fallthrough: true, index: false,
  setHeaders(res){res.setHeader("Cache-Control","public,max-age=86400");}
}));
app.use(express.static(PUBLIC_DIR, { index:"index.html" }));
app.get("/{*splat}", (req,res,next) => {
  if(req.path.startsWith("/api/") || req.path === "/payment/callback") return next();
  const index=path.join(PUBLIC_DIR,"index.html");
  if(!fs.existsSync(index))return res.status(404).send("PASSCOGH-MODOO index.html is missing.");
  res.sendFile(index);
});
app.use((err,req,res,next)=>{
  console.error("PASSCOGH-MODOO server error:",err);
  if(res.headersSent)return next(err);
  res.status(500).json({success:false,message:"PASSCOGH-MODOO server error."});
});

await ensureDatabase();
app.listen(PORT,"0.0.0.0",()=>console.log(
  `PASSCOGH-MODOO ${VERSION} running on port ${PORT}. Curriculum=${curriculumFile()?"FOUND":"MISSING"}, diagrams=${scanDiagrams().length}`
));
