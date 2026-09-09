# NeonShift 程式開發文件（PG — Program Guide & Progress Tracker）

| 項目 | 內容 |
|---|---|
| 文件版本 | v0.1 |
| 建立日期 | 2026-09-09 |
| 上游文件 | [BRD v0.4](./brd-detailed.md)、[SA v0.2](./sa.md)、[SD v0.2](./sd.md) |
| 建置流程 | [Build & Test Runbook](./build-and-test.md) |
| UI 規範 | [Style Guide v0.1](./style.md) |
| 衝刺期間 | 2026-09-10 至 2026-10-08（四週） |
| 提交日 | 2026-10-08，緩衝日 10-07 |

> **本文件是唯一的開發進度來源**。每個工作項有編號、對應設計章節、完成定義與狀態。狀態更新直接改本檔並提交，不另開試算表。

---

## 1. 使用方式

### 1.1 狀態代碼

狀態欄只能填以下六個值之一，方便機器統計。

| 代碼 | 意義 | 何時改成這個 |
|---|---|---|
| `TODO` | 未開始 | 初始值 |
| `WIP` | 進行中 | 開始寫第一行程式時 |
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
awk -F'|' '/^\| PG-[A-Z]-[0-9]/ {gsub(/[ \t]/,"",$7); t++; if($7=="DONE") d++} END {printf "%d/%d (%.0f%%)\n", d+0, t, (d+0)*100/t}' docs/pg.md

# 目前阻塞項
grep -E '^\| PG-[A-Z]-[0-9].*BLOCKED' docs/pg.md

# 各模組進度
awk -F'|' '/^\| PG-[A-Z]-[0-9]/ {gsub(/[ \t]/,"",$2); gsub(/[ \t]/,"",$7); split($2,a,"-"); m=a[2]; t[m]++; if($7=="DONE") d[m]++} END {for (k in t) printf "%s: %d/%d\n", k, d[k]+0, t[k]}' docs/pg.md | sort

# 剩餘人天（未完成項目）
awk -F'|' '/^\| PG-[A-Z]-[0-9]/ {gsub(/[ \t]/,"",$6); gsub(/[ \t]/,"",$7); if($7!="DONE") s+=$6} END {printf "剩餘 %.1f 人天\n", s}' docs/pg.md
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
| PG-A 行動 App | 18 | 0 | 24.0 | 原生橋接、畫面、交易組裝 |
| PG-D 交付物 | 6 | 0 | 6.0 | APK、素材、影片、Pitch |
| **合計** | **69** | **0** | **77.5** | — |

**人力假設**：77.5 人天 ÷ 20 個工作天 ≈ 需要 4 人全職。若團隊人數不足，第 7 章的降級順序必須立即啟動。這對應 BRD 的 Q-01，是目前最高優先的待確認事項。

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
| PG-I-02 | 開發機環境與 Android SDK | Runbook 1 | — | 0.5 | TODO | |
| PG-I-03 | Expo 專案初始化、prebuild、提交 android/ | Runbook 2, 3 | C-01 | 1.0 | TODO | |
| PG-I-04 | CI：lint、單元測試、debug APK 產出 | SD 7 | — | 1.0 | TODO | |
| PG-I-05 | 後端骨架與 PostgreSQL docker compose | SD 2.2 | — | 0.5 | TODO | |
| PG-I-06 | Anchor 專案骨架與 localnet 測試環境 | SD 3 | — | 0.5 | TODO | |
| PG-I-07 | devnet 部署腳本與環境參數管理 | SD 8 | — | 1.5 | TODO | |
| PG-I-08 | tSKR mint 建立、固定供給、撤銷 authority | Runbook 7.4 | BR-22 | 1.0 | TODO | |

---

