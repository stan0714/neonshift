# CLOCK IN 2026：NeonShift 提交與 Demo 追蹤

建立：2026-09-18；更新：2026-10-02
提交日期：2026-10-08（官方精確時刻與時區待確認）  
內部目標：**2026-10-05 正式提交並取得回執**（Asia/Taipei；建議 18:00 前）。依使用者 9/29 指示提前，非官方截止。現況與每日排程以 [10/5 衝刺計畫](submission-sprint-2026-10-05.md) 為準。

本文件統整提交注意事項、待辦、驗收證據、時程及 Demo 流程。初始狀態依官方公告與本機文件／建置設定的靜態檢查建立；未據此宣稱 APK 已通過實機驗收、線上環境可用或 GitHub 已公開。

本次開發排程與 gate 以 [參賽開發計畫](competition-development-plan.md) 為準；本文件保留提交物追蹤。

## 1. 更新方式

- 狀態使用 `TODO`（未開始）、`WIP`（進行中）、`BLOCKED`（有明確阻礙）、`DONE`（驗收完成）。
- 負責人尚未指派時填「待指派」。開始工作後補姓名、實際日期與阻礙。
- 標記 `DONE` 必須附可檢查的證據，例如 Release URL、Commit SHA、測試紀錄或錄影。
- 本文件追蹤提交準備；功能實作進度仍以 [PG](../pg.md) 為準，不因文件或腳本存在就把功能標為完成。
- 每次更新同步修改頁首日期與末尾更新紀錄。未核實項目保留「待確認」。

## 2. 官方要求與待核對事項

查核日期：2026-09-21。本次讀取網站公開頁面文案及完整條款，詳細整理見 [SKR 整合評估](skr-integration-assessment.md)。

來源：

