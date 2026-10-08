-- 維持規則 v2（DEC-04 方案 B，2026-09-20）：task_type 3 = 運動 session 任務；睡眠（2）退役但歷史列保留
ALTER TABLE health_snapshots DROP CONSTRAINT health_snapshots_task_type_ck;
ALTER TABLE health_snapshots ADD CONSTRAINT health_snapshots_task_type_ck CHECK (task_type IN (1, 2, 3));
ALTER TABLE attestations DROP CONSTRAINT attestations_task_type_ck;
ALTER TABLE attestations ADD CONSTRAINT attestations_task_type_ck CHECK (task_type IN (1, 2, 3));
