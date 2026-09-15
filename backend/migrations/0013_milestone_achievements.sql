-- PG-M-02：首次里程碑成就併入 achievements（commemorative-nfts 4、BR-47）。
-- kind=pb：pb_id 為來源（既有）；kind=milestone：milestone_key = category|environment|verification_class 為穩定 key，
-- achievement_id = sha256("neonshift-milestone|" || wallet || "|" || milestone_key)；來源更正／重新達標沿用同一列，終身只鑄一枚。
ALTER TABLE achievements ALTER COLUMN pb_id DROP NOT NULL;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'pb';
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS milestone_key TEXT;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS source_kind TEXT;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE achievements ADD CONSTRAINT achievements_kind_ck CHECK (kind IN ('pb', 'milestone'));
ALTER TABLE achievements ADD CONSTRAINT achievements_source_ref_ck CHECK ((kind = 'pb' AND pb_id IS NOT NULL) OR (kind = 'milestone' AND milestone_key IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS achievements_milestone_key_uidx ON achievements (wallet, milestone_key) WHERE milestone_key IS NOT NULL;
UPDATE achievements a SET source_kind = p.source_kind, source_id = p.source_id FROM pb_revisions p WHERE a.pb_id = p.pb_id AND a.source_kind IS NULL;
