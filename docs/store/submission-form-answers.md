# CLOCK IN 提交表單：長文答案草稿

狀態：**草稿（2026-10-07）**，待使用者確認後貼入提交表單。欄位見 [clock-in-submission §8.5](clock-in-submission.md#85-官方規則摘要2026-10-06-查)。
表單字數上限：公開 API 與條款未載明，需登入提交頁貼草稿確認。
原則：只寫已在實機或自動測試驗證過的事；devnet／tSKR／TEST SKR 明講；質押只列 Roadmap（官方規定質押整合不列入 SKR 獎）。

## 短欄位建議

| 欄位 | 建議答案 | 依據 |
|---|---|---|
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

Verified on a Seeker on devnet with real transactions, for example the 2026-10-06 6.41 km run claim: `3aPL5GD9GHZ2q969U68WBoqrK8o66vQRgipwmzi5iLKJ5tieqzJEm5DWt5FD9qK7YDYe21Di21kp5bdU16JTPHNM`. The full evidence, including tests (758 app, 279 backend, plus LiteSVM program tests), is in `docs/evidence/` in the repo.

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
