import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import pg from "pg";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
 PASSCOGH-MODOO — MATCHED BACKEND
 This server is deliberately data-driven:
   - It DOES NOT replace the existing frontend.
   - It reads the existing data/passcogh_curriculum.json.
   - It scans the existing data/diagrams/ library automatically.
   - It exposes the API contract used by the current frontend.
   - It keeps WAEC 2012–2026 genuine papers disabled until authorization.
*/

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";
const PROJECT_ROOT = __dirname;
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const DIAGRAM_DIR = path.join(DATA_DIR, "diagrams");
const STORAGE_DIR = path.join(PROJECT_ROOT, "storage");
const PDF_DIR = path.join(STORAGE_DIR, "pdfs");
const CURRICULUM_FILE = path.join(DATA_DIR, "passcogh_curriculum.json");

for (const dir of [DATA_DIR, DIAGRAM_DIR, STORAGE_DIR, PDF_DIR]) fs.mkdirSync(dir, { recursive: true });

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const CREATOR_EMAIL = String(process.env.CREATOR_EMAIL || "awudumohammedmodoo@gmail.com").trim().toLowerCase();
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));
const READING_AD_MINUTES = 5;
const JHS_SHS_PDF_PRICE_GHS = 1;
const PRE_UNI_CHECK_PRICE_GHS = 5;
const COURSE_PRICE_GHS = 20;
const PAYSTACK_SECRET_KEY = String(process.env.PAYSTACK_SECRET_KEY || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

if (!JWT_SECRET) console.warn("WARNING: JWT_SECRET is not configured. Set a strong JWT_SECRET in Render.");
if (!process.env.DATABASE_URL) console.warn("WARNING: DATABASE_URL is not configured. Production data will not persist.");

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

/* ----------------------------- DATA ----------------------------- */

let curriculumCache = null;
let curriculumMtime = 0;

function fallbackCurriculum(error = null) {
  return {
    platform: "PASSCOGH-MODOO",
    version: "unavailable",
    levels: [],
    assessment_system: {},
    lesson_template: {},
    platform_features: {},
    skills_path: { enabled: true, paths: [] },
    university_guidance: { enabled: true, matching_rules: [] },
    pdf_catalogue: { enabled: true, items: [] },
    ...(error ? { error } : {})
  };
}

function loadCurriculum() {
  try {
    const stat = fs.statSync(CURRICULUM_FILE);
    if (curriculumCache && stat.mtimeMs === curriculumMtime) return curriculumCache;
    const parsed = JSON.parse(fs.readFileSync(CURRICULUM_FILE, "utf8"));
    curriculumCache = parsed;
    curriculumMtime = stat.mtimeMs;
    return parsed;
  } catch (e) {
    console.error("Curriculum load error:", e.message);
    curriculumCache = fallbackCurriculum("passcogh_curriculum.json could not be read.");
    curriculumMtime = 0;
    return curriculumCache;
  }
}

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function slug(value) { return norm(value).replace(/\s+/g, "-"); }
function idOrCode(x) { return String(x?.id || x?.code || slug(x?.name || x?.title || "")); }

function getLevels() {
  const c = loadCurriculum();
  if (Array.isArray(c.levels)) return c.levels;
  if (c.levels && typeof c.levels === "object") {
    return Object.entries(c.levels).map(([id, value]) => ({ id, ...(value || {}), name: value?.name || id }));
  }
  return [];
}
function getLevel(query) {
  const q = norm(query);
  return getLevels().find(l => norm(l.id) === q || norm(l.code) === q || norm(l.name) === q || norm(l.title) === q || slug(l.name) === slug(query)) || null;
}
function getSubjects(level) { return Array.isArray(level?.subjects) ? level.subjects : []; }
function allSubjects() {
  return getLevels().flatMap(level =>
    getSubjects(level).map(subject => ({
      ...subject,
      level: subject.level || level.name,
      levelId: level.id || slug(level.name)
    }))
  );
}
function getSubject(query, levelQuery = null) {
  const q = norm(query);
  const pool = levelQuery ? getSubjects(getLevel(levelQuery)) : allSubjects();
  return pool.find(s =>
    norm(s.id) === q ||
    norm(s.code) === q ||
    norm(s.name) === q ||
    norm(s.title) === q ||
    slug(s.name) === slug(query) ||
    slug(s.title) === slug(query)
  ) || null;
}
function getSubjectLevel(subject) {
  return getLevels().find(level => getSubjects(level).some(s => s === subject || idOrCode(s) === idOrCode(subject))) || null;
}
function getTopics(subject) { return Array.isArray(subject?.topics) ? subject.topics : []; }
function getTopic(subject, query) {
  const q = norm(query);
  return getTopics(subject).find(t =>
    norm(t.id) === q ||
    norm(t.code) === q ||
    norm(t.title) === q ||
    norm(t.name) === q ||
    slug(t.title) === slug(query) ||
    slug(t.name) === slug(query)
  ) || null;
}
function getLesson(topic) { return topic?.lesson && typeof topic.lesson === "object" ? topic.lesson : (topic?.content || topic || {}); }

function topicId(level, subject, topic) {
  return slug(`${level?.id || level?.name}-${idOrCode(subject)}-${topic?.id || topic?.title || topic?.name}`);
}
function topicRecord(level, subject, topic) {
  const lesson = getLesson(topic);
  return {
    id: topicId(level, subject, topic),
    level: { id: level?.id || slug(level?.name), name: level?.name || level?.title || "" },
    subject: { id: idOrCode(subject), name: subject?.name || subject?.title || "" },
    topic: topic?.title || topic?.name || "",
    ...lesson
  };
}

/* ----------------------------- DIAGRAM LIBRARY ----------------------------- */

let diagramCache = null;
let diagramSignature = "";

function diagramSignatureNow() {
  try {
    const st = fs.statSync(DIAGRAM_DIR);
    return `${st.mtimeMs}:${st.size}`;
  } catch { return "missing"; }
}
function buildDiagramIndex() {
  const out = [];
  const allowed = /\.(png|jpe?g|webp|gif|svg)$/i;
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (allowed.test(ent.name)) {
        const relative = path.relative(DIAGRAM_DIR, full).replaceAll("\\", "/");
        out.push({
          filename: ent.name,
          relative,
          tokens: new Set(norm(ent.name).split(" ").filter(x => x.length > 1))
        });
      }
    }
  }
  walk(DIAGRAM_DIR);
  return out;
}
function getDiagrams() {
  const sig = diagramSignatureNow();
  if (!diagramCache || sig !== diagramSignature) {
    diagramCache = buildDiagramIndex();
    diagramSignature = sig;
  }
  return diagramCache;
}
function scoreDiagram(file, level, subject, topic) {
  const q = new Set(norm([
    level?.name, subject?.name, subject?.code,
    topic?.title, topic?.name, topic?.id
  ].join(" ")).split(" ").filter(x => x.length > 1));
  let score = 0;
  for (const token of q) if (file.tokens.has(token)) score += token.length >= 5 ? 2 : 1;
  const fileText = norm(file.filename);
  const topicText = norm(topic?.title || topic?.name);
  const subjectText = norm(subject?.name);
  if (topicText && fileText.includes(topicText)) score += 12;
  if (subjectText && fileText.includes(subjectText)) score += 5;
  if (norm(level?.name) && fileText.includes(norm(level.name))) score += 2;
  return score;
}
function matchDiagrams(level, subject, topic, limit = 8) {
  return getDiagrams()
    .map(file => ({ file, score: scoreDiagram(file, level, subject, topic) }))
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score || a.file.filename.localeCompare(b.file.filename))
    .slice(0, limit)
    .map(({file, score}) => ({
      filename: file.filename,
      relative: file.relative,
      score,
      url: `/diagrams/${file.relative.split("/").map(encodeURIComponent).join("/")}`
    }));
}
function diagramPayload(level, subject, topic) {
  const lesson = getLesson(topic);
  return {
    curriculumDiagram: lesson.diagram_visual_aid || lesson.diagram || null,
    libraryMatches: matchDiagrams(level, subject, topic)
  };
}

