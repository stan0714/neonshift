-- PG-E-01：合作組織、角色與活動權限模型（SD 11.1／11.3）。所有活動子表帶 event_id，複合 FK 防跨活動誤綁。
-- 授權一律查本表的有效角色（revoked_at IS NULL），不信任 client input。

CREATE TABLE IF NOT EXISTS partner_organizations (
  org_id        UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at  TIMESTAMPTZ,
  CONSTRAINT partner_organizations_slug_ck CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

-- 組織層角色：owner 管理成員與活動；member 為預設（無操作權限）
CREATE TABLE IF NOT EXISTS partner_memberships (
  org_id        UUID NOT NULL REFERENCES partner_organizations(org_id),
  wallet        TEXT NOT NULL,
  role          TEXT NOT NULL,
  granted_by    TEXT NOT NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  PRIMARY KEY (org_id, wallet),
  CONSTRAINT partner_memberships_role_ck CHECK (role IN ('owner', 'member'))
);
CREATE INDEX IF NOT EXISTS partner_memberships_wallet_idx ON partner_memberships (wallet) WHERE revoked_at IS NULL;

-- 活動（主辦組織一個；協辦／贊助另存 event_partners）
CREATE TABLE IF NOT EXISTS events (
  event_id             UUID PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES partner_organizations(org_id),
  slug                 TEXT NOT NULL UNIQUE,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  state                TEXT NOT NULL DEFAULT 'draft',
  timezone             TEXT NOT NULL DEFAULT 'UTC',
  registration_opens_at TIMESTAMPTZ,
  registration_closes_at TIMESTAMPTZ,
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  capacity             INTEGER NOT NULL DEFAULT 0,
  registration_count   INTEGER NOT NULL DEFAULT 0,
  current_rule_revision UUID,
  tournament_address   TEXT,
  revision             INTEGER NOT NULL DEFAULT 1,   -- 樂觀鎖
  cancel_reason        TEXT,
  created_by           TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  CONSTRAINT events_state_ck CHECK (state IN ('draft', 'published', 'cancelled', 'completed')),
  CONSTRAINT events_capacity_ck CHECK (capacity >= 0 AND registration_count >= 0 AND (capacity = 0 OR registration_count <= capacity)),
  CONSTRAINT events_window_ck CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CONSTRAINT events_slug_ck CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  UNIQUE (event_id, org_id)
);
CREATE INDEX IF NOT EXISTS events_public_idx ON events (state, starts_at) WHERE state = 'published';

CREATE TABLE IF NOT EXISTS event_partners (
  event_id      UUID NOT NULL REFERENCES events(event_id),
  org_id        UUID NOT NULL REFERENCES partner_organizations(org_id),
  role          TEXT NOT NULL,
  PRIMARY KEY (event_id, org_id),
  CONSTRAINT event_partners_role_ck CHECK (role IN ('co_host', 'sponsor'))
);

-- 規則版本快照：發布後不可覆寫（只可新增版本）
CREATE TABLE IF NOT EXISTS event_rule_revisions (
  revision_id   UUID PRIMARY KEY,
  event_id      UUID NOT NULL REFERENCES events(event_id),
  version       INTEGER NOT NULL,
  rules         JSONB NOT NULL,
  rules_hash    BYTEA NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,
  UNIQUE (event_id, version),
  CONSTRAINT event_rule_revisions_hash_len_ck CHECK (octet_length(rules_hash) = 32)
);
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_current_rule_fk;
ALTER TABLE events ADD CONSTRAINT events_current_rule_fk FOREIGN KEY (current_rule_revision) REFERENCES event_rule_revisions(revision_id);

-- 活動層角色：staff（限 checkpoint，NULL = 全部）、result_editor、publisher；owner 由 partner_memberships 推導
CREATE TABLE IF NOT EXISTS event_roles (
  event_id      UUID NOT NULL REFERENCES events(event_id),
  wallet        TEXT NOT NULL,
  role          TEXT NOT NULL,
  checkpoint_id UUID,
  granted_by    TEXT NOT NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  PRIMARY KEY (event_id, wallet, role),
  CONSTRAINT event_roles_role_ck CHECK (role IN ('staff', 'result_editor', 'publisher'))
);
CREATE INDEX IF NOT EXISTS event_roles_wallet_idx ON event_roles (wallet) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS event_participants (
  event_id               UUID NOT NULL REFERENCES events(event_id),
  wallet                 TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'registered',
  accepted_rule_revision UUID NOT NULL REFERENCES event_rule_revisions(revision_id),
  display_name           TEXT,
  public_consent_at      TIMESTAMPTZ,
  registered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at           TIMESTAMPTZ,
  retention_due_at       TIMESTAMPTZ,
  PRIMARY KEY (event_id, wallet),
  CONSTRAINT event_participants_status_ck CHECK (status IN ('registered', 'cancelled', 'checked_in')),
  CONSTRAINT event_participants_name_ck CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id UUID PRIMARY KEY,
  event_id      UUID NOT NULL REFERENCES events(event_id),
  name          TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  UNIQUE (event_id, checkpoint_id),
  CONSTRAINT checkpoints_purpose_ck CHECK (purpose IN ('check_in', 'redemption', 'info'))
);

-- NFC 載具：只存 opaque reference；不存 JWT／私鑰／健康資料
CREATE TABLE IF NOT EXISTS nfc_tags (
  tag_id        UUID PRIMARY KEY,
  event_id      UUID NOT NULL REFERENCES events(event_id),
  checkpoint_id UUID,
  opaque_ref    TEXT NOT NULL UNIQUE,
  purpose       TEXT NOT NULL,
  participant_wallet TEXT,
  issued_by     TEXT NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  FOREIGN KEY (event_id, checkpoint_id) REFERENCES checkpoints(event_id, checkpoint_id),
  CONSTRAINT nfc_tags_purpose_ck CHECK (purpose IN ('checkpoint', 'participant'))
);

CREATE TABLE IF NOT EXISTS checkin_challenges (
  challenge_hash  BYTEA PRIMARY KEY,
  event_id        UUID NOT NULL REFERENCES events(event_id),
  wallet          TEXT NOT NULL,
  checkpoint_id   UUID NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  FOREIGN KEY (event_id, wallet) REFERENCES event_participants(event_id, wallet),
  FOREIGN KEY (event_id, checkpoint_id) REFERENCES checkpoints(event_id, checkpoint_id),
  CONSTRAINT checkin_challenges_hash_len_ck CHECK (octet_length(challenge_hash) = 32)
);

CREATE TABLE IF NOT EXISTS event_checkins (
  event_id      UUID NOT NULL,
  wallet        TEXT NOT NULL,
  checkpoint_id UUID NOT NULL,
  confirmed_by  TEXT NOT NULL,
  confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  method        TEXT NOT NULL DEFAULT 'nfc',
  PRIMARY KEY (event_id, wallet, checkpoint_id),
  FOREIGN KEY (event_id, wallet) REFERENCES event_participants(event_id, wallet),
  FOREIGN KEY (event_id, checkpoint_id) REFERENCES checkpoints(event_id, checkpoint_id),
  CONSTRAINT event_checkins_method_ck CHECK (method IN ('nfc', 'qr', 'manual'))
);

CREATE TABLE IF NOT EXISTS event_benefits (
  benefit_id               UUID PRIMARY KEY,
  event_id                 UUID NOT NULL REFERENCES events(event_id),
  kind                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  stock_total              INTEGER NOT NULL,
  reserved_count           INTEGER NOT NULL DEFAULT 0,
  fulfilled_count          INTEGER NOT NULL DEFAULT 0,
  per_person_limit         INTEGER NOT NULL DEFAULT 1,
  eligibility_rule_revision UUID REFERENCES event_rule_revisions(revision_id),
  requires_checkin         BOOLEAN NOT NULL DEFAULT true,
  claim_deadline           TIMESTAMPTZ,
  UNIQUE (event_id, benefit_id),
  CONSTRAINT event_benefits_kind_ck CHECK (kind IN ('physical', 'digital_badge')),
  CONSTRAINT event_benefits_stock_ck CHECK (stock_total >= 0 AND reserved_count >= 0 AND fulfilled_count >= 0 AND reserved_count + fulfilled_count <= stock_total),
  CONSTRAINT event_benefits_limit_ck CHECK (per_person_limit BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS event_redemptions (
  redemption_id   UUID PRIMARY KEY,
  event_id        UUID NOT NULL,
  wallet          TEXT NOT NULL,
  benefit_id      UUID NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'reserved',
  reserved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reserved_until  TIMESTAMPTZ NOT NULL,
  fulfilled_by    TEXT,
  fulfilled_at    TIMESTAMPTZ,
  idempotency_key UUID NOT NULL,
  FOREIGN KEY (event_id, wallet) REFERENCES event_participants(event_id, wallet),
  FOREIGN KEY (event_id, benefit_id) REFERENCES event_benefits(event_id, benefit_id),
  UNIQUE (event_id, wallet, idempotency_key),
  CONSTRAINT event_redemptions_status_ck CHECK (status IN ('reserved', 'fulfilled', 'expired', 'cancelled')),
  CONSTRAINT event_redemptions_qty_ck CHECK (quantity BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS event_redemptions_expiry_idx ON event_redemptions (reserved_until) WHERE status = 'reserved';

-- 數位徽章：鏈下憑證（不是 NFT）
CREATE TABLE IF NOT EXISTS event_badge_issues (
  redemption_id  UUID PRIMARY KEY REFERENCES event_redemptions(redemption_id),
  credential_id  TEXT NOT NULL UNIQUE,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS result_imports (
  import_id      UUID PRIMARY KEY,
  event_id       UUID NOT NULL REFERENCES events(event_id),
  source_kind    TEXT NOT NULL,
  file_hash      BYTEA NOT NULL,
  import_version INTEGER NOT NULL,
  row_count      INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  staged_rows    JSONB NOT NULL DEFAULT '[]',
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  published_by   TEXT,
  UNIQUE (event_id, import_version),
  CONSTRAINT result_imports_source_ck CHECK (source_kind IN ('csv', 'manual')),
  CONSTRAINT result_imports_hash_len_ck CHECK (octet_length(file_hash) = 32)
);

CREATE TABLE IF NOT EXISTS result_revisions (
  revision_id          UUID PRIMARY KEY,
  event_id             UUID NOT NULL,
  import_id            UUID NOT NULL REFERENCES result_imports(import_id),
  wallet               TEXT NOT NULL,
  discipline           TEXT NOT NULL DEFAULT 'run',
  division             TEXT,
  distance_m           INTEGER NOT NULL,
  elapsed_ms           BIGINT NOT NULL,
  rank                 INTEGER,
  finish_status        TEXT NOT NULL,
  previous_revision_id UUID REFERENCES result_revisions(revision_id),
  reason               TEXT,
  published_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, wallet) REFERENCES event_participants(event_id, wallet),
  UNIQUE (import_id, wallet, discipline),
  CONSTRAINT result_revisions_bounds_ck CHECK (distance_m BETWEEN 0 AND 1000000 AND elapsed_ms BETWEEN 0 AND 604800000 AND (rank IS NULL OR rank > 0)),
  CONSTRAINT result_revisions_status_ck CHECK (finish_status IN ('finished', 'dnf', 'dns', 'dq'))
);
CREATE INDEX IF NOT EXISTS result_revisions_event_idx ON result_revisions (event_id, discipline, rank);

CREATE TABLE IF NOT EXISTS event_audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  event_id      UUID,
  org_id        UUID,
  actor_wallet  TEXT NOT NULL,
  action        TEXT NOT NULL,
  target        TEXT,
  revision_id   UUID,
  request_id    TEXT,
  details       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_audit_logs_event_idx ON event_audit_logs (event_id, created_at DESC);

-- 去識別彙總：來源與轉換計數，不存核銷 token 或健康資料
CREATE TABLE IF NOT EXISTS campaign_aggregates (
  event_id      UUID NOT NULL REFERENCES events(event_id),
  source        TEXT NOT NULL,
  day           DATE NOT NULL,
  views         INTEGER NOT NULL DEFAULT 0,
  registrations INTEGER NOT NULL DEFAULT 0,
  checkins      INTEGER NOT NULL DEFAULT 0,
  redemptions   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, source, day)
);
