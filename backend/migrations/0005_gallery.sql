-- PG-G-01 藝廊投影（SD 11A）：只含鏈上公開事件推導的資料，不含任何健康數值；不受 BR-25 個資刪除影響。
CREATE TABLE IF NOT EXISTS gallery_players (
  wallet            TEXT PRIMARY KEY,
  shoe_level        SMALLINT NOT NULL DEFAULT 1,
  core_level        SMALLINT NOT NULL DEFAULT 1,
  xp                BIGINT NOT NULL DEFAULT 0,
  streak_days       INTEGER NOT NULL DEFAULT 0,
  max_streak_days   INTEGER NOT NULL DEFAULT 0,
  last_task_date    INTEGER,
  collectible_count INTEGER NOT NULL DEFAULT 0,
  first_seen_slot   BIGINT NOT NULL,
  updated_slot      BIGINT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gallery_players_level_ck CHECK (shoe_level BETWEEN 1 AND 5 AND core_level BETWEEN 1 AND 5),
  CONSTRAINT gallery_players_xp_ck CHECK (xp >= 0)
);
-- 排行：等級 DESC → XP DESC → 錢包 C 序
CREATE INDEX IF NOT EXISTS gallery_players_rank_idx ON gallery_players (shoe_level DESC, xp DESC, wallet COLLATE "C" ASC);
CREATE INDEX IF NOT EXISTS gallery_players_prefix_idx ON gallery_players (wallet text_pattern_ops);

CREATE TABLE IF NOT EXISTS gallery_collectibles (
  wallet      TEXT NOT NULL,
  kind        SMALLINT NOT NULL,
  asset       TEXT NOT NULL,
  signature   TEXT NOT NULL,
  slot        BIGINT NOT NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, kind)
);