/* ----------------------------- COURSES / SKILLS ----------------------------- */

function getSkills() {
  const skills = loadCurriculum().skills_path || {};
  return {
    enabled: skills.enabled !== false,
    name: skills.name || "PASSCOGH-MODOO Skills Path",
    description: skills.description || "Practical skills pathways.",
    paths: Array.isArray(skills.paths) ? skills.paths : []
  };
}
function getCourses() {
  return getSkills().paths.map((p, i) => ({
    id: String(p.id || slug(p.name || `skills-${i+1}`)),
    title: String(p.name || p.title || `Skills Course ${i+1}`),
    name: String(p.name || p.title || `Skills Course ${i+1}`),
    description: String(p.description || p.details || "PASSCOGH-MODOO practical skills course."),
    skills: Array.isArray(p.skills) ? p.skills : [],
    career: p.career || p.jobs || null,
    price: COURSE_PRICE_GHS,
    currency: "GHS",
    certificateEnabled: true,
    published: p.published !== false
  })).filter(c => c.published);
}
function getCourse(query) {
  const q = norm(query);
  return getCourses().find(c => norm(c.id) === q || norm(c.title) === q || slug(c.title) === slug(query)) || null;
}

/* ----------------------------- MATERIALS / TOPIC PDF CATALOGUE ----------------------------- */

function pdfCatalogue() {
  const c = loadCurriculum().pdf_catalogue || {};
  return c;
}
function pdfIdForTopic(level, subject, topic) { return `topic-${topicId(level, subject, topic)}`; }

function getPdfs() {
  const result = [];
  const catalogue = pdfCatalogue();
  const items = Array.isArray(catalogue.items) ? catalogue.items : [];

  // Preserve explicitly supplied catalogue entries without inventing their files.
  for (const [i, item] of items.entries()) {
    const title = typeof item === "string" ? item : String(item.title || item.name || `Material ${i+1}`);
    const id = typeof item === "object" && item.id ? String(item.id) : slug(title);
    const filename = typeof item === "object" && item.filename ? String(item.filename) : `${id}.pdf`;
    const rawPrice = typeof item === "object" && item.price != null ? Number(item.price) : null;
    result.push({
      id, title, filename,
      price: Number.isFinite(rawPrice) ? rawPrice : (/\b(jhs|shs)\b/i.test(title) ? JHS_SHS_PDF_PRICE_GHS : PRE_UNI_CHECK_PRICE_GHS),
      currency: "GHS",
      onlineReading: true,
      paidDownload: true,
      source: "curriculum-catalogue"
    });
  }

  // Add per-topic JHS/SHS PDF entitlements. These are virtual catalogue records;
  // the actual PDF must exist in storage/pdfs before a read/download can succeed.
  for (const level of getLevels()) {
    const isJhsShs = /^JHS\s*[123]$|^SHS\s*[123]$/i.test(String(level.name || ""));
    if (!isJhsShs) continue;
    for (const subject of getSubjects(level)) {
      for (const topic of getTopics(subject)) {
        result.push({
          id: pdfIdForTopic(level, subject, topic),
          title: `${level.name} — ${subject.name} — ${topic.title || topic.name}`,
          filename: `${pdfIdForTopic(level, subject, topic)}.pdf`,
          price: JHS_SHS_PDF_PRICE_GHS,
          currency: "GHS",
          onlineReading: true,
          paidDownload: true,
          levelId: level.id || slug(level.name),
          level: level.name,
          subjectId: idOrCode(subject),
          subject: subject.name || subject.title,
          topicId: topic.id || slug(topic.title || topic.name),
          topic: topic.title || topic.name,
          source: "curriculum-topic"
        });
      }
    }
  }
  return result;
}
function getPdf(query) {
  const q = norm(query);
  return getPdfs().find(p => norm(p.id) === q || norm(p.title) === q || slug(p.title) === slug(query)) || null;
}
function pdfFile(pdf) {
  const filename = path.basename(pdf.filename);
  return path.join(PDF_DIR, filename);
}

/* ----------------------------- DATABASE ----------------------------- */

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000
    })
  : null;

async function q(text, params = []) {
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  return pool.query(text, params);
}