- [本屆官方公告](https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon)
- [官方報名入口](https://solanamobile.com/hackathon)，目前導向 [Radiants 活動網站](https://solanamobile.radiant.nexus/)。

| 項目 | 已確認內容／限制 |
|---|---|
| 提交日期 | 官方公告列 2026-10-08，未列精確時刻與時區 |
| 四項提交物 | 可運行 Android APK、GitHub 原始碼、操作 Demo 影片、Pitch Deck 或簡短產品介紹 |
| GitHub 公開與 Commit 歷史 | 網站要求評審可存取程式碼與 commit 歷史；公開可讀是本案交付策略 |
| Demo 長度 | 網站 Brief 明列三分鐘 Demo；本案目標 2:50，檔案限制仍待確認 |
| Pitch 內容／頁數 | 本文件建議的商業模式、Roadmap 與 9 頁架構不是官方固定格式 |
| dApp Store | 得獎公告後 30 個日曆天內完成公開上架，僅送審不足 |
| SKR | 整合為選配獨立獎項；tSKR 不代表已整合官方 SKR |

完整條款與公開表單欄位本次已讀取；未登入提交。專案年齡、募資與身分資格須依本屆條款核對，詳見新增評估文件。

| ID | 待辦／驗收條件 | 狀態 | 負責人 | 目標日期 | 證據／備註 |
|---|---|---|---|---|---|
| RULE-01 | 確認截止時刻、時區及台灣時間換算 | TODO | 待指派 | 09/23 | 保存報名收件、官方時刻與時區；不得以內部日期替代 |
| RULE-02 | 確認影片長度、檔案大小、連結權限、Pitch 格式 | TODO | 待指派 | 09/23 | 三分鐘已查核；檔案／表單限制仍待確認 |
| RULE-03 | 確認專案起始時間、既有作品、既往獲獎／募資、AI 使用等資格條款 | TODO | 待指派 | 09/23 | 以本屆條款為準 |
| RULE-04 | 確認 Devnet 展示是否符合要求；若參加 SKR 獎，確認實際整合要求 | **DONE 2026-09-29** | 主辦方回覆 | 09/23 | 主辦方明示：devnet＋真實錢包簽章與鏈上交易**可參加評審**，提交期限前不需要主網；SKR 獎接受 devnet＋tSKR，條件是整合邏輯健全且清楚呈現；**得獎後上架的版本必須在主網**，且兩者都要在主網運作才能領 USDC。原文存於 PG 2026-09-29 條目 |

## 3. 交付物總覽

| 交付物 | 初始檢查結果 | 狀態 | 完成定義 |
|---|---|---|---|
| Android APK | 有簽章設定與建置腳本；PG 尚記載正式 keystore／demo release 待完成 | WIP | 已簽章、可獨立啟動、乾淨安裝與核心操作驗收通過 |
| GitHub | README、架構、建置與進度文件已存在；公開權限未驗證 | WIP | 未登入可讀、歷史檢查完成、提交版本可對應 APK |
| Demo 影片 | 已有六段英文腳本與配音指南，目標 2:50；未生成音訊或成片 | WIP | 成片可播放、展示真實操作與鏈上結果、符合表單限制 |
| Pitch Deck | 十頁英文介紹投影片 v4（另有繁中對稿版）及 9 頁英文評審版 | WIP | 完成精簡參賽版、補團隊、區分實作與規劃、連結可讀 |

相關文件：[建置與測試](../build-and-test.md)、[部署說明](../../deploy/README.md)、[既有 Demo 腳本](demo-video.md)、[Pitch 追蹤](pitch.md)、[上架素材](listing.md)。影片時間軸以 Demo 腳本 v4 五段為唯一來源。

## 4. APK 與評審體驗

### 優先風險：健康資料與測試資源

既有 Demo 前置要求當日步數至少 8,000，以及足夠 devnet SOL 支付交易費；每日打卡不要求先持有 tSKR。新安裝的評審可能沒有健康資料、測試代幣或符合 NFT 領取條件。專案排除手動與部分第三方步數來源，不能假設手動補登即可通過驗證。

需決定並驗收以下體驗安排：

1. 一般路徑：自己的錢包 → Health Connect 授權 → 真實健康資料 → 打卡。
2. 無健康資料的體驗方式：列明仍可操作的功能；若新增示範資料模式，必須清楚標示，與真實健康驗證隔離，說明哪些資料模擬、哪些交易實際上鏈。此模式目前僅為建議，不代表已實作。
3. 評審指南：Android 版本、相容錢包、Devnet 設定、測試 SOL／tSKR 取得方式、已知限制與失敗恢復方式。不得公開團隊測試錢包私鑰。

### 建置方式

依現有流程，在正式 keystore 與 demo 環境準備完成後，於專案根目錄執行：

```bash
source scripts/env.sh
scripts/app/build.sh demo release
```

預期產物：`app/android/app/build/outputs/apk/release/app-release.apk`。

使用專案建置腳本；目前 Gradle 在缺少 release 設定時有 debug 簽章 fallback，而專案腳本會阻擋缺少 keystore 的 release 建置。最終仍需檢查產物憑證。keystore 與密碼不提交至 Git。

| ID | 待辦／驗收條件 | 狀態 | 負責人 | 目標日期 | 證據／備註 |
|---|---|---|---|---|---|
| APK-01 | 準備正式 keystore 並驗證 release 簽章 | TODO | 本人 | 09/27 | 關聯 PG-D-01；記錄憑證指紋 |
| APK-02 | 確認 demo 的 API、Program ID、Mint、Indexer、金庫與 RPC | TODO | 本人 | 09/27 | 記錄環境與端到端交易 |
| APK-03 | 關閉 Metro、拔除 USB 後可獨立啟動與操作 | TODO | 本人 | 09/27 | APK 版本＋裝置＋錄影 |
| APK-04 | 全新安裝、全新錢包完成連線、簽名、交易與結果更新 | TODO | 本人 | 09/27 | 交易簽章＋操作紀錄 |
| APK-05 | 無健康資料評審的體驗方式已決定、寫入指南並實測 | TODO（機制已補、**實測待做**） | 本人 | 09/23 | 2026-09-29：唯讀預覽原本只掛在登入前的 LandingScreen，連了錢包就回不去——指南那句「用公開預覽」對已登入的評審是死路。已在 Profile 補入口（`profile-demo-preview`）並在指南寫出確切路徑 Profile → Read-only preview。預覽本身不建立錢包／NFT／健康資料，文案明說。**仍需實機請一位沒有 Health Connect 紀錄的人試走**（DEMO-07 同一件事） |
| APK-06 | 權限拒絕、簽章取消、餘額不足、網路錯誤可理解且可恢復 | TODO | 本人 | 10/02 | 測試紀錄 |
| APK-07 | 重複打卡不重複發獎；UTC 換日行為正確 | TODO | 本人 | 10/02 | 對應帳號與任務日 |
| APK-08 | Seeker 實機驗收；一般 Android／模擬器相容性與限制有記錄 | TODO | 本人 | 10/02 | 型號、OS、錢包與 APK 版本 |
| APK-09 | 評審期間環境維護安排完成，開發部署不重設評審資料 | TODO | 本人 | 10/04 | 負責人、維護期間與恢復方式 |

部署文件記載 dev／demo 目前共用主機、正式 demo 待分離。共用主機本身不是問題，但需防止更新、資料清理或鏈上管理操作干擾評審。

## 5. GitHub 與版本證據

README 頂部應提供 APK、影片、Pitch PDF、五分鐘體驗步驟、Devnet 與合約資訊、已知限制、黑客松期間新增工作及對應 Commit／PR。

| ID | 待辦／驗收條件 | 狀態 | 負責人 | 目標日期 | 證據／備註 |
|---|---|---|---|---|---|
| REPO-01 | 檢查工作樹與 Git 歷史的私鑰、keystore、憑證及健康資料 | TODO | 本人 | 10/02 | 若有有效機密需撤換，僅刪檔不足 |
| REPO-02 | 補齊評審快速體驗、環境參數範例與已知限制 | TODO | 本人 | 10/02 | README／指南連結 |
| REPO-03 | 從乾淨 checkout 依文件完成建置驗證 | TODO | 本人 | 10/04 | 工具版本、Commit SHA、結果 |
| REPO-04 | 列明本屆新增功能與對應 Commit／PR，保留真實歷史 | TODO | 本人 | 10/04 | 不為外觀乾淨而抹掉開發歷史 |
| REPO-05 | 固定提交 tag，記錄 APK SHA-256、Commit SHA、版本與日期 | TODO | 本人 | 10/02 | 填入第 9 節 |
| REPO-06 | 未登入瀏覽器可讀 Repository 與下載交付物 | TODO | 本人 | 10/04 | 檢查時間與結果 |

## 6. Demo v4：三分鐘內英文主片

最新時間軸統一維護於 [Demo 腳本](demo-video.md)，本表只追蹤交付，避免兩份分鏡不同步。英文主片目標 2:50、上限 3:00：產品目的 → 運動成長 → 一筆真實打卡 → 保育鞋款 → 社群活動原型 → 下一步。英文旁白 288 字、六段；活動深度流程改由文字手冊承接。官方片長與 AI 使用規則仍需 RULE-02／03 核對。

評審入口為 [judges-guide.md](judges-guide.md)；活動角色、fixture、來源、例外與程式證據見 [event-demo-playbook.md](event-demo-playbook.md)。素材腳本完成不等於影片錄製、fixture 部署或端到端驗收完成。

| ID | 待辦／驗收條件 | 狀態 | 負責人 | 目標日期 | 證據／備註 |
|---|---|---|---|---|---|
| DEMO-01 | 重新設計三分鐘內英文主片與配音指南 | DONE | 文件整理 | 09/18 | demo-video.md v3、demo-voiceover-en.txt、demo-ai-voice-guide.md；288 字／六段，不含錄影或語音驗收 |
| DEMO-02 | 提交 APK 彩排打卡與活動雙角色報到 | TODO | 本人 | 10/03 | 交易、帳號、UTC 任務日、版本 |
| DEMO-03 | 主片錄製、字幕、真實／預設資料標註 | TODO | 本人 | 10/03 | 成片及原始素材 |
| DEMO-04 | 未登入播放、解析度／字體／時長符合規則 | TODO | 本人 | 10/04 | RULE-02 |
| DEMO-05 | 建立活動 fixture、支援角色、有效時窗及庫存 | TODO | 本人 | 09/27 | 活動手冊登錄；不公開密鑰 |
| DEMO-06 | 六段 AI 旁白試聽、英文字幕與最終混音 | TODO | 本人 | 10/03 | 同一聲線；核對發音、各段音檔上限與最終 ≤180 秒；取代舊六分鐘影片待辦 |
| DEMO-07 | 補齊評審指南連結、無健康資料／無 NFC 路徑 | TODO | 本人 | 10/02 | 請新使用者試走；無 staff 不假報到 |
| DEMO-08 | 核對已實作、實機待驗收與規劃口徑 | TODO | 本人 | 10/04 | PG-E-10、PG-M-04、PG-XD、盲盒外觀 |

## 7. Pitch 參賽版

目前參賽簡報為十頁英文 v4；以下保留早期約 9 頁內容建議，不是目前交付頁數或官方模板。

| 頁 | 主題 | 內容／注意事項 |
|---|---|---|
| 1 | 一句話定位 | 讓 Seeker 用戶把每日運動轉成可驗證成就與社群挑戰 |
| 2 | 使用者與問題 | 誰會每天用、既有方式的不足；不虛構訪談或實績 |
| 3 | 核心體驗 | 健康資料 → 打卡 → 鏈上紀錄 → 成長／收藏 |
| 4 | 手機與 Seeker 的價值 | Health Connect、動作感測、MWA 的實際用途 |
| 5 | Solana 的價值 | 可驗證領取、收藏歸屬與賽事結算 |
| 6 | 回訪理由 | 每日任務、成長、週期活動；無留存數據則標待驗證 |
| 7 | 商業模式假設 | 品牌贊助挑戰／活動服務費等候選方案，說明付費方與價值 |
| 8 | 現況與 Roadmap | 分開已實作、待實機驗收、未實作 |
| 9 | 團隊與體驗入口 | 團隊、APK、GitHub、影片 |

對外口徑：tSKR 非官方 SKR；不宣稱測試代幣有收益或金錢價值。既有 Pitch 已註明部分經濟保護未實作，參賽版須保留此界線。合作、營收、留存與市場數字需有來源或標明假設。

| ID | 待辦／驗收條件 | 狀態 | 負責人 | 目標日期 | 證據／備註 |
|---|---|---|---|---|---|
| PITCH-01 | 整理參賽版並補團隊、產品定位、商業假設及 Roadmap | TODO | 本人 | 10/03 | 工作檔位置 |
| PITCH-02 | 核對實作狀態、實績、數據來源與 tSKR 口徑 | TODO | 本人 | 10/03 | 對照 PG 與實機驗收 |
| PITCH-03 | 輸出 PDF，確認手機／桌面可讀、連結可點擊與存取 | TODO | 本人 | 10/04 | PDF URL |

## 8. 時程與最終提交

| 日期（2026） | 里程碑 | 完成條件 |
|---|---|---|
| 09/29–09/30 | 盤點、資格與風險修正 | review R1～R6 處理／可選功能收斂，停止新功能 |
| 10/01 | 實機主線與 SKR Go/No-go | 真實運動、交易、恢復證據；節日不通過則只列預覽 |
| 10/02 | 最終 RC 凍結 | 新 APK／commit／hash、核心 gate 通過 |
| 10/03 | 錄影、Pitch、外部試用 | 成片初版、PDF 與卡點清單 |
| 10/04 | 四項材料與連結驗收 | 表單草稿完成、未登入可存取 |
| 10/05 | 正式提交 | 回執／編號／表單副本保存 |
| 10/06–10/08 | 提交後必要修正 | 先核實官方是否允許更新，不預設可延後首次提交 |

| ID | 待辦／驗收條件 | 狀態 | 負責人 | 目標日期 | 證據／備註 |
|---|---|---|---|---|---|
| SUB-01 | 找未參與開發者，用自己的錢包依文件完成核心操作 | TODO | 本人 | 10/03 | 所需時間、卡點、交易連結 |
| SUB-02 | 四項交付物功能口徑與版本一致 | TODO | 本人 | 10/04 | 對照第 9 節 |
| SUB-03 | 填妥並送出官方表單，保存回執或提交編號 | TODO | 本人 | 10/05 | 不是只儲存草稿 |
| SUB-04 | 未登入逐一測試所有提交連結；確認不過期、不需申請權限 | TODO | 本人 | 10/04 | 最後檢查時間 |

## 8.5 官方規則摘要（2026-10-06 查）

來源：[條款 PDF](https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf)、官網與其公開 API（`align-api.radiant.nexus/hackathons/H5jQ…M1kb`）。

- **日程**：報名／開放提交 9/8 16:00 UTC；**提交截止 10/12 23:59 UTC**（主辦方 10/7 email 確認，見 §9）；評審 10/13～11/9；公布 11/10～11/11。
- **必交四項**（條款 §6.4）：可運作的 Android APK、GitHub repo、功能 Demo 影片（約 3 分鐘）、Pitch deck。
- **表單欄位**：專案名稱；是否曾獲 VC／天使資金（是／否）；是否在近 3 個月內建置（是／否）；是否曾以此專案得獎；新增的行動端開發（長文）；**是否有 SKR 整合及方式**（長文）；Deck URL；Demo 影片 URL（YouTube、Loom 或公開 Google Drive）；Repo URL；**APK 直接下載連結**。
- **修改**：截止前草稿可隨時修改；完成最終提交同意後不可再改。評審以截止前的提交與 GitHub commit 為準。
- **Repo**：可公開，或以團隊成員連結的 GitHub App 授權私有 repo（主辦方建立私有評審副本）。
- **評分**（各 25%）：黏著度與 PMF、使用體驗、創新、簡報與 Demo。
- **SKR 整合獎**（$10,000 SKR）：**SKR 質押整合不列入**；本案以 Genesis Mint 邊框的 SKR 付款為整合主體，質押只作 Roadmap。
- **得獎後**：公布後 30 天內須上架 Solana dApp Store；入圍須 KYC；USDC 獎限未獲 VC／天使資金者。

## 9. 最終交付登錄

| 欄位 | 值 |
|---|---|
| 官方精確截止時間／時區 | **2026-10-12 23:59 UTC**（主辦方 Hackathon Judge 10/7 email 回覆確認；活動頁 10/8 為錯誤日期、官網 API 的 11:59 UTC 亦不採用，主辦方另有公告） |
| 換算台灣時間 | **2026-10-13（二）07:59**。內部目標：**10/12（一）18:00 前完成最終提交**，保留整夜緩衝 |
| 提交負責人 | 使用者本人（單人參賽） |
| Repository URL | `https://github.com/stan0714/neonshift`（評審存取權待確認） |
| Release／Tag URL | 待填 |
| Commit SHA | `97a01cd`（10/4 RC，見 [RC 紀錄](../evidence/2026-10-04-rc-v21.md)） |
| APK 下載 URL | 待填 |
| APK versionName／versionCode | 0.1.0／21（10/4 RC，見 [RC 紀錄](../evidence/2026-10-04-rc-v21.md)） |
| APK SHA-256 | `d08cfd700274d36bec7c5527c956ecf2c27f1b5ad58e1656c1b503324e5ca777`（10/4 RC，見 [RC 紀錄](../evidence/2026-10-04-rc-v21.md)） |
| APK 簽章憑證指紋 | SHA-256 `c6b8bbb34b050ae3725c29dc8155d601875693f8c741356a1331d948fb5f4b04`（CN=NeonShift dev test；換正式簽章需重記） |
| 建置日期 | 2026-10-04T13:56:41Z（10/4 RC，見 [RC 紀錄](../evidence/2026-10-04-rc-v21.md)） |
| 評審指南 URL | 待填 |
| Demo 影片 URL／時長 | 待填 |
| 活動文字詳解 URL | 待填；不再要求長片 |
| AI 配音模型／voice ID／設定 | 待試聽與登錄 |
| 主片實測秒數／字幕版本 | 待匯出後量測；目標 177、上限 180 秒（11 頁 v4） |
| 測試活動／時窗／支援方式 | 待填，見活動手冊 |
| Pitch PDF URL | 待填（採 [11 頁英文 v4 PDF](../../output/hackathon-flexclip-en/flexclip-v4/NeonShift_FlexClip_v4_EN.pdf)；公開 URL 待 Release） |
| 網路／Program ID／Mint | devnet／`6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA`／tSKR `2itshf7Xup3WZeeDRSXbstv4nbPcjfiLhdDpcQjU7RtZ` |
| 核心操作 Explorer 連結 | 見 [RC v21 鏈上證據](../evidence/2026-10-04-rc-v21.md#鏈上證據devnet錢包-acbuvbv2)：InitPlayer、ClockIn、ClaimAchievement、ClaimCollectible、SKR（TEST）付款 |
| 驗收裝置／OS／錢包版本 | Solana Seeker／Android 16／Seeker Wallet 1.17.0 |
| 已知限制 | 見 [RC v21 已知限制](../evidence/2026-10-04-rc-v21.md#已知限制)：devnet／tSKR 無價值、僅 arm64-v8a、dev test 簽章、同 UTC 日領取、session 過期未實測 |
| 最後連結檢查時間 | 待填 |
| 提交時間／回執／編號 | 待填 |

## 10. 更新紀錄

| 日期 | 更新 | 證據／後續 |
|---|---|---|
| 2026-09-16 | 建立提交追蹤、官方查核界線、四項交付清單、Demo 分鏡與時程 | 初始為靜態檢查；尚未進行 APK 實機與提交連結驗收 |
| 2026-09-17 | Demo v2：新增評審指南與活動手冊，統一分鏡；更新募資稿版本 | 腳本 review 完成；影片、fixture 與實機驗收仍待完成 |
| 2026-09-18 | Demo v3：2:50 英文六段腳本、288 字純旁白與 AI 配音指南；長片改文字手冊，同步募資稿 v3 入口 | 時間與字數預算已檢查；語音、字幕、成片及實機仍待驗收 |


## 2026-09-19：跑鞋連動、同步與 Activity

參賽素材新增三項設計；驗收清單：切兩雙鞋並關背景、三筆離線運動依舊到新同步、Activity 篩選並開詳情。未完成 APK 實測前不得列為已交付功能。

完整需求、畫面、資料契約及驗收以 [整合設計](../shoe-sync-activity.md) 為準。

## 2026-09-21 查核更新

新增 [活動與 SKR 整合評估](skr-integration-assessment.md)。RULE-02 的影片長度、RULE-03 的公開資格規則已查核，檔案限制與團隊實際資格仍待確認，故未將整項標 DONE。RULE-01 精確時區、RULE-04 devnet／官方 SKR 最低證據仍待主辦方確認。SKR 外觀付款方案為提案，尚未實作，不變更 tSKR 口徑。

## 2026-09-21 開發規劃落地

新增 [開發計畫](competition-development-plan.md)：COMP-01～11 規則／證據 gate、P0 主賽與 P1 SKR 範圍、14–21 人日估算、10/1 SKR Go／No-go、10/7 內部提交目標及得獎後上架計畫。9/20 未完成規則查核改排 9/23，不標示已完成。

使用者於 2026-09-21 確認本次單人參賽、未接受 VC 投資；其餘資格核對結論私下保存，不入 repo。

## 2026-09-22 文件同步

評審指南補任務路線、Workouts PB／每週回顧、SVG 手動預覽、獎勵動畫、錢包守門與固定外觀。旁白及生成器移除 Activity／切鞋的「下一版才有」描述，畫面仍標示示意與實機待驗收；九頁版需隨六頁生成器一併重建。原始碼存在不等於提交 APK 已驗收。

## 2026-09-27 提交前檢查：新增原生套件不需重新 prebuild

9/25 為社群分享加入的 `expo-sharing`、`expo-clipboard` 是原生套件，本次以靜態檢查確認**不需要重跑 prebuild**、也不需要改 `app/android/`：

- `npx expo-modules-autolinking resolve -p android` 已列出 `expo.modules.sharing.SharingModule` 與 `expo.modules.clipboard.ClipboardModule`，所以已提交的 `app/android/` 在建置時會自動連結。
- `expo-sharing` 自帶 `${applicationId}.SharingFileProvider`，其 `sharing_provider_paths.xml` 含 `<cache-path path="." />`；分享圖卡寫在 App 私有 cache（`Paths.cache`），路徑在授權範圍內，Manifest 合併後不需另外宣告 provider。

這只證明「建置與檔案授權的前置條件成立」，**不代表分享功能已在實機驗收**：APK-03／04 與 [分享驗收表](../evidence/2026-09-25-share.md) 的實機項目仍為 TODO，且分享功能一定要**重新出包**才會出現（OTA 不會帶入原生模組）。

同時修掉兩個會讓回歸結果失真的問題（見 [PG](../pg.md) 2026-09-27 條）：`scripts/test-all.sh` 的 `docker info` 沒有逾時，Docker CLI 掛住時整份測試會停在資料庫那一段而不是 SKIP；`backend/src/player/player.test.ts` 會打真的 RPC，離線或 RPC 慢就逾時失敗。兩者都與功能無關，但會讓 9/28–9/30 的「完整端到端與安全回歸」看起來有失敗項。

## 2026-09-29：提交目標提前至 10/5

[新版盤點與每日 gate](submission-sprint-2026-10-05.md) 取代舊 10/7 內部目標。Devnet／tSKR 主辦回覆見 PG 9/29 原文；APK v4 是受測基準，不是最新 commit 的最終提交產物。review R1～R6 尚待修正，未標 DONE。

## 2026-10-02：素材盤點與配音同步

[最新盤點／待拍表](submission-materials-audit-2026-10-02.md)列出四項交付、歷史素材及缺件。正式配音更新五段 259 字；舊六頁視覺未重建。[10/1 SKR 證據](../evidence/2026-10-01-skr-devnet-payment.md)記錄 code 11／c477b8e 成功付款，與最终 RC、完整成片及恢復測試分開追蹤，未將整項驗收標 DONE。官方條款 §6.4 四項交付於 10/2 重讀確認。
