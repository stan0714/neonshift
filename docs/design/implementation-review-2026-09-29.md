# 實作 Review — 2026-09-29

基準 commit：a10a2d3。檢查近期 SKR 付款、節日收藏、核准通知、分享輸出與對應後端路徑；不是全專案安全稽核或實機驗收。本次不修改產品程式。

## 發現（依優先順序）

### R1 / P1：付款回覆遺失後，再次付款可能重複轉帳

位置：`app/src/services/skr/SkrService.ts:94`、`app/src/components/GenesisFrameCard.tsx:67`；後端 `backend/src/skr/service.ts:81`。

情境：錢包已廣播但回覆遺失，或第一個 confirm API 請求未送達。後端仍為 awaiting_payment；畫面依舊提供付款，purchase 只對 confirming＋signature 先確認，其餘直接建新交易。相同 order/reference 只能支援查找，SPL 轉帳本身不會據此去重，因此再次批准交易可能再付一次。使用者手動點「查看狀態」才能 recover，未形成強制保護。

證據：隔離 mock 測試讓第一次 sendTx 回 WALLET_NO_REPLY，再次購買取得同 awaiting_payment 訂單；觀察到 sendTx 共兩次、skrRecover 零次。這證明重送路徑可達，不是實際發生鏈上重複扣款的證據。

建議：開啟錢包前持久化訂單及 payment_attempt；一旦進入結果不明，UI 與 service 都只允許查詢。recover 查無交易不代表安全重付，需等待原交易有效期失效及再次核查，或使用鏈上具訂單去重的付款機制。保留已取得的 signature，不讓首個 confirm 網路錯誤丟掉它。驗收應模擬廣播成功、回覆遺失、App 重啟與再次點付款。

處理（2026-09-30，commit 見 pg.md）：已修。開錢包前持久化 `payment_attempt`（訂單 id、blockhash、lastValidBlockHeight）；
之後只要該筆嘗試未結清，`purchase()` 一律先 recover，不建新交易，UI 也不再顯示付款與取消。
允許再付的門檻定為「原交易已過 lastValidBlockHeight **且** 失效後再查一次仍查無」——
單靠 recover 查無交易不算證明，因為 RPC 可能只是還沒看到。查不到區塊高度時一律擋住。
錢包回報 REJECTED 例外：那是確定的否定答案（沒簽名、沒廣播），清掉嘗試，否則按一次取消就得等有效期過。
signature 在錢包一回傳就持久化，confirm 的網路錯誤不會把它弄丟。App skr.test 13 → 22 tests。

### R2 / P1：SKR 目錄換帳號時可能沿用舊帳號內容

位置：`app/src/components/GenesisFrameCard.tsx:24`、`app/src/state/skrStore.ts:72`。

refreshCatalog 回應沒有 generation/session 檢查；Card 雖有 wallet，卻直接使用 st.catalog，未要求 catalogWallet 相符。A 換 B 時，A 的資格、open_order 或成功訊息可能留在 B 畫面；若 A 舊請求晚回來，還能覆蓋 B 目錄。owned helper 的隔離不能保護整張付款卡。後端帳號驗證仍存在，此發現不代表可讀取任意伺服器帳戶或轉走另一錢包資產。

建議：請求按帳號＋網路＋generation 隔離；切換時清掉 phase/outcome/error 的展示；catalogWallet 不符就先顯示載入，付款前再次核對目前 session。測試 A 請求晚於 B 回來與換帳號時舊確認視窗仍開著。

處理（2026-09-30，commit 見 pg.md）：已修。`refreshCatalog` 加 generation：換帳號先清 catalog／phase／outcome／error，
回應與當前 generation 對不上就整包丟掉（含 entitlements 快取，否則 B 會「擁有」A 買的東西）。
卡片改用 `catalogWallet === wallet` 才渲染，對不上顯示載入而非上一個帳號的價格與資格。
`purchase()` 拒絕目錄不屬於該錢包的請求；確認框的 onPress 以**當下**的 session 核對，不用 render 時捕捉的那個。
App skr.test 22 → 27 tests。

