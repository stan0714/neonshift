# NeonShift 社群分享規劃（運動者分享 → 下載 App → 參加活動）

| 項目 | 內容 |
|---|---|
| 文件版本 | v0.3（2026-09-25：01～03 實作完成，尚未實機驗收） |
| 建立日期 | 2026-09-25 |
| 狀態 | **WIP**；PG-SHARE-01～03 已實作（自動測試通過、實機未驗收），04／05／08 未開始。PG-LINK-10 記載的「社群圖片分享另立工作」即本文件 |
| 對應需求 | [BRD v0.6](../brd-detailed.md)、[SD](../sd.md)、[Style Guide](../style.md)、[PG](../pg.md) |
| 相關文件 | [跑鞋連動與路線外觀](../design/shoe-route-linkage.md)、[特殊圖案路線挑戰](../design/pattern-route-challenges.md)（R2 可撤銷分享連結）、[商店素材](../store/listing.md)、[活動 Demo 腳本](../store/event-demo-playbook.md) |
| 目標平台 | Android／Solana Mobile Seeker；分享目的地為 Instagram、Threads、X、LINE、Facebook、Discord |
| 介面語言 | English ＋ 繁體中文（`app/src/i18n`，兩份字典 key 一致） |

---

## 1. 目的與非目標

### 1.1 目的

讓「剛完成一場運動／剛拿到一個成就／剛報名一場活動」的使用者，在情緒最高的那 30 秒內，用**一張看得懂的圖 ＋ 一段可貼的文字 ＋ 一個可點的連結**把自己的成果放到社群，並讓看到的人能在清楚找到安裝入口，安裝後能找回同一場活動；不把安裝、權限、錢包連接與報名承諾成兩步完成。

三個可量測結果：

1. **分享意圖率**：符合分享條件的完成頁中，使用者開啟分享面板的比例；另記圖片產生與複製文案次數。不得稱為「成功發布率」，系統分享回傳不代表對方社群已發布。
2. **連結回訪**：分享連結帶來的落地頁瀏覽數（依 `source` 分桶）。
3. **轉換代理指標**：落地頁瀏覽、商店按鈕點擊、App 開啟、報名分別列出彙總計數。商店點擊不等於安裝；不使用個人識別碼時，不能宣稱已串出同一人的跨安裝漏斗。現有活動 views／registrations 依來源分桶，checkins／redemptions 目前記在 `onsite`，不能直接歸到原邀請來源。

### 1.2 非目標（本期不做）

- 不做站內社群牆、追蹤／按讚／留言、好友系統。
- 不做伺服器端圖片合成（見 §5 隱私紅線：GPS 與運動細節不上傳）。
- 不做個人層級的行為追蹤；歸因只到**彙總計數**，不記錄誰點了誰的連結。
- 不做排行榜對外公開；賽事成績仍只由主辦方發布（`rank_source: organizer`）。

---

## 2. 現況盤點（做這件事之前先確認手上有什麼）

### 2.1 已經有的

