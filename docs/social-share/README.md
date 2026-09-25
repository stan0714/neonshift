# NeonShift 社群分享規劃（運動者分享 → 下載 App → 參加活動）

| 項目 | 內容 |
|---|---|
| 文件版本 | v0.1（規劃，尚未實作） |
| 建立日期 | 2026-09-25 |
| 狀態 | **TODO**；PG-LINK-10 已記載「社群圖片分享列候選，尚未實作（需 react-native-view-shot／expo-sharing 原生依賴，另立工作）」——本文件即該工作的規劃 |
| 對應需求 | [BRD v0.6](../brd-detailed.md)、[SD](../sd.md)、[Style Guide](../style.md)、[PG](../pg.md) |
| 相關文件 | [跑鞋連動與路線外觀](../design/shoe-route-linkage.md)、[特殊圖案路線挑戰](../design/pattern-route-challenges.md)（R2 可撤銷分享連結）、[商店素材](../store/listing.md)、[活動 Demo 腳本](../store/event-demo-playbook.md) |
| 目標平台 | Android／Solana Mobile Seeker；分享目的地為 Instagram、Threads、X、LINE、Facebook、Discord |
| 介面語言 | English ＋ 繁體中文（`app/src/i18n`，兩份字典 key 一致） |

---

## 1. 目的與非目標

### 1.1 目的

讓「剛完成一場運動／剛拿到一個成就／剛報名一場活動」的使用者，在情緒最高的那 30 秒內，用**一張看得懂的圖 ＋ 一段可貼的文字 ＋ 一個可點的連結**把自己的成果放到社群，並讓看到的人能在兩步內裝到 App、加入同一場活動。

三個可量測結果：

