-- ─────────────────────────────────────────────────────────────
-- 005 · SUBSCRIPTIONS & MONETISATION
-- Subscriptions, Promo Codes, Donations
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE subscriptions (
  subscription_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                VARCHAR(128)  NOT NULL REFERENCES users (user_id),
  tier                   VARCHAR(20)   NOT NULL CHECK (tier IN ('PRO', 'VIP', 'PREMIUM', 'LEGACY')),
  platform               VARCHAR(10)   NOT NULL CHECK (platform IN ('IOS', 'ANDROID', 'WEB')),
  platform_transaction_id VARCHAR(500) UNIQUE,
  promo_code             VARCHAR(50),
  start_date             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  end_date               TIMESTAMPTZ,
  is_active              BOOLEAN       NOT NULL DEFAULT TRUE,
  -- Premium users get 3 free e-books on upgrade
  free_ebook_credits     SMALLINT      NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user   ON subscriptions (user_id, is_active);
CREATE INDEX idx_subscriptions_active ON subscriptions (is_active, end_date);

-- ─────────────────────────────────────────────────────────────
-- PROMO CODES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE promo_codes (
  code             VARCHAR(50)  PRIMARY KEY,
  discount_percent SMALLINT     NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  max_uses         INTEGER,
  uses_count       INTEGER      NOT NULL DEFAULT 0,
  valid_from       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  valid_until      TIMESTAMPTZ,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- DONATIONS (Medmelo Hope)
-- Min ₹1, user_id nullable (anonymous donations allowed)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE donations (
  donation_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR(128)  REFERENCES users (user_id),
  amount_inr  NUMERIC(10,2) NOT NULL CHECK (amount_inr >= 1),
  payment_id  VARCHAR(500),
  donated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_donations_user ON donations (user_id);
