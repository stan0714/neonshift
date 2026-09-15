-- PG-V-03：歷史有效等級（shoe-gameplay 5、7；SD 14）。由 finalized 鏈上事件投影：PlayerInitialized（Lv1）、PlayerMigrated（遷移當日）、EpochSettled（結算日起）。
-- PB NFT 資格以達成日的 active_level 判定（≥ Lv3）；無可查歷史 → 只保留私人 PB，不自動授予。
CREATE TABLE IF NOT EXISTS level_history (
  wallet              TEXT NOT NULL,
  effective_from_date INTEGER NOT NULL,
  active_level        SMALLINT NOT NULL,
  highest_level       SMALLINT NOT NULL,
  epoch               INTEGER,
  source              TEXT NOT NULL,
  signature           TEXT NOT NULL,
  slot                BIGINT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, signature, source),
  CONSTRAINT level_history_level_ck CHECK (active_level BETWEEN 1 AND 5 AND highest_level BETWEEN 1 AND 5),
  CONSTRAINT level_history_source_ck CHECK (source IN ('init', 'migrate', 'epoch'))
);
CREATE INDEX IF NOT EXISTS level_history_lookup_idx ON level_history (wallet, effective_from_date DESC, slot DESC);
-- 藝廊：歷史最高（Lifetime 榜；PG-V-04 使用）
ALTER TABLE gallery_players ADD COLUMN IF NOT EXISTS highest_level SMALLINT NOT NULL DEFAULT 1;
