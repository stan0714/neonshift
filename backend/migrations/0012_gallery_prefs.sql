-- PG-R-09：藝廊展示偏好（退出藝廊只停止 App 展示，不刪鏈上／已公開 metadata；activity-running-gallery 6.3）。
-- 與投影表分開，避免 indexer upsert 覆寫；DELETE /player/data 會設 hidden = true。
CREATE TABLE IF NOT EXISTS gallery_prefs (
  wallet     TEXT PRIMARY KEY,
  hidden     BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