async function initDb() {
  if (!pool) return;
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner','creator')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      reference TEXT UNIQUE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GHS',
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL DEFAULT 'paystack',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS pdf_purchases (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pdf_id TEXT NOT NULL,
      payment_reference TEXT UNIQUE NOT NULL REFERENCES payments(reference) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, pdf_id)
    );
    CREATE TABLE IF NOT EXISTS course_enrolments (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, course_id)
    );
    CREATE TABLE IF NOT EXISTS course_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      score NUMERIC(8,2),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, course_id, lesson_id)
    );
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL,
      score NUMERIC(8,2),
      total NUMERIC(8,2),
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS learning_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      score NUMERIC(8,2),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, topic_id)
    );
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pdf_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ad_due_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guidance_checks (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reference TEXT UNIQUE NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'pending',
      input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS certificates (
      id BIGSERIAL PRIMARY KEY,
      certificate_no TEXT UNIQUE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, course_id)
    );
    CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id);
    CREATE INDEX IF NOT EXISTS learning_progress_user_idx ON learning_progress(user_id);
    CREATE INDEX IF NOT EXISTS reading_user_idx ON reading_sessions(user_id);
  `);
}

function dbReady() { return Boolean(pool); }

/* ----------------------------- AUTH ----------------------------- */

function signToken(user) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is not configured.");
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
}
function bearer(req) {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}
async function currentUser(req) {
  const token = bearer(req);
  if (!token || !JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!dbReady()) return { id: decoded.sub, email: decoded.email, role: decoded.role, name: decoded.name || "" };
    const r = await q("SELECT id,email,name,role,created_at FROM users WHERE id=$1", [decoded.sub]);
    return r.rows[0] || null;
  } catch { return null; }
}
async function requireUser(req, res, next) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ success:false, message:"Authentication required." });
  req.user = user; next();
}
async function requireCreator(req, res, next) {
  const user = await currentUser(req);
  if (!user || user.role !== "creator") return res.status(403).json({ success:false, message:"Creator access denied." });
  req.user = user; next();
}
function safeEmail(value) {
  const e = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
function safeText(value, fallback="") { return String(value ?? fallback).trim(); }

/* ----------------------------- ACCESS HELPERS ----------------------------- */

async function ownsPdf(userId, pdfId) {
  if (!dbReady()) return false;
  const r = await q("SELECT 1 FROM pdf_purchases WHERE user_id=$1 AND pdf_id=$2 LIMIT 1", [userId, pdfId]);
  return Boolean(r.rows[0]);
}
async function hasCourseAccess(userId, courseId) {
  if (!dbReady()) return false;
  const r = await q("SELECT 1 FROM course_enrolments WHERE user_id=$1 AND course_id=$2 AND status='active' LIMIT 1", [userId, courseId]);
  return Boolean(r.rows[0]);
}
async function createPayment(userId, type, itemId, amount) {
  const reference = `PASSCOGH-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  await q(
    "INSERT INTO payments(reference,user_id,item_type,item_id,amount,currency,status) VALUES($1,$2,$3,$4,$5,'GHS','pending')",
    [reference,userId,type,itemId,amount]
  );
  return reference;
}
async function paystackInitialize(email, amount, reference, req) {
  if (!PAYSTACK_SECRET_KEY) return null;
  const callback_url = `${PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`}/payment/callback`;
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method:"POST",
    headers:{ Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({ email, amount:Math.round(Number(amount)*100), currency:"GHS", reference, callback_url })
  });
  const data = await response.json();
  if (!response.ok || !data.status || !data.data) throw new Error(data.message || "Payment initialization failed.");
  return data.data;
}
async function paystackVerify(reference) {
  if (!PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers:{ Authorization:`Bearer ${PAYSTACK_SECRET_KEY}` }
  });
  const data = await response.json();
  if (!response.ok || !data.status || !data.data) throw new Error(data.message || "Payment verification failed.");
  return data.data;
}
async function markPaymentSuccess(reference) {
  const r = await q("SELECT * FROM payments WHERE reference=$1", [reference]);
  const p = r.rows[0];
  if (!p) throw new Error("Payment record not found.");
  await q("UPDATE payments SET status='success',verified_at=NOW() WHERE reference=$1", [reference]);
  if (p.item_type === "pdf") {
    await q(
      "INSERT INTO pdf_purchases(user_id,pdf_id,payment_reference) VALUES($1,$2,$3) ON CONFLICT(user_id,pdf_id) DO NOTHING",
      [p.user_id,p.item_id,p.reference]
    );
  }
  if (p.item_type === "course") {
    await q(
      "INSERT INTO course_enrolments(user_id,course_id,status,progress) VALUES($1,$2,'active',0) ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'",
      [p.user_id,p.item_id]
    );
  }
}

/* ----------------------------- GUIDANCE ----------------------------- */

function gradeScore(grade) {
  const map = { A1:1,B2:2,B3:3,C4:4,C5:5,C6:6,D7:7,E8:8,F9:9 };
  return map[String(grade || "").toUpperCase()] ?? null;
}
function guidanceResult(payload) {
  const guidance = loadCurriculum().university_guidance || {};
  const results = payload?.wassceResults || payload?.results || {};
  const selectedGrades = Object.entries(results).filter(([,v]) => v);
  const aggregate = selectedGrades.map(([,v]) => gradeScore(v)).filter(v => v != null).reduce((a,b)=>a+b,0) || null;
  const career = safeText(payload?.preferredCareer);
  const region = safeText(payload?.preferredRegion);
  const interests = Array.isArray(payload?.programmeInterests) ? payload.programmeInterests : (payload?.programmeInterest ? [payload.programmeInterest] : []);
  const rules = Array.isArray(guidance.matching_rules) ? guidance.matching_rules : (Array.isArray(guidance.matchingRules) ? guidance.matchingRules : []);
  return {
    profile: { results, aggregate, preferredCareer:career, preferredRegion:region, programmeInterests:interests, outsideJobNeeds:safeText(payload?.outsideJobNeeds) },
    matchingRules: rules,
    externalDatasetRequired: true,
    note: "This guidance framework does not invent official admission requirements or rankings. Verified institution/course data must be maintained separately.",
    recommendations: []
  };
}

/* ----------------------------- ROUTES: AUTH ----------------------------- */

app.post("/api/auth/register", async (req,res) => {
  try {
    const email = safeEmail(req.body?.email), name = safeText(req.body?.name);
    if (!email || !name) return res.status(400).json({success:false,message:"Name and valid email are required."});
    if (!dbReady()) return res.status(503).json({success:false,message:"Database is not configured. Configure PostgreSQL before creating accounts."});
    const role = email === CREATOR_EMAIL ? "creator" : "learner";
    const r = await q(
      "INSERT INTO users(email,name,role) VALUES($1,$2,$3) RETURNING id,email,name,role,created_at",
      [email,name,role]
    );
    const user = r.rows[0];
    res.status(201).json({success:true,user,token:signToken(user)});
  } catch(e) {
    if (e.code === "23505") return res.status(409).json({success:false,message:"Account already exists."});
    console.error(e); res.status(500).json({success:false,message:"Registration failed."});
  }
});

app.post("/api/auth/login", async (req,res) => {
  try {
    const email = safeEmail(req.body?.email);
    if (!email) return res.status(400).json({success:false,message:"Enter a valid email address."});
    if (!dbReady()) return res.status(503).json({success:false,message:"Database is not configured."});
    const r = await q("SELECT id,email,name,role,created_at FROM users WHERE email=$1", [email]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({success:false,message:"Account not found. Please register first."});
    res.json({success:true,user,token:signToken(user)});
  } catch(e) { console.error(e); res.status(500).json({success:false,message:"Login failed."}); }
});
app.post("/api/auth/logout", requireUser, async (req,res)=>res.json({success:true,message:"Logged out."}));
app.get("/api/auth/me", requireUser, async (req,res)=>res.json({success:true,user:req.user}));

/* ----------------------------- ROUTES: HEALTH/CURRICULUM ----------------------------- */

app.get("/api/health", async (req,res) => {
  const c = loadCurriculum();
  const levels = getLevels();
  const subjects = allSubjects();
  const topicCount = subjects.reduce((n,s)=>n+getTopics(s).length,0);
  let database = "not_configured";
  if (pool) {
    try { await q("SELECT 1"); database = "postgresql"; } catch { database = "error"; }
  }
  res.json({
    success:true,
    service:"PASSCOGH-MODOO",
    version:c.version || "unknown",
    database,
    renderCompatible:true,
    curriculumFile:fs.existsSync(CURRICULUM_FILE),
    curriculumShape:Array.isArray(c.levels) ? "levels[]" : typeof c.levels,
    levels:levels.length,
    subjects:subjects.length,
    topics:topicCount,
    diagrams:getDiagrams().length,
    skillsPath:Boolean(c.skills_path?.enabled),
    universityGuidance:Boolean(c.university_guidance?.enabled),
    freeOnlineReading:true,
    readingAdIntervalMinutes:READING_AD_MINUTES,
    jhsShsTopicPdfPriceGhs:JHS_SHS_PDF_PRICE_GHS,
    preUniversityCheckPriceGhs:PRE_UNI_CHECK_PRICE_GHS,
    coursePriceGhs:COURSE_PRICE_GHS,
    waecPastQuestionsStatus:"authorisation_pending"
  });
});

app.get("/api/curriculum",(req,res)=>res.json({success:true,curriculum:loadCurriculum()}));
app.get("/api/levels",(req,res)=>res.json({
  success:true,
  levels:getLevels().map(l=>({
    ...l,
    id:l.id || slug(l.name),
    subjectCount:getSubjects(l).length,
    topicCount:getSubjects(l).reduce((n,s)=>n+getTopics(s).length,0)
  }))
}));
app.get("/api/levels/:level",(req,res)=>{
  const l=getLevel(req.params.level); if(!l)return res.status(404).json({success:false,message:"Level not found."});
  res.json({success:true,level:{...l,id:l.id||slug(l.name)}});
});
app.get("/api/levels/:level/subjects",(req,res)=>{
  const l=getLevel(req.params.level); if(!l)return res.status(404).json({success:false,message:"Level not found."});
  res.json({success:true,subjects:getSubjects(l).map(s=>({...s,level:l.name,levelId:l.id||slug(l.name)}))});
});
app.get("/api/subjects",(req,res)=>res.json({success:true,subjects:allSubjects().map(s=>({...s,id:idOrCode(s)}))}));
app.get("/api/subjects/:subject",(req,res)=>{
  const s=getSubject(req.params.subject); if(!s)return res.status(404).json({success:false,message:"Subject not found."});
  const l=getSubjectLevel(s);
  res.json({success:true,subject:{...s,id:idOrCode(s),level:l?.name,levelId:l?.id||slug(l?.name)},diagrams:matchDiagrams(l,s,{title:s.name})});
});
app.get("/api/subjects/:subject/topics",(req,res)=>{
  const s=getSubject(req.params.subject,req.query.level); if(!s)return res.status(404).json({success:false,message:"Subject not found."});
  res.json({success:true,topics:getTopics(s).map(t=>({...t,id:t.id||slug(t.title||t.name)}))});
});
app.get("/api/subjects/:subject/topics/:topic",(req,res)=>{
  const s=getSubject(req.params.subject,req.query.level); if(!s)return res.status(404).json({success:false,message:"Subject not found."});
  const t=getTopic(s,req.params.topic); if(!t)return res.status(404).json({success:false,message:"Topic not found."});
  const l=getSubjectLevel(s) || getLevel(req.query.level);
  res.json({success:true,topic:topicRecord(l,s,t),diagrams:diagramPayload(l,s,t)});
});
app.get("/api/subjects/:subject/topics/:topic/lesson",(req,res)=>{
  const s=getSubject(req.params.subject,req.query.level); if(!s)return res.status(404).json({success:false,message:"Subject not found."});
  const t=getTopic(s,req.params.topic); if(!t)return res.status(404).json({success:false,message:"Topic not found."});
  const l=getSubjectLevel(s) || getLevel(req.query.level);
  res.json({success:true,lesson:topicRecord(l,s,t),diagrams:diagramPayload(l,s,t)});
});
app.get("/api/subjects/:subject/topics/:topic/formulas",(req,res)=>{
  const s=getSubject(req.params.subject,req.query.level); if(!s)return res.status(404).json({success:false,message:"Subject not found."});
  const t=getTopic(s,req.params.topic); if(!t)return res.status(404).json({success:false,message:"Topic not found."});
  const lesson=getLesson(t);
  res.json({success:true,formulas:lesson.formula_summary||lesson.formulas||[],calculationMethod:loadCurriculum().assessment_system?.calculation_method||[]});
});
app.get("/api/subjects/:subject/topics/:topic/application",(req,res)=>{
  const s=getSubject(req.params.subject,req.query.level); if(!s)return res.status(404).json({success:false,message:"Subject not found."});
  const t=getTopic(s,req.params.topic); if(!t)return res.status(404).json({success:false,message:"Topic not found."});
  const lesson=getLesson(t);
  res.json({success:true,application:lesson.ghana_real_life_applications||lesson.real_life_application||[],examples:lesson.examples||[]});
});
app.get("/api/learning/topic",(req,res)=>{
  const s=getSubject(req.query.subject,req.query.level); if(!s)return res.status(404).json({success:false,message:"Subject not found."});
  const t=getTopic(s,req.query.topic); if(!t)return res.status(404).json({success:false,message:"Topic not found."});
  const l=getSubjectLevel(s)||getLevel(req.query.level);
  res.json({success:true,lesson:topicRecord(l,s,t),diagrams:diagramPayload(l,s,t)});
});
app.get("/api/assessment",(req,res)=>res.json({success:true,assessment:loadCurriculum().assessment_system||{}}));
app.get("/api/assessment-system",(req,res)=>res.json({success:true,assessmentSystem:loadCurriculum().assessment_system||{}}));
app.get("/api/lesson-template",(req,res)=>res.json({success:true,lessonTemplate:loadCurriculum().lesson_template||{}}));

/* ----------------------------- ROUTES: EXAMS/PRACTICAL ----------------------------- */

function allTopicQuestions() {
  const out=[];
  for (const level of getLevels()) for (const subject of getSubjects(level)) for (const topic of getTopics(subject)) {
    const lesson=getLesson(topic);
    const qs = Array.isArray(lesson.practice_questions) ? lesson.practice_questions :
      (Array.isArray(lesson.practice) ? lesson.practice : []);
    const answers = Array.isArray(lesson.answer_guide) ? lesson.answer_guide :
      (Array.isArray(lesson.answers) ? lesson.answers : []);
    const ws = Array.isArray(lesson.wASSCE_style_questions) ? lesson.wASSCE_style_questions : [];
    const pred = Array.isArray(lesson.wASSCE_2027_practice) ? lesson.wASSCE_2027_practice : [];
    out.push({level:level.name,subject:subject.name,topic:topic.title,practice:qs,answers, wASSCEStyle:ws, predicted2027:pred});
  }
  return out;
}
app.get("/api/questions",(req,res)=>{
  const items=[];
  for(const row of allTopicQuestions()){
    if(row.practice.length || row.wASSCEStyle.length || row.predicted2027.length) items.push(row);
  }
  res.json({success:true,questions:items});
});
app.get("/api/past-questions",(req,res)=>res.json({
  success:true,available:false,items:[],
  status:"authorisation_pending",
  message:"Genuine WASSCE 2012–2026 papers will only be published after authorised permission or a lawful licensed source is confirmed."
}));
app.get("/api/practical",(req,res)=>{
  const items=[];
  for(const level of getLevels()) for(const subject of getSubjects(level)) for(const topic of getTopics(subject)){
    const lesson=getLesson(topic);
    if(lesson.practical || lesson.practical_preparation) items.push({
      level:level.name,subject:subject.name,topic:topic.title,
      practical:lesson.practical || lesson.practical_preparation
    });
  }
  res.json({success:true,practical:items,method:loadCurriculum().assessment_system?.practical_method||[]});
});
app.get("/api/exam-guides",(req,res)=>res.json({
  success:true,
  examGuides:[
    {type:"WASSCE Practice",status:"available",description:"Original PASSCOGH-MODOO WASSCE-style practice."},
    {type:"2027 Predicted Practice",status:"available",description:"Original practice only; not leaked or guaranteed WAEC questions."},
    {type:"Past Questions 2012–2026",status:"authorisation_pending",description:"Waiting for WAEC permission/licensing or another lawful source."},
    {type:"Mock Exams",status:"framework_ready",description:"Mock examination framework supported by the assessment system."}
  ],
  assessment:loadCurriculum().assessment_system||{}
}));

/* ----------------------------- ROUTES: SKILLS / UNIVERSITY ----------------------------- */

app.get("/api/skills-path",(req,res)=>res.json({success:true,skillsPath:getSkills()}));
app.get("/api/skills-path/:id",(req,res)=>{
  const c=getCourse(req.params.id); if(!c)return res.status(404).json({success:false,message:"Skills path not found."});
  res.json({success:true,path:c});
});
app.get("/api/university-guidance",(req,res)=>{
  const g=loadCurriculum().university_guidance||{};
  res.json({success:true,guidance:{
    ...g,
    priceGhs:PRE_UNI_CHECK_PRICE_GHS,
    matchingRules:g.matching_rules||g.matchingRules||[],
    externalDatasetRequired:true
  }});
});
app.post("/api/university-guidance/match",requireUser,async(req,res)=>{
  try {
    if(req.user.role!=="creator"){
      const paid = await q(
        "SELECT 1 FROM guidance_checks WHERE user_id=$1 AND status='success' ORDER BY created_at DESC LIMIT 1",
        [req.user.id]
      );
      if(!paid.rows[0]) {
        return res.status(402).json({success:false,requiresPayment:true,price:PRE_UNI_CHECK_PRICE_GHS,currency:"GHS",message:`Pre-University guidance check costs GH₵${PRE_UNI_CHECK_PRICE_GHS}.`});
      }
    }
    const result=guidanceResult(req.body||{});
    if(dbReady()){
      const reference=`GUIDE-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      await q(
        "INSERT INTO guidance_checks(user_id,reference,amount,status,input_json,result_json,verified_at) VALUES($1,$2,$3,'success',$4,$5,NOW())",
        [req.user.id,reference,PRE_UNI_CHECK_PRICE_GHS,req.body||{},result]
      );
    }
    res.json({success:true,guidance:result});
  } catch(e) { console.error(e); res.status(500).json({success:false,message:"Guidance matching failed."}); }
});
app.post("/api/university-guidance/recommend",requireUser,async(req,res)=>{
  try {
    if(req.user.role!=="creator") {
      const paid=await q("SELECT 1 FROM guidance_checks WHERE user_id=$1 AND status='success' ORDER BY created_at DESC LIMIT 1",[req.user.id]);
      if(!paid.rows[0]) return res.status(402).json({success:false,requiresPayment:true,price:PRE_UNI_CHECK_PRICE_GHS,currency:"GHS",message:`Pre-University guidance check costs GH₵${PRE_UNI_CHECK_PRICE_GHS}.`});
    }
    const result=guidanceResult(req.body||{});
    res.json({success:true,guidance:result});
  } catch(e) { console.error(e); res.status(500).json({success:false,message:"Guidance matching failed."}); }
});
app.get("/api/universities",(req,res)=>{
  const c=loadCurriculum();
  const data=Array.isArray(c.universities) ? c.universities : [];
  res.json({success:true,universities:data,rankingStatus:data.length?"dataset_supplied":"not_supplied"});
});

