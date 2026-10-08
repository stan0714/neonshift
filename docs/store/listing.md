# dApp Store 上架素材（PG-D-02，BRD 14）

> 依 Solana Mobile dApp Store Publisher Portal 欄位整理；提交當日以官方表單為準。所有文案不得暗示 tSKR 有金錢價值或等同官方 SKR。

## 基本資料

| 欄位 | 內容 |
|---|---|
| App name | NeonShift |
| Package | `cc.neonshift.app`（送審後不可更改） |
| Publisher | NeonShift |
| Website | https://neonshift.cc |
| Privacy policy | https://neonshift.cc/privacy（`web/privacy/index.html`） |
| Support | support@neonshift.cc |
| Category | Health & Fitness／Games |
| Age rating | 16+ |
| Networks | Solana devnet（測試代幣 tSKR，無金錢價值） |
| 平台 | Android 14+，Solana Mobile Seeker 優先 |

## 短描述（≤ 80 字元）

Clock in your daily steps. Verified movement becomes onchain gear.

## 長描述

NeonShift turns your daily movement into a game you play with your wallet.

- **Daily step mission.** Hit 8,000 steps, verified through Health Connect, then approve the claim in your wallet. Rewards are tSKR, a devnet test token with no monetary value.
- **Gear that evolves.** Your starter shoe is a free gift. Every verified mission earns XP; your shoe evolves through five stages — Origin, Pulse, Phase, Surge, Zenith — and your reward multiplier rises with it. No fees, nothing to buy or burn.
- **Achievement collectibles.** Claim free Metaplex Core NFTs for each stage you reach and for milestones like your first clock-in or a 7-day streak. They live in your wallet; you only pay devnet rent.
- **Weekend Arena.** Stake tSKR, walk the weekend, and split the prize pool with the top 30%. Results are committed onchain with a verifiable settlement hash.
- **Gallery.** See where you stand, open any player's page and get inspired by their gear and badges.
- **Privacy first.** Raw health records never leave your phone. Only mission-day summaries reach our servers, kept for at most 30 days, and you can delete them from the app at any time. Onchain data holds no health values.

Built for Solana Mobile: Mobile Wallet Adapter sign-in, Seed Vault-compatible signing, and an onchain program you can audit.

**Known issue (Sep 2026):** Phantom on Seeker does not return signed messages to apps, so sign-in and clock-in cannot complete with Phantom. Use Seeker Wallet (or Jupiter) — the app will tell you if this happens and how to switch.

## 截圖清單（1080×2400，深色）

依 `docs/evidence/` 的 Seeker 截圖重拍正式版，全部 1080×2400 放在 [screenshots/](screenshots/)。2026-09-23 於實機補齊 Landing／打卡／Gallery／Explore（真實資料：8,789 步打卡、5.50 km 跑步、已鑄造的首次 5 km NFT）；打勾＝已有：

1. ✅ Landing：品牌、DEVNET 標示、tSKR 無金錢價值註記 → `01-landing.png`
2. ✅ Dashboard：今日步數、跑鞋與步數／運動任務卡 → `02-dashboard.png`；另有 `02b-activity.png`（Activity 儀表板）
3. ✅ 打卡完成：`CLAIMED TODAY` · Step mission +10 tSKR · Goal reached (8,789 / 8,000) → `03-clockin.png`
4. ✅ Gear：等級、XP ring、本期維持 → `04-gear.png`；收藏一覽 → `04-gear-collection.png`（Claimable 狀態待 Lv.2）
5. Arena：進行中排行榜 — **待週末賽事**（唯一未補齊）
6. ✅ Gallery 玩家頁與收藏：Lv.1 Origin、XP 100、首次 5 km NFT（5.502 km、device recorded）→ `06-gallery.png`；排行榜 → `06-gallery-list.png`
6b. ✅ Explore 探索冊：任務卡狀態、GPS 計入、進度 1/3 → `06b-explore.png`
7. ✅ Profile：權限與資料 → `07-profile.png`
8. ✅ 成就護照：4 Valid／0 Pending／0 Revoked／0 Locked，首次 5K 為 device record · public · NFT minted → `08-passport.png`（另存證據 `docs/evidence/2026-09-23-passport-first5k.png`）

## 圖示

`assets/brand/neonshift-identity-v1.png`（512×512 由此裁切；圓角由商店套用）。

## 送審前檢查

- [ ] release APK 以正式 keystore 簽章（Runbook 8），憑證指紋記錄於 `deploy/demo.env` 註解與 `web/.well-known/assetlinks.json`
- [ ] `EXPO_PUBLIC_*` 指向 demo 環境（`scripts/app/build.sh demo release`）
- [ ] 隱私政策已部署於 https://neonshift.cc/privacy 且與 App 行為一致（Profile 刪除流程、30 天保留）
- [ ] 描述與截圖不含「賺錢」「收益」等暗示金錢價值的字眼；每處提到 tSKR 皆標示測試代幣
- [ ] Publisher Portal：Publisher NFT → App NFT → Release NFT（依官方當日流程）
