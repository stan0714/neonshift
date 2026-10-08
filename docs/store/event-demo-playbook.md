# 合作活動：評審展示與操作手冊

更新：2026-09-18。活動模組已有 App／API 實作，PG-E-10 與 PG-M-04 實機端到端驗收仍待完成。本文件是展示準備，不代表已有正式合作或已部署可用 fixture。

入口：[評審指南](judges-guide.md)｜[影片腳本](demo-video.md)｜[提交追蹤](clock-in-submission.md)。

## 1. 情境與角色

使用「荒野守護體驗日」作為**測試活動**：參加者先日常運動，再參加現場活動、取得符合資格的權益與紀念，最後回到日常任務。品牌與保育機構合作尚屬提案，不使用其 Logo 冒充合作。

- 參加者 P：自己錢包，報名、呈示代碼、查成績／領取資格。
- 現場 staff S：另一裝置／錢包，只取得測試活動必要權限，確認報到與交付。
- 主辦方 O：團隊持有 owner／result_editor／publisher 權限，設定、發布及更正；目前以 API 操作，沒有完成的網頁管理後台。

合作活動不等於 Arena 質押錦標賽。報名不意味質押 tSKR，也不意味完成健康任務。

## 2. 全流程與證據

| 階段 | 參加者操作 | 主辦方／staff 操作 | 成功證據與重要界線 |
|---|---|---|---|
| 發現 | Arena → 合作活動；或已驗證的活動連結 | 發布有時區、容量、規則版本的活動 | 詳情可讀；只有發布中的有效活動可報名 |
| 報名 | 看規則，選擇是否公開顯示資料，確認報名 | 服務端檢查時窗、容量與接受版本 | 本人報名狀態；公開同意不是強制報名條件；不是鏈上交易 |
| 到場 | App 內選站點，或 NFC 開啟活動；取得短效 QR／8 碼 | 授權 staff 在 App 輸入代碼確認 | 參加者重載後為已報到；NFC 只提供入口，不自動證明到場；相機掃 QR 未完成 |
| 權益 | 符合規則才預留，顯示領取碼 | staff 核對並完成實體交付 | 預留、交付分開；現有保留期 15 分鐘，庫存與每人上限依設定；數位徽章與實體物品分開 |
| 成績 | 查看本人成績與來源 | 測試 CSV → staging／逐列驗證 → publisher 發布；更正需原因 | 主辦方來源、版本與更正紀錄；不能說 GPS 自動成為官方成績 |
| 活動章 | 檢查資格、公開資料與 rent，MWA 簽署 | 主辦方已開啟章別；必要 registry 同步 | 報到章／完賽章分開；報名時 Lv.2 快照、對應資格及 registry 就緒才可領；成功才附 Explorer |
| 回訪 | 回看歷程、回到日常運動／鞋款介紹 | 觀察實際報名／到場／領取彙總 | 自動邀請、主題任務綁權益與聯名款為後續規劃，不宣稱現成 |

### 各種資料不能混用

| 資料 | 權威來源 | 展示方式 |
|---|---|---|
| 日常健康打卡 | Health Connect 摘要＋後端 attestation＋鏈上程式 | 真實 devnet 交易；不公開原始健康資料 |
| GPS 即時運動 | 手機運動記錄器 | 運動體驗畫面，不等於官方完賽或健康任務資格 |
| 報名／報到／庫存 | 活動後端與授權操作 | App 狀態、對帳、稽核；不每一步都要求 Explorer |
| 活動成績 | 主辦方發布／更正 | 明示來源與版本；不是健康來源驗證 |
| 活動 NFT | 已核實資格＋registry＋錢包交易 | NFT 確認發行，不使現場運動本身自動可鏈上驗證 |
| 保育盲盒外觀 | 系列／錢包／等級的固定分配 | App 造型，不是安全隨機抽取、NFT 稀有度或保育捐款 |

## 3. 錄影 fixture 準備（由團隊操作）

依 [建置手冊 §7.8、§7.9](../build-and-test.md)操作 API／registry；不把 access token 或 ops 命令輸出放到公開影片。