/* ----------------------------- ROUTES: COURSES ----------------------------- */

app.get("/api/courses",(req,res)=>res.json({success:true,courses:getCourses()}));
app.get("/api/courses/:id",(req,res)=>{
  const c=getCourse(req.params.id); if(!c)return res.status(404).json({success:false,message:"Course not found."});
  res.json({success:true,course:c});
});
app.get("/api/courses/:id/access",requireUser,async(req,res)=>{
  const c=getCourse(req.params.id); if(!c)return res.status(404).json({success:false,message:"Course not found."});
  if(req.user.role==="creator") return res.json({success:true,access:true,creator:true,free:true,course:c});
  res.json({success:true,access:await hasCourseAccess(req.user.id,c.id),price:c.price,currency:"GHS",course:c});
});
app.get("/api/enrolments",requireUser,async(req,res)=>{
  const r=await q("SELECT * FROM course_enrolments WHERE user_id=$1 ORDER BY created_at DESC",[req.user.id]);
  res.json({success:true,enrolments:r.rows});
});
app.post("/api/courses/:id/progress",requireUser,async(req,res)=>{
  const c=getCourse(req.params.id); if(!c)return res.status(404).json({success:false,message:"Course not found."});
  if(req.user.role!=="creator" && !(await hasCourseAccess(req.user.id,c.id))) return res.status(403).json({success:false,message:"Purchase/enrolment required."});
  const progress=Math.max(0,Math.min(100,Number(req.body?.progress||0)));
  await q(
    `INSERT INTO course_enrolments(user_id,course_id,status,progress,completed_at)
     VALUES($1,$2,'active',$3,CASE WHEN $3>=100 THEN NOW() ELSE NULL END)
     ON CONFLICT(user_id,course_id) DO UPDATE SET progress=EXCLUDED.progress,status='active',completed_at=EXCLUDED.completed_at`,
    [req.user.id,c.id,progress]
  );
  res.json({success:true,courseId:c.id,progress});
});

