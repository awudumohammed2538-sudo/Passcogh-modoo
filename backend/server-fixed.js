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
const CURRICULUM_FILE = path.join(DATA_DIR, "passcogh_curriculum.json");
const UNIVERSITY_FILE = path.join(DATA_DIR, "universities.json");
const INSTITUTION_FILE = path.join(DATA_DIR, "institution.json");

for (const dir of [DATA_DIR, STORAGE_DIR, PDF_DIR]) fs.mkdirSync(dir, { recursive: true });
app.disable("x-powered-by");
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const db = new Database(path.join(DATA_DIR, "passcogh.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("foreign_keys=ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL DEFAULT '',password_hash TEXT,
 role TEXT NOT NULL DEFAULT 'learner' CHECK(role IN('learner','creator')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS course_enrolments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,course_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',
 progress INTEGER NOT NULL DEFAULT 0,completed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,course_id),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL,item_type TEXT NOT NULL,item_id TEXT NOT NULL,
 amount INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'GHS',status TEXT NOT NULL DEFAULT 'pending',provider TEXT NOT NULL DEFAULT 'paystack',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,verified_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS reading_sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,pdf_id TEXT NOT NULL,started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pdf_purchases(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,pdf_id TEXT NOT NULL,payment_reference TEXT UNIQUE NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS certificates(
 id INTEGER PRIMARY KEY AUTOINCREMENT,certificate_no TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL,course_id TEXT NOT NULL,
 issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,UNIQUE(user_id,course_id));
`);

const CREATOR_EMAIL = String(process.env.CREATOR_EMAIL || "awudumohammedmodoo@gmail.com").trim().toLowerCase();
const SESSION_DAYS = 7;
const READING_MINUTES = 30;

const COURSES = [
 ["coding-programming","Coding & Programming","Learn programming foundations and practical coding."],
 ["web-development","Web Development","Build websites using HTML, CSS and JavaScript."],
 ["digital-skills","Digital Skills","Practical digital skills for school, work and life."],
 ["data-excel","Data & Excel","Learn spreadsheets, formulas and useful data skills."],
 ["graphic-design","Graphic Design","Learn practical design principles and digital graphics."],
 ["entrepreneurship","Entrepreneurship","Learn business ideas, planning and practical entrepreneurship."],
 ["digital-marketing","Digital Marketing","Learn practical online marketing and audience growth."],
 ["study-exam-skills","Study & Exam Skills","Improve revision, exam technique and preparation."],
 ["ai-productivity","AI & Productivity","Learn responsible AI use and productivity techniques."]
].map(([id,title,description]) => ({id,title,description,price:20,currency:"GHS",certificateEnabled:true,published:true}));

const SKILLS_PATH = [
 {id:"technology",title:"Technology & Computing",description:"Coding, web development, AI, digital skills and data.",careers:["Software Developer","Web Developer","Data Analyst","IT Support"],courses:["coding-programming","web-development","digital-skills","data-excel","ai-productivity"]},
 {id:"business",title:"Business & Entrepreneurship",description:"Business, marketing and practical enterprise skills.",careers:["Entrepreneur","Digital Marketer","Business Assistant","Sales & Marketing"],courses:["entrepreneurship","digital-marketing","data-excel"]},
 {id:"creative",title:"Creative & Design",description:"Digital design and creative production.",careers:["Graphic Designer","Content Creator","Digital Media Assistant"],courses:["graphic-design","digital-marketing"]},
 {id:"academic-success",title:"Academic Success",description:"Study, revision, examination and transition skills.",careers:["Academic improvement","Exam preparation","Study skills"],courses:["study-exam-skills"]}
];

const PDFS = [
 {id:"biology-revision-pack",title:"Biology Revision Pack",filename:"biology-revision-pack.pdf",price:5,currency:"GHS"},
 {id:"chemistry-revision-pack",title:"Chemistry Revision Pack",filename:"chemistry-revision-pack.pdf",price:5,currency:"GHS"},
 {id:"wassce-exam-guide",title:"WASSCE Exam Guide",filename:"wassce-exam-guide.pdf",price:5,currency:"GHS"}
];

const hash = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const cleanEmail = v => { const e=String(v||"").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null; };
const json = file => { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,"utf8")) : null; } catch(e) { console.error("JSON error:",file,e); return null; } };
function createSession(userId){const raw=crypto.randomBytes(48).toString("hex");db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(hash(raw),userId,Date.now()+SESSION_DAYS*86400000);return raw;}
function currentUser(req){const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return null;db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());return db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?`).get(hash(h.slice(7).trim()),Date.now())||null;}
function auth(req,res,next){const u=currentUser(req);if(!u)return res.status(401).json({success:false,message:"Authentication required."});req.user=u;next();}
function creator(req,res,next){const u=currentUser(req);if(!u||u.role!=="creator")return res.status(403).json({success:false,message:"Creator access denied."});req.user=u;next();}
function base(req){return String(process.env.PUBLIC_BASE_URL||"").trim().replace(/\/+$/i,"")||`${req.protocol}://${req.get("host")}`;}

function normalizeTitle(value){
  if(value && typeof value === "object") return String(value.title || value.name || value.text || "").trim();
  return String(value ?? "").trim();
}
function normalizeLevels(raw){
  if(Array.isArray(raw)) return raw;
  if(raw && typeof raw === "object"){
    if(raw.levels && typeof raw.levels === "object" && !Array.isArray(raw.levels)) raw=raw.levels;
    return Object.entries(raw).map(([id,level])=>{
      if(!level || typeof level !== "object") return {id,name:id,subjects:[]};
      return {...level,id:level.id||id,name:level.name||level.title||id};
    });
  }
  return [];
}
function loadCurriculum(){
 const c=json(CURRICULUM_FILE);
 if(c===null)return {platform:"PASSCOGH-MODOO",error:"passcogh_curriculum.json was not found or could not be read.",levels:[],questions:[],pastQuestions:[],practical:[],examGuides:[],skillsPath:SKILLS_PATH};
 const rawLevels=Array.isArray(c)?c:c.levels;
 return {...(Array.isArray(c)?{}:c),platform:(Array.isArray(c)?"PASSCOGH-MODOO":c.platform)||"PASSCOGH-MODOO",levels:normalizeLevels(rawLevels),questions:Array.isArray(c.questions)?c.questions:(Array.isArray(c.questionBank)?c.questionBank:[]),pastQuestions:Array.isArray(c.pastQuestions)?c.pastQuestions:[],practical:Array.isArray(c.practical)?c.practical:(Array.isArray(c.practicalPreparation)?c.practicalPreparation:[]),examGuides:Array.isArray(c.examGuides)?c.examGuides:[],skillsPath:Array.isArray(c.skillsPath)?c.skillsPath:SKILLS_PATH};
}
function levels(){return loadCurriculum().levels;}
function levelMatches(level,value){const q=String(value||"").trim().toLowerCase();return [level.id,level.name,level.title,level.level].some(x=>String(x||"").trim().toLowerCase()===q);}
function subjects(){const out=[];for(const l of levels()){const list=Array.isArray(l.subjects)?l.subjects:(Array.isArray(l.courses)?l.courses:(Array.isArray(l.subjectList)?l.subjectList:[]));for(const s of list)if(s&&typeof s==="object")out.push({...s,id:s.id||s.code||`${l.id}-${out.length+1}`,name:normalizeTitle(s.name||s.title)||s.code||"Subject",level:s.level||l.name||l.title||l.level||l.id||"",levelId:l.id||""});}return out;}
function getSubjectsFromLevel(level){return subjects().filter(s=>s.levelId===level.id);}
function findSubject(v){const q=String(v||"").trim().toLowerCase();return subjects().find(s=>String(s.id||s.code||"").toLowerCase()===q||normalizeTitle(s.name||s.title).toLowerCase()===q);}
function topics(s){if(Array.isArray(s?.topics))return s.topics;if(Array.isArray(s?.units))return s.units;if(Array.isArray(s?.sections))return s.sections.map((x,i)=>typeof x==="object"?x:{id:String(i+1),name:String(x)});return[];}
function topicName(t){return normalizeTitle(t?.name||t?.title||t?.id||"");}
function findTopic(s,v){const q=String(v||"").trim().toLowerCase();return topics(s).find(t=>String(t?.id||t?.code||"").toLowerCase()===q||topicName(t).toLowerCase()===q);}
function getLesson(t){return t?.lesson&&typeof t.lesson==="object"?t.lesson:t||{};}

function findCourse(v){const q=String(v||"").trim().toLowerCase();return COURSES.find(c=>c.id.toLowerCase()===q||c.title.toLowerCase()===q);}
function findPdf(v){const q=String(v||"").trim().toLowerCase();return PDFS.find(p=>p.id.toLowerCase()===q||p.title.toLowerCase()===q);}
function universities(){
 for(const file of [UNIVERSITY_FILE,INSTITUTION_FILE]){const d=json(file);if(Array.isArray(d))return d;if(d?.universities&&Array.isArray(d.universities))return d.universities;if(d?.institutions&&Array.isArray(d.institutions))return d.institutions;if(d?.items&&Array.isArray(d.items))return d.items;}
 const c=loadCurriculum();return Array.isArray(c.universities)?c.universities:(Array.isArray(c.institutions)?c.institutions:[]);
}
function universityCourses(){
 const c=loadCurriculum();if(Array.isArray(c.universityCourses))return c.universityCourses;if(Array.isArray(c.tertiaryCourses))return c.tertiaryCourses;
 const out=[];for(const u of universities()){const list=Array.isArray(u.courses)?u.courses:(Array.isArray(u.programmes)?u.programmes:[]);for(const x of list)out.push({...x,universityId:x.universityId||u.id||u.name||""});}return out;
}
function inputResults(body){if(body?.results&&!Array.isArray(body.results)&&typeof body.results==="object")return Object.entries(body.results).map(([subject,score])=>({subject,score:Number(score)}));const a=Array.isArray(body?.results)?body.results:(Array.isArray(body?.wassceResults)?body.wassceResults:(Array.isArray(body?.subjects)?body.subjects:[]));return a.map(x=>({subject:x.subject||x.name||x.title||x.code||"",score:Number(x.score??x.mark??x.percentage),grade:x.grade||""}));}
function grade(g,score){const x=String(g||"").trim().toUpperCase();if(/^\d$/.test(x))return Number(x);if(/^A1$/.test(x))return 1;if(/^B2$/.test(x))return 2;if(/^B3$/.test(x))return 3;if(/^C4$/.test(x))return 4;if(/^C5$/.test(x))return 5;if(/^C6$/.test(x))return 6;if(/^D7$/.test(x))return 7;if(/^E8$/.test(x))return 8;if(/^F9$/.test(x))return 9;const n=Number(score);if(!Number.isFinite(n))return null;if(n>=80)return 1;if(n>=75)return 2;if(n>=70)return 3;if(n>=65)return 4;if(n>=60)return 5;if(n>=55)return 6;if(n>=50)return 7;if(n>=45)return 8;return 9;}
function sameSubject(a,b){const x=String(a||"").toLowerCase().replace(/[^a-z0-9]/g,"");const y=String(b||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(x===y)return true;const aliases={mathematics:["maths"],maths:["mathematics"],english:["englishlanguage"],englishlanguage:["english"],integratedscience:["science"],science:["integratedscience"]};return (aliases[x]||[]).includes(y)||(aliases[y]||[]).includes(x);}
function requirements(c){return c?.requirements||c?.requiredSubjects||c?.subjectRequirements||c?.wassceRequirements||[];}
function evaluate(c,results,goal){const req=requirements(c);if(!req.length)return{qualified:true,score:50,reason:"No detailed WASSCE requirements are stored for this course."};const missing=[];let passed=0;for(const r of req){const name=typeof r==="string"?r:(r.subject||r.name||r.code||"");const hit=results.find(z=>sameSubject(z.subject,name));if(!hit){missing.push(name);continue;}const g=grade(hit.grade,hit.score);const max=typeof r==="object"?Number(r.maxGrade??r.minimumGrade):NaN;if(!Number.isFinite(max)||g<=max)passed++;else missing.push(name);}const text=JSON.stringify(c).toLowerCase();const words=String(goal||"").toLowerCase().split(/\s+/).filter(w=>w.length>=4);const career=words.reduce((n,w)=>n+(text.includes(w)?10:0),0);return{qualified:missing.length===0,score:Math.round(passed/req.length*100+career),passedRequirements:passed,totalRequirements:req.length,missingRequirements:missing,reason:missing.length?`Missing or insufficient requirement(s): ${missing.join(", ")}`:"Your supplied results meet the listed requirements."};}

async function paystackInitialize({email,amount,reference,callbackUrl}){const secret=process.env.PAYSTACK_SECRET_KEY;if(!secret)throw Error("PAYSTACK_SECRET_KEY is not configured on the server.");const r=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify({email,amount:Math.round(Number(amount)*100),currency:"GHS",reference,callback_url:callbackUrl})});const d=await r.json();if(!r.ok||!d.status)throw Error(d.message||"Payment initialization failed.");return d.data;}
async function paystackVerify(reference){const secret=process.env.PAYSTACK_SECRET_KEY;if(!secret)throw Error("PAYSTACK_SECRET_KEY is not configured.");const r=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${secret}`}});const d=await r.json();if(!r.ok||!d.status||!d.data)throw Error(d.message||"Could not verify payment.");return d.data;}
function completePayment(p){db.prepare("UPDATE payments SET status='success',verified_at=CURRENT_TIMESTAMP WHERE reference=?").run(p.reference);if(p.item_type==="course")db.prepare(`INSERT INTO course_enrolments(user_id,course_id,status,progress) VALUES(?,?,'active',0) ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`).run(p.user_id,p.item_id);if(p.item_type==="pdf")db.prepare(`INSERT OR IGNORE INTO pdf_purchases(user_id,pdf_id,payment_reference) VALUES(?,?,?)`).run(p.user_id,p.item_id,p.reference);}

/* AUTH */
app.post("/api/auth/register",(req,res)=>{try{const e=cleanEmail(req.body.email),n=String(req.body.name||"").trim();if(!e)return res.status(400).json({success:false,message:"Enter a valid email address."});if(!n)return res.status(400).json({success:false,message:"Name is required."});const role=e===CREATOR_EMAIL?"creator":"learner";db.prepare("INSERT INTO users(email,name,role) VALUES(?,?,?)").run(e,n,role);const u=db.prepare("SELECT id,email,name,role,created_at FROM users WHERE email=?").get(e);res.status(201).json({success:true,user:u,token:createSession(u.id)});}catch(e){if(String(e.message).includes("UNIQUE"))return res.status(409).json({success:false,message:"An account with that email already exists."});console.error(e);res.status(500).json({success:false,message:"Registration failed."});}});
app.post("/api/auth/login",(req,res)=>{const e=cleanEmail(req.body.email);if(!e)return res.status(400).json({success:false,message:"Enter a valid email address."});const u=db.prepare("SELECT id,email,name,role,created_at FROM users WHERE email=?").get(e);if(!u)return res.status(401).json({success:false,message:"Account not found. Please register first."});res.json({success:true,user:u,token:createSession(u.id)});});
app.post("/api/auth/logout",auth,(req,res)=>{const t=req.headers.authorization||"";db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(t.slice(7).trim()));res.json({success:true,message:"Logged out."});});
app.get("/api/auth/me",auth,(req,res)=>res.json({success:true,user:{id:req.user.id,email:req.user.email,name:req.user.name,role:req.user.role,created_at:req.user.created_at}}));

/* HEALTH */
app.get("/api/health",(req,res)=>{const c=loadCurriculum();res.json({success:true,message:"PASSCOGH-MODOO backend is running",curriculumFile:path.basename(CURRICULUM_FILE),curriculumFileExists:fs.existsSync(CURRICULUM_FILE),levels:levels().length,subjects:subjects().length,courses:COURSES.length,pdfs:PDFS.length,skillsPaths:SKILLS_PATH.length,universities:universities().length,universityCourses:universityCourses().length,questions:c.questions.length,pastQuestions:c.pastQuestions.length,practical:c.practical.length,examGuides:c.examGuides.length,paymentProvider:process.env.PAYSTACK_SECRET_KEY?"configured":"not_configured"});});

/* CURRICULUM */
app.get("/api/curriculum",(req,res)=>res.json({success:true,curriculum:loadCurriculum()}));
app.get("/api/levels",(req,res)=>res.json({success:true,levels:levels()}));
app.get("/api/levels/:level",(req,res)=>{const level=levels().find(x=>levelMatches(x,req.params.level));if(!level)return res.status(404).json({success:false,message:"Level not found."});res.json({success:true,level});});
app.get("/api/levels/:level/subjects",(req,res)=>{const level=levels().find(x=>levelMatches(x,req.params.level));if(!level)return res.status(404).json({success:false,message:"Level not found."});res.json({success:true,level:level.name||level.id,subjects:getSubjectsFromLevel(level)});});
app.get("/api/subjects",(req,res)=>res.json({success:true,subjects:subjects()}));
app.get("/api/subjects/:subject",(req,res)=>{const s=findSubject(req.params.subject);if(!s)return res.status(404).json({success:false,message:"Subject not found."});res.json({success:true,subject:s});});
app.get("/api/subjects/:subject/topics",(req,res)=>{const s=findSubject(req.params.subject);if(!s)return res.status(404).json({success:false,message:"Subject not found."});res.json({success:true,subject:s.name||s.title,level:s.level||"",topics:topics(s)});});
app.get("/api/subjects/:subject/topics/:topic",(req,res)=>{const s=findSubject(req.params.subject);if(!s)return res.status(404).json({success:false,message:"Subject not found."});const t=findTopic(s,req.params.topic);if(!t)return res.status(404).json({success:false,message:"Topic not found."});const lesson=getLesson(t);res.json({success:true,subject:s.name||s.title,level:s.level||"",topic:t,lesson,formulas:formulas(t).length?formulas(t):formulas(lesson),realLifeApplications:applications(t).length?applications(t):applications(lesson)});});
app.get("/api/subjects/:subject/topics/:topic/lesson",(req,res)=>{const s=findSubject(req.params.subject);if(!s)return res.status(404).json({success:false,message:"Subject not found."});const t=findTopic(s,req.params.topic);if(!t)return res.status(404).json({success:false,message:"Topic not found."});res.json({success:true,subject:s.name||s.title,level:s.level||"",topic:topicName(t),lesson:getLesson(t)});});
app.get("/api/subjects/:subject/topics/:topic/formulas",(req,res)=>{const s=findSubject(req.params.subject),t=s&&findTopic(s,req.params.topic);if(!s)return res.status(404).json({success:false,message:"Subject not found."});if(!t)return res.status(404).json({success:false,message:"Topic not found."});res.json({success:true,subject:s.name||s.title,topic:t.name||t.title||req.params.topic,formulas:formulas(t)});});
app.get("/api/questions",(req,res)=>res.json({success:true,questions:loadCurriculum().questions}));
app.get("/api/past-questions",(req,res)=>res.json({success:true,pastQuestions:loadCurriculum().pastQuestions}));
app.get("/api/practical",(req,res)=>res.json({success:true,practical:loadCurriculum().practical}));
app.get("/api/exam-guides",(req,res)=>res.json({success:true,examGuides:loadCurriculum().examGuides}));

/* SKILLS */
app.get("/api/skills-path",(req,res)=>res.json({success:true,skillsPath:loadCurriculum().skillsPath}));
app.get("/api/skills-path/:id",(req,res)=>{const x=loadCurriculum().skillsPath.find(s=>String(s.id).toLowerCase()===String(req.params.id).toLowerCase());if(!x)return res.status(404).json({success:false,message:"Skills path not found."});res.json({success:true,skillsPath:x});});

/* COURSES */
app.get("/api/courses",(req,res)=>res.json({success:true,courses:COURSES.filter(c=>c.published)}));
app.get("/api/courses/:id/access",auth,(req,res)=>{const c=findCourse(req.params.id);if(!c)return res.status(404).json({success:false,message:"Course not found."});if(req.user.role==="creator")return res.json({success:true,access:true,creator:true,enrolment:null});const e=db.prepare("SELECT * FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'").get(req.user.id,c.id);res.json({success:true,access:!!e,enrolment:e||null});});
app.get("/api/enrolments",auth,(req,res)=>res.json({success:true,enrolments:db.prepare("SELECT * FROM course_enrolments WHERE user_id=? ORDER BY created_at DESC").all(req.user.id)}));
app.post("/api/payments/course",auth,async(req,res)=>{try{const c=findCourse(req.body.courseId);if(!c)return res.status(404).json({success:false,message:"Course not found."});if(req.user.role==="creator"){db.prepare(`INSERT INTO course_enrolments(user_id,course_id,status,progress) VALUES(?,?,'active',0) ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`).run(req.user.id,c.id);return res.json({success:true,enrolled:true,creator:true});}const old=db.prepare("SELECT 1 FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'").get(req.user.id,c.id);if(old)return res.json({success:true,enrolled:true,alreadyEnrolled:true});const ref=`PASSCOGH-COURSE-${crypto.randomUUID()}`;db.prepare("INSERT INTO payments(reference,user_id,item_type,item_id,amount,currency) VALUES(?,?, 'course',?,?,'GHS')").run(ref,req.user.id,c.id,c.price);const p=await paystackInitialize({email:req.user.email,amount:c.price,reference:ref,callbackUrl:`${base(req)}/payment/callback`});res.json({success:true,paymentRequired:true,authorizationUrl:p.authorization_url,accessCode:p.access_code,reference:ref});}catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}});

/* PDFS */
app.get("/api/pdfs",(req,res)=>res.json({success:true,pdfs:PDFS.map(p=>({...p,onlineReading:true,paidDownload:true}))}));
app.post("/api/reading/start",auth,(req,res)=>{const p=findPdf(req.body.pdfId);if(!p)return res.status(404).json({success:false,message:"PDF not found."});const expires=new Date(Date.now()+READING_MINUTES*60000).toISOString();db.prepare("INSERT INTO reading_sessions(user_id,pdf_id,expires_at) VALUES(?,?,?)").run(req.user.id,p.id,expires);res.json({success:true,readingSessionStarted:true,pdfId:p.id,expiresAt:expires,advertisementsEnabled:req.user.role!=="creator"});});
app.get("/api/pdfs/:id/read",auth,(req,res)=>{const p=findPdf(req.params.id);if(!p)return res.status(404).json({success:false,message:"PDF not found."});const file=path.join(PDF_DIR,p.filename);if(!fs.existsSync(file))return res.status(404).json({success:false,message:"The protected PDF has not been uploaded yet."});if(req.user.role!=="creator"){const s=db.prepare("SELECT 1 FROM reading_sessions WHERE user_id=? AND pdf_id=? AND datetime(expires_at)>CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1").get(req.user.id,p.id);if(!s)return res.status(403).json({success:false,message:"Start a free online reading session first."});}res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition","inline");res.setHeader("Cache-Control","private,no-store");fs.createReadStream(file).pipe(res);});
app.get("/api/pdfs/:id/download-access",auth,(req,res)=>{const p=findPdf(req.params.id);if(!p)return res.status(404).json({success:false,message:"PDF not found."});if(req.user.role==="creator")return res.json({success:true,allowed:true,creator:true});const x=db.prepare("SELECT 1 FROM pdf_purchases WHERE user_id=? AND pdf_id=?").get(req.user.id,p.id);res.json({success:true,allowed:!!x});});
app.post("/api/payments/pdf",auth,async(req,res)=>{try{const p=findPdf(req.body.pdfId);if(!p)return res.status(404).json({success:false,message:"PDF not found."});if(req.user.role==="creator")return res.json({success:true,downloadAllowed:true,creator:true});const old=db.prepare("SELECT 1 FROM pdf_purchases WHERE user_id=? AND pdf_id=?").get(req.user.id,p.id);if(old)return res.json({success:true,downloadAllowed:true,alreadyPurchased:true});const ref=`PASSCOGH-PDF-${crypto.randomUUID()}`;db.prepare("INSERT INTO payments(reference,user_id,item_type,item_id,amount,currency) VALUES(?,?, 'pdf',?,?,'GHS')").run(ref,req.user.id,p.id,p.price);const x=await paystackInitialize({email:req.user.email,amount:p.price,reference:ref,callbackUrl:`${base(req)}/payment/callback`});res.json({success:true,paymentRequired:true,authorizationUrl:x.authorization_url,accessCode:x.access_code,reference:ref});}catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}});
app.get("/api/pdfs/:id/download",auth,(req,res)=>{const p=findPdf(req.params.id);if(!p)return res.status(404).json({success:false,message:"PDF not found."});if(req.user.role!=="creator"&&!db.prepare("SELECT 1 FROM pdf_purchases WHERE user_id=? AND pdf_id=?").get(req.user.id,p.id))return res.status(403).json({success:false,message:"Paid download access is required."});const file=path.join(PDF_DIR,p.filename);if(!fs.existsSync(file))return res.status(404).json({success:false,message:"The protected PDF has not been uploaded yet."});res.setHeader("Cache-Control","private,no-store");res.download(file,p.filename);});

/* PAYMENTS */
app.get("/api/payments/verify/:reference",auth,async(req,res)=>{try{const ref=String(req.params.reference),p=db.prepare("SELECT * FROM payments WHERE reference=? AND user_id=?").get(ref,req.user.id);if(!p)return res.status(404).json({success:false,message:"Payment record not found."});if(p.status==="success")return res.json({success:true,verified:true,itemType:p.item_type,itemId:p.item_id,reference:ref});const t=await paystackVerify(ref);if(t.status!=="success"||String(t.currency).toUpperCase()!=="GHS"||Number(t.amount)!==Number(p.amount)*100)return res.status(400).json({success:false,verified:false,message:"Payment verification failed."});completePayment(p);res.json({success:true,verified:true,itemType:p.item_type,itemId:p.item_id,reference:ref});}catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}});
app.get("/payment/callback",(req,res)=>{const ref=String(req.query.reference||"").replace(/[^a-zA-Z0-9._:-]/g,"");res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PASSCOGH-MODOO Payment</title></head><body style="font-family:system-ui;text-align:center;padding:40px"><h2>PASSCOGH-MODOO</h2><p id="s">Payment received. Verifying...</p><script>(async()=>{const r=${JSON.stringify(ref)},t=localStorage.getItem("passcogh_token")||localStorage.getItem("passcogh_auth_token"),s=document.getElementById("s");if(!t){s.textContent="Payment received. Return to PASSCOGH-MODOO and log in.";return setTimeout(()=>location.href="/",3500)}try{const x=await fetch("/api/payments/verify/"+encodeURIComponent(r),{headers:{Authorization:"Bearer "+t}}),d=await x.json();s.textContent=x.ok&&d.verified?"Payment verified successfully. Your access is active.":(d.message||"Verification could not be completed.")}catch(e){s.textContent="Payment was received, but verification could not be completed automatically."}setTimeout(()=>location.href="/",3000)})()</script></body></html>`);});

