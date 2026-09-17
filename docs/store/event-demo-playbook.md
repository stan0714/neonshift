# Demo 情境：活動流程與展示手冊（PG-D-03 附件）

更新：2026-09-17。狀態：dev 環境 fixture 已建立並可操作；主片／活動詳解尚未錄製；Wallet B（Lv.2+）尚未養成。本文件是 [demo-video.md](demo-video.md) 與 [judges-guide.md](judges-guide.md) 引用的角色、資料、狀態與例外的唯一來源。

## 1. 情境一句話

「荒野守護體驗日」：一位每天走路的玩家（Wallet A）在 App 完成當日打卡 → 在裝備頁看到保育跑鞋與盲盒細節款 → 報名測試活動 → 現場向 staff 出示報到碼 → 報到後預留紀念毛巾 → 主辦方發布成績 → 符合資格者領活動留念章。全部在 devnet／dev 後端，不是真實合作活動，沒有捐款。

## 2. 角色與錢包

| 角色 | 錢包 | 由誰持有 | 用途 | 狀態 |
|---|---|---|---|---|
| A 參加者（主角） | Seeker 上的 Phantom `AcBU…vbV2` | 專案負責人 | 打卡、報名、報到碼、預留權益、看成績、領章 | 可用；今日步數 6,348（8,000 未達） |
| B 已升階玩家 | 待養成（可為 A 本人） | 專案負責人 | 展示 Lv.2+ 保育鞋、細節款與升階揭曉 | **未達成**：需 XP ≥ 450（每日步數任務 +100、睡眠 +50；只有步數 → 5 天，步數＋睡眠 → 3 天）。沒有管理員加 XP 指令，也不該有 |
| S 現場 staff | `B5gsSiLZ3cL1N6AKRHtuJis4GhPQCuFxDNJvyMJc91T7` | 團隊（`~/.config/neonshift/dev/demo/demo-staff.json`） | 報到確認、權益交付（綁 Gate 報到站） | 可用（以腳本或匯入 Phantom 後用 App Staff tools） |
| O 主辦方 owner／成績 | `4sUmyriePDzJvyr8vm4zPzJP7fVv1fMVJwWHrjrNAZm1` | 團隊（`demo-owner.json`） | 建活動、規則、站點、品項、成績匯入與發布 | 可用（僅腳本） |

金鑰只在 `~/.config/neonshift/dev/demo/`，不進 repo、不公開；OPS token 只在 l1 `/etc/neonshift/api.env`。

## 3. 測試活動 fixture（dev 後端，已建立）

由 `backend/scripts/demo-event.mjs` 產生，幂等可重跑；產出登錄在 `~/.config/neonshift/dev/demo/fixture.json`。

| 項目 | 值 |
|---|---|
| API | `http://l1.neonshift.cc:6080/v1`（api.neonshift.cc nginx 尚未安裝；提交版 APK 改回 https 後需重跑一次腳本核對） |
| 組織 | `wild-guardians` · 荒野守護 Wild Guardians（測試主辦方） · `9acb6a7f-846d-41ec-af95-17fe3dd769db` |
| 活動 | `wild-guardian-day` · `d67d6da9-4a4b-4b75-9702-28ded6dcb5dc` · state `published` · Asia/Taipei |
| 時窗 | 報名 2026-09-17 → 2026-10-17；活動進行中 2026-09-17 → 2026-10-17（測試用長時窗，任何一天都能彩排；正式版改實際日期） |
| 規則 v1 | `distance_m 3000`、河濱 3 km 體驗走／跑、成績由主辦方 CSV 發布、教育示範不宣稱合作或捐款 |
| 站點 | Gate 報到站 `b1d8cd5a-…`（check_in）；Booth 權益攤位 `e38b4169-…`（redemption） |
| 品項 | 荒野守護紀念毛巾（實體，100 份，需報到）；體驗日數位守護章（digital_badge，需報到） |
| 留念章 | `badges.check_in = true`、`badges.finish = true`；資格：報名時鞋階 ≥ Lv.2（`EVENT_BADGE_MIN_LEVEL`）＋ 報到／完賽 |
| NFC | 標籤 `https://neonshift.cc/e/wild-guardian-day?tag=sYKN3BqDmRtJuuWOpDWTuOz8y4dRkdEK`（寫入 NDEF URI 即可；NFC 只開活動，不等於出席證明） |

重跑／更新：

```bash
cd backend
OPS_TOKEN="$(ssh root@l1.neonshift.cc "grep '^OPS_TOKEN=' /etc/neonshift/api.env | cut -d= -f2-")" \
  bash -lc 'source ../scripts/env.sh; node scripts/demo-event.mjs http://l1.neonshift.cc:6080'
```

