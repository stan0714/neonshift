-- PG-E-06：核銷代碼（參加者出示、staff 輸入）。同活動唯一；不是憑證，只是查找鍵，交付仍需 staff session 與名單。
ALTER TABLE event_redemptions ADD COLUMN IF NOT EXISTS claim_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS event_redemptions_claim_code_uq ON event_redemptions (event_id, claim_code) WHERE claim_code IS NOT NULL;
