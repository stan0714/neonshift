-- Schema 約束測試。每個 CHECK 都要能擋下對應的壞資料。
-- 用法：psql -v ON_ERROR_STOP=1 -f test_constraints.sql
--
-- 做法：用 DO 區塊執行應失敗的寫入，若沒有拋錯就主動 RAISE EXCEPTION。

\set QUIET on
SET client_min_messages TO NOTICE;

CREATE OR REPLACE FUNCTION must_fail(stmt TEXT, label TEXT) RETURNS VOID AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS  %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % — 應該被拒絕但寫入成功', label;
END;
$$ LANGUAGE plpgsql;

BEGIN;

INSERT INTO players (wallet) VALUES ('WalletA');

INSERT INTO health_snapshots (wallet, task_date, task_type, source_summary, client_info, input_hash)
VALUES ('WalletA', 20706, 1, '{}'::jsonb, '{}'::jsonb, decode(repeat('11',32),'hex'));

-- attestations：TTL 不得超過 600 秒（BR-15 / 錯誤碼 6008）
SELECT must_fail($$
  INSERT INTO attestations (nonce, idempotency_key, request_hash, wallet, task_date, task_type,
                            rules_version, evidence_hash, issued_at, expires_at)
  VALUES (decode(repeat('44',16),'hex'), gen_random_uuid(), decode(repeat('55',32),'hex'),
          'WalletA', 20706, 1, 3, decode(repeat('33',32),'hex'),
          '2026-09-09T00:00:00Z', '2026-09-09T00:10:01Z')
$$, 'attestations TTL 超過 600 秒');

-- attestations：expiry 必須晚於 issued_at
SELECT must_fail($$
  INSERT INTO attestations (nonce, idempotency_key, request_hash, wallet, task_date, task_type,
                            rules_version, evidence_hash, issued_at, expires_at)
  VALUES (decode(repeat('45',16),'hex'), gen_random_uuid(), decode(repeat('55',32),'hex'),
          'WalletA', 20706, 1, 3, decode(repeat('33',32),'hex'),
          '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z')
$$, 'attestations expiry 未晚於 issued_at');

-- attestations：nonce 必須是 16 bytes
SELECT must_fail($$
  INSERT INTO attestations (nonce, idempotency_key, request_hash, wallet, task_date, task_type,
                            rules_version, evidence_hash, issued_at, expires_at)
  VALUES (decode(repeat('44',15),'hex'), gen_random_uuid(), decode(repeat('55',32),'hex'),
          'WalletA', 20706, 1, 3, decode(repeat('33',32),'hex'),
          '2026-09-09T00:00:00Z', '2026-09-09T00:05:00Z')
$$, 'attestations nonce 長度不是 16');

-- attestations：task_type 只能是 1 或 2
SELECT must_fail($$
  INSERT INTO attestations (nonce, idempotency_key, request_hash, wallet, task_date, task_type,
                            rules_version, evidence_hash, issued_at, expires_at)
  VALUES (decode(repeat('46',16),'hex'), gen_random_uuid(), decode(repeat('55',32),'hex'),
          'WalletA', 20706, 3, 3, decode(repeat('33',32),'hex'),
          '2026-09-09T00:00:00Z', '2026-09-09T00:05:00Z')
$$, 'attestations task_type 為 3');

-- risk_decisions：reject 必須帶 reject_code
SELECT must_fail($$
  INSERT INTO risk_decisions (snapshot_id, rules_version, risk_score, matched_rules, decision)
  SELECT id, 3, 80, ARRAY['freq_variance_low'], 'reject' FROM health_snapshots LIMIT 1
$$, 'risk_decisions reject 缺少 reject_code');

-- risk_decisions：pass 不得帶 reject_code
SELECT must_fail($$
  INSERT INTO risk_decisions (snapshot_id, rules_version, risk_score, matched_rules, decision, reject_code)
  SELECT id, 3, 10, ARRAY[]::text[], 'pass', 'RISK_SCORE' FROM health_snapshots LIMIT 1
$$, 'risk_decisions pass 帶了 reject_code');

-- auth_challenges：claim 必須綁定 request_hash 與任務
SELECT must_fail($$
  INSERT INTO auth_challenges (nonce_hash, wallet, purpose, expires_at)
  VALUES (decode(repeat('66',32),'hex'), 'WalletA', 'claim', now() + interval '5 minutes')
$$, 'auth_challenges claim 未綁定 request_hash');

-- auth_challenges：purpose 必須是允許值
SELECT must_fail($$
  INSERT INTO auth_challenges (nonce_hash, wallet, purpose, expires_at)
  VALUES (decode(repeat('67',32),'hex'), 'WalletA', 'anything', now() + interval '5 minutes')
$$, 'auth_challenges purpose 不在允許清單');

-- tournament_steps：步數不得為負
SELECT must_fail($$
  INSERT INTO tournament_steps (week_id, wallet, verified_steps)
  VALUES (37, 'WalletA', -1)
$$, 'tournament_steps 步數為負');

-- chain_events：commitment 只能是 confirmed 或 finalized
SELECT must_fail($$
  INSERT INTO chain_events (signature, event_index, slot, blockhash, commitment, event_name, payload)
  VALUES ('sig1', 0, 100, 'bh1', 'processed', 'ClockedIn', '{}'::jsonb)
$$, 'chain_events commitment 為 processed');

-- rule_sets：hash 必須是 32 bytes
SELECT must_fail($$
  INSERT INTO rule_sets (rules_version, rules_hash, config)
  VALUES (3, decode(repeat('77',31),'hex'), '{}'::jsonb)
$$, 'rule_sets hash 長度不是 32');

-- --- 以下為應該成功的正常寫入 ---

INSERT INTO attestations (nonce, idempotency_key, request_hash, wallet, task_date, task_type,
                          rules_version, evidence_hash, issued_at, expires_at)
VALUES (decode(repeat('44',16),'hex'), gen_random_uuid(), decode(repeat('55',32),'hex'),
        'WalletA', 20706, 1, 3, decode(repeat('33',32),'hex'),
        '2026-09-09T00:00:00Z', '2026-09-09T00:10:00Z');

INSERT INTO risk_decisions (snapshot_id, rules_version, risk_score, matched_rules, decision)
SELECT id, 3, 10, ARRAY[]::text[], 'pass' FROM health_snapshots LIMIT 1;

INSERT INTO chain_events (signature, event_index, slot, blockhash, commitment, event_name, payload)
VALUES ('sig1', 0, 100, 'bh1', 'finalized', 'ClockedIn', '{"amount":10}'::jsonb);

-- 冪等：同一 (signature, event_index) 重複寫入應被主鍵擋下
SELECT must_fail($$
  INSERT INTO chain_events (signature, event_index, slot, blockhash, commitment, event_name, payload)
  VALUES ('sig1', 0, 100, 'bh1', 'finalized', 'ClockedIn', '{}'::jsonb)
$$, 'chain_events 重複 (signature, event_index)');

-- 級聯刪除：刪除 snapshot 應連帶刪除 risk_decisions（BR-25 保留政策一致性）
DELETE FROM health_snapshots;
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM risk_decisions;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL  risk_decisions 未隨 snapshot 級聯刪除，剩餘 % 筆', n;
  END IF;
  RAISE NOTICE 'PASS  risk_decisions 隨 snapshot 級聯刪除';
END $$;

ROLLBACK;
