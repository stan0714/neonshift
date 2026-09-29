# NeonShift 程式開發文件（PG — Program Guide & Progress Tracker）

| 項目 | 內容 |
|---|---|
| 文件版本 | v0.61（自動暫停、漂移抑制） |
| 建立日期 | 2026-09-09 |
| 上游文件 | [BRD v0.6](./brd-detailed.md)、[SA v0.4](./sa.md)、[SD v0.4](./sd.md) |
| 建置流程 | [Build & Test Runbook](./build-and-test.md) |
| UI 規範 | [Style Guide v0.1](./style.md) |
| 衝刺期間 | 2026-09-10 至 2026-10-08（四週） |
| 排程基準 | 2026-10-08（官方規則快照待補）；內部提交目標 10-07，10-08 為應變緩衝 |

> **本文件是唯一的開發進度來源**。每個工作項有編號、對應設計章節、完成定義與狀態。狀態更新直接改本檔並提交，不另開試算表。

---

## 1. 使用方式

### 1.1 狀態代碼

狀態欄只能填以下六個值之一，方便機器統計。

| 代碼 | 意義 | 何時改成這個 |
|---|---|---|
| `TODO` | 未開始 | 初始值 |
| `WIP` | 進行中 | 開始實際執行工作時 |
| `REVIEW` | 待審查 | PR 已開，等人看 |
| `DONE` | 完成 | 通過完成定義的**所有**條件並已合併 |
| `BLOCKED` | 阻塞 | 被外部因素卡住，必須同時在第 8 章登記 |
| `DEFER` | 延後 | 經決議移出本次範圍 |

`DONE` 的門檻是完成定義全部達成。程式寫完但沒測過是 `WIP`，不是 `DONE`。

### 1.2 進度統計指令

```bash
# 各狀態數量
awk -F'|' '/^\| PG-[A-Z]-[0-9]/ {gsub(/[ \t]/,"",$7); print $7}' docs/pg.md | sort | uniq -c

# 完成百分比
awk -F'|' '/^\| PG-[A-Z]-[0-9]/ {gsub(/[ \t]/,"",$7); if($7!="DEFER"){t++; if($7=="DONE") d++}} END {printf "%d/%d (%.0f%%)\n", d+0, t, t ? (d+0)*100/t : 0}' docs/pg.md

# 目前阻塞項
rg '^\| PG-[A-Z]-[0-9].*BLOCKED' docs/pg.md

# 各模組進度
awk -F'|' '/^\| PG-[A-Z]-[0-9]/ {gsub(/[ \t]/,"",$2); gsub(/[ \t]/,"",$7); split($2,a,"-"); m=a[2]; if($7!="DEFER"){t[m]++; if($7=="DONE") d[m]++}} END {for (k in t) printf "%s: %d/%d\n", k, d[k]+0, t[k]}' docs/pg.md | sort

# 剩餘人天（未完成項目）
awk -F'|' '/^\| PG-[A-Z]-[0-9]/ {gsub(/[ \t]/,"",$6); gsub(/[ \t]/,"",$7); if($7!="DONE" && $7!="DEFER") s+=$6} END {printf "剩餘 %.1f 人天\n", s}' docs/pg.md
```

### 1.3 每日流程

1. 早上：看第 2 章儀表板與第 8 章阻塞登錄。
2. 開工前：把要做的項目改成 `WIP`，寫上自己的名字。
3. 開 PR：改成 `REVIEW`，PR 標題帶上 PG 編號。
4. 合併後：對照完成定義逐項確認，全過才改 `DONE`。
5. 卡住超過半天：改 `BLOCKED`，到第 8 章登記原因與需要誰協助。

### 1.4 分支與提交規範

沿用現有分支結構。

```
main                  # 穩定版，只從 dev 合併
└── dev               # 整合分支
    └── feat-<主題>    # 功能分支，一個 PG 項目一條
```

提交訊息格式：

```
<type>(<模組>): <PG 編號> <說明>

範例：
feat(chain): PG-C-05 實作 clock_in 檢查順序前 8 步
fix(backend): PG-B-10 修正 canonical bytes offset 錯誤
test(chain): PG-C-18 補齊 attestation 重放攻擊案例
```

`type` 用 `feat` / `fix` / `test` / `chore` / `docs` / `refactor`。

---

## 2. 進度儀表板

> 每日更新。數字用第 1.2 節指令產生，不要手算。

| 模組 | 項目數 | DONE | 預估人天 | 說明 |
|---|---|---|---|---|
| PG-I 基礎建設 | 8 | 0 | 6.5 | 環境、專案骨架、CI、部署 |
| PG-C 鏈上程式 | 18 | 0 | 21.5 | 含 DEFER 項，保留原估算 |
| PG-B 後端服務 | 19 | 0 | 19.5 | API、風險引擎、簽章、索引 |
| PG-A 行動 App | 23 | 0 | 28.5 | 原生橋接、畫面、交易組裝 |
| PG-D 交付物 | 6 | 0 | 6.0 | APK、素材、影片、Pitch |
| PG-G 藝廊 | 4 | 0 | 5.5 | 既有收藏與展示 |
| PG-E 合作活動 | 10 | 0 | 24.0 | 活動工作流 |
| PG-R 運動／PB | 12 | 0 | 38.0 | GPS、分圈、速度、PB；日期待排 |
| PG-M 首次紀念 | 5 | 0 | 11.5 | 里程碑、紀念 NFT；日期待排 |
| PG-V 維持遊戲 | 5 | 0 | 16.0 | 維持、降階、權限；日期待排 |
| PG-U 運動體驗／探索 | 5 | 0 | 17.0 | 新增體驗與探索冊；日期待排 |
| **合計** | **115** | **0** | **194.0** | 全部工作列估算，含 DEFER，未含緩衝 |

2026-09-15 依工作列重算；R／M／V 共 22 項、65.5 人天；本次 U 再增 5 項、17.0 人天。WIP 不代表完成；既有任務狀態保持原值。第 1.2 指令的剩餘人天排除 DONE／DEFER，與本表全項目估算口徑不同。

**人力假設**：內部提交目標前共有 20 個週一至週五日曆日，尚未扣除國定假日、請假與會議。80.5 人天是無中斷的基準估算；加入 20% review、整合與返工緩衝後約為 96.6 人天，實務上需要約 5 人全職。若只有 4 人，名目容量僅 80 人天且沒有任何風險空間，必須在第一週依第 7.1 節完成範圍變更，而不能等到第三週才砍功能。這對應 BRD Q-01。

**歷史活動增量估算（未含後續 G／R／M／V，現況以本表為準）**：上述 80.5／96.6 人天僅指原四週工作。PG-E 新增初估 24 人天，全產品初估 104.5，人天緩衝 20% 後為 125.4；不含硬體採購、活動現場人力、鏈上活動獎勵與供應商串接。不能由總人天推定可在原期限完成，需依依賴與角色重排；PG-E 狀態以各工作列為準，交付日期待確認，不擅自標為 DEFER 或把既有 M 項目移除。

**M3 容量警示**：09-30 前只有 15 個週一至週五日曆日；即使 4 人全職，未扣任何非開發時間的名目容量也只有 60 人天。M3 要求所有 M 級驗收，因此需由專案負責人在 09-10 前確認至少 5 人投入、重排依賴，或正式核准 M 級範圍變更。

### 2.1 里程碑

| 里程碑 | 日期 | 閘門條件 | 狀態 |
|---|---|---|---|
| M1 架構與健康資料 | 2026-09-16 | 實機顯示真實步數與睡眠 | TODO |
| M2 鏈上打卡 | 2026-09-23 | 實機完成打卡且同一證明重送失敗 | TODO |
| M3 功能凍結 | 2026-09-30 | 所有 M 級需求通過驗收 | TODO |
| M4 提交 | 2026-10-07 | dApp Store 提交完成 | TODO |

---

## 3. PG-I 基礎建設

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-I-01 | Monorepo 結構（app / backend / programs） | SD 2.1 | — | 0.5 | WIP | app／backend／programs 三目錄皆已建立；待合併 dev |
| PG-I-02 | 校正 Build Runbook 至 SA／SD v0.2，建置 Node.js 24 LTS、JDK 與 Android SDK 環境 | Runbook 1, SD 2.2 | — | 0.5 | WIP | Runbook v0.2、scripts/env.sh、env-check.sh、.nvmrc；本機檢查通過 |
| PG-I-03 | Expo 專案初始化、prebuild、提交 android/ | Runbook 2, 3 | C-01 | 1.0 | WIP | Expo SDK 57 初始化、套件、app.json、prebuild 並提交 android/；本機 assembleDebug 通過，未上實機 |
| PG-I-04 | CI：lint、單元測試、debug APK 產出 | SD 7 | — | 1.0 | WIP | .github/workflows/ci.yml：Rust／backend＋schema／app typecheck+jest／debug APK artifact；尚未在 GitHub 跑過 |
| PG-I-05 | 後端骨架與 PostgreSQL docker compose | SD 2.2 | — | 0.5 | WIP | package.json、docker-compose、vitest 已建；未合併 dev；2026-09-14 PostgresStore 整合測試（12，含 E-03～E-09 全流程）於 l1 PostgreSQL 17 通過（`scripts/test-db-remote.sh`），修正 2 個既有測試資料錯誤 |
| PG-I-06 | Anchor 專案骨架與 localnet 測試環境 | SD 3 | — | 0.5 | WIP | programs/ Anchor 1.2 workspace＋neonshift-core 骨架＋LiteSVM 測試；anchor build 待驗證 |
| PG-I-07 | dev／demo 分離部署腳本與 build-time 環境參數管理 | SD 8 | BR-14 | 1.5 | WIP | 2026-09-21：第二台 API 主機 l2 bootstrap＋部署（共用外部 DB、同 JWT_SECRET／SKR 設定、indexer／retention 只在 l1），deploy.sh／bootstrap.sh 支援 DEPLOY_HOST 與 NEONSHIFT_DATABASE_URL；明日前端 nginx 導流至 l2。deploy/{dev,demo,local}.env、scripts/chain/{keys,build,deploy,token}.sh、tools/chain-admin（init-config／status／set-paused／rotate-attestor）；尚未實際部署 devnet；App／後端 build-time 參數接線待做；2026-09-14 chain-admin 新增 `tournament` 子指令（create／open／lock／start／forfeit／begin／submit／settle／cancel／show，manifest 驅動，Runbook 7.6）；2026-09-14 後端已部署至 `root@l1.neonshift.cc`（port 6080、`/healthz`、隔離 signer 127.0.0.1:6081、PostgreSQL 17、systemd；`deploy/l1/`）。待：另一台 nginx 設定 `api.neonshift.cc`（範本已給）、Cloudflare Pages 指向 `web/`；2026-09-14 21:45 dev program `6MhVo…` 已部署 devnet（slot 498266589，upgrade authority=admin；on-chain IDL 上傳因餘額不足略過，IDL 以 repo 檔為準）、tSKR mint `2itshf7…`、reward vault `335bF9…`（owner=Config PDA）、treasury `3EjLT6…`、`initialize_config` 完成（attestor `TuqQMs…` 與 l1 signer 同把）。`token.sh dev fund` 已於 21:50 執行（負責人確認）：供給 1,000,000、reward vault 200,000、mint authority 已撤銷（tx `3xbok3…`） |
| PG-I-08 | 經典 SPL Token tSKR（6 decimals）建立、固定供給、撤銷 authority | Runbook 7.4, SD 1.2 | BR-22 | 1.0 | WIP | token.sh：mint 6 decimals、reward vault owner=Config PDA、固定供給 1,000,000／預撥 200,000、撤銷 mint authority；尚未在 devnet 執行；2026-09-14 mint／vault 已建於 devnet；2026-09-14 完成鑄造 1,000,000（admin ATA `3EjLT6…`）、撥 200,000 至 reward vault、mint authority 撤銷（`spl-token display`：Mint authority (not set)，tx `3xbok3…`）；BR-22 驗收證據齊 |

---

## 4. PG-C 鏈上程式

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-C-01 | Config 帳戶與 `initialize_config` | SD 3.1, 3.2 | — | 1.0 | WIP | Config、initialize_config（upgrade authority 授權、參數範圍、vault 檢查）、ConfigInitialized；LiteSVM 6 測試 |
| PG-C-02 | `update_config` / `rotate_attestor` 與 pause 流程 | SD 3.2 | BR-24 | 1.0 | WIP | set_paused／update_config（BR-24 600s 門檻）／rotate_attestor；pause 範圍定案；LiteSVM 6 測試 |
| PG-C-03 | PlayerProfile 與 `init_player` | SD 3.1 | — | 0.5 | WIP | PlayerProfile、init_player、PlayerInitialized；LiteSVM 5 測試 |
| PG-C-04 | Attestation canonical bytes 解析與 ed25519 指令驗證 | SD 3.5 | BR-14, BR-15 | 2.0 | WIP | attestation.rs 解析＋verify；完成定義 13 案例全部以 LiteSVM 覆蓋（test_clock_in）；向量 20 組 |
| PG-C-05 | `clock_in` 檢查順序主流程 | SD 3.3 | BR-03, BR-14, BR-15 | 2.0 | WIP | clock_in 16 步、19 整合測試；跑鞋隨 profile 贈與，無鑄鞋檢查 |
| PG-C-06 | 獎勵計算定點數、連續加成與每日上限 | SD 3.4 | BR-02, BR-04, BR-06 | 1.0 | WIP | reward.rs 定點數 u128、streak 推導、日額收斂；14 單元測試＋整合 |
| PG-C-07 | ClaimReceipt PDA 與重放防護 | SD 3.1 | BR-03 | 1.0 | WIP | ClaimReceipt 手動建立於步驟 10；重放 6009、6010 不留 receipt |
| PG-C-08 | XP、shoe_level、core_level 三者分離 | SD 3.1 | BR-23 | 1.0 | WIP | xp／等級（BR-34／35）；免費升級後 shoe_level 與 core_level 同值；新倍率自下次打卡生效（測試） |
| PG-C-09 | `claim_collectible`（Metaplex Core 成就 NFT，免費領取） | SD 3.2, 11A | FR-04.6 | 1.5 | WIP | 2026-09-14 完成：mpl-core crate 與 Anchor 1.2 不相容 → `src/mpl_core.rs` 手組 CreateV1 CPI（玩家自簽，不改後端代鑄）；CollectibleReceipt PDA、asset 為 PDA `["asset", wallet, kind]`（invoke_signed，App 免額外 keypair）、資格（等級／首次／連續 7 天；名次待 C-14）、`PlayerProfile.max_streak_days`（clock_in 維護，App decoder／PLAYER_PROFILE_SPACE 71 同步）、錯誤 6029／6030、事件 CollectibleClaimed；LiteSVM 載入 devnet dump `tests/fixtures/mpl_core.so` 11 案例（含 pause、重複、錯誤 program）；MVP 無 collection、update_authority = Config PDA（SD 11A 實作定案） |
| PG-C-10 | `upgrade_core` 燒毀與入庫原子性 | SD 6.1 | BR-16 | 1.0 | DEFER | 2026-09-14 專案負責人定案：升級免費，core_level 隨 XP 與 shoe_level 同步提升（clock_in 步驟 15）；無扣款／燒毀 |
| PG-C-11 | Tournament 帳戶、專用 vault、`open`／`lock`／`start_tournament` | SD 3.1, 3.2 | BR-18, BR-19, BR-22 | 1.5 | WIP | 2026-09-14 完成：`create_tournament`（實作期新增；參數驗證 6031、vault PDA owner = Tournament）、open／lock／start；lock 固定 BR-18 分組（含 B=0）、挹注 min(cap, 國庫餘額)、對帳 vault 實際餘額（6017）、人數不足轉 Cancelled 不挹注；LiteSVM 12 案例（`tests/test_tournament.rs`）；SD v0.6 |
| PG-C-12 | `join_tournament` 質押與 vault PDA | SD 3.2 | BR-22 | 1.0 | WIP | 2026-09-14 完成：TournamentEntry PDA init 擋重複、pause／時間窗（6000／6032）、token account owner／mint（6021）、餘額不足失敗；測試併入 test_tournament.rs |
| PG-C-13 | `begin_settlement`、`submit_results_batch` 與 rolling hash 驗證 | SD 3.2, 6.2 | BR-20 | 1.5 | WIP | 2026-09-14 完成：canonical entry 85 bytes + SHA-256 rolling（`tournament_math.rs`）；begin 預算退款／獎金／餘數並承諾 hash；批次以 remaining_accounts 逐筆核對 PDA、連續 rank、拒絕重複／沒收者；`tests/test_settlement.rs` |
| PG-C-14 | `settle_tournament` + `claim_prize` 與資金守恆斷言 | SD 6.2 | BR-17 | 2.0 | WIP | 2026-09-14 完成：settle 驗筆數／hash／帳面守恆／vault 實際餘額，餘數歸庫；claim_prize 與預算同源計算、累加 distributed 再斷言、不受 pause；10 人＋挹注全流程領完 vault 歸零。**分配公式為實作定案（SD 6.2），待專案負責人確認 SA-Q7／Q-09** |
| PG-C-15 | `forfeit_entry` 與證據摘要 | SD 3.2 | BR-21 | 0.5 | WIP | 2026-09-14 完成：ends_at 後、begin 前；非零 evidence（6018）、rules_version 相符（6036）、重複 6034；沒收者質押留在池中、不得排名／領獎／退款 |
| PG-C-16 | `refund_all` 賽事取消退款 | SD 3.2 | BR-19 | 0.5 | WIP | 2026-09-14 完成：lock 人數不足自動 Cancelled；新增 `cancel_tournament`（admin 隨時／任何人於 ends_at + 7 天後）歸還挹注與沒收質押；refund_all 全額退還、防重領 |
| PG-C-17 | 錯誤碼 6000-6022 與事件定義 | SD 3.6 | — | 0.5 | WIP | 2026-09-14：6000～6036 全部定義並同步 SD 3.6；事件涵蓋 Config／Player／ClockedIn／Collectible／Tournament 全生命週期 |
| PG-C-18 | 鏈上測試：單元、property、攻擊案例 | SD 7 | 全部 | 2.0 | WIP | 2026-09-14：單元 19（含 property 2,000 組守恆）＋ LiteSVM 整合 71（config 6、admin 6、player 5、clock_in 19 含 SD 7 攻擊清單、collectible 11、tournament 12、settlement 10）；`cargo test -p neonshift-core` 90 案例全綠。待補：實機 devnet 對帳、C-14 分配公式定案後的最終回歸 |

---

## 5. PG-B 後端服務

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-B-01 | Fastify 骨架、設定載入、健康檢查端點 | SD 2.2 | — | 0.5 | WIP | src/app.ts／config.ts／db.ts／errors.ts：healthz、readyz、/v1、統一錯誤格式、redact log；9 項測試 |
| PG-B-02 | 資料庫 schema 與 migration | SD 4.5 | — | 1.0 | WIP | 0001 9 表＋13 約束；0002 claim_results；0003 players.deletion_requested_at／deletion_due_at；30 天清理排程於 B-17 |
| PG-B-03 | `/auth/nonce` 與 `/auth/verify`（SIWS） | SD 4.2 | — | 1.5 | WIP | SIWS 訊息 build／parse、/auth/nonce（32B nonce 只存雜湊、5 分鐘）、/auth/verify（domain／URI／chain／statement／時效／驗簽／原子消耗）；Store 介面＋Memory／Postgres 實作；11 單元＋整合測試 |
| PG-B-04 | JWT 與 refresh session 輪替、重用偵測 | SD 4.2 | — | 1.5 | WIP | HS256 access 15 分鐘（iss／aud／sub／jti／iat／nbf／exp）、refresh 24 小時輪替＋重用偵測撤銷 family、/auth/refresh、/auth/logout（重複成功）、requireAuth 檢查 session 撤銷與玩家刪除 |
| PG-B-05 | `/auth/challenge`：claim／tournament 敏感操作的單次授權 | SD 4.2 | — | 1.0 | WIP | ChallengeService：/auth/challenge（JWT 後）、32B nonce／5 分鐘整秒、綁定 wallet／purpose／task／request_hash／expiry；verifyAndConsume 先驗簽再原子消耗；6 測試；B-11／B-14 接用 |
| PG-B-06 | 健康摘要 ingest、來源／速率／live check canonicalization、request_hash | SD 4.2, 4.3 | BR-09 | 1.0 | WIP | RFC 8785 canonicalize＋request_hash、claim zod schema（分鐘桶 step_rate_summary 定案）、來源歸因／250 每分鐘／40,000 夾限、睡眠聯集去重；Kotlin 模組改出分鐘桶；7 測試；ingest 落 health_snapshots 於 B-11 |
| PG-B-07 | 風險規則集載入，保存單調 `rules_version` 與獨立 `rules_hash` | SD 4.4 | BR-13 | 1.0 | WIP | rules/v3.json 設定檔＋zod strict schema；rules_version u16、rules_hash=SHA-256(canonical 不含自身)；寫入 rule_sets 於 B-11 |
| PG-B-08 | 硬拒絕、夾限與 live check 邊界規則 | SD 4.4 | BR-07 至 BR-10, BR-12 | 1.0 | WIP | 硬拒絕 SRC_UNATTRIBUTED／SRC_MANUAL／NO_SENSOR／LIVE_MOTION_INCOMPLETE／SLEEP_RANGE、夾限後 TASK_NOT_MET（7,999／8,000、419／420 邊界）；零步數睡眠不受步數規則影響；排除來源不整筆拒 |
| PG-B-09 | 評分規則、權重與門檻 | SD 4.4 | BR-11, BR-12 | 1.0 | WIP | freq_variance_low／no_displacement／stride／sleep_overlap 權重與門檻 60；無定位不加分（BR-11）、短暫重疊不拒（BR-12）；判定含 rules_version／hash；12 測試；資料集校準（KPI）待第三週 |
| PG-B-10 | AttestationSigner：相容 signer 與 164 bytes 組裝／測試向量 | SD 3.5, 4.6 | BR-14, BR-15 | 1.5 | WIP | AttestorSigner 介面：LocalKeypairSigner（僅 local）、HttpSignerClient（隔離 signer service，Bearer）；AttestationSigner 組 164 bytes、validate、ttl≤600、無金額；dev／demo 強制 http signer；20 組向量；KMS 選型與 signer service 部署待定 |
| PG-B-11 | `POST /attestation/claim` 端點整合 | SD 4.3 | 全部風險規則 | 1.0 | WIP | POST /attestation/claim：JWT→schema→idempotency（processing／succeeded／rejected，409 conflict）→challenge 消耗→風險判定→snapshot／decision→簽發→attestations→保存完整回應；0002 migration；8 端到端測試（重放、409、crash 恢復）；GET /rules/version |
| PG-B-12 | `GET /player/history` | SD 4.1 | — | 0.5 | WIP | GET /player/history?days≤30：本人、保留期內、最新在前，redeemed_signature 由 B-16 回填；1 端到端測試 |
| PG-B-13 | `DELETE /player/data` 與延後刪除邏輯 | SD 4.1 | BR-25 | 1.0 | WIP | DELETE /player/data：交易內撤銷 session、刪 snapshots（CASCADE）／attestations／claim_results／tournament_steps、標記 deleted_at；質押賽事延後 202＋deletion_due_at（≤30 天，B-14 接 ends_at）；刪除後重新登入視為新同意；0003 migration；3 端到端＋Postgres 整合 |
| PG-B-14 | 賽事 API：current、steps、leaderboard 與逐操作 challenge | SD 4.1, 4.2 | — | 1.0 | WIP | 2026-09-14 完成：`chain/{tournament,reader}.ts`（PDA、Tournament 解碼、ISO week_id、RPC 快取讀取）、`tournament/{schema,service,routes}.ts`；steps 走 tournament_steps challenge＋Idempotency-Key、單調不減、窗口／來源／每小時夾限；leaderboard BR-20 排序（Memory／PG 一致）；DELETE /player/data 接鏈上 entry 與 ends_at；vitest 10（含 PG 整合）；SD 4.3A |
| PG-B-15 | 排行榜、同分決勝與 settlement manifest／rolling hash | SD 4.1, 6.2 | BR-20 | 1.0 | WIP | 2026-09-14 完成：排序與決勝在 B-14；`tournament/manifest.ts` 與鏈上 `tournament_math.rs` 同編碼（85-byte canonical、SHA-256 rolling），三方向量 Python／Rust／TS 一致；`GET /tournament/{weekId}/manifest`（OPS_TOKEN）含 chain_expected_count 一致性；`ChainReader.listEntries`（getProgramAccounts）；vitest 3 |
| PG-B-16 | ChainIndexer：finalized 事件同步、orphan 回滾與 redeemed_sig 回填 | SD 2.1, 4.5 | — | 1.0 | WIP | 2026-09-14 完成：`indexer/{events,indexer,rpc,runner}.ts`；IDL 驅動事件解碼（CPI 深度追蹤）、游標分頁、confirmed 冪等寫入、finalized 升級＋projection（redeemed_sig）、orphan 標記；migration 0004 chain_cursor；INDEXER_ENABLED 同 process 啟動；vitest 3＋PG 整合 1；ClockedIn 加 max_streak_days（供 G-01） |
| PG-B-17 | 30 天保留清理排程 | SD 4.5 | BR-25 | 0.5 | WIP | 2026-09-14 完成：`retention/service.ts`（purgeExpired＋到期延後刪除）、RETENTION_ENABLED 同 process 或 `npm run retention:once`；Store purgeExpired／listDueDeletions／markDeletionDone（Memory／PG）；vitest 2＋PG 整合 1 |
| PG-B-18 | 速率限制、audit log、告警與暫停流程、可觀測性指標 | SD 4.2, 9 | — | 1.0 | WIP | @fastify/rate-limit（錢包／IP，敏感端點較低上限）、結構化稽核（不含 JWT／簽章／body）、/metrics（token）計數＋延遲直方圖、Alerts：重放 >10/日／簽發量 >3× 基線 → log＋webhook（pause 由 admin CLI 執行）；4 測試 |
| PG-B-19 | 後端測試：規則、challenge／idempotency 重放、API 整合 | SD 7 | — | 1.5 | WIP | 2026-09-14：vitest 148（規則正負案例、canonical／向量、SIWS／JWT／refresh 重用、challenge 重放、claim 冪等／409／signer crash、player 歷史／刪除、賽事 API／manifest、indexer、retention、rate-limit／alerts）＋ PostgresStore 整合 8（需 TEST_DATABASE_URL；scripts/test-all.sh 自動帶入）。待補：Testcontainers 化與 CI |