/* ----------------------------- ROUTES: LEARNING PROGRESS ----------------------------- */

app.post("/api/progress/topic",requireUser,async(req,res)=>{
  const topicIdValue=safeText(req.body?.topicId);
  if(!topicIdValue)return res.status(400).json({success:false,message:"topicId is required."});
  const completed=Boolean(req.body?.completed);
  const score=req.body?.score == null ? null : Number(req.body.score);
  await q(
    `INSERT INTO learning_progress(user_id,topic_id,completed,score,updated_at)
     VALUES($1,$2,$3,$4,NOW())
     ON CONFLICT(user_id,topic_id) DO UPDATE SET completed=EXCLUDED.completed,score=EXCLUDED.score,updated_at=NOW()`,
    [req.user.id,topicIdValue,completed,Number.isFinite(score)?score:null]
  );
  res.json({success:true});
});
app.get("/api/progress/topics",requireUser,async(req,res)=>{
  const r=await q("SELECT * FROM learning_progress WHERE user_id=$1 ORDER BY updated_at DESC",[req.user.id]);
  res.json({success:true,progress:r.rows});
});
app.post("/api/quiz/attempt",requireUser,async(req,res)=>{
  const topicIdValue=safeText(req.body?.topicId);
  if(!topicIdValue)return res.status(400).json({success:false,message:"topicId is required."});
  await q(
    "INSERT INTO quiz_attempts(user_id,topic_id,score,total,answers) VALUES($1,$2,$3,$4,$5)",
    [req.user.id,topicIdValue,req.body?.score ?? null,req.body?.total ?? null,req.body?.answers || {}]
  );
  res.json({success:true});
});

