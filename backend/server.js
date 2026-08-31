require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DIAGRAM_DIR = path.join(DATA_DIR, "diagrams");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./private_uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DIAGRAM_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Add the Render PostgreSQL connection string.");
}
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing. Add a strong JWT_SECRET in Render Environment Variables.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

const query = (sql, params) => pool.query(sql, params);

const CREATOR_EMAIL = String(
  process.env.CREATOR_EMAIL || process.env.OWNER_EMAIL || "awudumohammedmodoo@gmail.com"
).trim().toLowerCase();

const CONFIG = Object.freeze({
  onlineReadingFree: true,
  readingAdIntervalMinutes: 5,
  jhsShsTopicPdfPriceCedis: 1,
  preUniversityCheckPriceCedis: 5,
  skillsCoursePriceCedis: 20,
  currency: "GHS",
  creatorFreeUnlimited: true,
  waecPastQuestionsAuthorised: false,
  predictionNotice: "2027 practice is original PASSCOGH-MODOO predicted practice, not leaked or guaranteed WAEC questions."
});

function firstExisting(paths) {
  return paths.find(p => fs.existsSync(p)) || paths[0];
}

const CURRICULUM_FILE = firstExisting([
  path.join(DATA_DIR, "passcogh_carriculum.json"),
  path.join(DATA_DIR, "passcogh_curriculum.json"),
  path.join(DATA_DIR, "curriculum.json")
]);

const INSTITUTION_FILES = [
  path.join(DATA_DIR, "institution.json"),
  path.join(DATA_DIR, "institutions.json"),
  path.join(DATA_DIR, "university.json"),
  path.join(DATA_DIR, "universities.json")
];

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error("JSON read error:", file, error.message);
    return null;
  }
}

function loadCurriculum() {
  const data = readJson(CURRICULUM_FILE);
  if (data === null) {
    return {
      platform: "PASSCOGH-MODOO",
      version: "unknown",
      levels: [],
      platform_features: {},
      assessment_system: {},
      lesson_template: {}
    };
  }

  if (Array.isArray(data)) {
    return {
      platform: "PASSCOGH-MODOO",
      levels: data,
      platform_features: {},
      assessment_system: {},
      lesson_template: {}
    };
  }

  return data;
}

function getLevels() {
  const c = loadCurriculum();
  return Array.isArray(c.levels) ? c.levels : [];
}

function levelId(level) {
  return String(level?.id || level?.code || level?.name || level?.title || "").trim();
}

function levelName(level) {
  return String(level?.name || level?.title || level?.label || level?.id || "").trim();
}

function subjectsFromLevel(level) {
  if (Array.isArray(level?.subjects)) return level.subjects;
  if (Array.isArray(level?.courses)) return level.courses;
  if (Array.isArray(level?.subjectList)) return level.subjectList;
  return [];
}

function getAllSubjects() {
  const out = [];
  for (const level of getLevels()) {
    for (const subject of subjectsFromLevel(level)) {
      if (!subject || typeof subject !== "object") continue;
      out.push({
        ...subject,
        level: subject.level || levelName(level),
        levelId: subject.levelId || levelId(level)
      });
    }
  }
  return out;
}

function subjectName(subject) {
  return String(subject?.name || subject?.title || subject?.label || subject?.code || "").trim();
}

function subjectId(subject) {
  return String(subject?.id || subject?.code || subjectName(subject)).trim();
}

function findLevel(value) {
  const q = String(value || "").trim().toLowerCase();
  return getLevels().find(level =>
    [levelId(level), levelName(level), level?.code, level?.title]
      .some(x => String(x || "").trim().toLowerCase() === q)
  ) || null;
}

function findSubject(value, levelValue = null) {
  const q = String(value || "").trim().toLowerCase();
  const level = levelValue ? findLevel(levelValue) : null;
  const list = level ? subjectsFromLevel(level).map(s => ({...s, level: levelName(level), levelId: levelId(level)})) : getAllSubjects();

  return list.find(subject =>
    [subjectId(subject), subjectName(subject)]
      .some(x => String(x || "").trim().toLowerCase() === q)
  ) || null;
}

function getTopics(subject) {
  if (Array.isArray(subject?.topics)) return subject.topics;
  if (Array.isArray(subject?.units)) return subject.units;
  if (Array.isArray(subject?.sections)) {
    return subject.sections.map((x, i) =>
      typeof x === "string"
        ? { id: String(i + 1), title: x }
        : { ...x, id: x.id || String(i + 1), title: x.title || x.name || `Topic ${i + 1}` }
    );
  }
  return [];
}

function topicTitle(topic) {
  return String(topic?.title || topic?.name || topic?.label || topic?.id || "").trim();
}

function topicId(topic, index = 0) {
  return String(topic?.id || topic?.code || topicTitle(topic) || index + 1).trim();
}

function findTopic(subject, value) {
  const q = String(value || "").trim().toLowerCase();
  return getTopics(subject).find((topic, i) =>
    [topicId(topic, i), topicTitle(topic)]
      .some(x => String(x || "").trim().toLowerCase() === q)
  ) || null;
}

function lessonOf(topic) {
  if (topic?.lesson && typeof topic.lesson === "object") return topic.lesson;
  return topic || {};
}

function curriculumArray(name, aliases = []) {
  const c = loadCurriculum();
  for (const key of [name, ...aliases]) {
    if (Array.isArray(c[key])) return c[key];
  }
  return [];
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return [...new Set(
    normalizeText(value)
      .split(/\s+/)
      .filter(x => x.length >= 3)
  )];
}

function diagramFiles() {
  if (!fs.existsSync(DIAGRAM_DIR)) return [];
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(png|jpe?g|webp|gif|svg)$/i.test(entry.name)) out.push(full);
    }
  };
  walk(DIAGRAM_DIR);
  return out;
}

const DIAGRAM_INDEX = new Map();

function buildDiagramIndex() {
  DIAGRAM_INDEX.clear();
  for (const file of diagramFiles()) {
    const rel = path.relative(DIAGRAM_DIR, file).split(path.sep).join("/");
    const key = normalizeText(path.basename(file, path.extname(file)));
    DIAGRAM_INDEX.set(file, { file, rel, key, name: path.basename(file) });
  }
}

buildDiagramIndex();

function scoreDiagram(fileInfo, subject, topic) {
  const subjectTokens = tokens(subjectName(subject));
  const topicTokens = tokens(topicTitle(topic));
  const nameTokens = tokens(fileInfo.key);
  const all = new Set(nameTokens);

  let score = 0;
  for (const t of subjectTokens) if (all.has(t)) score += 8;
  for (const t of topicTokens) if (all.has(t)) score += 12;

  const joined = normalizeText(fileInfo.name);
  const topicText = normalizeText(topicTitle(topic));
  const subjectText = normalizeText(subjectName(subject));

  if (topicText && joined.includes(topicText)) score += 25;
  if (subjectText && joined.includes(subjectText)) score += 15;

  return score;
}

