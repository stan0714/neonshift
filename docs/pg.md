# NeonShift 程式開發文件（PG — Program Guide & Progress Tracker）

| 項目 | 內容 |
|---|---|
| 文件版本 | v0.2（與 SA／SD v0.2 同步並修正進度治理） |
| 建立日期 | 2026-09-09 |
| 上游文件 | [BRD v0.4](./brd-detailed.md)、[SA v0.2](./sa.md)、[SD v0.2](./sd.md) |
| 建置流程 | [Build & Test Runbook](./build-and-test.md) |
| UI 規範 | [Style Guide v0.1](./style.md) |
| 衝刺期間 | 2026-09-10 至 2026-10-08（四週） |
| 官方截止 | 2026-10-08；內部提交目標 10-07，10-08 僅作提交失敗的應變緩衝 |

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
| PG-C 鏈上程式 | 18 | 0 | 21.5 | Anchor 帳戶、指令、測試 |
| PG-B 後端服務 | 19 | 0 | 19.5 | API、風險引擎、簽章、索引 |
| PG-A 行動 App | 22 | 0 | 27.0 | 原生橋接、畫面、交易組裝 |
| PG-D 交付物 | 6 | 0 | 6.0 | APK、素材、影片、Pitch |
| **合計** | **73** | **0** | **80.5** | 不含風險緩衝 |

**人力假設**：內部提交目標前共有 20 個週一至週五日曆日，尚未扣除國定假日、請假與會議。80.5 人天是無中斷的基準估算；加入 20% review、整合與返工緩衝後約為 96.6 人天，實務上需要約 5 人全職。若只有 4 人，名目容量僅 80 人天且沒有任何風險空間，必須在第一週依第 7.1 節完成範圍變更，而不能等到第三週才砍功能。這對應 BRD Q-01。

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
| PG-I-01 | Monorepo 結構（app / backend / programs） | SD 2.1 | — | 0.5 | TODO | |
| PG-I-02 | 校正 Build Runbook 至 SA／SD v0.2，建置 Node.js 24 LTS、JDK 與 Android SDK 環境 | Runbook 1, SD 2.2 | — | 0.5 | TODO | |
| PG-I-03 | Expo 專案初始化、prebuild、提交 android/ | Runbook 2, 3 | C-01 | 1.0 | TODO | |
| PG-I-04 | CI：lint、單元測試、debug APK 產出 | SD 7 | — | 1.0 | TODO | |
| PG-I-05 | 後端骨架與 PostgreSQL docker compose | SD 2.2 | — | 0.5 | TODO | |
| PG-I-06 | Anchor 專案骨架與 localnet 測試環境 | SD 3 | — | 0.5 | TODO | |
| PG-I-07 | dev／demo 分離部署腳本與 build-time 環境參數管理 | SD 8 | BR-14 | 1.5 | TODO | |
| PG-I-08 | 經典 SPL Token tSKR（6 decimals）建立、固定供給、撤銷 authority | Runbook 7.4, SD 1.2 | BR-22 | 1.0 | TODO | |

---

## 4. PG-C 鏈上程式

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-C-01 | Config 帳戶與 `initialize_config` | SD 3.1, 3.2 | — | 1.0 | TODO | |
| PG-C-02 | `update_config` / `rotate_attestor` 與 pause 流程 | SD 3.2 | BR-24 | 1.0 | TODO | |
| PG-C-03 | PlayerProfile 與 `init_player` | SD 3.1 | — | 0.5 | TODO | |
| PG-C-04 | Attestation canonical bytes 解析與 ed25519 指令驗證 | SD 3.5 | BR-14, BR-15 | 2.0 | TODO | |
| PG-C-05 | `clock_in` 檢查順序主流程 | SD 3.3 | BR-03, BR-14, BR-15 | 2.0 | TODO | |
| PG-C-06 | 獎勵計算定點數、連續加成與每日上限 | SD 3.4 | BR-02, BR-04, BR-06 | 1.0 | TODO | |
| PG-C-07 | ClaimReceipt PDA 與重放防護 | SD 3.1 | BR-03 | 1.0 | TODO | |
| PG-C-08 | XP、shoe_level、core_level 三者分離 | SD 3.1 | BR-23 | 1.0 | TODO | |
| PG-C-09 | `mint_shoe`（Metaplex Core） | SD 1.2 | FR-04.1 | 1.5 | TODO | |
| PG-C-10 | `upgrade_core` 燒毀與入庫原子性 | SD 6.1 | BR-16 | 1.0 | TODO | |
| PG-C-11 | Tournament 帳戶、專用 vault、`open`／`lock`／`start_tournament` | SD 3.1, 3.2 | BR-18, BR-19, BR-22 | 1.5 | TODO | |
| PG-C-12 | `join_tournament` 質押與 vault PDA | SD 3.2 | BR-22 | 1.0 | TODO | |
| PG-C-13 | `begin_settlement`、`submit_results_batch` 與 rolling hash 驗證 | SD 3.2, 6.2 | BR-20 | 1.5 | TODO | |
| PG-C-14 | `settle_tournament` + `claim_prize` 與資金守恆斷言 | SD 6.2 | BR-17 | 2.0 | TODO | |
| PG-C-15 | `forfeit_entry` 與證據摘要 | SD 3.2 | BR-21 | 0.5 | TODO | |
| PG-C-16 | `refund_all` 賽事取消退款 | SD 3.2 | BR-19 | 0.5 | TODO | |
| PG-C-17 | 錯誤碼 6000-6022 與事件定義 | SD 3.6 | — | 0.5 | TODO | |
| PG-C-18 | 鏈上測試：單元、property、攻擊案例 | SD 7 | 全部 | 2.0 | TODO | |

