-- PG-B-11：/attestation/claim 的 idempotency 結果與處理狀態（SD 4.3）。
-- 相同 (wallet, idempotency_key) 只允許一個處理者；成功回應完整保存（message、signature、nonce）
-- 供重試期限內原樣回傳，不重新簽章；拒絕結果同樣保存。
CREATE TABLE claim_results (
  wallet            TEXT NOT NULL REFERENCES players(wallet),
  idempotency_key   UUID NOT NULL,
  request_hash      BYTEA NOT NULL,
  status            TEXT NOT NULL,                 -- processing / succeeded / rejected
  http_status       SMALLINT,
  response          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, idempotency_key),
  CONSTRAINT claim_results_status_ck CHECK (status IN ('processing', 'succeeded', 'rejected')),
  CONSTRAINT claim_results_request_hash_len_ck CHECK (octet_length(request_hash) = 32),
  -- 完成狀態必須有回應與 http 狀態；processing 不得有
  CONSTRAINT claim_results_done_ck CHECK (
    (status = 'processing' AND response IS NULL AND http_status IS NULL)
    OR (status <> 'processing' AND response IS NOT NULL AND http_status IS NOT NULL)
  )
);
CREATE INDEX claim_results_created_at_idx ON claim_results (created_at);   -- 30 天清理