function matchDiagrams(subject, topic, limit = 6) {
  const ranked = [...DIAGRAM_INDEX.values()]
    .map(file => ({ ...file, score: scoreDiagram(file, subject, topic) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  return ranked.map(x => ({
    filename: x.name,
    path: `/data/diagrams/${x.rel}`,
    score: x.score
  }));
}

function diagramInfo(subject, topic) {
  const lesson = lessonOf(topic);
  const explicit = lesson.diagram_file || lesson.diagramFile || topic.diagram_file || topic.diagramFile;

  if (explicit) {
    const normalized = normalizeText(path.basename(String(explicit)));
    const exact = [...DIAGRAM_INDEX.values()].find(x =>
      normalizeText(x.name) === normalized ||
      normalizeText(x.key) === normalized ||
      x.rel === String(explicit).replace(/^data[\\/]+diagrams[\\/]+/, "")
    );
    if (exact) {
      return {
        matched: true,
        diagram: { filename: exact.name, path: `/data/diagrams/${exact.rel}`, score: 999 },
        matches: matchDiagrams(subject, topic).filter(x => x.filename !== exact.name)
      };
    }
  }

  const matches = matchDiagrams(subject, topic);
  return {
    matched: matches.length > 0,
    diagram: matches[0] || null,
    matches
  };
}

function institutionData() {
  for (const file of INSTITUTION_FILES) {
    const d = readJson(file);
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.institutions)) return d.institutions;
    if (Array.isArray(d?.universities)) return d.universities;
    if (Array.isArray(d?.items)) return d.items;
  }

  const c = loadCurriculum();
  if (Array.isArray(c.institutions)) return c.institutions;
  if (Array.isArray(c.universities)) return c.universities;
  return [];
}

function universityCourses() {
  const c = loadCurriculum();
  if (Array.isArray(c.universityCourses)) return c.universityCourses;
  if (Array.isArray(c.tertiaryCourses)) return c.tertiaryCourses;

  const out = [];
  for (const u of institutionData()) {
    const list = Array.isArray(u?.courses) ? u.courses :
      Array.isArray(u?.programmes) ? u.programmes : [];
    for (const course of list) {
      out.push({
        ...course,
        universityId: course.universityId || u.id || u.name || ""
      });
    }
  }
  return out;
}

function skillsPath() {
  const c = loadCurriculum();
  const stored = c.skills_path || c.skillsPath || {};
  const fallback = [
    {
      id: "technology",
      title: "Technology & Computing",
      description: "Coding, web development, digital skills, AI and data.",
      careers: ["Software Developer", "Web Developer", "Data Analyst", "IT Support"],
      courses: ["coding-programming", "web-development", "digital-skills", "data-excel", "ai-productivity"]
    },
    {
      id: "business",
      title: "Business & Entrepreneurship",
      description: "Business, marketing and practical enterprise skills.",
      careers: ["Entrepreneur", "Digital Marketer", "Business Assistant", "Sales & Marketing"],
      courses: ["entrepreneurship", "digital-marketing", "data-excel"]
    },
    {
      id: "creative",
      title: "Creative & Design",
      description: "Digital design and creative production.",
      careers: ["Graphic Designer", "Content Creator", "Digital Media Assistant"],
      courses: ["graphic-design", "digital-marketing"]
    },
    {
      id: "academic-success",
      title: "Academic Success",
      description: "Study, revision, examination and transition skills.",
      careers: ["Exam preparation", "Study skills", "Academic improvement"],
      courses: ["study-exam-skills"]
    }
  ];

  const paths = Array.isArray(stored.paths) ? stored.paths :
    Array.isArray(stored) ? stored : fallback;

  return {
    enabled: stored.enabled !== false,
    name: stored.name || "PASSCOGH-MODOO Skills Path",
    description: stored.description || "Practical skills and career pathways.",
    paths
  };
}

function universityGuidance() {
  const c = loadCurriculum();
  const stored = c.university_guidance || c.universityGuidance || {};
  return {
    enabled: true,
    name: stored.name || "PASSCOGH University & Course Guidance",
    input_fields: stored.input_fields || stored.inputFields || [
      "WASSCE results",
      "Preferred career",
      "Programme interests",
      "Preferred region",
      "Work/career goals"
    ],
    matching_rules: stored.matching_rules || stored.matchingRules || [],
    ranking_note: stored.ranking_note || stored.rankingNote ||
      "Rankings are shown only when a maintained legitimate dataset provides ranking information."
  };
}

const COURSES = [
  ["coding-programming", "Coding & Programming", "Programming foundations, problem solving and practical coding."],
  ["web-development", "Web Development", "Build responsive websites with HTML, CSS and JavaScript."],
  ["digital-skills", "Digital Skills", "Practical digital skills for school, work and everyday life."],
  ["data-excel", "Data & Excel", "Spreadsheets, formulas, charts and basic data handling."],
  ["graphic-design", "Graphic Design", "Design principles, digital graphics and creative workflows."],
  ["entrepreneurship", "Entrepreneurship", "Business ideas, customer value, budgeting and starting small."],
  ["digital-marketing", "Digital Marketing", "Content, online branding, audience growth and analytics."],
  ["study-exam-skills", "Study & Exam Skills", "Revision planning, active recall, time management and exam technique."],
  ["ai-productivity", "AI & Productivity", "Responsible AI use, research, productivity and creativity."]
].map(([id, title, description]) => ({
  id, title, description,
  price_ghc: CONFIG.skillsCoursePriceCedis,
  currency: CONFIG.currency,
  certificateEnabled: true,
  published: true
}));

function findCourse(value) {
  const q = String(value || "").trim().toLowerCase();
  return COURSES.find(c => c.id.toLowerCase() === q || c.title.toLowerCase() === q) || null;
}

function parseResults(body) {
  if (body?.results && !Array.isArray(body.results) && typeof body.results === "object") {
    return Object.entries(body.results).map(([subject, score]) => ({
      subject, score: Number(score)
    }));
  }

  const a = Array.isArray(body?.results) ? body.results :
    Array.isArray(body?.wassceResults) ? body.wassceResults :
    Array.isArray(body?.subjects) ? body.subjects : [];

  return a.map(x => ({
    subject: x.subject || x.name || x.title || x.code || "",
    score: Number(x.score ?? x.mark ?? x.percentage),
    grade: x.grade || ""
  }));
}

function gradeNumber(grade, score) {
  const g = String(grade || "").trim().toUpperCase();
  const map = { A1:1, B2:2, B3:3, C4:4, C5:5, C6:6, D7:7, E8:8, F9:9 };
  if (map[g]) return map[g];
  if (/^[1-9]$/.test(g)) return Number(g);

  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 80) return 1;
  if (n >= 75) return 2;
  if (n >= 70) return 3;
  if (n >= 65) return 4;
  if (n >= 60) return 5;
  if (n >= 55) return 6;
  if (n >= 50) return 7;
  if (n >= 45) return 8;
  return 9;
}

function sameSubject(a, b) {
  const x = normalizeText(a).replace(/\s+/g, "");
  const y = normalizeText(b).replace(/\s+/g, "");
  if (x === y) return true;
  const aliases = {
    mathematics: ["maths"],
    maths: ["mathematics"],
    englishlanguage: ["english"],
    english: ["englishlanguage"],
    integratedscience: ["science"],
    science: ["integratedscience"]
  };
  return (aliases[x] || []).includes(y) || (aliases[y] || []).includes(x);
}