1. 記錄 demo API、APK、Commit、Program ID；確認服務可用。
2. 建立或核實測試組織與測試活動，名稱明示 DEMO。設定 Asia/Taipei 及實際拍攝／評審有效時窗，不直接沿用過期範例日期。
3. 建立並發布規則版本，確認容量足以讓評審新錢包加入。登錄 slug、event ID、規則 revision。
4. 建立 check-in 站點；指定 staff 最小權限。現有交付站點權限約束仍有待辦，正式試辦前須補驗收，不能宣稱跨站權限已全部完成。
5. 配置示範權益、庫存與資格；若拍實體交付，準備真實示範物品，標記非真實品牌贊助。
6. 活動章需要在報名前決定章別；P 若要領章，先具備報名時 Lv.2 條件。不能先用不合格帳號報名再改資料假裝原有資格。
7. 用獨立測試成績 CSV，標示測試資料；先驗證錯誤列不能發布，再發布正確版；準備一筆更正例。
8. NFT 拍攝前確認 registry 同步、鏈上帳戶與 SOL；首次操作卡在 pending 時保留真實狀態，不剪成秒領。
9. 主片只取已驗收的報名→報到片段；完整步驟改由本手冊承接，不再要求六分鐘影片。時間跳轉、預先建立的資料、不同帳號皆加字幕。
10. 評審 fixture 與錄影 fixture 分開或留下足夠名額／庫存。不得在有人試用時任意刪除、重設其資料；維護負責人與支援時段登錄於指南。

### Fixture 登錄（2026-09-24 重建為英文並核對；`backend/scripts/demo-event.mjs`，幂等）

評審與 Demo 影片以英文進行；活動資料是主辦方自填的單一字串、不走 App 的 i18n，英文介面裡冒出中文品項會像未在地化的缺陷。

| 欄位 | 值 |
|---|---|
| 測試活動 slug／ID／規則 revision | `wild-guardian-day-2026`／`ff478fd8-85ed-4b99-b263-9bceb14eb805`／`b7ac14b4-2c0b-4b73-8c1a-4c239002a425`（v1，state=published）· 標題 `Wild Guardian Day (test event)` |
| 報名與活動起訖／時區 | 2026-09-24T00:59Z → 2026-10-24T01:59Z（Asia/Taipei）；容量 200，已報名 0 |
| 站點 ID／purpose | `Gate (check-in)` `5cdfc185-849f-426b-ac41-160c28dd832b`／check_in；`Booth (perk pickup)` `c2d59ea3-143e-45b0-86e8-2bf33470e280`／redemption |
| 測試權益／庫存／領取條件 | `Wild Guardian towel`（physical，100）；`Experience Day digital badge`（digital_badge，100,000）；`Last one on the shelf (test)`（physical，**1**，供最後一件競態測試）。三者皆每人 1、需報到。**品項建立後不可改名改庫存**（後端無 PATCH／DELETE） |
| 報到章／完賽章設定 | 皆開啟（報名時需 Lv≥2 才有資格，Lv1 顯示 level_locked） |
| 參加者／staff 公開地址 | 參加者＝負責人 Seeker 錢包；demo owner `4sUmyriePDzJvyr8vm4zPzJP7fVv1fMVJwWHrjrNAZm1`、demo staff `B5gsSiLZ3cL1N6AKRHtuJis4GhPQCuFxDNJvyMJc91T7`（金鑰只在 `~/.config/neonshift/dev/demo/`，不進 repo） |
| NFC 標籤 | 有效：`https://neonshift.cc/e/wild-guardian-day-2026?tag=jE6irsFYsOC5CvJmW9KlFaRVqR68IirU`；**已停用（測試用）**：`…?tag=WbB9O_K3PCYqHbppBU2q0mkXasjpoNv-` |
| API／APK／Commit | `https://api.neonshift.cc/v1`（直連驗證走 `$NEONSHIFT_L2_API`）／提交版 APK 見 `docs/evidence/<日期>-release-candidate.md` |
| registry 狀態／Explorer | 待真機鑄造後登錄 |
| 支援人／時段／維護期 | 待負責人指定 |
| 舊的中文活動 | `wild-guardian-day`／`d67d6da9-4a4b-4b75-9702-28ded6dcb5dc` 保留未動，供真機驗收第 11 步「取消活動」測試使用 |

