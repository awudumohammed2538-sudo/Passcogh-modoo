-- PASSCOGH-MODOO
-- Database initialization migration
-- PostgreSQL 14+
-- File: db/001_init.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'teacher', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('JHS', 'SHS', 'TERTIARY')),
    category TEXT,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curriculum_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    curriculum_source TEXT NOT NULL DEFAULT 'official',
    academic_level TEXT,
    year_group TEXT,
    strand TEXT,
    sub_strand TEXT,
    topic TEXT NOT NULL,
    learning_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
    content_standards JSONB NOT NULL DEFAULT '[]'::jsonb,
    performance_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_reference TEXT,
    source_year INTEGER,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    curriculum_unit_id UUID REFERENCES curriculum_units(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    summary TEXT,
    content TEXT NOT NULL,
    learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    memory_hooks JSONB NOT NULL DEFAULT '[]'::jsonb,
    diagrams JSONB NOT NULL DEFAULT '[]'::jsonb,
    practical_activity JSONB,
    difficulty TEXT NOT NULL DEFAULT 'intermediate'
        CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    curriculum_unit_id UUID REFERENCES curriculum_units(id) ON DELETE SET NULL,
    lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
    question_type TEXT NOT NULL DEFAULT 'mcq'
        CHECK (question_type IN ('mcq', 'short_answer', 'structured', 'essay', 'practical')),
    question_text TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_answer TEXT,
    marking_scheme TEXT,
    explanation TEXT,
    source_type TEXT NOT NULL DEFAULT 'passco_practice'
        CHECK (source_type IN ('official_past_question', 'passco_practice', 'teacher_created')),
    source_name TEXT,
    source_year INTEGER,
    source_reference TEXT,
    is_verified_source BOOLEAN NOT NULL DEFAULT FALSE,
    difficulty TEXT NOT NULL DEFAULT 'intermediate'
        CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS question_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer_given TEXT,
    is_correct BOOLEAN,
    score NUMERIC(6,2),
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'started'
        CHECK (status IN ('started', 'completed')),
    progress_percent INTEGER NOT NULL DEFAULT 0
        CHECK (progress_percent BETWEEN 0 AND 100),
    last_opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS curriculum_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    organisation TEXT,
    document_title TEXT,
    source_url TEXT,
    publication_year INTEGER,
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'needs_review')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curriculum_units_subject ON curriculum_units(subject_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_units_topic ON curriculum_units(topic);
CREATE INDEX IF NOT EXISTS idx_lessons_subject ON lessons(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_curriculum_unit ON questions(curriculum_unit_id);
CREATE INDEX IF NOT EXISTS idx_questions_source_type ON questions(source_type);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON question_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_user ON study_progress(user_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS curriculum_units_set_updated_at ON curriculum_units;
CREATE TRIGGER curriculum_units_set_updated_at
BEFORE UPDATE ON curriculum_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS lessons_set_updated_at ON lessons;
CREATE TRIGGER lessons_set_updated_at
BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS questions_set_updated_at ON questions;
CREATE TRIGGER questions_set_updated_at
BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
