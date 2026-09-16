# NeonShift UI Style Guide & Screen Planning

| 項目 | 內容 |
|---|---|
| 文件版本 | v0.2（Logo／Splash／Loading 視覺稿） |
| 建立日期 | 2026-09-09 |
| 對應需求 | [BRD v0.6](./brd-detailed.md) |
| 目標平台 | Android only；Solana Mobile Seeker 為主要裝置 |
| 首版介面語言 | English ＋ 繁體中文（2026-09-14 專案負責人指示；Profile 可切換系統／English／繁體中文）；本文件以繁中說明 |
| 設計關鍵字 | Cyber fitness、neon telemetry、digital gear、trusted motion |

---

## 1. 文件目的

本文件定義 NeonShift 的視覺語言、design tokens、共用元件、畫面結構、狀態與動效，作為 UI 設計、React Native 實作、測試與 Demo 錄製的共同依據。

參考圖提供的是品牌氛圍，不是可直接複製的 UI。產品內應保留深色背景、青綠／紫色霓虹、全息跑鞋與運動數據感，但降低裝飾噪音，確保數據、任務狀態和交易風險優先被看見。

### 1.1 設計目標

1. 使用者在 3 秒內看懂今日步數、睡眠、任務狀態與主要動作。
2. 讓跑鞋 NFT 成為畫面視覺中心，但不壓過交易金額或警告訊息。
3. Web3 操作使用熟悉語言說明，不以炫技術名詞代替風險提示。
4. 霓虹效果只用於焦點與狀態，不讓所有元素同時發光。
5. 明確標示 `DEVNET`、`tSKR` 與 `Test Token · No monetary value`，不得讓使用者誤認為官方 SKR。

### 1.2 設計原則

- **Signal over spectacle**：先讀懂訊息，再感受特效。
- **One primary action**：每個畫面只保留一個最明顯的主要 CTA。
- **Progressive permission**：權限在需要時才解釋並請求，不在首次啟動一次索取全部權限。
- **State is explicit**：loading、同步中、可領取、已領取、失敗與離線均使用文字加圖示，不只依靠顏色。
- **Trust through clarity**：簽章前呈現網路、資產、費用、結果與不可逆操作。

---

## 2. 畫面架構

### 2.1 核心流程

```text
Native Launch Screen
        ↓
App Loading / Bootstrap
        ↓
Landing ──→ Demo Preview
   ↓
Connect Wallet
   ↓
Health Permission → Activity Permission
   ↓
Starter Shoe Claim
   ↓
Dashboard
   ├── Gear
   ├── Arena
   ├── Activity
   └── Profile / Settings
```

定位權限屬選用的輔助風險訊號，只在 Arena 或需要 GPS 驗證的情境另行請求；拒絕後仍可使用 M 級每日打卡功能。

### 2.2 Navigation

登入後使用固定四分頁 bottom navigation：

| 分頁 | Icon 語意 | 用途 |
|---|---|---|
| Home | house / pulse | 今日數據、任務與打卡 |
| Gear | shoe / layers | 跑鞋狀態、升級與進化 |
| Arena | trophy | 週末錦標賽、排名與質押 |
| Profile | user / settings | 錢包、權限、隱私與設定 |

- 必須同時顯示 icon 和 label，不使用只有 icon 的猜測式導覽。
- Active item 使用青綠色文字、實心 icon 與低強度 glow；inactive 使用 `Text Muted`。
- Activity history 從 Home 的次要入口進入，不占用首版主要 tab。

---

## 3. Visual Direction

### 3.1 品牌氣質

NeonShift 是「夜間城市中的個人運動終端」，不是駭客終端機，也不是賭場。畫面需兼具速度感、可信度與收藏感。

建議使用：

- 黑藍色空間背景與局部網格。
- 青綠作為健康、成功與主要互動色。
- 紫色作為裝備、Web3 與等級色。
- 洋紅只用於能量、稀有度或短暫強調。
- 細線 HUD、柔和光暈、數據刻度和低對比雜訊。
- 跑鞋以 3/4 視角置中，搭配圓形能量平台。

避免使用：

- 大面積純黑、純飽和螢光色或同時超過兩種強 glow。
- 難以閱讀的 glitch 文字、持續閃爍、掃描線覆蓋正文。
- 以 Solana 官方識別包裝 tSKR。
- 將背景城市、跑者和大量 HUD 全塞入日常操作畫面；此類構圖只適合行銷 hero。

### 3.2 Logo 概念

- Primary mark：由字母 `N`／向右躍遷箭頭構成的單色幾何符號。
- App icon：深色圓角方底，中央青綠至紫色 mark，不放細字。
- Wordmark：`NEONSHIFT` 全大寫；字距略寬，不使用極端 glitch 效果。
- Loading 與小尺寸場合只使用 mark，不使用完整標語。

### 3.3 NeonShift 專屬識別視覺稿（2026-09-14）

採用「Forward Shift」概念：傾斜幾何 N 的負空間形成向前上方箭頭，連結日常運動、成長與活動參與。抽象識別可延伸至跑團宣傳、NFC 卡片與成績憑證，不侷限於鞋款圖像。品牌仍使用既有 mint → cyan → violet 漸層，深藍黑底與白色字標。

| 視覺稿 | 檔案 | 使用方式 |
|---|---|---|
| 品牌識別 | [neonshift-identity-v1.png](../assets/brand/neonshift-identity-v1.png) | 主識別、App icon 與單色概念；以右上扁平 icon 的輪廓作向量定稿參考 |
| Native Splash | [neonshift-splash-v1.png](../assets/brand/neonshift-splash-v1.png) | 純深色底、置中 mark／字標、留白；實作尺寸與系統遮罩以 8.1 為準 |
| Bootstrap Loading | [neonshift-loading-v1.png](../assets/brand/neonshift-loading-v1.png) | 延伸 mark、細軌道與分步狀態；圖中為有快取時的示意狀態 |

這三張 PNG 為設計視覺稿，尚非 Android adaptive icon、向量母版或已串接的功能頁。不同稿件的光暈與箭頭呈現有生成差異，正式輸出須共用同一份向量輪廓；正式 UI 不沿用識別展示稿的強烈文字 glow。字標留白至少為 mark 寬度 1/4，小圖示只放 mark，不放字標；NFC 單色印刷版需重新做線條及實際尺寸辨識測試。

Splash 不顯示進度、不刻意等待；Loading 使用 8.3 的 1.6 秒微幅呼吸，不要求軌道持續旋轉，Reduce Motion 時靜止。文字及三個步驟需由真實初始化任務驅動；`Use offline data` 只有存在快取且符合 8.2 時才顯示，超過 10 秒必須提供重試。文字為可讀取的原生 UI，不把整張 PNG 當作互動畫面。

產圖方式與完整 prompts 保存於 [品牌資產說明](../assets/brand/README.md)。本版為第一版設計提案，UI-Q01 的最終品牌確認仍待 review。

---

## 4. Color Tokens

### 4.1 Base palette

| Token | Hex | 用途 |
|---|---|---|
| `color.bg.canvas` | `#050711` | App 最底層背景 |
| `color.bg.surface` | `#0B1020` | Card、sheet、navigation |
| `color.bg.elevated` | `#121A2E` | 浮層與選中區塊 |
| `color.bg.scrim` | `#02040BCC` | Modal scrim |
| `color.border.subtle` | `#26324A` | 一般邊框與 divider |
| `color.border.active` | `#30EBC8` | Focus、active card |
| `color.text.primary` | `#F4F8FF` | 標題與關鍵數據 |
| `color.text.secondary` | `#AAB7CC` | 說明文字 |
| `color.text.muted` | `#718099` | 次要 metadata、inactive |
| `color.neon.mint` | `#30EBC8` | Primary action、完成、步數 |
| `color.neon.cyan` | `#24C8FF` | 同步、資訊、數據線 |
| `color.neon.violet` | `#9B6CFF` | Gear、Web3、等級 |
| `color.neon.magenta` | `#FF4FD8` | 稀有度與短暫強調 |
| `color.semantic.success` | `#4BE39A` | 成功狀態 |
| `color.semantic.warning` | `#FFCB66` | 權限、devnet、等待 |
| `color.semantic.danger` | `#FF6B7A` | 錯誤與破壞性操作 |

