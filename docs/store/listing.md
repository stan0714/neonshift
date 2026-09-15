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

Clock in your steps and sleep. Verified movement becomes onchain gear.

## 長描述

NeonShift turns your daily movement into a game you play with your wallet.

- **Two missions a day.** Hit 8,000 steps or 7 hours of sleep, verified through Health Connect, then clock in with one wallet signature. Rewards are tSKR, a devnet test token with no monetary value.
- **Gear that evolves.** Your starter shoe is a free gift. Every verified mission earns XP; your shoe evolves through five stages — Origin, Pulse, Phase, Surge, Zenith — and your reward multiplier rises with it. No fees, nothing to buy or burn.
- **Achievement collectibles.** Claim free Metaplex Core NFTs for each stage you reach and for milestones like your first clock-in or a 7-day streak. They live in your wallet; you only pay devnet rent.
- **Weekend Arena.** Stake tSKR, walk the weekend, and split the prize pool with the top 30%. Results are committed onchain with a verifiable settlement hash.
- **Gallery.** See where you stand, open any player's page and get inspired by their gear and badges.
- **Privacy first.** Raw health records never leave your phone. Only mission-day summaries reach our servers, kept for at most 30 days, and you can delete them from the app at any time. Onchain data holds no health values.

Built for Solana Mobile: Mobile Wallet Adapter sign-in, Seed Vault-compatible signing, and an onchain program you can audit.

## 截圖清單（1080×2400，深色）

依 `docs/evidence/` 的 Seeker 截圖重拍正式版：

1. Landing（品牌與 devnet 標示）
2. Dashboard：今日步數／睡眠、跑鞋、兩張任務卡
3. 打卡 sheet：驗證 → 錢包簽章 → 完成
4. Gear：等級、XP ring、My collection（Claimable 狀態）
5. Arena：進行中排行榜
6. Gallery：玩家頁與收藏
7. Profile：權限與刪除資料

## 圖示

`assets/brand/neonshift-identity-v1.png`（512×512 由此裁切；圓角由商店套用）。

## 送審前檢查

- [ ] release APK 以正式 keystore 簽章（Runbook 8），憑證指紋記錄於 `deploy/demo.env` 註解與 `web/.well-known/assetlinks.json`
- [ ] `EXPO_PUBLIC_*` 指向 demo 環境（`scripts/app/build.sh demo release`）
- [ ] 隱私政策已部署於 https://neonshift.cc/privacy 且與 App 行為一致（Profile 刪除流程、30 天保留）
- [ ] 描述與截圖不含「賺錢」「收益」等暗示金錢價值的字眼；每處提到 tSKR 皆標示測試代幣
- [ ] Publisher Portal：Publisher NFT → App NFT → Release NFT（依官方當日流程）