---

## 5. PG-B 後端服務

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-B-01 | Fastify 骨架、設定載入、健康檢查端點 | SD 2.2 | — | 0.5 | TODO | |
| PG-B-02 | 資料庫 schema 與 migration | SD 4.5 | — | 1.0 | TODO | |
| PG-B-03 | `/auth/nonce` 與 `/auth/verify`（SIWS） | SD 4.2 | — | 1.5 | TODO | |
| PG-B-04 | JWT 與 refresh session 輪替、重用偵測 | SD 4.2 | — | 1.5 | TODO | |
| PG-B-05 | `/auth/challenge`：claim／tournament 敏感操作的單次授權 | SD 4.2 | — | 1.0 | TODO | |
| PG-B-06 | 健康摘要 ingest、來源／速率／live check canonicalization、request_hash | SD 4.2, 4.3 | BR-09 | 1.0 | TODO | |
| PG-B-07 | 風險規則集載入，保存單調 `rules_version` 與獨立 `rules_hash` | SD 4.4 | BR-13 | 1.0 | TODO | |
| PG-B-08 | 硬拒絕、夾限與 live check 邊界規則 | SD 4.4 | BR-07 至 BR-10, BR-12 | 1.0 | TODO | |
| PG-B-09 | 評分規則、權重與門檻 | SD 4.4 | BR-11, BR-12 | 1.0 | TODO | |
| PG-B-10 | AttestationSigner：相容 signer 與 164 bytes 組裝／測試向量 | SD 3.5, 4.6 | BR-14, BR-15 | 1.5 | TODO | |
| PG-B-11 | `POST /attestation/claim` 端點整合 | SD 4.3 | 全部風險規則 | 1.0 | TODO | |
| PG-B-12 | `GET /player/history` | SD 4.1 | — | 0.5 | TODO | |
| PG-B-13 | `DELETE /player/data` 與延後刪除邏輯 | SD 4.1 | BR-25 | 1.0 | TODO | |
| PG-B-14 | 賽事 API：current、steps、leaderboard 與逐操作 challenge | SD 4.1, 4.2 | — | 1.0 | TODO | |
| PG-B-15 | 排行榜、同分決勝與 settlement manifest／rolling hash | SD 4.1, 6.2 | BR-20 | 1.0 | TODO | |
| PG-B-16 | ChainIndexer：finalized 事件同步、orphan 回滾與 redeemed_sig 回填 | SD 2.1, 4.5 | — | 1.0 | TODO | |
| PG-B-17 | 30 天保留清理排程 | SD 4.5 | BR-25 | 0.5 | TODO | |
| PG-B-18 | 速率限制、audit log、告警與暫停流程、可觀測性指標 | SD 4.2, 9 | — | 1.0 | TODO | |
| PG-B-19 | 後端測試：規則、challenge／idempotency 重放、API 整合 | SD 7 | — | 1.5 | TODO | |

---

