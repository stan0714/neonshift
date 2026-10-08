-- PG-SEASON-04：節日收藏（Seasonal Footprints）併入 achievements。
--
-- kind='seasonal'：milestone_key = 'seasonal|<campaign_id>' 為穩定 key，
-- achievement_id = sha256("neonshift-seasonal|" || wallet || "|" || campaign_id)。
-- 既有的 achievements_milestone_key_uidx (wallet, milestone_key) 直接給出「每玩家每屆一枚」，
-- 不需要另建索引；重匯入、改時區、換鞋、多次按鍵都沿用同一列。
--
-- 鏈上只有**一個** seasonal category（attestation_core::CATEGORY_SEASONAL = 14），
-- 主題與年份寫在 metadata（每一枚有自己的 metadata URI）——唯一性本來就由 achievement_id
-- 提供（receipt PDA、asset PDA 與 URI 三者都以它為 seed），所以不必為每個主題各開一個
-- category，否則每年新增主題都要升級並重新部署程式。
ALTER TABLE achievements DROP CONSTRAINT IF EXISTS achievements_kind_ck;
ALTER TABLE achievements ADD CONSTRAINT achievements_kind_ck CHECK (kind IN ('pb', 'milestone', 'event', 'seasonal'));
ALTER TABLE achievements DROP CONSTRAINT IF EXISTS achievements_source_ref_ck;
ALTER TABLE achievements ADD CONSTRAINT achievements_source_ref_ck CHECK ((kind = 'pb' AND pb_id IS NOT NULL) OR (kind IN ('milestone', 'event', 'seasonal') AND milestone_key IS NOT NULL));