function courseRequirements(course) {
  return course?.requirements || course?.requiredSubjects ||
    course?.subjectRequirements || course?.wassceRequirements || [];
}

function evaluateCourse(course, results, careerGoal) {
  const req = courseRequirements(course);
  if (!Array.isArray(req) || !req.length) {
    return {
      qualified: null,
      score: 50,
      reason: "No detailed entry requirements are stored for this course yet."
    };
  }

  const missing = [];
  let passed = 0;

  for (const r of req) {
    const subject = typeof r === "string"
      ? r
      : r.subject || r.name || r.code || "";

    const hit = results.find(x => sameSubject(x.subject, subject));
    if (!hit) {
      missing.push(subject);
      continue;
    }

    const g = gradeNumber(hit.grade, hit.score);
    const max = typeof r === "object" ? Number(r.maxGrade ?? r.minimumGrade) : NaN;

    if (!Number.isFinite(max) || (g !== null && g <= max)) passed++;
    else missing.push(subject);
  }

  const goalWords = normalizeText(careerGoal).split(/\s+/).filter(x => x.length >= 4);
  const courseText = normalizeText(JSON.stringify(course));
  const careerBonus = goalWords.reduce((n, w) => n + (courseText.includes(w) ? 10 : 0), 0);

  return {
    qualified: missing.length === 0,
    score: Math.min(100, Math.round((passed / req.length) * 100 + careerBonus)),
    passedRequirements: passed,
    totalRequirements: req.length,
    missingRequirements: missing,
    reason: missing.length
      ? `Missing or insufficient requirement(s): ${missing.join(", ")}`
      : "Your supplied results meet the stored requirements."
  };
}

function safeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";")
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => {
        const i = x.indexOf("=");
        return [i < 0 ? x : x.slice(0, i), i < 0 ? "" : decodeURIComponent(x.slice(i + 1))];
      })
  );
}

function getToken(req) {
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  return parseCookies(req.headers.cookie || "").pcm_token || null;
}

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `pcm_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

async function auth(req, res, next) {
  try {
    const t = getToken(req);
    if (!t) return res.status(401).json({ success:false, error:"Authentication required." });

    const payload = jwt.verify(t, process.env.JWT_SECRET);
    const r = await query(
      "SELECT id,name,email,role,created_at FROM users WHERE id=$1",
      [payload.sub]
    );

    if (!r.rowCount) return res.status(401).json({ success:false, error:"Account not found." });
    req.user = r.rows[0];
    next();
  } catch {
    res.status(401).json({ success:false, error:"Invalid or expired session." });
  }
}

async function optionalAuth(req, _res, next) {
  try {
    const t = getToken(req);
    if (t) {
      const payload = jwt.verify(t, process.env.JWT_SECRET);
      const r = await query(
        "SELECT id,name,email,role,created_at FROM users WHERE id=$1",
        [payload.sub]
      );
      if (r.rowCount) req.user = r.rows[0];
    }
  } catch {}
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user?.role)) return next();
    res.status(403).json({ success:false, error:"Permission denied." });
  };
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student'
        CHECK(role IN ('student','admin','owner')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subjects(
      id BIGSERIAL PRIMARY KEY,
      level TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(level,name)
    );

    CREATE TABLE IF NOT EXISTS institutions(
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT '',
      location TEXT DEFAULT '',
      website TEXT DEFAULT '',
      data JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS materials(
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      level TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      topic TEXT DEFAULT '',
      price_ghc NUMERIC(10,2) NOT NULL DEFAULT 1,
      free_read BOOLEAN NOT NULL DEFAULT true,
      storage_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS material_access(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      access_type TEXT NOT NULL CHECK(access_type IN('purchase','owner','admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,material_id)
    );

    CREATE TABLE IF NOT EXISTS courses(
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      price_ghc NUMERIC(10,2) NOT NULL DEFAULT 20,
      lessons JSONB NOT NULL DEFAULT '[]',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS enrollments(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      progress INTEGER NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,course_id)
    );

    CREATE TABLE IF NOT EXISTS payments(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reference TEXT UNIQUE NOT NULL,
      amount_ghc NUMERIC(10,2) NOT NULL,
      purpose TEXT NOT NULL,
      item_id BIGINT,
      status TEXT NOT NULL DEFAULT 'pending',
      paystack_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS certificates(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      certificate_code TEXT UNIQUE NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,course_id)
    );

    CREATE TABLE IF NOT EXISTS reading_sessions(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      material_id BIGINT,
      pdf_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  // Compatibility with an older materials table that may not have topic yet.
  await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS topic TEXT DEFAULT ''`);

  // Seed only the paid skills catalogue; curriculum subjects are NEVER replaced by skeleton subjects.
  for (const course of COURSES) {
    const lessons = [
      { title:"Lesson 1 — Foundations", content:`Learn the foundations of ${course.title}.` },
      { title:"Lesson 2 — Guided Practice", content:"Work through guided examples and practical exercises." },
      { title:"Lesson 3 — Assessment", content:"Complete an assessment and review mistakes." }
    ];
    await query(
      `INSERT INTO courses(title,description,price_ghc,lessons)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(title) DO UPDATE
       SET description=EXCLUDED.description,
           price_ghc=EXCLUDED.price_ghc,
           lessons=EXCLUDED.lessons`,
      [course.title, course.description, CONFIG.skillsCoursePriceCedis, JSON.stringify(lessons)]
    );
  }

  const ownerEmail = safeEmail(process.env.OWNER_EMAIL || CREATOR_EMAIL);
  const ownerPassword = String(process.env.OWNER_PASSWORD || "");
  if (ownerEmail && ownerPassword && !ownerPassword.includes("CHANGE_THIS")) {
    const existing = await query("SELECT id FROM users WHERE LOWER(email)=LOWER($1)", [ownerEmail]);
    if (!existing.rowCount) {
      const passwordHash = await bcrypt.hash(ownerPassword, 12);
      await query(
        `INSERT INTO users(name,email,password_hash,role)
         VALUES($1,$2,$3,'owner')`,
        ["Awudu Mohammed Modoo Ayariga", ownerEmail, passwordHash]
      );
    }
  }
}

async function paystackRequest(endpoint, options = {}) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || secret.includes("REPLACE_ME")) {
    throw new Error("Paystack is not configured. Add PAYSTACK_SECRET_KEY in Render Environment Variables.");
  }

  const response = await fetch("https://api.paystack.co" + endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();
  if (!response.ok || !data.status) throw new Error(data.message || "Paystack request failed.");
  return data;
}