## 6. PG-A 行動 App

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-A-01 | 設計 token 與深色主題 | Style 18 | FR-08.4 | 1.0 | TODO | |
| PG-A-02 | 導航骨架與四個 Tab | SD 5.2, Style 2 | — | 0.5 | TODO | |
| PG-A-03 | Native Launch、Bootstrap Loading、Landing／Demo Preview | Style 8, 9 | — | 1.0 | TODO | |
| PG-A-04 | HealthConnectModule：來源歸因、aggregate 與速率摘要 | SD 5.1 | BR-05, BR-07, BR-08 | 2.5 | TODO | |
| PG-A-05 | SensorModule：20 秒引導式 live motion check 與特徵摘要 | SD 5.1 | BR-09 | 2.0 | TODO | |
| PG-A-06 | WalletModule：MWA 授權與 token 保存 | SD 5.1 | — | 1.5 | TODO | |
| PG-A-07 | ApiClient、JWT 續期、challenge 簽署 | SD 4.2, 5.1 | — | 1.0 | TODO | |
| PG-A-08 | TaskEngine：達標判定與 UTC 日界線 | SD 5.3 | BR-01, BR-05 | 1.0 | TODO | |
| PG-A-09 | TxBuilder：ed25519 前置指令與 Anchor 指令 | SD 3.5, 5.1 | BR-14 | 2.0 | TODO | |
| PG-A-10 | ChainClient：簽章／blockhash 保存、確認與 ClaimReceipt 冪等輪詢 | SD 5.3 | — | 1.5 | TODO | |
| PG-A-11 | Onboarding 四頁權限流程 | Style 10 | FR-02.5 | 1.5 | TODO | |
| PG-A-12 | Dashboard 儀表板 | Style 11 | FR-08.1 | 1.5 | TODO | |
| PG-A-13 | 打卡、live motion 引導與成功特效 | Style 15 | FR-03.1, FR-08.3 | 1.0 | TODO | |
| PG-A-14 | Gear 頁與升級流程 | Style 12 | FR-05.2 | 1.0 | TODO | |
| PG-A-15 | Arena 頁三種狀態 | Style 13 | FR-06.1, FR-06.2 | 1.5 | TODO | |
| PG-A-16 | 錯誤、離線與空狀態 | Style 14 | NFR 可用性 | 1.0 | TODO | |
| PG-A-17 | 跑鞋視覺五階與進化動畫 | Style 16.2 | FR-04.4 | 1.0 | TODO | |
| PG-A-18 | App 測試：單元、原生、E2E | SD 7 | — | 1.5 | TODO | |
| PG-A-19 | Health Connect 背景同步（WorkManager）與前景補同步 | SD 5.1 | FR-02.3 | 1.0 | TODO | |
| PG-A-20 | Activity history 畫面與歷史 API 串接 | Style 2, 19.1 | FR-03.5 | 0.5 | TODO | |
| PG-A-21 | Profile：權限、隱私、刪除資料與斷開錢包 | Style 2, 19.1; SD 5.3 | FR-01.4, BR-25 | 1.0 | TODO | |
| PG-A-22 | 在目前 MWA／Seeker 錢包驗證並顯示跑鞋 NFT | Style 7.4 | FR-04.5 | 0.5 | TODO | |

---

## 7. PG-D 交付物

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-D-01 | keystore、簽章設定、Release APK 流程 | Runbook 8 | — | 0.5 | TODO | |
| PG-D-02 | dApp Store 素材、描述、隱私政策 | BRD 14 | NFR 隱私 | 1.5 | TODO | |
| PG-D-03 | Demo 影片（3 分鐘內） | BRD 14 | — | 1.5 | TODO | |
| PG-D-04 | Pitch 簡報 | BRD 14 | — | 1.0 | TODO | |
| PG-D-05 | README 與架構圖 | BRD 14 | — | 0.5 | TODO | |
| PG-D-06 | 代幣經濟模擬試算表 | BRD 8.5 | BR-02, BR-16 | 1.0 | TODO | |

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
| DEC-02 | PG-I-08、PG-D-02 | SKR integration track 是否接受 tSKR（BRD Q-08） | 專案負責人 | 2026-09-10 | OPEN |

DEC-02 若判定必須整合主網官方 SKR，PG-I-08 的 tSKR 路線、SA 5.4 與鏈上金庫設計都必須重估；不得在現有四週估算內直接替換。

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
| `PG-C-05` 至 `C-09` | 打卡主流程與跑鞋鑄造 |
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
| `PG-C-10` | 升級原子性 |
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
| FR-04 動態 NFT | PG-C-08, PG-C-09, PG-A-17, PG-A-22 |
| FR-05 裝備升級 | PG-C-10, PG-A-14 |
| FR-06 錦標賽 | PG-C-11 至 C-16, PG-B-05, PG-B-14 至 B-16, PG-A-15 |
| FR-07 風險驗證 | PG-A-04, PG-A-05, PG-B-06 至 B-09, PG-B-19 |
| FR-08 UI | PG-A-01, PG-A-03, PG-A-12, PG-A-16 |
| NFR 安全 | PG-C-02, PG-C-04, PG-C-18, PG-B-04, PG-B-05, PG-B-10, PG-B-18, PG-B-19 |
| NFR 隱私 | PG-A-21, PG-B-13, PG-B-17, PG-D-02 |
| NFR 可觀測性 | PG-B-16, PG-B-18 |

本表用於確認每個 M 級 FR 至少對應一個 PG 項目；基礎建設與交付物則以各工作列的「對應設計」欄追溯。新增或變更需求型 PG 項目時必須同步更新本表。

---

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
