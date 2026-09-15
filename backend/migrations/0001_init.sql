-- NeonShift Attestor 後端初始 schema
-- 對應 SD v0.2 第 4.5 節。
--
-- 設計要點：
--   1. 健康數值只存在 health_snapshots，30 天後刪除（BR-25）。
--   2. attestations 只留 nonce 與不可逆雜湊，不含健康數值，可長期保存供稽核。
--   3. chain_events 以 (signature, event_index) 冪等寫入，並區分 confirmed 與
--      finalized；分叉時標記 orphaned_at 而非刪除。

BEGIN;

-- 玩家。以錢包公鑰為假名識別，不存任何真實身分資料。
CREATE TABLE players (
  wallet            TEXT PRIMARY KEY,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

-- 單次挑戰。login 用於 SIWS 登入，claim 用於打卡授權。
-- nonce 只存雜湊，外洩資料庫也無法反推原值。
CREATE TABLE auth_challenges (
  nonce_hash        BYTEA PRIMARY KEY,
  wallet            TEXT NOT NULL,
  purpose           TEXT NOT NULL,
  request_hash      BYTEA,
  task_date         INTEGER,
  task_type         SMALLINT,
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  CONSTRAINT auth_challenges_purpose_ck
    CHECK (purpose IN ('login', 'claim', 'tournament_steps')),
  -- claim 必須綁定 request_hash 與任務，否則 challenge 可被挪用到別的請求。
  CONSTRAINT auth_challenges_claim_binding_ck
    CHECK (purpose <> 'claim'
           OR (request_hash IS NOT NULL AND task_date IS NOT NULL AND task_type IS NOT NULL)),
  CONSTRAINT auth_challenges_request_hash_len_ck
    CHECK (request_hash IS NULL OR octet_length(request_hash) = 32)
);
CREATE INDEX auth_challenges_expires_at_idx ON auth_challenges (expires_at);

-- Refresh session。每次使用都輪替並記錄 rotated_to，
-- 舊 token 再次出現即視為重用，撤銷整個 family。
CREATE TABLE auth_sessions (
  jti               UUID PRIMARY KEY,
  family_id         UUID NOT NULL,
  wallet            TEXT NOT NULL REFERENCES players(wallet),
  refresh_hash      BYTEA NOT NULL UNIQUE,
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  rotated_to        UUID,
  revoked_at        TIMESTAMPTZ
);
CREATE INDEX auth_sessions_family_id_idx ON auth_sessions (family_id);
CREATE INDEX auth_sessions_wallet_idx ON auth_sessions (wallet);

-- 風險規則集。rules_hash 是整份設定的雜湊，
-- 判定結果引用 rules_version 即可還原當時用的規則。
CREATE TABLE rule_sets (
  rules_version     INTEGER PRIMARY KEY CHECK (rules_version BETWEEN 0 AND 65535),
  rules_hash        BYTEA NOT NULL UNIQUE,
  config            JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rule_sets_hash_len_ck CHECK (octet_length(rules_hash) = 32)
);

-- 健康摘要。這是唯一存放健康數值的表，受 30 天保留政策約束。
CREATE TABLE health_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  wallet                TEXT NOT NULL REFERENCES players(wallet),
  task_date             INTEGER NOT NULL,
  task_type             SMALLINT NOT NULL,
  attributed_steps      INTEGER,
  sleep_minutes         INTEGER,
  source_summary        JSONB NOT NULL,
  step_rate_summary     JSONB,
  sleep_overlap_minutes INTEGER,
  sensor_summary        JSONB,
  motion_summary        JSONB,
  client_info           JSONB NOT NULL,
  input_hash            BYTEA NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT health_snapshots_task_type_ck CHECK (task_type IN (1, 2)),
  CONSTRAINT health_snapshots_input_hash_len_ck CHECK (octet_length(input_hash) = 32)
);
CREATE INDEX health_snapshots_lookup_idx ON health_snapshots (wallet, task_date, task_type);
CREATE INDEX health_snapshots_created_at_idx ON health_snapshots (created_at);