function publicBase(req) {
  return String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`)
    .replace(/\/+$/, "");
}

function amountMatches(a, b) {
  return Math.round(Number(a) * 100) === Math.round(Number(b));
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(",").map(x => x.trim())
    : true,
  credentials: true
}));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended:true, limit:"1mb" }));
app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

/* ---------------- HEALTH ---------------- */

app.get("/api/health", (_req, res) => {
  const c = loadCurriculum();
  const levels = getLevels();
  const subjects = getAllSubjects();
  let topics = 0;
  for (const s of subjects) topics += getTopics(s).length;

  const diagrams = diagramFiles().length;
  const institutions = institutionData();
  const universityCoursesCount = universityCourses().length;
  const skills = skillsPath();
  const university = universityGuidance();

  res.json({
    success: true,
    service: "PASSCOGH-MODOO",
    version: c.version || "current",
    database: "PostgreSQL",
    curriculumFile: path.basename(CURRICULUM_FILE),
    curriculumFileExists: fs.existsSync(CURRICULUM_FILE),
    curriculumShape: Array.isArray(c) ? "array" : typeof c,
    levels: levels.length,
    subjects: subjects.length,
    topics,
    diagrams,
    diagramDirectory: path.relative(ROOT, DIAGRAM_DIR).replace(/\\/g, "/"),
    diagramLibraryReady: diagrams > 0,
    skillsPath: true,
    skillsPaths: skills.paths.length,
    universityGuidance: true,
    universityDatasetAvailable: institutions.length > 0 || universityCoursesCount > 0,
    institutions: institutions.length,
    universityCourses: universityCoursesCount,
    onlineReading: "free",
    freeOnlineReading: true,
    readingAdIntervalMinutes: CONFIG.readingAdIntervalMinutes,
    jhsShsTopicPdfPriceCedis: CONFIG.jhsShsTopicPdfPriceCedis,
    preUniversityCheckPriceCedis: CONFIG.preUniversityCheckPriceCedis,
    skillsCoursePriceCedis: CONFIG.skillsCoursePriceCedis,
    creatorFreeUnlimited: true,
    waecPastQuestionsAuthorised: CONFIG.waecPastQuestionsAuthorised,
    paymentProvider: process.env.PAYSTACK_SECRET_KEY ? "configured" : "not_configured"
  });
});

/* ---------------- AUTH ---------------- */

app.post("/api/auth/register", async (req,res,next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = safeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || password.length < 8) {
      return res.status(400).json({
        success:false,
        error:"Name, valid email and a password of at least 8 characters are required."
      });
    }

    const role = email === CREATOR_EMAIL ? "owner" : "student";
    const passwordHash = await bcrypt.hash(password, 12);

    const r = await query(
      `INSERT INTO users(name,email,password_hash,role)
       VALUES($1,$2,$3,$4)
       RETURNING id,name,email,role,created_at`,
      [name,email,passwordHash,role]
    );

    const token = signToken(r.rows[0]);
    setSessionCookie(res, token);
    res.status(201).json({success:true,user:r.rows[0],token});
  } catch (e) {
    if (String(e.message).includes("duplicate key")) {
      return res.status(409).json({success:false,error:"An account with that email already exists."});
    }
    next(e);
  }
});

app.post("/api/auth/login", async (req,res,next) => {
  try {
    const email = safeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) return res.status(400).json({success:false,error:"Email and password are required."});

    const r = await query(
      "SELECT id,name,email,password_hash,role,created_at FROM users WHERE LOWER(email)=LOWER($1)",
      [email]
    );

    if (!r.rowCount) return res.status(401).json({success:false,error:"Account not found."});

    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({success:false,error:"Incorrect password."});

    const user = {
      id:r.rows[0].id,name:r.rows[0].name,email:r.rows[0].email,
      role:r.rows[0].role,created_at:r.rows[0].created_at
    };
    const token = signToken(user);
    setSessionCookie(res, token);
    res.json({success:true,user,token});
  } catch(e) { next(e); }
});

app.post("/api/auth/logout", optionalAuth, (req,res) => {
  res.setHeader("Set-Cookie","pcm_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({success:true});
});

app.get("/api/auth/me", auth, (req,res) =>
  res.json({success:true,user:req.user})
);

/* ---------------- CURRICULUM ---------------- */

app.get("/api/curriculum", (_req,res) =>
  res.json({success:true,curriculum:loadCurriculum()})
);

app.get("/api/levels", (_req,res) =>
  res.json({success:true,levels:getLevels()})
);

app.get("/api/levels/:level", (req,res) => {
  const level = findLevel(req.params.level);
  if (!level) return res.status(404).json({success:false,error:"Level not found."});
  res.json({success:true,level});
});

app.get("/api/levels/:level/subjects", (req,res) => {
  const level = findLevel(req.params.level);
  if (!level) return res.status(404).json({success:false,error:"Level not found."});

  res.json({
    success:true,
    level:levelName(level),
    subjects:subjectsFromLevel(level)
  });
});

app.get("/api/subjects", (req,res) => {
  const level = req.query.level ? findLevel(req.query.level) : null;
  const subjects = level
    ? subjectsFromLevel(level).map(s => ({...s,level:levelName(level),levelId:levelId(level)}))
    : getAllSubjects();

  res.json({success:true,subjects});
});

app.get("/api/subjects/:subject", (req,res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  if (!subject) return res.status(404).json({success:false,error:"Subject not found."});
  res.json({success:true,subject});
});

app.get("/api/subjects/:subject/topics", (req,res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  if (!subject) return res.status(404).json({success:false,error:"Subject not found."});

  res.json({
    success:true,
    subject:subjectName(subject),
    level:subject.level || "",
    topics:getTopics(subject).map((t,i) => ({
      ...t,
      id:topicId(t,i),
      title:topicTitle(t)
    }))
  });
});

app.get("/api/subjects/:subject/topics/:topic", (req,res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  if (!subject) return res.status(404).json({success:false,error:"Subject not found."});

  const topic = findTopic(subject, req.params.topic);
  if (!topic) return res.status(404).json({success:false,error:"Topic not found."});

  const lesson = lessonOf(topic);
  const diagrams = diagramInfo(subject, topic);

  res.json({
    success:true,
    level:subject.level || "",
    subject:subjectName(subject),
    topic:{
      ...topic,
      id:topicId(topic),
      title:topicTitle(topic)
    },
    lesson,
    diagrams,
    sections:{
      lesson:lesson.notes || lesson.content || lesson.lesson || "",
      keyTerms:lesson.key_terms || lesson.keyTerms || lesson.terms || [],
      concepts:lesson.concepts || lesson.concept || [],
      ghanaApplication:lesson.real_life_application || lesson.realLifeApplication || lesson.applications || [],
      examples:lesson.examples || [],
      howToDraw:lesson.how_to_draw || lesson.howToDraw || "",
      formulas:lesson.formula_summary || lesson.formulas || lesson.formulaSheet || [],
      commonMistakes:lesson.common_mistakes || lesson.commonMistakes || [],
      memoryAid:lesson.memory_aid || lesson.memoryAid || "",
      practical:lesson.practical || lesson.practicalPreparation || [],
      practice:lesson.practice || [],
      wassceStyle:lesson.wassce_style || lesson.wassceStyle || [],
      predicted2027:lesson.predicted_2027 || lesson.predicted2027 || [],
      answers:lesson.answers || lesson.answerGuide || []
    }
  });
});

app.get("/api/subjects/:subject/topics/:topic/formulas", (req,res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  const topic = subject && findTopic(subject, req.params.topic);
  if (!subject) return res.status(404).json({success:false,error:"Subject not found."});
  if (!topic) return res.status(404).json({success:false,error:"Topic not found."});
  const lesson = lessonOf(topic);
  res.json({success:true,formulas:lesson.formula_summary || lesson.formulas || lesson.formulaSheet || []});
});

app.get("/api/subjects/:subject/topics/:topic/application", (req,res) => {
  const subject = findSubject(req.params.subject, req.query.level || null);
  const topic = subject && findTopic(subject, req.params.topic);
  if (!subject) return res.status(404).json({success:false,error:"Subject not found."});
  if (!topic) return res.status(404).json({success:false,error:"Topic not found."});
  const lesson = lessonOf(topic);
  res.json({
    success:true,
    realLifeApplication:lesson.real_life_application || lesson.realLifeApplication || lesson.applications || "",
    examples:Array.isArray(lesson.examples) ? lesson.examples : []
  });
});

app.get("/api/assessment-system", (_req,res) =>
  res.json({success:true,assessmentSystem:loadCurriculum().assessment_system || {}})
);

app.get("/api/lesson-template", (_req,res) =>
  res.json({success:true,lessonTemplate:loadCurriculum().lesson_template || {}})
);

app.get("/api/questions", (_req,res) =>
  res.json({success:true,questions:curriculumArray("questions",["questionBank"])})
);

app.get("/api/past-questions", (_req,res) =>
  res.json({
    success:true,
    authorised:CONFIG.waecPastQuestionsAuthorised,
    pastQuestions:curriculumArray("pastQuestions")
  })
);

app.get("/api/practical", (_req,res) =>
  res.json({success:true,practical:curriculumArray("practical",["practicalPreparation"])})
);

app.get("/api/exam-guides", (_req,res) =>
  res.json({success:true,examGuides:curriculumArray("examGuides")})
);

/* ---------------- DIAGRAM LIBRARY ---------------- */

app.get("/api/diagrams", (req,res) => {
  const subject = req.query.subject ? findSubject(req.query.subject, req.query.level || null) : null;
  const topic = subject && req.query.topic ? findTopic(subject, req.query.topic) : null;

  if (subject && topic) {
    return res.json({
      success:true,
      count:diagramInfo(subject,topic).matches.length,
      matches:diagramInfo(subject,topic).matches
    });
  }

  res.json({
    success:true,
    count:diagramFiles().length,
    directory:"data/diagrams",
    files:diagramFiles().map(file => ({
      filename:path.basename(file),
      path:`/data/diagrams/${path.relative(DIAGRAM_DIR,file).split(path.sep).join("/")}`
    }))
  });
});

app.get("/data/diagrams/*splat", (req,res) => {
  const requested = Array.isArray(req.params.splat)
    ? req.params.splat.join("/")
    : String(req.params.splat || "");

  const safe = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = path.join(DIAGRAM_DIR, safe);
  const root = path.resolve(DIAGRAM_DIR);
  const resolved = path.resolve(file);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return res.status(400).send("Invalid diagram path.");
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return res.status(404).send("Diagram not found.");
  }

  res.sendFile(resolved);
});

/* ---------------- SKILLS PATH ---------------- */

app.get("/api/skills-path", (_req,res) =>
  res.json({success:true,skillsPath:skillsPath()})
);

app.get("/api/skills-path/:id", (req,res) => {
  const s = skillsPath();
  const q = String(req.params.id).toLowerCase();
  const found = s.paths.find(x =>
    String(x.id || "").toLowerCase() === q ||
    String(x.title || x.name || "").toLowerCase() === q
  );

  if (!found) return res.status(404).json({success:false,error:"Skills path not found."});
  res.json({success:true,path:found});
});

/* ---------------- COURSES ---------------- */

app.get("/api/courses", async (_req,res,next) => {
  try {
    const r = await query(
      `SELECT id,title,description,price_ghc,lessons,active
       FROM courses WHERE active=true ORDER BY id`
    );
    res.json({
      success:true,
      courses:r.rows.map(c => ({
        ...c,
        price_ghc:Number(c.price_ghc),
        currency:"GHS",
        certificateEnabled:true
      }))
    });
  } catch(e) { next(e); }
});

app.get("/api/courses/:id", async (req,res,next) => {
  try {
    const r = await query("SELECT id,title,description,price_ghc,lessons,active FROM courses WHERE id=$1",[req.params.id]);
    if (!r.rowCount) return res.status(404).json({success:false,error:"Course not found."});
    res.json({success:true,course:{...r.rows[0],price_ghc:Number(r.rows[0].price_ghc),currency:"GHS",certificateEnabled:true}});
  } catch(e) { next(e); }
});

app.get("/api/courses/:id/access", auth, async (req,res,next) => {
  try {
    if (["owner","admin"].includes(req.user.role)) {
      return res.json({success:true,access:true,creator:true});
    }
    const r = await query(
      "SELECT * FROM enrollments WHERE user_id=$1 AND course_id=$2",
      [req.user.id,req.params.id]
    );
    res.json({success:true,access:r.rowCount>0,enrolment:r.rows[0] || null});
  } catch(e) { next(e); }
});

app.get("/api/enrolments", auth, async (req,res,next) => {
  try {
    const r = await query(
      `SELECT e.*,c.title,c.description,c.price_ghc
       FROM enrollments e JOIN courses c ON c.id=e.course_id
       WHERE e.user_id=$1 ORDER BY e.created_at DESC`,
      [req.user.id]
    );
    res.json({success:true,enrolments:r.rows});
  } catch(e) { next(e); }
});

app.post("/api/courses/:id/progress", auth, async (req,res,next) => {
  try {
    const progress = Math.max(0,Math.min(100,Math.round(Number(req.body.progress))));
    if (!Number.isFinite(progress)) return res.status(400).json({success:false,error:"Progress must be a number from 0 to 100."});

    if (!["owner","admin"].includes(req.user.role)) {
      const e = await query(
        "SELECT 1 FROM enrollments WHERE user_id=$1 AND course_id=$2",
        [req.user.id,req.params.id]
      );
      if (!e.rowCount) return res.status(403).json({success:false,error:"Course enrolment required."});
    }

    const completed = progress >= 100;
    const r = await query(
      `INSERT INTO enrollments(user_id,course_id,progress,completed)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(user_id,course_id)
       DO UPDATE SET progress=EXCLUDED.progress,completed=EXCLUDED.completed
       RETURNING *`,
      [req.user.id,req.params.id,progress,completed]
    );
    res.json({success:true,enrolment:r.rows[0]});
  } catch(e) { next(e); }
});

/* ---------------- UNIVERSITY / COURSE GUIDE ---------------- */

app.get("/api/university-guidance", (_req,res) =>
  res.json({
    success:true,
    guidance:universityGuidance(),
    datasetAvailable:institutionData().length > 0 || universityCourses().length > 0
  })
);

app.get("/api/universities", (_req,res) => {
  const universities = institutionData();
  res.json({
    success:true,
    universities,
    rankingAvailable:universities.some(x => x.rank != null || x.ranking != null || x.position != null),
    rankingNote:universityGuidance().ranking_note
  });
});

app.get("/api/university-courses", (_req,res) =>
  res.json({success:true,courses:universityCourses()})
);

app.post("/api/university/recommend", (req,res) => {
  try {
    const results = parseResults(req.body);
    const goal = String(req.body.jobGoal || req.body.careerGoal || req.body.outsideJob || "").trim();
    const courses = universityCourses();
    const universities = institutionData();

    const qualifiedCourses = courses
      .map(c => ({...c,...evaluateCourse(c,results,goal)}))
      .filter(c => c.qualified === true)
      .sort((a,b) => b.score-a.score);

    const possibleCourses = courses
      .map(c => ({...c,...evaluateCourse(c,results,goal)}))
      .filter(c => c.qualified !== true)
      .sort((a,b) => b.score-a.score)
      .slice(0,20);

    const rankedUniversities = universities
      .map(u => {
        const rank = Number(u.rank ?? u.ranking ?? u.position);
        return {
          ...u,
          recommendationScore:Number.isFinite(rank) ? Math.max(0,100-rank) : null
        };
      })
      .sort((a,b) => (b.recommendationScore ?? -1) - (a.recommendationScore ?? -1));

    res.json({
      success:true,
      resultsReceived:results,
      jobGoal:goal,
      qualifiedCourses,
      possibleCourses,
      universityRanking:rankedUniversities,
      dataAvailable:courses.length > 0 || universities.length > 0,
      note:courses.length
        ? "Recommendations use only requirements contained in the maintained PASSCOGH-MODOO university/course data."
        : "No detailed university-course dataset is currently loaded. The guidance interface is active, but real institution/course data must be supplied before specific recommendations or rankings can be claimed."
    });
  } catch(e) {
    console.error(e);
    res.status(500).json({success:false,error:"Unable to calculate university recommendations."});
  }
});

/* ---------------- PDF / MATERIAL ACCESS ---------------- */

const upload = multer({
  storage:multer.diskStorage({
    destination:(_req,_file,cb) => cb(null,UPLOAD_DIR),
    filename:(_req,file,cb) =>
      cb(null,crypto.randomBytes(18).toString("hex") + path.extname(file.originalname))
  }),
  limits:{fileSize:50*1024*1024},
  fileFilter:(_req,file,cb) => cb(null,file.mimetype === "application/pdf")
});

app.get("/api/materials", async (_req,res,next) => {
  try {
    const r = await query(
      `SELECT id,title,description,level,subject,topic,price_ghc,free_read,original_name,created_at
       FROM materials ORDER BY created_at DESC`
    );
    res.json({
      success:true,
      materials:r.rows.map(m => ({
        ...m,
        price_ghc:Number(m.price_ghc),
        onlineReading:true,
        paidDownload:true
      }))
    });
  } catch(e) { next(e); }
});

app.get("/api/materials/:id/read", optionalAuth, async (req,res,next) => {
  try {
    const r = await query("SELECT * FROM materials WHERE id=$1",[req.params.id]);
    if (!r.rowCount) return res.status(404).json({success:false,error:"Material not found."});
    const m = r.rows[0];

    // Online reading is free. Login is not required for the reading rule itself.
    const file = path.join(UPLOAD_DIR,m.storage_name);
    if (!fs.existsSync(file)) return res.status(404).json({success:false,error:"File unavailable."});

    if (req.user) {
      const expires = new Date(Date.now() + CONFIG.readingAdIntervalMinutes * 60 * 1000);
      await query(
        `INSERT INTO reading_sessions(user_id,material_id,pdf_id,expires_at)
         VALUES($1,$2,$3,$4)`,
        [req.user.id,m.id,String(m.id),expires]
      );
    }

    res.setHeader("Content-Type",m.mime_type);
    res.setHeader("Content-Disposition",`inline; filename="${String(m.original_name).replace(/"/g,"")}"`);
    res.setHeader("Cache-Control","private,no-store");
    res.sendFile(file);
  } catch(e) { next(e); }
});

