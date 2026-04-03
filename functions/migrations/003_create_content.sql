-- ─────────────────────────────────────────────────────────────
-- 003 · CONTENT
-- Notes, One Liners, Videos, Case Studies, Mnemonics,
-- E-Books, App Features, Banners
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- NOTES (Article View)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE notes (
  note_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id    UUID         NOT NULL REFERENCES chapters (chapter_id),
  title         VARCHAR(500) NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notes_chapter ON notes (chapter_id, is_active);

-- Numbered subsections inside each note (blog-like, image-rich)
CREATE TABLE note_sections (
  section_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id        UUID         NOT NULL REFERENCES notes (note_id) ON DELETE CASCADE,
  section_number SMALLINT     NOT NULL,
  title          VARCHAR(300) NOT NULL,
  content        TEXT,
  image_url      VARCHAR(500),
  image_caption  VARCHAR(300),
  display_order  SMALLINT     NOT NULL DEFAULT 0
);

CREATE INDEX idx_note_sections_note ON note_sections (note_id, display_order);

-- ─────────────────────────────────────────────────────────────
-- ONE LINERS (subject-wise Q&A)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE one_liners (
  one_liner_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   UUID         NOT NULL REFERENCES subjects (subject_id),
  chapter_id   UUID         REFERENCES chapters (chapter_id),
  question     TEXT         NOT NULL,
  answer       TEXT         NOT NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_one_liners_subject ON one_liners (subject_id, is_active);
CREATE INDEX idx_one_liners_chapter ON one_liners (chapter_id);

-- ─────────────────────────────────────────────────────────────
-- VIDEOS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE videos (
  video_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id       UUID         NOT NULL REFERENCES chapters (chapter_id),
  title            VARCHAR(500) NOT NULL,
  video_url        VARCHAR(1000) NOT NULL,
  thumbnail_url    VARCHAR(500),
  duration_seconds INTEGER,
  min_tier         VARCHAR(20)  NOT NULL DEFAULT 'FREE'
                                CHECK (min_tier IN ('FREE', 'PRO', 'VIP', 'PREMIUM', 'LEGACY')),
  display_order    SMALLINT     NOT NULL DEFAULT 0,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_videos_chapter ON videos (chapter_id, is_active);

-- ─────────────────────────────────────────────────────────────
-- CASE STUDIES (Flashcard model — rich fields per spec)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE case_studies (
  case_id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id           UUID         NOT NULL REFERENCES subjects (subject_id),
  topic_name           VARCHAR(300) NOT NULL,
  title                VARCHAR(500) NOT NULL,
  -- Card fields
  subtitle             VARCHAR(300),
  subtitle_text        TEXT,
  subtitle2            VARCHAR(300),
  subtitle_text2       TEXT,
  subtitle3            VARCHAR(300),
  subtitle_text3       TEXT,
  images               JSONB,        -- [{url, caption}]
  image_text           TEXT,
  -- Answer section
  answer_title         VARCHAR(300),
  answer_title_text    TEXT,
  answer_image_url     VARCHAR(500),
  answer_image_text    TEXT,
  answer_subtitle      VARCHAR(300), -- highlighted box 1
  answer_subtitle_text TEXT,
  answer_subtitle2     VARCHAR(300), -- highlighted box 2
  answer_subtitle2_text TEXT,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order        SMALLINT     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_case_studies_subject ON case_studies (subject_id, is_active);

-- ─────────────────────────────────────────────────────────────
-- VISUAL MNEMONICS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE mnemonics (
  mnemonic_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    UUID         NOT NULL REFERENCES subjects (subject_id),
  title         VARCHAR(300) NOT NULL,
  image_url     VARCHAR(500) NOT NULL,
  description   TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mnemonics_subject ON mnemonics (subject_id, is_active);

-- ─────────────────────────────────────────────────────────────
-- E-BOOKS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE ebooks (
  ebook_id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id            UUID          NOT NULL REFERENCES subjects (subject_id),
  title                 VARCHAR(500)  NOT NULL,
  cover_image_url       VARCHAR(500),
  file_url              VARCHAR(1000) NOT NULL,
  price_inr             NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_inr >= 0),
  is_free_with_premium  BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ebooks_subject ON ebooks (subject_id, is_active);

-- Tracks which users have purchased / unlocked which ebooks
CREATE TABLE user_ebooks (
  user_id      VARCHAR(128) NOT NULL REFERENCES users (user_id),
  ebook_id     UUID         NOT NULL REFERENCES ebooks (ebook_id),
  purchased_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ebook_id)
);

-- ─────────────────────────────────────────────────────────────
-- APP FEATURES (home screen — admin-managed)
-- Admin can toggle isLive, reorder, update icons without a deploy
-- ─────────────────────────────────────────────────────────────

CREATE TABLE app_features (
  feature_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  icon_url      VARCHAR(500),
  route_key     VARCHAR(100) NOT NULL UNIQUE,
  is_live       BOOLEAN      NOT NULL DEFAULT FALSE,
  display_order SMALLINT     NOT NULL DEFAULT 0
);

-- Seed: initial feature list
INSERT INTO app_features (name, route_key, is_live, display_order) VALUES
  ('Question Bank',      'qbank',       TRUE,  1),
  ('Exams',              'exams',       TRUE,  2),
  ('Notes',              'notes',       TRUE,  3),
  ('One Liners',         'oneliners',   TRUE,  4),
  ('Flashcards',         'flashcards',  TRUE,  5),
  ('Case Studies',       'casestudies', TRUE,  6),
  ('Visual Mnemonics',   'mnemonics',   TRUE,  7),
  ('Videos',             'videos',      TRUE,  8),
  ('E-Books',            'ebooks',      TRUE,  9),
  ('Melo AI',            'ai',          TRUE,  10),
  ('Marketplace',        'marketplace', TRUE,  11),
  ('Doctor''s Arena',    'arena',       FALSE, 12);

-- ─────────────────────────────────────────────────────────────
-- BANNERS (slide banner on home screen — fully customisable)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE banners (
  banner_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url     VARCHAR(500) NOT NULL,
  external_link VARCHAR(1000),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