## 4. PG-C 鏈上程式

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-C-01 | Config 帳戶與 `initialize_config` | SD 3.1, 3.2 | — | 1.0 | TODO | |
| PG-C-02 | `update_config` / `rotate_attestor` 與 pause 流程 | SD 3.2 | BR-24 | 1.0 | TODO | |
| PG-C-03 | PlayerProfile 與 `init_player` | SD 3.1 | — | 0.5 | TODO | |
| PG-C-04 | Attestation canonical bytes 解析與 ed25519 指令驗證 | SD 3.5 | BR-14, BR-15 | 2.0 | TODO | |
| PG-C-05 | `clock_in` 檢查順序主流程 | SD 3.3 | BR-03, BR-14, BR-15 | 2.0 | TODO | |
| PG-C-06 | 獎勵計算定點數與每日上限 | SD 3.4 | BR-02, BR-04 | 1.0 | TODO | |
| PG-C-07 | ClaimReceipt PDA 與重放防護 | SD 3.1 | BR-03 | 1.0 | TODO | |
| PG-C-08 | XP、shoe_level、core_level 三者分離 | SD 3.1 | BR-23 | 1.0 | TODO | |
| PG-C-09 | `mint_shoe`（Metaplex Core） | SD 1.2 | FR-04.1 | 1.5 | TODO | |
| PG-C-10 | `upgrade_core` 燒毀與入庫原子性 | SD 6.1 | BR-16 | 1.0 | TODO | |
| PG-C-11 | Tournament 帳戶、`open_tournament`、`lock_tournament` | SD 3.1, 3.2 | BR-18, BR-19 | 1.5 | TODO | |
| PG-C-12 | `join_tournament` 質押與 vault PDA | SD 3.2 | BR-22 | 1.0 | TODO | |
| PG-C-13 | `submit_result` 批次與 manifest 驗證 | SD 3.2 | BR-20 | 1.5 | TODO | |
| PG-C-14 | `settle` + `claim_prize` 與資金守恆斷言 | SD 6.2 | BR-17 | 2.0 | TODO | |
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
| PG-B-05 | `/auth/challenge` 單次敏感操作授權 | SD 4.2 | — | 1.0 | TODO | |
| PG-B-06 | 健康摘要 ingest、canonicalization、request_hash | SD 4.2, 4.3 | BR-09 | 1.0 | TODO | |
| PG-B-07 | 風險引擎規則集載入與 rules_version 綁定 | SD 4.4 | BR-13 | 1.0 | TODO | |
| PG-B-08 | 硬拒絕與夾限規則 | SD 4.4 | BR-07, BR-08, BR-10, BR-12 | 1.0 | TODO | |
| PG-B-09 | 評分規則、權重與門檻 | SD 4.4 | BR-11, BR-12 | 1.0 | TODO | |
| PG-B-10 | AttestationSigner：KMS 簽章與 164 bytes 組裝 | SD 3.5, 4.6 | BR-14, BR-15 | 1.5 | TODO | |
| PG-B-11 | `POST /attestation/claim` 端點整合 | SD 4.3 | 全部風險規則 | 1.0 | TODO | |
| PG-B-12 | `GET /player/history` | SD 4.1 | — | 0.5 | TODO | |
| PG-B-13 | `DELETE /player/data` 與延後刪除邏輯 | SD 4.1 | BR-25 | 1.0 | TODO | |
| PG-B-14 | 賽事 API：current、steps、leaderboard | SD 4.1 | — | 1.0 | TODO | |
| PG-B-15 | 排行榜計算與同分決勝 | SD 4.1 | BR-20 | 1.0 | TODO | |
| PG-B-16 | ChainIndexer 事件同步與 redeemed_sig 回填 | SD 2.1, 4.5 | — | 1.0 | TODO | |
| PG-B-17 | 30 天保留清理排程 | SD 4.5 | BR-25 | 0.5 | TODO | |
| PG-B-18 | 速率限制、audit log、可觀測性指標 | SD 4.2, 9 | — | 1.0 | TODO | |
| PG-B-19 | 後端測試：規則單元、API 整合 | SD 7 | — | 1.5 | TODO | |

---

## 6. PG-A 行動 App