### 4.2 Gradients

| Token | 定義 | 用途 |
|---|---|---|
| `gradient.brand` | `#30EBC8 → #24C8FF → #9B6CFF` | Logo、主要進度、hero 線條 |
| `gradient.gear` | `#9B6CFF → #FF4FD8` | 跑鞋稀有度、升級 moment |
| `gradient.surface` | `#121A2E → #090D19` | Hero card 與 bottom sheet |

規則：文字正文不可使用 gradient；同一 viewport 最多一個高亮 gradient 區域。

### 4.3 Glow

- Small：`0 0 8px`，alpha 20%，用於 icon 和 focus ring。
- Medium：`0 0 16px`，alpha 24%，只用於 primary CTA 或跑鞋平台。
- Hero：`0 0 32px`，alpha 18%，只用於 Landing／升級成功。
- Error、長文、整張 card 不使用 glow。
- React Native 實作需以 shadow、半透明圖層或預製資產控制成本，不依賴高模糊半徑即時動畫。

---

## 5. Typography

### 5.1 字體建議

| 角色 | 字體 | 備援 |
|---|---|---|
| Display / Brand | Space Grotesk SemiBold | system sans-serif |
| UI / Body | Inter | Roboto |
| CJK | Noto Sans TC | system sans-serif |
| Numeric telemetry | Rajdhani SemiBold | tabular-number system font |

正式打包前需確認字體授權並內嵌必要字重。英文字型缺少中文字形時必須完整回退至 Noto Sans TC，不混用缺字替代符號。

### 5.2 Type scale

| Token | Size / Line height | Weight | 用途 |
|---|---|---|---|
| `display.l` | 40 / 44sp | 700 | Landing hero 數字或短標題 |
| `display.m` | 32 / 36sp | 700 | 今日步數 |
| `heading.1` | 24 / 30sp | 700 | Page title |
| `heading.2` | 20 / 26sp | 600 | Section title |
| `title` | 16 / 22sp | 600 | Card title、button |
| `body` | 16 / 24sp | 400 | 正文與說明 |
| `body.small` | 14 / 20sp | 400 | 次要資訊 |
| `label` | 12 / 16sp | 600 | Uppercase label、chip |
| `caption` | 11 / 16sp | 500 | 時間戳、輔助資訊 |

- 數值使用 tabular numerals，千位以 locale format 顯示，例如 `12,580`。
- 全大寫只用於 20 字元內的 label，例如 `READY TO CLOCK IN`。
- Body 不小於 14sp；重要交易與錯誤文字不小於 16sp。
- 支援至少 130% Android font scale，內容不可被截斷。

---

## 6. Layout Tokens

### 6.1 Spacing

採 4dp 基準：`4, 8, 12, 16, 20, 24, 32, 40, 48, 64`。

| 用途 | 建議值 |
|---|---|
| Screen horizontal padding | 20dp；≥ 600dp 時 32dp |
| Section gap | 24–32dp |
| Card internal padding | 16–20dp |
| Compact item gap | 8–12dp |
| Bottom navigation height | 72dp + safe-area inset |
| Minimum touch target | 48 × 48dp |

### 6.2 Radius and border

| Token | 值 | 用途 |
|---|---|---|
| `radius.s` | 8dp | chip、compact control |
| `radius.m` | 12dp | input、button |
| `radius.l` | 20dp | card |
| `radius.xl` | 28dp | hero card、bottom sheet |
| `border.default` | 1dp | 一般 surface |
| `border.focus` | 2dp | keyboard／accessibility focus |

切角可用於 hero card 的純裝飾外框，但內容容器仍保持正常矩形 hit area。

### 6.3 Responsive rules

- 基準寬度以 360–412dp 手機設計，禁止只對單一截圖尺寸 hardcode。
- 使用 Android safe-area／system bar inset；主要 CTA 不得被 gesture navigation 遮擋。
- Dashboard 大數據與跑鞋區在矮螢幕可縮小間距，但不縮小 body font。
- Landscape 只需不崩潰；黑客松 MVP 不要求重新設計專用 landscape layout。

---

## 7. Core Components

### 7.1 Buttons

**Primary button**

- 高度 52dp，`radius.m`。
- 背景使用 `color.neon.mint`，文字使用 `#04110E`。
- 一頁只放一個視覺 primary。
- Pressed：亮度降低 8%，scale 最多 0.98。
- Disabled：surface 灰底、muted 文字、無 glow，並保留原因文字。
- Loading：保留原寬度，spinner + 動詞，例如 `Submitting…`。

**Secondary button**

- 透明底、1dp violet 或 subtle border。
- 適用 `View activity`、`Preview app`、`Not now`。

**Danger button**

- 只用於 disconnect、delete data 等操作。
- 預設 outline；確認 modal 的最終動作才可使用 danger fill。

### 7.2 Data Card

- 上方：icon、label、同步時間。
- 中段：主要數值與單位。
- 下方：progress bar、目標與狀態文字。
- Steps 使用 mint；Sleep 使用 violet；不得只靠顏色區分。
- 同步資料超過 30 分鐘時顯示 `Data may be outdated`。

### 7.3 Mission Card

狀態定義：

| 狀態 | 視覺 | CTA |
|---|---|---|
| In progress | subtle border、線性 progress | Disabled `Keep moving` |
| Ready | mint border、低強度 pulse 一次 | `Clock In` |
| Verifying | cyan spinner／stepper | Disabled `Verifying…` |
| Wallet approval | violet wallet icon | `Open wallet` |
| Confirming | transaction progress | `View transaction` |
| Claimed | success icon、無持續 glow | `Claimed` |
| Failed | danger icon、具體原因 | `Try again` |

### 7.4 Shoe Hero Card

- 跑鞋為透明背景 WebP／PNG 或 Lottie；首版不要求即時 3D。
- 圖像占 card 高度約 50–60%，周圍保留 breathing room。
- 固定顯示 `LEVEL`、XP、Core level 和 multiplier。
- 稀有度顏色只影響平台光圈與小型 badge，不改變正文顏色。
- NFT metadata 載入失敗時顯示品牌 placeholder，不留空白。

### 7.5 Token Amount

- 統一格式為 `150 tSKR`，不使用 `$tSKR` 或官方 SKR icon。
- 首次出現附近顯示 `Test Token · No monetary value`。
- 交易確認畫面同時顯示 devnet badge、mint 短地址與 network fee。

### 7.6 Chips and badges

- `DEVNET`：warning 色 outline，常駐於 Header 或 wallet chip。
- `SYNCED`：success 色，必須附時間。
- `OFFLINE`：neutral／warning 色，不假裝資料為即時。
- `LV. 3`：violet 色 gear badge。

### 7.7 Dialog and Bottom Sheet

- 一般選擇使用 bottom sheet；高風險交易使用 centered confirmation dialog。
- 簽章確認依序顯示：Action、Asset、Amount、Network、Expected result、Fee。
- 禁止只顯示 `Confirm transaction?`。
- 關閉 icon 具 48dp hit area，Android back 必須有一致行為。

### 7.8 Skeleton and Spinner

- Skeleton 使用 `surface → elevated` 的 1.2 秒柔和循環，不用高亮白色掃光。
- Spinner 只用於局部且預期短於 10 秒的動作。
- 超過 10 秒改顯示步驟、目前狀態與可採取動作。

---

## 8. Loading / Launch Page 規劃

Loading 不只是一張動畫圖，需拆成 OS launch screen 與 app bootstrap 兩層，避免白屏與錯誤地隱藏初始化失敗。

### 8.1 Native Launch Screen