---

## 6. PG-A 行動 App

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-A-01 | 設計 token 與深色主題 | Style 18 | FR-08.4 | 1.0 | WIP | src/theme tokens（Style 4～6、15、18）、ThemeProvider、Text、Button／Chip／Surface；token 測試 |
| PG-A-02 | 導航骨架與四個 Tab | SD 5.2, Style 2 | — | 0.5 | WIP | RootNavigator／OnboardingNavigator／MainTabs 四分頁（icon+label、mint active）；各頁 Placeholder |
| PG-A-03 | Native Launch、Bootstrap Loading、Landing／Demo Preview | Style 8, 9 | — | 1.0 | WIP | BrandMark SVG、adaptive icon／splash 資產、Bootstrap 300ms/3s/10s 狀態機、Landing、Demo Preview；未實機驗證 |
| PG-A-04 | HealthConnectModule：來源歸因、aggregate 與速率摘要 | SD 5.1 | BR-05, BR-07, BR-08 | 2.5 | WIP | modules/neonshift-health Kotlin（status／extension／SPN 反射、權限、aggregate＋DataOriginFilter、來源四分類、step-rate、睡眠 end-time 歸屬）；Seeker 實測權限與讀取通過；四種來源測資與跨午夜測試待補 |
| PG-A-05 | SensorModule：20 秒引導式 live motion check 與特徵摘要 | SD 5.1 | BR-09 | 2.0 | WIP | modules/neonshift-sensors Kotlin（50 Hz、2×10 s、自相關主頻、RMS／ZCR／freq_variance、TYPE_STEP_COUNTER 增量，原始序列不出原生層）；JUnit 7＋JS 4 測試；Seeker 靜置實測 49.5 Hz；步行實測與引導 UI 待 A-13 |
| PG-A-06 | WalletModule：MWA 授權與 token 保存 | SD 5.1 | — | 1.5 | WIP | WalletService：MWA 2.0 authorize／deauthorize、SecureStore token、signMessage／signAndSendTransaction；啟動只讀本機 session（不開錢包），reauthorize 延後到首次簽章；Seeker＋Phantom 實測 |
| PG-A-07 | ApiClient、JWT 續期、challenge 簽署 | SD 4.2, 5.1 | — | 1.0 | WIP | 2026-09-21 實機：Phantom 26.6 在 Seeker 簽完 SIWS 訊息後不回傳（Phantom 端 `sol_mwa_sign_messages` 內部錯誤，三次重現；Seed Vault 已簽、後端只收到 nonce）→ App 新增 `WALLET_NO_REPLY`（登入卡／打卡失敗指引改用 Seeker Wallet、Phantom 事前提醒）、Arena 改用共用 SignInState；評審指南與商店描述加已知問題；Seeker Wallet 驗收待做。ApiClient：SIWS signIn（MWA signMessage）、SecureStore token、401 單飛 refresh 重試、authorizeClaim（request_hash＋challenge 簽章 bytes 與後端一致）、claim／history／deleteData、統一 ApiError；6 測試 |
| PG-A-08 | TaskEngine：達標判定與 UTC 日界線 | SD 5.3 | BR-01, BR-05 | 1.0 | WIP | domain/taskEngine：任務日 floor(unix/86400)、UTC 換日倒數、8,000／420 達標、SA 6.3 狀態機 reduce＋Style 7.3 CTA；8 測試；實機改時區測試待 A-12 |
| PG-A-09 | TxBuilder：ed25519 前置指令與 Anchor 指令 | SD 3.5, 5.1 | BR-14 | 2.0 | WIP | chain/attestation（164B 解析→Borsh AttestationArgs，20 組向量對得起來）、txBuilder（ed25519 自我引用 offsets、ATA idempotent、clock_in 帳戶順序、大小 <1232）；4 測試；鏈上實測待 devnet 部署 |
| PG-A-10 | ChainClient：簽章／blockhash 保存、確認與 ClaimReceipt 冪等輪詢 | SD 5.3 | — | 1.5 | WIP | ClaimSubmitter：送前查 receipt、保存 signature／blockhash／lastValidBlockHeight、逾時先查 receipt 與簽章狀態、超過高度才 expired 需新 attestation、resumePending；7 測試；飛航模式實機測試待 A-13 |
| PG-A-11 | Onboarding 四頁權限流程 | Style 10 | FR-02.5 | 1.5 | WIP | 四頁 Onboarding（Style 10.1～10.4）；Step 4 改為免費領取初階跑鞋（init_player）；Seeker 實測至 Step 4 |
| PG-A-12 | Dashboard 儀表板 | Style 11 | FR-08.1 | 1.5 | WIP | HomeScreen（Style 11）：Header／Today DataCard×2／UTC 倒數／Shoe hero／MissionCard×2／disclaimer；dashboardStore 同步 Health Connect＋鏈上 Config／Profile／餘額／receipt；Seeker 實測（截圖）；離線快取顯示待補 |
| PG-A-13 | 打卡、live motion 引導與成功特效 | Style 15 | FR-03.1, FR-08.3 | 1.0 | WIP | ClaimFlow（live motion→verifying→challenge→claim→wallet→confirm）＋ClockInSheet 各狀態文案、拒絕碼對照、成功一次 haptic；5 測試；端到端實機待 devnet 部署與後端上線 |
| PG-A-14 | Gear 頁與成就收藏領取 | Style 12 | FR-05.2 | 1.0 | WIP | 2026-09-14 完成：`GearScreen`（跑鞋 hero＋Level＋XP ring、current／next multiplier、距下一階 XP、My collection 2 欄網格 Claimed／Claimable／Locked、Claim 走 MWA 簽 `claim_collectible`、成功／拒簽／失敗 inline 狀態）；`domain/collectibles.ts`（目錄＋與鏈上 eligible() 一致的資格）、`CollectibleService`（單一 RPC 查 receipt、冪等領取）、`collectibleStore`；Jest 15 案例；Seeker 版面驗證（docs/evidence/2026-09-14-seeker-gear-*.png，程式未部署故全為 Locked）。`EXPO_PUBLIC_DEV_ROUTE=Main` 供未部署時看 tabs |
| PG-A-15 | Arena 頁三種狀態 | Style 13 | FR-06.1, FR-06.2 | 1.5 | WIP | 2026-09-14 完成：`ArenaScreen`（13.1 UTC／當地時段、質押、人數、規則、最差損失確認框；13.2 名次／步數／回報、排行榜遮罩與本人強調、Settling 標「not final」；13.3 final rank／group／領取、沒收顯示規則版本與申訴管道；Cancelled 退款；無賽事／後端錯誤／需登入三種狀態）；`chain` join／claim_prize／refund_all 指令與 Entry 解碼；`TournamentStepsCollector`（窗口逐日讀 Health Connect → 小時桶）、`TournamentService`（MWA 簽章、冪等）、`arenaStore`；ApiClient tournament 方法；Jest 12；Seeker 版面（需登入狀態）截圖。端到端待 devnet 部署 |
| PG-A-16 | 錯誤、離線與空狀態 | Style 14 | NFR 可用性 | 1.0 | WIP | 2026-09-14 完成：`OfflineBanner`（expo-network `useOnline`，tabs 頂部「offline · showing cached data」）；Home inline 狀態：Health access is off → Review access、Health data unavailable → Try again、Devnet is taking a break → Retry（說明資料／資金安全）；`InlineState` 新增 `action`／`referenceId`；後端錯誤一律帶 `request_id`，App `ApiError.requestId` → 打卡／刪除失敗顯示 Ref；Arena／Gear 空／錯誤／需登入狀態於 A-14／A-15。Jest 3（共 143）。需重建 dev client（expo-network 原生模組） |
| PG-A-17 | 跑鞋視覺五階與進化動畫 | Style 16.2 | FR-04.4 | 1.0 | WIP | 2026-09-16 更新：`RewardStage`／`EvolutionReveal`／`NftReveal`＋`nftRevealStore`；NFT 翻卡、光環、粒子與掃光（2.8 s），升等能量擴散、降等冷色收縮（1.8 s）；觀察 coreLevel，涵蓋裝備／PB／里程碑／活動 NFT，新領取成功才排隊揭曉，Reduce Motion 靜態呈現。17 項相關測試通過（2026-09-15）；待實機視覺、低階裝置流暢度及無障礙驗收。Style §25。 |
| PG-A-18 | App 測試：單元、原生、E2E | SD 7 | — | 1.5 | WIP | 2026-09-14：Jest 148（TaskEngine／UTC、attestation 向量、TxBuilder、ClaimFlow 狀態機、ClaimSubmitter 冪等、WalletService、ApiClient 續期、Health 服務、Bootstrap、onboarding、Home／Gear／Arena／Profile／Activity 畫面、離線／錯誤狀態、reveal）。待補：Android instrumented（四種 dataOrigin、權限撤銷）、Maestro E2E（需 devnet 部署） |
| PG-A-19 | Health Connect 背景同步（WorkManager）與前景補同步 | SD 5.1 | FR-02.3 | 1.0 | WIP | Kotlin HealthReader 共用＋HealthSyncWorker（WorkManager 15 分鐘、電量限制、背景權限缺失靜默結束）＋HealthCache；JS enable／disable／cache／readCached；啟動有背景權限即排程；Dashboard 先讀快取再前景同步、離線標示；4 測試；實機背景觸發待驗證 |
| PG-A-20 | Activity history 畫面與歷史 API 串接 | Style 2, 19.1 | FR-03.5 | 0.5 | WIP | 2026-09-14 完成：`/player/history` 併入 finalized ClockedIn 事件的 amount／xp／簽章與 `total_earned`；`ActivityHistoryScreen`（30 天累計收益、筆數、Onchain 比、逐筆 Onchain／Not redeemed 與 explorer 連結；空／錯誤／需登入狀態）；Home「Activity ›」次要入口；Jest 3、vitest 更新；Seeker 截圖 |
| PG-A-21 | Profile：權限、隱私、刪除資料與斷開錢包 | Style 2, 19.1; SD 5.3 | FR-01.4, BR-25 | 1.0 | WIP | Profile：錢包／後端 session、權限狀態與設定入口、隱私說明＋政策連結、刪除資料（204／202 deletion_due_at、清快取停背景）、斷開錢包（登出後端＋撤銷授權→Landing）、About；4 測試 |
| PG-A-22 | 在目前 MWA／Seeker 錢包驗證並顯示成就 NFT | Style 7.4 | FR-04.5 | 0.5 | TODO | 隨成就 NFT 恢復（FR-04.5 S） |
| PG-A-23 | App 雙語（English／繁體中文） | Style 1、BRD Q-05 | NFR 可用性 | 1.5 | WIP | 2026-09-14 完成：`app/src/i18n`（`core.ts` 極簡 t()／useT()、插值、複數；`en.ts`／`zh-TW.ts` 約 430 key，測試強制 key 一致）；expo-localization 跟隨系統語言，Profile「語言」切換系統／English／繁體中文（SecureStore 持久化）；全部畫面／元件／store 文案改走字典（含 taskEngine CTA、collectibles 名稱、五階名稱）；Jest 161（含 zh-TW 渲染）。需重建 dev client（expo-localization） |

---

## 7. PG-D 交付物

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-D-01 | keystore、簽章設定、Release APK 流程 | Runbook 8 | — | 0.5 | WIP | 2026-09-27：Seeker 測試包 versionCode 2（demo release、arm64-v8a、git eea77e0、SHA-256 `c23debb8295e93748550377fd864052e37ce0e5704f4d53fc4d05812cf6554b5`），內容含 PG-SHARE-06/07/09、PG-SEASON-04/05/06 與鏈上讀取批次／退避；簽章沿用 dev keystore，與裝置上 versionCode 1 同一把，可 `adb install -r` 保留資料。注意：線上後端尚未更新（`/v1/seasonal` 仍 404），收藏頁節日足跡會顯示讀取失敗警示，其餘功能不受影響。2026-09-22 決定：demo.env 沿用 dev 鏈上部署（program `6MhVoQ…`、tSKR `2itshf7…`、vault 同 dev），理由：api.neonshift.cc 單一後端／attestor、鏈上 config 與金庫已就緒、免重做；正式上架再分離。專案 LICENSE 採 MIT（品牌／美術／文件保留）。2026-09-22：`scripts/release/clean-build.sh` 乾淨 clone 重建 release APK 並產 `docs/evidence/<日期>-clean-build-<env>.md`（COMP-07／R01）。2026-09-21：build.sh demo release 強制 demoLevel=0／無 DEV_ROUTE／https，release-notes 加 SHA-256／versionCode／ABI／demoLevel；`scripts/release/evidence.sh` 產證據骨架（參賽計畫 §6／§8）；demo.env PROGRAM_ID 未回填待 9/23 決定。2026-09-14：build.gradle 自動讀 `keystore.properties`（gitignore）切換 release 簽章；`scripts/app/build.sh <env> release` 無 keystore 即拒絕、apksigner 驗證非 debug 簽章、輸出 release-notes.txt；Runbook 8.2 更新。待：專案負責人離線產生正式 keystore（8.1）並跑一次 demo release |
| PG-D-02 | dApp Store 素材、描述、隱私政策 | BRD 14 | NFR 隱私 | 1.5 | WIP | 2026-09-22：正式截圖 1080×2400 已備 4／7（Dashboard、Activity、Gear×2、Profile；docs/store/screenshots），Landing／打卡 sheet／Arena／Gallery 待實機；長描述加 SKR Known issue（Phantom）。2026-09-14：`web/privacy/index.html`（與實作一致：裝置端原始資料、30 天保留、刪除流程、鏈上公開資料、權限）；`docs/store/listing.md`（短／長描述、截圖清單、圖示、送審檢查表）。待：部署 neonshift.cc、正式截圖、Publisher Portal 流程 |
| PG-D-03 | Demo 影片（3 分鐘內） | BRD 14 | — | 1.5 | WIP | 2026-09-22：`demo-video.md` §8 v4 依參賽計畫 170 秒配置重排（A–E 五段，D 段 SKR 45 秒含旁白／畫面標示／No-go 替代稿）。2026-09-14：`docs/store/demo-video.md` 分鏡與旁白（8 段、≤ 3 分鐘）。待 devnet 部署後錄製 |
| PG-D-04 | Pitch 簡報 | BRD 14 | — | 1.0 | WIP | 2026-09-16：更新 `output/fundraising/NeonShift_募資簡報_中文草稿_v1.pptx`（23 頁）、產生程式、HTML 預覽、講稿與來源；加入新手指南／三種動畫、STEPN 教訓、庫存壓力與經濟保護規劃。商業實績、團隊與募資條件仍待補齊；見 `docs/store/pitch.md`。 |
| PG-D-05 | README 與架構圖 | BRD 14 | — | 0.5 | WIP | 2026-09-14：README 重寫（mermaid 架構圖、信任邊界、repo 結構、快速開始、防作弊摘要） |
| PG-D-06 | 代幣經濟模擬試算表 | BRD 8.5 | BR-02, BR-16 | 1.0 | WIP | 2026-09-16：`economics/stepn-risk-review.md`＋`tools/tokenomics/stress.mjs`／`stress.csv`，九組庫存試算與預算／守恆斷言通過；更正降低退款不等於消耗、固定供給不等於永續。未改合約與獎勵配置；經濟保護實作另見 PG-EC，DEC-03 仍 OPEN。 |

### 7.1 範圍變更規則

人力或時間不足時，不得由工程端自行弱化 M 級驗收。依下列層級處理，每次變更都要記錄核准人、日期與受影響文件。

| 層級 | 可處理範圍 | 必要動作 |
|---|---|---|
| 0 | BRD 明確排除且未被既定資料／安全契約依賴的 C 級項目 | 維持不實作，不占本期容量 |
| 1 | 可獨立移除且不影響 M 級驗收的 S 級項目 | 專案負責人核准；PG 項目改 `DEFER`，同步更新排程與 Pitch |
| 2 | 任何 M 級功能、驗收標準或安全控制 | 產品負責人正式核准；先同步 BRD／SA／SD／Style／PG 與 Pitch，再重估里程碑 |

不得把下列作法視為「無影響降級」：將五階跑鞋改成三階、降低排行榜更新頻率、簡化 live motion 摘要、改寫 settlement 協議，或移除錦標賽。它們分別改變 FR-04、FR-06、FR-07 或安全／資金守恆契約，皆屬層級 2。`submit_results_batch` 的 batch size 設為 1 也不會移除 rolling hash、連續 rank 與守恆驗證，因此不能作為有效的工期縮減方案。

---

## 8. 阻塞與待決策登錄

只有當某 PG 項目已無法繼續時才列為阻塞，並同時把該項目狀態改為 `BLOCKED`。目前尚無已阻塞項目。

| 編號 | PG 項目 | 阻塞原因 | 需要誰 | 登記日 | 解除日 |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

### 8.1 待決策

待決策不等於阻塞；到期未決且已卡住對應工作時，才新增 `BLK-*` 並更新 PG 狀態。

| 編號 | 關聯項目 | 決策內容 | 決策人 | 到期日 | 狀態 |
|---|---|---|---|---|---|
| DEC-01 | 全部 | 團隊人數、角色與至少 5 FTE 的容量安排（BRD Q-01） | 專案負責人 | 2026-09-10 | OPEN |
| DEC-02 | PG-I-08、PG-D-02 | SKR integration track 是否接受 tSKR（BRD Q-08） | **主辦方**（非專案負責人） | 2026-09-10 | **CLOSED 2026-09-29**：主辦方回覆 devnet＋tSKR 可參加評審與 SKR 獎，條件是「整合邏輯健全且清楚呈現」；但**得獎後要領 USDC，App 與 SKR 整合都必須在主網運作**。詳見當日條目 |
| DEC-03 | PG-D-06、SD 6.2 | 改以遊戲／獎勵解耦、全站已撥款預算、現金與代幣庫存分帳評估（economics/stepn-risk-review.md）；比例／結算週期／切換方案待決。降低輸家退款不是總消耗來源 | 專案負責人 | 2026-09-21 | OPEN |
| DEC-04 | PG-V-01、PG-V-02 | 睡眠停用後所有玩家被鎖 Lv4（步數 700 < Lv5 900）。2026-09-20 提案規則 v2（docs/economics/maintenance-v2.md，模擬 `simulate-v2.mjs`）：**建議 B**＝第二任務改「運動 session」+100、日上限 200、門檻不變 → Lv5＝每日步數＋每週 2～3 次運動（可留一天休息），只走步數最高 Lv4；A（運動 +50）Lv5 需每週 4 次運動；C（Lv5 改 700／7）不運動也能 Lv5。採用後需鏈上 TASK_WORKOUT=3／後端 claim 驗證／App 任務卡（估 3.0 人天） | 專案負責人 | 2026-09-22 | **DECIDED 2026-09-20：採 B**（運動 +100、上限 200、門檻不變；session ≥ 1 km 且移動 ≥ 10 分、只認 App 內 GPS 記錄）；實作見 PG-V-06 |

