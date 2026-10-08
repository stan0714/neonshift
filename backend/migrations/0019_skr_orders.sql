-- SKR-02～06（docs/store/competition-development-plan.md §5）：官方 SKR 外觀付款訂單、付款 receipt 與外觀權限。
-- 訂單不可變欄位：network／wallet／SKU 版本／mint／最小單位金額／recipient／reference／期限／資格引用／來源環境；狀態與付款欄位另存。
-- receipt 以 signature 為主鍵：同一筆鏈上付款不得兌換第二張訂單。權限與 quest 的 cosmetic_entitlements 分表，因為來源是付款而非 receipt_id。
CREATE TABLE IF NOT EXISTS skr_orders (
  order_id                UUID PRIMARY KEY,
  wallet                  TEXT NOT NULL,
  sku                     TEXT NOT NULL,
  sku_version             INTEGER NOT NULL,
  cosmetic_id             TEXT NOT NULL,
  network                 TEXT NOT NULL,
  mint                    TEXT NOT NULL,
  decimals                INTEGER NOT NULL,
  amount                  BIGINT NOT NULL,
  recipient               TEXT NOT NULL,
  recipient_token_account TEXT NOT NULL,
  reference               TEXT NOT NULL UNIQUE,
  eligibility_ref         TEXT NOT NULL,
  source_env              TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'awaiting_payment',
  signature               TEXT,
  paid_amount             BIGINT,
  paid_slot               BIGINT,
  paid_at                 TIMESTAMPTZ,
  failure_reason          TEXT,
  expires_at              TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL,
  CONSTRAINT skr_orders_status_ck CHECK (status IN ('awaiting_payment', 'confirming', 'fulfilled', 'expired', 'needs_review', 'cancelled')),
  CONSTRAINT skr_orders_network_ck CHECK (network IN ('mainnet-beta', 'devnet'))
);
CREATE INDEX IF NOT EXISTS skr_orders_wallet_idx ON skr_orders (wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS skr_orders_open_idx ON skr_orders (wallet, sku, sku_version) WHERE status IN ('awaiting_payment', 'confirming', 'needs_review');

CREATE TABLE IF NOT EXISTS skr_receipts (
  signature   TEXT PRIMARY KEY,
  order_id    UUID NOT NULL UNIQUE REFERENCES skr_orders(order_id),
  wallet      TEXT NOT NULL,
  amount      BIGINT NOT NULL,
  slot        BIGINT NOT NULL,
  block_time  TIMESTAMPTZ,
  verified_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS skr_entitlements (
  wallet      TEXT NOT NULL,
  cosmetic_id TEXT NOT NULL,
  order_id    UUID NOT NULL REFERENCES skr_orders(order_id),
  status      TEXT NOT NULL DEFAULT 'active',
  granted_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, cosmetic_id),
  CONSTRAINT skr_entitlements_status_ck CHECK (status IN ('active', 'revoked'))
);