**用途**：App process 啟動到 React Native 首幀之前。

```text
┌──────────────────────────┐
│                          │
│                          │
│          [ N mark ]      │
│         NEONSHIFT        │
│                          │
│                          │
└──────────────────────────┘
```

- 背景：`color.bg.canvas`。
- 中央 logo mark：72dp；下方 wordmark 可省略於小螢幕。
- 不放 spinner、進度百分比或複雜動畫；native splash 無法代表真實初始化進度。
- Android 12+ splash icon 必須在系統 mask safe zone 內，避免裁切。
- React 首幀準備完成後立即退出，不設定人為最短等待時間。

### 8.2 App Bootstrap Loading

**用途**：載入本機 session、遠端 Config、Health Connect availability、cached dashboard 與 wallet authorization 狀態。

```text
┌──────────────────────────┐
│ NEONSHIFT        DEVNET  │
│                          │
│       [pulse N mark]     │
│     Syncing your shift   │
│                          │
│   ● Profile              │
│   ◐ Health data          │
│   ○ Network              │
│                          │
│      [Use offline data]  │
└──────────────────────────┘
```

載入順序：

1. 讀取本機設定與 cached profile。
2. 檢查最低 App／Config 相容版本。
3. 檢查 Health Connect availability 和既有權限，不主動彈出權限 dialog。
4. 以保存的 MWA token 嘗試 reauthorize；失效時標記為 disconnected，不卡住啟動。
5. 拉取 dashboard 資料；網路失敗時使用快取並顯示資料時間。

狀態與逾時：

| 條件 | 處理 |
|---|---|
| 總載入 < 300ms | 直接進下一頁，不顯示 bootstrap 畫面以免閃爍 |
| 300ms–3s | 顯示 logo pulse 與目前步驟 |
| > 3s | 顯示仍在進行的步驟和 `Use offline data`（有快取時） |
| > 10s | 顯示 `Retry`、診斷摘要與可離線進入選項；停止無限 spinner |
| 強制更新 | 顯示版本原因與 `Update app`；不可假裝為一般 loading |
| 維護中 | 顯示預估恢復時間（若後端提供）與 retry |

Loading copy：

- Default：`Syncing your shift`
- Health：`Checking health access`
- Wallet：`Restoring wallet session`
- Network：`Contacting devnet`
- Offline：`Live data unavailable`

### 8.3 Loading 動效

- Logo 以 1.6 秒 ease-in-out 做 96%–104% 呼吸縮放與 12% glow 變化。
- 背景只允許極低對比的慢速 radial gradient，不使用高速粒子。
- 進度點逐步切換，不偽造百分比。
- 系統開啟 Reduce Motion 時停用縮放，改用靜態 logo 與文字狀態。

### 8.4 Loading 驗收

- 冷啟動全程無白屏或明亮閃爍。
- 無網路、後端逾時、錢包未安裝、token 失效及 Health Connect 不可用皆可離開 loading。
- Back、重試和離線進入不造成重複 navigation stack。
- loading 文字可被 TalkBack 讀出，狀態更新使用 polite announcement。

---

## 9. Landing Page 規劃

Landing 是首次使用者的產品價值頁，不是 loading page。它不應先要求權限，也不應播放無法跳過的影片。

### 9.1 資訊層級

```text
┌──────────────────────────┐
│ NEONSHIFT        DEVNET  │
│                          │
│      [hologram shoe]     │
│       CLOCK IN.          │
│    MOVE BEYOND LIMITS.   │
│                          │
│ Turn verified movement   │
│ into evolving gear.      │
│                          │
│ ✓ Health-powered missions│
│ ✓ Onchain gear progress  │
│ ✓ Multi-signal checks    │
│                          │
│ [ Connect wallet       ] │
│ [ Preview the app      ] │
│ Test Token · No value    │
└──────────────────────────┘
```

1. Header：品牌 mark；右側固定 `DEVNET` badge。
2. Hero visual：Lv.1 跑鞋、圓形能量平台、少量城市網格；不得使用官方代幣 logo。
3. Headline：最多兩行，傳達行動與進化。
4. Supporting copy：最多兩行，說明健康數據與 gear 關係。
5. 三個 proof points：各一行、用 icon + text。
6. Primary CTA：`Connect wallet`。
7. Secondary CTA：`Preview the app`，允許尚未安裝錢包的評審查看唯讀 demo。
8. Legal／environment note：`Runs on Solana devnet · Rewards use tSKR test tokens with no monetary value.`

### 9.2 Hero 文案

首選：

- Eyebrow：`YOUR DAILY SHIFT`
- Headline：`CLOCK IN. MOVE BEYOND LIMITS.`
- Body：`Turn verified movement into evolving onchain gear.`
- CTA：`Connect wallet`
- Secondary：`Preview the app`

備選：

- Headline：`EVERY STEP POWERS YOUR NEXT FORM.`
- Body：`Complete health missions, evolve your gear, and enter the weekend arena.`

不得使用：

- `Guaranteed earnings`
- `Real SKR rewards`
- `Cheat-proof`
- `Hardware verified`
- `Passive income`

### 9.3 Landing 行為

- 首次安裝、登出或 onboarding 未完成時顯示。
- 已完成 onboarding 且 session 可恢復時跳過 Landing，直接進 Dashboard。
- `Connect wallet` 呼叫 MWA；未安裝相容錢包時顯示說明與官方錢包取得方式，不進入無限 loading。
- `Preview the app` 進入帶有 `DEMO` badge 的唯讀 Dashboard；不得建立錢包、NFT 或健康資料假象。
- Landing 不請求 Health Connect、activity recognition 或 location 權限。

### 9.4 Landing 動效

- Hero 跑鞋進場：320ms fade + 12dp rise。
- 跑鞋 Hero：分層鞋面、鞋帶／孔眼、網布細節、鞋底刻紋與 N 光條；以 4.4 秒完整週期輕微懸浮（約 2.6% 圖寬）及 −2° 至 0° 擺動。橢圓能量平台保持水平透視，陰影隨懸浮淡入淡出，不整片旋轉。Reduce Motion、App 背景或頁面失焦時停用循環；使用 native driver 的 transform／opacity，避免逐幀 React 更新。
- Headline、body、CTA 依序以 60ms stagger 出現，總進場不超過 600ms。
- 不自動播放有聲內容，不使用連續 glitch 或快速閃光。

### 9.5 Landing 驗收

- 360dp 寬、最大字型 130% 時 primary CTA 仍在合理捲動範圍內且文案不截斷。
- 使用者不需連線錢包即可理解產品用途並進入唯讀 preview。
- TalkBack 順序為品牌 → hero 說明 → headline → proof points → CTA → disclaimer。
- Hero 圖載入失敗時仍保留 headline、CTA 與品牌 placeholder。
- 所有 `DEVNET`／tSKR 聲明不可被圖片、keyboard 或 system inset 遮擋。

---

## 10. Onboarding & Permission Pages

Landing 後採單一步驟頁面，不使用一次塞滿五頁的 carousel。

### 10.1 Wallet Connection

- Title：`Connect your mission wallet`
- 說明 MWA 將開啟相容錢包；NeonShift 不會取得 seed phrase。
- 顯示 network：`Solana Devnet`。
- Error 分為 rejected、wallet unavailable、session expired、network error。

### 10.2 Health Access

- Title：`Power missions with Health Connect`
- 先說明只讀取 Steps 與 Sleep，再由 CTA 觸發系統權限頁。
- 列出用途、30 天後端摘要保留上限與 `Manage later in Settings`。
- 拒絕後提供 `Open Health Connect settings` 與 `Not now`，不可反覆彈出。

### 10.3 Activity Recognition

- 獨立說明其用於動作特徵摘要與提高作弊成本。
- 不宣稱可完全證明真人步行。

### 10.4 Starter Shoe Claim（2026-09-14 由 Mint 改為免費贈與）