| 項目 | 位置 | 說明 |
|---|---|---|
| 運動摘要分享（純文字） | [WorkoutSummaryScreen.tsx](../../app/src/screens/workouts/WorkoutSummaryScreen.tsx)、[review.ts](../../app/src/domain/review.ts) `shareCard()` | 已有 **逐項開關**：mode／pace／date／splits／goal／quality；預設不含路線、精確開始時間、錢包位址 |
| 活動邀請分享 | [EventExtras.tsx](../../app/src/screens/events/EventExtras.tsx) `shareInvite()` | 只含活動名、時間、`https://neonshift.cc/e/<slug>?source=invite`，不含任何個人資料 |
| Guardian 故事分享 | [GuardianMilestone.tsx](../../app/src/components/GuardianMilestone.tsx) | `guardian.shareText` ＋ `siteUrl`，明講「不需要錢包位址就能分享這個邀請」 |
| NFT 數值公開同意 | PersonalBests／Milestones／EventBadges 的 `pb.consentShare` | **這是 NFT metadata 是否寫入精確值的同意，與社群分享是兩件事**，不可混用 |
| 活動歸因計數 | [partner/routes.ts:127](../../backend/src/partner/routes.ts#L127) `source()` ＋ `bumpCampaign()` | views／registrations 依 `?source=`（上限 32 字元）分桶；checkins／redemptions 目前用 `onsite`，有 CSV 匯出 |
| 活動落地頁 | [web/e/index.html](../../web/e/index.html) | 中英雙語、保留 `location.search` 轉進 `neonshift://e/<slug>`，已有 `web/.well-known/assetlinks.json` 設定；正式簽章與實機網域驗證仍需留存證據 |
| 成就美術 | `web/nft/achievements/*.svg`、`web/nft/img/*.png` | 既有的成就與跑鞋圖，可直接當圖卡素材來源 |

### 2.2 缺的（本規劃要補的）

1. **完全沒有圖片分享**。`Share.share({ message })` 只送文字，IG／Threads 這類以圖為主的平台幾乎貼不出東西。
2. ~~網站沒有任何 OG／Twitter card 標籤~~ → 首頁／`/en/`／`/e/`／`/s/*` 已補齊，圖為 `web/og/<kind>-v1.png`（1200×630，`tools/og-assets/build.mjs` 產生，`verify.mjs` 靜態檢查）。**各平台實際抓取結果仍須部署後實測**，不推論點擊率。
3. ~~落地頁沒有安裝按鈕~~ → `/s/` 已有安裝入口區塊；因為**還沒上架**，按規格顯示「尚未開放下載」並給複製連結，不假裝可安裝。
4. ~~非活動分享沒有任何歸因~~ → 新增 `share_aggregates`（kind × source × day × event_name → count，migration 0020）與匿名 `POST /v1/metrics/share`；落地頁以 sendBeacon 送 `landing_view`／`app_open`。`store_click`／`connect_complete` 已定義但**還沒有送出端**（未上架、也沒有跨安裝來源保留）。
5. ~~分享與剪貼簿套件未安裝~~ → 已於 2026-09-25 安裝 `expo-sharing`、`expo-clipboard`（另加純 JS 的 `qrcode`）；**不需要** react-native-view-shot（見 §6.1）。**需要重新出包**才會生效。

---

## 3. 使用者動機與分享時機

### 3.1 運動者為什麼願意按下分享

| 動機 | 心理狀態 | 對應素材 |
|---|---|---|
| **成績值得被看見** | 剛跑完、數字好看、想留紀錄 | A 運動成績卡 |
| **收藏品是稀有的** | 拿到第一個 5K／最速紀錄 NFT，想證明「這是鏈上的」 | B 成就收藏卡 |
| **希望有人一起** | 報名了活動，一個人去很無聊 | C 活動邀請卡 |
| **習慣本身是身分** | 連續打卡、累積里程、跑鞋升階 | D 里程／連續卡 |
| **故事與意義** | Guardian 野生動物故事，分享的是價值不是數字 | E 故事卡 |

**看到分享的人為什麼會下載**：圖上看得到「這個 App 會給我什麼」（一雙會長大的鞋、一張鏈上成就、一場可以報名的活動），而不是只看到別人跑得比我快。所以每張圖都必須有**產品線索**，不能只是一張成績截圖。

### 3.2 分享時機地圖

| # | 時機 | 觸發畫面 | 圖卡 | 文案 | 連結（含 `source`） | 落地頁 |
|---|---|---|---|---|---|---|
| S1 | 運動結束、摘要頁 | `WorkoutSummaryScreen`（已有 `sum-share-button`） | A | `share.*` 現有字典 ＋ 邀請句 | `neonshift.cc/s/workout?source=summary` | `/s/` |
| S2 | 成就 mint 成功 | `Milestones`／`PersonalBests`／Gallery 本人頁 | B | 成就名＋已確認鏈上狀態（見 §4.5） | `neonshift.cc/s/achievement?source=mint` | `/s/` |
| S3 | 成就護照 | Passport（`pass.intro`） | B（多格） | 實際有效枚數；待核准／撤銷不計入 | `neonshift.cc/s/passport?source=passport` | `/s/` |
| S4 | 報名完成 | 活動詳情（已有 `shareInvite`） | C | 活動名＋時間；名額以落地頁即時資訊為準 | `neonshift.cc/e/<slug>?source=invite` | `/e/<slug>`（已有） |
| S5 | 活動完賽／領到權益 | 活動結果頁、`EventBadges` | B／C | 完賽時間（依本次社群分享的獨立同意） | `neonshift.cc/e/<slug>?source=finish` | `/e/<slug>` |
| S6 | 跑鞋升階、里程里程碑 | Gear 卡片、摘要頁 `sum-first-wear` | D | 升階名稱＋累積里程 | `neonshift.cc/s/gear?source=levelup` | `/s/` |
| S7 | Guardian 解鎖 | `GuardianMilestone`（已有分享） | E | `guardian.shareText` | `neonshift.cc/s/guardian?source=guardian` | `/s/` |

> S1／S4／S7 已有純文字分享，本期是**加圖**與**補歸因**，不改既有同意模型。

---

## 4. 圖片規格

### 4.1 尺寸（三種，同一份版面資料出三檔）

| 代號 | 尺寸 | 比例 | 用途 |
|---|---|---|---|
| `post` | 1080 × 1350 | 4:5 | IG／Threads／Facebook 貼文（本專案首版採用的版型；裁切結果需實測） |
| `story` | 1080 × 1920 | 9:16 | IG／FB Story、Reels 封面；**上下各留 250 px 安全區**避開平台 UI |
| `og` | 1200 × 630 | 1.91:1 | 網頁 OG／X card／LINE 預覽（由網站靜態提供，不由 App 產生） |

第一版只做 `post` ＋ `og`；`story` 列第二階段（見 §8）。

### 4.2 版面（以 `post` 為準）

```text
┌──────────────────────────────┐  canvas #050711
│  ▍NEONSHIFT      DEVNET      │  32px 品牌列：brand-mark ＋ 環境標
│                              │
│  RUN · 25 Sep                │  label，textSecondary
│  ██ 5.50 km                  │  hero 數字，96px，mint #30EBC8
│  Time 38:12 · 6:57 /km       │  title，textPrimary
│                              │
│  ┌────────┐  Splits          │  可選區塊（依開關）
│  │  鞋／   │  1 6:48  2 6:55  │
│  │  成就圖 │  3 7:02 …        │
│  └────────┘                  │
│                              │
│  ─────────────────────────   │  borderSubtle #26324A
│  Earn shoes & on-chain       │  產品線索（必要）
│  achievements by walking     │
│  neonshift.cc  ▣QR           │  連結＋QR（可選）
└──────────────────────────────┘
```

版面規則：

- **色彩只用 token**（[tokens.ts](../../app/src/theme/tokens.ts)）：底 `canvas #050711`、卡 `surface #0B1020`、主數字 `mint #30EBC8`、次要字 `textSecondary #AAB7CC`、分隔線 `borderSubtle #26324A`；Gear 類用 `gradient.gear`。圖卡不得出現 token 以外的 hex。
- **一張圖一個主數字**（Style §1.2 One primary action 的延伸）。距離、時間、配速三者只有一個放大。
- **霓虹只打在主數字與狀態標**，其餘降低光效但保持文字對比（Style §1.1 Signal over spectacle）。
- **輔助文字最小字級 28 px**（1080 寬下），縮圖後仍要讀得出主數字。
- **必含產品線索一行**：說明這個 App 在做什麼，讓沒用過的人看得懂。
- **環境標籤來自實際資產／交易所屬網路**：Devnet 資產標示 `DEVNET`；含 tSKR 再標示 `tSKR · Test Token · No monetary value`。NFT 卡不因沒有 tSKR 而杜撰代幣資訊，未來正式網資產也不得硬套 Devnet 標示。缺少必要環境標示時不可匯出。

### 4.3 五種圖卡

| 卡型 | 內容 | 預設含 | 預設不含 |
|---|---|---|---|
| **A 運動成績** | 距離（hero）、時間、配速、模式、分段、目標達成 | 依 `SHARE_CARD_DEFAULT`：mode／pace／splits／goal | **路線圖**、精確開始時間、GPS 品質、錢包位址 |
| **B 成就收藏** | 成就名、等級圖（`web/nft/achievements/*.svg` 同一份美術）、鏈上可查字樣、`DEVNET` | 成就名、圖；日期預設關閉 | 精確數值（需本次社群分享另外勾選）、asset id 全長、錢包位址 |
| **C 活動邀請** | 活動名、日期、地點城市層級、主辦方名；名額回落地頁查看 | 活動公開資訊 | 個人報名資料、報到碼、NFC tag、其他參加者 |
| **D 里程／升階** | 跑鞋外觀、等級名、累積里程、下一階還差多少 | 鞋款、里程 | 每次運動明細、路線 |
| **E Guardian 故事** | 物種插畫、一句故事、共同進度 | 故事文案（`guardian.*`） | 任何個人數據 |

### 4.4 使用者控制

- 運動卡欄位開關**沿用 `ShareCardFields`**；B／C／D／E 以 kind 區分資料型別與適用開關，不把 NFT／活動硬塞進運動欄位。文字卡與圖卡看到的是同一組有效開關（避免「文字沒寫但圖裡有」）。
- 送出前**一定要有預覽**（現在文字已有 `sum-share-preview`，圖卡要看到縮圖）。
- 「路線圖」是獨立的、**預設關閉**的開關，並在旁邊寫明後果（見 §5）。

### 4.5 成就狀態與分享資格（新增）

| 真實狀態 | 可用文案／行為 | 禁止 |
|---|---|---|
| 本機完成、待同步或待審 | A 卡可分享個人運動摘要，清楚標「個人紀錄／待驗證」 | 稱為官方認證、已取得 NFT |
| `pending_registry` | 可分享「已達成，等待核准」的成就進度卡 | 鏈上可查、已鑄造 |
| `approved`，尚未 Mint | 「已核准，可領取」；領取按鈕與分享分開 | 把 approval 通知當作 Mint 成功 |
| 交易送出、尚未 confirmed | 留在交易狀態頁；稍後再分享收藏卡 | 因拿到 signature 就提前發成功卡 |
| 已 confirmed／查得既有鑄造 receipt | B 收藏卡；顯示正確 network | 由播放成功動畫推斷鏈上結果 |
| revoked／revoke_pending | 隱藏「有效成就」樣式；已存在的圖片無法遠端收回 | 繼續計入有效護照數量 |

鏈上查驗連結會公開 asset，可能讓人追到持有錢包。首版 B 卡使用通用產品連結；若另提供「附鏈上查驗連結」，預設關閉並獨立提醒。圖上沒寫錢包不代表鏈上匿名。核准通知點擊先領取，不自動分享；分享失敗不重送 Mint。參考 [核准互動規格](../design/mint-approval-feedback.md)。

### 4.6 保存外觀與輸出版本（新增）

- 讀取該次 `shoeSnapshot`、`routeAppearance.version/layer`；不讀目前選鞋或全域背景偏好替換歷史。缺快照用既有 legacy fallback，不猜測舊鞋款。
- 分享設定只調整可見欄位、裁切與版型，不能修改原運動背景；關閉路線也不改原紀錄。
- 本機建立 `ShareRenderSpec`：包含來源 ID／revision、renderer version、外觀快照、語系、格式與欄位開關。來源 ID 只供本機重建，不寫入圖檔 metadata、QR 或歸因連結。
- 凍結一次預覽的輸入，送出同一份已預覽內容。使用者切換帳號、來源紀錄被刪除／更正時，取消舊工作並重新確認，不能讓背景匯出延遲寫入錯誤帳號。
- 暫存 PNG 依期限刪除；首版不承諾永久保留原圖或逐像素重現。若需永久紀念卡，另立使用者主動保存、版本保留與刪除機制；不得偷偷以永久副本規避快取清理。

---

## 5. 隱私與合規紅線（不可協商）

1. **原始 GPS 座標不隨此圖卡功能上傳或匯出**。使用者另行同意的裁切路線形狀會隨圖片交給接收 App，不能宣稱該圖片完全沒有位置資訊。因此圖卡**必須在裝置端合成**，不得把運動資料送到伺服器產圖。這條同時決定了 §6 的技術方案。
2. 若使用者主動打開「含路線圖」：圖只畫**相對形狀**（正規化後的軌跡），不含座標、不含底圖、不含起終點標記，並在開關旁明講「路線形狀可能透露你常跑的地點」。起終點各自裁掉一段（privacy trim）。
3. **預設不含**錢包位址、精確開始時間、GPS 品質、他人任何資料。
4. NFT 的 `pb.consentShare`（metadata 是否寫精確值）**不等於**同意社群分享；兩者分開詢問；NFT 已公開也不得自動勾選任何敏感欄位，包含精確成績。使用者另行同意後可分享自己的成績，但不回寫 NFT metadata。
5. 活動圖卡只用**主辦方公開資訊**；健康資料不提供給主辦方（`ev.accept` 已承諾），圖卡不得成為繞道。
6. 含 tSKR 的圖卡標示 `DEVNET` 與 `Test Token · No monetary value`，不混淆官方 SKR；其他資產按實際網路標示（§4.2）。
7. 產生的圖檔寫入**快取目錄**，採有期限的延後清除，不能在分享 API 返回時立即刪除，避免接收 App 尚未讀完（§6.1）；不寫入相簿，除非使用者明確選「儲存到相簿」。
8. 歸因只記彙總（`source` × 日期 × 事件計數），**不產生個人分享識別碼**，不得用連結反查分享者。

---

## 6. 技術方案

### 6.1 App 端（圖卡）

```
ShareCard（react-native-svg，單一 <Svg> viewBox 0 0 1080 1350；畫面上顯示 300 pt 縮圖）
        │  ShareRenderSpec（運動資料沿用 ShareCardInput／ShareCardFields）
        ▼
svgRef.toDataURL(cb, { width: 1080, height: 1350 })   ← react-native-svg（已安裝）
        ▼
new File(Paths.cache, 'neonshift-share-<kind>-<到期時間>-<隨機>.png').write(b64, { encoding: 'base64' })
        ▼
Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle })
        ▼
到期時間寫在檔名 → 啟動時與下次產圖前清理過期檔（不在分享返回時刪）
```

- **不用 react-native-view-shot**。圖卡本身就是 SVG，`toDataURL` 在原生端依 viewBox 重算成 1080×1350 點陣（Android 實作見 `react-native-svg/android/.../SvgView.java` 的 `toDataURL(int,int)`：以 `canvas.getWidth()` 套 viewBox 轉換），因此畫面上顯示縮圖也能輸出正確尺寸、不受 PixelRatio 影響，也不必把整張卡掛在螢幕外。少一個原生依賴，輸出與預覽必然同一份版面。
- 新增依賴：`expo-sharing`（送出）、`expo-clipboard`（複製文案），另加純 JS 的 `qrcode`（產 QR 矩陣，疊成單一 Path；一格一個 Rect 會是上千個節點）。需要重新出包（`scripts/app/build.sh demo release`），不能靠 OTA。
- 版面用 **`react-native-svg`（已安裝）** 繪製，字級與色彩吃 token，搭配文字量測與換行上限；SVG 本身不能保證不裁字。
- **失敗提供明確下一步**：出圖失敗、無分享目標、空間不足時保留預覽設定，顯示「重試／改分享文字／複製文案」。只有使用者選擇後才開第二個分享面板；使用者取消分享不算錯誤，也不自動再彈文字分享。
- **離線可用**：圖卡資料全部來自本機運動紀錄；成就徽章改為**程序繪製**（不抓 `neonshift.cc/nft/...` 的 SVG），離線一樣畫得出來。
- **圖片與文案分開保證**：首版用 `expo-sharing.shareAsync` 分享 PNG，另提供「複製文案與連結」。此 API 的 options 沒有一般文字 payload，不能假設會附帶 caption；若要單一 intent 同送圖片＋文字，另做原生橋接評估與各接收 App 測試。

**匯出生命週期與失敗處理補充**：

- 狀態為 `preview → rendering → ready → handing_off → returned / error`，一次只做一個工作；連點不能產生多張圖或多個面板。`returned` 只代表交付流程返回，畫面使用「已返回分享頁」，不顯示「發布成功」。
- 先確認分享能力，再等待所有字型、SVG 素材與版面完成。離屏元件仍需實際掛載、不可使用 `display:none`；依 capture API 正確換算輸出像素，PNG 解碼後必須恰為 1080×1350，不能因 PixelRatio 變成 3 倍尺寸。
- 檔名採不含使用者資料的隨機值；首版只保留 App 私有快取。建議 TTL 24 小時、數量／容量有上限，下一次啟動及產圖前清理已過期且非 active 的檔案；這是本專案建議值，需實機確認慢速接收端能完整讀取。
- 匯出 PNG 不含 EXIF、座標、帳號、原始檔名或內部 session ID；不要直接匯出整個 App 畫面以免通知或報到碼入圖。
- 首版失敗文案說清楚「圖片未產生／無法開啟分享／文案已複製」，保留重試入口；除非素材載入失敗，離線不應被當作出圖失敗。
- 檔案 API 依 SDK 57 選定現行介面；若用 `cacheDirectory/deleteAsync` 等 legacy API，明確使用相符 import，不把舊版範例直接套入新模組。

### 6.2 網站端（OG 預覽 ＋ 落地頁）

- 新增 `/s/` 落地頁（`web/s/index.html`）：路徑固定為 `/s/workout`、`/s/achievement`、`/s/gear`、`/s/guardian`、`/s/passport`，不採 hash fragment，中英雙語，主按鈕 `Get NeonShift`（`storeUrl`）＋ 次按鈕 `Open in NeonShift`（`neonshift://`），並說明 Seeker／Android 需求。
- 為 `web/index.html`、`web/e/index.html`、`web/s/index.html` 補 `og:title`／`og:description`／`og:image`／`twitter:card=summary_large_image`。
- OG 圖（1200×630）**靜態產生**：每種卡型一張通用圖，放 `web/og/<kind>.png`，由既有 SVG 於 build 時轉出。**首版活動頁用品牌通用 OG 圖**。若要每場活動固定主視覺，需另有按 slug 產生 HTML head 的建置／更新流程；不能用同一份 HTML 的瀏覽器 JS 換圖後，就宣稱社群爬蟲會看到各活動圖片。
- `/e/<slug>` 已保留 query string；`/s/` 同樣保留，讓 `source` 能一路傳進 App。

**網址與安裝回退補充**：

- `/s/<kind>` 每個可分享 URL 要直接回傳含對應 OG 的 HTML head，至少 `og:title/type/url/image/description`、`og:image:alt` 與圖片尺寸；`og:url` 使用不含來源參數的 canonical URL。爬蟲不必執行 JS，就能取得絕對 HTTPS 圖片 URL。
- 圖片使用版本化檔名，不能承諾第三方快取即時更新。活動取消／截止／額滿由落地頁重新查詢，圖片只是一份製作當時的資訊。
- `source` 採允許清單、長度限制與 URL 編碼；只轉送已知參數。活動頁現行整包轉送 `location.search` 是待收斂項目，不能把 `tag`、token 或個人資訊順便轉進新分享連結。
- 網頁使用 HTTPS 為入口；dApp Store scheme 僅作支援裝置上的選項。尚未上架時標示「尚未開放下載」而非假裝可安裝；其他 Android、iOS、桌面與無法開啟商店的環境提供相符說明及複製連結，不無限重導。
- 新 `/s/` deep link 必須新增 App routing、Android intent filter／網域驗證與 cold start 測試，不能只保留 query 就視為完成。登入／權限流程之後回到待開啟的活動；拒絕登入可回落地頁。
- 來源不能保證跨越首次安裝保留。首版引導安裝後重新點原連結；沒有 deferred deep link 實作與證據時，不承諾「安裝後自動返回原活動」。

### 6.3 後端（歸因）

- 已實作：`share_aggregates (kind, source, day, event_name) → count`（migration 0020）＋ 匿名 `POST /v1/metrics/share`（無身分、只收允許清單內的 kind／source／event、日期由伺服器決定、`RATE_LIMIT_PER_MINUTE` 限流、strict schema 拒絕任何夾帶欄位）。讀取走 `GET /v1/ops/metrics/share`（OPS_TOKEN，JSON 或 CSV）與 `scripts/ops/share.sh`。
- 落地頁進站時打一次計數（`kind` 從路徑、`source` 從 query）。**不設分析 cookie、不在業務計數表保存 IP**。傳輸層與主機日誌、限流可能接觸 IP，需盤點實際設定、保存期限與遮罩方式後，才能對外聲稱「不記 IP」。
- 沒有此計數時，仍可做操作訪談與實機驗收，但不能宣稱已量測跨平台轉換。事件只接受 kind／source／event_name 允許清單；伺服器指定日期，限制 payload 與流量，不保存完整 referrer 或任意 query。重載、爬蟲及重試可能增加計數，報表明示是非唯一事件數，不用它計發獎勵。

---

## 7. 文案模板（i18n key 對照）

新增 key 一律 `share.card.*`／`share.invite.*`，zh-TW 與 en 兩份同時補齊。按鈕與說明都跟隨 App 語系，保留 NeonShift、NFT、Devnet 等名稱，不強制繁中畫面使用英文動作詞。

| key | en | zh-TW |
|---|---|---|
| `share.card.title` | Share card | 分享圖卡 |
| `share.card.image` | Share image | 分享圖片 |
| `share.card.copy` | Copy caption | 複製文案 |
| `share.card.route` | Include route shape | 包含路線形狀 |
| `share.card.routeWarn` | The shape can reveal where you usually run. Start and end points are trimmed. | 路線形狀可能透露你常跑的地點；起終點會各裁掉一段。 |
| `share.card.tagline` | Walk or run, grow your shoes, and work toward achievement collectibles. | 走路跑步養跑鞋，逐步解鎖成就收藏。 |
| `share.card.devnet` | DEVNET · Test Token · No monetary value | DEVNET · 測試代幣 · 無金錢價值 |
| `share.invite.workout` | I completed {km} km with NeonShift. Walk or run and grow your shoes. {url} | 我剛用 NeonShift 完成 {km} km。走路跑步，一起養跑鞋。{url} |
| `share.invite.achievement` | Minted {name} on {network} with NeonShift. {url} | 已在 {network} 鑄造 {name}，收藏我的 NeonShift 成就。{url} |
| `share.invite.event` | Join me at {title} on {when}. Check availability here: {url} | 一起參加 {title}（{when}）。目前名額請看活動頁：{url} |
| `share.invite.gear` | My shoes reached {level}. I have logged {km} km in this pair. {url} | 我的跑鞋已達 {level}，穿這雙鞋累積了 {km} km。{url} |

文案三段式：**我做了什麼 → 這個 App 給什麼 → 連結**。不用「賺」「收益」「投資」等字眼；不宣稱零成本鑄造，費用仍以領取確認畫面的網路費與帳戶 rent 為準。成就與里程也不能暗示未實作的升級因果。

---

## 8. 工作分解

| 編號 | 名稱 | 狀態 | 依賴 |
|---|---|---|---|
| PG-SHARE-01 | 圖卡資料層：沿用 `ShareCardInput`／`ShareCardFields`，加 `kind`、`route`（預設關）與純函式版面資料 | **WIP（碼完，實機未驗）** | 無 |
| PG-SHARE-02 | `ShareCard`（react-native-svg，1080×1350）＋ A／B 兩種卡型與預覽 | **WIP（碼完，實機未驗）** | 01 |
| PG-SHARE-03 | 安裝 `expo-sharing`／`expo-clipboard`，出圖、分享、TTL 清理、失敗選項、複製文案 | **WIP（碼完，待重新出包與實機驗收）** | 02 |
| PG-SHARE-04 | 網站：`/s/` 落地頁 ＋ 全站 OG／Twitter card ＋ 安裝入口；App `/s/` routing、App Link intent filter | **WIP（碼完，待部署與實機驗收）** | 無 |
| PG-SHARE-05 | 歸因：`POST /v1/metrics/share` ＋ `share_aggregates` ＋ 落地頁 beacon ＋ `GET /v1/ops/metrics/share`（JSON／CSV）＋ `scripts/ops/share.sh` | **WIP（碼完，待部署）** | 04 |
| PG-SHARE-06 | C／D／E 卡型與 S4～S7 進入點 | TODO | 03 |
| PG-SHARE-07 | `story` 9:16 尺寸與安全區 | TODO | 03 |
| PG-SHARE-08 | 凍結外觀／Mint 狀態／獨立分享同意、deep link 回退與裝置驗收 | TODO・首批必要 | 01～04 |
| PG-SHARE-09 | 路線形狀匯出：裁切、再經過起終點保護區、多段路線與隱私預覽 | TODO・第二階段 | 01、03、08 |

**優先順序調整**：P0 先交付無路線的 A／B 卡、獨立預覽、文案複製、通用落地頁與真實安裝狀態；P1 再做 C／D／E 與彙總計數；P2 才做路線形狀、story 及各活動專屬 OG。01 的 route 欄位先保持關閉，09 驗收前不露出可用開關。05 可同批評估，但不阻擋 P0；不為缺少歸因加入裝置指紋。

第一批可交付＝**01＋02＋03＋04＋08**（運動成績卡 A、成就卡 B、能貼出圖、連結有預覽圖有安裝按鈕）。量化成效需 05，未完成時僅記操作驗收結果。

不承諾工期；依 [PG](../pg.md) 順序推進，合併進 dev 前狀態維持 WIP。

---

## 9. 驗收

### 9.1 自動測試

- `shareCardLayout`：同一筆運動 × 各開關組合 → 版面資料快照；**關閉的欄位絕不出現**。
- 路線開關關閉時，版面資料裡**沒有任何座標欄位**（型別上就拿不到）。
- tSKR 卡缺 Devnet／測試代幣標示時**測試失敗**；不同網路資產不可錯貼標籤。
- 取圖失敗 → 顯示重試／改分享文字；使用者取消 → 不再彈出分享面板。
- 分享 API 返回後接收端仍可讀取；到期且不在本次分享中的快取才清除，包含重啟後補清理。
- i18n：zh-TW 與 en 的 `share.card.*`／`share.invite.*` key 完全一致。

- 真實鏈上狀態：pending／approved／confirming 不得出現「已鑄造」，拒簽不產生成就成功卡。
- 舊紀錄重分享：升級／換鞋／修改全域背景不改原快照；日期、成績與鏈上連結關閉後，在圖、文字、QR、metadata 都不出現。
- 分享中取消、快速連點、退背景、程序被終止、跨帳號與磁碟滿：不重送 Mint、不發布兩次，重啟後按 TTL 清理。
- OG：直接 GET 最終 URL 即有 head 標籤、圖片可讀、canonical 無來源參數；無 JS 模式也可見安裝說明。
- 指標：取消分享、API 返回、商店點擊不能寫入「已發布／已安裝」事件。

**路線第二階段的發布門檻**：privacy trim 不能只刪首尾幾個點；需按距離裁切，並移除全程再次進入起終點保護區的點。裁切後再正規化，不跨 GPS 缺口或裁掉的區段補連線。短路線或裁切後不足有效點時不提供形狀；不減少保護距離來湊圖。建議先評估兩端各 200 m，實作前定義足夠剩餘長度與折返／繞圈案例；此數值不構成匿名保證。使用者確認的預覽要與實際 PNG 一致。

### 9.2 實機證據（Seeker）

| # | 項目 | 預期 | 證據 |
|---|---|---|---|
| 1 | 摘要頁 → Share image | 出現 1080×1350 PNG 預覽，主數字可讀 | 截圖 |
| 2 | 關閉 pace／splits | 圖上真的沒有 | 截圖 |
| 3（第二階段） | 路線開關（開） | 只有形狀、無底圖、起終點已裁 | 截圖 |
| 4 | 分享到 IG／LINE | 圖片成功帶入 | 截圖 |
| 5 | 飛航模式 | 仍能出圖（成就美術取本機） | 截圖 |
| 6 | 貼 `neonshift.cc/e/<slug>` 到 LINE | 出現 OG 大圖，不是灰底裸連結 | 截圖 |
| 7 | 落地頁 `Get NeonShift` | 能開到 dApp Store 頁 | 截圖 |
| 8 | 分享返回／暫存到期／App 重啟 | 接收 App 可完整讀圖；到期檔才被清除，不刪正在交付的檔案 | 接收端截圖＋快取目錄與時間記錄 |

證據歸檔到 `docs/evidence/`，格式比照 [device-acceptance-runbook.md](../evidence/device-acceptance-runbook.md)。

---

## 10. 待決事項

| 編號 | 問題 | 選項 | 建議 |
|---|---|---|---|
| DEC-S1 | 圖上要不要放 QR | 放（離線也能被掃）／不放（版面乾淨） | **放**，只在 `post` 右下角、最小 180 px 並保留 quiet zone；內容為允許清單內 HTTPS URL、不含個資；需通過社群壓縮後掃描測試，開網頁仍需網路 |
| DEC-S2 | 活動 OG 圖是否動態 | 靜態主視覺／依活動動態產生 | 首版**品牌通用靜態圖**；活動專屬靜態圖需按 slug 建置 HTML head，另列後續 |
| DEC-S3 | 是否做 `/s/` 落地頁，或直接連首頁 | `/s/<kind>`／首頁 | **做 `/s/`**，才能分 `kind` 量測且文案對得上來源 |
| DEC-S4 | 分享是否要能儲存到相簿 | 要（需 `expo-media-library` 權限）／只分享 | **先只分享**，權限成本高於效益 |
| DEC-S5 | 是否在圖上標示運動日期 | 現況 `date` 預設關 | 維持**預設關**；改動需重新檢視 §5.3 |

---

## 11. 交付範圍

現在的分享是「一段文字丟出去、連結沒有預覽圖、也不知道有沒有人因此下載」。這份規劃把它補成「裝置端合成的一張圖 ＋ 有 OG 預覽的落地頁 ＋ 一個看得到的安裝按鈕 ＋ 一組彙總可量測的來源」，且**不匯出原始 GPS 座標；路線形狀只在另行同意與裁切後隨圖片分享**。


## 12. 本次檢視依據與待實作邊界

2026-09-25 檢視本目錄（目前僅本 README）及 `app/package.json`、`domain/review.ts`、運動摘要與活動分享入口、`web/index.html`、`web/e/index.html`、活動歸因後端與固定外觀規格。本次只更新規劃，沒有新增分享套件、改 App、部署網站或宣稱分享功能已完成。

技術核對來源：

- [Expo SDK 57 Sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/)：出站檔案分享與參數；以圖片分享加獨立複製文案作為首版能力邊界。
- [React Native Share](https://reactnative.dev/docs/share)：Android 回傳 sharedAction 不足以證明社群發布完成，故採分享意圖而非發布率。
- [Open Graph protocol](https://ogp.me/)：基本 head metadata、圖片與 canonical URL；每個路徑的靜態 HTML 交付方式仍須新增。

尚待實機證據：接收端讀檔時機、IG／Threads／LINE 等目的地行為、正式簽章 App Links、商店上架與下載入口。文件內建議值不是已完成驗收，也不是社群平台保證。

## 2026-09-25 延伸：節日收藏分享

B 成就卡可擴充 [Seasonal Footprints 年度徽章](../design/seasonal-achievement-nfts.md)：主題插畫、年份、活動名與真實收藏狀態。節日日期與年份是公開主題，不等於使用者精確取得時間；後者仍預設關閉。核准但未 Mint 只能分享「可領取」狀態；已 confirmed 才顯示「已鑄造」。公開連結導向主題介紹，不包含自己的 Activity ID、起終點或錢包。

此為 PG-SEASON-05 與社群卡的未實作整合；不因概念頁存在就宣稱節日挑戰已上線。
