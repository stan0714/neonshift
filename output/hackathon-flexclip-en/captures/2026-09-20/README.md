# 2026-09-20 Seeker 實機截圖（USB／adb，APK Git 373a180，devnet，英文 UI）

由 `scripts/demo/capture.sh shot <name>` 直接自手機擷取（1200×2670 PNG，未修圖）。錢包帳號 AcBU…vbV2、Lv.1、後端 session 未簽 SIWS（因此 Arena／打卡紀錄顯示「Sign the message」）。

| 檔案 | 對應場景 | 可否替換簡報中的預覽 | 備註 |
|---|---|---|---|
| 01-home-top / 01-home-missions / 01-home-bottom | 01 Move with purpose | ✅ 取代第 1 頁 EARLY BUILD | 已無睡眠卡；新「Workout mission」（維持規則 v2）；步數 967 為當日真實值 |
| 02-activity-dashboard / -cards / -calendar | 02 See your progress | ✅ 取代第 2 頁 DESIGN PREVIEW 的靜態部分 | 卡片為真實本機紀錄（09/16 4.51 km 等；0 km 測試紀錄仍在，建議先刪再重截）；「三筆離線→依序同步」需錄影（screenrecord），待跑三場後補 |
| 02-workouts-list / -unsynced | 02（Save on your phone. Sync when ready.） | ✅ | 7 筆本機未同步、訪客歸屬提示 |
| 03-clockin-history-signin | 03 Verify a milestone | ⚠️ 只能當「登入提示」鏡頭 | 完整打卡（8,000 步→live motion→錢包→成功→Explorer）待實機；錢包視窗需相機側拍 |
| 04-gear-top / -period-and-my-shoes / -maintenance / -my-shoes | 04 Discover Wild Guardians | ⚠️ 部分 | 目前 Lv.1：只有 Origin、無棲地背景；本期維持點 0／200 顯示為 v2 文案。切鞋／森林／海洋背景待 Lv.2+ 帳號 |
| 04-gear-shoe-detail / -shoe-story | 04 | ✅ 故事卡可用 | Origin 詳情；Wild Guardians 故事卡需開 Lv.2+ 鞋款詳情（鎖定狀態也可讀解鎖條件） |
| 04-gear-collection | 04 | ✅ 可作「系列一覽」 | Asian Elephant／Hawksbill／Tiger／Amur Leopard 鎖定卡＋徽章 |
| 05-profile-top / -sync / -gallery | 02／05 | ✅ | 「資料與同步」預設關、歸屬 7 筆訪客；權限列只剩步數 |
| 05-arena / -arena-events-link | 05 Connect with community | ⚠️ | 需先簽 SIWS 才能進活動頁；雙角色流程待測試活動建立後錄影 |

USB 抓不到：Seed Vault／MWA 錢包授權視窗（secure surface → 黑畫面）、戶外起步鏡頭、Explorer 交易頁（用電腦瀏覽器截）。錄影用 `scripts/demo/capture.sh rec <name> [秒]`（無聲、單檔 ≤ 3 分鐘），操作前先 `capture.sh touches on`。

## `*-demo*.png`：展示版覆寫（DEMO DATA，非真實鏈上等級）

APK 以 `EXPO_PUBLIC_DEMO_LEVEL=3 scripts/app/build.sh dev release` 建置（Git 29fb41c）；App 把鏈上 Lv.1 profile **顯示**成 Lv.3，畫面右上固定「DEMO DATA」、打卡／鑄造停用。影片中這些鏡頭必須標 **DESIGN PREVIEW／DEMO DATA**，不得標 REAL DEVICE · DEVNET。鏈上、後端、提交 APK 都未變。

| 檔案 | 場景 | 內容 |
|---|---|---|
| 01-home-top-demo-lv3、04-reveal-story-demo、-story2、-footer | 04 揭曉 → 鞋面 → 物種故事 | 覆寫觸發「GEAR EVOLVED Lv.1 → Lv.3」揭曉儀式：Hawksbill 鞋面、設計解說、玳瑁棲地與保育行動、WWF 故事連結 |
| 01-home-ocean-demo-lv3 | 04／01 | Home 海洋棲地背景（Lv.3） |
| 04-gear-top-demo-lv3、04-gear-my-shoes-demo-lv3 | 04 已取得鞋款 | 我的跑鞋 3 雙（Origin／Asian Elephant／Hawksbill）、本期維持 0／700 |
| 04-gear-elephant-detail-demo、04-gear-after-use-elephant-demo、04-gear-top-forest-look-demo | 04 切鞋 | 詳情「Use this pair」→ 外觀 Lv.2 亞洲象、森林背景；有效等級仍 Lv.3 |
| 01-home-forest-demo、02-activity-forest-demo、02-activity-cards-forest-demo | 04／02 | 森林背景鋪 Home／Activity，卡片縮圖同底圖 |
| 02-workout-start-route-picker-demo、02-workout-start-route-forest-demo | 04 路線底圖 | 開始前選底圖：Forest／Ocean 可選，Jungle Lv.4／Snow Lv.5 鎖定 |
| 02-summary-top-demo、02-summary-route-demo | 02 | 摘要頁（含當時跑鞋、已固定背景） |
| 04-gear-bg-switch-on-demo、-off-demo、01-home-bg-off-demo | 04 關背景 | 「跟隨跑鞋背景」關閉後 Home 回基本底、所選鞋不變 |

真實 Lv.2+ 帳號的同畫面待維持規則 v2 跑滿一期後再重截替換。