- 不鑄造 NFT、不收費：初階跑鞋隨鏈上 PlayerProfile 建立直接贈與（FR-04.1）。
- 顯示跑鞋名稱、network、owner 短地址、預估 network fee（僅帳戶 rent＋交易費，devnet SOL）和結果；不出現「Mint」字樣。
- Primary：`Claim starter shoe`。
- Secondary：`Back`。
- 成功後播放一次 800ms reveal；失敗保留重試，重試不會建立第二個 profile。

---

## 11. Dashboard 規劃

```text
┌──────────────────────────┐
│ Good evening      DEVNET │
│ 7F3…K9A       245 tSKR   │
│                          │
│ TODAY                    │
│ 12,580 steps   7h 38m    │
│ [██████████░] [███████░] │
│ Updated 2 min ago        │
│                          │
│ [      SHOE HERO       ] │
│ LV. 5 · CORE 3 · 1.5×    │
│                          │
│ READY TO CLOCK IN        │
│ Step mission · +15 tSKR  │
│ [ Clock In             ] │
│                          │
│ Home  Gear  Arena Profile│
└──────────────────────────┘
```

優先順序：

1. Header：問候、wallet chip、devnet、tSKR balance。
2. Today summary：Steps、Sleep、同步時間與手動 refresh。
3. Shoe hero：等級、XP、Core multiplier；點擊進 Gear。
4. Mission card：依 Step／Sleep 顯示兩項任務，可橫向卡片或上下排列。
5. Primary CTA：只有存在可領任務時顯示 `Clock In`。
6. Bottom navigation。

若兩項任務同時可領，先顯示任務選擇 bottom sheet；不可用一個按鈕讓使用者誤以為一次會領兩項。

---

## 12. Gear Page 規劃

（2026-09-14 改為免費升級：無升級 CTA、無費用與燒毀資訊）

- 上半部：大型跑鞋、Level、XP ring、visual stage。
- 中段：current multiplier、next multiplier、距下一階所需 XP。
- 下段 **My collection**：成就 NFT 網格，三種狀態——`Claimed`（實圖）、`Claimable`（mint border＋`Claim` 按鈕，免費、只付 devnet rent 的說明）、`Locked`（灰階＋解鎖條件，例如 `Reach Lv.3`、`7-day streak`）。每種成就最多一枚。
- 升級在打卡交易內自動發生，達門檻時只播放一次 reveal 並提供 transaction link；領取 NFT 成功播放一次 reveal。

### 12.1 Gallery（FR-13，2026-09-14 新增）

- 入口：Home 次要入口與 Arena 排行榜；不新增 tab。
- 列表：排名、短地址（或標籤）、Lv. badge、XP、收藏數；可搜尋錢包地址；顯示 `Updated <time>`。
- 玩家頁：頂部大跑鞋（依對方等級）、Lv／XP／streak／最近打卡日，下方 NFT 網格（只顯示已領取）；不顯示任何健康數值；自己的頁面標示 `You`。
- 空狀態：`No collectibles yet` 與該玩家距下一階的說明；載入失敗依 14 章。

---

## 13. Arena Page 規劃

### 13.1 未報名

- 顯示比賽 UTC 時段，也換算裝置當地時間。
- 顯示 entry stake、最低參賽人數、退款／獎金規則與目前人數。
- CTA：`Stake 50 tSKR to enter`。
- 質押前用 confirmation dialog 顯示最差情況可能損失的金額。

### 13.2 進行中

- 顯示目前 rank、verified steps、last verified time、leaderboard freshness。
- 排行榜地址預設遮罩；本人 row 固定強調。
- 異常或待驗證分數顯示 `Pending verification`，不先計入排名。

### 13.3 結算

- 顯示 final rank、stake refund、prize、forfeiture 與 transaction status。
- 爭議或檢查中不可顯示為 final。
- 作弊處置不得只顯示紅字；必須提供規則版本與申訴／聯絡方式。

---

## 14. Empty, Error & Offline States

| 場景 | Title | 行動 |
|---|---|---|
| 無健康權限 | `Health access is off` | `Review access` |
| 尚無睡眠資料 | `No sleep session found` | `Check Health Connect` |
| Wallet disconnected | `Reconnect your wallet` | `Connect wallet` |
| Wallet rejected | `Request canceled` | `Try again` |
| Devnet unavailable | `Devnet is taking a break` | `Retry`／`Use cached data` |
| NFT image unavailable | `Gear visual unavailable` | `Reload visual`；屬性仍顯示 |
| Tournament canceled | `Arena entry refunded` | `View transaction` |
| Generic error | `Something interrupted your shift` | 顯示 reference ID + `Try again` |

- Error 文案說明發生什麼、資料／資金是否安全、下一步是什麼。
- 禁止只顯示錯誤碼、`Failed` 或長篇 stack trace。
- Toast 只用於低風險短訊息；交易失敗與權限問題使用 inline state 或 dialog。

---

## 15. Motion & Haptics

| Token | Duration | 用途 |
|---|---|---|
| `motion.fast` | 120ms | pressed、chip |
| `motion.normal` | 220ms | page element、sheet |
| `motion.slow` | 320ms | hero、card transition |
| `motion.celebration` | 600–900ms | 打卡／升級成功，僅播放一次 |

- Default easing：`cubic-bezier(0.2, 0.8, 0.2, 1)`。
- 頁面 transition 不超過 320ms。
- 打卡成功使用一次 medium haptic；升級成功一次 success haptic。
- loading、失敗重試與 disabled control 不震動。
- 尊重 Reduce Motion；移除 parallax、循環縮放與粒子，只保留 opacity transition。

---

## 16. Iconography & Imagery

### 16.1 Icons

- 使用單一 rounded geometric icon family，stroke 2dp。
- 標準尺寸：20dp（inline）、24dp（navigation）、32dp（status）。
- 不混用 emoji、filled 3D icon 和不同筆畫 icon pack。
- Success、warning、danger 必須具不同形狀，不只換色。

### 16.2 Shoe assets

至少準備 5 階跑鞋視覺，構圖、尺寸與光源一致：

| Level | 主色 | 視覺變化 |
|---|---|---|
| 1 Origin／原點 | Graphite + silver | 0 XP；石墨網布、灰銀單軌、基本輪廓 |
| 2 Pulse／脈動 | Cyan + mint | 450 XP；雙光軌、加固後跟 |
| 3 Phase／相位 | Violet + cyan | 1,500 XP；側面外骨骼、分段鞋底 |
| 4 Surge／湧能 | Magenta + violet | 3,600 XP；後跟鰭片、可視能量艙 |
| 5 Zenith／極境 | Mint + iridescent | 7,500 XP；珍珠裝甲、懸浮鞋底模組 |

輸出要求：透明背景 WebP 為主、PNG fallback；同階資產 bounding box 必須一致，避免升級時跳動。裝飾動畫優先使用 Lottie 或預製序列，並提供靜態 fallback。

目前已提供五階 SVG 與唯讀 Demo 圖鑑；每階除了色彩亦有可辨識結構，不需播放動畫才能辨認。XP 條件及 Core 差異見 BRD 17；Demo 數值不可冒充玩家資產。優化順序及替換契約見 SD 12、PG 14：向量 → 精修靜態素材 → 進化動效 → 實機評估後選配 3D。Lv5 維持有限光暈，不增加高頻閃爍。

### 16.3 Marketing image vs. product UI

參考圖中的城市、跑者、浮空手機、Solana coin 與多層 HUD 適合作為 Pitch cover 或商店宣傳圖。App 內不可直接使用該完整合成構圖，也不得在 tSKR 旁使用官方 SKR／Solana coin 暗示官方獎勵。

---

## 17. Accessibility & Content Rules

