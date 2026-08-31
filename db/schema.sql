-- PASSCOGH-MODOO PostgreSQL schema
-- Matched to the current backend contract. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner','admin','creator')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payments (
 id BIGSERIAL PRIMARY KEY, reference TEXT UNIQUE NOT NULL, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_type TEXT NOT NULL CHECK (item_type IN ('pdf','course','guidance')),
 item_id TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0), currency TEXT NOT NULL DEFAULT 'GHS',
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','cancelled')),
 provider TEXT NOT NULL DEFAULT 'paystack', provider_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id);
CREATE TABLE IF NOT EXISTS pdf_purchases (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 pdf_id TEXT NOT NULL, payment_reference TEXT UNIQUE NOT NULL REFERENCES payments(reference) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,pdf_id)
);
CREATE TABLE IF NOT EXISTS course_enrolments (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 course_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,course_id)
);
CREATE TABLE IF NOT EXISTS certificates (
 id BIGSERIAL PRIMARY KEY, certificate_no TEXT UNIQUE NOT NULL, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 course_id TEXT NOT NULL, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,course_id)
);
CREATE TABLE IF NOT EXISTS reading_sessions (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, pdf_id TEXT NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ad_due_at TIMESTAMPTZ NOT NULL,
 ad_count INTEGER NOT NULL DEFAULT 0, ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reading_user_idx ON reading_sessions(user_id);
CREATE TABLE IF NOT EXISTS guidance_checks (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reference TEXT UNIQUE NOT NULL, amount NUMERIC(12,2) NOT NULL DEFAULT 5 CHECK(amount=5),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed','used')),
 input_json JSONB NOT NULL DEFAULT '{}'::jsonb, result_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), verified_at TIMESTAMPTZ, used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS guidance_user_idx ON guidance_checks(user_id);
CREATE TABLE IF NOT EXISTS learning_progress (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 level_id TEXT, subject_id TEXT, topic_id TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 last_opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,topic_id)
);
CREATE TABLE IF NOT EXISTS assessment_attempts (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 assessment_type TEXT NOT NULL, level_id TEXT, subject_id TEXT, topic_id TEXT,
 score NUMERIC(8,2), total NUMERIC(8,2), answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS attempts_user_idx ON assessment_attempts(user_id);
CREATE TABLE IF NOT EXISTS saved_items (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,item_type,item_id)
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS system_settings (
 key TEXT PRIMARY KEY, value_json JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO system_settings(key,value_json) VALUES
 ('reading_ad_interval_minutes','5'),
 ('jhs_shs_topic_pdf_price_ghs','1'),
 ('pre_university_guidance_price_ghs','5'),
 ('course_price_ghs','20'),
 ('free_online_reading','true')
ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=NOW();
