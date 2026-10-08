# SKR 付款實機紀錄（devnet，2026-10-01）

Genesis Mint frame（純外觀）以 TEST SKR 付款的完整主線：建單 → 餘額預檢 → MWA 簽送 →
伺服器查驗 → 權限授予。負責人本人的 Seeker，真實錢包簽章，devnet 真實交易。

截圖：
- `2026-10-01-skr-devnet-eligible.png`（16:17，付款前：資格通過、2.5 SKR 固定價、收款人 `8Wp3Xy…3gFa1k`、Buy with SKR）
- `2026-10-01-skr-devnet-paid.png`（16:45，OWNED、金色邊框、Payment confirmed）

兩張同一帳號、同一包（versionCode 11）。10/2 決定介紹片第 7、8 頁沿用這兩張，不另錄付款影片。

## 版本

| 項目 | 值 |
|---|---|
| commit | `c477b8e` |
| 版本 | versionName 0.1.0 / **versionCode 11** |
| APK SHA-256 | `c27c252af27f9857fe9e075332b736d9ef9e2e43aecc4a720d325eb91011ba37` |
| env／ABI | demo（release）／arm64-v8a |
| 展示覆寫 demoLevel | 0 |
| 後端／網路 | https://api.neonshift.cc/v1 ／ devnet |
| 裝置 | Seeker（SM02G4061936379），Solana Mobile Wallet ＋ Seed Vault |

## 鏈上證據

| 項目 | 值 |
|---|---|
| 簽章 | `5wqCxqKXBmQzbWu4ZVtwoJ6rbtB5gCgLdpP6bCtLoPc8ymScvKZ6mszqqq4JaScsrvQ482haVLYFFToamoS7cEnF` |
| slot | 506215245 |
| blockTime | 2026-10-01T08:45:20Z（16:45:20 CST） |
| err | None |
| 手續費 | 45,000 lamports |
| TEST SKR mint | `7YX4Fwx8qiZzQru4H9yewfghyHZN3v5RPXMAGbciVUHi`（6 decimals） |
| 付款人 | `AcBU5ro1FmheCL9XseGS2UYrKyu2RZb4gWCQ8MCovbV2` 10 → **7.5** |
| 收款人 | `8Wp3Xyfw49KiA1CYL34bPLm59KHLbcBYRotyTF3gFa1k` 0 → **2.5** |
| 收款 ATA | `65xb4trbGnzKGFaGUGntchLb8eTXoqwmKwLYsPFbKKTj` |

指令組成：`spl-associated-token-account/createIdempotent`（收款 ATA 已存在 → no-op）、
`spl-token/transferChecked`（**checked**：decimals 由鏈上核對，SKR-07 要求）、ComputeBudget ×2（錢包加的）。

## 第一次嘗試失敗：blockhash 過期（非程式問題）

錢包回「Blockhash expired because too much time passed between transaction creation and signing」，
交易**從未廣播**，鏈上餘額完全不動。

量測當下 devnet：**4.32–4.97 blocks/秒**，150 blocks 的有效期只有 **約 30–35 秒**
（常引用的 60–90 秒是 mainnet 約 2.5 blocks/秒的數字）。RPC 節點未落後（margin 148/150），
不是拿到舊 blockhash。

| 階段 | 失敗那次 | 成功那次 |
|---|---|---|
| intent → 選定錢包 | 3.1 s | **1.5 s** |
| 錢包畫面停留 | 17.8 s | **11.4 s** |
| Seed Vault | 10.5 s | — |
| intent → 簽名 | ~32 s | **~13 s** |
| intent → 鏈上確認 | — | **20.3 s** |

手機上有四個 App 註冊 `solana-wallet:`（Solana Mobile Wallet、Jupiter、Phantom、另一個），
所以每次都會跳選擇器。

**結論**：devnet 的 30 秒窗口下，MWA 流程（選擇器＋錢包確認＋生物辨識）本身就佔掉大半。
mainnet 約 60 秒會寬鬆得多，但這仍是真實的 UX 壓力；正式版若要穩定，應考慮 durable nonce。

## 同時暴露的程式缺陷（已修）

失敗後畫面進入「Payment result unknown」、付款鍵停用——R1 的保護如設計運作。
但清掉付款嘗試的 `settleAttempt` **只在按下付款時才跑**，付款鍵停用就永遠跑不到，
形成死結；唯一出口是等訂單 TTL 15 分鐘過期。卡片文案卻寫著「會自動重新開放」。

修正見 `fd9e1ed`：新增 `skrService.attemptIsDead()`，由 `store.recover()` 清掉已不可能成立的嘗試，
「查看狀態」成為真正的出口；文案改為實話。本次成功的那一包（versionCode 11）已含此修正。
