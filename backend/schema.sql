CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL,
 password_hash TEXT, role TEXT NOT NULL DEFAULT 'learner'
 CHECK(role IN ('learner','creator')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS subjects (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, level TEXT, code TEXT,
 description TEXT, UNIQUE(name,level)
);
CREATE TABLE IF NOT EXISTS topics (
 id BIGSERIAL PRIMARY KEY, subject_id BIGINT REFERENCES subjects(id) ON DELETE CASCADE,
 title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', diagram_url TEXT,
 memory_aid TEXT, examples JSONB NOT NULL DEFAULT '[]'::jsonb,
 practice JSONB NOT NULL DEFAULT '[]'::jsonb, UNIQUE(subject_id,title)
);
CREATE TABLE IF NOT EXISTS questions (
 id BIGSERIAL PRIMARY KEY, subject_id BIGINT REFERENCES subjects(id) ON DELETE SET NULL,
 topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,
 question_type TEXT NOT NULL DEFAULT 'theory', question TEXT NOT NULL,
 options JSONB, answer TEXT, explanation TEXT, year INTEGER, paper TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS practicals (
 id BIGSERIAL PRIMARY KEY, subject_id BIGINT REFERENCES subjects(id) ON DELETE CASCADE,
 title TEXT NOT NULL, procedure TEXT NOT NULL DEFAULT '',
 materials JSONB NOT NULL DEFAULT '[]'::jsonb, observations TEXT,
 questions JSONB NOT NULL DEFAULT '[]'::jsonb, answers JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS exam_guides (
 id BIGSERIAL PRIMARY KEY, level TEXT, subject_id BIGINT REFERENCES subjects(id) ON DELETE CASCADE,
 title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', UNIQUE(level,subject_id,title)
);
CREATE TABLE IF NOT EXISTS materials (
 id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, filename TEXT, storage_key TEXT,
 price_ghs NUMERIC(10,2) NOT NULL DEFAULT 0, online_reading BOOLEAN NOT NULL DEFAULT TRUE,
 paid_download BOOLEAN NOT NULL DEFAULT TRUE, published BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS courses (
 id BIGSERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT,
 price_ghs NUMERIC(10,2) NOT NULL DEFAULT 20.00,
 certificate_enabled BOOLEAN NOT NULL DEFAULT TRUE, published BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS course_lessons (
 id BIGSERIAL PRIMARY KEY, course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 1,
 UNIQUE(course_id,position)
);
CREATE TABLE IF NOT EXISTS enrollments (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'active', progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,course_id)
);
CREATE TABLE IF NOT EXISTS payments (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_type TEXT NOT NULL CHECK(item_type IN ('course','material','pdf')), item_id TEXT NOT NULL,
 amount_ghs NUMERIC(10,2) NOT NULL, currency TEXT NOT NULL DEFAULT 'GHS',
 reference TEXT UNIQUE NOT NULL, provider TEXT NOT NULL DEFAULT 'paystack',
 status TEXT NOT NULL DEFAULT 'pending', verified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS material_purchases (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
 payment_reference TEXT UNIQUE NOT NULL, purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,material_id)
);
CREATE TABLE IF NOT EXISTS reading_sessions (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
 token_hash TEXT UNIQUE NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS certificates (
 id BIGSERIAL PRIMARY KEY, certificate_no TEXT UNIQUE NOT NULL,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,course_id)
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_practicals_subject ON practicals(subject_id);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_number ON certificates(certificate_no);
INSERT INTO courses(slug,title,description,price_ghs,certificate_enabled,published) VALUES
('coding-programming','Coding & Programming','Programming fundamentals and projects.',20,TRUE,TRUE),
('web-development','Web Development','HTML, CSS, JavaScript and practical websites.',20,TRUE,TRUE),
('digital-skills','Digital Skills','Essential digital skills.',20,TRUE,TRUE),
('data-excel','Data & Excel','Spreadsheets, formulas, charts and data skills.',20,TRUE,TRUE),
('graphic-design','Graphic Design','Practical digital design skills.',20,TRUE,TRUE),
('entrepreneurship','Entrepreneurship','Business ideas, planning and basic finance.',20,TRUE,TRUE),
('digital-marketing','Digital Marketing','Marketing, content and online promotion.',20,TRUE,TRUE),
('study-exam-skills','Study & Exam Skills','Study, revision and examination technique.',20,TRUE,TRUE),
('ai-productivity','AI & Productivity','Responsible AI and productivity workflows.',20,TRUE,TRUE)
ON CONFLICT(slug) DO NOTHING;
INSERT INTO subjects(name,level,description) VALUES
('English Language','JHS/SHS','Grammar, comprehension, vocabulary, writing and communication.'),
('Mathematics','JHS/SHS','Number, algebra, geometry, statistics, probability and problem solving.'),
('Integrated Science','JHS','Science concepts, investigations and applications.'),
('Social Studies','JHS/SHS','Society, citizenship, environment, development and Ghana.'),
('ICT','JHS/SHS','Computer systems, applications, internet technologies and digital skills.'),
('Biology','SHS','Living organisms, cells, genetics, ecology and human biology.'),
('Chemistry','SHS','Matter, atoms, bonding, reactions, organic chemistry and calculations.'),
('Physics','SHS','Mechanics, electricity, waves, heat, matter and modern physics.'),
('Economics','SHS','Markets, production, demand, supply, national income and development.'),
('Geography','SHS','Physical and human geography, environment and field skills.'),
('Government','SHS','Political systems, governance, citizenship and public institutions.'),
('History','JHS/SHS','Ghanaian, African and world history and interpretation.'),
('Financial Accounting','SHS','Accounting principles, records, statements and analysis.'),
('Business Management','SHS','Business organization, management, finance and marketing.'),
('Costing','SHS','Cost concepts, costing methods and decision making.')
ON CONFLICT(name,level) DO NOTHING;