/* ----------------------------- ROUTES: MATERIALS / READING / DOWNLOADS ----------------------------- */

app.get("/api/pdfs",(req,res)=>res.json({
  success:true,
  pdfs:getPdfs(),
  reading:{free:true,adIntervalMinutes:READING_AD_MINUTES},
  download:{paid:true,jhsShsPriceGhs:JHS_SHS_PDF_PRICE_GHS,preUniversityGuidePriceGhs:PRE_UNI_CHECK_PRICE_GHS},
  creatorAccess:"free"
}));
app.get("/api/pdfs/:id",(req,res)=>{
  const pdf=getPdf(req.params.id); if(!pdf)return res.status(404).json({success:false,message:"PDF not found."});
  res.json({success:true,pdf});
});

app.post("/api/reading/start",requireUser,async(req,res)=>{
  const pdf=getPdf(req.body?.pdfId);
  if(!pdf)return res.status(404).json({success:false,message:"PDF/material not found."});
  const file=pdfFile(pdf);
  if(!fs.existsSync(file)) return res.status(404).json({
    success:false,
    message:"This material is listed in the curriculum catalogue, but its protected PDF file has not yet been placed in storage/pdfs."
  });
  const started=new Date();
  const adDue=new Date(started.getTime()+READING_AD_MINUTES*60*1000);
  await q(
    "INSERT INTO reading_sessions(user_id,pdf_id,started_at,ad_due_at) VALUES($1,$2,$3,$4)",
    [req.user.id,pdf.id,started.toISOString(),adDue.toISOString()]
  );
  res.json({success:true,pdf,startedAt:started.toISOString(),adDueAt:adDue.toISOString(),expiresAt:adDue.toISOString(),adIntervalMinutes:READING_AD_MINUTES,advertisementsEnabled:req.user.role!=="creator"});
});

app.get("/api/reading/status",requireUser,async(req,res)=>{
  const r=await q("SELECT * FROM reading_sessions WHERE user_id=$1 ORDER BY started_at DESC LIMIT 1",[req.user.id]);
  if(!r.rows[0]) return res.json({success:true,active:false,adDue:false,adIntervalMinutes:READING_AD_MINUTES});
  const s=r.rows[0];
  const due=new Date(s.ad_due_at).getTime()<=Date.now();
  res.json({success:true,active:true,pdfId:s.pdf_id,adDue:due,adDueAt:s.ad_due_at,adIntervalMinutes:READING_AD_MINUTES,advertisementsEnabled:req.user.role!=="creator"});
});

