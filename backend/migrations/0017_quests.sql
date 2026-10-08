-- PG-U-04：個人週任務與探索冊（sport-experience-gameplay 5；SD 17）。
-- 模板版本化；接受時快照模板版本、目標、時區與起訖 UTC；每玩家每模板每週期最多一份獎勵（(wallet, template_id, period_start) 唯一）。
-- 貢獻以來源穩定 ID 去重（同來源修正／重送不重算）；receipt 與外觀權限同交易發放；來源刪除／修正 → 重算並撤銷（保留最小 receipt）。
-- 獎勵為帳號綁定外觀：無代幣、無維持點、無能力加成；不寫鏈上。
CREATE TABLE IF NOT EXISTS quest_templates (
  template_id   TEXT NOT NULL,
  version       INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  params        JSONB NOT NULL DEFAULT '{}',
  cosmetic_id   TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, version),
  CONSTRAINT quest_templates_kind_ck CHECK (kind IN ('active_days', 'goal_time'))
);
CREATE TABLE IF NOT EXISTS quest_enrollments (
  enrollment_id    UUID PRIMARY KEY,
  wallet           TEXT NOT NULL,
  template_id      TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  goal             JSONB NOT NULL DEFAULT '{}',
  timezone         TEXT NOT NULL,
  period_start     TIMESTAMPTZ NOT NULL,
  period_end       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  idempotency_key  TEXT NOT NULL,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wallet, idempotency_key),
  UNIQUE (wallet, template_id, period_start),
  CONSTRAINT quest_enrollments_status_ck CHECK (status IN ('active', 'completed', 'claimed', 'expired', 'revoked')),
  FOREIGN KEY (template_id, template_version) REFERENCES quest_templates(template_id, version)
);
CREATE INDEX IF NOT EXISTS quest_enrollments_wallet_idx ON quest_enrollments (wallet, period_end DESC);
CREATE TABLE IF NOT EXISTS quest_contributions (
  enrollment_id   UUID NOT NULL REFERENCES quest_enrollments(enrollment_id) ON DELETE CASCADE,
  source_kind     TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  local_day       TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, source_kind, source_id)
);
CREATE TABLE IF NOT EXISTS quest_receipts (
  receipt_id     UUID PRIMARY KEY,
  wallet         TEXT NOT NULL,
  enrollment_id  UUID NOT NULL UNIQUE REFERENCES quest_enrollments(enrollment_id),
  cosmetic_id    TEXT NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  revoke_reason  TEXT
);
CREATE TABLE IF NOT EXISTS cosmetic_entitlements (
  wallet       TEXT NOT NULL,
  cosmetic_id  TEXT NOT NULL,
  receipt_id   UUID NOT NULL REFERENCES quest_receipts(receipt_id),
  status       TEXT NOT NULL DEFAULT 'active',
  granted_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, receipt_id),
  CONSTRAINT cosmetic_entitlements_status_ck CHECK (status IN ('active', 'revoked'))
);
CREATE INDEX IF NOT EXISTS cosmetic_entitlements_wallet_idx ON cosmetic_entitlements (wallet, status);
-- 首版模板（sport-experience-gameplay 5）：本週三個不同日各一次有效活動；一次預先選定的時間目標（10／20／30 分）
INSERT INTO quest_templates (template_id, version, kind, params, cosmetic_id) VALUES
  ('three_days', 1, 'active_days', '{"days": 3}', 'chapter_01_three_days'),
  ('timed_goal', 1, 'goal_time', '{"minutes": [10, 20, 30]}', 'chapter_01_timed_goal')
ON CONFLICT DO NOTHING;