### R3 / P1：產圖中的來源失效／換帳號不會阻止分享

位置：`app/src/services/share/shareImage.ts:108`、`app/src/screens/workouts/WorkoutSummaryScreen.tsx:127`。

stillValid 只在第一個 await 前執行。等待 sharing capability 或 SVG render 期間刪掉來源／切換帳號，後續仍寫 PNG 並開分享面板。摘要呼叫端也僅查紀錄存在，不核對 owner/revision。

證據：隔離 mock 測試在 SVG callback 前將 validity 變成 false，shareLayout 仍回 ok 並呼叫 shareAsync。

建議：把 owner、source revision、欄位及 SVG 輸出凍結成同一個 job；產圖後、寫檔前與交付前驗證仍為相同工作與帳號。失效回 stale、不開面板；來源已刪除時清掉尚未交付的 PNG。revision 不應用 quality rulesVersion 代替內容版本。

### R4 / P2：節日 NFT 的核准通知導向沒有領取入口的頁面

位置：`app/src/navigation/RootNavigator.tsx:109`；後端 `backend/src/pb/achievements.ts:301` 會產生 kind=seasonal。

ApprovalNotice 取所有 approved 且未 minted 的成就；onOpen 只區分 event 與其他，seasonal 因而進入 Workouts。節日收藏實際位於 Gear 的 SeasonalFootprints。點擊後該通知還會標已讀。另有 SeasonalNotice 是資格通知，不會修正這個 registry 核准通知路徑。

建議：依 kind 明確路由；seasonal 導向 Gear 的相應 campaign 並展開詳情，PB／milestone 也最好定位到對應項目。只有導航成功才標已讀；測試四種 achievement kind 的目的地。

### R5 / P2：節日收藏有跨帳號舊資料殘留

位置：`app/src/components/SeasonalFootprints.tsx:74`。

session 改變會重抓，但未先清空個人 rows，也沒有忽略過時請求。B 載入失敗會保留 A 的資格；A 慢回應可以蓋掉 B。可能把 A 的取得紀錄／可領取狀態顯示給 B，即使最後 Mint 由後端擋下，使用者仍會遇到假資格與錯誤。

建議：公開目錄與帳號資格分開快取；資格 keyed by wallet，切換即清空，舊 generation 回應不得寫入。測試登出、換錢包、慢回應與錯誤回退。

### R6 / P2：分享快取數量上限可能提前刪除接收端仍在讀的圖片

位置：`app/src/services/share/shareImage.ts:58`、`:124`。

shareAsync 返回就從 active 移除；後續清理在檔案未滿 24 小時前，也會為了八檔上限刪掉最舊檔。快速連續分享或接收端慢讀時，仍可能失去檔案。現有測試驗證的是數量上限，不是接收端的延遲讀取。

建議：區分產圖中、已交付保護期、可淘汰三種狀態；容量不足可拒絕新的產圖並說明，不刪仍在保護期的已交付檔。補多次快速分享和延遲接收讀檔的實機案例。

## 驗證與下一步

- App 現有 `skr.test`、`seasonal.test`、`shareCard.test`、`approvalNotice.test`：4 suites、58 tests 通過。
- 兩個新增隔離復現案例確認 R1／R3 的可達行為。使用測試 mock，沒有真實付款；臨時測試檔已移除，未修改原測試。這些案例驗證「存在缺口」，不表示功能正確。
- R2／R4／R5／R6 為呼叫路徑與狀態更新靜態分析；尚未做實機故障注入或全後端測試。
- 建議依序處理 R1 → R2／R3 → R4／R5 → R6，再把上述失敗情境納入固定回歸測試。參賽展示前先確保結果不明時不重付、換帳號不混資料、通知能到正確領取位置；新動畫和新收藏款式排在後面。