- 一般文字與背景至少達 WCAG AA 4.5:1；大字至少 3:1。
- Active、success、warning、error 均提供 icon／文字雙重訊號。
- Touch target 至少 48dp，元件間保留足夠誤觸距離。
- TalkBack label 說明值與單位，例如 `Steps, twelve thousand five hundred eighty, goal eight thousand`。
- 動態數值不頻繁搶占 screen reader focus。
- 裝飾圖片標記為不可存取；具有資訊的圖表需提供文字摘要。
- UTC 規則需同時顯示裝置當地 reset time，避免只呈現 `UTC`。
- 地址預設縮寫為 `7F3…K9A`，點擊後可複製並顯示完整地址。
- 文案使用 `wallet`、`approve`、`network fee`、`test token`；避免 `gas`、`airdrop`、`free money` 等易誤解詞。

---

## 18. React Native Token Mapping

實作時建立單一 theme source，名稱沿用本文件；禁止在 screen component 直接散落 hex、radius 或 animation duration。

```ts
export const theme = {
  color: {
    canvas: '#050711',
    surface: '#0B1020',
    elevated: '#121A2E',
    scrim: '#02040BCC',
    borderSubtle: '#26324A',
    textPrimary: '#F4F8FF',
    textSecondary: '#AAB7CC',
    textMuted: '#718099',
    mint: '#30EBC8',
    cyan: '#24C8FF',
    violet: '#9B6CFF',
    magenta: '#FF4FD8',
    success: '#4BE39A',
    warning: '#FFCB66',
    danger: '#FF6B7A',
  },
  space: { xxs: 4, xs: 8, s: 12, m: 16, l: 20, xl: 24, xxl: 32, xxxl: 40, huge: 48, hero: 64 },
  radius: { s: 8, m: 12, l: 20, xl: 28 },
  motion: { fast: 120, normal: 220, slow: 320 },
} as const;
```

若實際實作調整 token，必須同步更新本文件與視覺回歸基準圖。

---

## 19. Screen Delivery Checklist

每個畫面交付時至少包含：

- Default、loading、empty、error、offline、disabled 狀態。
- 360dp 與 Seeker 實機寬度版面。
- 100% 與 130% font scale。
- Keyboard、system bar、gesture inset 與 Android back 行為。
- TalkBack label、focus order 與 contrast 檢查。
- 所有交易畫面的 devnet、tSKR、費用與結果說明。
- Reduce Motion 靜態／低動效版本。
- 可供測試引用的 screen／component 名稱。

### 19.1 MVP 必交畫面

1. Native Launch Screen。
2. App Bootstrap Loading（含 timeout／offline）。
3. Landing（含 wallet unavailable 與 Demo Preview）。
4. Wallet Connection。
5. Health Access／Activity Recognition。
6. Starter Shoe Claim／Success／Failure。
7. Dashboard 全任務狀態。
8. Clock In Confirmation／Verifying／Confirmed／Failed。
9. Gear／Upgrade Confirmation／Result。
10. Arena 未報名／進行中／結算。
11. Activity History。
12. Profile／Permissions／Privacy／Disconnect。

---

## 20. Open Design Decisions

| 編號 | 問題 | 建議預設 | 決定期限 |
|---|---|---|---|
| UI-Q01 | Logo／wordmark 最終版本 | 幾何 N + wordmark | 第一週第 2 天 |
| UI-Q02 | 首版跑鞋採 Lottie 或透明 WebP 階段圖 | WebP 靜態 + 成功 Lottie | 第一週第 3 天 |
| UI-Q03 | Landing 是否允許 Demo Preview | 允許，利於評審無錢包瀏覽 | 第一週第 3 天 |
| UI-Q04 | 指定用來驗收 NFT 顯示的錢包與版本 | 取得 Seeker 實機後立即確認 | 第二週第 1 天 |
| UI-Q05 | 英文字體是否可內嵌 | Space Grotesk + Inter；先驗授權與 APK 大小 | 第一週第 2 天 |
| UI-Q06 | Arena 未達最低人數的取消呈現 | 自動退款 + transaction link | 第三週前 |

---

## Appendix A. Reference Image Interpretation

從參考圖採用：

- 深藍黑底、青綠和紫色霓虹對比。
- 跑鞋作為核心資產 hero。
- 大型步數、睡眠 progress、等級和升級操作。
- 城市夜跑與數據 HUD 所代表的品牌世界觀。

不直接採用：

- `MOVE-TO-EARN` 與官方代幣視覺，避免與 tSKR／devnet 定位衝突。
- 同一畫面過多浮動面板、發光邊框與小字圖表。
- 中英混雜的產品 UI；每個畫面依使用者語言完整呈現英文或繁體中文（`app/src/i18n`，兩份字典 key 一致），不得在畫面內硬寫單一語言字串。品牌名、DEVNET／LV. 標籤、tSKR、錢包地址與交易簽章維持原文。
- 無 label 的 bottom-nav icon，以及缺少交易／測試網聲明的升級按鈕。

## 20. 活動旅程與 PB NFT 藝廊擴充

完整流程、欄位與線框見 [活動／跑步／藝廊設計](./activity-running-gallery.md) 第 1、6 章。沿用深藍黑、青綠／紫色與四 Tab；Home 加 Running／Gallery 次入口，Gear 保留 My collection，Arena 串活動成績收藏，Profile 提供跑步歷程／PB 櫃。

- 跑步摘要：公里、elapsed pace、步數、active kcal 四項主數據；每項顯示來源與 Estimated／Partial 標記。缺值用 —，暫停／移動時間分列。
- PB 卡片：Speed 用青藍切線計時環，Distance 用紫綠里程弧，Event 用活動拱門；不以真實 GPS 路線製作公開作品。類別、來源、Current／Historical／Invalidated 必須有文字。
- 藝廊以二欄 1:1 卡片為起點；窄螢幕／放大文字可改單欄。篩選 All／Shoes／Events／Personal best，不新增主 Tab。詳情分開原達成者與現持有人。
- 鑄造確認先預覽作品與所有公開欄位，列出不收 tSKR、實際網路費及 rent；不以「免費」掩蓋費用。可領取／待確認／已鑄造／資料待審／已修正各有明確狀態。
- 裝置紀錄不顯示官方認證圖章；鏈下活動徽章不標 NFT。結果修正不重播慶祝、不自動補鑄。Reduce Motion 保留靜態作品與數值，禁止熱量競賽及刺激性連續閃爍。

### 20.1 實作對照（PG-R-09，2026-09-15）

- Gallery 玩家頁：篩選列（All／Shoes／Events／Personal best，選中 mint 底）；「Personal bests」區二欄 1:1 `PbCard`：作品區（Speed 青藍環＋zap；Distance 紫綠弧＋map；官方 mint 色描邊）、類別標題、「系列 · 來源」caption、值或「Value kept private」、狀態 Chip（Current best＝synced／Historical best＝neutral／Invalidated＝devnet 警示，並降透明度）。本人顯示「View PB cabinet」連結（→ Workouts）與退出藝廊提示。
- NFT 詳情 `AchievementDetail`：卡片置中 60% 寬，列表：Series、Verification、Record status、Original achiever（連結玩家頁）、Current holder（說明以 Explorer 為準）、Minted、Network、Asset；「Open in Explorer」secondary Button；Invalidated 時 warning InlineState 說明鏈上仍留歷史。
- Profile：Gallery 區 Switch「Show me in the public gallery」＋說明退出只停止展示；「Running history & PB cabinet」按鈕。
- 作品檔：`web/nft/achievements/<category>-<class>.svg`（見 tools/nft-assets）。

## 21. 現役鞋階、維持挑戰與歷史收藏

依 [跑鞋遊戲性設計](./shoe-gameplay.md) 第 6 章。Gear 主 Hero 只展示 Active level；上方清楚分列「Active LV.3」「Highest LV.5」。XP 進度與本期維持點／活躍日為不同區塊，顯示完整期末時間與本地倒數。

目前裝備／曾經達成／尚未解鎖三區不能混用。已達成鞋款保留完整作品與 History 標籤，不用失效／銷毀效果；恢復時可播放低強度重新啟用動畫，不顯示再次獲得 NFT。能力卡標示所需 Active level，若是歷史已獲資格則保留 Claim 入口。