| 編號 | 名稱 | 對應設計 | 規則 | 預估 | 狀態 | 負責人 |
|---|---|---|---|---|---|---|
| PG-A-01 | 設計 token 與深色主題 | Style 18 | FR-08.4 | 1.0 | TODO | |
| PG-A-02 | 導航骨架與四個 Tab | SD 5.2, Style 2 | — | 0.5 | TODO | |
| PG-A-03 | Launch 與 Landing 畫面 | Style 8, 9 | — | 1.0 | TODO | |
| PG-A-04 | HealthConnectModule Kotlin 橋接 | SD 5.1 | BR-05, BR-07, BR-08 | 2.5 | TODO | |
| PG-A-05 | SensorModule Kotlin 橋接與特徵摘要 | SD 5.1 | BR-09 | 2.0 | TODO | |
| PG-A-06 | WalletModule：MWA 授權與 token 保存 | SD 5.1 | — | 1.5 | TODO | |
| PG-A-07 | ApiClient、JWT 續期、challenge 簽署 | SD 4.2, 5.1 | — | 1.0 | TODO | |
| PG-A-08 | TaskEngine：達標判定與 UTC 日界線 | SD 5.3 | BR-01, BR-05 | 1.0 | TODO | |
| PG-A-09 | TxBuilder：ed25519 前置指令與 Anchor 指令 | SD 3.5, 5.1 | BR-14 | 2.0 | TODO | |
| PG-A-10 | ChainClient：送出、確認、冪等輪詢 | SD 5.3 | — | 1.5 | TODO | |
| PG-A-11 | Onboarding 四頁權限流程 | Style 10 | FR-02.5 | 1.5 | TODO | |
| PG-A-12 | Dashboard 儀表板 | Style 11 | FR-08.1 | 1.5 | TODO | |
| PG-A-13 | 打卡流程與成功特效 | Style 15 | FR-03.1, FR-08.3 | 1.0 | TODO | |
| PG-A-14 | Gear 頁與升級流程 | Style 12 | FR-05.2 | 1.0 | TODO | |
| PG-A-15 | Arena 頁三種狀態 | Style 13 | FR-06.1, FR-06.2 | 1.5 | TODO | |
| PG-A-16 | 錯誤、離線與空狀態 | Style 14 | NFR 可用性 | 1.0 | TODO | |
| PG-A-17 | 跑鞋視覺五階與進化動畫 | Style 16.2 | FR-04.4 | 1.0 | TODO | |
| PG-A-18 | App 測試：單元、原生、E2E | SD 7 | — | 1.5 | TODO | |

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

### 7.1 範圍降級順序

人力或時間不足時，**依此順序**砍，不要臨時討論。

| 順位 | 砍掉的項目 | 影響 |
|---|---|---|
| 1 | PG-A-17 跑鞋五階視覺降為三階 | 視覺豐富度，不影響機制 |
| 2 | PG-B-15 排行榜改為每日更新一次 | FR-06.2 從準即時降級 |
| 3 | PG-C-13 批次結算改為逐筆 | 參賽者多時成本上升 |
| 4 | PG-A-05 感測器摘要簡化為僅取樣率與振幅 | 風險評分準確度下降 |
| 5 | PG-C-11 至 PG-C-16 整組錦標賽 | **FR-06 全部退出，Demo 只剩打卡與升級** |

第 5 順位是最後手段。錦標賽是代幣消耗的主要來源，砍掉後經濟模型只剩升級一個 sink，Pitch 需同步調整說法。

---

## 8. 阻塞登錄

發現阻塞時在此登記，並把對應 PG 項目狀態改為 `BLOCKED`。

| 編號 | PG 項目 | 阻塞原因 | 需要誰 | 登記日 | 解除日 |
|---|---|---|---|---|---|
| BLK-01 | 全部 | 團隊人數與分工未定（BRD Q-01） | 專案負責人 | 2026-09-09 | |
| BLK-02 | PG-I-08、PG-D-02 | SKR integration track 是否接受 tSKR（BRD Q-08） | 專案負責人 | 2026-09-09 | |

BLK-02 的嚴重性要特別說明。若官方規則要求整合主網官方 SKR，PG-I-08 的測試代幣路線作廢，SA 第 5.4 節的經濟規則與整個鏈上金庫設計都要重做，四週時程不可能吸收。這題必須在第一週第一天問到答案。

---

## 9. 關鍵項目實作要點

以下十項是最容易做錯或最耗時的，額外展開。其餘項目依 SD 章節實作即可。

### PG-C-04 Attestation 驗證

**為什麼難**：整套重放防護建立在這裡，錯了不會報錯，只會靜默失效。

實作要點。從 `instructions` sysvar 讀取前一道指令，確認 program id 是 Ed25519 program。解析其 offsets header，確認只有一組簽章，且 signature、public key、message 三段的 offset 與長度都指向本筆交易內。取出 message 的 164 bytes，與本指令參數重建的 bytes 逐 byte 比對。

**完成定義**

- [ ] 正常 attestation 通過
- [ ] 缺少前置指令 → 6001
- [ ] 前置指令是別的 program → 6001
- [ ] 帶兩組簽章 → 6001
- [ ] 公鑰不符 → 6002
- [ ] message 差一個 byte → 6003
- [ ] program_id 換成別的 → 6004
- [ ] cluster_id 換成 mainnet → 6004
- [ ] wallet 換成他人 → 6005
- [ ] 未到 not_before → 6006
- [ ] 已過 expiry → 6007
- [ ] expiry - issued_at 超過 600 → 6008