~~DEC-02 若判定必須整合主網官方 SKR，PG-I-08 的 tSKR 路線、SA 5.4 與鏈上金庫設計都必須重估；不得在現有四週估算內直接替換。~~
（2026-09-29 已不適用：主辦方明示提交階段不需要主網。主網改為**得獎後**的前置，工作包見當日條目。）

### 8.2 Review 發現與補充完成條件（2026-09-14）

本次只修改文件。repo 已有 attestation 模組、向量與 migration，但未見完整 App／Anchor 程式；存在程式檔不代表 PG 已完成。既有 TODO 狀態維持，需負責人提供測試與 review 證據後更新。73 項／80.5 人天仍為原估算，尚未重估下列修正成本。

| 優先級 | 關聯項目 | 必須補齊的證據／驗收 |
|---|---|---|
| P0 | PG-C-04、PG-B-10 | 保留已核對正確的 19-byte domain／164-byte layout；補 Rust／TS 對 `issued_at > not_before` 的拒絕與共用負向測試。向量比對不取代時效、安全及整合驗收 |
| P0 | PG-A-04、PG-B-06、PG-B-08 | 決定 SA-Q6 睡眠來源；零步數的合格睡眠不被步數規則拒絕。補可重算速率摘要，後端以夾限後數值檢查 7,999／8,000 步及 419／420 分鐘 |
| P0 | PG-B-02、PG-B-04、PG-B-11 | 補 refresh／logout、session 撤銷檢查、原子 challenge 消耗與完整冪等回應儲存；驗證並發、斷線、signer 成功後 crash，刪除後不得從快取取得證明 |
| P0 | PG-C-13 至 C-16 | 定案 SA-Q7／BRD Q-09，覆蓋全數沒收、空組、hash 錯誤、結算恢復、退款防重領及實際 vault 對帳；SD 6.2 未補完整前不得視為可直接交付 |
| P0 | PG-C-01、C-02、C-05、C-09 | SD 10 的初始化授權、pause 範圍、未鑄鞋打卡與 NFT 轉移政策明確且有失敗案例 |
| P1 | PG-B-02、B-13、B-17 | 依 SD 4.5 補刪除期限與所有健康衍生表清理；期限前完成刪除，禁止重新索引復原健康資料 |
| P1 | PG-A-13、PG-D-03 | KPI 區分 live motion、請求簽署與交易簽署耗時，依 BRD 15.1 實機量測 |

DEC-01、DEC-02 到期日均為 09-10，截至本次 review 已逾期但無決議紀錄，維持 OPEN，不推定核准或 BLOCKED。另將睡眠政策、賽事邊界、NFT 歸屬與 XP 參數交由專案負責人及相關工程負責人於實作前決定；決議回填 BRD／SA／SD。Core、託管、燒毀比例等既有草案仍須確認。若實際已卡住工作，依第 8 章補 BLK 並更新工作列。

---

## 9. 關鍵項目實作要點

以下十項是最容易做錯或最耗時的，額外展開。其餘項目依 SD 章節實作即可。

### PG-C-04 Attestation 驗證

**為什麼難**：整套重放防護建立在這裡，錯了不會報錯，只會靜默失效。

實作要點。從 `instructions` sysvar 取得目前 instruction index，讀取緊鄰的前一道指令並確認 program id 是 Ed25519 program。解析 offsets header，確認只有一組簽章，且 signature、public key、message 三段的 instruction index 都指向該 Ed25519 指令自身、offset 與長度都在合法邊界內。取出 message 的 164 bytes，與本指令參數重建的 bytes 逐 byte 比對。

**完成定義**

- [ ] 正常 attestation 通過
- [ ] 缺少前置指令 → 6001
- [ ] 前置指令是別的 program → 6001
- [ ] 帶兩組簽章 → 6001
- [ ] 任一 offset 指向其他 instruction 或越界 → 6001
- [ ] 公鑰不符 → 6002
- [ ] message 差一個 byte → 6003
- [ ] program_id 換成別的 → 6004
- [ ] cluster_id 換成 mainnet → 6004
- [ ] wallet 換成他人 → 6005
- [ ] 未到 not_before → 6006
- [ ] 已過 expiry → 6007
- [ ] expiry - issued_at 超過 600 → 6008

### PG-C-05 clock_in 主流程

**為什麼難**：16 步檢查的順序不可調換，且與 PG-C-06、PG-C-07、PG-C-08 交織。

**完成定義**

- [ ] 依 SD 3.3 的 16 步順序實作，順序寫成註解對照
- [ ] `task_date` 不等於鏈上目前 UTC 日序 → 6019
- [ ] 同一 attestation 重送 → 6009
- [ ] 每日額度用盡 → 6010
- [ ] 額度部分剩餘時只發放剩餘量
- [ ] reward vault、mint、收款帳戶與 token program 任一替換都被拒絕
- [ ] 事件 `ClockedIn` 含 wallet、task_date、task_type、amount、shoe_level、core_level

### PG-C-06 獎勵計算

**為什麼難**：定點數運算容易溢位或捨入方向錯誤。

**完成定義**

- [ ] 全程 u128 運算後才收斂回 u64
- [ ] 任一步驟溢位 → 6011
- [ ] Lv1 至 Lv5 五組倍率的計算結果與 BRD 8.3 表一致
- [ ] core_level 超出 Config 陣列範圍 → 6020
- [ ] 第 7 個連續任務日先套用 streak bonus；同日第二項任務不重複增加 streak
- [ ] 邊界測試：base 為 0、倍率為最大值、額度剩 1，並確認全部金額使用 tSKR 最小單位

### PG-C-14 資金守恆

**為什麼難**：這是最高等級告警項，出錯代表代幣憑空生成或消失。

**完成定義**

- [ ] `settle_tournament` 與每次 `claim_prize` 都執行守恆斷言
- [ ] 違反 → 6017
- [ ] property test：隨機 10 至 500 名參賽者、隨機名次，斷言恆成立
- [ ] `results_submitted == valid_entrant_count - forfeited_count`，final rolling hash 等於 `begin_settlement` 承諾值
- [ ] 每批只接受連續 rank，且 group 由鏈上依 rank 與鎖定 group size 推導
- [ ] 整數除法餘數歸國庫且記錄於事件
- [ ] 取消賽事的全額退款路徑同樣守恆

### PG-B-10 AttestationSigner

**為什麼難**：與 PG-C-04 必須位元組級一致，兩邊分別實作最容易對不起來。

實作要點。canonical bytes 的組裝邏輯寫成獨立模組並輸出測試向量檔案，鏈上測試直接讀同一份向量。這是避免兩邊各寫一套的關鍵做法。

**完成定義**

- [ ] 產出至少 20 組測試向量（JSON），鏈上與後端測試共用
- [ ] 使用輸出可被 Solana Ed25519 program 驗證的 KMS／HSM；若供應商不支援，改用受管 secret + 隔離 signer service
- [ ] 金鑰不進入 API process 記憶體，程式碼與設定檔無私鑰字面值，且有版本、稽核與輪替紀錄
- [ ] 簽章不包含金額欄位
- [ ] expiry 固定為 issued_at + 600 秒以內

### PG-B-08 / PG-B-09 風險引擎

**為什麼難**：門檻訂太嚴會誤傷真人，訂太鬆擋不住搖步機，只能靠資料校準。

**完成定義**

- [ ] 規則集以設定檔宣告；`rules_version` 是單調遞增 u16，canonical 設定另計 SHA-256 `rules_hash`
- [ ] 硬拒絕與夾限先於評分執行
- [ ] 每條規則有正負案例測試
- [ ] API 回應不含風險分數與門檻數值
- [ ] 每次判定寫入 `risk_decisions`，含命中規則、`rules_version` 與 `rules_hash`
- [ ] 以真人與搖步機資料集達成攔截率 ≥ 90%、誤判率 ≤ 5%

### PG-A-04 HealthConnectModule

**為什麼難**：不同 Android／Health Connect 版本的裝置來源識別方式不同，資料來源判斷寫死就會失效。

**完成定義**

- [ ] 以 `aggregate()` 讀 UTC 當日步數
- [ ] Android 14 啟動時檢查 SDK extension；不支援裝置內建步數時提供可操作的降級提示
- [ ] 睡眠以 session 結束時間歸屬任務日
- [ ] 同時支援歷史 `android` 來源與動態取得的 SPN，**無硬編碼**
- [ ] 從允許來源的 StepsRecord intervals 產生 `step_rate_summary`，用完即丟棄原始 records
- [ ] 四種來源測資：裝置內建、動態 SPN、手動輸入、第三方寫入
- [ ] 後兩者不進入獎勵計算
- [ ] 權限被拒時回傳可辨識的錯誤供 UI 引導
- [ ] 跨午夜、時區切換、夏令時間三組測試通過

### PG-A-09 TxBuilder

**為什麼難**：ed25519 前置指令的 offsets header 要手工組，與 PG-C-04 對應。

**完成定義**

- [ ] 產生的 ed25519 指令能被鏈上正確解析
- [ ] 指令順序固定為 ed25519 在前、程式指令在後
- [ ] signature、public key、message offsets 全部自我引用該 Ed25519 instruction
- [ ] 交易大小在上限內
- [ ] 與 PG-B-10 的測試向量對得起來

### PG-A-10 交易冪等

**為什麼難**：RPC 逾時後重送會造成重複扣費，是使用者最有感的 bug。

**完成定義**

- [ ] 送出前以 `(wallet, task_date, task_type)` 推導 ClaimReceipt PDA，並保存 signature、blockhash、`lastValidBlockHeight`
- [ ] RPC 逾時後先查 receipt 與原簽章，**不盲目重送 signed transaction**
- [ ] PDA 存在則視為成功並刷新餘額
- [ ] 僅在原交易確定失敗，或已超過 `lastValidBlockHeight` 且 receipt 不存在時，才取得新 attestation／blockhash 重建
- [ ] 實機測試：送出後立即開飛航模式，恢復後狀態正確

### PG-A-08 UTC 日界線

**為什麼難**：時區處理錯誤會讓使用者重複領取或無法領取。

**完成定義**

- [ ] 任務日一律 `floor(unixSeconds / 86400)`
- [ ] UI 顯示裝置時區時間並標註 UTC 換日倒數
- [ ] 手動改裝置時區後任務日不變
- [ ] 跨午夜時任務狀態正確重置

---

## 10. 週次計畫

### 第一週 09-10 至 09-16：M1

主軸是把健康資料在實機上跑通，同時把 attestation 的位元組格式定死。

| 項目 | 說明 |
|---|---|
| `PG-I-01` 至 `PG-I-06` | 校正 Runbook、完成環境與骨架 |
| `PG-A-01`, `A-02`, `A-03` | 設計系統、導航、Launch／Loading／Landing |
| `PG-A-04`, `A-05` | 兩個 Kotlin 原生模組 |
| `PG-A-11` | Onboarding 權限流程 |
| `PG-B-01`, `B-02` | 後端骨架與 schema |
| `PG-C-01` 至 `C-03` | Config、權限輪替／暫停與 PlayerProfile |
| `PG-C-04` | **提前做**，並產出測試向量 |

**PG-C-04 排在第一週是刻意的**。BRD 的 R-02 把 ed25519 驗證列為高風險，提前一週做完可以留出應變時間，也讓 PG-B-10 與 PG-A-09 有共用向量可依循。

### 第二週 09-17 至 09-23：M2

| 項目 | 說明 |
|---|---|
| `PG-I-07`, `I-08` | devnet 部署與 tSKR |
| `PG-C-05` 至 `C-08` | 打卡主流程（跑鞋隨 init_player 贈與，C-09 DEFER） |
| `PG-B-03` 至 `B-11` | 登入、challenge、風險規則、簽章與 claim 的 M2 垂直切片 |
| `PG-B-12`, `B-13` | 歷史查詢與資料刪除 API |
| `PG-B-18` | 安全限流、稽核與最小可觀測性 |
| `PG-A-06`, `A-07`, `A-08` | 錢包、API、任務判定 |
| `PG-A-09`, `A-10` | 交易組裝與冪等 |
| `PG-A-12`, `A-13` | 儀表板與打卡 |
| `PG-A-19`, `A-21` | 背景同步與 Profile／隱私控制 |

### 第三週 09-24 至 09-30：M3

| 項目 | 說明 |
|---|---|
| `PG-B-07` 至 `B-09` | 延續 M2 垂直切片，完成資料校準與 M 級 KPI 驗收 |
| `PG-C-11` 至 `C-16` | 錦標賽全套 |
| `PG-C-17` | 錯誤碼與事件定義 |
| `PG-B-14` 至 `B-17` | 賽事 API 與清理排程 |
| `PG-A-14` 至 `A-17` | Gear、Arena、狀態、視覺 |
| `PG-A-20`, `A-22` | Activity history 與錢包 NFT 顯示驗證 |
| `PG-C-18`, `PG-B-19`, `PG-A-18` | 三層測試 |
| `PG-D-06` | 經濟模擬 |

**錦標賽先寫資金守恆測試再寫實作**，這是 BRD 第三週明列的順序。

### 第四週 10-01 至 10-07：M4

| 項目 | 說明 |
|---|---|
| `PG-D-01` 至 `PG-D-05` | 全部交付物 |
| — | 告警門檻調校、Bug 修復與效能打磨，不加新功能 |

10-01 起功能凍結。第四週出現的新想法一律記錄不實作。

---

## 11. 追溯矩陣

| 需求 | PG 項目 |
|---|---|
| FR-01 錢包連線 | PG-A-06, PG-A-07, PG-A-21 |
| FR-02 健康數據 | PG-A-04, PG-A-08, PG-A-11, PG-A-19 |
| FR-03 打卡獎勵 | PG-C-04 至 C-07, PG-B-03 至 B-12, PG-A-07 至 A-10, PG-A-13, PG-A-20 |
| FR-04 跑鞋（鏈上狀態）與成就 NFT | PG-C-03, PG-C-08, PG-C-09, PG-A-14, PG-A-17, PG-A-22, PG-G-04 |
| FR-13 藝廊 | PG-G-01, PG-G-02, PG-G-03 |
| FR-05 免費升級 | PG-C-08, PG-A-14 |
| FR-06 錦標賽 | PG-C-11 至 C-16, PG-B-05, PG-B-14 至 B-16, PG-A-15 |
| FR-07 風險驗證 | PG-A-04, PG-A-05, PG-B-06 至 B-09, PG-B-19 |
| FR-08 UI | PG-A-01, PG-A-03, PG-A-12, PG-A-16 |
| NFR 安全 | PG-C-02, PG-C-04, PG-C-18, PG-B-04, PG-B-05, PG-B-10, PG-B-18, PG-B-19 |
| NFR 隱私 | PG-A-21, PG-B-13, PG-B-17, PG-D-02 |
| NFR 可觀測性 | PG-B-16, PG-B-18 |
| FR-09 活動合作／宣傳 | PG-E-01、E-02、E-03、E-09 |
| FR-10 活動報名／報到 | PG-E-03、E-04、E-05 |
| FR-11 NFC 發放／權益核銷 | PG-E-04、E-05、E-06 |
| FR-12 成績／活動歷程 | PG-E-07、E-08、E-09 |
| 活動權限／隱私／端到端驗收 | PG-E-01、E-09、E-10 |

本表用於確認每個 M 級 FR 至少對應一個 PG 項目；基礎建設與交付物則以各工作列的「對應設計」欄追溯。新增或變更需求型 PG 項目時必須同步更新本表。

---

### 11.0 PG-G 藝廊開發項目（FR-13，2026-09-14 新增）

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-G-01 | 藝廊 indexer：gallery_players／gallery_collectibles 投影與排行重算 | SD 11A、B-16 | FR-13.1 | 1.5 | WIP | 2026-09-14 完成：migration 0005、`gallery/projection.ts`（finalized only、slot 單調、(wallet, kind) 冪等）、GalleryStore（Memory／PG）；排行由索引直接查詢不需重算；vitest 1＋PG 整合 1 |
| PG-G-02 | 藝廊 API：/gallery/players、/gallery/players/{wallet}、/gallery/search | SD 11A | FR-13.1、13.2 | 1.0 | WIP | 2026-09-14 完成：三個端點（JWT、分頁 cursor、you.rank、is_you、collectibles）；不含健康數值；vitest 1 |
| PG-G-03 | App 藝廊列表與玩家頁（Style 12.1） | Style 12.1 | FR-13.1、13.2 | 2.0 | WIP | 2026-09-14 完成：`GalleryScreen`（排名／短地址／Lv／XP／收藏數、本人標 You 與名次、地址前綴搜尋、Updated 時間、Load more）、`GalleryPlayerScreen`（大跑鞋依對方等級、Lv／XP／streak／最高 streak／最近打卡日、已領取 NFT 網格、空狀態含距下一階、404「No profile yet」；不顯示健康數值）；入口：Home「Gallery」與 Arena 排行榜列；ApiClient gallery 方法；Jest 6；Seeker 截圖（需登入狀態）。NFT 圖片待 G-04 素材後改 URI 載入 |
| PG-G-04 | NFT metadata／圖片靜態託管（neonshift.cc/nft）與五階＋徽章素材 | SD 11A、Style 16.2 | FR-04.6 | 1.0 | WIP | 2026-09-14 完成：`tools/nft-assets/build.mjs` 產生 `web/nft/<kind>.json`（Metaplex JSON：name／symbol／description／image／attributes／properties.files png+svg）與 `img/<kind>.svg`＋1024px PNG fallback（rsvg-convert）；五階跑鞋幾何／色彩對齊 ShoeHero 與 Style 16.2，徽章 101／102／111～113；`web/README.md` 部署說明。待：把 `web/` 部署到 neonshift.cc（Cloudflare Pages／GitHub Pages），錢包實機顯示驗證併入 A-22 |

依賴：G-01 需 B-16 ChainIndexer；G-03 需 A-14 的收藏元件；C-09 完成前藝廊只顯示等級／XP。

### 11.1 PG-E 合作活動開發項目

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-E-01 | 合作組織、角色與活動權限模型／migration | SD 11.1、11.3 | BR-26 | 2.0 | WIP | 2026-09-14 完成：migration 0006（18 表、複合 FK、約束、樂觀鎖）、`PartnerStore`（Memory／PG）、`PartnerAuthz`（DB 推導角色、checkpoint 限定、404 防枚舉、近期登入、audit）；auth 新增 `loginAt`；vitest 4＋PG 整合 1 |
| PG-E-02 | 合作管理介面、活動生命週期與規則版本 | SD 11.1～11.3 | FR-09、BR-27、BR-33 | 3.0 | WIP | 2026-09-14 API 完成：組織（ops）／成員／活動草稿與樂觀鎖／規則版本（只增、hash）／發布與取消／活動角色／稽核；公開活動讀取不含內部資料；vitest 3（端到端）。待：合作方網頁管理介面（目前以 API 操作） |
| PG-E-03 | App 活動列表／詳情、宣傳連結與報名容量 | SD 11.1、11.2 | FR-09、FR-10、BR-28 | 3.0 | WIP | 2026-09-14 完成：後端報名／取消／隱私／歷史／宣傳彙總（原子容量、規則版本同意、來源統計；vitest 1）；App `EventsScreen`／`EventDetailScreen`（Arena 入口、App Links `/e/<slug>?source=`、Jest 4）。待實機：後端上線後走一次報名 |
| PG-E-04 | NFC／App Links、QR 備援與可選卡片綁定 | SD 11.4 | FR-11.1、FR-11.3、BR-29 | 2.5 | WIP | 2026-09-14 完成：後端 checkpoints／nfc_tags 登記、停用、補發與參加者查詢（opaque ref、不含憑證）；Manifest App Links（autoVerify）＋NDEF intent-filter＋NFC optional；`web/.well-known/assetlinks.json`（2026-09-27 修正，見下）；App `?tag=` → TagBanner（active／revoked／not_yours／unknown／需登入）；vitest 9、Jest 162。2026-09-27 修正 assetlinks：原本列的 `FA:C6:17:…` 對不上任何一把金鑰（本機 debug keystore 是 `41:2F:13:DE:…`，release 是 `C6:B8:BB:B3:…:4B:04`），第二筆還是字面佔位字串 `<RELEASE_CERT_SHA256 …>`，所以 Android 驗證一直是失敗狀態（`pm get-app-links` 顯示 `neonshift.cc: 1024`）。已改為只列 release 憑證實際指紋（由 apksigner 從 APK 取出，非手抄）；不放 debug 指紋——那等於把網址處理權委派給一把開發機上的金鑰。正式 keystore（Runbook 8.1）產出後要把它的指紋一併加入（此檔支援多筆）。部署後在裝置上 `adb shell pm verify-app-links --re-verify cc.neonshift.app` 再查狀態。待實機：部署 assetlinks 後以 NFC 標籤與 QR 驗證 |
| PG-E-05 | 現場 staff 報到、challenge 與補登稽核 | SD 11.2～11.4 | FR-10、BR-28、BR-29 | 2.0 | WIP | 2026-09-14 完成：後端報到 challenge（8 碼＋QR payload、120 秒、只存 hash、單次消耗）、staff 報到（代碼／手動補登需近期登入與理由、限授權站點、冪等、稽核）、報到清單、event-history 附報到；App `CheckInCode`（QR＋代碼＋倒數）、`StaffCheckIn`（授權站點、代碼／手動、結果）、EventDetail 入口；vitest 10、Jest 166（修正 RNTL 14 `fireEvent` 需 `await` 的既有測試）。待：相機掃描 QR（目前輸入代碼）、實機驗證 |
| PG-E-06 | 品項庫存、原子核銷、實體交付及數位徽章 | SD 11.3、11.4 | FR-11、BR-30、BR-33 | 3.5 | WIP | 2026-09-14 完成：migration 0007（claim_code）；品項建立／公開投影／對帳；原子預留（鎖 event→benefit→participant、名單／報到／截止／每人上限／庫存、冪等 key、15 分鐘保留）、數位徽章同交易發放憑證、staff 交付（只交付 reserved、重試 already、逾期 410、取消 409、稽核）、lazy 逾期釋放、活動取消釋放預留（BR-33）、對帳分狀態計數（FR-11.4）、event-history 附核銷；App `Perks`（EventDetail）與 StaffCheckIn「權益交付」模式；vitest 11、Jest 170。待：相機掃描、實機驗證、checkpoint 限定 staff 的交付站點約束 |
| PG-E-07 | CSV 成績 staging、發布與更正歷史 | SD 11.2、11.5 | FR-12.1、FR-12.2、BR-31 | 3.0 | WIP | 2026-09-14 完成：CSV v1 解析／逐列驗證（表頭、名單、狀態、單位、重複、大小上限）、staging（版本遞增、hash、預覽、錯誤）、publisher 發布（近期登入、無錯誤、更正需原因、previous_revision 鏈、稽核）；vitest csv 3＋端到端 1。待：合作方網頁介面（目前 API）、FR-12.4 webhook（S） |
| PG-E-08 | 個人成績冊與公開榜、顯示同意設定 | SD 11.2、11.5 | FR-12.3、BR-32 | 1.5 | WIP | 2026-09-14 完成：公開榜 API（只回同意者顯示名稱、主辦方名次排序、DNF／DNS／DQ 另列、標示來源）、event-history 成績版本；App `Results`（公開榜、本人成績與更正、公開同意／顯示名稱設定）；Jest 3。待：實機驗證 |
| PG-E-09 | 宣傳轉換彙總、活動保留／刪除與操作文件 | SD 11.5 | FR-09.3、BR-32 | 1.5 | WIP | 2026-09-14 完成：campaign-summary 轉換率＋CSV 匯出；migration 0008；`EVENT_RETENTION_DAYS`（180）活動個人層資料清理（保留活動／規則／稽核／彙總）；DELETE /player/data 同步清活動資料並釋放預留；Runbook 7.8 合作活動操作；vitest 1。待：Q-13／DEC-06 定案後調整天數與公開同意處置 |
| PG-E-10 | 合作試辦、實機 NFC／核銷及成績端到端驗收 | SD 11.5 | FR-09～FR-12 | 2.0 | TODO | |

