-- PG-SHARE-05：分享落地頁的去識別彙總計數（docs/social-share §6.3）
--
-- 這張表只存「哪一種分享、哪個來源、哪一天、哪個事件、發生幾次」。
-- 不存 IP、referrer、cookie、裝置指紋或任何個人識別；也沒有欄位可以反查是誰分享的。
-- 計數是**非唯一事件數**：重新載入、爬蟲預抓與重試都會加一，因此不得用於發獎或對外宣稱轉換率。
CREATE TABLE IF NOT EXISTS share_aggregates (
  kind       TEXT NOT NULL,
  source     TEXT NOT NULL,
  day        DATE NOT NULL,
  event_name TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, source, day, event_name)
);
CREATE INDEX IF NOT EXISTS share_aggregates_day_idx ON share_aggregates (day DESC);