app.get("/api/pdfs/:id/read",requireUser,async(req,res)=>{
  const pdf=getPdf(req.params.id);
  if(!pdf)return res.status(404).send("PDF not found.");
  const file=pdfFile(pdf);
  if(!fs.existsSync(file))return res.status(404).send("Protected PDF file not uploaded yet.");
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`inline; filename="${path.basename(pdf.filename).replaceAll('"','')}"`);
  res.sendFile(file);
});

app.get("/api/pdfs/:id/download-access",requireUser,async(req,res)=>{
  const pdf=getPdf(req.params.id); if(!pdf)return res.status(404).json({success:false,message:"PDF not found."});
  const creator=req.user.role==="creator";
  const purchased=creator || await ownsPdf(req.user.id,pdf.id);
  res.json({success:true,allowed:purchased,access:purchased,creator,free:creator,price:pdf.price,currency:"GHS",pdf});
});

app.get("/api/pdfs/:id/download",requireUser,async(req,res)=>{
  const pdf=getPdf(req.params.id); if(!pdf)return res.status(404).json({success:false,message:"PDF not found."});
  const allowed=req.user.role==="creator" || await ownsPdf(req.user.id,pdf.id);
  if(!allowed)return res.status(403).json({success:false,message:`Download requires payment of GH₵${pdf.price}.`});
  const file=pdfFile(pdf);
  if(!fs.existsSync(file))return res.status(404).json({success:false,message:"The protected PDF file has not been uploaded yet."});
  res.download(file,path.basename(pdf.filename));
});

/* ----------------------------- ROUTES: PAYMENTS ----------------------------- */

app.post("/api/payments/pdf",requireUser,async(req,res)=>{
  const pdf=getPdf(req.body?.pdfId);
  if(!pdf)return res.status(404).json({success:false,message:"PDF not found."});
  if(req.user.role==="creator")return res.json({success:true,free:true,access:true,allowed:true,pdf});
  if(await ownsPdf(req.user.id,pdf.id))return res.json({success:true,alreadyPaid:true,access:true,allowed:true,pdf});
  if(!pool)return res.status(503).json({success:false,message:"Payment database is not configured."});
  try {
    const ref=await createPayment(req.user.id,"pdf",pdf.id,pdf.price);
    const init=await paystackInitialize(req.user.email,pdf.price,ref,req);
    res.json({
      success:true,reference:ref,amount:pdf.price,currency:"GHS",
      authorization_url:init?.authorization_url||null,
      authorizationUrl:init?.authorization_url||null,
      access:false,
      paymentProvider:PAYSTACK_SECRET_KEY?"paystack":"not_configured",
      message:init? "Proceed to payment.":"PAYSTACK_SECRET_KEY is not configured yet."
    });
  } catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}
});

app.post("/api/payments/course",requireUser,async(req,res)=>{
  const c=getCourse(req.body?.courseId);
  if(!c)return res.status(404).json({success:false,message:"Course not found."});
  if(req.user.role==="creator")return res.json({success:true,free:true,access:true,enrolled:true,course:c});
  if(await hasCourseAccess(req.user.id,c.id))return res.json({success:true,alreadyPaid:true,access:true,enrolled:true,course:c});
  if(!pool)return res.status(503).json({success:false,message:"Payment database is not configured."});
  try {
    const ref=await createPayment(req.user.id,"course",c.id,COURSE_PRICE_GHS);
    const init=await paystackInitialize(req.user.email,COURSE_PRICE_GHS,ref,req);
    res.json({success:true,reference:ref,amount:COURSE_PRICE_GHS,currency:"GHS",authorization_url:init?.authorization_url||null,authorizationUrl:init?.authorization_url||null,access:false,paymentProvider:PAYSTACK_SECRET_KEY?"paystack":"not_configured"});
  } catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}
});

app.post("/api/payments/guidance",requireUser,async(req,res)=>{
  if(req.user.role==="creator")return res.json({success:true,free:true,access:true,amount:0,currency:"GHS"});
  if(!pool)return res.status(503).json({success:false,message:"Payment database is not configured."});
  try {
    const ref=await createPayment(req.user.id,"guidance","pre-university-check",PRE_UNI_CHECK_PRICE_GHS);
    const init=await paystackInitialize(req.user.email,PRE_UNI_CHECK_PRICE_GHS,ref,req);
    res.json({success:true,reference:ref,amount:PRE_UNI_CHECK_PRICE_GHS,currency:"GHS",authorization_url:init?.authorization_url||null,authorizationUrl:init?.authorization_url||null,paymentProvider:PAYSTACK_SECRET_KEY?"paystack":"not_configured"});
  } catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}
});

app.get("/api/payments/verify/:reference",requireUser,async(req,res)=>{
  try {
    if(!pool)return res.status(503).json({success:false,verified:false,message:"Payment database is not configured."});
    const r=await q("SELECT * FROM payments WHERE reference=$1 AND user_id=$2",[req.params.reference,req.user.id]);
    const p=r.rows[0];
    if(!p)return res.status(404).json({success:false,verified:false,message:"Payment record not found."});
    if(p.status==="success")return res.json({success:true,verified:true,itemType:p.item_type,itemId:p.item_id,reference:p.reference});
    const tx=await paystackVerify(p.reference);
    if(String(tx.currency).toUpperCase()!=="GHS" || Number(tx.amount)!==Math.round(Number(p.amount)*100) || tx.status!=="success") {
      return res.status(400).json({success:false,verified:false,message:"Payment verification failed."});
    }
    await markPaymentSuccess(p.reference);
    // Guidance payments create a paid check record immediately after verification.
    if(p.item_type==="guidance") {
      await q(
        "INSERT INTO guidance_checks(user_id,reference,amount,status,input_json,verified_at) VALUES($1,$2,$3,'success','{}',NOW()) ON CONFLICT(reference) DO UPDATE SET status='success',verified_at=NOW()",
        [p.user_id,p.reference,p.amount]
      );
    }
    res.json({success:true,verified:true,itemType:p.item_type,itemId:p.item_id,reference:p.reference});
  } catch(e){console.error(e);res.status(500).json({success:false,verified:false,message:e.message});}
});

