-- PG-E-09：活動資料保留（Q-13／DEC-06 未定案前預設 EVENT_RETENTION_DAYS=180）。
-- 到期後刪除個人層資料（名單、報到、challenge、核銷、徽章、成績版本、匯入原檔），保留活動、規則、稽核與宣傳彙總。
ALTER TABLE events ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
