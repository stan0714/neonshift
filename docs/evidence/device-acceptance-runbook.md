# 真機驗收 Runbook（2026-09-22）

給負責人在 Seeker 上跑驗收用：每一項寫「怎麼做」「要驗什麼」「留什麼證據」。只有實測才在證據檔標 PASS；沒做到的留 TODO，不補造。依據：[參賽開發計畫 §6](../store/competition-development-plan.md#6-發布驗收與證據包)、[活動手冊](../store/event-demo-playbook.md)、[Demo 腳本 §8](../store/demo-video.md)。

## 0. 每次開始前（10 分鐘）

| 做法 | 驗證重點 | 證據 |
|---|---|---|
| 裝提交版：`APP_ARCHS=arm64-v8a scripts/app/build.sh demo release` → `adb install -r …`；`scripts/release/evidence.sh` 產骨架 | release-notes 的 Git commit＝目前 HEAD、`展示覆寫 demoLevel: 0`、後端 `https://api.neonshift.cc/v1` | `docs/evidence/<日期>-release-candidate.md` 建置表 |
| 後端兩台一致：`curl http://l1.neonshift.cc:6080/v1/rules/version`、同 l2、同 `https://api.neonshift.cc` | 三處 `rules_version` 相同；`/readyz` db ok | 貼三行輸出 |
| 網路狀況先量：`for i in $(seq 10); do curl -s -o /dev/null -w '%{http_code} %{time_starttransfer}\n' https://api.neonshift.cc/v1/rules/version; done` | 10 次都 <2 s；有 >10 s 就是主機商對外路徑掉封包（9/22 已見），當天測試結果要註明 | 貼輸出 |
| 手機：Seeker Wallet 為 `solana-wallet:` 預設（Phantom 26.6 不回覆）、通知權限開、定位「使用時允許」、Health Connect 步數已授權 | Profile → 權限列全綠 | 截圖 |
| 診斷工具：`scripts/ops/player.sh AcBU5ro1FmheCL9XseGS2UYrKyu2RZb4gWCQ8MCovbV2` | 能看到你的運動／PB／里程碑／成就／SKR 狀態 | 跑一次貼結果（作起點） |

## 1. COMP-W02 真機主線：任務 → GPS → 同步 → 資格 → NFT → 收藏（→ SKR）

目標是一條**可重播**的真實流程；每一步都有 App 畫面＋伺服器狀態＋（鏈上時）交易簽章。

| # | 做法 | 驗證重點 | 證據 |
|---|---|---|---|
| 1 | Home 看今日任務卡（步數 8,000／運動任務） | 兩張卡狀態與 Health Connect 步數一致；UTC 換日倒數正確 | 截圖 `01-home` |
| 2 | Explore → 接受「三天各一次」或「限時目標」 | 卡片狀態「已接受」、下一步文案、GPS 是否計入的提示（`QUEST_GPS_MIN_RULES_VERSION` 未設時會寫「App 內 GPS 尚未計入」） | 截圖 |
| 3 | 任務卡「以這個目標開始」→ 開始頁 | 模式／目標已預填、仍可改；GPS 就緒指示變綠再按 START | 截圖 |
| 4 | 跑 **≥5.0 km**（戶外開闊、手機別放深口袋、過隧道前先暫停） | 記錄頁分段更新、暫停／繼續、鎖屏後回來仍在跑；**記錄中不得出現任何錢包彈窗** | 錄影 30–60 s（`scripts/demo/capture.sh rec`）＋完成後 Profile「錢包互動紀錄」摘要「運動中 0 次」 |
| 5 | 完成 → 摘要頁 | 距離／時間／分段／品質；kcal 有體重就「≈N · 估算」；同步狀態「已同步」 | 截圖 `02-summary` |
| 6 | `scripts/ops/player.sh <wallet>` | 該筆 `saved/complete pb_eligible=true`、**沒有** `gps_gap／gap_teleport`；`first_5k|outdoor|device` → `eligible`；PB longest_run 更新 | 貼輸出 |
| 7 | Gear → 里程碑「首次 5 km」→ 申請鑄造（選公開／私人） | 進入待核准；不顯示假成功 | 截圖 |
| 8 | 電腦：`OPS_TOKEN=… npm --prefix tools/chain-admin run sync-achievements -- dev --dry-run` → 實跑 | 該成就 approved、registry 簽章寫入 | 貼輸出＋Explorer 連結 |
| 9 | App 回到里程碑 → 鑄造 → Seeker Wallet 簽署 → 成功 | 揭曉動畫；Gallery 本人頁出現；`player.sh` 成就 `minted` 帶 asset | 截圖＋簽章＋asset 位址 |
| 10 | Profile → 成就護照 | 首次 5 km「有效／裝置紀錄／NFT 已鑄造」；PB 有效；待審者標「待驗證」 | 截圖 |
| 11 | （SKR）Gear → Genesis Mint 邊框 → 購買（devnet TEST mint，2.5 SKR）→ 確認框 → 簽署 → 確認中 → 已解鎖 | 確認框金額／網路／收款人正確；送出後只查詢不重送；關 App 重開仍能恢復；Gear／Gallery 本人頁套邊框 | 截圖＋簽章＋`player.sh` SKR 訂單 fulfilled |
| 12 | 錢包失敗矩陣（每種至少一次）：拒簽、簽完不回 App 8 s、簽署中切回 App、換帳號後再簽、無 SOL | 都有明確狀態、可重試、不重扣；「錢包互動紀錄」記到對應結果（無回覆／失敗） | Profile 卡截圖 |
| 13 | 冷啟動＋離線：關 Wi-Fi 開 App → Explore／Workouts | 顯示上次快照（標 as of）、不出領取鈕；恢復網路後 Try again 回正常 | 截圖 |

登錄：全部填進 `docs/evidence/<日期>-release-candidate.md` 的驗收矩陣（預期／實際／版本／證據／測試者／日期）。

## 2. PG-E-02～06 活動流程真機測試

沒有合作方網頁；主辦方動作走 API／腳本，參加者與 staff 在 App。**同一錢包不能自己幫自己報到**——staff 用第二個帳號（Seeker Wallet 新增帳號，或 demo staff 金鑰經 curl）。

### 2.1 Fixture（2026-09-24 重建為英文，值見[活動手冊 §3](../store/event-demo-playbook.md)）

**評審與 Demo 影片以英文進行**：活動資料是主辦方自填的單一字串、不走 App 的 i18n，英文介面裡冒出中文品項會像未在地化的缺陷，所以 fixture 一律英文。

活動 `wild-guardian-day-2026`（`ff478fd8-85ed-4b99-b263-9bceb14eb805`）published、容量 200／已報名 0、兩站點（`Gate (check-in)`／`Booth (perk pickup)`）、有效期到 2026-10-24。品項三個：`Wild Guardian towel` 100、`Experience Day digital badge` 100,000、`Last one on the shelf (test)` **庫存 1**（第 9 步競態測試專用）。
NFC 有效標籤 `…?tag=jE6irsFYsOC5CvJmW9KlFaRVqR68IirU`，另備一枚**已停用**標籤 `…?tag=WbB9O_K3PCYqHbppBU2q0mkXasjpoNv-` 供第 6b 步測試。

> **品項建立後不可改名也不可改庫存**——後端只有 `POST`／`GET /partner/events/:id/benefits`，沒有 PATCH 或 DELETE（庫存是對參加者的承諾，刻意不讓事後調整）。因此低庫存品項必須在建立 fixture 時就備好；先前 runbook 寫的 `set-stock` 指令打到不存在的路由（404），已從腳本與本文件移除。

```bash
cd backend
node scripts/demo-event-admin.mjs http://l2.neonshift.cc:6080 show                     # 目前狀態（報名／庫存／報到筆數／現行角色）
node scripts/demo-event-admin.mjs http://l2.neonshift.cc:6080 add-staff <錢包> check_in      # 指派 App staff（已指派帳號 B 於 Gate）
node scripts/demo-event-admin.mjs http://l2.neonshift.cc:6080 add-staff <錢包> all          # 第 8 步之後改授全站點（一個錢包同時只有一個 staff 站點）
node scripts/demo-event-admin.mjs http://l2.neonshift.cc:6080 revoke-tag <tag_id>           # 停用一枚 NFC 標籤
# 重建／補齊（幂等，標籤會重用）：OPS_TOKEN=$(ssh root@l2.neonshift.cc 'grep ^OPS_TOKEN= /etc/neonshift/api.env | cut -d= -f2') node scripts/demo-event.mjs http://l2.neonshift.cc:6080
```

帳號 B `9esSdbMa8ZS5HY9beMscpKU1gAPKA3REPqLMQTSmNYRh` 已指派為 **Gate（check_in）staff**；`show` 末尾會列出現行角色。同一錢包不能自己幫自己報到，所以 A、B 必須是不同帳號。

舊的中文活動 `wild-guardian-day`（`d67d6da9-…`）保留未動，供**第 11 步取消測試**使用（取消後不影響英文 fixture）。

### 2.2 手機流程（帳號 A＝參加者，帳號 B＝staff）

| # | 做法 | 驗證重點（E-xx） | 證據 |
|---|---|---|---|
| 1 | A：Arena → 合作活動 → 詳情 | 標題／時窗／規則版本／容量／隱私說明可讀；未登入先要求 SIWS（E-03） | 截圖 |
| 2 | A：報名（同意規則版本）→ 再按一次 | 第二次回「已報名」不重複占位；名額 −1 只一次（E-03 原子容量） | 截圖＋`GET /partner/events/$EV/check-ins`／registrations 計數 |
| 3 | 主辦方：新增規則版本並發布 → A 重開詳情 | 要求重新確認新版本才算有效同意（E-02 規則版本） | 截圖 |
| 4 | A：詳情 → 顯示報到碼（8 碼＋QR，120 s） | 倒數、過期後失效；同一碼不能用兩次（E-05） | 截圖 |
| 5 | B：切換帳號 → 同活動 → Staff tools → 輸入 A 的碼 | 報到成功一次；再輸入同碼 → 拒絕／顯示既有狀態；過期碼 → 拒絕；B 若沒 staff 角色 → **API 拒絕**不只是藏按鈕（E-05 權限） | 截圖 ×3 |
| 6 | A：NFC／App Link：用 fixture 的 `https://neonshift.cc/e/wild-guardian-day-2026?tag=…` 開 | 只開到活動頁，**不**等於已報到（E-04）；停用的 tag 開頁要說明 | 截圖 |
| 7 | A：報到後 → 權益「紀念毛巾」預留 → 拿到領取碼 | 未報到不能預留（CHECKIN_REQUIRED）；每人上限 1；預留有期限（E-06） | 截圖 |
| 8 | B（只被指派 Gate）：切到「權益交付」 | 顯示「沒有權益站點權限」、確認鍵停用；後端帶 `checkpoint_id` 時回 403 `ROLE_FORBIDDEN`（跨站點，E-06） | 截圖 |
| 8b | 主辦方 `add-staff <B> all` → B 重進 → 核銷 A 的領取碼 → 再核銷一次 | 第一次 fulfilled；第二次回「先前已交付」且不扣第二份庫存 | 截圖＋`GET /partner/events/$EV/redemptions` |
| 9 | 最後一件：A 與第三帳號同時預留 `Last one on the shelf (test)`（庫存 1） | 只有一人成功、庫存不負數（E-06 原子） | API 回應兩份 |
| 10 | 預留逾期：等 hold 到期（或用小庫存品項）→ 核銷 | 逾期不能交付、庫存釋放 | 截圖 |
| 11 | 主辦方取消**舊的中文活動** `wild-guardian-day` → A 開該活動詳情（英文 fixture 不動） | 顯示原因、不能再報名／預留；既有預留處理（E-02 生命週期） | 截圖 |
| 12 | 斷線：關 Wi-Fi → A 開報到碼／B 開核銷 | 不得離線顯示「已報到／已交付」；恢復後重查狀態 | 截圖 |
| 13 | 活動章：A 若報名時 Lv≥2 → 報到後 Gear 里程碑出現「活動報到章」 | Lv1 帳號顯示 level_locked 原因，不能領（M-04） | 截圖 |

證據放 `docs/evidence/<日期>-events.md`（沿用活動手冊 §5 的表：情況／應看到／實際／證據）。公開影片只用 1–2 個例外；其餘留證據檔。

## 3. 截圖／影片

| 項目 | 做法 | 驗證重點 |
|---|---|---|
| 商店截圖 7 張 | 手機開到位 → `scripts/demo/store-shot.sh <name>`（1080×2400 直出）；缺：`01-landing`（新手指南首頁）、`03-clockin`（8,000 步達標那天）、`05-arena`、`06-gallery`、`06b-explore` | 真實 Lv.1 資料、DEVNET 標示、無 DEMO 覆寫；窄邊不破框、放大字體版另拍一組（系統字體 130%） |
| 影片素材 | `scripts/demo/capture.sh touches on` → `rec <name> [秒]`（≤180 s、無聲）；錢包視窗用相機側拍（secure surface 抓不到） | 每個鏡頭標 `REAL DEVICE · DEVNET`／`TEST DATA`／`WORKFLOW PREVIEW`；devnet TEST SKR 全段標 `TEST SKR · not official SKR` |
| 成片 | 依 [demo-video §8 v4](../store/demo-video.md) A–E 五段（170 s）；SKR No-go 用替代稿 | 量**最終匯出檔**時長 ≤180 s；旁白不宣稱未驗收的事；四素材（APK／GitHub／影片／簡報）同一 commit |

## 4. 回歸與版本凍結（COMP-R01）

| 做法 | 驗證重點 |
|---|---|
| `cd app && npx jest --forceExit --runInBand`；`cd backend && npx vitest run`；`npx tsc --noEmit` 兩邊 | 全綠（目前 Jest 458／vitest 224） |
| `scripts/release/clean-build.sh demo` | 乾淨 clone 建得出來；SHA 記入 `docs/evidence/<日期>-clean-build-demo.md` |
| UI 矩陣（提交版 APK）：冷啟動、返回鍵每頁、系統字體 130%、繁中／英文切換、Reduce Motion 開、深色、窄螢幕（Seeker 已是） | 無破框、無死路、動畫可跳過；Phantom 已知問題提示仍在 |
| 釋出前：release-notes 無 `DEMO DATA`、`EXPO_PUBLIC_DEMO_LEVEL=0`、API https、無 keystore／私鑰進 repo（`git status`、`git log --stat` 抽查） | evidence.sh 表格全填、judges-guide 連結用無痕瀏覽器全點過 |
| 凍結：打 tag（例如 `submission-v0.1.0`）＋ APK SHA 寫進 judges-guide 與 listing | 之後只准修文件，程式改動要重跑本節 |

## 5. 已知限制（測試時先知道）

- 9/21 那筆 5.31 km 因 `gps_gap＋gap_teleport` 為 needs_review：不會被人工核准，主線要用新的乾淨跑步。
- `QUEST_GPS_MIN_RULES_VERSION` 未設 → App 內 GPS 不計入探索任務（卡片會明講）。要讓 App 內 GPS 計入請設 **2**（＝`WORKOUT_RULES_VERSION`，每筆運動被戳的品質版號；`/v1/rules/version` 的 4 是每日任務規則，兩條版號不同）；設成高於 2 的值等於沒開，卡片也會維持「不計入」。
- l1／l2 對外路徑 9/22 間歇掉封包；GET 逾時 App 會自動重試一次，POST 不會（打卡／同步顯示錯誤讓你再按）。
- Phantom 26.6 on Seeker 簽完不回覆（已知問題，指南有寫）；主線用 Seeker Wallet。