### PG-C-05 clock_in 主流程

**為什麼難**：14 步檢查的順序不可調換，且與 PG-C-06、PG-C-07、PG-C-08 交織。

**完成定義**

- [ ] 依 SD 3.3 的 14 步順序實作，順序寫成註解對照
- [ ] `task_date` 不等於鏈上目前 UTC 日序 → 6019
- [ ] 同一 attestation 重送 → 6009
- [ ] 每日額度用盡 → 6010
- [ ] 額度部分剩餘時只發放剩餘量
- [ ] 事件 `ClockedIn` 含 wallet、task_date、task_type、amount

### PG-C-06 獎勵計算

**為什麼難**：定點數運算容易溢位或捨入方向錯誤。

**完成定義**

- [ ] 全程 u128 運算後才收斂回 u64
- [ ] 任一步驟溢位 → 6011
- [ ] Lv1 至 Lv5 五組倍率的計算結果與 BRD 8.3 表一致
- [ ] core_level 超出 Config 陣列範圍 → 6020
- [ ] 邊界測試：base 為 0、倍率為最大值、額度剩 1

### PG-C-14 資金守恆

**為什麼難**：這是最高等級告警項，出錯代表代幣憑空生成或消失。

**完成定義**

- [ ] `settle` 與每次 `claim_prize` 都執行守恆斷言
- [ ] 違反 → 6017
- [ ] property test：隨機 10 至 500 名參賽者、隨機名次，斷言恆成立
- [ ] 整數除法餘數歸國庫且記錄於事件
- [ ] 取消賽事的全額退款路徑同樣守恆

### PG-B-10 AttestationSigner

**為什麼難**：與 PG-C-04 必須位元組級一致，兩邊分別實作最容易對不起來。

實作要點。canonical bytes 的組裝邏輯寫成獨立模組並輸出測試向量檔案，鏈上測試直接讀同一份向量。這是避免兩邊各寫一套的關鍵做法。

**完成定義**

- [ ] 產出至少 20 組測試向量（JSON），鏈上與後端測試共用
- [ ] 私鑰經 KMS，程式碼與設定檔無私鑰字面值
- [ ] 簽章不包含金額欄位
- [ ] expiry 固定為 issued_at + 600 秒以內

### PG-B-08 / PG-B-09 風險引擎

**為什麼難**：門檻訂太嚴會誤傷真人，訂太鬆擋不住搖步機，只能靠資料校準。

**完成定義**

- [ ] 規則集以設定檔宣告，整份雜湊綁定 `rules_version`
- [ ] 硬拒絕與夾限先於評分執行
- [ ] 每條規則有正負案例測試
- [ ] API 回應不含風險分數與門檻數值
- [ ] 每次判定寫入 `risk_decisions`，含命中規則與版本
- [ ] 以真人與搖步機資料集達成攔截率 ≥ 90%、誤判率 ≤ 5%

### PG-A-04 HealthConnectModule

**為什麼難**：SPN 歸因是 2026 年 6 月才改的規則，資料來源判斷寫死就會失效。

**完成定義**

- [ ] 以 `aggregate()` 讀 UTC 當日步數
- [ ] 睡眠以 session 結束時間歸屬任務日
- [ ] 同時支援歷史 `android` 來源與動態取得的 SPN，**無硬編碼**
- [ ] 四種來源測資：裝置內建、動態 SPN、手動輸入、第三方寫入
- [ ] 後兩者不進入獎勵計算
- [ ] 權限被拒時回傳可辨識的錯誤供 UI 引導
- [ ] 跨午夜、時區切換、夏令時間三組測試通過

### PG-A-09 TxBuilder

**為什麼難**：ed25519 前置指令的 offsets header 要手工組，與 PG-C-04 對應。

**完成定義**

- [ ] 產生的 ed25519 指令能被鏈上正確解析
- [ ] 指令順序固定為 ed25519 在前、程式指令在後
- [ ] 交易大小在上限內
- [ ] 與 PG-B-10 的測試向量對得起來

### PG-A-10 交易冪等

**為什麼難**：RPC 逾時後重送會造成重複扣費，是使用者最有感的 bug。

**完成定義**

