# DEC-04：睡眠停用後的維持規則候選（規則 v2 提案）

2026-09-20｜`node tools/maintenance-sim/simulate-v2.mjs --days 98`｜規則 `tools/maintenance-sim/rules-v2.mjs`（`node --test tools/maintenance-sim/rules-v2.test.mjs`）。v1（`rules.mjs`、鏈上 `constants.rs`）不動；依 shoe-gameplay 4.3 新規則只能自新版本生效期起適用，既有玩家保留目前與歷史鞋階。

## 問題

App 已停用睡眠（`FEATURES.sleep=false`，Health Connect 不再要求睡眠權限）。v1 維持點只有步數 +100／日 → 每期最多 700，達不到 Lv5 的 900／6 日；**所有玩家都被鎖在 Lv4**，Lv5「巔峰守護」成就與限量外觀資格無人能得。原 DEC-04 的 (a)「接受並明示」已不成立。

## 候選

第二每日任務改為**運動 session**（本 App 專注的內容）：App 內 GPS 記錄的跑步／健走，`status=saved`（通過品質審核、非待審）、距離 ≥ 1.0 km 且移動時間 ≥ 10 分鐘、每 UTC 任務日一次（與步數同日曆）；Health Connect 匯入與手動紀錄不計（來源不可歸因）。

| 候選 | 每日維持點 | 門檻 | Lv5 最省力 | Lv4 最省力 | 只走步數上限 |
|---|---|---|---|---|---|
| A | 步數 100、運動 50、日上限 150 | 同 v1（Lv5 900／6） | **4 次運動**＋7 天步數 | 7 天步數 | Lv4 |
| **B（建議）** | 步數 100、運動 100、日上限 200 | 同 v1 | **2 次運動＋7 天步數**，或 3 次＋6 天（留一天休息） | 7 天步數（或 5 天步數＋2 次運動） | Lv4 |
| C | 只算步數 100 | Lv5 改 700／7 | 7 天步數（沒有休息日） | 7 天步數 | Lv5 |

## 98 天情境（每階 XP 門檻不變 0／450／1,500／3,600／7,500）

| 情境 | A | B | C |
|---|---|---|---|
| 只走路（每日步數） | Lv4 | Lv4 | Lv5（day77） |
| 每日步數＋每週 2 次運動 | Lv4 | **Lv5（day63）** | Lv5（day77） |
| 每日步數＋每週 3 次運動、週日休息 | Lv4 | **Lv5（day63）** | Lv3 |
| 跑者：週 4 次運動、只在運動日達步數 | Lv3 | Lv3 | Lv2 |
| 週末型：週六日運動＋步數 | Lv2 | Lv2 | Lv2 |
| 間歇：週 4 天步數／1 次運動 | Lv3 | Lv3 | Lv2 |

## 為什麼建議 B

1. **Lv5 真的要「動」**：每天走路＋每週 2～3 次跑步／健走就能維持，且保留一天完全休息（6＋3）；A 要求每週 4 次運動，對一般使用者過高；C 讓不運動的人也能到 Lv5，運動紀錄與鞋階脫鉤，違背本版「專心在運動數據」的方向。
2. **只走路仍能到 Lv4**：v1 的「睡眠不可用者最高 Lv4」語意改成「不運動者最高 Lv4」，階級越高越規律的原則不變。
3. **參數改動最小**：門檻表、活躍日、結算順序、XP 門檻全部沿用 v1，只換第二任務的來源與分值（50 → 100）與日上限（150 → 200）；模擬與鏈上只改一個常數組。
4. **跑者不能只靠跑**：活躍日門檻（Lv4 ≥ 5、Lv5 ≥ 6）仍要求多數日子有步數，避免一週跑四次其他天完全不動也拿高階。

## 採用 B 的實作範圍（估 3.0 人天，需另立 PG 工作）

| 層 | 變更 |
|---|---|
| 鏈上（PG-V-02 續） | `MAINTENANCE_RULES_VERSION=2`；新 `TASK_WORKOUT=3`（不重用 2，睡眠歷史 receipt 不變）；`MAINTENANCE_POINTS_WORKOUT=100`、日上限 200；`xp_for(3)=100`；獎勵基礎沿用 `base_sleep_reward` 欄位作為「第二任務基礎」（避免 Config 版面遷移）並在 SD 註明，或 `update_config` 加欄位另版；attestation canonical bytes 的 task_type 接受 3；玩家 `maintenance_rules_version` 遷移＝從首次完整新週期起算（4.3）。 |
| 後端 | `TASK_TYPES.workout=3`；claim 驗證改查該 UTC 日本人已同步的 `device_gps` session（saved、≥ 1 km、moving ≥ 10 min、非待審），同日一次；attestor 簽發；風險規則沿用 GPS integrity（mock／teleport／sustained speed → needs_review 不得申請）。 |
| App | Home 任務卡「運動任務」取代睡眠卡（已 `FEATURES.sleep=false`）；完成運動並同步後可申請；Gear 維持進度說明改「步數 ＋ 運動」；`domain/maintenance` 預覽用 v2 參數；i18n 兩語。 |
| 文件 | shoe-gameplay §3 表與文字、SD 3.x、BRD FR-16、maintenance-sim v2 正式化、PG 新工作列。 |

限制：運動任務需先同步到伺服器才能申請（attestor 只信伺服器已審核的 session），離線當天無法申請；晚到同步不補當日（與步數規則一致）。

## 待負責人定案

- 採用 B？（或改 B 的運動分值／門檻）
- 運動 session 門檻：≥ 1.0 km 且 ≥ 10 分鐘（健走友善）是否合適；是否允許 Health Connect 匯入的裝置來源（目前不允許）。
- 生效時點：devnet 可立即（無真實資產）；規則版本切換依 4.3 從新週期起。