app.get("/api/reading/config", (_req,res) =>
  res.json({
    success:true,
    onlineReadingFree:true,
    adIntervalMinutes:CONFIG.readingAdIntervalMinutes,
    creatorAdsDisabled:true
  })
);

app.post("/api/reading/start", auth, async (req,res,next) => {
  try {
    const expires = new Date(Date.now() + CONFIG.readingAdIntervalMinutes * 60 * 1000);
    await query(
      `INSERT INTO reading_sessions(user_id,material_id,pdf_id,expires_at)
       VALUES($1,$2,$3,$4)`,
      [req.user.id,req.body.materialId || null,String(req.body.pdfId || req.body.materialId || ""),expires]
    );
    res.json({
      success:true,
      onlineReadingFree:true,
      expiresAt:expires.toISOString(),
      adIntervalMinutes:req.user.role === "owner" ? null : CONFIG.readingAdIntervalMinutes,
      advertisementsEnabled:req.user.role !== "owner"
    });
  } catch(e) { next(e); }
});

app.get("/api/materials/:id/download", auth, async (req,res,next) => {
  try {
    const r = await query("SELECT * FROM materials WHERE id=$1",[req.params.id]);
    if (!r.rowCount) return res.status(404).json({success:false,error:"Material not found."});
    const m = r.rows[0];

    if (!["owner","admin"].includes(req.user.role)) {
      const a = await query(
        "SELECT 1 FROM material_access WHERE user_id=$1 AND material_id=$2",
        [req.user.id,m.id]
      );
      if (!a.rowCount) return res.status(402).json({
        success:false,
        paymentRequired:true,
        error:"Paid download access is required."
      });
    }

    const file = path.join(UPLOAD_DIR,m.storage_name);
    if (!fs.existsSync(file)) return res.status(404).json({success:false,error:"File unavailable."});
    res.setHeader("Cache-Control","private,no-store");
    res.download(file,m.original_name);
  } catch(e) { next(e); }
});