## 4. 彩排腳本（每步的操作者、畫面、資料來源、可驗證點）

### 4.1 日常任務與打卡（Wallet A，實機・DEVNET）

| 步 | 操作 | 畫面 | 資料來源 | 驗證 |
|---|---|---|---|---|
| 1 | 當日走到 ≥ 8,000 步（Seeker 內建計步 → Health Connect） | Home「今日步數」 | HC `com.android.healthconnect.phone.*`（視同裝置來源） | Home 數字 = HC「Steps」頁 |
| 2 | Home → 任務卡「打卡」→ 20 秒步態檢查 → 錢包簽章 | 打卡流程 | 後端 attestation → 鏈上 `claim` | Explorer 交易；tSKR +10；XP +100 |
| 3 | Gear 頁 XP／倍率變化 | Gear | 鏈上 PlayerProfile | XP ring 增加 |

限制：GPS 運動紀錄不是打卡資料來源；沒有睡眠 App 時睡眠任務不會達標（旁白不要說「睡眠也完成」）。

### 4.2 保育跑鞋與盲盒（Wallet B 或 Demo 入口）

| 步 | 操作 | 畫面 | 標籤 |
|---|---|---|---|
| 1 | Gear → 點任一跑鞋卡 → 詳情面板（鞋階、XP、倍率、解鎖條件、紀念 NFT 狀態、物種故事） | 詳情 Sheet | Wallet B：`實機・DEVNET`；否則 `預先建立的測試資料`／Demo 入口 |
| 2 | Lv.2+ 大圖旋轉、細節款（晨曦／暮色／極光） | ShoeHero | 款式是 App 外觀（wallet＋series＋level 固定雜湊），不是 NFT 隨機屬性 |
| 3 | 升階揭曉（只有真的達到 450 XP 那一次） | EvolutionReveal | 不假演；沒有就用 Demo 入口的鞋款圖鑑 |
| 4 | 試拆盲盒（示意）：Gear → 未解鎖跑鞋詳情 →「試拆盲盒（示意）」，或 Demo 圖鑑 Lv.2+ 卡片同名按鈕 | RevealCeremony（DEMO 標籤） | 標 `設計示意`：全螢幕 5.6 秒（蓄力→搖晃→爆開→鞋子進場→擺動展示），可「再播一次」；鞋後有物種背影剪影、下方收藏銘牌 `No. 0001`（示意編號）；用系列展示樣式，不揭露細節款、不改等級 |

Wallet B 養成排程：從今天起每天 ≥ 8,000 步並打卡；第 5 個打卡日升 Lv.2（若能補睡眠紀錄則第 3 天）。要在報名「體驗日」**之前**升到 Lv.2，留念章才有資格（報名時快照）。

### 4.3 活動：發現 → 報名（Wallet A，實機）

| 步 | 操作 | 畫面 | 驗證 |
|---|---|---|---|
| 1 | Arena → 合作活動 → 「荒野守護體驗日」 | 活動詳情：時區、名額、規則 v1、品項、留念章 | `GET /v1/events/{id}` 同值 |
| 2 | 報名（接受規則 v1；公開同意可關） | 報名成功、狀態「待報到」 | `GET /v1/events/{id}/registration` |

### 4.4 現場報到（雙角色）

| 步 | 操作者 | 操作 | 驗證 |
|---|---|---|---|
| 1 | A | 活動頁「開啟報到碼」→ 120 秒代碼（或 NFC 標籤開啟活動） | 畫面顯示倒數 |
| 2 | S | 手動輸入代碼：`node scripts/demo-staff.mjs http://l1.neonshift.cc:6080 check-in <code>`（或第二台手機以 staff 錢包用 App Staff tools） | 回 `checked_in` |
| 3 | A | 重新進入活動頁 → 「已報到」 | `GET …/registration` |

例外要拍：代碼過期重新取得；同一代碼第二次輸入被拒（不是 200）。

### 4.5 權益：預留 → 交付

| 步 | 操作者 | 操作 |
|---|---|---|
| 1 | A | 活動頁品項「荒野守護紀念毛巾」→ 預留 → 顯示領取碼（預留 ≠ 已拿到） |
| 2 | S | `demo-staff.mjs … fulfill <claim_code>` → 狀態「已交付」 |
| 3 | O | `demo-staff.mjs … status` 對帳：預留／交付／剩餘 |

### 4.6 成績發布（主辦方）