估算是第一階段活動模組粗估，PG-E-04 的可選卡片派發規模依 Q-11 重估；FR-12.4 供應商 API／webhook 不含於此 24 人天，選定供應商後新增工作列並更新統計。FR-11 後續鏈上活動獎勵亦不含在初估。

**依賴與交付順序**：E-01 → E-02；E-02 與既有 wallet／session 完成後做 E-03；E-04／E-05 完成站點驗證後接 E-06；E-07 → E-08；E-09 在正式發布前完成，E-10 最後驗收。活動模組不能繞過 PG-B-04／B-11 的 session 與冪等缺口。

**新增待決追蹤**：DEC-03（BRD Q-10）試辦方／日期與是否併入黑客松，由專案負責人於排程前定案；DEC-04（Q-11）NFC 場景、載具與發放品項，由活動負責人於硬體採購／E-04 前定案；DEC-05（Q-12）成績格式、發布人及更正窗口於 E-07 前定案；DEC-06（Q-13）保留／公開政策與取消處置於正式活動發布前定案。均為 OPEN，日曆到期日待活動日期確定，沒有決議不得假裝已取得合作方同意。

**完成條件補充**：各項需附對應 FR／BR 的成功與失敗案例；E-06 必測最後一件庫存並發及 expiry／交付競態，E-07 必測錯誤單位／重複匯入／更正，E-10 需交付 NFC／QR 實機證據、工作人員操作手冊、取消／斷線流程、名單與成績公開同意流程，以及報名／報到／完賽／交付對帳。僅完成 NFC 跳頁不等於完成報到或權益發放。

## 12. 完成定義通則

除各項目自己的條件外，所有 PG 項目都要滿足下列條件才算 `DONE`；不適用時須在 PR 說明原因。

1. 對應程式碼、文件或素材已經 review，並合併進 `dev` 或指定交付位置。
2. 適用的自動化測試與驗收檢查存在且通過，CI 結果附在 PR。
3. 涉及鏈上或後端介面的變更，SD 文件已同步更新。
4. 涉及使用者可見行為的變更，已在實機驗證過。
5. 本項目新引入的 `TODO` 或 `FIXME` 已清除；確需保留者必須有獨立 PG 項目追蹤。
6. 涉及權限、個資、簽章、代幣或金庫者，已完成安全／隱私檢查表與失敗路徑測試。

---

## 13. 版本紀錄

| 版本 | 日期 | 變更 |
|---|---|---|
| v0.1 | 2026-09-09 | 初版工作拆解、里程碑與追溯矩陣 |
| v0.2 | 2026-09-09 | 對齊 BRD v0.4、SA／SD v0.2 與 Style：修正 attestation、ClaimReceipt、16 步 `clock_in`、settlement 與 signer 契約；補齊 Loading／Landing、背景同步、歷史、Profile 與 NFT 顯示；重算 73 項／80.5 人天並重整範圍與阻塞治理 |
| v0.3 | 2026-09-14 | 新增 review 缺口、補充完成條件與逾期決策提醒；不將文件修正冒充程式完成或正式產品決議 |
| v0.4 | 2026-09-14 | 新增 PG-E 10 項／24 人天；總計 83 項／104.5 人天，補活動依賴、決策與驗收，交付日期另排 |
| v0.61 | 2026-09-16 | 自動暫停（可選）＋ GPS 規則 v3 靜止漂移抑制（實機桌上 1h48 累積 4.39 km 的修正）；摘要運動／暫停時間格（Style 23.7、walk-run-tracking 4.2） |
| v0.60 | 2026-09-16 | 記錄頁：計圈零距離回饋、即時軌跡、速度曲線、GPS 精度／總時間列、可捲動（Style 23.6） |
| v0.59 | 2026-09-16 | GPS 防弊分層（模擬定位／持續超速／缺口瞬移／時鐘漂移／步態探測；後端旗標二線、自報極值、重疊與單日上限；SD 16.1）＋ 軌跡底圖趣味圖層（格線／火星／區塊鏈／太空；Style 23.5） |
| v0.58 | 2026-09-16 | 三模式動作回饋動畫（倒數／暫停／繼續／結束；Style 23.4）併入並整理（token、匯入順序、i18n 位置、模式名 key 修正） |
| v0.57 | 2026-09-16 | 三模式運動樣態（domain/modes：主指標／目標預設／自動圈／區間／配色；Style 24.6） |
| v0.56 | 2026-09-16 | 實機回饋：記錄頁運動時間（不含暫停）＋四格＋分段列表；摘要軌跡預覽（本機折線、預設開啟）；GPS 品質說明；3–2–1 倒數（Style 23.3／24.5） |
| v0.55 | 2026-09-15 | Seeker 實機：MWA／Phantom 相容修正（minContextSlot、token 撤銷重授權）；開始頁改為 NRC 版面、Home 入口區改版（Style 24.5）；起始鞋 claim 實機通過 |
| v0.54 | 2026-09-15 | devnet 程式升級至含 claim_achievement／維持週期／凍結版本（slot 498753143，649 KB，extend +120,000 bytes；鏈上位元組與本機建置 sha256 一致；舊版 PlayerProfile 0 個、registry pending 0 筆；on-chain IDL 上傳仍失敗，以 repo IDL 為準） |
| v0.53 | 2026-09-15 | PG-U-05 後端撤銷／多裝置測試（WIP，實機待驗收） |
| v0.52 | 2026-09-15 | PG-U-04 完成（WIP）：探索冊任務、領取與外觀 |
| v0.51 | 2026-09-15 | PG-U-03 完成（WIP）：模式篩選、週回顧、同類比較、分享預覽 |
| v0.50 | 2026-09-15 | PG-U-02 完成（WIP）：操作鎖、讀屏、語音／震動提示 |
| v0.49 | 2026-09-15 | PG-U-01 完成（WIP）：三模式、目標快照與開始／摘要流程 |
| v0.48 | 2026-09-15 | PG-V-05 完成（WIP）：事故凍結治理與攻擊測試 |
| v0.47 | 2026-09-15 | PG-V-04 完成（WIP）：維持儀表、收藏分區、雙榜 |
| v0.46 | 2026-09-15 | PG-V-03 完成（WIP）：歷史等級與 PB 能力快照 |
| v0.45 | 2026-09-15 | PG-V-02 完成（WIP）：鏈上維持週期、結算與遷移 |
| v0.44 | 2026-09-15 | PG-V-01 完成（WIP）：維持規則 v1 模擬與參數；新增 DEC-04 |
| v0.43 | 2026-09-15 | PG-M-04 完成（WIP）：活動留念章（報到／完賽、Lv2 報名快照、藝廊 Events） |
| v0.42 | 2026-09-15 | PG-M-03 完成（WIP）：紀念作品、Milestones 收藏與領取預覽、藝廊首次篩選 |
| v0.41 | 2026-09-15 | PG-M-01／M-02 完成（WIP）：里程碑判定與穩定 key 鑄造 |
| v0.40 | 2026-09-15 | PG-R-12 完成（WIP）：跑道模式與等效圈提示 |
| v0.39 | 2026-09-15 | PG-R-09 完成（WIP）：藝廊 PB 卡、NFT 詳情、退出藝廊、作品 |
| v0.38 | 2026-09-14 | PG-R-08 完成（WIP）：成就證明格式、registry、claim_achievement、簽發與 App 鑄造流程 |
| v0.37 | 2026-09-14 | PG-R-07 完成（WIP）：PB 分組、版本鏈與更正重算 |
| v0.36 | 2026-09-14 | PG-R-03／R-06 完成（WIP）：GPS 記錄器、本機加密軌跡、前景服務、恢復、記錄／摘要畫面 |
| v0.35 | 2026-09-14 | PG-R-04／R-05 引擎完成（WIP）：GPS 距離品質、5 秒速度、分段與圈數 |
| v0.34 | 2026-09-14 | PG-R-02 完成（WIP）：Health Connect 運動 session 匯入 |
| v0.33 | 2026-09-14 | PG-R-01 完成（WIP）：運動 session 摘要與匯入 |
| v0.32 | 2026-09-14 | PG-E-09 完成（WIP）：宣傳轉換、活動保留清理、操作文件 |
| v0.31 | 2026-09-14 | PG-E-07／E-08 完成（WIP）：成績 CSV、發布／更正、公開榜與成績冊 |
| v0.30 | 2026-09-14 | PG-E-06 完成（WIP）：品項庫存、預留／交付、數位徽章 |
| v0.29 | 2026-09-14 | PG-E-05 完成（WIP）：報到 challenge 與 staff 報到 |
| v0.28 | 2026-09-14 | PG-E-04 完成（WIP）：NFC／App Links |
| v0.27 | 2026-09-14 | PG-A-23（WIP）：App 雙語 English／繁體中文（Q-05 定案） |
| v0.26 | 2026-09-14 | PG-E-03 完成（WIP）：活動報名 |
| v0.25 | 2026-09-14 | PG-E-02 API 完成（WIP） |
| v0.24 | 2026-09-14 | PG-E-01 完成（WIP）：合作活動 schema 與授權 |
| v0.23 | 2026-09-14 | PG-D-01～D-06（WIP）：簽章、上架素材與隱私政策、Demo 腳本、Pitch 大綱、README、經濟模擬（消耗比待決） |
| v0.22 | 2026-09-14 | PG-G-04 完成（WIP）：NFT metadata／圖片素材 |
| v0.21 | 2026-09-14 | PG-G-03 完成（WIP）：App 藝廊 |
| v0.20 | 2026-09-14 | PG-G-01／G-02 完成（WIP）：藝廊投影與 API |
| v0.19 | 2026-09-14 | PG-A-20 完成（WIP）、A-18 盤點 |
| v0.18 | 2026-09-14 | PG-A-17 完成（WIP）：進化 reveal |
| v0.17 | 2026-09-14 | PG-A-16 完成（WIP）：離線橫幅、Home inline 狀態、reference ID |
| v0.16 | 2026-09-14 | PG-A-15 完成（WIP）：Arena 三種狀態 |
| v0.15 | 2026-09-14 | PG-B-17 完成（WIP）：保留清理 |
| v0.14 | 2026-09-14 | PG-B-16 完成（WIP）：ChainIndexer |
| v0.13 | 2026-09-14 | PG-B-15 完成（WIP）：結算 manifest |
| v0.12 | 2026-09-14 | PG-B-14 完成（WIP）：賽事 API |
| v0.11 | 2026-09-14 | PG-C-13～C-17 完成（WIP）：結算協議、領獎、沒收、取消退款；SD v0.7 |
| v0.10 | 2026-09-14 | PG-C-11／C-12 完成（WIP）：錦標賽建立／開放／報名／截止／開始 |
| v0.9 | 2026-09-14 | PG-A-14 完成（WIP）：Gear 頁與 My collection 領取流程、Seeker 版面驗證 |
| v0.8 | 2026-09-14 | PG-C-09 完成（WIP）：手組 Metaplex Core CPI、max_streak_days、SD v0.5 實作定案 |
| v0.7 | 2026-09-14 | 專案負責人補充：NFT 定位為免費成就收藏（跑鞋五階＋里程碑徽章，Gear 頁領取）與藝廊（全站排行＋任意玩家）；BRD FR-04.6／FR-13、SD 3.2／11A、Style 12／12.1；PG-C-09、A-14、A-22 改述並恢復 TODO，新增 PG-G-01～04（5.5 人天） |
| v0.6 | 2026-09-14 | 範圍變更（層級 2，專案負責人）：取消 NFT 鑄造，初階跑鞋隨 init_player 直接贈與、使用者不付費；升級改為免費（core_level 隨 XP 與 shoe_level 同步）；PG-C-10 DEFER；BRD FR-04.1／04.5／FR-05、D-02、Q-03、SA BR-16／23、SD 1.2／3.1／3.2／3.4／3.6／10、Style 10.4／12 同步 |
| v0.5 | 2026-09-14 | 依 feat-第一版本開發 分支現況同步狀態：PG-I-01、I-05、B-02、B-10、C-04 改為 WIP 並註記證據；未合併 dev 前不標 DONE |

## 14. 五階鞋款與優化路線補充（2026-09-14）

本次已實作五階向量結構差異、集中預覽設定與 Demo 圖鑑，新增 XP 邊界測試；未接入鏈上 XP、未完成真實升級交易。PG-C-08／PG-A-17 不因此自動標 DONE。

| 階段 | 對應工作 | 完成門檻 |
|---|---|---|
| P0 成長閉環 | PG-C-01、C-05、C-08、C-18、A-14、A-17 | BRD 17 參數部署、真實 XP／等級顯示、唯一 claim 加 XP、Core 分離與原子回滾 |
| P1 靜態精修 | PG-A-17 | 五階同視角 WebP／PNG、manifest 版本與同階 SVG fallback、24／48dp 辨識及灰階評估 |
| P2 進化動效 | PG-A-17、A-18 | 僅成功升階播放一次；切背景停止、減少動態、失敗回退及實機幀耗時驗證 |
| P3 選配 3D | 後續工作，另估 | 實機效能／記憶體預算先達標，動態按需載入；不改 XP 或 token 模型 |

門檻、XP 數值及 50 任務日滿階節奏屬新設計預設；部署前由產品確認及經濟模擬，原有人天估算尚未涵蓋精緻素材及 3D，排程須另估。預覽入口：Landing → Preview the app → 五階圖鑑。

## 15. 活動跑步與 PB NFT 工作規劃（設計待排程）

依 [活動／跑步／藝廊設計](./activity-running-gallery.md) 第 8 章，延伸既有 PG-E／PG-G。下表為待拆解工作包，未混入目前 PG 項目統計與估算，也不代表已實作；完成來源／權限與鏈上契約評估後再建立正式 PG 編號及重算人天。

| 工作包 | 需求 | 內容與依賴 | 狀態 |
|---|---|---|---|
| RUN-01 | FR-09～12、UC-21 | 活動報名→報到→成績→領取流程，承接 PG-E | 設計完成／待估 |
| RUN-02 | FR-14.1、14.2 | Health Connect session、來源矩陣、去重與距離／配速 | 設計完成／待估 |
| RUN-03 | FR-14.3 | 裝置熱量／MET 估算、體重與模型同意；先定模型適用性 | 設計完成／待估 |
| RUN-04 | FR-15.1 | PB 分組、固定距離／最遠、資料修正與重算；依賴 RUN-02 | 設計完成／待估 |
| RUN-05 | FR-15.2 | PB registry／簽發／claim_achievement／receipt；依賴 RUN-04 | 設計完成／待估 |
| RUN-06 | FR-13.5、13.6 | 藝廊／NFT 詳情／PB 櫃／公開同意，承接 PG-G | 設計完成／待估 |
| RUN-07 | FR-14.4 | 主動跑步、前景服務與最快路段；資料品質確定後開發 | 後續階段／待估 |
| RUN-08 | 全部 | 實機裝置測試、資料刪除、跨來源去重、鑄造／撤銷競態 | 設計完成／待估 |

正式交付門檻及未決事項以專章 8 為準。裝置 API、3D 藝廊與實體計時硬體不假設已獲供應商授權。第 14 章 P0「Core 分離」沿用早期提案，現應依最新免費同步升級驗收，不能恢復付費 Core。

## 16. 跑鞋遊戲性與維持制度待排工作

新增設計見 [跑鞋遊戲性設計](./shoe-gameplay.md)。本次只完成規則與追溯，未修改鏈上或啟用降級；以下工作包尚未計入現有 PG 工時／DONE 統計。

| 工作包 | 需求／依賴 | 完成條件 |
|---|---|---|
| GAME-01 | FR-16、BRD 19 | 90 天情境模擬，确认點數／活躍日、睡眠不可用、長休與回歸公平性 |
| GAME-02 | FR-16.1～3；PG-C-01／C-08 | Active／Highest／週期帳戶、遷移、bounded settlement、規則版本及原子測試 |
| GAME-03 | FR-16.4；PG-C-05／C-09、RUN-05 | 新倍率生效、歷史收藏資格、PB 達成時能力快照、活動已承諾權益 |
| GAME-04 | FR-16.1～3；PG-A-14／A-17、PG-G | Gear 維持儀表、歷史收藏、恢復條件、現役／歷史排行與倒數 |
| GAME-05 | FR-16.5；PG-C-18、索引 | 凍結治理、舊玩家遷移、多期離線、晚到 PB、升降重放與全端一致性 |

先 GAME-01 定參數，再實作鏈上／索引／UI；不能保留舊永久高倍率卻只顯示降階。此前「XP 達標立即同步升級」驗收須換成本制度，但尚未部署時不得偽稱已驗收。免費升級與成就收藏仍保留，無付費保級或 NFT 銷毀。

## 17. 首次距離與紀念 NFT 待排工作

依 [首次里程碑與紀念 NFT](./commemorative-nfts.md)。下列為設計工作包，未計入既有 PG 統計／工時，尚未實作。

| 工作包 | 需求 | 驗收重點 |
|---|---|---|
| MEM-01 | FR-17.1；RUN-02／04 | 四距離邊界、單次完成、來源分組與首筆判定 |
| MEM-02 | FR-17.3；RUN-05 | 穩定 key、registry、原子鑄造、晚到／修正／轉出不重領 |
| MEM-03 | FR-17.4；RUN-06 | 四款作品、Milestones 分類、可領取／待審與公開預覽 |
| MEM-04 | FR-17.2；PG-E | 基礎 First Finish 與活動專屬章不同資格、不同來源 |
| MEM-05 | FR-17.2；後續 | Welcome Back／週年需歷史完整性、同意及保留政策先定案 |

基礎首次章 Lv1 可領、PB 仍 Lv3，需同步 GAME-03 的能力判定及測試。第一階段不包含自訂紀念 NFT、裝置半馬／全馬認證或批次鑄造。此增補不更動免費升級及維持點。

## 18. 正式接續開發清單：GPS 運動／紀念 NFT／維持遊戲

2026-09-14 查核：原 RUN／MEM／GAME 為「待估工作包」，未有正式 PG 狀態與排程；既有 PG-A-04／A-05 不包含完整 GPS 運動記錄，PG-G 也不代表 PB／紀念 NFT 已完成。本節將工作包轉成正式 PG-R／PG-M／PG-V，納入第 1.2 統計。第 15～17 節保留作歷史需求映射，其中「未計入統計」描述由本節取代，不再重複估算。