/* PROGRESS / CERTIFICATES */
app.post("/api/courses/:id/progress",auth,(req,res)=>{const c=findCourse(req.params.id);if(!c)return res.status(404).json({success:false,message:"Course not found."});let n=Number(req.body.progress);if(!Number.isFinite(n)||n<0||n>100)return res.status(400).json({success:false,message:"Progress must be between 0 and 100."});n=Math.round(n);if(req.user.role!=="creator"&&!db.prepare("SELECT 1 FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'").get(req.user.id,c.id))return res.status(403).json({success:false,message:"You must be enrolled first."});db.prepare(`INSERT INTO course_enrolments(user_id,course_id,status,progress) VALUES(?,?,'active',?) ON CONFLICT(user_id,course_id) DO UPDATE SET status='active',progress=?,completed_at=CASE WHEN ?=100 THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE completed_at END`).run(req.user.id,c.id,n,n,n);res.json({success:true,progress:n});});
app.post("/api/courses/:id/certificate",auth,(req,res)=>{const c=findCourse(req.params.id);if(!c)return res.status(404).json({success:false,message:"Course not found."});const e=db.prepare("SELECT * FROM course_enrolments WHERE user_id=? AND course_id=? AND status='active'").get(req.user.id,c.id);if(req.user.role!=="creator"&&(!e||Number(e.progress)<100))return res.status(403).json({success:false,message:"Complete the course before requesting a certificate."});const old=db.prepare("SELECT * FROM certificates WHERE user_id=? AND course_id=?").get(req.user.id,c.id);if(old)return res.json({success:true,certificate:old});const no=`PASSCOGH-${new Date().getFullYear()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;db.prepare("INSERT INTO certificates(certificate_no,user_id,course_id) VALUES(?,?,?)").run(no,req.user.id,c.id);res.json({success:true,certificate:db.prepare("SELECT * FROM certificates WHERE certificate_no=?").get(no)});});
app.get("/api/certificates/:certificateNo",(req,res)=>{const x=db.prepare(`SELECT certificates.certificate_no,certificates.issued_at,users.name,users.email,certificates.course_id FROM certificates JOIN users ON users.id=certificates.user_id WHERE certificates.certificate_no=?`).get(req.params.certificateNo);if(!x)return res.status(404).json({success:false,valid:false,message:"Certificate not found."});res.json({success:true,valid:true,certificate:{...x,course_title:findCourse(x.course_id)?.title||x.course_id}});});

/* UNIVERSITY / WASSCE GUIDANCE */
app.get("/api/universities",(req,res)=>res.json({success:true,universities:universities()}));
app.get("/api/university-courses",(req,res)=>res.json({success:true,courses:universityCourses()}));
app.post("/api/university/recommend",(req,res)=>{try{const results=inputResults(req.body),goal=String(req.body.jobGoal||req.body.careerGoal||req.body.outsideJob||"").trim();const courses=universityCourses(),us=universities();const qualified=courses.map(c=>({...c,...evaluate(c,results,goal)})).filter(c=>c.qualified).sort((a,b)=>b.score-a.score);const ranking=us.map(u=>{const text=JSON.stringify(u).toLowerCase();const words=goal.toLowerCase().split(/\s+/).filter(w=>w.length>=4);const career=words.reduce((n,w)=>n+(text.includes(w)?10:0),0);const rank=Number(u.rank??u.ranking??u.position);return{...u,recommendationScore:(Number.isFinite(rank)?Math.max(0,100-rank):50)+career};}).sort((a,b)=>b.recommendationScore-a.recommendationScore);res.json({success:true,resultsReceived:results,jobGoal:goal,qualifiedCourses:qualified,universityRanking:ranking,note:courses.length?"Recommendations use the requirements stored in the university/course data.":"No university-course requirement data is loaded yet. Add it to the data folder to enable detailed matching."});}catch(e){console.error(e);res.status(500).json({success:false,message:"Unable to calculate university recommendations."});}});

/* CREATOR */
app.get("/api/creator/access",creator,(req,res)=>res.json({success:true,creator:true,email:req.user.email,role:req.user.role,unlimitedAccess:true,freeCourseAccess:true,freePdfDownload:true,advertisementsDisabled:true}));
app.get("/api/creator/dashboard",creator,(req,res)=>{const c=loadCurriculum();res.json({success:true,users:db.prepare("SELECT COUNT(*) count FROM users").get().count,enrolments:db.prepare("SELECT COUNT(*) count FROM course_enrolments").get().count,successfulPayments:db.prepare("SELECT COUNT(*) count FROM payments WHERE status='success'").get().count,certificates:db.prepare("SELECT COUNT(*) count FROM certificates").get().count,pdfPurchases:db.prepare("SELECT COUNT(*) count FROM pdf_purchases").get().count,curriculumFile:fs.existsSync(CURRICULUM_FILE),curriculumLevels:levels().length,curriculumSubjects:subjects().length,questions:c.questions.length,pastQuestions:c.pastQuestions.length,practical:c.practical.length,examGuides:c.examGuides.length,courses:COURSES.length,pdfs:PDFS.length,universities:universities().length,universityCourses:universityCourses().length});});
app.get("/api/creator/curriculum",creator,(req,res)=>res.json({success:true,curriculum:loadCurriculum()}));
app.get("/api/creator/payments",creator,(req,res)=>res.json({success:true,payments:db.prepare(`SELECT payments.*,users.email,users.name FROM payments JOIN users ON users.id=payments.user_id ORDER BY payments.created_at DESC`).all()}));

/* STATIC */
app.use(express.static(PUBLIC_DIR,{index:"index.html"}));
app.get("/{*splat}",(req,res,next)=>{if(req.path.startsWith("/api/")||req.path==="/payment/callback")return next();const index=path.join(PUBLIC_DIR,"index.html");if(!fs.existsSync(index))return res.status(404).send("PASSCOGH-MODOO index.html is missing.");res.sendFile(index);});
app.use((err,req,res,next)=>{console.error("PASSCOGH-MODOO server error:",err);if(res.headersSent)return next(err);res.status(500).json({success:false,message:"PASSCOGH-MODOO server error."});});

app.listen(PORT,"0.0.0.0",()=>{console.log(`PASSCOGH-MODOO running on port ${PORT}`);console.log(`Curriculum file: ${fs.existsSync(CURRICULUM_FILE)?"FOUND":"MISSING"}`);console.log(`Levels: ${levels().length}`);console.log(`Subjects: ${subjects().length}`);console.log(`Universities: ${universities().length}`);console.log(`University courses: ${universityCourses().length}`);console.log(`Paystack: ${process.env.PAYSTACK_SECRET_KEY?"CONFIGURED":"NOT CONFIGURED"}`);});
