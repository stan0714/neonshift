# 2026-10-02 實機截圖（FlexClip 介紹片素材）

29 張靜態截圖，依投影片編號命名：`日期_APKcode_段落_內容.png`。

## 版本與條件

| 項目 | 值 |
|---|---|
| APK | versionCode **14**／versionName 0.1.0，demo／release，arm64-v8a |
| Git | `3518fa7` |
| APK SHA-256 | `05d3b4076f5bc09670b93f20794e6256956600831efd42bc40d87fd3e7c17a1c` |
| 裝置 | Solana Seeker（實機） |
| 網路 | Solana devnet；後端 `https://api.neonshift.cc/v1` |
| 展示覆寫 | demoLevel 0——**全部是真實資料**，沒有展示覆寫 |
| 錢包 | Seeker Wallet（`kofman.skr`，位址 `AcBU…vbV2`） |
| 狀態列 | 用 Android SystemUI demo mode 固定為 9:41、滿電、無通知圖示 |
| 介面語言 | English |

10/2 之後的 commit（取消連接的錯誤分類、Workouts 已同步卡片可點）不改變這些畫面的外觀。

## 對照投影片

| 投影片 | 檔案 | 內容 |
|---|---|---|
| 01 首頁 | `s01_home-top`、`s01_home-challenge-path` | 開始運動、最近紀錄、今日步數；挑戰路徑 |
| 02／05 錢包 | `s02-05_wallet-signin-1…4` | Seeker Wallet 選帳戶 → Connect → Verify／Approve → 指紋 Approved。**這是登入（SIWS），不是鏈上申領**；可當錢包核准的示意，不能當申領證據 |
| 03 運動 | `s03_workout-start-gps-ready` | Run、目標 3.50 km、GPS ready |
| 03 紀錄 | `s03_workouts-personal-bests`、`-weekly-review`、`-history` | 個人最佳、週回顧、紀錄列表（含 PB ELIGIBLE 與 NEEDS REVIEW 標記） |
| 04 詳情／同步 | `s04_activity-history`、`s04_summary-*`、`s04_share-card`、`s04_profile-sync` | 9/30 跑步 3.89 km：已同步、配速、≈226 kcal、分段、分享卡；Auto-sync on、0 pending |
| 06 成就收藏 | `s06_*` | 徽章與里程碑、公開排行、玩家頁、Achievement passport、First 5K NFT 詳情（含 Open in Explorer） |
| 07–08 SKR | `s07-08_genesis-frame-owned` | Genesis Mint frame · TEST SKR · DEVNET · **OWNED**（10/1 真實付款後的狀態，不是首次付款畫面） |
| 09 保育鞋款 | `s09_gear-*`、`s09_elephant-*` | Gear 主畫面、鞋款收藏格；亞洲象故事卡：設計預覽、棲地、共享野生動物時刻、WWF 物種故事 |

## 使用限制

- **05 鏈上申領**仍須實錄：今天沒有合格任務。
- **07–08 SKR 首次付款**：10/2 決定不另錄，投影片沿用 10/1 v11 的付款前／後兩張（`docs/evidence/2026-10-01-skr-devnet-eligible.png`、`-paid.png`）。本資料夾的 `s07-08_genesis-frame-owned` 只作備用。
- 已套用到 [FlexClip v4 投影片](../../flexclip-v4/README.md) 第 1、3、4、6、9 頁。
- `s04_activity-history` 標題旁有一個觸控指示圓點（手機開了「顯示觸控」），其他可用的影格都在過場中，必要時重拍這一張。
- `s03_workouts-history` 的卡片 kcal 是「—」，`s04_summary-*` 是 ≈226：列表讀伺服器欄位，詳情頁用體重在本機估算。兩張不要並排。
- 沒有收錄 Profile 的 About（版本會隨最終 APK 改變）與 Wallet interactions 紀錄（含 10/2 測試取消連接留下的 `Failed` 行）。