### 18.1 PG-R 走路／跑步與 PB

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-R-01 | Workout session、來源／去重、摘要 schema 與 API | activity-running-gallery 3、7；walk-run-tracking 3 | FR-14.1、BR-37 | 3.0 | WIP | 2026-09-14 完成：migration 0009；匯入 schema／derive（估算距離需校準步長、步頻／速度上限、Active／Total 分開、PB 資格）；`/workouts/import`（≤ 50、限流、revision 去重 same／stale／superseded、tombstone）、`/me/workouts` 清單／明細／刪除、跨來源可能重複標記、player 刪除同步；App domain 映射（HC RUNNING／TREADMILL／WALKING）、importer（分批、unavailable）、`WorkoutsScreen`（Style 23.1）；vitest 6＋PG 整合 1、Jest 7。待：R-02 原生 ExerciseSession 讀取、實機 |
| PG-R-02 | Health Connect 運動、距離、活動熱量匯入及裝置矩陣 | activity-running-gallery 3、4 | FR-14.1～3 | 3.0 | WIP | 2026-09-14 完成：原生 `readExerciseSessions`（RUNNING／TREADMILL／WALKING；同來源同時段 aggregate 距離／步數／Active／Total 熱量；缺權限欄位 null＋partialPermissions；不含路線）、權限常數與 Manifest／app.json（READ_EXERCISE／DISTANCE／ACTIVE／TOTAL_CALORIES）、App 匯入流程（必要 READ_EXERCISE、拒絕不阻擋其他功能）、Runbook 6.1.1 裝置矩陣表；Jest 7。待：實機實測填矩陣（Seeker 無 session 來源，需相容 App 寫入） |
| PG-R-03 | Walking／Running GPS session、權限、前景服務與持久恢復 | walk-run-tracking 2、3 | FR-18.1、18.2 | 5.0 | WIP | 2026-09-14 完成：`WorkoutRecorder` 狀態機（單一 session、暫停／恢復／Lap、Finish 先保存再同步、同步失敗保留）、`LocalWorkoutStore`（加密軌跡、checkpoint、seq 去重、刪除清路線）、expo-location 前景服務＋TaskManager 任務、權限（FINE 使用中；不申請背景定位）、恢復（跨 process 標 interrupted 只允許結束／丟棄）、摘要同步契約（origin gps、無座標）；Manifest／app.json 權限與 expo-location plugin；隱私政策補 GPS 段落；Jest 5。待：實機（鎖屏 30 分鐘、殺 process、重開機、權限撤銷）、原生 elapsedRealtime |
| PG-R-04 | GPS 距離品質、5 秒速度／最高速度／配速引擎 | walk-run-tracking 4 | FR-18.4 | 3.0 | WIP | 2026-09-14 完成：`app/src/domain/gps/engine.ts`（GPS_RULES_VERSION 1：精度 ≤ 20 m、缺口 > 5 s 新段不補直線、跑 12／走 4 m/s 跳點、3 m 遲滯抖動、5 秒完整窗速度／最高速度、平均含暫停、coverage／gaps 品質）；固定軌跡重播 Jest 10。待：實機校準門檻（R-10） |
| PG-R-05 | 公里分段、手動圈／自訂距離圈與 Partial 末段 | walk-run-tracking 5 | FR-18.3 | 3.0 | WIP | 2026-09-14 引擎完成：splits（1,000 m／1,609.344 m，兩點間按距離比例插值、一次跨多界線、跨缺口 uncertain、末段 partial 不參與最快）、手動圈與自訂距離自動圈獨立序列（暫停禁按、零距離去重、不重設分段）、跑道等效圈 floor＋餘數；Jest 涵蓋。待：R-06 畫面（Splits／Laps 分頁） |
| PG-R-06 | 記錄畫面、暫停／結束、摘要與分圈表 | walk-run-tracking 6；Style 23 | FR-18.1～5 | 3.0 | WIP | 2026-09-14 完成：`WorkoutStart`（運動／地點／自動圈／分段單位、室內導向匯入、權限引導）、`WorkoutRecord`（跑步配速／走路速度大數字、時間距離、GPS 與暫停狀態、Lap／Pause／Resume／Finish 確認、返回鍵鎖定）、`WorkoutSummary`（統計、needs_review、同步狀態與重試、Splits／Laps／Quality 分頁、跑道等效）、Workouts 入口與恢復提示；Style 23.2；Jest 3。待：實機視覺與 30 分鐘鎖屏驗收（R-10） |
| PG-R-07 | 主辦方／裝置 PB 分組與修正重算 | activity-running-gallery 5 | FR-15.1、BR-38 | 3.0 | WIP | 2026-09-14 完成：migration 0010 `pb_revisions`；`pb/compute.ts`（候選：workout 需 pb_eligible、固定距離只用連續完整分段的最短覆蓋區間、半馬／全馬僅主辦方、最遠 ≥ 1 km；result 依距離 ≤ 1% 歸類；key＝discipline＋category＋environment＋verification_class＋timing_basis＋rules_major；Baseline → 嚴格改善）；`PersonalBestService.recompute`（冪等 sync：pb_id 穩定、previous 鏈、來源刪除／更正 → invalidated、重現恢復），觸發於匯入／刪除／成績發布；`GET /me/personal-bests`（imported_since）；App Workouts 頁 PB 區塊；vitest 5＋PG 整合 1、Jest。待：chip／gun 計時基準（成績 CSV 尚無欄位）、R-08 成就簽發 |
| PG-R-08 | PB eligibility registry、簽發、claim_achievement／receipt | activity-running-gallery 7；SD 13 | FR-15.2、BR-39、40 | 5.0 | WIP | 2026-09-14 完成：attestation-core `achievement`（NEONSHIFT_ACHIEVEMENT_V1、194 bytes、TTL 900 s、向量 10 組；TS 逐 byte一致）；鏈上 `AchievementEligibility`／`AchievementReceipt`、`set_achievement_eligibility`（admin）、`claim_achievement`（ed25519 證明＋registry revision／metadata_hash＋唯一 receipt＋Core 鑄造）、錯誤 6037～6040、LiteSVM 3；後端 migration 0011、mint-intent（穩定 ID、canonical metadata／hash、逐次公開同意、費用揭露、簽章）、ops registry 端點、撤銷同步（invalidated → revoke_pending → revoked）、indexer minted、metadata 端點、signer service 接受 194；chain-admin `sync-achievements`；App `claimAchievementInstruction`、`achievementService`、PB 區塊鑄造流程（同意 → 待核准／費用確認 → 錢包）；vitest 2＋PG 整合 1、Jest 3。**待：devnet 程式升級（600 KB，需 ≈ 3.05 SOL buffer rent；admin 1.2 SOL）**、實機鑄造、藝廊 PB 卡（R-09） |
| PG-R-09 | PB 櫃／藝廊／公開同意與保留刪除整合 | activity-running-gallery 6；Style 20 | FR-13.5、13.6 | 2.5 | WIP | 2026-09-15 完成：migration 0012 `gallery_prefs`（退出只停止展示；排行／計數／搜尋／名次排除、他人 404、本人可見；player 刪除自動隱藏）；玩家頁 `achievements` 公開投影（系列、類別、來源、Current／Historical／Invalidated、公開同意才有值）、`GET /gallery/achievements/{asset}` NFT 詳情（原達成者、鑄造日期、network、Explorer）、`/me/gallery-privacy`；12 張 PB 作品（Speed 計時環／Distance 里程弧，`web/nft/achievements/`）；App PbCard、Gallery 篩選 All／Shoes／Events／Personal best、PB 櫃連結、NFT 詳情頁、Profile 藝廊開關與「跑步歷程與 PB 櫃」入口；vitest 1＋PG 整合 1、Jest 4。待：Events 篩選（活動 NFT 未實作）、現持有人（需鏈上查詢） |
| PG-R-10 | 距離／速度／圈數、NFT 重放與實機長時間驗收 | walk-run-tracking 7；activity-running-gallery 8 | FR-14、15、18 | 4.0 | TODO | 待指派 |
| PG-R-11 | MET 熱量估算與模型／體重同意 | activity-running-gallery 4.1 | FR-14.3 | 2.0 | WIP | 2026-09-22（負責人指示「提醒使用者填體重才有數據」）：App 端 `domain/energy.ts`（2024 Adult Compendium 走路 7 級／跑步 17 級 MET 表 `compendium-2024/v1`，條目代碼與來源列於程式；總／活動熱量公式；分段優先、暫停不計）、`bodyStore`（體重只存手機 SecureStore，不上傳）、Profile「熱量估算（選填）」卡、摘要頁與 Activity 詳情無裝置熱量時顯示「≈N · 估算」，沒體重顯示 — 並提示到 Profile 填；估算不上傳、不作 PB／XP／排名。Jest 458（energy 5）。MET 數值 2026-09-22 依 pacompendium.com 核對（2024 版）；後端 `energy_method=estimated` 暫不使用 |
| PG-R-12 | 400m 跑道等效圈模式與提示 | walk-run-tracking 5 | FR-18.6 | 1.5 | WIP | 2026-09-15：開始頁跑道模式 Off／400 m／200 m／自訂（100～2000 m 整數），需「我已核對圈長」開關才可開始；`trackLapMm` 寫入 session meta、恢復沿用；引擎 `trackEquivalent()` 記錄中即時「第 N 圈＋餘數」與摘要共用，皆標「依距離估算、非實體過線」；extras `track_equivalent` 上傳。不含實體過線偵測（需實機另開）；App 206 測試 |

### 18.2 PG-M 首次與紀念 NFT

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-M-01 | 首 5K／10K／半馬／全馬、First Finish 資格判定 | commemorative-nfts 1、2 | FR-17.1、BR-46 | 2.0 | WIP | 2026-09-15：`milestones/compute.ts`（整數毫米門檻、單次不累加、裝置 5K／10K 開放、半馬／全馬 device_pending、待審／估算／手動不合格、主辦方 FINISHED＋賽事時間、同筆全馬解鎖四章同一來源、首次＝最早）；`GET /me/milestones`；vitest 5（含 §6 邊界 4,999.999／5,000…42,194.999／42,195） |
| PG-M-02 | 首次 stable key、registry／receipt、更正及終身防重領 | commemorative-nfts 4 | FR-17.3、BR-47 | 2.5 | WIP | 2026-09-22：ops 診斷端點 `GET /ops/players/:wallet`＋`scripts/ops/player.sh`（運動資格原因／PB／里程碑／成就／SKR 一次看；真機驗收用）；vitest 2。2026-09-15：migration 0013（achievements kind／milestone_key 唯一／source_*）；`achievement_id = sha256("neonshift-milestone\|wallet\|key")`；`POST /me/milestones/mint-intent`；Rust／TS category 7–11、向量 12 組、LiteSVM 通過；`reconcileMilestones`（失效撤銷、重新達標同 id 恢復、更早回填／更正不重發；已鑄造只更新來源）；藝廊投影 kind＝milestone；vitest 2＋PG 整合。待：devnet 程式升級後 sync-achievements |
| PG-M-03 | 四款紀念作品、Milestones 收藏／鑄造預覽 | commemorative-nfts 5；Style 22 | FR-17.4 | 3.0 | WIP | 2026-09-15：9 張作品（`web/nft/achievements/milestones/`，四距離 × 官方／裝置＋First Finish）；App `Milestones` 區塊（Gear 收藏；狀態 7 種、涵蓋起點、逐枚領取提示、同意 → 領取預覽逐項列出公開內容＋費用 → MWA）；藝廊「首次」篩選、首次區與 PB 分列、卡片／詳情支援里程碑；ApiClient `milestones／milestoneMintIntent`；Jest 208／208。待：實機驗證、devnet 程式升級 |
| PG-M-04 | 活動 First Finish／專屬紀念章權限與端到端驗收 | commemorative-nfts 2、3、6 | FR-17.2、BR-48 | 2.0 | WIP | 2026-09-15：migration 0014（events.badges、level_at_registration、achievements kind=event）；`eventBadges.ts`（報到章／完賽章分開、Lv2 報名快照承諾、取消／更正撤銷、同 id 恢復）；`/me/event-badges`＋mint-intent；category 12／13（Rust／TS／向量、LiteSVM 通過）；2 張通用作品；App 活動詳情 `EventBadges` 區塊與藝廊 Events 篩選；vitest 2、PG 整合、Jest 210／210。待：實機 NFC／報到／鑄造端到端驗收、主辦方 UI 設定 badges（目前僅 API） |
| PG-M-05 | 回歸／週年章、歷史涵蓋及保留政策 | commemorative-nfts 2 | FR-17.2、BR-49 | 2.0 | TODO | 待指派；第二階段 |

### 18.3 PG-V 跑鞋維持制度

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-V-01 | 90 天維持情境／經濟模擬與參數定案 | shoe-gameplay 3、4、8 | FR-16 | 2.0 | WIP | 2026-09-15：`tools/maintenance-sim/rules.mjs`（規則 v1 純函式：點數／活躍日／結算順序／缺席逐期）＋ 5 組邊界測試；`simulate.mjs` 六情境 98 天 → `docs/economics/maintenance-sim.csv`／`.md`（首次啟用 7／14／28／56 日、四期缺席 Lv5→Lv1、回歸 750→Lv4／900→Lv5 與規格一致；獎勵較舊規則 −3～18%）。**待決 DEC-04：睡眠不可用者最高 Lv4** |
| PG-V-02 | Active／Highest／週期帳戶、結算及 migration | shoe-gameplay 7；SD 14 | BR-41～43 | 5.0 | WIP | 2026-09-15：PlayerProfile ＋6 欄位（71→85）、`maintenance.rs` 純規則（與 rules.mjs 同版）、`settle_player_epochs`（任何 payer、≤ 64 期、冪等）、`migrate_player`（保留等級、當日起新週期）、clock_in 順帶結算 ≤ 8 期／6041、獎勵用結算後等級、期內點數／bitmap、`EpochSettled`／`PlayerMigrated` 事件、鞋階 NFT 依 highest；App 解碼／前置指令；indexer 投影；chain-admin migrate／settle；Rust 100 測試、Jest 211、vitest 193。待：devnet 升級＋migrate-players、實機 |
| PG-V-03 | 倍率與歷史鑄造／活動／PB 能力快照 | shoe-gameplay 5、7 | FR-16.4、BR-44 | 3.0 | WIP | 2026-09-15：migration 0015 `level_history`＋`gallery_players.highest_level`；投影 init／migrate／epoch；PB NFT 需達成日 Lv3（`LEVEL_REQUIRED`／`LEVEL_HISTORY_UNKNOWN`，回填無歷史只留私人 PB）、能力快照寫入 metadata（簽章綁定）；`/me/personal-bests.nft_eligibility`；App 顯示原因；鞋階依 highest、活動章 Lv2 快照、首次章 Lv1；vitest、PG 整合 17、Jest 211。待：實機 |
| PG-V-04 | Gear 維持儀表、歷史收藏、現役／歷史榜 | shoe-gameplay 6；Style 21 | FR-16.1～3 | 3.0 | WIP | 2026-09-15：App `domain/maintenance.ts`＋4 測試；Gear Active／Highest Chip、本期維持區塊（倒數、點數／活躍日、維持／升階／回歸差額、未遷移／待結算狀態）、收藏三區與 History 標籤（鞋階資格依歷史最高）；藝廊「現役排行／歷史成就」雙榜（後端 `board=lifetime`）；Jest 218、vitest 193。待：實機、48／24 小時提醒（通知權限未實作） |
| PG-V-06 | 維持規則 v2：運動任務取代睡眠（DEC-04 方案 B） | shoe-gameplay 3；SD 3、14；economics/maintenance-v2 | FR-16 | 3.0 | WIP | 2026-09-20：鏈上 TASK_WORKOUT=3／6045／v2 常數（LiteSVM＋單元 121 全過）、後端 claim workout＋rules v4＋migration 0018（vitest 207）、App 運動任務卡／ClaimFlow／dashboard（Jest）；2026-09-20 晚：devnet 程式已升級（slot 501254860，IDL 上鏈仍略過）、l1 已部署（migration 0018、RULES_FILE=v4、`/v1/rules/version`=4）；待實機打卡驗收（步數＋運動同日、睡眠 6045 不再出現於 UI） |
| PG-V-05 | 凍結治理、版本遷移、結算／撤銷攻擊與實機驗收 | shoe-gameplay 4、8 | FR-16.5、BR-45 | 3.0 | WIP | 2026-09-15：`IncidentFreeze` PDA＋`set_incident_freeze`（admin、視窗檢查 6044、(0,0) 清除、事件）；結算凍結期不升不降、`EpochSettled.frozen`；規則版本寫入 profile／事件、遷移保留等級；LiteSVM 攻擊／邊界（非 admin、非法視窗、重疊／非重疊期、清除後恢復、錯誤 freeze 帳戶、重送、6041、6042／6043）Rust 101；App freeze 帳戶讀取／指令帶入／Gear 提示；chain-admin `set-freeze`。待：實機驗收、devnet 升級（含 migrate-players） |

### 18.4 依賴、批次及排程狀態

已列入正式 backlog，不代表已排定日曆交付。新增共 22 項，初估 65.5 人天；未含額外風險緩衝、裝置採購、供應商 API、地圖瓦片服務、3D、實體跑道過線偵測。估算需負責人確認，不能套用原黑客松四週承諾。

| 批次 | 項目與順序 | 開發前置／交付閘門 |
|---|---|---|
| T1 資料與記錄 | R-01 → R-02／R-03 → R-04 → R-05／R-06 | 確認來源／定位政策；走路、跑步、鎖屏恢復與資料去重通過 |
| T2 PB 與里程碑 | R-07 → R-08 → R-09；R-07 → M-01；R-08 → M-02 → M-03／M-04 | 活動來源接 PG-E-07；鏈上 registry 與唯一 receipt 通過，R-10 驗收 |
| T3 維持與權限 | V-01 → V-02 → V-03 → V-04／V-05 | V-03 與 R-08／M-02 共用能力快照契約；未完成前不得開放依等級限制的新 NFT |
| T4 後續優化 | R-11／R-12／M-05 | 模型適用性、跑道提示、歷史資料同意定案；以 R-10 補驗收 |

追溯：RUN-01 沿用 PG-E；RUN-02→R-01／02；RUN-03→R-02／11；RUN-04→R-07；RUN-05→R-08；RUN-06→R-09；RUN-07→R-03～06／12；RUN-08→R-10。MEM-01～05→M-01～05，GAME-01～05→V-01～05。既有 PG-G／E 只算原功能，新增增量以上列為準。

正式上線前須確認：每項負責人、團隊可用人天、批次開始／截止日、裝置清單、最高速度品質門檻與定位隱私政策。現在均未指派／未定日期，不虛構排程完成。上述設計規格的每條驗收需映射到 PR／測試證據，完成仍依 PG 12 通則。

## 19. 運動體驗與探索遊戲增量（2026-09-15）

規格：[運動體驗與探索遊戲](./sport-experience-gameplay.md)。以下僅估新增增量，不重算 PG-R 的 GPS 引擎、PG-V 的鏈上維持及 PG-M 的 NFT。既有 WIP 狀態保留；這次只更新文件。

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-U-01 | 三模式、intent 相容、目標快照與開始／摘要流程 | sport-experience-gameplay 1、2、4 | FR-19.1、BR-55 | 3.0 | WIP | 2026-09-15：migration 0016 intent／goal_snapshot、匯入 schema 檢查（模式與分類一致、舊資料 null、跑步推導）；App 三模式＋目標開始頁、最近模式偏好與 Home 快速開始、session 固定 intent／goal、達標一次提醒不自動停止、摘要目標結果與模式標籤、歷程「走路（未指定模式）」；vitest 194、PG 整合 17、Jest 218。2026-09-15 實機：開始頁改為 NRC 版面（大目標數字／圓形 START／目標與設定底部面板）、Home 入口改主按鈕＋四格快捷（Style 24.5）；Jest 236。2026-09-16：3–2–1 倒數（可點一下略過、返回取消；震動／語音依偏好） |
| PG-U-02 | 操作鎖、大字／讀屏、可選語音與震動 | sport-experience-gameplay 3；Style 24 | FR-19.2 | 3.0 | WIP | 2026-09-15：記錄頁操作鎖（鎖定後控制列只剩長按 1.2 s 解鎖、鎖定時放行系統返回）、讀屏標籤（狀態、數字含單位、按鈕用途）、主數字 maxFontSizeMultiplier 1.6、定位失效不展示舊速度＋缺口提示；`WorkoutCues`（每公里／自訂圈語音 expo-speech／震動，預設關閉、手動圈不播、背景／通話不搶播不補播）與開始頁開關；Jest 220。待：實機（TalkBack、通話中斷、大字） 2026-09-16 動作動畫第二輪精修：三種 SVG 人物姿態、模式專屬完成徽記／跑步衝線帶、分段光暈、繼續文案、2.2s 回饋及淡出；Style 23.4，型別與相關 22 測試通過；實機驗收未完成。 |
| PG-U-03 | 模式篩選、週回顧、同類比较及分享預覽 | sport-experience-gameplay 4 | FR-19.3、BR-59 | 3.0 | WIP | 2026-09-15：`domain/review.ts`（走路＋健走合看 walking、本地週一週回顧標時區且與鏈上 UTC 週期分開、同類比較同 sport／環境／來源等級且 < 3 筆不比、分享文字預設無日期／精確時間／錢包／座標）；Workouts 清單篩選＋週回顧卡；摘要頁同類回顧卡與分享預覽（模式／配速／日期開關）；Jest 225。待：實機分享面板 |
| PG-U-04 | 任務模板、接受／領取、去重與探索冊外觀 | sport-experience-gameplay 5；SD 17 | FR-19.4、BR-56、57 | 5.0 | WIP | 2026-09-15：migration 0017（模板／enrollment／contribution／receipt／外觀權限）、`QuestService`（接受快照與週界、10 分鐘／待審／GPS 版本門檻、同日去重、拆分不累加、48h 晚到、撤銷／恢復、錢包刪除）、`/me/quests` 三端點；App 探索冊畫面與 Home 入口；vitest 200（quests 6）、PG 整合 18、Jest 230。GPS 活動獎勵由 `QUEST_GPS_MIN_RULES_VERSION` 開關（R-10 定案後設定） |
| PG-U-05 | 刪除／更正撤銷、多裝置重試及實機體驗驗收 | sport-experience-gameplay 7 | FR-19.5、BR-58 | 3.0 | WIP | 2026-09-15（後端部分）：刪除／更正撤銷與同 receipt 恢復、同來源重送與第二裝置同 external_record_id 不重複、revision 更正沿用貢獻（vitest quests 7）；離線保存與重試沿用 R-03；歷史收藏與鞋階權限分開（外觀非 NFT）。待：實機體驗驗收（開始到保存成功率、誤觸率、任務參與率） |

新增 5 項，初估 17.0 人天（未含緩衝），需負責人確認；尚無交付日期，不加入原四週承諾。U-01 依賴 R-01／R-03／R-06，U-02／03 接 U-01；U-04 在 R-10 品質規則定案後才可開放獎勵，U-05 驗收全流程後發布。三模式與目標可先交付，探索獎勵由獨立功能開關控制。小隊／跑走交替／走路 NFT 不在本次估算內，另行拆項。

## 20. 新手導覽、揭曉動畫與經濟保護增量（2026-09-16）

本節同步 2026-09-15 的程式與分析成果。WIP 表示尚未通過完整實機驗收；TODO 為規劃，未部署。既有獎勵規則未因分析而變更。追溯：Style §25、SD §18、BRD「2026-09-16 增量」、[經濟風險評估](./economics/stepn-risk-review.md)。

| 編號 | 名稱 | 優先序 | 狀態 | 已完成／驗收與依賴 |
|---|---|---|---|---|
| PG-UX-01 | 首次遊戲說明與重看入口 | P1 | WIP | GameGuideScreen：歡迎頁開始冒險 → 指南 → 錢包設定，可直接略過；Profile 重看返回原頁。四大玩法＋首次四步、繁中／英文。型別檢查及指南／i18n／onboarding／profile／launch／smoke 共 23 測試通過（2026-09-15）；待小螢幕、大字、TalkBack 與首次理解度實測 |
| PG-EC-01 | STEPN 對照、庫存與預算模型 | P0 | WIP | 分析與九組試算完成；現金／留存／作弊與流動性情境待取得資料。現有 30 天模擬不代表長期保證 |
| PG-EC-02 | 打卡成長與經濟獎勵拆分 | P0 | TODO | 金庫為零仍可記 XP／維持點／streak；獨立領獎 receipt；需合約、attestation、App、防重放及舊紀錄切換共同設計 |
| PG-EC-03 | 全站期間預算與公平分配 | P0 | TODO | 期前撥款、版本快照、期末合格分數、個人封頂、餘數留庫、逾期／撤銷規則；10 倍帳號及併發下總發放不超預算；依賴 EC-02 與 DEC-03 |
| PG-EC-04 | 對帳、準備金與告警 | P0 | TODO | 區分可用庫存／承諾未領／回流／再發／永久燒毀／現金支出；不得將自家幣市值當獎品足額準備；依賴 EC-03 |
| PG-EC-05 | 反作弊、收入及無獎金留存驗證 | P1 | TODO | Sybil 與誤判申訴、D7／D30 對照、收入歸零與獎品集中兌換壓力、贊助實收後承諾獎品；不可撤回既有承諾 |

