-- ─────────────────────────────────────────────────────────────
-- 001 · USERS
-- Core user table. user_id is the Cognito sub — not auto-generated.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  user_id              VARCHAR(128)  PRIMARY KEY,
  full_name            VARCHAR(255)  NOT NULL,
  email                VARCHAR(255)  NOT NULL UNIQUE,
  phone                VARCHAR(20),
  college              VARCHAR(255),
  country_of_residence VARCHAR(100),
  country_of_study     VARCHAR(100),
  year_of_study        SMALLINT      CHECK (year_of_study BETWEEN 1 AND 7),
  tier                 VARCHAR(20)   NOT NULL DEFAULT 'FREE'
                                     CHECK (tier IN ('FREE', 'PRO', 'PREMIUM', 'VIP', 'LEGACY')),
  main_course          VARCHAR(10)   CHECK (main_course IN ('MBBS', 'NEET')),
  sub_course           VARCHAR(10)   CHECK (sub_course IN ('FMGE', 'NEXT', 'NEET_UG', 'NEET_PG')),
  is_legacy            BOOLEAN       NOT NULL DEFAULT FALSE,
  profile_completed    BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_tier  ON users (tier);