-- 風險判定紀錄。snapshot 刪除時連帶刪除，確保保留政策一致。
CREATE TABLE risk_decisions (
  id                BIGSERIAL PRIMARY KEY,
  snapshot_id       BIGINT NOT NULL REFERENCES health_snapshots(id) ON DELETE CASCADE,
  rules_version     INTEGER NOT NULL CHECK (rules_version BETWEEN 0 AND 65535),
  risk_score        SMALLINT NOT NULL,
  matched_rules     TEXT[] NOT NULL,
  decision          TEXT NOT NULL,
  reject_code       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT risk_decisions_decision_ck CHECK (decision IN ('pass', 'reject')),
  -- 拒絕必須有代碼，通過必須沒有，避免出現無法解釋的判定。
  CONSTRAINT risk_decisions_reject_code_ck
    CHECK ((decision = 'reject') = (reject_code IS NOT NULL))
);
CREATE INDEX risk_decisions_snapshot_idx ON risk_decisions (snapshot_id);

-- 已簽發的 attestation。不含健康數值，可長期保存。
CREATE TABLE attestations (
  nonce             BYTEA PRIMARY KEY,
  idempotency_key   UUID NOT NULL,
  request_hash      BYTEA NOT NULL,
  wallet            TEXT NOT NULL,
  task_date         INTEGER NOT NULL,
  task_type         SMALLINT NOT NULL,
  rules_version     INTEGER NOT NULL CHECK (rules_version BETWEEN 0 AND 65535),
  evidence_hash     BYTEA NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  redeemed_sig      TEXT,
  CONSTRAINT attestations_idem_uq UNIQUE (wallet, idempotency_key),
  CONSTRAINT attestations_task_type_ck CHECK (task_type IN (1, 2)),
  CONSTRAINT attestations_nonce_len_ck CHECK (octet_length(nonce) = 16),
  CONSTRAINT attestations_evidence_hash_len_ck CHECK (octet_length(evidence_hash) = 32),
  CONSTRAINT attestations_request_hash_len_ck CHECK (octet_length(request_hash) = 32),
  -- 有效期不得超過 600 秒（BR-15、錯誤碼 6008）。
  CONSTRAINT attestations_ttl_ck CHECK (expires_at <= issued_at + INTERVAL '600 seconds'),
  CONSTRAINT attestations_window_ck CHECK (expires_at > issued_at)
);
CREATE INDEX attestations_wallet_task_idx ON attestations (wallet, task_date, task_type);
CREATE INDEX attestations_expires_at_idx ON attestations (expires_at);

-- 賽事期間的已驗證步數。first_reached_at 供 BR-20 同分決勝使用。
CREATE TABLE tournament_steps (
  week_id           INTEGER NOT NULL,
  wallet            TEXT NOT NULL,
  verified_steps    BIGINT NOT NULL DEFAULT 0,
  first_reached_at  TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (week_id, wallet),
  CONSTRAINT tournament_steps_non_negative_ck CHECK (verified_steps >= 0)
);
CREATE INDEX tournament_steps_rank_idx
  ON tournament_steps (week_id, verified_steps DESC, first_reached_at ASC);

-- 鏈上事件。以 (signature, event_index) 冪等寫入。
-- 分叉時標記 orphaned_at，不刪除原 row。
CREATE TABLE chain_events (
  signature         TEXT NOT NULL,
  event_index       INTEGER NOT NULL,
  slot              BIGINT NOT NULL,
  blockhash         TEXT NOT NULL,
  commitment        TEXT NOT NULL,
  orphaned_at       TIMESTAMPTZ,
  event_name        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (signature, event_index),
  CONSTRAINT chain_events_commitment_ck CHECK (commitment IN ('confirmed', 'finalized'))
);
CREATE INDEX chain_events_name_slot_idx ON chain_events (event_name, slot);
-- 排行榜與結算只讀已 finalized 且未 orphaned 的事件。
CREATE INDEX chain_events_settled_idx ON chain_events (slot)
  WHERE commitment = 'finalized' AND orphaned_at IS NULL;

COMMIT;