未提供新增人天、負責人及交付日期；不併入原四週工期。動畫沿用 PG-A-17，不重算一份交付。主網與可交易收益方案須在經濟保護與真實需求驗收後另行評估。

## 21. 歷屆得獎作品借鏡與行動差異化（2026-09-16）

規格與官方來源：[行動差異化設計](./mobile-differentiation.md)。主張為「真實運動 → 可操作任務卡 → 有來源的成就護照 → 現場權益」，不是複製押幣或產幣遊戲。以下全部 **TODO**；研究／規劃完成不等於功能完成。

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-XD-01 | 可操作任務卡與目標續接 | mobile-differentiation 4.1 | FR-20.1 | 3.0 | WIP | 2026-09-22：後端 `/me/quests` 加 `card`（來源／難度／要求／獎勵／開始目標）與 `card_state`（accepted／in_progress／pending_verification／claimable…；待審筆數 `pending_review_count`）；App `QuestCard`（Style 24.7）、「以這個目標開始」→ `WorkoutStart` preset（不覆寫進行中 session，改「回到記錄」）、離線快照 `questCacheStore`；重複接受回既有 enrollment（原 U-04）。vitest 8（quests）、Jest 446（questCard 5、workoutScreens 2）；待實機：大字／TalkBack、真實接受→開始→同步→可領 |
| PG-XD-02 | 運動不中斷與跨入口錢包恢復 | mobile-differentiation 4.2 | FR-20.2 | 3.0 | WIP | 2026-09-22：程式面確認——所有錢包操作皆由使用者按鈕觸發（bootstrap 只 `peekStoredSession`、outbox 遇 NO_SESSION 停在 blocked 不開錢包；`walletService.restore()` 無呼叫端）；新增 `walletTimeline`（每次 MWA 操作分開記 App 等待／錢包等待／回來後等待、結果、是否在運動記錄中；不含地址／簽章）由 `guardWalletOp` 自動寫入，Profile「錢包互動紀錄」卡＋摘要（運動中 N 次、無回覆 N 次、錢包時間中位數）作驗收證據；Jest 449（walletTimeline 3）。待實機：兩款 MWA 錢包拒簽／逾時／鎖屏恢復／換帳號矩陣（證據包 §6） |
| PG-XD-03 | 跨任務／活動成就護照與來源投影 | mobile-differentiation 4.3 | FR-20.3 | 3.0 | WIP | 2026-09-22：後端 `GET /me/passport`（`PassportService`：PB／里程碑／活動章／探索任務只讀彙整，每項 source_class organizer／device／pending、rules_version、validity valid／pending／revoked／locked、reason、public、nft；needs_review 不標 valid；撤銷後 NFT 留歷史；不含健康數字／路線）；App `PassportScreen`（Style 24.9：計數、篩選、來源／狀態 chip、原因、NFT 詳情連結、信任邊界說明）＋ Profile 入口。公開投影仍為既有藝廊（需 public_consent）。vitest 223（passport 2）、Jest 453（passport 4）；待實機 |
| PG-XD-04 | 活動主題任務與權益資格關聯 | mobile-differentiation 4.4 | FR-20.4 | 5.0 | TODO | 待指派；首批 P1。沿用 E-02～06、U-04／05；新增任務與 benefit 版本快照，核銷重驗资格；最後一件競態、撤銷、無 NFC／斷線／跨站點／取消驗收；限量資格與保證獎品分開，須有合作方／庫存 |
| PG-XD-05 | 邀請制小隊非同步接力 | mobile-differentiation 5 | FR-20.5 | 5.0 | TODO | 待指派；第二批 P2。依賴 U-04／05、R-10、XD-06；2～4 人、每人每日封頂、固定名單／時區、退出與來源撤銷；僅鏈下共同外觀，不押幣、不比速度、不新增好友圖譜 |
| PG-XD-06 | 可接受任務邀請與安裝前唯讀頁 | mobile-differentiation 5 | FR-20.6 | 3.0 | TODO | 待指派；第二批 P2。沿用 U-03、E-03／04，新增 opaque invite／有效期／撤銷／接受同意；未安裝可看規則與重開連結／短碼；不自動發訊息或上傳通訊錄 |
| PG-XD-07 | 演示主線、實機矩陣與非獎金留存量測 | mobile-differentiation 6 | FR-20.7 | 3.0 | WIP | 2026-09-22：量測端 `GET /ops/metrics/funnel`（任務接受→開始→合格完成→領取每步分母分開、撤銷／過期；玩家數／7 天新增／活躍；cohort D7／D30 以 first_seen／last_seen 觀察，不作成效宣稱；只回計數無錢包；曝光不計，自接受起算）＋`scripts/ops/funnel.sh`；SQL 版與 memory 版一致（vitest 1）。演示主線／實機矩陣：demo-video §8 v4 與 evidence.sh；5 人試測與試辦活動待負責人。依賴 XD-01～04、A-17、UX-01、R-10、E-09；5 人理解度探索試測、10 人合作／內部試辦分標、漏斗分母與去重、90 秒演示標示預錄／測試資料；D7／D30 實測前不得宣稱成果 |

### 21.1 批次與完成閘門

- 首批 17 人天增量：XD-01／02 → XD-03／04 → XD-07。可先用個人系統任務及一個測試活動，不依賴小隊或真實代幣獎勵；既有 WIP 需先達對應驗收。
- 第二批 8 人天增量：XD-06 → XD-05，再由 XD-07 擴充錄影及實測；獨立功能開關，不能讓小隊／分享耽誤首批。
- 合計 25 人天為粗估，未含既有 WIP、合作等待、素材精修、部署與風險緩衝；日期／負責人待排，不加入原四週承諾。
- GPS 探索資格由 `QUEST_GPS_MIN_RULES_VERSION` 控制，**2026-09-22 起 l1／l2 設為 2（＝`WORKOUT_RULES_VERSION`）＝App 內 GPS 計入**；品質防線（待審／估算排除、完整性旗標、速度上限、取樣密度、重疊與單日上限）照常運作，任務獎勵僅帳號綁定外觀、不寫鏈上。手機簽署不證明健康資料真實、NFC 不證明本人到場。
- 無代幣探索可先做；任何新增金錢性獎勵须先完成 EC-02～04。不改既有 tSKR、XP、維持規則或已領資產。
- 規則快照、去重／重放、來源撤銷、個資公開、邀請撤銷、原子核銷、無障礙及實機復原的證據齐備才可依 PG §12 判定 DONE。

### 21.2 範圍與決策

本次將原 sport-experience-gameplay §6 的小隊候選正式拆為第二批 TODO，優先序依本節；僅限邀請制合作，BRD 原排除的公開社交動態牆、聊天、好友網路仍不納入。小隊試辦預設為 2～4 人／7 天／各 3 活躍日，參數可在試辦前版本化調整；不得追溯改當期已接受契約。權益首版採明示限量資格，保證獎品模式需先完成接受時庫存預留。

資料核對：DeStreet 是 Renaissance DAOs & Communities 第二名；SolPlay 的 Radar 得獎說法未獲官方名單確認；首屆活動年份與得獎頁現有日期呈現不一致。正式文案採已核對來源，不宣稱「所有得獎作品都無彈窗」或「零抽成等於免審查」。


## 2026-09-17：保育跑鞋與成長盲盒

| ID | 工作 | 狀態 | 證據／後續 |
|---|---|---|---|
| PG-WILD-01 | Level 2–5 動物 SVG 元素、雙語名稱、保育故事 | WIP | ShoeHero／WildlifeShoePattern／ShoeStory；待實機美術驗收 |
| PG-WILD-02 | 固定外觀分配、成長盲盒展示、系列識別 | WIP | shoeCollection；未包含鏈上隨機抽取、NFT 獨立款式 metadata 或系列切換 |

完整範圍、來源與驗收：[荒野守護設計](design/wild-guardian-shoes.md)。

### PG-D-04 更新（2026-09-17）

募資簡報另存 `output/fundraising/NeonShift_募資簡報_中文草稿_v2.pptx`，共 26 頁；第 13–15 頁新增荒野守護鞋款示意、三款盲盒細節與保育／聯名路線。同步更新 HTML、講稿、來源與 `docs/store/pitch.md`。v1 保留；區分 App 外觀已實作和未完成的 NFT 獨立款式、系列切換。

### Demo 文件與拆盒體驗更新（2026-09-17；腳本 09-18 同步）

| 工作 | 狀態 | 證據／後續 |
|---|---|---|
| Demo v3 英文主片、評審入口、活動參與手冊 | WIP | [主影片分鏡](store/demo-video.md)、[評審指南](store/judges-guide.md)、[活動手冊](store/event-demo-playbook.md)；2026-09-18：六段英文稿 288 字、2:50 目標／3:00 上限與 AI 配音指南；待語音試聽、錄影、fixture 與實機驗收 |
| 拆盒蓄能、獨立盒蓋、守護剪影、跳過與背景停止 | WIP | UnboxStage／WildlifeSilhouette；待 Android 真機確認剪影辨識、遮擋、幀率與震動強度 |


## 22. 跑鞋連動、有序同步與 Activity（2026-09-19）

設計見 [整合規格](shoe-sync-activity.md)。本次完成文件及簡報，不標記 App DONE。

| ID | 工作 | 狀態 | 驗收 |
|---|---|---|---|
| PG-LINK-01 | 多鞋選擇與可關閉場景 | WIP | 取得資格、降級外觀、持久化與換帳號隔離；2026-09-19 App 實作（Style 23.13：我的跑鞋卡片＋使用這雙、外觀 vs 有效等級標示、HabitatScene 四場景、背景開關 Gear／Profile 共用、錢包分區偏好、新鞋立即使用／稍後、session 鞋款快照）；Jest 367；待實機驗收 |
| PG-LINK-02 | opt-in 自動同步與統一佇列 | WIP | 全入口同鎖、舊到新、重試／幂等、關閉不發新請求；2026-09-19 App 實作（Style 23.14：syncPrefsStore 預設關、WorkoutOutbox 單 worker 舊到新、退避／blocked／排除、結束／啟動／回前景／網路恢復入口、單筆同步不跳過、訪客歸屬、Profile 資料與同步區）；Jest 373；待實機驗收（三筆離線 17→18→19） |
| PG-LINK-03 | 晚到、修正、刪除重算 | WIP | PB／首次章／等級歷史、跨裝置、tombstone；2026-09-19：後端晚到更早紀錄端到端測試（PB 重排／撤銷、首次章換來源、成就來源更正、幂等／stale、ACK accepted_revision＋recompute）、App tombstone 刪除走佇列（Style 23.15）；vitest 26（pb／workouts／milestones）、Jest 374；待部署與實機 |
| PG-LINK-04 | Activity 月曆、篩選與詳情 | WIP | 本機遠端合併、分頁、缺值、離線與保留範圍；2026-09-19 App＋後端實作（Style 23.16：domain/activity 合併去重／時區日曆日／篩選排序／月總覽、ActivityScreen 月曆清單、ActivityDetail、Home 最近運動、Profile 入口、/me/workouts 查詢擴充）；Jest 381、vitest 27；待實機驗收 |
| PG-LINK-05 | 實機驗收與 Demo 素材 | WIP | 2026-09-20 下午：USB 截圖 20 張（真實 Lv.1）＋展示版覆寫 `EXPO_PUBLIC_DEMO_LEVEL=3` 22 張（揭曉／切鞋／棲地／關背景／路線底圖，標 DEMO DATA）→ output/hackathon-flexclip-en/captures/2026-09-20；擷取工具 scripts/demo/capture.sh。三條新流程實錄；目前簡報為設計預覽。2026-09-20 Seeker 裝 `aeacff4`（LINK-01～04）初檢：Home 最近運動卡、Gear 我的跑鞋／背景開關、Profile 資料與同步（預設關、歸屬 7 筆訪客紀錄）、我的運動清單／月曆／篩選皆正常；修正 Activity 頁缺歸屬按鈕、待審核未明示、按鈕擠壓文字（1bfa21c／aeacff4）。待：Lv.2+ 錢包切鞋→關背景、三筆離線依序同步、詳情頁；Demo 錄影 |
| PG-LINK-06 | Activity 儀表板（週／月／年／全部、長條圖、最近活動卡） | WIP | 2026-09-20 晚：改為底部第五分頁「運動」（Style 2.2）；2026-09-20 負責人參考 Nike Run Club 提出；App 實作（Style 23.17：期間 Segmented＋‹ ›、大數字公里／次數／平均配速／時間、ActivityChart 每桶長條＋平均虛線＋點桶篩選、篩選收合、最近活動卡 RouteThumb＋自動命名、首頁按鈕在線待同步先問、歸屬訪客紀錄）；Jest activityScreen 7／activityJournal 4；待實機驗收 |
| PG-LINK-07 | 路線底圖跟隨跑鞋棲地 | WIP | 2026-09-20 負責人提出；App 實作（Style 23.18：traceLayer 預設 `shoe`、`resolveTraceLayer`、HabitatArt 底圖、棲地未取得鎖定、記錄頁／摘要／縮圖一致）；待實機驗收 |
| PG-LINK-08 | Workouts 匯入按鈕只在有新紀錄時出現；睡眠先隱藏 | WIP | 2026-09-20 負責人提出；`previewHealthConnect` 對照伺服器 (source_id, external_record_id, revision) 不提示權限、全部已匯入改一行說明；`FEATURES.sleep=false`（Style 23.19：Home 步數卡全寬、只要求步數權限、上手／Profile 文案）；鏈上／後端睡眠規則保留 |

新增工期與負責人待排，與 PG-R／V／WILD 既有基礎整合，不重複計完成度。


## 2026-09-20 Activity 與睡眠清理

PG-LINK-09：Activity 視覺與篩選一致性修正、睡眠停用讀取／權限與對外文案清理，WIP（待實機）。鏈上／後端保留；DEC-04 的 Lv5 900 點與本版僅步數 700 點上限需定案。


## PG-LINK-10：跑鞋連動與路線外觀固定（2026-09-20）

WIP：運動前預覽／選擇、開始頁鞋款一致、本機不可改寫快照、記錄／摘要／Activity 一致、同步 extras 與後端更正版保留原背景。新增測試涵蓋保存後換偏好、重啟及 source revision；待實機與 PostgreSQL 整合驗收。每鞋里程已實作（2026-09-20，Style 23.20，Gear 卡片 `gear-shoe-<lv>-mileage`）；升階首次運動紀念已實作（Style 23.21，摘要頁 `sum-first-wear`）；社群圖片分享列候選，尚未實作（需 react-native-view-shot／expo-sharing 原生依賴，另立工作）。詳見 [設計](design/shoe-route-linkage.md)。


## 2026-09-20 特殊圖案路線挑戰（新增開發內容）

新增 FR-22.1～22.5 與 PG-ROUTE-01～07，全部 TODO。R1：模板編輯、GPX 本機匯出／分享、匯入收藏、原地路線挑戰；R2：可撤銷分享連結與固定外觀成果卡；R3：異地仿畫研究。驗收涵蓋真實新運動比對、交叉路段／缺口、位置揭露同意及版本固定。工期／負責人待排，不改既有交付承諾。

完整流程、資料與驗收：[特殊路線挑戰規格](design/pattern-route-challenges.md)。

## 2026-09-21 SKR 獨立獎評估

[活動查核與 SKR-01～07 工作包](store/skr-integration-assessment.md)：建議成就資格連動的官方 SKR 外觀付款；全部 TODO。DEC-02 保持 OPEN，未取得主辦方對 devnet 替代 token 的確認；既有 tSKR 不代表官方 SKR 整合。無主網部署或交易。

## 2026-09-21 參賽開發計畫

執行依據：[參賽開發與驗收計畫](store/competition-development-plan.md)。新增 COMP-W01／W02、COMP-R01／R02 與 SKR-01～07 全部 TODO；規則追蹤 COMP-01～11。P0 優先錢包恢復、真實運動／成就流程與可安裝交付；P1 首款 SKR 成就收藏卡外觀付款，10/1 Go／No-go，10/7 內部提交。單人容量與外部資格尚待確認；估算 14–21 人日不作完成承諾。P2 延後 3D、完整特殊路線平台與真實資金 Arena。

人力補充：使用者確認本次僅本人參賽、無 VC 投資；依單人容量順序推進 W01／W02 → SKR，保留至少最後 4 天回歸與素材，不能以角色欄位假設多人平行。

## 2026-09-21 SKR 獨立獎工作包（負責人指示 Go）

| 編號 | 名稱 | 狀態 | 備註 |
|---|---|---|---|
| SKR-01 | 獨立 SKR 網路配置、mint owner／decimals 驗證、單位運算、環境隔離 | WIP | backend config 守門（主網限官方 mint、devnet 需測試 mint）、啟動核對 mint；App `OFFICIAL_SKR_MINT` 雙重核對、主網 RPC 與 MWA `solana:mainnet` 獨立授權；`formatBaseUnits` 不用浮點 |
| SKR-02 | SKU／版本、資格、wallet、價格、期限與訂單參照由服務端決定；SIWS owner 綁定 | WIP | `skr/catalog.ts`、`service.ts`；資格＝first_5k achievement approved/minted；訂單不可變欄位＋reference；migration 0019 |
| SKR-03 | 購買預覽、SOL／SKR 不足、取消、確認中；每次交易可理解且不重扣 | WIP | App `SkrService.purchase`、`GenesisFrameCard`（確認框列金額／網路／收款人）；餘額預檢；送出後只確認不重送 |
| SKR-04 | 確認付款、唯一 receipt、交易鎖內授權；錯 mint／收款人／網路拒絕 | WIP | `verify.ts`＋`fulfillSkrOrder`（FOR UPDATE＋signature 主鍵）；他人付款／錯 mint／金額不足／逾期 → needs_review |
| SKR-05 | 訂單恢復、晚到付款、過期／異常付款處理、關 App 重開不重扣 | WIP | `recover`（signature／reference 反查）、寬限 600 s、confirming 取消規則、App pending 按 network＋wallet 持久化 |
| SKR-06 | Genesis Mint 邊框在收藏卡／詳情選用、換帳戶隔離、重裝恢復 | WIP | 權限以伺服器為準、`useGenesisFrame` 按錢包；Gear 里程碑卡與 Gallery 本人頁「首次」卡套邊框（他人頁不顯示付費外觀）；真機驗收待 |
| SKR-07 | 付款對抗測試、真機成功及失敗證據；官方 SKR 小額測試前完成審查 | WIP | 自動測試 backend 11／app 12 通過；真機（devnet TEST mint 或主網小額）待負責人決定價格／收款人後執行 |

DEC-02 已於 2026-09-29 由主辦方回覆結案（devnet＋tSKR 可參加評審與 SKR 獎）；本實作仍以主網官方 mint 為**得獎後**的正式路徑、devnet TEST mint 供提交階段展示並在 App 標示。


## 2026-09-25 社群分享規劃（新增開發內容）

新增 PG-SHARE-01～07，全部 TODO：裝置端合成的運動／成就／活動／里程／故事圖卡（1080×1350，第二階段 9:16）、`/s/` 落地頁與全站 OG 標籤、`Get NeonShift` 安裝按鈕、非活動分享的彙總歸因。第一批可交付＝01＋02＋03＋04（＋建議同批 05，否則無法量測成效）。

紅線：圖卡必須在裝置端合成，GPS 與路線資料不上傳；路線形狀為預設關閉的獨立開關並裁去起終點；欄位開關沿用 `ShareCardFields`，NFT 數值公開同意不等於社群分享同意；含代幣圖卡必標 `DEVNET · Test Token · No monetary value`；歸因只記彙總、不產生個人分享識別碼。

需新增原生依賴 `react-native-view-shot`／`expo-sharing`（須重新出包），此即 PG-LINK-10 所記「社群圖片分享列候選，另立工作」。工期／負責人待排，不改既有交付承諾。

完整規劃、圖卡規格與驗收：[社群分享規劃](social-share/README.md)。


## 2026-09-25 社群分享實作（PG-SHARE-01～05／08 部分）

WIP（碼完、自動測試通過、**實機與部署未驗收**）：

| 編號 | 內容 | 狀態 |
|---|---|---|
| PG-SHARE-01 | `domain/shareImage.ts` 版面資料層；關掉的欄位不出現、路線預設 null、`sharePublishable` 擋掉缺網路標示的成就卡 | WIP |
| PG-SHARE-02 | `components/ShareCard.tsx` 單一 SVG（1080×1350）；A／B 卡型、程序繪製徽章、QR 疊成單一 Path | WIP |
| PG-SHARE-03 | `services/share/shareImage.ts`：`Svg.toDataURL` 出圖（**不用 react-native-view-shot**）、TTL 延後刪檔、失敗只回原因不自動改發文字、複製文案 | WIP |
| PG-SHARE-04 | `web/s/{workout,achievement,gear,guardian,passport}` ＋ `/s/`；首頁／`/en/`／`/e/` 補 OG；`web/og/<kind>-v1.png`；App `/s/` routing 與 App Link intent filter | WIP |
| PG-SHARE-05 | migration 0020 `share_aggregates`、匿名 `POST /v1/metrics/share`、`GET /v1/ops/metrics/share`（JSON／CSV）、`scripts/ops/share.sh` | WIP |
| PG-SHARE-08 | 凍結 `ShareRenderSpec`（來源 ID 只留本機）、成就狀態門檻（只有已鑄造能出收藏卡）、A 卡標「個人紀錄／尚未驗證」、獨立分享同意（精確值與月份預設關） | WIP |

新依賴：`expo-sharing`、`expo-clipboard`、`qrcode`（純 JS）。前兩者是原生模組，**必須重新出包**才會生效；`/s/` App Link 也需新 APK 才會驗證網域。

**2026-09-27 部署實測（線上 `neonshift.cc` 尚未更新）**：`/s/*`、`/og/*`、`/licenses/*` 全部不存在，
Cloudflare Pages 把找不到的路徑一律回**首頁且狀態碼 200**（`/s/zzznotexist` 也是 200），所以
「連得上」不等於「頁面在」——這次是用 `<title>` 與 `Content-Type` 才驗出來的。線上首頁仍是
2026-09-20 之前的內容（還有睡眠字樣、沒有 OG head）。影響：App 分享出去的
`https://neonshift.cc/s/<kind>` 落到首頁，沒有分屆文案、沒有「Open in NeonShift」、
`/v1/metrics/share` 的匿名計數（PG-SHARE-05）永遠不會被觸發，社群預覽也只會拿到通用首頁卡。
修法：`npx wrangler pages deploy web --project-name neonshift --branch main`（見 deploy/README）。
另建議補 `web/404.html`，否則缺檔會繼續假裝成首頁。

延後：PG-SHARE-06（C／D／E 卡型）、07（story 9:16）、09（路線形狀匯出——裁切規則未驗收前開關不露出）。