app.post("/api/materials", auth, requireRole("owner","admin"), upload.single("file"), async (req,res,next) => {
  try {
    if (!req.file) return res.status(400).json({success:false,error:"PDF file is required."});

    const level = String(req.body.level || "").trim().toLowerCase();
    const price = level.includes("jhs") || level.includes("shs")
      ? CONFIG.jhsShsTopicPdfPriceCedis
      : Number(req.body.price_ghc || CONFIG.jhsShsTopicPdfPriceCedis);

    const r = await query(
      `INSERT INTO materials(title,description,level,subject,topic,price_ghc,free_read,storage_name,original_name,mime_type)
       VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$9)
       RETURNING id,title,level,subject,topic,price_ghc,free_read,original_name`,
      [
        req.body.title || req.file.originalname,
        req.body.description || "",
        req.body.level || "",
        req.body.subject || "",
        req.body.topic || "",
        price,
        req.file.filename,
        req.file.originalname,
        req.file.mimetype
      ]
    );
    res.status(201).json({success:true,material:r.rows[0]});
  } catch(e) { next(e); }
});

/* ---------------- PAYMENTS ---------------- */

app.post("/api/payments/initialize", auth, async (req,res,next) => {
  try {
    const purpose = String(req.body.purpose || "").trim();
    const itemId = req.body.item_id;
    let amount = Number(req.body.amount_ghc);

    if (purpose === "course") {
      const c = await query("SELECT id,title,price_ghc FROM courses WHERE id=$1 AND active=true",[itemId]);
      if (!c.rowCount) return res.status(404).json({success:false,error:"Course not found."});
      amount = CONFIG.skillsCoursePriceCedis;
    } else if (purpose === "material") {
      const m = await query("SELECT id,title,level,price_ghc FROM materials WHERE id=$1",[itemId]);
      if (!m.rowCount) return res.status(404).json({success:false,error:"Material not found."});
      const level = String(m.rows[0].level || "").toLowerCase();
      amount = level.includes("jhs") || level.includes("shs")
        ? CONFIG.jhsShsTopicPdfPriceCedis
        : Number(m.rows[0].price_ghc || CONFIG.jhsShsTopicPdfPriceCedis);
    } else if (purpose === "pre_university_check") {
      amount = CONFIG.preUniversityCheckPriceCedis;
    } else {
      return res.status(400).json({success:false,error:"Unsupported payment purpose."});
    }

    if (["owner","admin"].includes(req.user.role)) {
      if (purpose === "course") {
        await query(
          `INSERT INTO enrollments(user_id,course_id)
           VALUES($1,$2) ON CONFLICT(user_id,course_id) DO NOTHING`,
          [req.user.id,itemId]
        );
      } else if (purpose === "material") {
        await query(
          `INSERT INTO material_access(user_id,material_id,access_type)
           VALUES($1,$2,'owner') ON CONFLICT(user_id,material_id) DO NOTHING`,
          [req.user.id,itemId]
        );
      }
      return res.json({success:true,ownerAccess:true,paid:true,amount_ghc:amount});
    }

    const reference = `PASSCOGH-${purpose.toUpperCase()}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;

    await query(
      `INSERT INTO payments(user_id,reference,amount_ghc,purpose,item_id)
       VALUES($1,$2,$3,$4,$5)`,
      [req.user.id,reference,amount,purpose,itemId || null]
    );

    const callbackUrl = String(req.body.callback_url || `${publicBase(req)}/payment/callback`);

    const p = await paystackRequest("/transaction/initialize",{
      method:"POST",
      body:JSON.stringify({
        email:req.user.email,
        amount:Math.round(amount * 100),
        currency:"GHS",
        reference,
        callback_url:callbackUrl,
        metadata:{
          user_id:req.user.id,
          purpose,
          item_id:itemId || null
        }
      })
    });

    res.json({
      success:true,
      paymentRequired:true,
      amount_ghc:amount,
      currency:"GHS",
      reference,
      authorization_url:p.data.authorization_url,
      access_code:p.data.access_code
    });
  } catch(e) { next(e); }
});

app.get("/api/payments/verify/:reference", auth, async (req,res,next) => {
  try {
    const p = await query(
      "SELECT * FROM payments WHERE reference=$1 AND user_id=$2",
      [req.params.reference,req.user.id]
    );
    if (!p.rowCount) return res.status(404).json({success:false,error:"Payment record not found."});

    const tx = await paystackRequest("/transaction/verify/" + encodeURIComponent(req.params.reference));
    const paid = tx.data.status === "success" &&
      String(tx.data.currency || "GHS").toUpperCase() === "GHS" &&
      amountMatches(p.rows[0].amount_ghc,tx.data.amount);

    await query(
      `UPDATE payments
       SET status=$1,paystack_status=$2,paid_at=CASE WHEN $1='paid' THEN NOW() ELSE paid_at END
       WHERE reference=$3`,
      [paid ? "paid" : "failed",tx.data.status,req.params.reference]
    );

    if (paid && p.rows[0].purpose === "course") {
      await query(
        `INSERT INTO enrollments(user_id,course_id)
         VALUES($1,$2) ON CONFLICT(user_id,course_id) DO NOTHING`,
        [p.rows[0].user_id,p.rows[0].item_id]
      );
    }

    if (paid && p.rows[0].purpose === "material") {
      await query(
        `INSERT INTO material_access(user_id,material_id,access_type)
         VALUES($1,$2,'purchase') ON CONFLICT(user_id,material_id) DO NOTHING`,
        [p.rows[0].user_id,p.rows[0].item_id]
      );
    }

    res.json({
      success:true,
      paid,
      reference:req.params.reference,
      purpose:p.rows[0].purpose,
      item_id:p.rows[0].item_id
    });
  } catch(e) { next(e); }
});

app.post("/api/payments/paystack/webhook", express.raw({type:"application/json"}), async (req,res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY || "";
    const signature = String(req.headers["x-paystack-signature"] || "");
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const expected = crypto.createHmac("sha512",secret).update(raw).digest("hex");

    if (!signature ||
        signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) {
      return res.status(401).send("Invalid signature");
    }

    const event = JSON.parse(raw.toString("utf8"));

    if (event.event === "charge.success") {
      const reference = event.data?.reference;
      const p = await query("SELECT * FROM payments WHERE reference=$1",[reference]);

      if (p.rowCount && amountMatches(p.rows[0].amount_ghc,event.data.amount)) {
        await query(
          `UPDATE payments
           SET status='paid',paystack_status='success',paid_at=NOW()
           WHERE reference=$1`,
          [reference]
        );

        if (p.rows[0].purpose === "course") {
          await query(
            `INSERT INTO enrollments(user_id,course_id)
             VALUES($1,$2) ON CONFLICT(user_id,course_id) DO NOTHING`,
            [p.rows[0].user_id,p.rows[0].item_id]
          );
        }

        if (p.rows[0].purpose === "material") {
          await query(
            `INSERT INTO material_access(user_id,material_id,access_type)
             VALUES($1,$2,'purchase') ON CONFLICT(user_id,material_id) DO NOTHING`,
            [p.rows[0].user_id,p.rows[0].item_id]
          );
        }
      }
    }

    res.sendStatus(200);
  } catch(e) {
    console.error("Paystack webhook error:",e);
    res.sendStatus(500);
  }
});

app.get("/payment/callback",(req,res) => {
  const ref = String(req.query.reference || "").replace(/[^a-zA-Z0-9._:-]/g,"");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PASSCOGH-MODOO Payment</title></head><body style="font-family:system-ui;text-align:center;padding:40px"><h2>PASSCOGH-MODOO</h2><p id="s">Payment received. Verifying...</p><script>(async()=>{const ref=${JSON.stringify(ref)},t=localStorage.getItem("passcogh_token")||localStorage.getItem("passcogh_auth_token"),s=document.getElementById("s");if(!t){s.textContent="Payment received. Return to PASSCOGH-MODOO and log in.";setTimeout(()=>location.href="/",3500);return}try{const r=await fetch("/api/payments/verify/"+encodeURIComponent(ref),{headers:{Authorization:"Bearer "+t}}),d=await r.json();s.textContent=r.ok&&d.paid?"Payment verified successfully. Your access is active.":(d.error||"Verification could not be completed.")}catch(e){s.textContent="Payment was received, but verification could not be completed automatically."}setTimeout(()=>location.href="/",3000)})()</script></body></html>`);
});

