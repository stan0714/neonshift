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
