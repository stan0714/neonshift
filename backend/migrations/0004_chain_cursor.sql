-- PG-B-16 ChainIndexer 游標：每個索引來源一列（目前只有 neonshift_core）
CREATE TABLE IF NOT EXISTS chain_cursor (
  name        TEXT PRIMARY KEY,
  signature   TEXT NOT NULL,
  slot        BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chain_events_pending_idx ON chain_events (slot) WHERE commitment = 'confirmed' AND orphaned_at IS NULL;
CREATE INDEX IF NOT EXISTS chain_events_name_wallet_idx ON chain_events (event_name, (payload->>'wallet'));
