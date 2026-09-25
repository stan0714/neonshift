# 節日與生態紀念 NFT：Seasonal Footprints

2026-09-25｜設計提案／待開發。此文件不表示日期活動已上線、官方合作或 NFT 已鑄造。

[原創徽章概念預覽](seasonal-badges-preview.html)｜[既有成就規格](../commemorative-nfts.md)｜[社群分享](../social-share/README.md)

## 1. 從使用者提供的 Garmin 畫面借鏡

參考的是清楚的資訊順序：主題徽章 → 年份與活動名 → 一句取得條件 → 限時標籤 → 哪次運動取得。NeonShift 使用原創插畫與自己的排版，不重用截圖中的兔子、徽章圖或 Garmin 標誌。首版不做「追蹤好友也有此章」，因目前沒有相應社交資料。

採三條收藏線：終身里程碑（首次 5K 等）、個人突破（PB）、年度節日（今年的共同記憶）。節日章不是 PB 的替代品，也不要求跑得更快。新手 Lv1 即可參加，不要求持有 SOL／SKR、交易量或付費解鎖資格。

## 2. 徽章設計系統

- 外形：圓角盾牌與雙層軌道邊框，保持 NeonShift 薄荷／紫色系；主題插畫佔中央約 60%，年份獨立置底，不照搬 Garmin 六角形斜年份帶。
- 插畫：沿用棲地與動物世界觀，每章一個主角和一個可辨識物件。以剪影、眼神、耳尾姿態及環境層次表現細節，避免縮小後全靠細字辨識。
- 系列固定資訊：`Seasonal Footprints`、名稱、年份、主題 ID；Device／Organizer 來源與網路標籤放詳情和分享卡，不擠進 64 px 圖示。
- 24／64／256／1024 px 檢查剪影辨識；上鎖用輪廓與鎖圖示，不能只靠灰色。降低動態效果時仍看得出狀態。
- 暫存概念 SVG 僅作提案，不直接覆寫既有 NFT 的 metadata 或圖片 URI；正式發行每年保留 art version 與內容雜湊。

| 系列章 | 原創主題 | 色彩／可辨識物件 | 建議取得條件（待實作） |
|---|---|---|---|
| Moonlit Steps／月光足跡 | 月下台灣野兔，森林坡道 | 金色滿月、薄荷葉片、兔耳剪影 | 中秋當地日期內開始並完成一筆有效步行／跑步，moving time ≥ 20 分 |
| Pizza Miles／披薩足跡 | 野餐小徑上的披薩與足跡 | 暖橘圓盤、三角切片、軌道線 | 5/22 活動窗口內一筆有效步行／跑步 ≥ 20 分 |
| Genesis Stride／創世步伐 | 棲地中的萌芽與三道平行光帶 | 紫綠曙光、種子，不直接使用官方 logo | 3/16 活動窗口內一筆有效步行／跑步 ≥ 20 分 |
| Mobile Trail／行動足跡 | 手機輪廓化為森林入口 | 薄荷光門、腳印 | 6/23 活動窗口內一筆有效步行／跑步 ≥ 20 分 |
| Seeker Horizon／探索者地平線 | 探索動物跨過掌上地平線 | 紫色星軌、抽象手機、遠山 | 8/4 活動窗口內一筆有效步行／跑步 ≥ 20 分 |

20 分鐘是統一的首版建議門檻，不是歷史規定。不要為 3/16、5/22 硬湊 3.16／5.22 km 排除步行新手；較長距離可作個人目標，不發更高收益。沒有額外 token、倍率或 XP，未來若新增獎勵必須另列規則。

## 3. 候選日期與來源（查核日 2026-09-25）