1. **分享率**：完成運動／取得成就／報名活動後有實際送出分享的比例。
2. **連結回訪**：分享連結帶來的落地頁瀏覽數（依 `source` 分桶）。
3. **轉換**：落地頁 → dApp Store → 開 App → 報名／連錢包。活動類已有現成的 `views → registrations → checkins → redemptions` 漏斗。

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
| 活動歸因計數 | [partner/routes.ts:127](../../backend/src/partner/routes.ts#L127) `source()` ＋ `bumpCampaign()` | 依 `?source=`（上限 32 字元）分桶記 views／registrations／checkins／redemptions，有 CSV 匯出 |
| 活動落地頁 | [web/e/index.html](../../web/e/index.html) | 中英雙語、保留 `location.search` 轉進 `neonshift://e/<slug>`，App Links 已用 `web/.well-known/assetlinks.json` 驗證 |
| 成就美術 | `web/nft/achievements/*.svg`、`web/nft/img/*.png` | 既有的成就與跑鞋圖，可直接當圖卡素材來源 |

### 2.2 缺的（本規劃要補的）

1. **完全沒有圖片分享**。`Share.share({ message })` 只送文字，IG／Threads 這類以圖為主的平台幾乎貼不出東西。
2. **網站沒有任何 OG／Twitter card 標籤**（`web/` 全站 grep 無 `og:image`）。現在把 `neonshift.cc/e/<slug>` 貼到 LINE／X／Facebook，出現的是灰底無圖的裸連結——分享出去也沒人會點。
3. **落地頁沒有安裝按鈕**。首頁只有一句「即將於 Solana dApp Store 上架」，`storeUrl`（`solanadappstore://details?id=cc.neonshift.app`）沒有出現在任何網頁上。
4. **非活動分享沒有任何歸因**。運動成績卡、成就卡分享出去後無法知道有沒有帶人進來；`bumpCampaign` 目前綁 `event_id`。
5. **react-native-view-shot／expo-sharing 尚未安裝**（`app/package.json` 只有 `expo-file-system`、`react-native-svg`）。需要新原生依賴＋重新出包。

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
| S2 | 成就 mint 成功 | `Milestones`／`PersonalBests`／Gallery 本人頁 | B | 成就名＋鏈上可查 | `neonshift.cc/s/achievement?source=mint` | `/s/` |
| S3 | 成就護照 | Passport（`pass.intro`） | B（多格） | 「4 Valid」整體 | `neonshift.cc/s/passport?source=passport` | `/s/` |
| S4 | 報名完成 | 活動詳情（已有 `shareInvite`） | C | 活動名＋時間＋還剩幾位 | `neonshift.cc/e/<slug>?source=invite` | `/e/<slug>`（已有） |
| S5 | 活動完賽／領到權益 | 活動結果頁、`EventBadges` | B／C | 完賽時間（依 NFT 公開同意） | `neonshift.cc/e/<slug>?source=finish` | `/e/<slug>` |
| S6 | 跑鞋升階、里程里程碑 | Gear 卡片、摘要頁 `sum-first-wear` | D | 升階名稱＋累積里程 | `neonshift.cc/s/gear?source=levelup` | `/s/` |
| S7 | Guardian 解鎖 | `GuardianMilestone`（已有分享） | E | `guardian.shareText` | `neonshift.cc/s/guardian?source=guardian` | `/s/` |

> S1／S4／S7 已有純文字分享，本期是**加圖**與**補歸因**，不改既有同意模型。

---

## 4. 圖片規格

### 4.1 尺寸（三種，同一份版面資料出三檔）

| 代號 | 尺寸 | 比例 | 用途 |
|---|---|---|---|
| `post` | 1080 × 1350 | 4:5 | IG／Threads／Facebook 貼文（4:5 在時間軸佔版面最大） |
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
- **霓虹只打在主數字與狀態標**，其餘保持低對比（Style §1.1 Signal over spectacle）。
- **最小字級 28 px**（1080 寬下），縮圖後仍要讀得出主數字。
- **必含產品線索一行**：說明這個 App 在做什麼，讓沒用過的人看得懂。
- **`DEVNET` 與 `tSKR / Test Token · No monetary value` 必須出現**在任何含代幣或鏈上資產的圖卡上（Style §1.4、legal 一致）。缺這行的圖卡視為不可發布。

### 4.3 五種圖卡

| 卡型 | 內容 | 預設含 | 預設不含 |
|---|---|---|---|
| **A 運動成績** | 距離（hero）、時間、配速、模式、分段、目標達成 | 依 `SHARE_CARD_DEFAULT`：mode／pace／splits／goal | **路線圖**、精確開始時間、GPS 品質、錢包位址 |
| **B 成就收藏** | 成就名、等級圖（`web/nft/achievements/*.svg` 同一份美術）、鏈上可查字樣、`DEVNET` | 成就名、圖、日期（月份） | 精確數值（除非該 NFT 已同意公開）、asset id 全長、錢包位址 |
| **C 活動邀請** | 活動名、日期、地點城市層級、剩餘名額、主辦方名 | 活動公開資訊 | 個人報名資料、報到碼、NFC tag、其他參加者 |
| **D 里程／升階** | 跑鞋外觀、等級名、累積里程、下一階還差多少 | 鞋款、里程 | 每次運動明細、路線 |
| **E Guardian 故事** | 物種插畫、一句故事、共同進度 | 故事文案（`guardian.*`） | 任何個人數據 |

### 4.4 使用者控制

- 圖卡欄位開關**沿用 `ShareCardFields`**，不另開一套；文字卡與圖卡看到的是同一組開關（避免「文字沒寫但圖裡有」）。
- 送出前**一定要有預覽**（現在文字已有 `sum-share-preview`，圖卡要看到縮圖）。
- 「路線圖」是獨立的、**預設關閉**的開關，並在旁邊寫明後果（見 §5）。

---

## 5. 隱私與合規紅線（不可協商）

1. **GPS 座標與路線不離開手機**。因此圖卡**必須在裝置端合成**，不得把運動資料送到伺服器產圖。這條同時決定了 §6 的技術方案。
2. 若使用者主動打開「含路線圖」：圖只畫**相對形狀**（正規化後的軌跡），不含座標、不含底圖、不含起終點標記，並在開關旁明講「路線形狀可能透露你常跑的地點」。起終點各自裁掉一段（privacy trim）。
3. **預設不含**錢包位址、精確開始時間、GPS 品質、他人任何資料。
4. NFT 的 `pb.consentShare`（metadata 是否寫精確值）**不等於**同意社群分享；兩者分開詢問，社群分享不得因為 NFT 已公開就自動帶入精確值以外的欄位。
5. 活動圖卡只用**主辦方公開資訊**；健康資料不提供給主辦方（`ev.accept` 已承諾），圖卡不得成為繞道。
6. 任何含代幣的圖卡標示 `DEVNET` 與 `Test Token · No monetary value`，不得讓觀看者誤認為官方 SKR。
7. 產生的圖檔寫入**快取目錄**，分享完成或取消後即刪；不寫入相簿，除非使用者明確選「儲存到相簿」。
8. 歸因只記彙總（`source` × 日期 × 事件計數），**不產生個人分享識別碼**，不得用連結反查分享者。

---

## 6. 技術方案

### 6.1 App 端（圖卡）

```
ShareCardView (react-native-svg，離屏 1080×1350)
        │  同一份 ShareCardInput ＋ ShareCardFields（與文字卡共用）
        ▼
captureRef()  ← react-native-view-shot
        ▼
cacheDirectory/share-<kind>-<ts>.png  ← expo-file-system（已安裝）
        ▼
expo-sharing.shareAsync(uri, { dialogTitle, mimeType: 'image/png' })
        ▼
finally: deleteAsync(uri, { idempotent: true })
```

- 新增原生依賴：`react-native-view-shot`、`expo-sharing`。兩者都需要重新 prebuild／出包（`scripts/app/build.sh demo release`），不能靠 OTA。
- 版面用 **`react-native-svg`（已安裝）** 繪製，字級與色彩吃 token，避免不同裝置字體度量差異造成裁字。
- **失敗一律 fallback 到現有純文字分享**，不阻斷流程：取圖失敗、無分享目標、儲存空間不足都走 `Share.share({ message })`。
- **離線可用**：圖卡資料全部來自本機運動紀錄與已快取的成就圖；離線時不去抓遠端圖，改用打包在 App 內的成就美術。
- 文字與連結一起送：Android 的分享 intent 可同時帶 `text` ＋ 圖片附件，但部分 App（IG）會丟掉文字 → 同時提供「複製文案」按鈕。

### 6.2 網站端（OG 預覽 ＋ 落地頁）

- 新增 `/s/` 落地頁（`web/s/index.html`）：路徑 `#/workout|achievement|gear|guardian|passport`，中英雙語，主按鈕 `Get NeonShift`（`storeUrl`）＋ 次按鈕 `Open in NeonShift`（`neonshift://`），並說明 Seeker／Android 需求。
- 為 `web/index.html`、`web/e/index.html`、`web/s/index.html` 補 `og:title`／`og:description`／`og:image`／`twitter:card=summary_large_image`。
- OG 圖（1200×630）**靜態產生**：每種卡型一張通用圖，放 `web/og/<kind>.png`，由既有 SVG 於 build 時轉出。**活動頁不做動態 OG**（會需要把活動資料推到邊緣節點，且人數會隨時變動造成快取不一致），改用該活動的固定主視覺。
- `/e/<slug>` 已保留 query string；`/s/` 同樣保留，讓 `source` 能一路傳進 App。

### 6.3 後端（歸因）

- 把 `bumpCampaign` 的概念擴一個**非活動的彙總表**：`(kind, source, day) → views, installs_hint, connects`，或最省的做法是新增 `POST /v1/metrics/share`（無身分、只收 `kind`＋`source`、有速率限制）。
- 落地頁進站時打一次計數（`kind` 從路徑、`source` 從 query）。**不設 cookie、不記 IP**。
- 這條是「知道有沒有用」的唯一依據；若不做，S1／S2／S6／S7 的成效無法量測，只能靠活動漏斗推估。

---

## 7. 文案模板（i18n key 對照）

新增 key 一律 `share.card.*`／`share.invite.*`，zh-TW 與 en 兩份同時補齊。**按鈕名用英文、說明文字用當地語言**（沿用專案慣例）。

| key | en | zh-TW |
|---|---|---|
| `share.card.title` | Share card | 分享圖卡 |
| `share.card.image` | Share image | 分享圖片 |
| `share.card.copy` | Copy caption | 複製文案 |
| `share.card.route` | Include route shape | 包含路線形狀 |
| `share.card.routeWarn` | The shape can reveal where you usually run. Start and end points are trimmed. | 路線形狀可能透露你常跑的地點；起終點會各裁掉一段。 |
| `share.card.tagline` | Earn shoes and on-chain achievements just by walking or running. | 走路和跑步就能養跑鞋、拿鏈上成就。 |
| `share.card.devnet` | DEVNET · Test Token · No monetary value | DEVNET · 測試代幣 · 無金錢價值 |
| `share.invite.workout` | I just finished {km} km with NeonShift on Seeker. Walk or run, grow your shoes, collect on-chain achievements — free. {url} | 我剛用 NeonShift 跑完 {km} km。走路跑步養跑鞋、收集鏈上成就，免費。{url} |
| `share.invite.achievement` | Unlocked **{name}** — a free, on-chain achievement collectible in NeonShift. {url} | 解鎖 **{name}**——NeonShift 的免費鏈上成就收藏。{url} |
| `share.invite.event` | I'm joining **{title}** on {when}. {left} spots left — come with me. {url} | 我要參加 **{title}**（{when}），還剩 {left} 個名額，一起來。{url} |
| `share.invite.gear` | My shoes just reached **{level}** after {km} km. {url} | 我的跑鞋跑了 {km} km，升到 **{level}**。{url} |

文案三段式：**我做了什麼 → 這個 App 給什麼 → 連結**。不用「賺」「收益」「投資」等字眼（成就 NFT 是免費收藏品，非金融商品）。

---

## 8. 工作分解

| 編號 | 名稱 | 狀態 | 依賴 |
|---|---|---|---|
| PG-SHARE-01 | 圖卡資料層：沿用 `ShareCardInput`／`ShareCardFields`，加 `kind`、`route`（預設關）與純函式版面資料 | TODO | 無（可先寫測試） |
| PG-SHARE-02 | `ShareCardView`（react-native-svg，1080×1350）＋ A／B 兩種卡型與預覽 | TODO | 01 |
| PG-SHARE-03 | 安裝 `react-native-view-shot`／`expo-sharing`，出圖、分享、快取清除、失敗 fallback、重新出包 | TODO | 02 |
| PG-SHARE-04 | 網站：`/s/` 落地頁 ＋ 全站 OG／Twitter card ＋ `Get NeonShift` 按鈕 | TODO | 無 |
| PG-SHARE-05 | 歸因：`/v1/metrics/share` 或彙總表 ＋ 落地頁計數 ＋ CSV 匯出 | TODO | 04 |
| PG-SHARE-06 | C／D／E 卡型與 S4～S7 進入點 | TODO | 03 |
| PG-SHARE-07 | `story` 9:16 尺寸與安全區 | TODO | 03 |

第一批可交付＝**01＋02＋03＋04**（運動成績卡 A、成就卡 B、能貼出圖、連結有預覽圖有安裝按鈕）。05 建議同批做，否則無法判斷成效。

不承諾工期；依 [PG](../pg.md) 順序推進，合併進 dev 前狀態維持 WIP。

---

## 9. 驗收

### 9.1 自動測試

- `shareCardLayout`：同一筆運動 × 各開關組合 → 版面資料快照；**關閉的欄位絕不出現**。
- 路線開關關閉時，版面資料裡**沒有任何座標欄位**（型別上就拿不到）。
- 含代幣的卡型缺 `DEVNET` 標示時**測試失敗**。
- 取圖失敗 → 走純文字分享且不丟例外。
- 分享結束（成功或取消）→ 快取檔被刪。
- i18n：zh-TW 與 en 的 `share.card.*`／`share.invite.*` key 完全一致。

### 9.2 實機證據（Seeker）

| # | 項目 | 預期 | 證據 |
|---|---|---|---|
| 1 | 摘要頁 → Share image | 出現 1080×1350 PNG 預覽，主數字可讀 | 截圖 |
| 2 | 關閉 pace／splits | 圖上真的沒有 | 截圖 |
| 3 | 路線開關（開） | 只有形狀、無底圖、起終點已裁 | 截圖 |
| 4 | 分享到 IG／LINE | 圖片成功帶入 | 截圖 |
| 5 | 飛航模式 | 仍能出圖（成就美術取本機） | 截圖 |
| 6 | 貼 `neonshift.cc/e/<slug>` 到 LINE | 出現 OG 大圖，不是灰底裸連結 | 截圖 |
| 7 | 落地頁 `Get NeonShift` | 能開到 dApp Store 頁 | 截圖 |
| 8 | 分享完成後 | 快取無殘留檔 | `adb shell` 目錄列表 |

證據歸檔到 `docs/evidence/`，格式比照 [device-acceptance-runbook.md](../evidence/device-acceptance-runbook.md)。

---

## 10. 待決事項

| 編號 | 問題 | 選項 | 建議 |
|---|---|---|---|
| DEC-S1 | 圖上要不要放 QR | 放（離線也能被掃）／不放（版面乾淨） | **放**，但只在 `post` 尺寸右下角、最小 180 px |
| DEC-S2 | 活動 OG 圖是否動態 | 靜態主視覺／依活動動態產生 | **靜態**，避免資料外流與快取問題 |
| DEC-S3 | 是否做 `/s/` 落地頁，或直接連首頁 | `/s/<kind>`／首頁 | **做 `/s/`**，才能分 `kind` 量測且文案對得上來源 |
| DEC-S4 | 分享是否要能儲存到相簿 | 要（需 `expo-media-library` 權限）／只分享 | **先只分享**，權限成本高於效益 |
| DEC-S5 | 是否在圖上標示運動日期 | 現況 `date` 預設關 | 維持**預設關**；改動需重新檢視 §5.3 |

---

## 11. 一句話總結

現在的分享是「一段文字丟出去、連結沒有預覽圖、也不知道有沒有人因此下載」。這份規劃把它補成「裝置端合成的一張圖 ＋ 有 OG 預覽的落地頁 ＋ 一個看得到的安裝按鈕 ＋ 一組彙總可量測的來源」，而且**不讓任何 GPS 資料離開手機**。
