-- PASSCOGH-MODOO PostgreSQL schema
-- The server also creates these tables automatically at startup.
-- Keep this file as a reference/migration record.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'learner'
    CHECK (role IN ('learner','creator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Additional tables are created by server.js:
-- payments, pdf_purchases, course_enrolments, course_progress,
-- quiz_attempts, learning_progress, reading_sessions,
-- guidance_checks, certificates.