降階顯示現在鞋階、歷史保留與下期恢復條件，不以資產損失或羞辱文案催促。48／24 小時提醒需使用者可關閉。現役排行與歷史成就榜分開，標示結算時間。永久收藏、退款及個資操作不因等級變灰或停用。

### 21.1 實作（PG-V-04，2026-09-15）

- **Gear Hero**：上方 Chip「現役 LV.n」（level）與「歷史最高 LV.n」（高於現役時 synced 色）；ShoeHero／倍率只用 Active level（`coreLevel`）。XP ring 與 XP 區塊照舊，與維持區塊分開。
- **本期維持挑戰** Surface（`gear-maintenance-<state>`）：右上「剩 n 天」；兩格 Stat「維持點 x / 目標」「活躍日 x / 目標」（目標＝回歸階級 > 下一階 > 維持本階）；caption 本期結束本地時間＋UTC；文字列：維持 Lv n（已達／還需 x 點、y 活躍日，約 z 天雙任務）、回歸 Lv n（歷史最高高於現役時，附「你的成就仍在收藏中」）或升到 Lv n（XP 不足時改「還需累積更多 XP」）；註腳「步數 +100、睡眠 +50…未達標只調整裝備等級，不扣 XP、代幣或 NFT」。狀態：`migration_required`（下次打卡自動更新）、`settlement_pending`（n 期未結算，下次打卡先結算）。
- **收藏**：跑鞋依 `shoeSection` 分「目前裝備／曾經達成／尚未解鎖」三組；曾經達成 Tile 加「曾經達成」label、保留完整作品與 Claim（資格依歷史最高）；尚未解鎖維持灰階鎖頭。
- **藝廊**：列表頂部 tab「現役排行／歷史成就」（`?board=active|lifetime`）；歷史成就榜 Chip 顯示歷史最高（synced 色）、排序歷史最高 → 收藏 → XP；「n 位玩家 · 更新時間」即結算時間標示。

## 22. Genesis Distance 與紀念系列

作品概念、狀態及詳細流程見 [首次里程碑與紀念 NFT](./commemorative-nfts.md)。四枚以一致 1:1 框架設計：5K 青綠起跑門、10K 冰藍雙地平線、半馬紫色半環、全馬紫綠完整環與終點拱門。使用清楚距離字標／圖形，不只依顏色辨識；不使用未授權主辦方商標。

My collection 新增 Milestones；摘要可同時呈現首次、活動與 PB 卡片，文字不得混稱。首次卡顯示資料涵蓋範圍與 Organizer／Device；已達成用完整作品，不因鞋階降低變成灰色未解鎖。長距離同時解鎖多章採逐枚領取，不宣稱一次簽章可批次鑄造。

紀念情境以首次完賽、活動留念、回歸及週年為主；不把回歸推論為康復／傷病，不引導高熱量或超量運動。圖案抽象化，不展示原始路線；公開預覽明列成就門檻本身亦會透露運動紀錄。

### 22.1 實作（PG-M-03，2026-09-15）

- **作品**：`tools/nft-assets/build.mjs` → `web/nft/achievements/milestones/<category>-<class>.svg`（9 張：四距離 × organizer／device ＋ first_finish organizer）。統一 520×520 框架：細邊框、halo、主圖、距離字標（5K／10K／21.0975K／42.195K／FINISH）、系列字（GENESIS DISTANCE · FIRST …／FIRST FINISH · EVENT）、來源字（OFFICIAL RESULT mint／DEVICE RECORDED muted）。5K 青綠起跑門＋5 光點；10K 冰藍雙地平線＋日；半馬紫色半環＋虛線地平；全馬紫→青綠完整環＋終點拱門；First Finish 方格終點帶。
- **Milestones 區塊** `Milestones`（Gear → My collection 之後，PG-M-03）：資料涵蓋起點 caption（「依已匯入的紀錄判定首次…不代表人生首次」）、「同一筆紀錄解鎖 N 個里程碑，請逐枚領取」；每卡：章名＋作品名、Official／Device（室內另標）、門檻「單次 ≥ x km」、達成日（已解鎖才顯示）、狀態 Chip：未解鎖 neutral／裝置版尚未開放 neutral＋說明／待審 devnet／可領取 synced＋「Mint NFT」／等待核准 devnet／已領取 level／已撤銷 offline。未解鎖卡 opacity 0.7，不用鞋階變灰。
- **領取流程**：同意對話（預設只公開類別／門檻／驗證等級；門檻本身也會透露）→ intent → 「領取預覽」Alert 逐項列出會寫入 NFT 的屬性＋rent 揭露 → MWA 簽送；409 顯示「目前沒有符合的紀錄可領取」。
- **藝廊**：`PbCard` 同一卡片支援 genesis_distance（award 圖示）／first_finish（flag）；未公開顯示「距離與日期未公開」；玩家頁新增「首次」篩選與「首次里程碑」區（與 PB 區分開，不混稱）；NFT 詳情系列文字依 kind。
- **活動紀念章（PG-M-04）**：活動詳情在 Perks 之後加 `EventBadges` Surface（主辦方有發行才顯示）：說明「報到章與完賽章分開、每人每章一枚、免費只付 rent、需報名時 Lv2」；每列章名＋提示（未達權限時顯示「需報名時跑鞋 Lv2（你當時為 Lv1）」）、狀態 Chip（需報名／未達成／未達權限／已取消／可領取＋Mint／等待核准／已領取／已撤銷）。藝廊 Events 篩選改列活動章（check-circle／flag 圖示、卡名＝活動名、活動日期公開、時間名次未公開文案），無則空狀態。

## 23. 走路／跑步記錄與分圈

延續既有深色、霓虹青綠／紫與數字字體設計，詳 [GPS 運動畫面規格](./walk-run-tracking.md)。開始頁分別選 Walking／Running 與戶外／室內；記錄頁走路主顯示 km/h、跑步主顯示 min/km，時間／距離為次要資訊。GPS 品質與暫停狀態需文字加圖示，不能只靠顏色。

Lap／Pause 至少 48dp；Finish 置於暫停頁並確認。摘要分 Splits／Laps，未滿末段標 Partial，最高值標「最高速度（5 秒平均）」。跑道圈顯示「依距離估算」與剩餘公尺。缺值顯示 —，不使用 0 偽裝測量結果。記錄中降低動畫與裝飾，減少閱讀負擔；公開分享排除 GPS 路線。

### 23.2 開始／記錄／摘要（PG-R-03／R-06 實作，2026-09-14）

- **開始頁** `WorkoutStart`：Segmented（48dp、選中 mint 底／`onMint` 字）選 Run／Walk、Outdoor (GPS)／Indoor、自動圈 Off／400 m／1 km、分段 1 km／1 mile；跑道模式 Off／400 m／200 m／自訂（number-pad，100～2000 m）＋ caption 提示「依 GPS 距離估算，非實體過線；各跑道線長度不同請先核對」與「我已核對圈長」Switch，未核對或圈長無效時「Start recording」停用（disabledReason）（PG-R-12）。Indoor 顯示 info InlineState 導向匯入並停用「Start recording」（disabledReason）。定位拒絕 → warning InlineState（說明路線只留手機、可改匯入）＋「Open settings」。
- **記錄頁** `WorkoutRecord`（無 header、返回鍵鎖定）：頂列 GPS Chip（good＝synced／low accuracy＝devnet 警示／searching、off＝offline）與狀態 Chip（Recording＝level／Paused＝devnet）；主數字 88px tabular（跑步 min/km、走路 km/h，不足 5 秒窗顯示 —）；次列 displayM 時間／公里；底部兩顆 64dp 圓角控制鍵：記錄中「Lap」（surface 描邊）＋「Pause」（mint）；暫停中「Finish」（danger 描邊，Alert 確認）＋「Resume」（mint）。記錄中無動畫。 跑道模式時距離下方加一列 title「第 N 圈 ＋ m」與 caption「{len} m／圈 · 依距離估算」（PG-R-12）。
- **摘要頁** `WorkoutSummary`（無返回）：displayL 距離、四格 elevated 統計（Elapsed、Avg pace／speed、Top speed (5 s avg)、Active kcal — 無裝置值為 —）；needs_review 以 warning InlineState 說明不具 PB 資格；同步狀態列（已同步 success／未同步＋「Sync now」）；Tabs Splits／Laps／Quality：列＝序號、距離、時間、配速＋ Chip（Partial＝neutral、Across a gap＝devnet、Fastest＝synced）；跑道等效以 caption 標「依距離估算」；Quality 為 Chips（接受／拒絕／缺口／涵蓋率）。路線不顯示（地圖供應商未定）。
- **恢復**：Workouts 清單頂部 warning InlineState「Unfinished workout」＋ Save（secondary）／Discard（danger）。