/* ---------------- CERTIFICATES ---------------- */

app.get("/api/certificates", auth, async (req,res,next) => {
  try {
    const r = await query(
      `SELECT ce.id,ce.certificate_code,ce.issued_at,c.title AS course_title
       FROM certificates ce JOIN courses c ON c.id=ce.course_id
       WHERE ce.user_id=$1 ORDER BY ce.issued_at DESC`,
      [req.user.id]
    );
    res.json({success:true,certificates:r.rows});
  } catch(e) { next(e); }
});

app.post("/api/certificates/issue/:courseId", auth, async (req,res,next) => {
  try {
    const e = await query(
      `SELECT * FROM enrollments
       WHERE user_id=$1 AND course_id=$2 AND completed=true`,
      [req.user.id,req.params.courseId]
    );

    if (!e.rowCount && !["owner","admin"].includes(req.user.role)) {
      return res.status(403).json({success:false,error:"Complete the course before requesting a certificate."});
    }

    const old = await query(
      "SELECT * FROM certificates WHERE user_id=$1 AND course_id=$2",
      [req.user.id,req.params.courseId]
    );
    if (old.rowCount) return res.json({success:true,certificate:old.rows[0]});

    const code = `PASSCOGH-${new Date().getFullYear()}-${crypto.randomBytes(7).toString("hex").toUpperCase()}`;
    const r = await query(
      `INSERT INTO certificates(user_id,course_id,certificate_code)
       VALUES($1,$2,$3) RETURNING *`,
      [req.user.id,req.params.courseId,code]
    );
    res.status(201).json({success:true,certificate:r.rows[0]});
  } catch(e) { next(e); }
});