驗收表：[2026-09-25 分享驗收](evidence/2026-09-25-share.md)。規格與紅線：[社群分享規劃](social-share/README.md)。


## 2026-09-25 節日收藏後端（PG-SEASON-01／02）

WIP（後端碼完、264 項後端測試通過；App 未接、無鑄造路徑）：

- 每屆設定在 `backend/seasonal/campaigns.json`（可 review、可 diff，附來源 URL 與核對日期）。窗口**一律寫明確 UTC 瞬間**，地方節日不在伺服器做「當地日期→UTC」換算；改由 `display_timezone` ＋ `expect_local_days` 讓 loader 反算驗證，時區或 DST 打錯會直接啟動失敗。同主題同年兩屆、窗口顛倒、缺來源 URL 一律拒絕。
- 目前三屆（genesis-stride-2027、seeker-horizon-2027、moonlit-steps-2026-demo）**全部 `enabled:false`**：設定檔進倉庫不等於活動上線。
- 資格（`src/seasonal/compute.ts`，純函式）：嚴格單筆——同一筆運動的開始與結束都要落在 `[starts_at, ends_at)`，moving time（elapsed − paused）≥ 20 分；多筆不能拼滿、跨午夜不算。窗口依運動發生時間，7 天寬限只放寬上傳時間。GPS 沿用 `QUEST_GPS_MIN_RULES_VERSION` 同一道門檻。每屆一枚取最早開始那筆，重匯入不換來源。
- API：`GET /v1/seasonal`（公開目錄）、`GET /v1/me/seasonal`（本人狀態與進度）。**刻意不含任何 mintable／achievement 欄位、`mint_enabled:false`**，不讓 App 把「已達標」誤當成「已取得 NFT」。
- PG-SEASON-03（App，同日）：`SeasonalBadge` 程序繪製五種主題徽章（圓角盾牌＋雙層軌道、年份置底、上鎖用輪廓＋鎖圖示不只灰色）；`SeasonalFootprints` 掛在 Gear 收藏頁，顯示窗口狀態（即將開始／進行中／仍可補同步／已結束）、活動時區與使用者本地時間兩行、單筆 20 分規則、進度分鐘數與「看這次運動」。**達標只寫「已達標、尚未開放領取」，畫面上沒有任何領取按鈕**。未登入顯示公開目錄。
- 尚未做：PG-SEASON-03 的年份篩選與收藏頁分類切換、04 registry／mint（`achievements_kind_ck` 還沒有 `seasonal`）、05 通知與分享、06 提醒訂閱。

規格：[節日與生態紀念 NFT](design/seasonal-achievement-nfts.md)。


## 2026-09-26 分享卡型補齊（PG-SHARE-06 部分）

WIP（碼完、App 全套 78 suites／537 tests 通過、實機未驗）：

- 新增三種卡型：**C 活動邀請**（活動詳情頁按「邀請朋友」才產圖；圖上只有活動名、時間與「名額請看活動頁」，不寫死名額、不含報名資料與報到碼）、**D 跑鞋里程**（Gear 分頁；主數字是這雙鞋的累積里程，**只有已領取紀念 NFT 才算鏈上資產並標示網路**，沒領取就寫「里程記錄在這支手機上」）、**E Guardian 故事**（Guardian 卡；物種、一句族群依據、共同進度，必附「這是學習里程碑，不代表已捐款或救援動物」）。
- `sharePublishable` 的判斷從「卡型是成就」改為「這張圖是否描繪鏈上資產」（`chainAsset`），未領取的跑鞋就不會被硬掛 DEVNET。
- 版面改為自動收斂：行數多時先縮徽章、必要時縮行距，四行文字加徽章也不會壓到分隔線與產品線索。
- 共用 `components/ShareImageBlock.tsx`：預覽 → 分享圖片／複製文案、失敗給「重試／改成分享文字」、返回只說「已返回分享頁」。既有的運動摘要與成就入口沿用各自實作，未一併改寫。
- Guardian 與活動的**純文字分享保持原樣**（既有測試與行為不動），圖片是另一個入口。

規格：[社群分享規劃 §4.3](social-share/README.md)。


## 2026-09-26 護照卡與完賽卡（PG-SHARE-06 完成）

WIP（碼完、App 全套 79 suites／547 tests 通過、實機未驗）：

- **S3 成就護照卡（卡型 B 多格）**：掛在護照頁計數之後，`counts.valid > 0` 才出現入口。主數字是**目前有效**的枚數，與畫面上的 valid 計數同一個來源——待核准、已撤銷與上鎖都不計入，也不進格子；圖上另寫一行計數規則，看圖的人才知道這個數字不含待核准。**「有效」不等於「鏈上有」**：網路標示看的是已鑄造（`nft.status === 'minted'`）的枚數，一枚都沒鑄造就不掛 DEVNET。格子最多 8 格、同一種類不佔兩格；達成日期、成績與 asset id 完全不進版面資料。
- **S5 完賽卡**：掛在活動成績頁的「我的成績」之後，`finish_status === 'finished'` 才出現——DNF／DNS／DQ 不產生「完賽」圖。第一行先說這筆成績**主辦方公布了沒有**（`published_at`），而不是先把時間放大。**完賽時間與名次預設關閉**（`FINISH_SHARE_DEFAULT`）：這是本次社群分享的獨立同意，與成績榜的 `public_consent` 是兩件事，成績榜已公開也不預先勾選；名次另外要求主辦方已公布，否則沒有可引用的來源。主辦方更正過的成績在圖上明寫。完賽章 NFT 是另一枚收藏（由成就卡呈現），這張卡不宣稱任何鏈上資產。
- `ShareImageLayout` 加 `grid: string[]`（多格徽章），`ShareCard` 的縮放階梯補 200 px 徽章與 46 px 行距，六行文字加徽章也不壓到分隔線。
- 環境備註：App 測試要 Node 24（`source scripts/env.sh`）。系統預設的 Node 18 下 jest 沙箱沒有 `crypto.getRandomValues`，`Keypair.generate()` 會讓 `milestoneApproval`、`mintTransactionPhases` 兩個套件失敗——與程式無關。

規格：[社群分享規劃 §3.2／§4.3／§4.5／§5.4](social-share/README.md)。


## 2026-09-26 收藏頁年份篩選與分類切換（PG-SEASON-03 完成）

WIP（碼完、App 全套 79 suites／551 tests 通過、實機未驗）：

- **年份篩選**（`SeasonalFootprints`）：只有跨年份才出現這排按鈕——一個年份時它只是雜訊。年份新的在前，同年依窗口開始時間排（設計 §7 的「收藏年份排序」）。選定年份只留那一年，`全部年份` 回到不篩。
- **收藏頁分類切換**（`GearScreen`）：全部／跑鞋／里程碑／節日，`accessibilityRole="tab"`。**預設「全部」**——這一頁本來就同時顯示四塊，改成預設只顯示一塊會讓現有使用者找不到東西；分類是用來收斂那條很長的捲軸，不是用來藏內容。
- **個人最佳沒有搬進收藏頁**（仍在「運動」分頁），所以分類列下面直接寫一行說它在哪裡，而不是讓人以為收藏頁少了一類。設計 §5 列的「已收藏／可領取／未解鎖」狀態篩選要等 PG-SEASON-04 有領取路徑才有意義，這次不做。

尚未做：PG-SEASON-04 registry／mint（`achievements_kind_ck` 還沒有 `seasonal`；鏈上 `category` 只到 1..=13，需程式改版與重新部署——格式待決）、05 通知與分享、06 提醒訂閱。

規格：[節日與生態紀念 NFT §5](design/seasonal-achievement-nfts.md)。


## 2026-09-26 story 9:16（PG-SHARE-07）

WIP（碼完、App 全套 79 suites／556 tests 通過、實機未驗）：

- `SHARE_IMAGE` 加 `story: 1080×1920`。做法是**把同一塊 1080×1350 的內容垂直置中**在 9:16 畫布上（`<G>` 位移 285 px），不為 story 重算一套版面：上下各 285 px ＞ 規格要求的 250 px 安全區，而且使用者預覽到的那張圖與實際輸出的內容必然相同（§4.6「送出同一份已預覽內容」）。測試直接比對 post 與 story 的文字內容完全一致。
- `shareLayout` 的 `toDataURL` 尺寸改成**依所選格式**，不再寫死 post——輸出錯尺寸等於裁掉內容。
- `ShareImageBlock` 加尺寸切換（貼文 4:5／限時動態 9:16，`accessibilityRole="tab"`），預覽本身就是那個尺寸的同一個 SVG，不是另外畫一張示意圖；選 story 時多一行說明上下留白。`ShareRenderSpec.format` 隨切換寫入。
- 運動摘要與成就（`Milestones`）沿用各自的分享實作，目前仍只出 post；要一起支援 story 需把那兩處也改走 `ShareImageBlock`，本次沒動。
- 仍待實機：IG／FB 限時動態的實際裁切與上下安全區是否夠。

規格：[社群分享規劃 §4.1](social-share/README.md)。


## 2026-09-26 路線形狀裁切規則（PG-SHARE-09；開關仍未露出）

WIP（規則碼完、App 全套 79 suites／560 tests 通過、實機未驗）。新模組 `app/src/domain/gps/shareRoute.ts`，把 §9.1「路線第二階段的發布門檻」逐條實作成可測的規則，每條各有一個測試：

1. **按距離裁，不按點數裁**（兩端各 200 m）。慢走與快跑的每點間距差好幾倍，刪固定點數等於刪不定長度。
2. **全程再次進入起終點保護區（半徑 200 m）的點一併移除**。折返、繞圈、住家附近起跑的路線中段會再次經過出發點——只裁頭尾的話，家門口還留在圖的中間。測試用「東行 3 km 後折返」的課程證明去程經過終點附近的那一段真的消失，並以 `zoneM: 0` 的對照組證明斷開是這條規則造成的。
3. **裁掉的區段與 GPS 缺口都不補連線**；單段不足 4 點整段丟掉，不硬畫兩點一條線。
4. **裁完才正規化**：比例與位置只看留下來的點，否則畫面上的留白會透露被裁掉多長。
5. **裁切後仍需 1 km 有效長度**，不足就沒有形狀，**不調小保護距離來湊圖**（1.39 km 差 10 m 也不給）。

另外：精度超過引擎接受門檻（50 m）的點不進形狀；`keptM` 只留在本機，不進圖卡版面。`domain/gps/trace.ts` 的舊 `trimEnds` 已移除——畫面縮圖與「可以交出去的形狀」是兩種東西，不共用一套裁切，留著只會讓人誤用較弱的那一套。

**這些公尺數是本專案取值，不是匿名保證**（§9.1 最後一句）：折返／繞圈的實際效果與「足夠剩餘長度」仍待實機驗收，**驗收前 App 不露出這個開關**（目前也沒有任何畫面呼叫 `routeShapeOf`，i18n 的 `share.card.route*` 三個 key 先備好）。

規格：[社群分享規劃 §5.2／§9.1](social-share/README.md)。


## 2026-09-26 節日核准通知與收藏卡（PG-SEASON-05；揭曉與領取仍等 04）

WIP（碼完、App 全套 80 suites／569 tests 通過、backend metrics 11 項通過、實機未驗）：

- **資格核准通知**（`app/src/components/SeasonalNotice.tsx`，掛在 RootNavigator 與成就核准通知並列）：只在 `status: 'eligible'` 時出現，文案跟著後端 `mint_enabled`——目前一律 false，所以說的是「本屆尚未開放領取，達標紀錄會留著」，**沒有領取按鈕、沒有揭曉動畫**。伺服器核准的是資格不是 NFT（設計 §4.3）。`pending_review` 刻意不彈通知：還沒核准就先報喜會被讀成已經拿到。輪詢 5 分鐘（成就那邊是 30 秒）——一屆的資格一生只轉一次，回到前景時會立刻檢查。
- **節日收藏卡**（`seasonalShareLayout` ＋ `ShareImageLayout.badge`）：徽章用**與 App 畫面同一份** `SeasonalBadgeArt`（從 `SeasonalBadge` 抽出不含 `<Svg>` 外框的版本，因為分享圖卡是單一 `<Svg>`），不是分享時另畫兩個字母的代號。狀態如實三分：待驗證／已達標但本屆尚未開放領取／已達標可領取；**`chainAsset` 一律 false**，所以不掛網路標示，也不可能出現「已鑄造」——那要等 04 有 registry／mint 路徑。
- **同意模型**：活動窗口（公開的節日日期）必出現；**使用者自己達標的時間預設關閉**，勾選後也只到月份，畫面上另寫一行說明這兩者的差別（設計 §4.5）。
- **落地與歸因**：新 kind `seasonal` 一路打通——`SHARE_KINDS`／`SHARE_SOURCES`、`shareLanding` 去向（Gear 分頁）、`web/s/seasonal.html`、`web/og/seasonal-v1.png`、後端 `share_aggregates` 允許清單。Android intent filter 是 `pathPrefix="/s/"`，不需要改。落地頁明寫「還沒有任何一屆開放、領取尚未開放」。
- `tools/og-assets/verify.mjs` 多三道檢查：`/s/<kind>.html` 的 deep link、計數 `KIND` 與複製連結的 URL 都要與檔名一致。這幾頁是互相複製出來的，這次就漏改了一處 deep link，靜態檢查當場擋下。
- **仍未做（等 PG-SEASON-04）**：揭曉動畫、「可領取 → 錢包確認 → confirmed」流程、`minted` 狀態與網路標示、撤銷語意。沒有 mint 路徑就沒有可揭曉的東西，硬做等於演一段假的。

環境備註：`backend/src/player/player.test.ts` 的 3 項在本機逾時失敗，是**既有**問題（在乾淨的 backend 上同樣失敗）——`DELETE /player/data` 會呼叫 `tournaments.activeStakedUntil()` 走鏈上讀取，本機連不到 RPC 就卡住。與本次修改無關。

規格：[節日與生態紀念 NFT §4.3／§4.5／§6](design/seasonal-achievement-nfts.md)、[社群分享規劃 §3.2 S8](social-share/README.md)。


## 2026-09-26 節日提醒訂閱與年度營運工具（PG-SEASON-06；推播仍未做）

WIP（碼完、實機未驗）：

- **提醒訂閱**（`app/src/state/seasonalReminderStore.ts`）：存在**本機、不分錢包、不上傳**。訂閱的是公開活動不是個人資料，未登入看得到公開目錄就該能訂閱；而且在沒有推播通道的情況下，把「誰在等哪一屆」收到後端只是多存一份沒有用途的資料。取消訂閱會把這一屆的已讀提醒一起清掉，重新訂閱的人收得到。
- **提醒判定**（純函式 `app/src/domain/seasonalReminder.ts`）：依「最該現在做什麼」排序——`open`（還能出門走一趟）＞ `grace`（只能把窗口內那一筆**同步上來**，寬限放寬的是上傳時間不是運動時間）＞ `soon`（開始前 7 天內）。已達標或待驗證的一屆不提醒（提醒只會讓人以為還沒完成）；同一屆每個階段各提醒一次，關掉 `soon` 之後窗口真的開了還是會再提醒。8 項單元測試。
- **提醒的出口**：與資格核准共用 `SeasonalNotice` 那一個浮層，**核准優先**（已經發生的事先講）。兩個浮層互相蓋住才是真正的問題。未登入也會提醒（改查公開目錄），但**沒有訂閱任何一屆時完全不發請求**。
- **文案說實話**（當時）：這支 App 沒有推播也沒有本機排程通知（`modules/neonshift-notify` 只負責運動中的前景服務頻道）。**2026-09-28 已補上本機排程通知，見下方當日條目**，所以開關旁邊直接寫「NeonShift 只會在你打開 App 時提醒，沒有背景推播、也不會把這個訂閱上傳」。**系統推播是這一項還沒做的部分**，不因為有提醒就宣稱有通知。
- **年度營運工具**：`backend/src/seasonal/check.ts`（`npm run seasonal:check`，可加 `--now`／`--json`）把設定檔驗一次並印成表——重點是印出**換算回活動時區之後真正涵蓋的當地日期**，因為每年加下一屆真正容易錯的是 UTC 窗口算錯一小時或 DST 讓當地日期跑掉。`scripts/ops/seasonal.sh` 包一層，`--remote` 再跟線上 `/v1/seasonal` 對帳（窗口、時區、門檻、寬限、來源核對日與 `mint_enabled` 全比一次），確認部署上去的設定與 repo 同一版。不需要 OPS_TOKEN（公開目錄），不連資料庫。已加進 `scripts/test-all.sh`。

順手修掉一個會誤導測試結果的環境問題：`scripts/env.sh` 原本只用單一 `BREW_PREFIX` 找 node，而 nvm 是 shell function、非登入 shell 讀不到，於是 `scripts/test-all.sh` 與 `scripts/ops/*.sh` 會默默用系統上的舊版 node 跑——舊版 node 的 jest 沙箱沒有 `crypto.getRandomValues`，`Keypair.generate()` 相關套件就會失敗。這台 Mac 同時有 `/opt/homebrew`（openjdk）與 `/usr/local`（node），所以改成逐一試已知位置挑第一個存在的。

尚未做：PG-SEASON-04 registry／mint（`achievements_kind_ck` 還沒有 `seasonal`；鏈上 `category` 只到 1..=13，需程式改版與重新部署——格式待決）、PG-SEASON-05 的揭曉動畫與「可領取」流程（等 04）、PG-SEASON-06 的系統推播。（三項皆已於 2026-09-27／28 完成，見後續條目。）

規格：[節日與生態紀念 NFT §4／§6](design/seasonal-achievement-nfts.md)。


## 2026-09-27 測試基礎設施修正（讓週末回歸的結果可信）

不是功能，但會直接影響 9/28–9/30「完整端到端與安全回歸」的判讀：

- **`scripts/test-all.sh` 的 `docker info` 加逾時**（20 秒，優先用 coreutils `timeout`／`gtimeout`，沒有就自己顧一個子行程，bash 3.2 也能跑）。Docker Desktop 的 CLI 偶爾掛住不回（backend process 還活著，但 socket 不回應），沒有逾時的話整份測試會**停在資料庫那一段**而不是按設計 SKIP——2026-09-26 實際遇到一次，卡了十幾分鐘。
- **`backend/src/player/player.test.ts` 不再依賴網路**：`DELETE /player/data` 會問 `tournaments.activeStakedUntil()`（質押事實在鏈上），而測試設了 `PROGRAM_ID` 又沒注入 `chain`，那一步就打真的 RPC——離線或 RPC 慢時 3 項逾時失敗，失敗原因還跟這支端點無關。改成注入 `StaticChainReader`（與 `tournament.test.ts` 同一個做法）：187 秒 3 項失敗 → 3.5 秒 5 項通過。順便補一項之前沒被涵蓋的案例：**鏈上有進行中的質押時，延後期限是賽事 `ends_at` 而不是一律 30 天**（30 天是上限）。
- 提交前檢查：9/25 新增的 `expo-sharing`／`expo-clipboard` 經 `expo-modules-autolinking resolve -p android` 確認會被已提交的 `app/android/` 自動連結，`expo-sharing` 自帶的 FileProvider 路徑也涵蓋 App 私有 cache，所以**不需要重跑 prebuild**。分享功能仍必須重新出包才會出現，且實機驗收仍為 TODO（見 [提交追蹤](store/clock-in-submission.md) 2026-09-27 條）。


## 2026-09-27 節日收藏鑄造（PG-SEASON-04；待重新部署程式才能開啟）

WIP（碼完，實機與鏈上未驗）：程式 105 案例（attestation-core 17＋neonshift-core 23 單元／82 整合）、backend 277 通過、App 81 suites／587 tests 通過。

**鏈上格式定案（原本待你決定的那一題）：整個系列共用一個 `CATEGORY_SEASONAL = 14`，主題與年份寫在鏈下 metadata。**

依據是讀完 `claim_achievement.rs` 之後的一個事實：唯一性本來就由 32-byte `achievement_id` 提供——它同時是 `AchievementReceipt` PDA、asset PDA 與 metadata URI（`{BASE_URI}{id}.json`）三者的 seed。所以「每玩家每屆一枚」「同一主題不同年份是兩枚」不需要 category 的粒度就成立（LiteSVM 有一個測試專門釘住這件事）。反過來每個主題各給一個 category，每年新增主題都要升級並重新部署程式，而且換不到任何唯一性——對一個逐年成長的系列來說那是錯的軸。代價是鏈上名稱只到系列層級（`NeonShift Seasonal Footprints`），「哪一屆」要看那一枚的 metadata；要把主題寫進鏈上名稱得改 194-byte canonical 訊息格式（連帶 signer、20 組跨語言向量、App 交易組裝），不值得。

- **鏈上**：`CATEGORY_SEASONAL = 14`、`CATEGORY_MAX` 13→14（TS `CATEGORY_CODE` 與向量同步，向量純新增、既有 13 組位元組不動）。`achievement_metadata` 補系列名。**順手修一個錯誤命名**：原本只列 1..=5，7..=13 的里程碑與活動留念章全部落到 `_ => "Longest Run"`，也就是首次 5K 的收藏會被命名成「NeonShift PB · Longest Run」。名稱寫進鏈上改不了，所以這是必須修的錯誤標示；已鑄造的資產保留當時名稱，新測試把四個系列的名稱各釘一個。
- **後端**：migration 0021（`achievements_kind_ck` 加 `seasonal`）；key＝`seasonal|<campaign_id>`，沿用既有 `(wallet, milestone_key)` 唯一索引就是「每屆一枚」；`achievement_id = sha256("neonshift-seasonal|wallet|campaign_id")`。`buildSeasonalMetadata` 預設只寫公開資訊（主題、年份、窗口、門檻、驗證、美術／規則版本、日期依據），**自己哪天達標要逐次同意**。`ensureSeasonal`／`reconcileSeasonal`／`POST /v1/me/seasonal/:id/intent` 走與 PB／里程碑／活動章**同一條** registry → proof → receipt 路徑，不是另一套鑄造流程。
- **App**：只在 `mint_enabled && eligible` 才掛出領取（同意 → 預覽會公開的內容與 rent → MWA → 揭曉）；關著時畫面仍是「已達標、尚未開放領取」。
- **開關**：`SEASONAL_MINT_ENABLED` 預設 false，代表「程式已支援 seasonal 且已部署到**這個 cluster**」，不是活動熱度。後端關著時 intent 回 409 `SEASONAL_MINT_NOT_OPEN` 且**不留下任何成就列**。

### 要真的開放領取，需要你做三件事（順序不能顛倒）

