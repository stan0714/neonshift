-- PG-R-08：PB 成就 NFT（activity-running-gallery 7、SD 13／15）。
-- achievement_id = sha256("neonshift-achievement|" || wallet || "|" || pb_id)，伺服器穩定分配；每個 pb_id 一筆、重試沿用。
-- 狀態：pending_registry（待 admin 寫入鏈上 registry）→ approved（可簽發證明）→ minted；revoke_pending → revoked（來源修正／刪除）。
CREATE TABLE IF NOT EXISTS achievements (
  achievement_id      TEXT PRIMARY KEY,
  wallet              TEXT NOT NULL,
  pb_id               UUID NOT NULL UNIQUE REFERENCES pb_revisions(pb_id),
  category            TEXT NOT NULL,
  verification_class  TEXT NOT NULL,
  source_revision     INTEGER NOT NULL,
  rules_major         INTEGER NOT NULL,
  public_consent      BOOLEAN NOT NULL DEFAULT false,
  metadata            JSONB NOT NULL,
  metadata_hash       BYTEA NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending_registry',
  registry_signature  TEXT,
  registry_updated_at TIMESTAMPTZ,
  asset               TEXT,
  minted_signature    TEXT,
  minted_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT achievements_id_ck CHECK (achievement_id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT achievements_status_ck CHECK (status IN ('pending_registry', 'approved', 'minted', 'revoke_pending', 'revoked')),
  CONSTRAINT achievements_hash_len_ck CHECK (octet_length(metadata_hash) = 32)
);
CREATE INDEX IF NOT EXISTS achievements_wallet_idx ON achievements (wallet, status);
CREATE INDEX IF NOT EXISTS achievements_status_idx ON achievements (status);