App 內 staff 需要第二個錢包帳號：`node backend/scripts/demo-event-admin.mjs $NEONSHIFT_L2_API add-staff <第二帳號位址> check_in`（同工具另有 `show`／`revoke-tag`；**沒有** set-stock——品項建立後不可改庫存，低庫存品項須在建立 fixture 時備好）。

## 4. 沒有 NFC、健康資料或 staff 時

- **無 NFC**：使用 Arena → 合作活動 → 詳情 → 顯示報到碼／選站點。NFC App Links 正式指紋未驗收前，不列為唯一入口。
- **無合格 Health Connect**：可看保育圖鑑、公開活動與規則；一般活動報名不等於每日打卡。NFT 章仍需實際資格，不保證新錢包五分鐘拿到。
- **無 staff 在場**：評審可走到報到碼，剩餘流程看雙角色補充片或安排團隊支援；不提供公共 owner／ops 密鑰，也不讓參加者替自己報到。
- **斷線**：不得離線假顯示已報到／已交付。恢復後重查狀態；人工補登需授權與原因。

## 5. 必拍／必驗例外

| 情況 | 應看到的行為 | 證據欄（待補） |
|---|---|---|
| 重複報名／容量用盡 | 不重複占位／額滿提示 |  |
| 規則更新 | 要求重新確認正確版本 |  |
| 120 秒代碼過期／已使用 | 拒絕或顯示既有狀態；不重複報到 |  |
| staff 權限不符 | 拒絕操作，不只隱藏按鈕 |  |
| 最後一件同時預留 | 庫存不負數、不雙重承諾 |  |
| 預留逾期／重複交付 | 逾期不能交付；重試不扣兩次庫存 |  |
| 活動取消 | 說明原因、不可再報名／交付、處理預留 |  |
| 撤回公開同意／更正成績 | 公開資料依設定更新，更正保留來源與版本 |  |
| 尚無 NFT 資格／registry 待同步 | 明確原因，不顯示假成功 |  |

以上是驗收清單，不宣稱本次已重新執行。影片可選一至兩個例外，其餘保留測試／實機證據供查閱。

## 6. 程式與規格入口

| 主題 | 來源 | 現況 |
|---|---|---|
| 列表／報名 | [EventScreens](../../app/src/screens/events/EventScreens.tsx) | App 已實作；實機待驗收 |
| 代碼／staff | [CheckInCode](../../app/src/screens/events/CheckInCode.tsx)、[StaffCheckIn](../../app/src/screens/events/StaffCheckInScreen.tsx) | 代碼輸入；相機掃碼未完成 |
| 預留／交付 | [Perks](../../app/src/screens/events/Perks.tsx)、[後端活動路由](../../backend/src/partner/routes.ts) | 有實作；交付站點約束與實機驗收待補 |
| 成績／隱私 | [Results](../../app/src/screens/events/Results.tsx)、[CSV](../../backend/src/partner/csv.ts) | API 匯入／發布；主辦方網頁未完成 |
| 活動章 | [EventBadges](../../app/src/screens/events/EventBadges.tsx)、[資格規則](../../backend/src/milestones/eventBadges.ts) | 有實作；registry／實機端到端待驗收 |
| 主題任務／下一場／聯名 | [PG](../pg.md)、[系列設計](../design/wild-guardian-shoes.md) | 區分 PG-XD 待辦與既有活動功能 |

## 7. 如何讓評審看見細節

- 主片 2:02–2:42 必須出現活動入口與雙角色確認，片尾說明完整流程入口。
- 英文主片目標 2:50、最多 3:00；上述六階段由本手冊提供深入說明。影片說明欄放本手冊與評審指南，不只放 QR。
- 參賽短 Pitch 安排一頁「日常→活動→回訪」，旁邊分列已實作、待實機、未來；34 頁募資版 v3 第 5 頁可作活動內容底稿，第 13–15 頁作保育素材，第 16–22 頁作永續方向參考。
- 不把活動收入假設、主題鞋款、保育故事說成已簽合作。要讓評審知道「接下來怎麼用」，也知道「今天能驗證到哪裡」。
