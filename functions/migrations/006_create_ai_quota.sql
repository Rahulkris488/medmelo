-- ─────────────────────────────────────────────────────────────
-- 006 · MELO AI
-- AI Quota (per user, daily) and Conversation History
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- AI QUOTA
-- One row per user. Tracks daily usage.
-- last_reset_date resets queries_used_today back to 0 each day.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE ai_quota (
  user_id               VARCHAR(128) PRIMARY KEY REFERENCES users (user_id),
  queries_used_today    INTEGER      NOT NULL DEFAULT 0 CHECK (queries_used_today >= 0),
  last_reset_date       DATE         NOT NULL DEFAULT CURRENT_DATE,
  total_queries_all_time INTEGER     NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- AI CONVERSATIONS
-- Each conversation has a subject, a bot personality, and a message history.
-- messages: [{role: 'user'|'assistant', content, timestamp}]
-- ─────────────────────────────────────────────────────────────

CREATE TABLE ai_conversations (
  conversation_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         VARCHAR(128) NOT NULL REFERENCES users (user_id),
  subject_id      UUID         REFERENCES subjects (subject_id),
  expertise       VARCHAR(30)  NOT NULL
                               CHECK (expertise IN (
                                 'ANATOMY_EXPERT',
                                 'PHARMACOLOGY_GUIDE',
                                 'FINAL_YEAR_MENTOR',
                                 'CLINICAL_CASE_ASSISTANT',
                                 'RAPID_REVISION_BOT',
                                 'NEXT_COACH',
                                 'GENERAL_ASSISTANT'
                               )),
  messages        JSONB        NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_user ON ai_conversations (user_id, created_at DESC);
