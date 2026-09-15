-- PG-B-13：刪除請求（BR-25、UC-12）。
-- deleted_at：已刪除（或已排定）；deletion_due_at：因進行中且已質押賽事延後時的實際期限（不得超過 30 天）。
ALTER TABLE players
  ADD COLUMN deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN deletion_due_at       TIMESTAMPTZ;
-- attestations／claim_results 可關聯健康輸入，刪除時一併清除；attestations 無 FK，補索引供刪除與 30 天清理
CREATE INDEX attestations_wallet_idx ON attestations (wallet);
CREATE INDEX attestations_issued_at_idx ON attestations (issued_at);
