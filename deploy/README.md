# 部署設定（PG-I-07，SD 8）

`dev` 與 `demo` 使用**不同**的 program id、attestor 金鑰、資料庫與 App build configuration。
每個環境一個 `<env>.env`，內容只有公開資訊與金鑰**路徑**；金鑰本身放在 `~/.config/neonshift/<env>/`，永不進 repo。

| 檔案 | 用途 |
|---|---|
| `dev.env` | 整合環境：devnet、dev program id、`api.neonshift.cc`（l1 主機，見下） |
| `demo.env` | 錄影與評審：devnet、demo program id、`api.neonshift.cc`；資料保留（目前與 dev 共用同一台主機，正式 demo 時再分離） |
| `l1/` | 後端主機 `root@l1.neonshift.cc` 的 systemd／env／nginx／bootstrap／deploy 腳本 |
| `local.env` | 本機：localnet／LiteSVM，後端 docker compose |

## 流程（依 SD 8 部署順序）

```bash
scripts/chain/keys.sh dev        # 1. 產生 admin／program／attestor 金鑰（只做一次）
scripts/chain/build.sh dev       # 2. 以 dev program id 建置（anchor build --arch v0）
scripts/chain/deploy.sh dev      # 3. anchor deploy 到 devnet
scripts/chain/token.sh dev       # 4. tSKR：mint(6)、reward vault(owner=Config PDA)、treasury、鑄造固定供給
npm --prefix tools/chain-admin run init-config -- dev   # 5. initialize_config（attestor 公鑰寫入 Config）
scripts/chain/token.sh dev fund  # 6. 撥款 200,000 tSKR 至獎勵金庫並撤銷 mint authority（BR-22）
```

完成後把輸出的 `PROGRAM_ID`／`TSKR_MINT`／`REWARD_VAULT`／`TREASURY_VAULT` 回填到 `<env>.env`，
App 與後端的 build-time 參數即由同一份檔案產生（`scripts/app/build.sh <env>`、`backend/.env`）。

## 注意

- 同一環境不得混搭：App 的 `EXPO_PUBLIC_PROGRAM_ID`／`EXPO_PUBLIC_API_URL`／`EXPO_PUBLIC_CLUSTER_ID` 與後端 `PROGRAM_ID` 必須來自同一份 `<env>.env`。
- attestor 私鑰只給後端 signer 使用；`keys.sh` 產生的 `attestor.json` 需在部署後移入 KMS／受管 secret（PG-B-10），本機檔案僅供 dev。
- 撤銷 mint authority 不可逆；`token.sh <env> fund` 會先要求確認。

## 後端主機（l1.neonshift.cc）與網站

拓撲（2026-09-14）：

| 元件 | 位置 | 說明 |
|---|---|---|
| API | `l1.neonshift.cc:6080`（`neonshift-api.service`） | `/healthz` liveness、`/readyz` DB；`APP_ENV=dev` |
| attestor signer | 同機 `127.0.0.1:6081`（`neonshift-signer.service`） | 獨立系統帳號持有 `/etc/neonshift/keys/attestor.json`；API 以 `ATTESTOR_SIGNER=http:` 呼叫 |
| PostgreSQL | 同機 `127.0.0.1:5432` | migration 由 `deploy.sh` 以 `schema_migrations` 記錄一次性套用 |
| nginx | **另一台主機** | `https://api.neonshift.cc` → `l1:6080`；範本 `l1/nginx-api.neonshift.cc.conf` |
| 靜態站 | Cloudflare Pages | `https://neonshift.cc` ← `web/`（NFT metadata、隱私政策、`assetlinks.json`、`/e/*` 落地頁） |

```bash
deploy/l1/deploy.sh bootstrap   # 第一次：安裝 Node 24／PostgreSQL、建帳號、產生 /etc/neonshift/{api,signer}.env（隨機 secret）
deploy/l1/deploy.sh             # 之後每次：rsync → npm ci → migration → 重啟 → healthz
ssh root@l1.neonshift.cc 'journalctl -u neonshift-api -f'
```

Cloudflare Pages（2026-09-15 已建立專案 `neonshift`，直接上傳、不走 Git）：

```bash
npx wrangler login                                   # 一次；若 ~/.wrangler 目錄存在，wrangler 會改讀該處，需 cp ~/Library/Preferences/.wrangler/config/default.toml ~/.wrangler/config/
npx wrangler pages deploy web --project-name neonshift --branch main --commit-dirty=true
```

預覽網址 `https://neonshift-2gd.pages.dev`；自訂網域 `neonshift.cc` 已加入專案（Pages API），DNS 需在 Cloudflare 儀表板把 `neonshift.cc` 的 A 紀錄換成 CNAME → `neonshift-2gd.pages.dev`（OAuth token 沒有 DNS 權限）。`web/_headers` 設定 `assetlinks.json`／NFT 的 Content-Type 與 CORS，`web/_redirects` 讓 `/e/<slug>` 落到 `/e/`（Pages 會把 `/e/index.html` 正規化成 `/e/`，rewrite 目標不能寫 index.html）。

秘密只在主機 `/etc/neonshift/`（root 可讀、各服務帳號唯讀），不進 repo；`OPS_TOKEN`／`METRICS_TOKEN` 需要時 `ssh root@l1.neonshift.cc 'grep -E "OPS|METRICS" /etc/neonshift/api.env'`。

## SKR 外觀付款（SKR-01～06；l1 預設停用）

在 l1 的 `/etc/neonshift/api.env` 加入後 `systemctl restart neonshift-api`（都是公開資訊，不含私鑰）：

```
SKR_ENABLED=true
SKR_NETWORK=mainnet-beta            # 或 devnet（試跑；App 標 TEST SKR）
SKR_MINT=SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3   # 主網固定官方 mint；devnet 用 scripts/chain/skr-test-mint.sh 產生
SKR_RECIPIENT=<收款錢包公鑰>          # 收款帳戶為其 SKR ATA（建議先建好，否則付款人多付租金）
SKR_GENESIS_FRAME_PRICE=2500000      # 最小單位（6 decimals；2.5 SKR）
# 可選：SKR_RPC_URL、SKR_ORDER_TTL_SEC=900、SKR_PAYMENT_GRACE_SEC=600、SKR_COMMITMENT=confirmed
```

啟動 log 會印 `SKR ready`（network／mint／decimals／recipient）；核對失敗印 `SKR 停用：…`，`/v1/me/skr/catalog` 回 `enabled=false`。

