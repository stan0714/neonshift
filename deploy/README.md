# 部署設定（PG-I-07，SD 8）

`dev` 與 `demo` 原規劃使用不同的 program id、attestor 金鑰與資料庫；**本屆提交（2026-09-22 決定）demo.env 沿用 dev 的 program／tSKR／vault 與同一套後端（api.neonshift.cc）**，兩者只差 App build configuration（demo 強制無展示覆寫、https、無 DEV_ROUTE）；正式上架時再分離。
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

## 第二台 API 主機 l2（2026-09-21）

- `root@l2.neonshift.cc`（Debian 13，1 vCPU／1 GB）與 l1 共用同一個外部 PostgreSQL（`db2…:6432` pgbouncer，DATABASE_URL 與 l1 相同）；程式、systemd 單元、`/etc/neonshift/{api,signer}.env`、`keys/attestor.json` 與 l1 同構。
- 部署：`DEPLOY_HOST=root@l2.neonshift.cc deploy/l1/deploy.sh`（第一次加 `bootstrap` 並以 `NEONSHIFT_DATABASE_URL=<與 l1 相同>` 指定外部 DB）。**兩台都要部署**才能保持同版（migration 由 `schema_migrations` 去重，任一台跑過即可）。
- 與 l1 一致的值：`JWT_SECRET`（session 跨主機有效）、`OPS_TOKEN`、`METRICS_TOKEN`、`SKR_*`、rules 檔；各自獨立：`SIGNER_TOKEN`（本機 loopback 對）。
- 單例工作只在 l1：`INDEXER_ENABLED`／`RETENTION_ENABLED` 在 l2 設 false（chain_cursor 沒有跨主機鎖）。**若 l1 下線，需在 l2 改為 true 並重啟**，否則鏈上事件索引與保留清理停止。
- 導流：前端 nginx（另一台）把 `https://api.neonshift.cc` 改指 `l2.neonshift.cc:6080`（或 l1／l2 都列為 upstream）；切換前後用 `/healthz`、`/readyz`、`/v1/rules/version` 比對兩台一致。

## 前端 nginx（api.neonshift.cc）檢查清單（2026-09-22）

公網 `https://api.neonshift.cc` 延遲 10～30 s 隨機、l1／l2 直連 0.1 s 時，問題在 Cloudflare → nginx → upstream 這段。範本 `deploy/l1/nginx-api.neonshift.cc.conf`（l1＋l2 並列、IP 節點、`proxy_connect_timeout 3s`、`proxy_next_upstream`、upstream 時間紀錄）。

1. `nginx -T | grep -A4 'upstream neonshift_api'`：節點是否只有 `104.105.136.214:6080`、`104.105.147.98:6080`；沒有舊 IP、沒有主機名（主機名只在啟動時解析一次）。
2. `grep -E 'upstream timed out|connect\(\) failed|no live upstreams' /var/log/nginx/error.log | tail`：看指到哪個節點。
3. 在 nginx 主機上直接打兩台：`curl -s -o /dev/null -w '%{http_code} %{time_total}\n' http://104.105.136.214:6080/healthz`（l2 同理）；若這裡就慢，是 nginx 主機到 API 主機的網路／防火牆（`ss -tn state syn-sent` 可看卡住的連線）。
4. `proxy_connect_timeout`／`proxy_read_timeout` 是否過長；有沒有 `proxy_next_upstream off`。
5. access log 用範本的 `neonshift_upstream` 格式：`rt=`（總時間）大、`urt=`（upstream 時間）小 → 問題在 Cloudflare 或 TLS；`urt=` 也大 → 問題在 upstream／連線。
6. Cloudflare：DNS 記錄 proxied（橘雲）時，Origin 需 SSL 模式 Full；若 nginx 主機同時有 IPv6 `AAAA` 而 nginx 沒 `listen [::]:443`，會間歇失敗。
7. `nginx -t && systemctl reload nginx` 後，從外面量 10 次：`for i in $(seq 10); do curl -s -o /dev/null -w '%{http_code} %{time_starttransfer}\n' https://api.neonshift.cc/v1/rules/version; done`，應全部 < 1 s。

## 真機驗收診斷：`scripts/ops/player.sh <wallet>`

`GET /v1/ops/players/:wallet`（OPS_TOKEN；未設定時 404）回傳該錢包的運動（status／quality／review_reasons／pb_eligible）、目前 PB、里程碑解析（eligible／pending_review／device_pending）、成就狀態與 SKR 訂單／權限；不含路線、原始健康資料或 token。腳本以 ssh 於執行時讀 OPS_TOKEN，不落地。用途：回答「這筆跑步為什麼沒算首次 5 km」、「成就卡在 pending_registry 還是 approved」、「SKR 訂單為何 needs_review」。

