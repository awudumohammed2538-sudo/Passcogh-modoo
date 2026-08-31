import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || '0.0.0.0';

const ROOT = __dirname;
// Works whether Render runs this file from the repository root or /backend.
const REPO_ROOT = path.basename(ROOT).toLowerCase() === 'backend' ? path.resolve(ROOT, '..') : ROOT;
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : path.join(REPO_ROOT, 'public');
const DATA_DIR = fs.existsSync(path.join(ROOT, 'data')) ? path.join(ROOT, 'data') : path.join(REPO_ROOT, 'data');
const STORAGE_DIR = path.join(ROOT, 'storage');
const PDF_DIR = path.join(STORAGE_DIR, 'pdfs');
const DIAGRAM_DIR = path.join(DATA_DIR, 'diagrams');
const CURRICULUM_FILE = path.join(DATA_DIR, 'passcogh_curriculum.json');
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_IN_RENDER';
const CREATOR_EMAIL = String(process.env.CREATOR_EMAIL || 'awudumohammedmodoo@gmail.com').trim().toLowerCase();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const PAYSTACK_SECRET_KEY = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const READING_AD_MINUTES = 5;
const JHS_SHS_PDF_PRICE_GHS = 1;
const PRE_UNI_CHECK_PRICE_GHS = 5;
const COURSE_DEFAULT_PRICE_GHS = 20;

