-- ─────────────────────────────────────────────────────────────
-- 004 · QUESTION BANK & FLASHCARDS
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- QUESTION BANK
-- Navigation: Subject → Chapter → Question Set → Questions
-- ─────────────────────────────────────────────────────────────

CREATE TABLE question_sets (
  question_set_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id      UUID         NOT NULL REFERENCES chapters (chapter_id),
  name            VARCHAR(300) NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order   SMALLINT     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_question_sets_chapter ON question_sets (chapter_id, is_active);

CREATE TABLE questions (
  question_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_set_id  UUID         NOT NULL REFERENCES question_sets (question_set_id),
  question_text    TEXT         NOT NULL,
  question_image_url VARCHAR(500),
  -- Up to 6 options — text, image, or mixed
  -- [{text?, imageUrl?, isCorrect: bool}]
  options          JSONB        NOT NULL,
  answer_description TEXT,
  -- Up to 3 answer images: [{url, caption?}]
  answer_images    JSONB,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_questions_set ON questions (question_set_id, is_active);

-- ─────────────────────────────────────────────────────────────
-- USER-CREATED FLASHCARDS
-- User creates decks → adds cards with front/back
-- Progress is tracked in DynamoDB FlashcardProgress table
-- ─────────────────────────────────────────────────────────────

CREATE TABLE flashcard_decks (
  deck_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    VARCHAR(128) NOT NULL REFERENCES users (user_id),
  name       VARCHAR(300) NOT NULL,
  topic      VARCHAR(200),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_flashcard_decks_user ON flashcard_decks (user_id);

CREATE TABLE flashcards (
  card_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id       UUID         NOT NULL REFERENCES flashcard_decks (deck_id) ON DELETE CASCADE,
  front         TEXT         NOT NULL,
  back          TEXT         NOT NULL,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_flashcards_deck ON flashcards (deck_id, display_order);

-- ─────────────────────────────────────────────────────────────
-- MEDMELO LIBRARY FLASHCARDS (admin-managed, visual images)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE library_flashcard_decks (
  deck_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      UUID         NOT NULL REFERENCES subjects (subject_id),
  name            VARCHAR(300) NOT NULL,
  cover_image_url VARCHAR(500),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order   SMALLINT     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_library_decks_subject ON library_flashcard_decks (subject_id, is_active);

CREATE TABLE library_flashcards (
  card_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id       UUID         NOT NULL REFERENCES library_flashcard_decks (deck_id) ON DELETE CASCADE,
  front         TEXT         NOT NULL,
  back          TEXT         NOT NULL,
  image_url     VARCHAR(500),
  display_order SMALLINT     NOT NULL DEFAULT 0
);

CREATE INDEX idx_library_flashcards_deck ON library_flashcards (deck_id, display_order);