app.get("/payment/callback",(req,res)=>{
  const ref=safeText(req.query?.reference);
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PASSCOGH-MODOO Payment</title></head><body style="font-family:system-ui;padding:30px;text-align:center"><h2>Payment received</h2><p>Return to PASSCOGH-MODOO to verify your transaction.</p><script>setTimeout(()=>location.href='/?payment_reference=${encodeURIComponent(ref)}',1200)</script></body></html>`);
});

/* ----------------------------- ROUTES: CERTIFICATES ----------------------------- */

app.post("/api/courses/:id/certificate",requireUser,async(req,res)=>{
  const c=getCourse(req.params.id); if(!c)return res.status(404).json({success:false,message:"Course not found."});
  if(!c.certificateEnabled)return res.status(400).json({success:false,message:"Certificate is not enabled for this course."});
  let completed=req.user.role==="creator";
  if(!completed){
    const r=await q("SELECT progress FROM course_enrolments WHERE user_id=$1 AND course_id=$2 AND status='active'",[req.user.id,c.id]);
    completed=Number(r.rows[0]?.progress||0)>=100;
  }
  if(!completed)return res.status(403).json({success:false,message:"Complete the course before requesting a certificate."});
  const old=await q("SELECT * FROM certificates WHERE user_id=$1 AND course_id=$2",[req.user.id,c.id]);
  if(old.rows[0])return res.json({success:true,certificate:old.rows[0]});
  const no=`PASSCOGH-${new Date().getFullYear()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  const r=await q("INSERT INTO certificates(certificate_no,user_id,course_id) VALUES($1,$2,$3) RETURNING *",[no,req.user.id,c.id]);
  res.json({success:true,certificate:r.rows[0]});
});
app.get("/api/certificates/:certificateNo",async(req,res)=>{
  const r=await q(
    "SELECT c.certificate_no,c.issued_at,u.name,u.email,c.course_id FROM certificates c JOIN users u ON u.id=c.user_id WHERE c.certificate_no=$1",
    [req.params.certificateNo]
  );
  const x=r.rows[0];
  if(!x)return res.status(404).json({success:false,valid:false,message:"Certificate not found."});
  res.json({success:true,valid:true,certificate:{...x,course_title:getCourse(x.course_id)?.title||x.course_id}});
});

/* ----------------------------- ROUTES: CREATOR ----------------------------- */

app.get("/api/creator/access",requireCreator,(req,res)=>res.json({
  success:true,creator:true,role:"creator",unlimitedAccess:true,freeCourseAccess:true,
  freeTopicPdfDownload:true,preUniversityGuidanceFree:true,advertisementsDisabled:true
}));
app.get("/api/creator/dashboard",requireCreator,async(req,res)=>{
  const counts={users:0,payments:0,enrolments:0,certificates:0,guidanceChecks:0};
  if(pool){
    for(const [k,sql] of Object.entries({
      users:"SELECT COUNT(*)::int AS n FROM users",
      payments:"SELECT COUNT(*)::int AS n FROM payments WHERE status='success'",
      enrolments:"SELECT COUNT(*)::int AS n FROM course_enrolments",
      certificates:"SELECT COUNT(*)::int AS n FROM certificates",
      guidanceChecks:"SELECT COUNT(*)::int AS n FROM guidance_checks WHERE status='success'"
    })){ const r=await q(sql); counts[k]=r.rows[0]?.n||0; }
  }
  res.json({
    success:true,...counts,
    curriculum:{levels:getLevels().length,subjects:allSubjects().length,topics:allSubjects().reduce((n,s)=>n+getTopics(s).length,0)},
    diagrams:getDiagrams().length,courses:getCourses().length,
    pricing:{jhsShsTopicPdfGhs:JHS_SHS_PDF_PRICE_GHS,preUniversityCheckGhs:PRE_UNI_CHECK_PRICE_GHS,courseGhs:COURSE_PRICE_GHS}
  });
});

/* ----------------------------- SEARCH ----------------------------- */

app.get("/api/search",(req,res)=>{
  const query=norm(req.query?.q);
  if(!query)return res.json({success:true,results:[]});
  const results=[];
  for(const level of getLevels()) for(const subject of getSubjects(level)){
    const subjectText=norm(`${subject.name} ${subject.code||""}`);
    if(subjectText.includes(query))results.push({type:"subject",level:level.id||slug(level.name),levelName:level.name,subject:subject.name,subjectId:idOrCode(subject)});
    for(const topic of getTopics(subject)){
      if(norm(`${topic.title||topic.name}`).includes(query))results.push({type:"topic",level:level.id||slug(level.name),levelName:level.name,subject:subject.name,subjectId:idOrCode(subject),topic:topic.title||topic.name,topicId:topic.id||slug(topic.title||topic.name)});
    }
  }
  for(const c of getCourses())if(norm(`${c.title} ${c.description}`).includes(query))results.push({type:"course",...c});
  res.json({success:true,results:results.slice(0,100)});
});

/* ----------------------------- DIAGRAM SERVING ----------------------------- */

app.get("/diagrams/*path",(req,res)=>{
  const raw=Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
  const relative=raw.split("/").map(decodeURIComponent).join("/");
  const root=path.resolve(DIAGRAM_DIR);
  const target=path.resolve(DIAGRAM_DIR,relative);
  if(!target.startsWith(root+path.sep) && target!==root)return res.status(400).send("Invalid diagram path.");
  if(!fs.existsSync(target) || !fs.statSync(target).isFile())return res.status(404).send("Diagram not found.");
  res.sendFile(target);
});

/* ----------------------------- STATIC FRONTEND / FALLBACK ----------------------------- */

if(fs.existsSync(PUBLIC_DIR)){
  app.use(express.static(PUBLIC_DIR, { extensions:["html"] }));
  app.get("/{*splat}",(req,res)=>{
    if(req.path.startsWith("/api/") || req.path.startsWith("/diagrams/"))return res.status(404).json({success:false,message:"Route not found."});
    res.sendFile(path.join(PUBLIC_DIR,"index.html"));
  });
} else {
  app.get("/",(req,res)=>res.status(404).send("PASSCOGH-MODOO public folder is missing."));
}

/* ----------------------------- ERROR HANDLER / START ----------------------------- */

app.use((err,req,res,next)=>{
  console.error(err);
  if(res.headersSent)return next(err);
  res.status(500).json({success:false,message:"PASSCOGH-MODOO server error."});
});

async function start() {
  try {
    await initDb();
    app.listen(PORT,HOST,()=>console.log(`PASSCOGH-MODOO running on http://${HOST}:${PORT}`));
  } catch(e) {
    console.error("Startup failed:",e);
    process.exit(1);
  }
}
start();
