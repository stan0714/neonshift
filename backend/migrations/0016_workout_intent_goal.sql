-- PG-U-01：三模式與目標快照（sport-experience-gameplay 1、2；SD 17）。
-- intent：walking = casual（走路）／brisk（健走），running = run；舊資料 NULL（UI 顯示「走路（未指定模式）」）。運動開始後固定，不可改類別洗成就。
-- goal_snapshot：{kind: free|time|distance, target, unit: s|mm, version}；達標只提醒、不自動停止；自由目標不產任務獎勵。
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS goal_snapshot JSONB;
ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_intent_ck CHECK (intent IS NULL OR intent IN ('casual', 'brisk', 'run'));
