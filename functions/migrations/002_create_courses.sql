-- ─────────────────────────────────────────────────────────────
-- 002 · COURSES
-- Two-level hierarchy: Main Course → Sub Course → Subject → Chapter
-- ─────────────────────────────────────────────────────────────

CREATE TABLE courses (
  course_id       VARCHAR(20)  PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(5)   NOT NULL CHECK (type IN ('MAIN', 'SUB')),
  parent_course_id VARCHAR(20) REFERENCES courses (course_id),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order   SMALLINT     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed: fixed course structure per spec (MBBS → FMGE/NEXT, NEET → NEET UG/NEET PG)
INSERT INTO courses (course_id, name, type, parent_course_id, display_order) VALUES
  ('MBBS',    'MBBS',    'MAIN', NULL,   1),
  ('NEET',    'NEET',    'MAIN', NULL,   2),
  ('FMGE',    'FMGE',    'SUB',  'MBBS', 1),
  ('NEXT',    'NEXT',    'SUB',  'MBBS', 2),
  ('NEET_UG', 'NEET UG', 'SUB',  'NEET', 1),
  ('NEET_PG', 'NEET PG', 'SUB',  'NEET', 2);

-- ─────────────────────────────────────────────────────────────
-- SUBJECTS
-- Each subject belongs to a sub-course (FMGE, NEXT, NEET_UG, NEET_PG)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE subjects (
  subject_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     VARCHAR(20)  NOT NULL REFERENCES courses (course_id),
  name          VARCHAR(200) NOT NULL,
  icon_url      VARCHAR(500),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subjects_course ON subjects (course_id, is_active);

-- ─────────────────────────────────────────────────────────────
-- CHAPTERS
-- Each chapter belongs to a subject
-- ─────────────────────────────────────────────────────────────

CREATE TABLE chapters (
  chapter_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    UUID         NOT NULL REFERENCES subjects (subject_id),
  name          VARCHAR(200) NOT NULL,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chapters_subject ON chapters (subject_id, is_active);
