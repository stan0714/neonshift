-- PG-R-07：個人最佳（PB）版本（activity-running-gallery 5、BR-38／40）。
-- key = wallet＋discipline＋category＋environment＋verification_class＋timing_basis＋rules_major；各組不互相覆寫。
-- 每個 key 內以 achieved_at 順序：首筆 Baseline，之後嚴格改善才新增；來源修正／刪除 → invalidated（保留列，供已鑄造成就標記）。
CREATE TABLE IF NOT EXISTS pb_revisions (
  pb_id              UUID PRIMARY KEY,
  wallet             TEXT NOT NULL,
  discipline         TEXT NOT NULL DEFAULT 'run',
  category           TEXT NOT NULL,
  environment        TEXT NOT NULL,
  verification_class TEXT NOT NULL,
  timing_basis       TEXT NOT NULL,
  rules_major        INTEGER NOT NULL,
  value              BIGINT NOT NULL,
  source_kind        TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  source_revision    INTEGER NOT NULL,
  achieved_at        TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL,
  is_baseline        BOOLEAN NOT NULL DEFAULT false,
  previous_pb_id     UUID REFERENCES pb_revisions(pb_id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalidated_at     TIMESTAMPTZ,
  reason             TEXT,
  UNIQUE (wallet, discipline, category, environment, verification_class, timing_basis, rules_major, source_kind, source_id),
  CONSTRAINT pb_category_ck CHECK (category IN ('fastest_1k', 'fastest_5k', 'fastest_10k', 'fastest_half', 'fastest_marathon', 'longest_run')),
  CONSTRAINT pb_env_ck CHECK (environment IN ('outdoor', 'indoor', 'unknown')),
  CONSTRAINT pb_class_ck CHECK (verification_class IN ('organizer', 'device')),
  CONSTRAINT pb_timing_ck CHECK (timing_basis IN ('chip', 'gun', 'elapsed')),
  CONSTRAINT pb_source_ck CHECK (source_kind IN ('workout', 'result')),
  CONSTRAINT pb_status_ck CHECK (status IN ('current', 'historical', 'invalidated')),
  CONSTRAINT pb_value_ck CHECK (value > 0)
);
CREATE INDEX IF NOT EXISTS pb_revisions_wallet_idx ON pb_revisions (wallet, category, status);