| 日期 | 已查到的歷史事實 | NeonShift 用途／邊界 |
|---|---|---|
| 3/16 | Solana 官方回顧提到 2020 年 3 月 16 日 Mainnet Beta 啟動。[Solana May Newsletter](https://solana.com/ar/news/may-newsletter) | 自訂 Genesis Stride 紀念挑戰，不稱為官方 NFT 活動 |
| 5/22 | Bitcoin Pizza Day 紀念 2010 年 5 月 22 日披薩交易。[Binance 說明](https://www.binance.com/en/academy/glossary/bitcoin-pizza) | 跨幣圈文化章；不要求購買 BTC／披薩，也不宣稱與 Bitcoin 發行方合作 |
| 6/23 | Mobile Stack 發表新聞內文日期為 2022 年 6 月 23 日。[Solana 官方新聞](https://solana.com/id/news/solana-mobile-stack-reveal) | 紀念 Android web3 工具發表，不能混稱 Saga 零售出貨日；頁面標頭日期有時區差異，採內文事件日期 |
| 8/4 | Solana Mobile 公告 Seeker 於 2025 年 8 月 4 日開始出貨。[官方公告](https://solanamobile.com/blog/solana-seeker-to-start-shipping-august-4-2025) | Seeker 出貨紀念提案，不等於每位使用者收到手機日期；該網站頁面顯示的 2026 更新日期不作事件年份 |
| 農曆八月十五 | 使用者提供 Garmin 畫面列 2026/9/25 中秋；目前僅作概念參考 | 正式排程前逐年使用權威曆法核對，不能把 9/25 寫成每年固定節日 |
| Breakpoint／Solana Mobile 當年度活動週 | 每年日期可能不同 | 待當年度官方公告後加入；不沿用去年的日期，不預設活動主辦授權 |

首批推薦 Genesis Stride、Seeker Horizon，加一個所在地文化節日。2026 已過的日期只作歷史或下一年度提案，不能現在要求補跑或默認追溯鑄造。Saga 上市、SKR 發行周年可列候選，但未在此確認日期，不排正式活動。亦不把 2025 Mobile Hackathon 的公告規則套到本次 2026 Clock In 參賽。

## 4. 使用者體驗

1. 任務頁顯示「即將開始／進行中／已結束」，明寫日期、時區、20 分鐘門檻與活動開始前不能累積。
2. 點徽章進入詳情：大插畫與年份、一句條件、個人進度（0/1 筆，或本次有效運動時間）、截止時間、「開始運動」。使用同一活動定義計算列表與詳情，不只顯示模糊的倒數。
3. 達標後先顯示「運動已保存，等待同步／驗證」。server approval 是資格核准，不能直接播放「NFT 已到手」。
4. 核准通知進入「可領取」：預覽公開資訊與費用 → 錢包確認 → 等鏈上 confirmed → 徽章翻面／光環揭曉。動畫沿用 Mint 四階段，減少動態效果時顯示靜態階段。
5. 私人取得紀錄顯示「由這次運動取得」，連回自己的 Activity。日期與時間屬私人詳情；分享預設只有徽章、年份、活動名與真實 Mint 狀態，不帶路線、錢包或精確時間。
6. 過期未參加顯示「本屆已結束」，可看下一屆；已完成但待核准者仍可查進度，不以活動結束覆蓋其資格。

收藏頁增加「里程碑／個人最佳／節日」分類、年份篩選與「已收藏／可領取／未解鎖」，不把每年卡片全部塞到首頁。活動提醒由使用者訂閱；未做系統推播前只標 App 內提醒。

## 5. 判定、同步與鑄造契約

- 每屆 `campaign_id` 獨立（例 `seeker-horizon-2027`），含 `theme_id/year/art_version/rules_version`、來源 URL、啟用狀態與明確 `[starts_at, ends_at)` UTC 範圍。日期來源核對通過才可發布。
- 生態共同活動使用 UTC 活動日；地方節日採固定 IANA 時區，例如 Asia/Taipei。UI 同時顯示活動時區與使用者換算時間，不採可隨裝置修改的當下時區。來源事件的日期不等於需自動推算官方周年窗口。
- 首版採嚴格單筆：開始與結束均在窗口內，moving time ≥ 1,200 秒；跨日／跨窗口不符合，開始前明示。多筆不能拼滿門檻，手動、重複、未完成、待審或失效紀錄不直接發資格。
- 活動結束後保留 7 天上傳寬限（建議值），依運動發生時間判定，不依匯入時間。同步仍由舊到新；伺服器處理延誤不取消已按時上傳的資格。補同步與領取是兩個期限：資格保留後首版不設 Mint 倒數，避免逼使用者即時付費。
- 每玩家／campaign 一枚，不因重匯入、改時區、換鞋或多次按鍵重發；同一有效運動可同時解鎖一般里程碑和不同主題章，顯示共用來源並逐枚領取。
- 正式加入獨立 seasonal 成就類型与 registry／receipt 路徑，不能把它偽裝成 `first_5k` 或主辦方完賽章。後端與鏈上要驗證 campaign、玩家及 proof，一起確認去重邊界。
- 更正／撤銷沿用資格更新流程，已鑄造 NFT 的狀態依既有撤銷語意顯示，不承諾收回第三方已分享圖片。
- 公開 metadata 最小化為主題、年份、規則／美術版本與驗證來源；精確成績、日期另外同意，原始 GPS 不上鏈。鏈上持有人仍可被查驗，不宣稱匿名。

## 6. 開發工作與驗收

| 編號 | 工作 | 優先／狀態 |
|---|---|---|
| PG-SEASON-01 | campaign schema、來源核對、UTC／地方時區與上傳寬限 | P1・TODO |
| PG-SEASON-02 | 資格計算與去重，離線補同步、revision／撤銷 | P1・TODO |
| PG-SEASON-03 | 原創 SVG 美術、任務／詳情／年度收藏與多語文案 | P1・TODO；只有概念預覽 |
| PG-SEASON-04 | seasonal mint-intent、registry proof、receipt 與錢包整合 | P1・TODO；需確認鏈上相容性 |
| PG-SEASON-05 | 核准通知、揭曉、社群卡與同意模型 | P1・TODO；複用現有能力，不表示已接妥 |
| PG-SEASON-06 | 提醒訂閱、推播與年度營運工具 | P2・TODO |

先保住本次參賽的核心錄製與正式驗收，節日系列作 roadmap；只有完成一屆端到端實測後，才能移到 current features。測試至少包含窗口起訖毫秒、跨午夜、DST、改手機時區、20 分門檻邊界、離線寬限、重複匯入、待審後核准、跨帳號、拒簽、重試已鑄造、撤銷以及收藏年份排序。Demo 可展示標示 Prototype 的測試窗口，不能偽造過去節日實際獲得紀錄。

## 7. 參賽說明用語

**English — roadmap, not shipped:** “Our next collection turns shared dates into reasons to move: original seasonal badges inspired by Solana’s mainnet milestone, the Seeker shipping anniversary, and local festivals. Complete a qualifying walk or run during a published window, receive server approval, then choose whether to mint. Annual collections add a reason to return without requiring token purchases or trading.”

**中文**：以年度主題收藏連結文化與生態社群，讓使用者有明確的回訪理由；走路或跑步達標後先核准，再由本人決定鑄造。節日章不要求買幣、不自動發 NFT，不宣稱可獲官方 SKR 獎勵。

評審價值對應：留存（每年新章／可預告活動）、行動體驗（運動→核准通知→錢包→收藏）、創意（動物棲地 × 生態紀念日）、呈現（徽章詳情與真實狀態）。這是設計假設，不宣稱已提升留存；後續看活動參與率、達標率、主動 Mint 比例與彙總回訪數。節日主題本身不構成 SKR Integration Prize 的功能整合。