### 23.3 記錄頁四格、軌跡預覽與 GPS 品質說明（2026-09-16，實機回饋）

- **記錄頁**：主數字（配速／速度；暫停中顯示 —、標籤改「已暫停」）之下改為 2×2 `elevated` 格：**運動時間**（不含暫停，暫停中停住；有暫停紀錄時下方 caption「已暫停 m:ss」，暫停中為 warning 色並加 warning 邊框）、**公里**、**平均配速／平均時速**（距離÷運動時間，< 50 m 或 < 10 s 顯示 —）、**最近一段**（最新完成的分段或圈）。其後：目標進度條（cyan，達標轉 mint）＋一行說明；「分段與圈」卡（標題列右側「模式 · hh:mm 開始」，最近 5 筆：名稱／距離／時間／配速，uncertain 以 warning 色），無資料時說明自動分段規則。總時間（含暫停）不再作為主時間；時間目標仍以含暫停的總時間判定。
- **摘要頁「軌跡」卡**（統計格之下、室內記錄不顯示）：標題＋「顯示軌跡」Switch（`workoutPrefs.showRoute`，預設開啟、記住選擇）；`RouteTrace`＝深色畫布上的 mint 折線（本機加密點解密後只在畫面投影；精度 > 20 m 的點不畫、> 5 s 缺口斷線）、mint 起點／magenta 終點、淡格線、左下角比例尺（10 m～5 km 擇一）；無可用點顯示說明文字。caption 固定註明「不會上傳、同步或放進分享內容」。**不含底圖**：地圖供應商未定（Google Maps 需金鑰與隱私評估），待決後再疊底圖。
- **「GPS 品質」tab**（原「品質」）：四個 Chip 之下加判定句（完整量測＝無缺口且涵蓋率 ≥ 90%，success 色；否則 warning 並說明不能刷新個人最佳）與四行 caption 定義（接受＝精度 ≤ 20 m 且速度合理；拒絕＝精度差／速度跳點／重複／亂序／暫停中，並列出各原因數量；缺口＝> 5 s 無可用定位、不補距離；涵蓋率＝運動時間中有可用定位的比例）。

### 23.4 三模式動作回饋動畫（2026-09-16）

`components/WorkoutActionMotion.tsx`：`WorkoutActionArt`（250dp 有限長度動畫、依模式主題色：走路＝擴散漣漪＋腳步、健走＝前進箭頭、跑步＝速度線；結束加放射火花；中央 150dp 圓章放圖示或內容）與 `WorkoutActionFeedback`（1.4 s 自動消失的 surface 卡片，`pointerEvents="none"`、標題走 `accessibilityLiveRegion`）。

- 觸發點：倒數每一格（圓章內放倒數數字，標題「輕鬆踏出第一步／跟上自己的節奏／準備起跑」）；記錄頁暫停→「停下腳步，慢慢呼吸」等、繼續→同開始文案（震動提示開啟時附一次輕震動）；摘要頁由結束進入時（`celebrate` 參數，只在 replace 進入時帶）→ 結束文案＋「運動紀錄已儲存在此裝置」。
- 規則：動畫只做裝飾，不擁有計時、持久化、導航或觸控；播一次即停，卸載即 stop；減少動態時直接顯示終態、不呼叫 Animated；穩定記錄中仍不做循環動畫（23 原則不變）。顏色與間距一律用 token。

### 23.1 運動紀錄清單（PG-R-01 實作，2026-09-14）

Home 「Workouts ›」進入 `WorkoutsScreen`：每筆一張 Surface — 標題「Run／Walk（· Indoor）」＋品質 Chip（Measured＝synced／Estimated、Partial＝neutral／Needs review＝devnet 警示色／Invalid＝offline），日期，四格指標（km、time、pace、kcal）以 `elevated` 底色成列；kcal 只有 Total 時顯示「350 kcal (total)」，缺值一律「—」。來源列「Source: Health Connect · <package>」＋步數；待審核原因與「可能重複」以 warning 文字列在指標下方，不合併、不相加。PB eligible 以 level Chip 標示（由後端判定，UI 不自行授予）。刪除為 caption danger 連結，需 Alert 確認並說明只移除 NeonShift 摘要。頂部「Import from Health Connect」secondary Button；原生模組未提供時以 info InlineState 說明，不假裝已匯入。

## 24. 三模式運動與探索冊體驗

依 [補充規格](./sport-experience-gameplay.md) 第 1～5 章。延續深色霓虹設計，三模式使用文字＋圖示，不只靠顏色；健走不呈現成跑步等級。運動中三項大數字、狀態與主要操作優先，慶祝與 NFT 預覽延至保存後。探索冊使用可逐格點亮的抽象城市章節，不展示真實位置；分列「探索進度」「鞋階維持」，不可合成同一進度條。大字、讀屏、減少動態設定須驗收。

### 24.1 實作（PG-U-01，2026-09-15）

- **Home**：固定「開始運動」卡（mint 邊框）＋ caption「最近：{模式} · 點此快速開始」→ WorkoutStart（預填最近模式與目標）。
- **開始頁**：第一段「模式」Segmented 走路／健走／跑步＋一行提示（健走＝使用者選擇的體驗模式，不依速度判定）；第二段「目標」自由／時間／距離，時間 10／20／30 分、距離 1／3／5 km 子 Segmented，非自由時 caption「達標會提醒一次，不會自動停止；未達標一樣會保存」。戶外／室內、自動圈、分段、跑道模式維持在後。
- **記錄頁**：主數字下方 caption「目標 {x}」；達標改 mint「目標已達成，做得好！可以繼續或暫停後結束」＋一次 success 震動；不自動停止、無慶祝彈窗。健走／走路主數字 km/h、跑步 min/km。
- **摘要頁**：標題行模式標籤（走路／健走／跑步；舊資料「走路（未指定模式）」）；統計下方一行「目標 {x} 已達成」（mint）或「目標 {x} 未達成，已保存實際完成內容」。

### 24.2 實作（PG-U-02，2026-09-15）

- **操作鎖**：狀態列右側「鎖定」按鈕（≥ 48dp）；鎖定後控制列只剩全寬「長按解鎖」（1.2 s），Lap／Pause／Finish 不可觸；鎖定時不攔截系統返回（記錄由前景服務持續，可自 Workouts 回來）。
- **讀屏**：狀態列合併朗讀「GPS · 良好, 記錄中」；主數字朗讀「配速 5:33 分每公里」／「速度 10.8 公里每小時」（無資料朗讀「尚無資料」）；時間／距離含單位；按鈕沿用 accessibilityLabel。主數字 `maxFontSizeMultiplier 1.6`，其餘跟隨系統字級。
- **定位失效**：GPS searching 時主數字改「—」並顯示 warning caption「定位中斷，這段距離不會計入；速度暫不顯示」。
- **語音／震動**：開始頁進階卡兩個 Switch（每公里語音／每公里震動，預設關閉）＋說明「通話或背景時不會播報，恢復後不補播」；分段或自訂圈完成時播一次（手動 Lap 不播）。

