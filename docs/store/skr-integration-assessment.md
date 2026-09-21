# CLOCK IN 活動查核與 SKR 整合評估

查核：2026-09-21。此文件為研究與開發提案，沒有變更網路、部署合約、購買 SKR 或執行付款。

## 官方資料與本次補充

來源：
- [活動網站](https://solanamobile.radiant.nexus/)：Brief、Rules、FAQ、Prizes 與公開提交欄位；網站為動態頁，本次讀取其公開 JavaScript 中的頁面文案。
- [具優先效力的完整條款](https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf)：第 3–10 節。
- [Solana Mobile 官方公告](https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon)。
- [官方 SKR 頁](https://solanamobile.com/skr)。
- [官方 React Native 範例](https://github.com/solana-mobile/react-native-samples)：含 StakeSKR 與 .skr 地址解析；兩者是不同功能。

活動期間為 9/8–10/8；官方公告稱 11 月初揭曉，活動網站寫 11/10。精確提交截止時刻、時區及報名截止仍未核實，不自行換算。主獎 $125,000 USDC，另有以 SKR 支付的 $10,000 整合獎；網站某標題把總額寫成 USDC，應以分項區分幣種。

網站 Brief 要求三分鐘 Demo；提交為 Android APK、GitHub、Demo、產品簡報。原始碼與歷史須可供評審查閱。SMS／MWA 與有意義的 Solana 互動為要求。四项評分各 25%：留存／PMF、UX、創新、展示。

條款補充：專案須在開賽前三個月內開始，既有作品還需本次新增實質行動開發；本機最早 commit 為 9/9，但不能單憑 commit 判斷真實起始日期。USDC 獎排除 VC／天使募資團隊，非 USDC 獎資格另由主辦方決定。提交後隊員固定，入圍全員需身分驗證。台灣列於合資格地區，但個人資格仍須符合完整條款。得獎後上架期限為 30 天，送審不等於上架完成。

FAQ 允許 AI 輔助，但作品須有權提交；一人只能參與一件提交。草稿可編輯，完成最終提交協議後不可再改。尚未代使用者登入或提交。

## 專案現況

- app/src/config/app.ts 預設 devnet、名稱 tSKR，清楚宣告無金錢價值。
- 現有每日任務、Arena、reward vault 使用測試代幣；不能只改名稱或 mint 就稱為官方 SKR 整合。
- 已有 MWA、任務驗證、成就資格、NFT mint-intent、receipt 防重複、收藏外觀與路線快照，可重用為產品基礎。
- docs/pg.md 的 DEC-02 仍待決議。主辦方是否接受純 devnet 替代 token 展示、最低主網證據要求仍未明示。

官方 SKR mint：SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3。正式實作前再次核對官方資訊與鏈上 mint owner／decimals；不按 symbol 認幣、不從第三方範例硬編小數位。.skr 網域、Seeker 錢包登入或普通 NFT 鑄造本身不等於 SKR token 整合。

## 建議主方案：成就解鎖 + SKR 紀念外觀

這是產品建議，不是主辦方核可結論。

使用者免費完成合格里程 → 取得成就與原有 NFT 領取資格 → 可選擇用官方 SKR 購買該成就專屬分享卡邊框／未來路線主題 → MWA 核准 → 驗證付款後取得外觀權限 → 下次使用與展示。

- 成就不能購買。SKR 不增加 XP、距離、速度、排名或審核通過率。
- 首批只做一款實際可用外觀與固定 SKR 價格；金額待產品確認，不硬設美元換算或收益承諾。
- 已保存路線背景仍不可變；新主題只能套用下一場，或另建立分享卡，不回寫歷史。
- NFT 基礎領取仍不收 tSKR／SKR，原本鏈上費用照實揭露。SKR 付款是獨立外觀訂單，不冒稱 NFT 鑄造費。
- 初版外觀可為 App 權限，不必再發 NFT。若日後 NFT 化，付款／鑄造須具原子性或可恢復履約。
- 與跑鞋動物故事可做原創配色，但不宣稱支付等於捐款、WWF 合作或實際保育成果。

價值主張：運動取得資格，SKR 讓使用者選擇如何紀念。比單純放餘額或質押連結更能在既有產品中展示實際用途；能否獲獎仍取決於完成度、差異化與主辦方判斷。

## 替代方案比較

| 方向 | 優點 | 缺口／建議 |
|---|---|---|
| 成就專屬外觀 SKR 付款 | 連接任務、收藏與分享；資金流單純 | 首選，需真正付款到履約與恢復流程 |
| 主辦方預存 SKR、完成任務領固定奖励 | 重用驗證與任務，與運動主線更緊密 | 第二階段；須預算、反作弊、限額、防重领與安全金庫，不能無限承諾 |
| 官方 SKR staking | 有官方 StakeSKR 範例 | 可選；單純導向外站特色薄弱，完整 staking 增加範圍 |
| SKR 持有者外觀權限 | 無付款履約、可先做讀取 | 容易只是附加門檻，需證明具體產品价值 |
| Arena 全面換成官方 SKR | 直接用於競技 | 本次不優先；涉及真實資金競賽、既有測試假設與安全模型全面重估 |

## MVP 開發與驗收工作包（均 TODO）

1. SKR-01：分離官方 SKR 主網設定與 tSKR devnet；畫面明示網路、mint、余额，隔離 RPC、API 訂單與交易。
2. SKR-02：後端依已驗證成就核發訂單，綁定 wallet、SKU、版本、價格、mint、收款人與期限；不得信任前端資格。
3. SKR-03：MWA 預覽 SKR 數量、SOL 費用、收款人與外觀；處理餘額不足、無 SOL、取消、逾時。
4. SKR-04：查驗確認交易的網路、成功狀態、mint、轉出帳戶擁有者、實收額、收款帳戶及唯一訂單參照。同一付款不得兌換不同訂單；原子寫入 receipt／權限。
5. SKR-05：付款後 App 關閉、回覆遺失或訂單剛過期仍可查單恢復；已付不重扣。異常已付訂單需人工處理／退款政策，不用重新付款當恢復方案。
6. SKR-06：外觀真正可用且維持舊路線不可變；裝置重裝後可恢復權限。
7. SKR-07：自動測試錯 mint、錯網路、重放、他人付款、重複點擊、RPC 中斷；實機完成至少一條官方 SKR 小額流程與查證。

主網驗收涉及真實資金：先完成上述可審查程式、測試與訂單預覽，再由使用者核准具體金額／收款地址／部署。此研究不授權任何轉帳。

## 評審證據與提交文案

展示：已驗證的首次成就 → 專屬外觀 → SKR 付款預覽 → MWA → 鏈上確認 → 權限恢復與實際套用。附 APK／commit、mint、訂單、交易與可觀察結果，遮蔽不必要個資。

提交表單已設有 SKR 整合說明欄位；目前應誠實填「現行使用 tSKR devnet，官方 SKR 整合尚未完成」。完成並驗證後才可改為：

NeonShift lets users purchase optional achievement-specific cosmetics with SKR after earning the underlying achievement through verified movement. SKR does not buy performance, XP, or achievement eligibility.

仍需詢問主辦方（未送出）：是否接受 devnet mock；官方 SKR 是否需主網交易；SKR 獎是否有獨立權重／資金資格；精確截止時刻。官方公告明列購買、質押、獎勵與存取權為方向，但沒有保證實作任一項即合格或得獎。