`node scripts/demo-staff.mjs http://l1.neonshift.cc:6080 results <A 的錢包> 1260000 1` → 匯入 CSV（schema v1）並發布 → A 在活動頁看到「本人成績 · 來源 主辦方 · 版本 1」。更正：再跑一次帶新時間，App 顯示新版本與原因。標「活動後／主辦方測試 CSV」。

### 4.7 活動留念章（需 Wallet B 資格）

報名時 Lv.2+ ＋ 已報到 → 活動頁「領取報到章」→ 預覽公開內容與 rent → MWA 簽章 → 結果。registry 若待同步，畫面誠實顯示待處理。沒有 Lv.2 錢包就標「未達資格」，不假演。

### 4.8 藝廊：看別人的 NFT 成就（示範玩家，devnet 真實帳戶）

沒有其他真人玩家時，用 `tools/chain-admin` 建三位示範玩家（demo 專屬金鑰 `~/.config/neonshift/dev/demo/demo-player-<n>.json`，不進 repo、不動任何人的錢包）：

```bash
OPS_TOKEN="$(ssh root@l1.neonshift.cc "grep '^OPS_TOKEN=' /etc/neonshift/api.env | cut -d= -f2-")" \
  NEONSHIFT_API_URL=http://l1.neonshift.cc:6080/v1 \
  bash -lc 'source scripts/env.sh; npm --prefix tools/chain-admin run admin -- demo-gallery dev [--dry-run]'
```

| 玩家 | 內容 | 鏈上／後端 |
|---|---|---|
| Runner A | Origin 收藏 ＋ 首 5K、首 10K 兩枚里程碑 NFT（device） | `init_player`、`claim_collectible(1)`；匯入兩筆 gps 摘要 → mint-intent → admin registry → `claim_achievement` |
| Runner B | Origin ＋ 首 5K 一枚 | 同上，一筆 |
| Walker C | 只有 Origin（示範「還沒有成就」的玩家頁） | 匯入一筆健走，無里程碑 |

流程幂等（帳戶存在即跳過、匯入以 external_record_id 去重、已鑄造不重送）；產出 `~/.config/neonshift/dev/demo/gallery-fixture.json`（錢包、asset、tx）。devnet faucet 限流時腳本會提示手動領 SOL 後重跑。

| 步 | 操作 | 畫面 | 標籤 |
|---|---|---|---|
| 1 | Home → Gallery（未登入會出現就地「簽署登入訊息」卡） | 排行：現役榜／歷史榜、搜尋地址前綴 | `實機・DEVNET` |
| 2 | 點 Runner A → 玩家頁：鞋階、XP、收藏（Origin）、首次里程碑（First Spark／Double Horizon） | 玩家頁 | 玩家是預先建立的示範帳戶，但鏈上資料真實 |
| 3 | 點作品 → NFT 詳情：系列、原達成者、鑄造日期、來源（裝置）、Explorer 連結 | AchievementDetail | Explorer 可實際打開 |
| 4 | 點 Walker C → 只有 Origin、成就區為空狀態 | 玩家頁 | 誠實呈現「還沒有成就」 |

限制：示範玩家的里程碑來自匯入的運動**摘要**（距離／時間，不含座標），與真人流程一樣經後端 PB／里程碑判定與 admin registry；沒有 GPS 軌跡可看。PB 作品（fastest_5k 等）需當日 Lv.3，示範玩家沒有。

## 5. 錄影前 checklist

- [ ] 提交版 APK（同 commit、同 API）已裝；Metro 關閉仍可用。
- [ ] Wallet A 當日未打卡、步數 ≥ 8,000、有 devnet SOL。
- [ ] Wallet B 已 Lv.2（或明確標示以 Demo 入口替代）。
- [ ] `demo-event.mjs` 重跑一次核對 state `published`、時窗未過。
- [ ] 彩排 4.3 → 4.4 → 4.5 一次，留 `status` 輸出與截圖。
- [ ] `demo-gallery dev` 已跑過、Gallery 列出 Runner A／B 與 Walker C（indexer 抓到事件後）。
- [ ] 每個鏡頭標籤：`實機・DEVNET`／`預先建立的測試資料`／`設計示意`／`未來規劃`。

## 6. 已知限制（誠實呈現）

- api.neonshift.cc 未安裝 nginx vhost：目前 App 直連 `http://l1:6080`（僅測試包）。
- Seeker 無 SIM：戶外沒有網路，報名／報到／成績需 Wi-Fi；運動記錄與語音提示可離線。
- 睡眠任務需有寫入 Health Connect 的睡眠 App；Seeker 目前沒有。
- 沒有 NFC 出席證明、沒有聯名系列切換、沒有捐款機制；NFT 款式尚無獨立 metadata（見 [荒野守護設計](../design/wild-guardian-shoes.md)）。
