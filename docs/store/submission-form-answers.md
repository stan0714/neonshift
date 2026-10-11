# CLOCK IN 提交表單：長文答案草稿

狀態：**草稿（2026-10-07；10/10 加全欄位一覽）**。短欄位已由使用者確認（10/7）；長文待貼入提交頁確認字數。欄位見 [clock-in-submission §8.5](clock-in-submission.md#85-官方規則摘要2026-10-06-查)。
表單字數上限：公開 API 與條款未載明，需登入提交頁貼草稿確認。
原則：只寫已在實機或自動測試驗證過的事；devnet／tSKR／TEST SKR 明講；質押只列 Roadmap（官方規定質押整合不列入 SKR 獎）。

## 全部欄位一覽（照順序貼）

截止：**2026-10-12 19:59（台灣）**＝11:59 UTC；內部目標 10/12 12:00。草稿可改到按下最終提交為止。

| # | 欄位 | 要填的內容 | 狀態 |
|---|---|---|---|
| 1 | Project name | `NeonShift` | ✅ |
| 2 | VC / angel funding? | `No` | ✅ 使用者 9/21、10/7 確認 |
| 3 | Built in the last 3 months? | `Yes`（第一個 commit 2026-09-09） | ✅ |
| 4 | Previous hackathon win with this project? | `No` | ✅ 使用者 10/7 確認 |
| 5 | New mobile development（長文） | 下方 **Q1** 標題下的全文（第一句引用也要，去掉開頭的 `>`） | ⏳ 貼上後確認字數 |
| 6 | SKR integration（長文） | 下方 **Q2** 標題下的全文（第一句引用也要，去掉開頭的 `>`） | ⏳ 貼上後確認字數 |
| 7 | Pitch deck URL | `https://github.com/stan0714/neonshift/releases/download/v0.1.0-build24/NeonShift-Pitch-EN.pdf` | ✅ 10/9 未登入下載已驗 |
| 8 | Demo video URL | `https://youtu.be/hFUhFfC1sb0` | ✅ 10/10 上傳（不公開、可嵌入），未登入可播放 |
| 9 | GitHub repo URL | `https://github.com/stan0714/neonshift` | ✅ 公開，main＝build 24 |
| 10 | APK direct download URL | `https://github.com/stan0714/neonshift/releases/download/v0.1.0-build24/NeonShift-v0.1.0-build24-devnet-arm64.apk` | ✅ 10/9 未登入下載、SHA 已驗 |

送出前檢查：用無痕視窗逐一打開 7～10 的連結（影片要能免登入播放、APK 要直接開始下載）；repo 首頁 README 的評審表格要已有 APK、影片、Pitch 連結。

---|---|---|
| Project name | NeonShift | |
| VC / angel funding | No | 使用者 9/21 確認 |
| Built in the last 3 months | Yes | 第一個 commit 2026-09-09 |
| Previous hackathon win with this project | No | 待使用者確認 |

---

## Q1. New mobile development

> NeonShift was built from scratch for this hackathon (first commit 2026-09-09). Everything below is new and runs on a Solana Seeker today.

NeonShift is a native Android app for the Seeker that turns daily running, walking and step goals into on-chain "clock-in" missions. All of it is new work for CLOCK IN:

- **Mobile-first wallet flow.** Mobile Wallet Adapter connect plus Sign-In With Solana, with cancel and timeout handling, account switching with data kept separate per wallet, and a clear "no compatible wallet" state. Each claim is approved with a short, human-readable message in the wallet (mission, UTC day, expiry, domain), not raw bytes.
- **Native sensor modules (Kotlin).** Three custom Expo modules: Health Connect step reading that keeps only device-recorded steps (manual and third-party entries are filtered out), a motion-sensor module, and a notification module that sets up the live-workout notification and returns you to the running workout when tapped.
- **GPS workout recorder.** Run/walk tracking with auto-pause, km splits, top speed with GPS-spike filtering, and a share card. Raw routes and coordinates never leave the phone; only a daily summary is sent.
- **Daily missions with on-chain rewards.** Hit 8,000 steps or a 1 km / 10-minute workout, and the backend checks the summary and signs a 164-byte attestation. The Anchor program verifies the attestation, pays tSKR test tokens and XP that level up your running shoe, and blocks a second claim per wallet per UTC day with a receipt PDA.
- **Free achievement NFTs.** Milestones such as "First 5K" mint Metaplex Core collectibles to the player's wallet at no cost.
- **Engagement layer.** Activity history (week/month/year), personal bests, weekly step tournaments (Arena), partner events with staff check-in, a public player gallery, and species story cards for the wildlife shoe series.
- **Polish for real use.** Full English and Traditional Chinese UI, plain-language error messages (offline, timeout, chain busy) instead of stack traces, and release builds tested on a Seeker (Android 16, Seeker Wallet).

Verified on a Seeker on devnet with real transactions, for example the 2026-10-06 6.41 km run claim: `3aPL5GD9GHZ2q969U68WBoqrK8o66vQRgipwmzi5iLKJ5tieqzJEm5DWt5FD9qK7YDYe21Di21kp5bdU16JTPHNM`. The full evidence, including tests (762 app, 279 backend, plus LiteSVM program tests), is in `docs/evidence/` in the repo.

---

## Q2. SKR integration

> Yes. SKR is the payment token for optional achievement cosmetics. Movement earns the achievement; SKR lets you choose how to show it off. SKR never buys XP, rewards, rankings or eligibility.

**What is built:** the **Genesis Mint frame**, a gold collectible frame for your "First 5K" achievement card, bought with SKR. The full flow works on a Seeker:

1. **Eligibility is checked on the server.** The backend only offers the item after the wallet has a verified First 5K achievement. The app cannot unlock it on its own.
2. **Order.** The backend creates an order bound to the wallet, item, version, fixed price (2.5 SKR), mint, recipient and expiry. The app checks the balance first.
3. **Payment through MWA.** The wallet signs and sends a `transferChecked` SPL transfer, so the token decimals are checked on-chain.
4. **Verification on the server.** The backend confirms the transaction's network, success status, mint, sender, amount received, recipient account and a unique order reference. One payment cannot redeem two orders. The receipt and the item are written in a single database step.
5. **Ownership.** The card shows OWNED and the frame can be turned on. If the app closes mid-payment, the order can be looked up again, so the user is never charged twice.

Automated tests cover the wrong mint, wrong network, replays, someone else's payment, double taps and RPC failures.

**Status, stated plainly:** the flow is verified on **devnet with a test SKR mint**. On-chain proof (2026-10-01, 2.5 TEST SKR): `5wqCxqKXBmQzbWu4ZVtwoJ6rbtB5gCgLdpP6bCtLoPc8ymScvKZ6mszqqq4JaScsrvQ482haVLYFFToamoS7cEnF`. Mainnet uses the same code path: the backend already defaults to the official SKR mint (`SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`) on mainnet and refuses to start with any other mint. Switching is a configuration change. A live mainnet purchase has not been made yet.

**Why this design:** SKR gets a real, repeatable use inside an everyday habit. Each new achievement, shoe series or route theme can add a new cosmetic. Because cosmetics never change the game, rewards stay fair.

**Roadmap (not built, not part of this submission):** optional SKR staking that adds a small boost to mission rewards by shoe level, with 10% of each boost going to a separately tracked wildlife conservation pool. Rates are not final, and no returns are promised.

---

## 可直接貼的純文字版（10/11）

提交表單是純文字輸入框，上方草稿的 `**`、反引號會原樣顯示。**請貼這兩段**（內容與上方相同，只拿掉 Markdown 符號）。Q1 約 2,380 字元、Q2 約 2,310 字元。

### Q1（New mobile development）

```
NeonShift was built from scratch for this hackathon (first commit 2026-09-09). Everything below is new and runs on a Solana Seeker today.

NeonShift is a native Android app for the Seeker that turns daily running, walking and step goals into on-chain "clock-in" missions. All of it is new work for CLOCK IN:

• Mobile-first wallet flow. Mobile Wallet Adapter connect plus Sign-In With Solana, with cancel and timeout handling, account switching with data kept separate per wallet, and a clear "no compatible wallet" state. Each claim is approved with a short, human-readable message in the wallet (mission, UTC day, expiry, domain), not raw bytes.
• Native sensor modules (Kotlin). Three custom Expo modules: Health Connect step reading that keeps only device-recorded steps (manual and third-party entries are filtered out), a motion-sensor module, and a notification module that sets up the live-workout notification and returns you to the running workout when tapped.
• GPS workout recorder. Run/walk tracking with auto-pause, km splits, top speed with GPS-spike filtering, and a share card. Raw routes and coordinates never leave the phone; only a daily summary is sent.
• Daily missions with on-chain rewards. Hit 8,000 steps or a 1 km / 10-minute workout, and the backend checks the summary and signs a 164-byte attestation. The Anchor program verifies the attestation, pays tSKR test tokens and XP that level up your running shoe, and blocks a second claim per wallet per UTC day with a receipt PDA.
• Free achievement NFTs. Milestones such as "First 5K" mint Metaplex Core collectibles to the player's wallet at no cost.
• Engagement layer. Activity history (week/month/year), personal bests, weekly step tournaments (Arena), partner events with staff check-in, a public player gallery, and species story cards for the wildlife shoe series.
• Polish for real use. Full English and Traditional Chinese UI, plain-language error messages (offline, timeout, chain busy) instead of stack traces, and release builds tested on a Seeker (Android 16, Seeker Wallet).

Verified on a Seeker on devnet with real transactions, for example the 2026-10-06 6.41 km run claim: 3aPL5GD9GHZ2q969U68WBoqrK8o66vQRgipwmzi5iLKJ5tieqzJEm5DWt5FD9qK7YDYe21Di21kp5bdU16JTPHNM. The full evidence, including tests (762 app, 279 backend, plus LiteSVM program tests), is in docs/evidence/ in the repo.
```

### Q2（SKR integration）

```
Yes. SKR is the payment token for optional achievement cosmetics. Movement earns the achievement; SKR lets you choose how to show it off. SKR never buys XP, rewards, rankings or eligibility.

What is built: the Genesis Mint frame, a gold collectible frame for your "First 5K" achievement card, bought with SKR. The full flow works on a Seeker:

1. Eligibility is checked on the server. The backend only offers the item after the wallet has a verified First 5K achievement. The app cannot unlock it on its own.
2. Order. The backend creates an order bound to the wallet, item, version, fixed price (2.5 SKR), mint, recipient and expiry. The app checks the balance first.
3. Payment through MWA. The wallet signs and sends a transferChecked SPL transfer, so the token decimals are checked on-chain.
4. Verification on the server. The backend confirms the transaction's network, success status, mint, sender, amount received, recipient account and a unique order reference. One payment cannot redeem two orders. The receipt and the item are written in a single database step.
5. Ownership. The card shows OWNED and the frame can be turned on. If the app closes mid-payment, the order can be looked up again, so the user is never charged twice.

Automated tests cover the wrong mint, wrong network, replays, someone else's payment, double taps and RPC failures.

Status, stated plainly: the flow is verified on devnet with a test SKR mint. On-chain proof (2026-10-01, 2.5 TEST SKR): 5wqCxqKXBmQzbWu4ZVtwoJ6rbtB5gCgLdpP6bCtLoPc8ymScvKZ6mszqqq4JaScsrvQ482haVLYFFToamoS7cEnF. Mainnet uses the same code path: the backend already defaults to the official SKR mint (SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3) on mainnet and refuses to start with any other mint. Switching is a configuration change. A live mainnet purchase has not been made yet.

Why this design: SKR gets a real, repeatable use inside an everyday habit. Each new achievement, shoe series or route theme can add a new cosmetic. Because cosmetics never change the game, rewards stay fair.

Roadmap (not built, not part of this submission): optional SKR staking that adds a small boost to mission rewards by shoe level, with 10% of each boost going to a separately tracked wildlife conservation pool. Rates are not final, and no returns are promised.
```

---

## 中文翻譯（對照用，不要貼進表單）

### Q1 新增的行動端開發

NeonShift 是為這次黑客松從零開始打造的（第一個 commit 為 2026-09-09）。以下全部是新開發的內容，今天就能在 Solana Seeker 上執行。

NeonShift 是給 Seeker 用的原生 Android App，把每天的跑步、健走與步數目標變成鏈上的「打卡」任務。以下都是為 CLOCK IN 新做的：

• 行動優先的錢包流程：Mobile Wallet Adapter 連線加上 Sign-In With Solana；處理取消與逾時、切換帳號時各錢包資料分開保存，並清楚顯示「沒有相容錢包」的狀態。每次領取都在錢包裡以簡短、可讀的訊息核准（任務、UTC 日期、到期時間、網域），而不是原始位元組。
• 原生感測模組（Kotlin）：三個自製 Expo 模組——Health Connect 步數讀取（只保留裝置本身記錄的步數，手動與第三方輸入會被濾掉）、動作感測模組，以及設定運動中通知、點通知可回到正在進行的運動的通知模組。
• GPS 運動記錄：跑步／健走追蹤，含自動暫停、每公里分段、過濾 GPS 跳點的最高速度與分享卡。原始路線與座標不離開手機，只送出每日摘要。
• 每日任務與鏈上獎勵：達到 8,000 步，或完成 1 公里／10 分鐘的運動後，後端檢查摘要並簽發 164 位元組的證明。Anchor 程式驗證證明後發放 tSKR 測試代幣與讓跑鞋升級的 XP，並用收據 PDA 阻止同一錢包在同一 UTC 日重複領取。
• 免費成就 NFT：「首次 5K」等里程碑會免費把 Metaplex Core 收藏品鑄造到玩家錢包。
• 黏著度設計：運動歷史（週／月／年）、個人最佳、每週步數錦標賽（Arena）、合作活動與工作人員簽到、公開玩家藝廊，以及野生動物跑鞋系列的物種故事卡。
• 為真實使用打磨：完整的英文與繁體中文介面；用白話說明錯誤（離線、逾時、鏈上忙碌），而不是顯示程式錯誤訊息；release 版本已在 Seeker（Android 16、Seeker Wallet）上測試。

已在 Seeker 上以 devnet 真實交易驗證，例如 2026-10-06 跑 6.41 公里的領取交易：3aPL5GD9…JTPHNM。完整證據（含測試：App 762、後端 279，另有 LiteSVM 鏈上程式測試）放在 repo 的 docs/evidence/。

### Q2 SKR 整合

有。SKR 是選購成就外觀的付款代幣。運動讓你取得成就；SKR 讓你選擇怎麼展示它。SKR 永遠買不到 XP、獎勵、排名或資格。

已完成的內容：Genesis Mint 邊框——用 SKR 購買、給「首次 5K」成就卡用的金色收藏邊框。完整流程可在 Seeker 上執行：

1. 由伺服器檢查資格：錢包有已驗證的首次 5K 成就後，後端才會提供這個商品；App 無法自行解鎖。
2. 建立訂單：後端建立綁定錢包、商品、版本、固定價格（2.5 SKR）、mint、收款人與期限的訂單；App 先檢查餘額。
3. 透過 MWA 付款：錢包簽署並送出 transferChecked 的 SPL 轉帳，代幣小數位數由鏈上核對。
4. 伺服器查驗：後端確認交易的網路、成功狀態、mint、付款人、實收金額、收款帳戶與唯一的訂單參照。同一筆付款不能兌換兩張訂單；收據與商品在同一個資料庫步驟寫入。
5. 擁有：卡片顯示 OWNED，可以開啟邊框。付款中途 App 關閉時可以重新查單，使用者不會被重複扣款。

自動測試涵蓋錯誤的 mint、錯誤的網路、重放、別人的付款、連點與 RPC 失敗。

照實說明目前狀態：這個流程是在 devnet 用測試 SKR mint 驗證的。鏈上證明（2026-10-01，2.5 TEST SKR）：5wqCxq…cEnF。主網走同一套程式：後端在主網預設就是官方 SKR mint（SKRbvo6…hW3），設成其他 mint 會拒絕啟動，切換只是設定變更。目前尚未在主網實際購買。

為什麼這樣設計：SKR 在每天的習慣裡有真實、可重複的用途。每個新成就、跑鞋系列或路線主題都能加入新的外觀。外觀永遠不改變遊戲本身，因此獎勵保持公平。

Roadmap（未實作，不屬於本次提交）：選擇性質押 SKR，依跑鞋等級為任務獎勵加上少量加成，每份加成的 10% 撥入獨立追蹤的野生動物保育基金。比率尚未定案，不保證任何收益。
