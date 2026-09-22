# CLOCK IN 參賽開發與交付計畫

版本 1｜2026-09-21｜內部交付目標 2026-10-07（Asia/Taipei）。此日期不是官方截止時刻。

目標：完成可安裝、可理解、可驗證的 NeonShift 行動產品，並在不影響主賽作品品質下交付一條官方 SKR 整合流程。文件建立不代表功能完成或主辦方已核可資格。

依據：[參賽評估](skr-integration-assessment.md)、[提交追蹤](clock-in-submission.md)、[官方網站](https://solanamobile.radiant.nexus/)、[條款](https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf)。本計畫的工期、測試門檻與取捨是專案安排，不是新增官方規則。

## 使用者已確認事項

2026-09-21：使用者確認未接受 VC 投資，團隊僅本人且名單已確定。尚未明確確認天使投資與專案實際開始日期；不從最早 commit 推定。下列按單人投入安排，不假設已有 App／後端／QA 多人並行。

## 1. 交付範圍

### 主賽必交（P0）

- 真實手機可安裝的簽章 Android APK，包含 SMS／MWA、任務進度、GPS 運動／Activity、成就領取與收藏。
- 先修錢包無回覆、取消、返回與斷線恢復，完成冷啟動及低網路情境；不能只展示成功截圖。
- 示範一條有意義的 Solana 互動：真實任務確認或成就 NFT 領取，附交易與版本證據。若 NFT 資格／registry 尚未可用，不可假造領取；需修復或縮小對外範圍。
- 三分鐘內實機 Demo、評審可存取且可重建的 GitHub、產品簡報及評審操作指南。
- 測試資料、DEMO DATA、devnet tSKR 與真實個人紀錄必須可辨識；提交版本不啟用 demoLevel 覆寫。

### SKR 獨立獎（P1，平行但不能拖垮 P0）

首款 SKU：已驗證首次 5 km 成就的「Genesis Mint」收藏卡邊框。先讓它可在個人成就詳情／收藏卡實際選用與復原，避免把尚未完成的社群圖片匯出放入付款履約依賴。樣式為原創、純外觀、固定 SKR 價格；正式價格與收款地址待產品決策。

主線：取得成就資格 → 查看外觀 → SKR 訂單／費用 → MWA → 確認交易 → 外觀解鎖 → 選用 → 重新登入仍保有權限。

- 基礎成就不能買，NFT 原領取費用規則不變；SKR 不增加 XP、排名、成績或審核通過率。
- 實作前確認合格 5 km 資料來源與 registry 開放狀態。裝置版若仍 device_pending，就不能用本機 GPS 或 DEMO 覆寫解鎖真實付費資格；須完成真實資格流程或在範圍決策時改用已驗證可用的成就。
- 真實付費訂單只接受指定正式資料環境的服務端資格；devnet receipt、測試 API 或客戶端旗標不得授予正式 SKU。
- 外觀以 App 權限履約，暫不另鑄付費 NFT；不修改已保存路線背景。未來分享卡只讀既有快照。
- 主網與 devnet 分開的設定／錢包授權／API／快取，禁止把現有全 App cluster 直接改為主網，導致任務金庫與 NFT 誤切網路。

### 本屆暫緩（P2）

完整 3D 鞋模、特殊路線挑戰完整平台、SKR staking、SKR 贊助獎池、Arena 改真實資金、付費 NFT 二次鑄造、捐款與聯名。保留既有規劃，不作本次提交承諾。若 P0 尚有阻斷，先停止新增動畫與非必要視覺功能。

## 2. 規則對照與證據

| ID | 規則／交付要求 | 本案動作 | 完成證據 | 目前狀態 |
|---|---|---|---|---|
| COMP-01 | 專案年齡及既有作品新開發（條款 6.1） | 確認實際起始日期；按 9/8 起算，不能早於 6/8；列出本屆新增功能 | 負責人聲明＋真實歷史／功能 diff；commit 本身不足 | TODO／待使用者 |
| COMP-02 | 人員、地區、募資、單一提交資格 | 固定名單與代表；核對是否另隊提交及 VC／天使資金；募資草稿不代表已募資 | 私下資格核對結論；證件不入 repo | WIP：單人／無 VC 已確認；天使投資、其他資格待確認 |
| COMP-03 | 登記與提交時限 | 確認報名已完成、精確時區與表單限制；未確認不推定寬限 | 報名收件與官方時間證據 | TODO |
| COMP-04 | Android APK、SMS／MWA、Solana 互動 | release 冷安裝、真機完整流程 | APK hash、commit、裝置／OS／錢包版本、錄影與交易 | WIP／沿用程式，待本版驗收 |
| COMP-05 | 評審可取得四项素材 | 檢查 APK／GitHub／影片／簡報權限與版本 | 未登入測試或評審指定存取測試 | TODO |
| COMP-06 | 三分鐘 Demo | 目標 2:50、實測 ≤3:00；以原六段稿重剪，非追加 SKR 造成超時 | 最終影片 duration／網址 | TODO |
| COMP-07 | 可查作者、技術與新開發 | 可重建、保留歷史、標依賴及 AI 輔助；排除 secrets | 乾淨環境 build 紀錄、licenses、release tag | TODO |
| COMP-08 | 非機密提交、素材權利 | 檢查動物圖、字型與商標授權；WWF notice 草稿不等於授權 | 素材來源清單、移除無依據聯名／保育成果宣稱 | TODO |
| COMP-09 | 提交後固定隊員／最終表單不可任意改 | 最終核對名單、代表、四連結再提交 | 提交收件／表單副本 | TODO |
| COMP-10 | 得獎後上架及入圍驗證 | 預先準備 publisher、隱私政策、release signing、商店素材；全員配合驗證 | 以實際公告日起算 30 天內公開 listing，不只送審 | TODO |
| COMP-11 | SKR 獎實質整合 | 官方 mint 的可用功能與交易證據；確認 devnet 替代展示政策 | 主辦回覆＋SKR 實機證據包 | TODO；DEC-02 OPEN |

主賽四項各 25% 的評分映射：任務／Activity 對應持續使用；錢包恢復與任務可理解性對應 UX；成就限定外觀與行動資料連動對應創新；實機操作與證據對應展示。這些是改善方向，不能保證分數或得獎。

## 3. 開發拆解與依賴

負責人為使用者本人；下列角色是同一人的工作職責，不是多位成員。估算包含相關單元測試，不含外部核可、真實成就資料取得及商店審查等待。

| 工作 | 交付／完成定義 | 依賴 | 角色 | 粗估人日 | 狀態 |
|---|---|---|---|---:|---|
| COMP-W01 | 支援 SDK 的 session 中止策略；取消後舊回覆不寫登入／授權；斷開不無限等待；不自動重送交易 | Wallet review | App | 2–3 | TODO |
| COMP-W02 | 任務→GPS→同步→資格→NFT／鏈上確認→收藏，一條真實可重播流程 | W01、可用後端／鏈 | App＋後端／QA | 1–2 | TODO |
| SKR-01 | 獨立 SKR 網路配置、mint owner／decimals 驗證、單位運算、環境隔離 | COMP-11 設計假設註記 | App＋後端 | 1 | TODO |
| SKR-02 | SKU／版本、資格、wallet、價格、期限與訂單參照由服務端決定；SIWS owner 綁定 | 可用真實資格、SKR-01 | 後端 | 1–2 | TODO |
| SKR-03 | 購買預覽、SOL／SKR 不足、取消、確認中；每次交易可理解且不重扣 | W01、SKR-02 | App | 1–2 | TODO |
| SKR-04 | 確認付款、唯一 receipt、交易鎖內授權；錯 mint／收款人／網路拒絕 | SKR-02 | 後端 | 2 | TODO |
| SKR-05 | 訂單恢復、晚到付款、過期／異常付款處理、關 App 重開不重扣 | SKR-03／04 | App＋後端 | 1–2 | TODO |
| SKR-06 | Genesis Mint 邊框在收藏卡／詳情選用、換帳戶隔離、重裝恢復 | SKR-04 | App | 1 | TODO |
| SKR-07 | 付款對抗測試、真機成功及失敗證據；官方 SKR 小額測試前完成審查 | SKR-01～06 | QA／負責人 | 2 | TODO |
| COMP-R01 | APK 乾淨重建、權限／隱私／授權、回歸與版本凍結 | W02，SKR 若納入則 SKR-07 | 發布／QA | 1–2 | TODO |
| COMP-R02 | 2:50 Demo、簡報狀態修正、操作指南、連結驗證 | COMP-R01 | 產品／展示 | 1–2 | TODO |

合計約 14–21 人日，尚未計外部等待。距 10/7 的日曆時間不等於可用人日；單人不能同時承諾所有上限。9/23 依單人可用時數決定 SKR 是否進本屆版本。先完成 W01／W02，再接 SKR；預留最後 4 天給回歸與素材。剩餘容量不足時採主賽版本，不壓縮付款恢復或真機驗收。

## 4. 時程與退出條件

| 內部日期（台灣） | 交付點 | 決策 |
|---|---|---|
| 9/21–9/23 | COMP-01～03、11；確認真實成就來源、SKU、資金／收款人；W01 方案 | 未核實資格不得標可提交；但工程與測試可繼續 |
| 9/24–9/27 | W01／02；SKR-01／02／04 基礎；一條 mock 訂單到權限流程 | mock 必須標示，只是測試，不構成 SKR 完成 |
| 9/28–9/30 | SKR-03／05／06，完整端到端與安全回歸 | 缺真實資格或付款恢復就縮回主賽；不靠換名 tSKR 補足 |
| 10/1 | SKR Go／No-go | 只有真實可用流程、測試與所需核准齊備才納入 SKR 完成宣稱 |
| 10/2–10/4 | 真機測試、官方 SKR 小額證據（如已核准）、release candidate | 高嚴重度錯誤先修；未完成 SKR 以功能旗標關閉並如實揭露 |
| 10/5–10/6 | 凍結 APK／commit，錄製、清潔安裝、獨立照指南操作 | 錄影若修 bug，重建并更新相應證據，不能混版本 |
| 10/7 | 四素材與名單最終核對、提交 | 以確認後的官方時間為準，若更早則整體提前 |
| 公告後 D+0～D+30 | 資格／身分驗證、商店公開上架 | D+7 準備送審、D+21 追蹤；延長需主辦書面同意，不預設有寬限 |

SKR No-go 不自動取消主賽；主賽仍需自身資格與實機 gate 全數通過。尚未完成主賽 gate 時，不為趕日期發布錯誤宣稱。

## 5. SKR 付款驗收契約

- 訂單狀態：created → awaiting_payment → confirming → fulfilled；另有 expired／needs_review。錢包取消不代表鏈上付款失敗；送出不等於完成。
- 訂單不可變欄位：network、wallet、SKU／版本、mint、最小單位金額、recipient、reference、期限、資格引用與來源環境。
- 交易由服務端查鏈，驗證成功與既定確認層級、來源帳戶擁有者、目的 token account、mint、實收數量、訂單參照。同一 signature／付款不可替第二張訂單授權。
- receipt 與 entitlement 原子寫入，並發重試返回同一結果；查單 API 需登入且限本人。
- 過期後才觀察到的付款需以鏈上時間和訂單規則處理；未知先顯示確認中／人工處理，不要求再付。
- 手機／API timeout、reinstall、wallet 切換後可查單復原；pending 資料按 network＋wallet 隔離。
- 平台不保存使用者私鑰；退款／人工處理責任人與政策上線前確定。主網測試需另行核准具體金額、收款人與部署，不由本規劃代為交易。
- 不將 SKR 外觀權限或購買事件寫成 GPS 成績／XP／NFT 已領取。可選外觀不得改既有 routeAppearance 快照。

## 6. 發布驗收與證據包

每項記錄「預期、實際、版本、證據、測試者、日期」，只有實測才標 PASS：

- 錢包：未安裝、取消、連點、背景返回、已核准未回覆、session 過期、切帳戶、無 SOL／SKR、重開與斷線。
- 運動：GPS 權限／無訊號、暫停恢復、離線保存、由舊到新同步、待審與正式資格區隔、UTC 換日；不人工補造健康資料。
- NFT：未達標、待 registry、核准、取消、成功、重複領取、回覆遺失查 receipt；官方 SKR 付款與 devnet NFT 明示各自網路。
- UI：冷啟動、窄螢幕、字體放大、中英、Reduce Motion、返回鍵、舊路線背景固定。
- 發布：release APK 無 debug／demoLevel；API／RPC 可達；安裝包、影片、GitHub 與簡報同版；無私鑰、健康資料或團隊證件洩漏。

證據清單至少包含 APK SHA-256、versionCode、commit、建置步驟、Android／錢包版本、測試結果、chain／mint／asset／signature、最終素材網址与影片實測長度。記錄放 evidence/，私密資格核對僅留結論，不放原始文件。

三分鐘影片內部分配：產品與任務 25 秒、運動／Activity 35 秒、成就確認與收藏 35 秒、SKR 實際用途 45 秒、結果／證據與價值 30 秒，共 170 秒。SKR No-go 時重寫該段，不能保留完成宣稱。九頁評審版附錄供問答，不等於影片已符合時長。

## 7. 提交前判定

可提交條件：COMP-01～09 已有充分證據，P0 無阻斷錯誤，四素材可存取且一致；商店與入圍流程已有可執行安排。SKR 完成宣稱另需 SKR-01～07 通過。

目前結論：規劃完成；資格、單人可用時數、真機、正式 SKR 與提交證據仍有 TODO。不可宣稱已完全符合規則。負責人確認及主辦回覆到齊後更新本表；最終由主辦方判定資格。

## 8. 工程落地紀錄

2026-09-21（負責人＋Claude）：
- `scripts/app/build.sh`：demo（提交）環境 release 強制 `EXPO_PUBLIC_DEMO_LEVEL=0`、禁止 `EXPO_PUBLIC_DEV_ROUTE`、後端必須 https；release-notes 增列 versionCode、SHA-256、ABI、建置時間、demoLevel 與 dirty 標記（COMP-04／R01）。
- `scripts/release/evidence.sh`：產出 `docs/evidence/<日期>-release-candidate.md`——APK SHA-256／badging／release-notes、adb 裝置與錢包版本、§6 驗收矩陣（預期／實際／證據／測試者／日期）、鏈上與素材欄位（COMP-04／05）。
- `docs/legal/asset-sources.md`：素材來源與授權盤點，TTS／音樂授權待確認（COMP-08）。README 新增可重建／作者／AI 輔助／素材權利段（COMP-07）。
- **待決（阻斷 COMP-R01）**：`deploy/demo.env` 的 `PROGRAM_ID`／`TSKR_MINT` 仍空——提交版若以 demo 環境建置會顯示「本版未啟用鏈上功能」。需在 9/23 決定：(a) demo 環境沿用 dev 的 devnet program／mint（改 demo.env 回填即可，不需重新部署），或 (b) 以 `~/.config/neonshift/demo/` 金鑰另行部署（需 devnet SOL 與負責人確認）。在此之前實機驗收用 `dev release`（同一 devnet program，唯一差別是環境名稱與資料保留策略）。
- 已完成的 P0 相關修正：錢包不回覆分類與指引（`3bdb64a`）、Arena 登入卡（`c60dd14`）、錢包連接 review（`c3669e5`＋`626e5e3`）、離線狀態校正（`a86392d`）。COMP-W01 的 SDK session 中止策略仍 TODO。

2026-09-21 晚（SKR Go，負責人指示）：
- SKR-01～06 程式完成（後端 `90a8ec7`、App `7ab256f`）：設定守門、目錄／資格、訂單／reference／期限、付款查驗、receipt 唯一＋權限原子履約、復原與取消規則、App 主網獨立授權簽送、餘額預檢、confirming 退避、pending 持久化、Genesis 邊框卡與里程碑卡套用。契約見 SD「2026-09-21 官方 SKR 外觀付款」。
- SKR-07：自動測試 backend 11（停用／資格／冪等／重放／他人付款／錯 mint／金額不足／交易失敗可重付／逾期寬限／復原／取消／刪除／設定守門）＋ App 12（指令位元組、目錄核對、餘額擋下、取消／不回覆、RPC 未見不重付、既有 confirming 不重付、卡片狀態與邊框）。**真機證據未補**。
- **待負責人決定（阻斷 10/1 Go 宣稱）**：(1) 正式價格（最小單位，建議 2.5 SKR＝2,500,000）；(2) 收款錢包公鑰（主網，非 devnet 測試錢包；建議獨立錢包）；(3) 是否先以 devnet TEST mint 試跑（`scripts/chain/skr-test-mint.sh dev create`，需 devnet SOL）；(4) 主網小額實測的金額與時間。l1 目前 `SKR_ENABLED` 未設定＝停用，App 卡片不顯示。

2026-09-21 深夜（負責人授權「請給建議並直接進行」）——SKR 決策與執行：
1. **價格**：2.5 SKR（`SKR_GENESIS_FRAME_PRICE=2500000`）。理由：純外觀、單次、與 NFT 免費領取區隔；金額小到不構成付費門檻，但足以在主網留下真實交易證據。提交前可調，訂單金額寫入時固定。
2. **收款錢包**：新建專用金鑰 `~/.config/neonshift/skr/recipient.json`（chmod 600，不入 repo），公鑰 `8Wp3Xyfw49KiA1CYL34bPLm59KHLbcBYRotyTF3gFa1k`，主網與 devnet 共用同一收款公鑰（ATA 各網路分別）。理由：與 admin／attestor 金鑰分離、不動負責人個人錢包；正式營運前建議改為硬體或 Seed Vault 錢包並轉出。
3. **devnet 試跑已就緒**：TEST mint `8JgVMChveNJ3ggEtiY8qHmuTHH3qayh69ijZzwXA1i5A`（dev admin 建立，6 decimals），收款 ATA 已建，負責人錢包 AcBU…vbV2 已收到 10 TEST SKR（tx `2x5MPeT…ugdt`）。l1 `/etc/neonshift/api.env` 已設 `SKR_ENABLED=true SKR_NETWORK=devnet …`，API 啟動 log `SKR ready`；實機 Gear → Milestones 底部顯示「Genesis Mint frame · TEST SKR · DEVNET · LOCKED」（無 first_5k 成就，符合資格規則）。
4. **主網小額實測**：待負責人錢包持有真實 SKR 後，把 l1 改為 `SKR_NETWORK=mainnet-beta`、`SKR_MINT=SKRbvo6…hW3`（收款公鑰不變）並重啟，由負責人親自核准一筆 2.5 SKR；在此之前維持 devnet TEST。**提交版必須是主網設定**（config.ts 守門會拒絕 devnet 沿用官方 mint、主網沿用測試 mint）。
5. 真機驗收前置：負責人需完成一場 ≥ 5 km 的 GPS 跑步並同步 → 後端產生 first_5k 里程碑（pending_registry）→ ops 登錄 approved（`tools/chain-admin` registry 流程）→ 卡片變為可購買。

2026-09-22：COMP-W01（MWA session 中止策略）落地——`app/src/services/wallet/mwaGuard.ts`：所有 MWA 操作經守門，App 回前景後 8 s 無回覆或 120 s 硬逾時 → `WALLET_NO_REPLY`（呼叫端以「可能已送出」處理：打卡查 receipt、SKR recover、登入重試）；晚到結果丟棄；放棄後標記 stale 90 s（原生 invoke 逾時），登入卡提示下一次請求可能等待。**未做**：直接呼叫原生 `endSession` 中止（transact 的 finally 會二次呼叫並在原生層丟例外，有崩潰風險，需上游 SDK 支援）。測試 5。