### 24.3 實作（PG-U-03，2026-09-15）

- **Workouts 清單**：PB 櫃下方 tab「全部／走路／健走／跑步」（走路與健走合看）；「週回顧」卡列最近 4 週「{週一} 起 · n 次 · d 天 · km · 時間」，caption 標本地時區並註明與鏈上 UTC 七日維持週期不同。
- **摘要頁**：目標列之後「和你自己的同類紀錄比」卡（同模式、環境、來源；最近 n 筆平均距離／配速；配速快／慢 x%——慢時文案「沒關係，紀錄已保存」）；不足 3 筆改 caption「同類紀錄不足 3 筆，暫不比較」。「分享預覽」卡：三個 Switch（包含模式＝預設開、配速、日期），預覽文字即時更新，永不含路線、精確開始時間與錢包；「分享」走系統分享面板。

### 24.4 實作（PG-U-04，2026-09-15）

- **Explore 探索冊**（Home「探索冊 ›」）：頂部說明與「探索進度與 XP、維持點、代幣各自計算；外觀不改倍率、不是 NFT」；「探索冊 · 第一章」2 格抽象章節（點亮＝mint 邊框＋名稱；未開啟＝灰階 0.7），不畫真實位置；「本週任務」卡：標題、狀態 Chip（進行中 neutral／可開啟 synced／已收藏 level／已撤銷 offline）、進度 x / y、截止與延遲同步日期、可開啟時「開啟這一格」；「選擇任務」卡（timed_goal 有 10／20／30 分 pill）＋「接受任務」；GPS 未開放時 caption 註記；規則 caption；「去運動」→ WorkoutStart。不在記錄中顯示任何任務彈窗。

### 24.6 三模式運動樣態（2026-09-16，專案負責人指示：三模式不能只差說明）

`app/src/domain/modes.ts` 是單一來源（`MODE_PROFILES`），三模式在下列面向都不同；健走仍是使用者選擇的模式，不依速度自動判定，建議區間只作即時回饋、不影響獎勵：

| | 走路 | 健走 | 跑步 |
|---|---|---|---|
| 主題色／圖示 | violet／sun | cyan／trending-up | mint／zap |
| 記錄頁主數字 | 運動時間（時速降為次要格） | km/h＋「健走區間」chip（5.5–7.5 km/h：低於／區間內／高於） | 配速＋「與平均比較」chip（快／慢 x%／一致） |
| 目標預設 | 15／30／45 分、1／2／3 km | 10／20／30 分、2／3／5 km | 10／20／30 分、1／3／5／10 km |
| 自動圈預設 | 關 | 1 km | 關 |
| 自由目標文案 | 想走就走 | 保持健走節奏 | 想跑就跑 |
| 開始頁背景路線 | 公園小圈 | 河濱來回 | 長距離折線 |

- **開始頁**：標題左側模式圖示圓框（主題色描邊）；tab 帶圖示、選中底線與 GPS chip 邊框用主題色；tab 下一行「主指標：… · 自動圈 … · 健走區間 …」（主指標用主題色）再一行模式說明；換模式時目標預設值對齊新模式最接近選項、自動圈改為該模式預設。
- **記錄頁**：主數字上方主題色「圖示＋模式名」；主數字依模式；健走顯示區間 chip、跑步顯示與平均比較 chip（區間內／較快時 chip 邊框與文字用主題色）；目標進度條用主題色；走路模式第一格改為時速（時間已是主數字）。

### 24.5 開始頁改版與 Home 入口（2026-09-15，專案負責人指示：運動樣式參考 Nike Run Club）

- **開始頁 `WorkoutStart`**（單屏不捲動，Style 深色霓虹配色不變，只借用 NRC 版面）：
  - 標題 displayM＝目前模式名稱；下方文字 tab「走路／健走／跑步」（選中 mint 底線，48dp），一行模式提示。
  - 中央 hero：抽象街區格線＋一條 mint 路線的 SVG 背景（不畫真實地圖），88px 斜體大數字＝目標（距離 `3.00`＋「公里」、時間 `20:00`＋「分鐘」、自由＝「自由」＋「沒有目標，想跑就跑。點一下設定目標。」），白色底線；整塊可點開目標面板。
  - 兩顆 84dp 圓形 chip：跑鞋（ShoeHero 縮圖，點入 Gear）與 GPS（戶外＝mint 邊框＋「GPS 開啟」；點一下切室內＝灰階「室內」，同時停用 START 並顯示匯入 InlineState）。
  - 控制列：左 64dp 齒輪（運動設定面板）；中央 168dp mint 圓形 **開始／START**（hero glow；停用時 elevated 底＋描邊＋灰字，下方 caption 顯示原因）；右 64dp 語音提示開關（volume 圖示，`switch` 讀屏角色）。
  - 目標種類 pill（距離／時間／自由＋向上箭頭）→ **目標面板**：列「距離 ✓／時間／自由」，選中列下方展開 1／3／5 km 或 10／20／30 分 Segmented；caption 達標說明；「清除」（回自由）＋「完成」。
  - **運動設定面板**：地點、自動圈、分段、每公里震動 Switch＋說明、跑道模式（含自訂輸入與「我已核對圈長」）；「完成」。面板為底部 Sheet（scrim 點擊／返回鍵關閉、可捲動、最高 88%）。
  - **3–2–1 倒數**（2026-09-16）：按 START 先確認定位權限，再以全螢幕 canvas 顯示 200px 斜體 mint 數字 3→2→1（每秒一格；縮放進場，減少動態時不縮放）；每格依偏好震動（Medium impact）與語音報數；點一下任何地方立即開始；返回鍵取消回開始頁、不會開始記錄。倒數結束才呼叫 recorder.start。
  - 開始行為、目標快照、跑道模式門檻、權限引導與室內規則與 23.2／24.1 相同。
- **Home 入口區**：原「今日」列的四個文字連結（會截斷）改為 (1) 全寬 mint 主按鈕「開始運動」（play 圖示、副標「最近：{模式}」、右側箭頭、medium glow）＋ (2) 四格等寬快捷（圖示＋文字，64dp，surface 底描邊）：運動紀錄／探索冊／藝廊／活動；「今日」標題移到步數／睡眠卡之上。

## 25. 新手指南與成就儀式（2026-09-16）

### 25.1 新手指南（PG-UX-01）

Landing 主 CTA「開始冒險」進 GameGuide。跑鞋主視覺＋日常活動／驗證打卡／裝備成長三步摘要，接四張卡：每日任務、裝備進化與維持、成就 NFT、競技場。末段為錢包／健康權限／初始鞋／首次打卡四步。上方「直接開始」可略過，底部進 WalletConnect；Profile 的「遊戲說明」入口重看後返回原頁。內容不申請權限、不發送交易；支援繁中／英文、垂直捲動與安全區。初始鞋不是 NFT，tSKR 無金錢價值。

### 25.2 三種揭曉（PG-A-17；取代原單一 800ms 進化描述）

- NFT：2.8 秒一次性卡背翻轉、金色環與放射粒子、卡面掃光、名稱和「收下榮耀」。有鞋階時展示對應 ShoeHero，其他收藏使用徽章圖示；不是遠端 NFT 作品圖片預览。
- 升等：2.8 秒能量擴散、裝備放大與向上進場，顯示舊→新等級及成功震動。
- 降等：1.8 秒冷色光環收縮、粒子下沉與警示震動，文案鼓勵回歸，不暗示 NFT／XP 被沒收。
- Reduce Motion：靜態最終卡面與光環；無翻轉、粒子或掃光。動畫不循環；可按確認或系統返回關閉。
- 僅新 NFT 領取成功排隊；重複已領不播。等級動畫 pending 時 NFT 等待，避免同時彈出。首次觀察等級只記錄，後續啟用等級不同才揭曉。

以上已實作並完成相關自動測試；低階裝置幀率、讀屏、字體放大、視覺節奏仍待實機驗收。