- [ ] 送出前先由 nonce 與 wallet 推導 ClaimReceipt PDA
- [ ] 逾時後改為輪詢該 PDA，**不重送交易**
- [ ] PDA 存在則視為成功並刷新餘額
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
| `PG-I-01` 至 `PG-I-06` | 全部環境與骨架 |
| `PG-A-01`, `A-02`, `A-03` | 設計系統與導航 |
| `PG-A-04`, `A-05` | 兩個 Kotlin 原生模組 |
| `PG-A-11` | Onboarding 權限流程 |
| `PG-B-01`, `B-02` | 後端骨架與 schema |
| `PG-C-01`, `C-03` | Config 與 PlayerProfile |
| `PG-C-04` | **提前做**，並產出測試向量 |

**PG-C-04 排在第一週是刻意的**。BRD 的 R-02 把 ed25519 驗證列為高風險，提前一週做完可以留出應變時間，也讓 PG-B-10 與 PG-A-09 有共用向量可依循。

### 第二週 09-17 至 09-23：M2

| 項目 | 說明 |
|---|---|
| `PG-I-07`, `I-08` | devnet 部署與 tSKR |
| `PG-C-05` 至 `C-09` | 打卡主流程與跑鞋鑄造 |
| `PG-B-03` 至 `B-06` | 登入、challenge、ingest |
| `PG-B-10`, `B-11` | 簽章與 claim 端點 |
| `PG-A-06`, `A-07`, `A-08` | 錢包、API、任務判定 |
| `PG-A-09`, `A-10` | 交易組裝與冪等 |
| `PG-A-12`, `A-13` | 儀表板與打卡 |

### 第三週 09-24 至 09-30：M3

| 項目 | 說明 |
|---|---|
| `PG-B-07` 至 `B-09` | 風險引擎與資料校準 |
| `PG-C-10` | 升級原子性 |
| `PG-C-11` 至 `C-16` | 錦標賽全套 |
| `PG-B-14` 至 `B-17` | 賽事 API 與清理排程 |
| `PG-A-14` 至 `A-17` | Gear、Arena、狀態、視覺 |
| `PG-C-18`, `PG-B-19`, `PG-A-18` | 三層測試 |
| `PG-D-06` | 經濟模擬 |

**錦標賽先寫資金守恆測試再寫實作**，這是 BRD 第三週明列的順序。

### 第四週 10-01 至 10-07：M4

| 項目 | 說明 |
|---|---|
| `PG-D-01` 至 `PG-D-05` | 全部交付物 |
| `PG-B-18` | 限流與可觀測性 |
| — | Bug 修復與效能打磨，不加新功能 |

10-01 起功能凍結。第四週出現的新想法一律記錄不實作。

---

## 11. 追溯矩陣

| 需求 | PG 項目 |
|---|---|
| FR-01 錢包連線 | PG-A-06, PG-A-07 |
| FR-02 健康數據 | PG-A-04, PG-A-08 |
| FR-03 打卡獎勵 | PG-C-04 至 C-07, PG-B-10, PG-B-11, PG-A-09, PG-A-10, PG-A-13 |
| FR-04 動態 NFT | PG-C-08, PG-C-09, PG-A-17 |
| FR-05 裝備升級 | PG-C-10, PG-A-14 |
| FR-06 錦標賽 | PG-C-11 至 C-16, PG-B-14, PG-B-15, PG-A-15 |
| FR-07 風險驗證 | PG-A-05, PG-B-07 至 B-09 |
| FR-08 UI | PG-A-01, PG-A-03, PG-A-12, PG-A-16 |
| NFR 安全 | PG-C-02, PG-B-04, PG-B-10, PG-B-18 |
| NFR 隱私 | PG-B-13, PG-B-17 |
| NFR 可觀測性 | PG-B-16, PG-B-18 |

反向檢查：每個 M 級 FR 至少對應一個 PG 項目，且無 PG 項目缺少上游需求。新增 PG 項目時必須同步更新本表。

---

## 12. 完成定義通則

除各項目自己的條件外，所有 PG 項目都要滿足這五條才算 `DONE`。

1. 程式碼已合併進 `dev`。
2. 該項目對應的測試存在且通過。
3. 涉及鏈上或後端介面的變更，SD 文件已同步更新。
4. 涉及使用者可見行為的變更，已在實機驗證過。
5. 沒有留下 `TODO` 或 `FIXME` 註解，有的話開新 PG 項目追蹤。