app.get("/api/certificates/verify/:code", async (req,res,next) => {
  try {
    const r = await query(
      `SELECT ce.certificate_code,ce.issued_at,u.name,c.title
       FROM certificates ce
       JOIN users u ON u.id=ce.user_id
       JOIN courses c ON c.id=ce.course_id
       WHERE ce.certificate_code=$1`,
      [req.params.code]
    );
    if (!r.rowCount) return res.status(404).json({success:true,valid:false});
    res.json({success:true,valid:true,certificate:r.rows[0]});
  } catch(e) { next(e); }
});

/* ---------------- CREATOR ---------------- */

app.get("/api/creator/access", auth, requireRole("owner","admin"), (req,res) =>
  res.json({
    success:true,
    creator:true,
    unlimitedAccess:true,
    freeCourseAccess:true,
    freePdfDownload:true,
    freeOnlineReading:true,
    advertisementsDisabled:true,
    email:req.user.email
  })
);

app.get("/api/creator/dashboard", auth, requireRole("owner","admin"), async (req,res,next) => {
  try {
    const [users,materials,courses,payments,enrolments,certificates] = await Promise.all([
      query("SELECT COUNT(*)::int count FROM users"),
      query("SELECT COUNT(*)::int count FROM materials"),
      query("SELECT COUNT(*)::int count FROM courses"),
      query("SELECT COALESCE(SUM(amount_ghc),0)::numeric total FROM payments WHERE status='paid'"),
      query("SELECT COUNT(*)::int count FROM enrollments"),
      query("SELECT COUNT(*)::int count FROM certificates")
    ]);

    let topicCount = 0;
    for (const s of getAllSubjects()) topicCount += getTopics(s).length;

    res.json({
      success:true,
      users:users.rows[0].count,
      materials:materials.rows[0].count,
      courses:courses.rows[0].count,
      enrolments:enrolments.rows[0].count,
      certificates:certificates.rows[0].count,
      paidRevenueGhc:Number(payments.rows[0].total),
      curriculumFile:fs.existsSync(CURRICULUM_FILE),
      curriculumLevels:getLevels().length,
      curriculumSubjects:getAllSubjects().length,
      curriculumTopics:topicCount,
      diagrams:diagramFiles().length,
      skillsPaths:skillsPath().paths.length,
      institutions:institutionData().length,
      universityCourses:universityCourses().length
    });
  } catch(e) { next(e); }
});

/* ---------------- ADMIN ---------------- */

app.get("/api/admin/dashboard", auth, requireRole("owner","admin"), async (_req,res,next) => {
  try {
    const [u,m,c,p] = await Promise.all([
      query("SELECT COUNT(*)::int count FROM users"),
      query("SELECT COUNT(*)::int count FROM materials"),
      query("SELECT COUNT(*)::int count FROM courses"),
      query("SELECT COALESCE(SUM(amount_ghc),0)::numeric total FROM payments WHERE status='paid'")
    ]);

    res.json({
      success:true,
      users:u.rows[0].count,
      materials:m.rows[0].count,
      courses:c.rows[0].count,
      paid_revenue_ghc:Number(p.rows[0].total)
    });
  } catch(e) { next(e); }
});

app.post("/api/admin/subjects", auth, requireRole("owner","admin"), async (req,res,next) => {
  try {
    const {level,name,description="",data={}} = req.body;
    const r = await query(
      `INSERT INTO subjects(level,name,description,data)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [level,name,description,data]
    );
    res.status(201).json({success:true,subject:r.rows[0]});
  } catch(e) { next(e); }
});

/* ---------------- STATIC FRONTEND ---------------- */

app.use("/data", express.static(DATA_DIR, { fallthrough:true }));
app.use(express.static(PUBLIC_DIR, { index:"index.html" }));

app.get("/{*splat}", (req,res,next) => {
  if (req.path.startsWith("/api/") || req.path === "/payment/callback") return next();
  const index = path.join(PUBLIC_DIR,"index.html");
  if (!fs.existsSync(index)) return res.status(404).send("PASSCOGH-MODOO index.html is missing.");
  res.sendFile(index);
});

app.use((err,_req,res,_next) => {
  console.error("PASSCOGH-MODOO server error:",err);
  res.status(err.status || 500).json({
    success:false,
    error:"PASSCOGH-MODOO server error.",
    message:process.env.NODE_ENV === "production" ? "Something went wrong on the server." : err.message
  });
});

(async() => {
  try {
    await initDb();
    buildDiagramIndex();

    app.listen(PORT,"0.0.0.0",() => {
      console.log(`PASSCOGH-MODOO running on port ${PORT}`);
      console.log(`Curriculum: ${fs.existsSync(CURRICULUM_FILE) ? "FOUND" : "MISSING"}`);
      console.log(`Levels: ${getLevels().length}`);
      console.log(`Subjects: ${getAllSubjects().length}`);
      console.log(`Diagrams: ${diagramFiles().length}`);
      console.log(`Skills paths: ${skillsPath().paths.length}`);
      console.log(`Institutions: ${institutionData().length}`);
      console.log(`University courses: ${universityCourses().length}`);
      console.log(`Paystack: ${process.env.PAYSTACK_SECRET_KEY ? "CONFIGURED" : "NOT CONFIGURED"}`);
    });
  } catch(e) {
    console.error("PASSCOGH-MODOO startup failed:",e);
    process.exit(1);
  }
})();
