-- PG-M-04：活動留念章（commemorative-nfts 2、3；shoe-gameplay 活動 NFT 承諾權限）。
-- events.badges：主辦方是否發行報到章／完賽章（分開；每玩家／活動／章別一次）。
-- event_participants.level_at_registration：報名時鞋階快照（活動 NFT 依承諾權限；之後降級不沒收）；舊列 NULL。
-- achievements.kind 增 'event'：milestone_key = 'event|<event_id>|<check_in|finish>'，achievement_id 依穩定 key 派生。
ALTER TABLE events ADD COLUMN IF NOT EXISTS badges JSONB NOT NULL DEFAULT '{"check_in": false, "finish": false}';
ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS level_at_registration SMALLINT;
ALTER TABLE achievements DROP CONSTRAINT IF EXISTS achievements_kind_ck;
ALTER TABLE achievements ADD CONSTRAINT achievements_kind_ck CHECK (kind IN ('pb', 'milestone', 'event'));
ALTER TABLE achievements DROP CONSTRAINT IF EXISTS achievements_source_ref_ck;
ALTER TABLE achievements ADD CONSTRAINT achievements_source_ref_ck CHECK ((kind = 'pb' AND pb_id IS NOT NULL) OR (kind IN ('milestone', 'event') AND milestone_key IS NOT NULL));
