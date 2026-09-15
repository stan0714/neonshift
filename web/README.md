# neonshift.cc 靜態站

- `nft/<kind>.json`、`nft/img/<kind>.svg`：成就 NFT metadata（Metaplex JSON 標準）與圖片，由 `node tools/nft-assets/build.mjs` 產生，**不要手改**。
  kind：1～5 跑鞋（Origin／Pulse／Phase／Surge／Zenith）、101 首次打卡、102 連續 7 天、111～113 錦標賽名次。
  鏈上 `claim_collectible` 的 URI 為 `https://neonshift.cc/nft/<kind>.json`（程式常數 `COLLECTIBLE_BASE_URI`），部署後不得搬移。
- 部署：任何靜態託管（Cloudflare Pages／GitHub Pages）指向本目錄；需 `Content-Type: image/svg+xml` 與 `application/json`，允許跨域讀取（錢包／市集會直接 fetch）。
- `index.html`（繁中）／`en/index.html`（英文）：官網首頁，互相以 header 語言切換；鏈上程式相關文案（devnet、tSKR、NFT 鑄造、結算 hash）暫以註解遮蔽，公開時恢復；`brand-mark.svg` 來自 `app/assets/brand/mark.svg`。
- `privacy/`（PG-D-02）、`.well-known/assetlinks.json`（App Links）、`e/`（活動落地頁，`_redirects` 導向）。