for (const dir of [DATA_DIR, STORAGE_DIR, PDF_DIR, DIAGRAM_DIR]) fs.mkdirSync(dir, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

/* ----------------------------- DATA ----------------------------- */
function loadCurriculum() {
  if (!fs.existsSync(CURRICULUM_FILE)) return { platform: 'PASSCOGH-MODOO', version: 'missing', levels: [] };
  try { return JSON.parse(fs.readFileSync(CURRICULUM_FILE, 'utf8')); }
  catch (e) { console.error('Curriculum JSON error:', e); return { platform: 'PASSCOGH-MODOO', version: 'invalid', levels: [] }; }
}

function getLevels() {
  const c = loadCurriculum();
  let levels = Array.isArray(c.levels) ? c.levels : (c.levels && typeof c.levels === 'object' ? Object.entries(c.levels).map(([id, v]) => ({ id, ...(v || {}), name: v?.name || id })) : (Array.isArray(c) ? c : []));
  return levels.map((l, i) => ({ ...l, id: levelId(l) || idNorm(l.name || `level-${i + 1}`) }));
}
function norm(v) { return String(v ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function idNorm(v) { return norm(v).replace(/\s+/g, '-'); }
function levelId(level) { return String(level?.id || idNorm(level?.name || 'unknown-level')); }
function levelSlug(level) { const id = levelId(level); const n = norm(level?.name || id); if (n.includes('pre shs')) return 'pre-shs'; if (n === 'pre university') return 'pre-university'; if (n.includes('university') && n.includes('college')) return 'university-college'; if (/^jhs [123]$/.test(n)) return n.replace(' ',''); if (/^shs [123]$/.test(n)) return n.replace(' ',''); return idNorm(id); }
function subjects(level) { return Array.isArray(level?.subjects) ? level.subjects : []; }
function topics(subject) { return Array.isArray(subject?.topics) ? subject.topics : []; }
function allSubjects() { return getLevels().flatMap(l => subjects(l).map(s => ({ ...s, level: s.level || l.name, levelId: levelId(l) }))); }
function findLevel(v) { const q = norm(v); return getLevels().find(l => norm(levelId(l)) === q || norm(l.name) === q || levelSlug(l) === idNorm(v)) || null; }
function findSubject(v, levelValue) {
  const q = norm(v); const pool = levelValue ? subjects(findLevel(levelValue)) : allSubjects();
  return pool.find(s => norm(s.id || s.code) === q || norm(s.name || s.title) === q || idNorm(s.name) === idNorm(v)) || null;
}
function findTopic(subject, v) { const q = norm(v); return topics(subject).find(t => norm(t.id) === q || norm(t.title || t.name || t.topic) === q || idNorm(t.title) === idNorm(v)) || null; }
function topicLesson(t) { return t?.lesson || t?.content || {}; }
function topicRecord(level, subject, topic) {
  const lesson = topicLesson(topic);
  return { id: idNorm(`${levelId(level)}-${subject.code || subject.name}-${topic.title}`), level: { id: levelId(level), name: level.name }, subject: { id: subject.code || idNorm(subject.name), name: subject.name }, topic: topic.title, ...lesson };
}

/* ----------------------------- COURSES ----------------------------- */
const FALLBACK_COURSES = [
  ['coding-programming','Coding & Programming',['problem solving','programming fundamentals','logic','projects']],
  ['web-development','Web Development',['HTML','CSS','JavaScript','web projects']],
  ['digital-skills','Digital Skills',['digital literacy','online safety','productivity tools']],
  ['data-excel','Data & Excel',['spreadsheets','formulas','data analysis','charts']],
  ['graphic-design','Graphic Design',['layout','typography','visual communication','digital graphics']],
  ['entrepreneurship','Entrepreneurship',['idea development','business planning','financial awareness','marketing']],
  ['digital-marketing','Digital Marketing',['content','audience research','analytics','online promotion']],
  ['ai-productivity','AI & Productivity',['responsible AI use','prompting','research','workflow improvement']]
].map(([id,title,skills]) => ({ id,title,description:`Practical ${title} pathway.`,skills,price:COURSE_DEFAULT_PRICE_GHS,currency:'GHS',certificateEnabled:true,published:true }));
function getCourses() {
  const p = loadCurriculum()?.skills_path?.paths;
  if (!Array.isArray(p) || !p.length) return FALLBACK_COURSES;
  return p.map(x => ({ id:x.id,title:x.name || x.id,description:'PASSCOGH-MODOO practical skills pathway.',skills:Array.isArray(x.skills)?x.skills:[],price:COURSE_DEFAULT_PRICE_GHS,currency:'GHS',certificateEnabled:true,published:true }));
}
function findCourse(v) { const q=idNorm(v); return getCourses().find(c => idNorm(c.id)===q || idNorm(c.title)===q) || null; }

/* ----------------------------- DIAGRAMS ----------------------------- */
let diagramIndex = null;
function buildDiagramIndex() {
  const out=[];
  if (!fs.existsSync(DIAGRAM_DIR)) return out;
  function walk(dir) {
    for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
      const p=path.join(dir,ent.name);
      if(ent.isDirectory()) walk(p);
      else if(/\.(png|jpe?g|webp|gif|svg)$/i.test(ent.name)) {
        const filename=ent.name;
        const parts=filename.split('__');
        const prefix=parts[0]||'';
        const code=parts[1]||'';
        const seq=Number(String(parts[2]||'').replace(/[^0-9]/g,''))||null;
        const slug=(parts[3]||filename).replace(/\.[^.]+$/,'');
        out.push({filename,relative:path.relative(DIAGRAM_DIR,p).replaceAll('\\','/'),prefix,code,seq,slug,tokens:norm(filename).split(' ')});
      }
    }
  }
  walk(DIAGRAM_DIR);
  return out;
}
function diagrams() { if (!diagramIndex) diagramIndex=buildDiagramIndex(); return diagramIndex; }
function topicIndex(subject, topic) { return topics(subject).findIndex(t => t === topic) + 1; }
function matchDiagrams(level, subject, topic, limit=6) {
  const exactPrefix=levelSlug(level);
  const exactCode=String(subject.code||'').toLowerCase();
  const idx=topicIndex(subject,topic);
  const topicSlug=idNorm(topic.title);
  const exact=diagrams().filter(d => d.prefix===exactPrefix && d.code.toLowerCase()===exactCode && d.seq===idx);
  const candidates=(exact.length?exact:diagrams()).map(d => {
    let score=0;
    if(d.prefix===exactPrefix) score+=20;
    if(exactCode && d.code.toLowerCase()===exactCode) score+=50;
    if(idx && d.seq===idx) score+=35;
    if(d.slug===topicSlug) score+=80;
    const qTokens=new Set(norm(`${subject.name} ${topic.title}`).split(' ').filter(x=>x.length>2));
    for(const t of qTokens) if(d.tokens.includes(t)) score++;
    return {...d,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  return candidates.slice(0,limit).map(({tokens,score,prefix,code,seq,slug,...d})=>({ ...d, matchScore:score, levelPrefix:prefix, subjectCode:code, topicNumber:seq, topicSlug:slug, url:`/diagrams/${d.relative.split('/').map(encodeURIComponent).join('/')}` }));
}
function diagramPayload(level, subject, topic) { const lesson=topicLesson(topic); return { curriculumDiagram:lesson.diagram_visual_aid || lesson.diagram || null, libraryMatches:matchDiagrams(level,subject,topic) }; }

/* ----------------------------- DATABASE ----------------------------- */
const hasPostgres = Boolean(process.env.DATABASE_URL);
const pool = hasPostgres ? new Pool({ connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized:false }, max:5 }) : null;
const memory = { users:new Map(), payments:new Map(), purchases:new Set(), enrolments:new Map(), certificates:new Map(), reading:new Map(), guidance:new Map() };
let memoryUserId=1;

async function dbQuery(text, params=[]) { if (!pool) return { rows:[] }; return pool.query(text,params); }
async function initDb() {
  if (!pool) { console.warn('DATABASE_URL not set: using non-persistent development memory store. Configure PostgreSQL on Render for production.'); return; }
  await pool.query(`
  CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL DEFAULT '',role TEXT NOT NULL DEFAULT 'learner',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS payments(id BIGSERIAL PRIMARY KEY,reference TEXT UNIQUE NOT NULL,user_id BIGINT NOT NULL,item_type TEXT NOT NULL,item_id TEXT NOT NULL,amount NUMERIC(12,2) NOT NULL,currency TEXT NOT NULL DEFAULT 'GHS',status TEXT NOT NULL DEFAULT 'pending',provider TEXT NOT NULL DEFAULT 'paystack',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),verified_at TIMESTAMPTZ);
  CREATE TABLE IF NOT EXISTS pdf_purchases(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,pdf_id TEXT NOT NULL,payment_reference TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,pdf_id));
  CREATE TABLE IF NOT EXISTS course_enrolments(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,course_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',progress INTEGER NOT NULL DEFAULT 0,completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,course_id));
  CREATE TABLE IF NOT EXISTS certificates(id BIGSERIAL PRIMARY KEY,certificate_no TEXT UNIQUE NOT NULL,user_id BIGINT NOT NULL,course_id TEXT NOT NULL,issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,course_id));
  CREATE TABLE IF NOT EXISTS reading_sessions(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,pdf_id TEXT NOT NULL,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),ad_due_at TIMESTAMPTZ NOT NULL);
  CREATE TABLE IF NOT EXISTS guidance_checks(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,reference TEXT UNIQUE NOT NULL,amount NUMERIC(12,2) NOT NULL DEFAULT 5,status TEXT NOT NULL DEFAULT 'pending',input_json JSONB NOT NULL DEFAULT '{}'::jsonb,result_json JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),verified_at TIMESTAMPTZ);
  CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id); CREATE INDEX IF NOT EXISTS reading_user_idx ON reading_sessions(user_id);
  `);
}

/* ----------------------------- AUTH ----------------------------- */
function tokenFor(user) { return jwt.sign({ sub:String(user.id), email:user.email, role:user.role }, JWT_SECRET, { expiresIn:`${SESSION_DAYS}d` }); }
async function getUser(req) {
  const h=req.headers.authorization||''; if(!h.startsWith('Bearer ')) return null;
  try { const p=jwt.verify(h.slice(7),JWT_SECRET); if(pool){const r=await dbQuery('SELECT id,email,name,role,created_at FROM users WHERE id=$1',[p.sub]); return r.rows[0]||null;} return [...memory.users.values()].find(u=>String(u.id)===String(p.sub))||null; } catch { return null; }
}
async function requireUser(req,res,next){ const u=await getUser(req); if(!u) return res.status(401).json({success:false,message:'Authentication required.'}); req.user=u; next(); }
async function requireCreator(req,res,next){ const u=await getUser(req); if(!u || u.role!=='creator') return res.status(403).json({success:false,message:'Creator access denied.'}); req.user=u; next(); }
function safeEmail(v){const e=String(v||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null;}

app.post('/api/auth/register', async (req,res)=>{ try { const email=safeEmail(req.body.email), name=String(req.body.name||'').trim(); if(!email||!name)return res.status(400).json({success:false,message:'Name and valid email are required.'}); const role=email===CREATOR_EMAIL?'creator':'learner'; if(pool){const r=await dbQuery('INSERT INTO users(email,name,role) VALUES($1,$2,$3) RETURNING id,email,name,role,created_at',[email,name,role]); const u=r.rows[0]; return res.status(201).json({success:true,user:u,token:tokenFor(u)});} if([...memory.users.values()].some(u=>u.email===email))return res.status(409).json({success:false,message:'Account already exists.'}); const u={id:memoryUserId++,email,name,role,created_at:new Date().toISOString()};memory.users.set(u.id,u);res.status(201).json({success:true,user:u,token:tokenFor(u)}); } catch(e){ if(e.code==='23505')return res.status(409).json({success:false,message:'Account already exists.'});console.error(e);res.status(500).json({success:false,message:'Registration failed.'});} });
app.post('/api/auth/login', async (req,res)=>{ try { const email=safeEmail(req.body.email);if(!email)return res.status(400).json({success:false,message:'Enter a valid email address.'}); let u;if(pool){const r=await dbQuery('SELECT id,email,name,role,created_at FROM users WHERE email=$1',[email]);u=r.rows[0];}else u=[...memory.users.values()].find(x=>x.email===email); if(!u)return res.status(401).json({success:false,message:'Account not found. Please register first.'});res.json({success:true,user:u,token:tokenFor(u)}); }catch(e){console.error(e);res.status(500).json({success:false,message:'Login failed.'});} });
app.post('/api/auth/logout', requireUser, async (req,res)=>res.json({success:true,message:'Logged out.'}));
app.get('/api/auth/me', requireUser, async (req,res)=>res.json({success:true,user:req.user}));

/* ----------------------------- HEALTH / CURRICULUM ----------------------------- */
app.get('/api/health', async (req,res)=>{const c=loadCurriculum(),ls=getLevels(),ss=allSubjects(),ts=ss.reduce((n,s)=>n+topics(s).length,0);let dbStatus='memory';if(pool){try{await dbQuery('SELECT 1');dbStatus='postgresql';}catch{dbStatus='error';}}res.json({success:true,service:'PASSCOGH-MODOO',version:c.version||'unknown',database:dbStatus,curriculumFile:fs.existsSync(CURRICULUM_FILE),curriculumShape:Array.isArray(c.levels)?'levels[]':typeof c.levels,levels:ls.length,subjects:ss.length,topics:ts,diagrams:diagrams().length,skillsPath:Boolean(c.skills_path?.enabled),universityGuidance:Boolean(c.university_guidance?.enabled),freeOnlineReading:true,readingAdIntervalMinutes:READING_AD_MINUTES,jhsShsTopicPdfPriceGhs:JHS_SHS_PDF_PRICE_GHS,preUniversityCheckPriceGhs:PRE_UNI_CHECK_PRICE_GHS});});
app.get('/api/curriculum',(req,res)=>res.json({success:true,curriculum:loadCurriculum()}));
app.get('/api/levels',(req,res)=>res.json({success:true,levels:getLevels().map(l=>({...l,subjectCount:subjects(l).length,topicCount:subjects(l).reduce((n,s)=>n+topics(s).length,0)}))}));
app.get('/api/levels/:level',(req,res)=>{const l=findLevel(req.params.level);if(!l)return res.status(404).json({success:false,message:'Level not found.'});res.json({success:true,level:l});});
app.get('/api/levels/:level/subjects',(req,res)=>{const l=findLevel(req.params.level);if(!l)return res.status(404).json({success:false,message:'Level not found.'});res.json({success:true,subjects:subjects(l)});});
app.get('/api/subjects',(req,res)=>res.json({success:true,subjects:allSubjects()}));
app.get('/api/subjects/:subject',(req,res)=>{const s=findSubject(req.params.subject);if(!s)return res.status(404).json({success:false,message:'Subject not found.'});const l=findLevel(req.query.level)||getLevels().find(x=>subjects(x).some(y=>y.code===s.code))||null; res.json({success:true,subject:s,diagrams:l?matchDiagrams(l,s,{title:s.name}):[]});});
app.get('/api/subjects/:subject/topics',(req,res)=>{const s=findSubject(req.params.subject);if(!s)return res.status(404).json({success:false,message:'Subject not found.'});res.json({success:true,topics:topics(s)});});
app.get('/api/subjects/:subject/topics/:topic',(req,res)=>{const s=findSubject(req.params.subject);if(!s)return res.status(404).json({success:false,message:'Subject not found.'});const t=findTopic(s,req.params.topic);if(!t)return res.status(404).json({success:false,message:'Topic not found.'});const l=getLevels().find(x=>subjects(x).some(y=>y===s||y.code===s.code))||findLevel(req.query.level)||null;res.json({success:true,topic:topicRecord(l||{id:'',name:s.level||''},s,t),diagrams:diagramPayload(l||{},s,t)});});
app.get('/api/learning/topic', (req,res)=>{const s=findSubject(req.query.subject,req.query.level);if(!s)return res.status(404).json({success:false,message:'Subject not found.'});const t=findTopic(s,req.query.topic);if(!t)return res.status(404).json({success:false,message:'Topic not found.'});const l=findLevel(req.query.level)||getLevels().find(x=>subjects(x).some(y=>y.code===s.code));res.json({success:true,lesson:topicRecord(l||{id:'',name:''},s,t),diagrams:diagramPayload(l||{},s,t)});});

/* ----------------------------- EXAMS / ASSESSMENT ----------------------------- */
app.get('/api/assessment',(req,res)=>res.json({success:true,assessment:loadCurriculum().assessment_system||{}}));
app.get('/api/questions',(req,res)=>{
  const q=[];
  for(const l of getLevels()) for(const s of subjects(l)) for(const t of topics(s)){
    const le=topicLesson(t);
    if(Array.isArray(le.practice_questions)) q.push(...le.practice_questions.map(question=>({level:levelId(l),subject:s.name,topic:t.title,type:'practice',question})));
    if(Array.isArray(le.wASSCE_style_questions)) q.push(...le.wASSCE_style_questions.map(x=>({...x,level:levelId(l),subject:s.name,topic:t.title,type:x.type||'wASSCE-style'})));
    if(Array.isArray(le.wASSCE_2027_practice)) q.push(...le.wASSCE_2027_practice.map(x=>({...x,level:levelId(l),subject:s.name,topic:t.title,type:'prediction_practice'})));
  }
  res.json({success:true,questions:q,note:'2027 items are original PASSCOGH-MODOO practice, not leaked or guaranteed WAEC questions.'});
});
app.get('/api/past-questions',(req,res)=>res.json({success:true,available:false,items:[],message:'Genuine WASSCE 2012–2026 papers will only be published after an authorised/legal source or permission is confirmed.'}));
app.get('/api/practical',(req,res)=>{const items=[];for(const l of getLevels())for(const s of subjects(l))for(const t of topics(s)){const le=topicLesson(t); if(le.practical||le.practical_preparation)items.push({level:levelId(l),subject:s.name,topic:t.title,practical:le.practical||le.practical_preparation});}res.json({success:true,items,method:loadCurriculum().assessment_system?.practical_method||[]});});
app.get('/api/exam-guides',(req,res)=>res.json({success:true,guides:{assessment:loadCurriculum().assessment_system||{},pastQuestions:{years:'2012–2026',status:'authorisation pending'},wASSCEPractice:'Original WASSCE-style practice',predicted2027:'Original prediction practice; not guaranteed or leaked'}}));

/* ----------------------------- SKILLS / COURSES ----------------------------- */
app.get('/api/skills-path',(req,res)=>res.json({success:true,skillsPath:loadCurriculum().skills_path||{enabled:true,paths:getCourses()}}));
app.get('/api/skills-path/:id',(req,res)=>{const c=findCourse(req.params.id);if(!c)return res.status(404).json({success:false,message:'Skills path not found.'});res.json({success:true,path:c});});
app.get('/api/courses',(req,res)=>res.json({success:true,courses:getCourses().filter(c=>c.published!==false)}));
app.get('/api/courses/:id/access',requireUser,async(req,res)=>{const c=findCourse(req.params.id);if(!c)return res.status(404).json({success:false,message:'Course not found.'});if(req.user.role==='creator')return res.json({success:true,access:true,free:true,course:c});let enrolled=false;if(pool){const r=await dbQuery("SELECT 1 FROM course_enrolments WHERE user_id=$1 AND course_id=$2 AND status='active'",[req.user.id,c.id]);enrolled=Boolean(r.rows[0]);}else enrolled=memory.enrolments.has(`${req.user.id}:${c.id}`);res.json({success:true,access:enrolled,free:false,price:c.price,course:c});});
app.get('/api/enrolments',requireUser,async(req,res)=>{if(pool){const r=await dbQuery('SELECT * FROM course_enrolments WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);return res.json({success:true,enrolments:r.rows});}res.json({success:true,enrolments:[...memory.enrolments.entries()].filter(([k])=>k.startsWith(`${req.user.id}:`)).map(([k,v])=>v)});});
app.post('/api/courses/:id/progress',requireUser,async(req,res)=>{const c=findCourse(req.params.id);if(!c)return res.status(404).json({success:false,message:'Course not found.'});let p=Number(req.body.progress);if(!Number.isFinite(p)||p<0||p>100)return res.status(400).json({success:false,message:'Progress must be 0–100.'});p=Math.round(p);if(req.user.role!=='creator'){const a=await hasCourseAccess(req.user.id,c.id);if(!a)return res.status(403).json({success:false,message:'Course enrolment required.'});}if(pool)await dbQuery(`INSERT INTO course_enrolments(user_id,course_id,status,progress,completed_at) VALUES($1,$2,'active',$3,CASE WHEN $3=100 THEN NOW() ELSE NULL END) ON CONFLICT(user_id,course_id) DO UPDATE SET progress=EXCLUDED.progress,completed_at=CASE WHEN EXCLUDED.progress=100 THEN COALESCE(course_enrolments.completed_at,NOW()) ELSE course_enrolments.completed_at END`,[req.user.id,c.id,p]);else memory.enrolments.set(`${req.user.id}:${c.id}`,{user_id:req.user.id,course_id:c.id,status:'active',progress:p});res.json({success:true,progress:p});});
async function hasCourseAccess(userId,courseId){if(pool){const r=await dbQuery("SELECT 1 FROM course_enrolments WHERE user_id=$1 AND course_id=$2 AND status='active'",[userId,courseId]);return Boolean(r.rows[0]);}return memory.enrolments.has(`${userId}:${courseId}`);}

/* ----------------------------- UNIVERSITY / COURSE GUIDE ----------------------------- */
app.get('/api/university-guidance',(req,res)=>res.json({success:true,guidance:loadCurriculum().university_guidance||{}}));
app.get('/api/universities',(req,res)=>{const u=loadCurriculum().university_guidance||{};res.json({success:true,universities:[],rankingNote:u.ranking_note||'Institution data must come from a maintained, dated source; no rankings are invented.'});});
function guidanceResult(payload){ const c=loadCurriculum().university_guidance||{}; return {message:'Guidance result generated from the information supplied. Institution availability and entry requirements must be checked against current official sources.',inputs:payload,rules:c.matching_rules||[]}; }
app.post('/api/university-guidance/match',requireUser,async(req,res)=>{if(req.user.role!=='creator'){let allowed=false;if(pool){const r=await dbQuery("SELECT 1 FROM guidance_checks WHERE user_id=$1 AND status='success' ORDER BY verified_at DESC LIMIT 1",[req.user.id]);allowed=Boolean(r.rows[0]);}else allowed=[...memory.guidance.values()].some(x=>x.user_id===req.user.id&&x.status==='success');if(!allowed)return res.status(402).json({success:false,requiresPayment:true,amount:PRE_UNI_CHECK_PRICE_GHS,currency:'GHS',message:'A GH₵5 Pre-University course-availability check is required.'});}res.json({success:true,result:guidanceResult(req.body)});});
app.post('/api/university-guidance/recommend',requireUser,async(req,res)=>{if(req.user.role!=='creator')return res.status(402).json({success:false,requiresPayment:true,amount:PRE_UNI_CHECK_PRICE_GHS,currency:'GHS',message:'A GH₵5 Pre-University course-availability check is required.'});res.json({success:true,result:guidanceResult(req.body)});});

/* ----------------------------- PDFs / READING ----------------------------- */
function topicPdfId(level,subject,topic){return `topic-pdf-${idNorm(levelId(level))}-${idNorm(subject.code||subject.name)}-${idNorm(topic.title)}`;}
function getPdfFromId(id){const q=idNorm(id);for(const l of getLevels())for(const s of subjects(l))for(const t of topics(s)){const pid=topicPdfId(l,s,t);if(pid===q)return {id:pid,title:`${s.name} — ${t.title} PDF`,filename:`${pid}.pdf`,level:levelId(l),subject:s.name,topic:t.title,price:(/^jhs|^shs/.test(levelId(l))?JHS_SHS_PDF_PRICE_GHS:5),currency:'GHS',type:'topic'};}return null;}
function pdfCatalogue(){const c=loadCurriculum(), arr=[];for(const l of getLevels())for(const s of subjects(l))for(const t of topics(s))arr.push({id:topicPdfId(l,s,t),title:`${s.name} — ${t.title} PDF`,filename:`${topicPdfId(l,s,t)}.pdf`,level:levelId(l),subject:s.name,topic:t.title,price:/^jhs|^shs/.test(levelId(l))?1:5,currency:'GHS',reading:'free'});return {enabled:true,reading:'free inside website',download:'paid',creator_access:'free',topicPricing:{jhs:1,shs:1},items:arr};}
app.get('/api/pdfs',(req,res)=>{const cat=pdfCatalogue();res.json({success:true,pdfs:cat.items.slice(0,Number(req.query.limit||5000)),pricing:{jhsShsPerTopicGhs:1,preUniversityCheckGhs:5},catalogue:cat});});
app.post('/api/reading/start',requireUser,async(req,res)=>{const pdf=getPdfFromId(req.body.pdfId);if(!pdf)return res.status(404).json({success:false,message:'PDF/topic resource not found.'});const started=new Date(),due=new Date(started.getTime()+READING_AD_MINUTES*60000);const row={user_id:req.user.id,pdf_id:pdf.id,started_at:started.toISOString(),ad_due_at:due.toISOString()};if(pool)await dbQuery('INSERT INTO reading_sessions(user_id,pdf_id,ad_due_at) VALUES($1,$2,$3)',[req.user.id,pdf.id,due]);else memory.reading.set(`${req.user.id}:${pdf.id}`,row);res.json({success:true,free:true,pdf,readingSession:row,adIntervalMinutes:READING_AD_MINUTES,adDueAt:due.toISOString()});});
app.get('/api/reading/status',requireUser,async(req,res)=>{
  const pdfId=String(req.query.pdfId||'');
  if(!pdfId)return res.status(400).json({success:false,message:'pdfId is required.'});
  let row=null;
  if(pool){const r=await dbQuery('SELECT * FROM reading_sessions WHERE user_id=$1 AND pdf_id=$2 ORDER BY started_at DESC LIMIT 1',[req.user.id,pdfId]); row=r.rows[0]||null;}
  else row=memory.reading.get(`${req.user.id}:${pdfId}`)||null;
  const now=Date.now(); const due=row?new Date(row.ad_due_at).getTime():null;
  res.json({success:true,reading:true,adIntervalMinutes:READING_AD_MINUTES,adDueAt:row?.ad_due_at||null,adDue:due!==null&&now>=due});
});

app.get('/api/pdfs/:id/read',requireUser,(req,res)=>{const pdf=getPdfFromId(req.params.id);if(!pdf)return res.status(404).json({success:false,message:'PDF not found.'});const file=path.join(PDF_DIR,path.basename(pdf.filename));if(!fs.existsSync(file))return res.status(404).json({success:false,message:'This topic PDF is not uploaded yet. The online reading entitlement is ready, but the source PDF file is missing.'});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${pdf.filename}"`);res.sendFile(file);});
async function ownsPdf(userId,pdfId){if(pool){const r=await dbQuery('SELECT 1 FROM pdf_purchases WHERE user_id=$1 AND pdf_id=$2',[userId,pdfId]);return Boolean(r.rows[0]);}return memory.purchases.has(`${userId}:${pdfId}`);}
app.get('/api/pdfs/:id/download-access',requireUser,async(req,res)=>{const pdf=getPdfFromId(req.params.id);if(!pdf)return res.status(404).json({success:false,message:'PDF not found.'});const creator=req.user.role==='creator';const purchased=creator||await ownsPdf(req.user.id,pdf.id);res.json({success:true,access:purchased,free:creator,price:pdf.price,currency:'GHS',pdf});});
app.get('/api/pdfs/:id/download',requireUser,async(req,res)=>{const pdf=getPdfFromId(req.params.id);if(!pdf)return res.status(404).json({success:false,message:'PDF not found.'});if(req.user.role!=='creator'&&!await ownsPdf(req.user.id,pdf.id))return res.status(403).json({success:false,message:`Download requires payment of GH₵${pdf.price}.`});const file=path.join(PDF_DIR,path.basename(pdf.filename));if(!fs.existsSync(file))return res.status(404).json({success:false,message:'The protected PDF file has not been uploaded yet.'});res.download(file,pdf.filename);});

/* ----------------------------- PAYMENTS ----------------------------- */
async function paystackInitialize(email,amountGhs,reference,metadata={}){if(!PAYSTACK_SECRET_KEY)return null;const body={email,amount:Math.round(Number(amountGhs)*100),currency:'GHS',reference,callback_url:`${PUBLIC_BASE_URL}/payment/callback`,metadata};const r=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||!j.status)throw new Error(j.message||'Payment initialization failed.');return j.data;}
async function paystackVerify(reference){if(!PAYSTACK_SECRET_KEY)throw new Error('PAYSTACK_SECRET_KEY is not configured.');const r=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`}});const j=await r.json();if(!r.ok||!j.status)throw new Error(j.message||'Payment verification failed.');return j.data;}
function newReference(prefix){return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;}
async function createPayment(user,itemType,itemId,amount){const reference=newReference(itemType==='pdf'?'PDF':itemType==='guidance'?'GUIDE':'COURSE');if(pool)await dbQuery('INSERT INTO payments(reference,user_id,item_type,item_id,amount) VALUES($1,$2,$3,$4,$5)',[reference,user.id,itemType,itemId,amount]);else memory.payments.set(reference,{reference,user_id:user.id,item_type:itemType,item_id:itemId,amount,status:'pending'});return reference;}
async function markPaymentSuccess(reference){if(pool){const r=await dbQuery('SELECT * FROM payments WHERE reference=$1',[reference]);const p=r.rows[0];if(!p)return null;await dbQuery("UPDATE payments SET status='success',verified_at=NOW() WHERE reference=$1",[reference]);if(p.item_type==='pdf')await dbQuery('INSERT INTO pdf_purchases(user_id,pdf_id,payment_reference) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.user_id,p.item_id,p.reference]);if(p.item_type==='course')await dbQuery("INSERT INTO course_enrolments(user_id,course_id,status) VALUES($1,$2,'active') ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'",[p.user_id,p.item_id]);if(p.item_type==='guidance')await dbQuery('INSERT INTO guidance_checks(user_id,reference,amount,status,verified_at) VALUES($1,$2,$3,\'success\',NOW()) ON CONFLICT DO NOTHING',[p.user_id,p.reference,p.amount]);return p;}const p=memory.payments.get(reference);if(!p)return null;p.status='success';if(p.item_type==='pdf')memory.purchases.add(`${p.user_id}:${p.item_id}`);if(p.item_type==='course')memory.enrolments.set(`${p.user_id}:${p.item_id}`,{user_id:p.user_id,course_id:p.item_id,status:'active',progress:0});if(p.item_type==='guidance')memory.guidance.set(reference,{...p,status:'success'});return p;}
app.post('/api/payments/pdf',requireUser,async(req,res)=>{const pdf=getPdfFromId(req.body.pdfId);if(!pdf)return res.status(404).json({success:false,message:'PDF not found.'});if(req.user.role==='creator')return res.json({success:true,free:true,access:true,pdf});if(await ownsPdf(req.user.id,pdf.id))return res.json({success:true,alreadyPaid:true,access:true,pdf});try{const ref=await createPayment(req.user,'pdf',pdf.id,pdf.price);const init=await paystackInitialize(req.user.email,pdf.price,ref,{type:'pdf',pdfId:pdf.id});res.json({success:true,reference:ref,amount:pdf.price,currency:'GHS',authorization_url:init?.authorization_url||null,access:false,paymentProvider:PAYSTACK_SECRET_KEY?'paystack':'not_configured',message:init?'Proceed to payment.':'Payment provider is not configured on this server yet.'});}catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}});
app.post('/api/payments/course',requireUser,async(req,res)=>{const c=findCourse(req.body.courseId);if(!c)return res.status(404).json({success:false,message:'Course not found.'});if(req.user.role==='creator')return res.json({success:true,free:true,access:true,course:c});if(await hasCourseAccess(req.user.id,c.id))return res.json({success:true,alreadyPaid:true,access:true,course:c});try{const ref=await createPayment(req.user,'course',c.id,c.price);const init=await paystackInitialize(req.user.email,c.price,ref,{type:'course',courseId:c.id});res.json({success:true,reference:ref,amount:c.price,currency:'GHS',authorization_url:init?.authorization_url||null,access:false,paymentProvider:PAYSTACK_SECRET_KEY?'paystack':'not_configured'});}catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}});
app.post('/api/payments/guidance',requireUser,async(req,res)=>{if(req.user.role==='creator')return res.json({success:true,free:true,access:true});try{const ref=await createPayment(req.user,'guidance','pre-university-check',PRE_UNI_CHECK_PRICE_GHS);const init=await paystackInitialize(req.user.email,PRE_UNI_CHECK_PRICE_GHS,ref,{type:'guidance'});res.json({success:true,reference:ref,amount:PRE_UNI_CHECK_PRICE_GHS,currency:'GHS',authorization_url:init?.authorization_url||null,paymentProvider:PAYSTACK_SECRET_KEY?'paystack':'not_configured'});}catch(e){res.status(500).json({success:false,message:e.message});}});
app.get('/api/payments/verify/:reference',requireUser,async(req,res)=>{try{const reference=req.params.reference;let p;if(pool){const r=await dbQuery('SELECT * FROM payments WHERE reference=$1 AND user_id=$2',[reference,req.user.id]);p=r.rows[0];}else p=memory.payments.get(reference);if(!p||String(p.user_id)!==String(req.user.id))return res.status(404).json({success:false,message:'Payment record not found.'});if(p.status==='success')return res.json({success:true,verified:true,itemType:p.item_type,itemId:p.item_id,reference});const tx=await paystackVerify(reference);const expected=Math.round(Number(p.amount)*100);if(tx.status!=='success'||String(tx.currency).toUpperCase()!=='GHS'||Number(tx.amount)!==expected)return res.status(400).json({success:false,verified:false,message:'Payment verification failed.'});await markPaymentSuccess(reference);res.json({success:true,verified:true,itemType:p.item_type,itemId:p.item_id,reference});}catch(e){res.status(500).json({success:false,verified:false,message:e.message});}});
app.get('/payment/callback',(req,res)=>{const ref=String(req.query.reference||'');res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PASSCOGH-MODOO Payment</title></head><body style="font-family:system-ui;padding:30px;text-align:center"><h2>Payment received</h2><p>Verification is being completed.</p><script>setTimeout(()=>location.href='/?payment_reference=${encodeURIComponent(ref)}',1500)</script></body></html>`);});

/* ----------------------------- CERTIFICATES ----------------------------- */
app.post('/api/courses/:id/certificate',requireUser,async(req,res)=>{const c=findCourse(req.params.id);if(!c)return res.status(404).json({success:false,message:'Course not found.'});let completed=req.user.role==='creator';if(pool){const r=await dbQuery('SELECT * FROM course_enrolments WHERE user_id=$1 AND course_id=$2',[req.user.id,c.id]);completed=completed||Number(r.rows[0]?.progress||0)>=100;}else completed=completed||Number(memory.enrolments.get(`${req.user.id}:${c.id}`)?.progress||0)>=100;if(!completed)return res.status(403).json({success:false,message:'Complete the course before requesting a certificate.'});if(pool){const old=await dbQuery('SELECT * FROM certificates WHERE user_id=$1 AND course_id=$2',[req.user.id,c.id]);if(old.rows[0])return res.json({success:true,certificate:old.rows[0]});const no=`PASSCOGH-${new Date().getFullYear()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;const r=await dbQuery('INSERT INTO certificates(certificate_no,user_id,course_id) VALUES($1,$2,$3) RETURNING *',[no,req.user.id,c.id]);return res.json({success:true,certificate:r.rows[0]});}const key=`${req.user.id}:${c.id}`;if(memory.certificates.has(key))return res.json({success:true,certificate:memory.certificates.get(key)});const cert={certificate_no:`PASSCOGH-${new Date().getFullYear()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,user_id:req.user.id,course_id:c.id,issued_at:new Date().toISOString()};memory.certificates.set(key,cert);res.json({success:true,certificate:cert});});
app.get('/api/certificates/:certificateNo',async(req,res)=>{if(pool){const r=await dbQuery('SELECT c.certificate_no,c.issued_at,u.name,u.email,c.course_id FROM certificates c JOIN users u ON u.id=c.user_id WHERE c.certificate_no=$1',[req.params.certificateNo]);const x=r.rows[0];if(!x)return res.status(404).json({success:false,valid:false,message:'Certificate not found.'});return res.json({success:true,valid:true,certificate:{...x,course_title:findCourse(x.course_id)?.title||x.course_id}});}const x=[...memory.certificates.values()].find(c=>c.certificate_no===req.params.certificateNo);if(!x)return res.status(404).json({success:false,valid:false,message:'Certificate not found.'});const u=memory.users.get(x.user_id);res.json({success:true,valid:true,certificate:{...x,name:u?.name,email:u?.email,course_title:findCourse(x.course_id)?.title||x.course_id}});});

/* ----------------------------- CREATOR ----------------------------- */
app.get('/api/creator/access',requireCreator,(req,res)=>res.json({success:true,creator:true,role:'creator',unlimitedAccess:true,freeCourseAccess:true,freeTopicPdfDownload:true,preUniversityGuidanceFree:true,advertisementsDisabled:true}));
app.get('/api/creator/dashboard',requireCreator,async(req,res)=>{let stats={users:0,enrolments:0,payments:0,certificates:0,guidanceChecks:0};if(pool){for(const [k,q] of Object.entries({users:'SELECT COUNT(*) count FROM users',enrolments:'SELECT COUNT(*) count FROM course_enrolments',payments:"SELECT COUNT(*) count FROM payments WHERE status='success'",certificates:'SELECT COUNT(*) count FROM certificates',guidanceChecks:"SELECT COUNT(*) count FROM guidance_checks WHERE status='success'"})){const r=await dbQuery(q);stats[k]=Number(r.rows[0].count);}}else{stats.users=memory.users.size;stats.enrolments=memory.enrolments.size;stats.payments=[...memory.payments.values()].filter(x=>x.status==='success').length;stats.certificates=memory.certificates.size;stats.guidanceChecks=[...memory.guidance.values()].filter(x=>x.status==='success').length;}res.json({success:true,...stats,curriculum:{levels:getLevels().length,subjects:allSubjects().length,topics:allSubjects().reduce((n,s)=>n+topics(s).length,0)},diagrams:diagrams().length,courses:getCourses().length,pricing:{jhsShsTopicPdfGhs:1,preUniversityCheckGhs:5}});});

/* ----------------------------- SEARCH ----------------------------- */
app.get('/api/search',(req,res)=>{const q=norm(req.query.q);if(!q)return res.json({success:true,results:[]});const results=[];for(const l of getLevels())for(const s of subjects(l)){if(norm(s.name).includes(q))results.push({type:'subject',level:levelId(l),subject:s.name});for(const t of topics(s)){if(norm(t.title).includes(q))results.push({type:'topic',level:levelId(l),subject:s.name,subjectId:s.code,topic:t.title,id:topicPdfId(l,s,t)});}}for(const c of getCourses())if(norm(c.title).includes(q))results.push({type:'course',...c});res.json({success:true,results:results.slice(0,100)});});

/* ----------------------------- DIAGRAM STATIC ----------------------------- */
app.use('/diagrams',express.static(DIAGRAM_DIR,{fallthrough:true,maxAge:'7d'}));

/* ----------------------------- STATIC FRONTEND ----------------------------- */
if(fs.existsSync(PUBLIC_DIR)){
  app.use(express.static(PUBLIC_DIR));
  app.get('/{*splat}',(req,res)=>{if(req.path.startsWith('/api/')||req.path.startsWith('/diagrams/'))return res.status(404).json({success:false,message:'Route not found.'});const index=path.join(PUBLIC_DIR,'index.html');return fs.existsSync(index)?res.sendFile(index):res.status(404).send('PASSCOGH-MODOO frontend is missing.');});
}else app.get('/',(req,res)=>res.status(404).send('PASSCOGH-MODOO public folder is missing.'));

app.use((err,req,res,next)=>{console.error('PASSCOGH-MODOO error:',err);if(res.headersSent)return next(err);res.status(500).json({success:false,message:'PASSCOGH-MODOO server error.'});});

initDb().then(()=>app.listen(PORT,HOST,()=>{const c=loadCurriculum(),ls=getLevels(),ss=allSubjects();console.log(`PASSCOGH-MODOO listening on ${HOST}:${PORT}`);console.log(`Curriculum: ${fs.existsSync(CURRICULUM_FILE)?'FOUND':'MISSING'} | levels=${ls.length} subjects=${ss.length} topics=${ss.reduce((n,s)=>n+topics(s).length,0)}`);console.log(`Diagram library: ${diagrams().length}`);console.log(`PostgreSQL: ${pool?'ENABLED':'NOT CONFIGURED'}`);console.log(`Paystack: ${PAYSTACK_SECRET_KEY?'CONFIGURED':'NOT CONFIGURED'}`);})).catch(e=>{console.error('Database initialization failed:',e);process.exit(1);});