1. **重新部署程式**（`cd programs && anchor build --arch v0`，再用 `scripts/chain/deploy.sh dev` 升級）。舊版的 `CATEGORY_MAX = 13` 會拒絕 category 14。**這是不可逆的鏈上操作，我沒有執行**。
2. 在 l1／l2 套用 `backend/migrations/0021_seasonal_achievements.sql`（同時還有沒套的 0020）。
3. 確認 1 完成後，才把 `/etc/neonshift/api.env` 的 `SEASONAL_MINT_ENABLED` 設為 `true`。順序顛倒會讓玩家拿到鏈上必定失敗的交易。

另外：要有任何一屆真的能領，還得把 `backend/seasonal/campaigns.json` 裡某一屆的 `enabled` 打開——目前三屆全部 `false`，那是另一個決定（每屆要先人工核對日期來源）。

尚未做：撤銷語意的實機驗證。（節日徽章揭曉已於 2026-09-27 補完、系統通知 2026-09-28 補完，見下。）

規格：[節日與生態紀念 NFT §5／§6](design/seasonal-achievement-nfts.md)、[SD 2026-09-27 實作註記](sd.md)。


## 2026-09-27 鏈上讀取：批次、退避與人話錯誤（實機 504 的後續）

實機首頁出現「Devnet is taking a break」並把整段 `{"jsonrpc":"2.0","error":{"code":504,…}}` 貼在正文裡。當天對公用端點 `https://api.devnet.solana.com` 量測：`getHealth`／`getVersion`／`getSlot`／`getBalance`（同一個帳號，餘額 1,082,040 lamports）都在 0.3 秒內回 200，但 `getAccountInfo`／`getMultipleAccounts` 連續多次 20–30 秒**完全沒有回應**——帳號、程式與當時的改動都沒有問題，是端點對「回傳帳號資料」的方法不回應，手機端 gateway 把它變成 504。App 端做了三件事：

1. **一次 `getMultipleAccounts` 讀完**（`fetchAccountsInfo`）。原本一次 `syncChain` 要 6～7 個 `getAccountInfo`（config／profile／freeze ＋ 今日各任務 receipt），而 Home 與 Gear 每次 focus 都同步——打在限流端點上最容易換來 429／504。餘額仍是第二個請求（要先有 config 才知道 mint）。7 → 2。
2. **逾時＋退避重試**（`rpcRead`）。每個 HTTP 請求 15 秒上限（`Connection` 的 `fetch` 包 AbortController）——**沒有上限的話重試沒有意義**，因為觀測到的行為是「不回應」而不是回錯誤。重試 2 次（400／1200 ms ＋抖動），**只對暫時性失敗**：限流（429／`-32005`）、逾時、5xx、連不上；「帳號不存在」這種再試也一樣的結果歸為 `unknown`，不重試。**只包讀取**——交易送出不重試，仍走 `claimSubmitter` 的 pending 判定（SD 5.3）。
3. **錯誤訊息改人話**。`chainError` 從整段例外字串改成 `{ reason, ref }`；正文依原因分五句（限流／逾時／故障／連不上／未知），技術細節只出現在 `InlineState` 的 `Ref`（例如 `504 · getMultipleAccounts`），**原始 payload 與帳號位址不再進畫面**。狀態碼從 web3.js 固定格式 `Error: <ddd> :` 取，不對整段訊息抓三位數（base58 位址裡也有數字）。

新增 `rpcRead.test.ts`（7 項，含實機那段原文的分類）與 `chainSync.test.ts`（3 項，釘住「只打一次批次讀」與「錯誤不含 payload」）；`states.test.tsx` 的首頁錯誤卡改成驗人話文案＋Ref＋**畫面上不得出現 jsonrpc 字樣**。App 83 suites／597 tests 通過。

未做（要你決定）：換一個有 API key 的 devnet RPC。`EXPO_PUBLIC_*` 是 build-time 內嵌，key 會留在 APK 裡，正規做法是網域／套件名限制的 key 或走自己的後端代理——牽涉金鑰政策，不自行決定。`ClaimSubmitter.receiptExists` 仍是單筆 `getAccountInfo`（它注入自己的 connection 供測試用），只吃到逾時、沒有退避；那在送交易前的檢查上是刻意保守。


## 2026-09-27 節日章的揭曉畫的是那一屆的徽章（PG-SEASON-04 收尾）

**翻面本身早就有了**：`RewardStage` 的 `mode="nft"` 已經是 2200 ms 的翻卡——背面封印 → `rotateY` →
單次掃光，而且已經處理 Reduce Motion（直接顯示結果）與背景化（立即完成、不重播）。
所以這裡沒有另外發明一套節奏，也沒有為節日章加第二種動畫時間（[style §25.2](style.md) 的
「一般 NFT 翻卡 2.2 秒」照用）。

**缺的是翻過來以後那一面**。原本 `SeasonalClaim` 只把鏈上 metadata 的 `name` 丟進揭曉佇列，
於是畫面畫的是通用金色 `award` 圖示，標題是整個系列共用的
「NeonShift Seasonal Footprints (Device)」——剛拿到的人看不出這是哪一屆，也看不到自己
在收藏頁上熟悉的那枚徽章。這正是 PG-SEASON-04 把主題與年份放在鏈下 metadata 的代價，
要在 App 端補回來。

- `nftRevealStore` 的 `Reward` 加 `seasonal?: { themeId, year }`——帶的是**主題與年份，不是圖檔位址**，
  因為節日徽章是程序繪製的（`SeasonalBadge`），揭曉時不連網也畫得出來，翻過來就是收藏頁上同一枚。
- `NftReveal` 在 `seasonal` 時把正面換成 `SeasonalBadge state="earned"`（148 px），標題改成
  **本地化屆名＋年份**（`season.name.<theme_id>`，查不到譯名退回 `theme_id`，不顯示 i18n key、不顯示空字串）。
- 文案三句（`reveal.seasonal{Eyebrow,Title,Body}`，兩份字典同 key）：說的是「每年一屆、每屆一枚，
  這個年份不會再出現第二枚」，**不談價值也不談稀有度**——它是免費收藏，不是商品。

測試 3 項（`nftReveal.test.tsx`）：節日章顯示徽章與屆名且**畫面上不得出現共用系列名**、
未知主題退回 `theme_id` 而非 i18n key、非節日獎勵仍走通用獎章（回歸防護）。App 83 suites／600 tests 通過。

要實機看到這段揭曉，仍需先完成上一節那三件事（鏈上程式重新部署 → migration 0021 →
`SEASONAL_MINT_ENABLED=true`），並把某一屆的 `enabled` 打開；在那之前領取按鈕不會出現。


## 2026-09-28 節日提醒的本機排程通知（PG-SEASON-06 的「系統推播」）＋ 網站 404 頁

### 為什麼是本機排程，不是遠端推播

PG-SEASON-06 當初把訂閱清單留在裝置上、不上傳，理由寫在 `seasonalReminderStore`：
訂閱的是**公開活動**，而且沒有推播通道時把「誰在等哪一屆」收到後端只是多存一份沒用途的資料。
要改走 push 就得推翻那個決定——後端得保存每台裝置的 token 與它訂閱了哪幾屆，
一個公開活動的訂閱就變成一筆個人資料，還要多一個 FCM 專案與伺服器金鑰。

**而那是不必要的**：每一屆的日期在 `backend/seasonal/campaigns.json` 裡本來就是公開且事先已知的，
手機拿到公開目錄之後自己就算得出「什麼時候該提醒」。所以這次引入 `expo-notifications`
（`~57.0.21`）**只用它的本機 API**：channel、權限、`scheduleNotificationAsync` 的 DATE trigger。
沒有 token、沒有伺服器、什麼都不上傳。

### 做了什麼

- **排程計畫是純函式**（`domain/seasonalNotificationPlan.ts`）：訂閱的一屆排三個時刻，
  與畫面上那三個階段語意一致——`soon`（開始前 7 天，還有時間安排一次 20 分鐘健走）、
  `open`（窗口開啟）、`grace`（窗口結束，只剩把那一筆**同步上來**）。
  只排未來的時刻；已達標／待驗證的一屆完全不排（在節日當天被叫去「快走」只會讓人以為漏了什麼）；
  `grace_days` 為 0 時沒有補同步期限，那一則不排；上限 12 則，砍掉的是最遠的那些。
- **差異同步**（`services/notifications/seasonalNotifications.ts`）：不是「全部取消再全部重排」——
  那會在每次前景切換與每 5 分鐘無謂地重建鬧鐘。比對存在通知自己 `data` 裡的
  `fireAt` 與 `locale`：**換語言會重排**，讓還沒響的通知跟著換語言。id 固定為
  `seasonal:<phase>:<campaign_id>`，所以重複同步不會排出第二份，取消時也不會誤殺其他通知。
- **不靜默要求權限**：開畫面只「查詢」權限狀態，真正的要求發生在使用者打開某一屆的提醒開關時
  （Android 13 的系統詢問在沒有任何 channel 時不會出現，所以先建 channel 再要求）。
  被拒絕時**不假裝會通知**：開關旁邊的文案換成「系統通知目前是關閉的，所以只會在你打開 App 時提醒」。
- **兩個出口都留著**：排程通知負責「不必打開 App」，`SeasonalNotice` 浮層負責「打開 App 當下」——
  後者仍有存在意義，因為權限可能被關掉，也可能使用者訂閱時那一屆已經開始了。
- **通知內容不含個人資料**：`data` 只有活動代號、階段、時刻、語言（通知內容會留在系統的通知紀錄裡）。
  測試直接斷言序列化結果不含 wallet／base58 位址。

### 原生層：手動維護的 android/ 要自己補 plugin 的產出

`expo-notifications` 經 `expo-modules-autolinking resolve -p android` 確認會被已提交的 `app/android/`
自動連結，**不需要重跑 prebuild**；模組自己的 manifest 已宣告 `POST_NOTIFICATIONS` 與
`RECEIVE_BOOT_COMPLETED`（後者用來在重開機後重建排程，正是我們要的）。

但 config plugin 不會執行，所以照它的產出手工補上 `colors.xml` 的 `notification_icon_color`
與 AndroidManifest 的四個 meta-data。

**圖示沿用既有的 `@drawable/notification_icon`**——`a1331e7` 早就為運動中的前景服務畫了一張
單色脈衝向量圖（而且已在 Seeker 實機驗過狀態列圖示），`expo-location` 也是按這個名字取圖，
一個單色小圖示兩邊共用剛好。這裡踩過一次坑值得記下：我原本照 plugin 的做法生成了
`drawable-{mdpi..xxxhdpi}/notification_icon.png`，但**密度限定的 PNG 會在每個密度桶蓋掉那張
無密度的向量圖**，等於把已驗收的運動通知圖示換成縮小的啟動圖示——是個回歸，已移除。
同理 `app.json` 的 plugin 只宣告 `color` 不宣告 `icon`：宣告了的話日後跑 prebuild 會再生成那些 PNG。

**一個要知道的代價**：`expo-notifications` 固定依賴 `firebase-messaging`，所以它會進 APK。
本專案**沒有套用 google-services 外掛也沒有 `google-services.json`**，沒有設定檔它不會初始化、
不會有推播連線；但 APK 會變大一些，而且 manifest 裡會多一個 FCM 的 service（由模組宣告）。

### 順手做的重複整理

同一句提醒現在有兩個出口，文案再各寫一份遲早漂移，而提醒說的是期限這種「說錯就害人白跑一趟」的事。
抽出 `domain/seasonalCopy.ts`（`seasonalThemeName`／`seasonalEditionName`／`seasonalReminderBody`），
`SeasonalNotice`、排程通知與 `NftReveal` 共用同一份；屆名查不到譯名一律退回 `theme_id`，
不顯示 i18n key、不顯示空字串。

### 網站 404 頁

`web/404.html`（中英雙語）。這件事的意義不只是美觀：在此之前 Cloudflare Pages 把找不到的路徑
**一律回首頁＋HTTP 200**，所以「網站停在 9/20、`/s/*` 與 `/og/*` 根本沒部署」看起來像一切正常，
兩個星期沒被發現。404 頁刻意**不放 OG／Twitter 標籤**（它不是可分享的頁面）並標 `noindex`；
顯示的路徑用 `textContent` 寫入，所以網址裡的任何內容都不會被當成標記執行。
如果部署後缺檔仍然回首頁，那就是 Pages 專案開了 SPA fallback，要在儀表板關掉。

測試：`seasonalNotifications.test.ts` 16 項（排程計畫 8、差異同步 8，含「沒權限不偷偷要求」、
「重複同步不排第二份」、「換語言會重排」、「不誤殺別人的通知」、「模組不存在或丟例外不炸掉」）。
App 84 suites／616 tests 通過，typecheck 乾淨。

**要實機生效必須重新出包**（原生模組）。文件同步：設計文件 §5 與 PG-SEASON-06 格、
隱私政策第 5 節新增通知權限揭露（生效日改 2026-09-28）、`build-and-test.md` 冷啟動重置腳本
加 `POST_NOTIFICATIONS`、`app.json` 權限與 plugin。


## 2026-09-28 兩個自己造成／自己留下的破口

不是新功能，是把前兩天留下的兩個缺口補掉。

**一、關掉最後一屆的提醒後，已排的通知還是會響。** `SeasonalNotice` 的早退條件是
「沒登入又沒訂閱任何一屆就不發請求」——而使用者把最後一屆的提醒關掉時剛好走到這裡，
於是排程不再被對齊，通知留在系統裡照樣會響。`cancelAllSeasonalNotifications` 當時寫了
卻沒有任何呼叫點（等於死碼），現在接在那個早退分支上。登入時走另一條路徑，空的計畫本來就會取消。
補兩項元件測試（關掉最後一屆會清排程且仍不發請求；有訂閱時以活動資料對齊）。

**二、`ClaimSubmitter.receiptExists` 沒有退避，而它是「這筆到底有沒有上鏈」的判準。**
9/27 做 RPC 退避時我把它當成「送出前的保守檢查」而跳過，這個判斷不對：它有三個呼叫點，
其中兩個在 `resolvePending` 的逾時分支——那個讀取一旦丟例外，整個冪等判定就以例外收場，
pending 紀錄還在（不會遺失），但使用者看到的是錯誤而不是結論，而那往往只要 400 ms 後
重試一次就有答案。現在走 `rpcRead`（只對限流／逾時／5xx／連不上重試；「帳號不存在」不重試）。
讀取重試沒有冪等問題，**送出交易仍然不重試**。`rpcRead` 多接一個連線提供者參數，
讓注入自己 connection 的呼叫端也能用同一套退避。

同分支後面的 `getSignatureStatus`／`getBlockHeight` 刻意保留 `.catch(() => null)`：
它們失敗時會落到「仍在有效期內、保留 pending、稍後再查」，那是安全的結論，不需要重試。

`claimSubmitter.test.ts` 改成只替換 `buildTransaction`／`getConnection`、`rpcRead` 用真實作，
所以新增的兩項（504 重試後成功仍判 already_claimed 且不送交易；非暫時性錯誤只呼叫一次）
是真的跑過退避的。App 84 suites／620 tests 通過。


## 2026-09-28 待測項目重排

實機待測的項目散在三個地方（提交候選版 31 項、提交追蹤的 APK／DEMO 系列、各功能的 evidence 檔），
誰該先做看不出來。[測試排程與步驟](evidence/2026-09-28-test-plan.md) 把它們依**三道閘門**重排：

| 閘門 | 現況 | 開了解鎖 |
|---|---|---|
| ① 部署後端（migration 0019／0020／0021） | `/v1/seasonal` 仍 404 | 節日全部、分享計數、活動流程 |
| ② 鏈上程式升級（不可逆，負責人執行） | 已部署程式 `CATEGORY_MAX = 13` | 節日鑄造與揭曉 |
| ③ 外出實跑 ≥5 km | — | COMP-W02、GPS 長時間 |

排序原則：不需要任何閘門的先做完（A 組，今天就能做）→ 開閘門①（一次解鎖三組，最划算）→ ② → ③；
提交影片排最後，因為它錄的是前面已通過的畫面，先錄會白錄。

同時記下今天已驗、不必重測的：release 簽章、升級安裝與資料保留、冷啟動無例外、通知權限、
**App Links 網域驗證由 `1024` 變 `verified` 且深層連結直接開 App**、網站 `/s/*`／`/og/*`／`/licenses/` 上線、
`/s/<不存在>` 回 404。

計畫裡也標了兩件目前無解的事：`806867e` 之後的兩個修正不在受測 APK 裡（B-2／A-8 的部分判準要等重新出包）、
RPC 端點仍是公用 devnet（偶發的慢來自端點本身，換有 key 的端點牽涉金鑰政策，是負責人的決定）。


## 2026-09-29 主辦方回覆：devnet 可評審，主網改為得獎後的前置（DEC-02 結案）

### 原文（主辦方電子郵件，未改寫）

> 1. Regarding Devnet: Yes, a fully functional app demonstrating real wallet signing and onchain
>    transactions on Devnet is eligible for judging. You do not need to move to Mainnet by the
>    submission deadline.
> 2. SKR Integration Prize: A demonstration on Devnet with your test token (tSKR) is acceptable
>    for the prize, provided the integration logic is sound and clearly presented.
> 3. Post-award publication: The version published on the Solana dApp Store must be on Mainnet,
>    as this is the requirement for public availability. So both the above would have to be working
>    and implemented on main net to receive the USDC prize.

### 這改變了什麼

**解除的壓力**：提交期限前不必上主網。原本 `DEC-02` 的風險敘述是「若必須整合主網官方 SKR，
PG-I-08 的 tSKR 路線、SA 5.4 與鏈上金庫設計都必須重估」——那個情境不會發生了。
devnet＋tSKR 的現行實作就是可提交、可參加 SKR 獎的形態。

**新增的條件，而且不輕**：
1. SKR 獎的門檻從「有沒有整合」變成「整合邏輯健全且**清楚呈現**」。主辦方特別寫了
   *clearly presented*，所以影片 D 段（1:35–2:20）與 pitch 不再是可選素材——那一段沒把
   整合邏輯講清楚，就等於沒整合。`demo-video.md` §8 的 Go／No-go 已改為確定 Go，替代稿作廢。
2. **得獎後要領 USDC，App 與 SKR 整合都必須在主網運作。** 這不是把設定從 devnet 換成
   mainnet-beta 就好，下面列出真正的工作包。

### 得獎後的主網工作包（**不在本次衝刺內**，先列出來以免臨時才發現）

| # | 內容 | 真正的難處 |
|---|---|---|
| MN-1 | 鏈上程式部署到 mainnet-beta | 新的 program keypair、部署 SOL、`cluster_id` 與 config／金庫重新初始化。已鑄造的 devnet 資產不會跟著過去，收藏要重新開始或明確說明 |
| MN-2 | 獎勵代幣 | 目前是 tSKR 測試代幣、`TSKR_TOTAL_SUPPLY=1000000` 是 BRD 8.5 的**假設**。主網要發真的代幣＝真的價值，**這條直接撞上 `DEC-03` 與 `PG-EC-02`～`05`**（打卡獎勵拆分、期間預算、對帳與準備金、反作弊）——那四項現在是 P0／TODO，主網之前必須完成，不是可選 |
| MN-3 | SKR 官方付款 | mint 已知（`SKRbvo6Gf7Gon…`），但**價格與收款錢包仍待你決定**（sd.md 已列為未決）；SKR-07 的主網小額實測涉及真實金額，要你核准後才執行 |
| MN-4 | RPC | 主網公用端點的限流比 devnet 更嚴。`EXPO_PUBLIC_*` 是 build-time 內嵌，帶 key 的端點會把 key 留在 APK 裡——**這個問題在主網不能再繞過**，要嘛用網域／套件名限制的 key，要嘛走自己的後端代理 |
| MN-5 | 金鑰與簽章 | 正式 keystore（`APK-01`；換了要同步更新 `assetlinks.json` 並重新部署）、`~/.config/neonshift/main/` 的 admin／attestor、主機上的 signer service |
| MN-6 | 揭露與文案 | App 內所有「devnet／tSKR／無金錢價值」的標示要改成主網語意；隱私政策與商店素材同步 |

**排序判斷**：MN-2 是關鍵路徑，因為它依賴 `PG-EC-02`～`05`；其餘五項都是設定與金鑰層面，
可以並行。所以「得獎後 30 天內公開 listing」（`COMP-10`）真正的風險不在上架流程，而在經濟設計——
那是得獎後第一件要動的事，不是最後一件。

**本次衝刺不動主網**：主辦方明示不需要，而且 M3 功能凍結是 09-30。現在改設定只會讓提交版變不穩。


## 2026-09-29 後端部署（測試計畫閘門①已開）

l1 與 l2 依 `deploy/l1/deploy.sh`（l2 以 `DEPLOY_HOST` 指定）部署完成，02:18–02:19 UTC。
實際套用 **0020_share_metrics** 與 **0021_seasonal_achievements**；`0019_skr_orders` 早已套過
（`schema_migrations` 已有紀錄，腳本正確跳過）。l2 的 migration 也跳過——兩台共用外部 DB，
這是預期行為，不是漏做。

`https://api.neonshift.cc/v1/seasonal` 從 **404 變 200**，回 `{"items":[]}`——正確，
因為三屆 `enabled` 全是 `false`。`POST /v1/metrics/share` 回 **202**，證明 0020 的表真的可寫。
兩台的 `healthz`／`readyz`（含 `db: ok`）都通過。

**部署前先確認過的風險，記下來供下次參考**：
- `0021` 是 `DROP CONSTRAINT IF EXISTS` 後重建兩個 CHECK，看起來有破壞性，但新約束是舊的**嚴格超集**
  （只把 `'seasonal'` 加進允許清單），既有資料不可能違反。
- 真正的風險是「`schema_migrations` 若為空，腳本會從 0001 重跑，而 0001～0003 非冪等」。
  無法事前查（DB 查詢被工具政策擋下），但確認過這是**失敗即安全**：每個 migration 包在
  `BEGIN…COMMIT` 且 `ON_ERROR_STOP`，失敗會回滾並在 `systemctl restart` **之前** `exit 1`，
  所以最壞情況是「新程式碼在磁碟上、舊程序仍在跑、DB 未變」。實際執行時該表本來就存在。

**解鎖的測試**：B-1（節日足跡讀取，那個「讀取失敗」警示應該消失）、B-3（分享計數）、
B-3b（SKR devnet，需先在 api.env 開 `SKR_ENABLED`）、B-4（活動雙角色）。

**還缺一個決定才能測 B-2**（節日提醒與本機排程通知）：三屆 `enabled` 全 false，
目前沒有可訂閱的屆別、提醒開關不會出現。打開哪一屆要先人工核對該屆的日期依據，
那是負責人的決定。
