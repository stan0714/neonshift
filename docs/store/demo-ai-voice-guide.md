# NeonShift 國際參賽影片：AI 英文配音製作指南

更新：2026-09-18。配合 [Demo v3 六段腳本](demo-video.md)，成片目標 2:50、上限 3:00。本次提供建議與可用文字，尚未購買服務、生成語音或試聽；以下音質選擇為製作判斷，不是本案盲測結果。

## 1. 先選清楚可信的產品敘事聲線

**建議：單一成年英文聲線、偏中性美式口音、溫暖清晰、適度有活力。** 男聲或女聲都適合，優先判斷輔音清楚、專有名詞發音、長句自然度與段落一致性。不要只因音色低沉就選用；過重氣音、預告片腔、誇張興奮會搶走 App 本身的重點。

節奏安排：

| 章節 | 情緒／重音 | 操作重點 |
|---|---|---|
| 01 產品開場 | 帶一點好奇；重讀 movement、progress | 問句後短停，不用廣告式長懸念 |
| 02 日常成長 | 明亮、自然；重讀 free、journey | 讓玩家理解免費起步與累積 |
| 03 鏈上證據 | 稍微收斂、清楚說明 | wallet、devnet、no monetary value 不能含糊帶過 |
| 04 荒野守護 | 有溫度與欣賞感 | 說到動物與 habitat 時留呼吸，不用悲情音樂 |
| 05 社群活動 | 友善、具體 | prototype、next step 保持可辨識 |
| 06 共同方向 | 堅定而不喊口號 | 口號中間短停；結尾自然收束 |

建議先試聽兩個候選聲線的同一段 15–20 秒文字，再選一位做全片。預覽文字可用：

> NeonShift turns everyday movement into visible progress. Here is a real clock-in on Solana devnet. Discover Wild Guardians, with shoes inspired by the Asian elephant and the hawksbill turtle.

這是**內部聲線測試文案**，不作為操作已驗收或正式影片證據。

## 2. 工具建議與選擇理由

| 選項 | 本案用途與推薦順序 | 官方資料支持範圍 |
|---|---|---|
| **ElevenLabs Multilingual v2（首選）** | 六段產品旁白的第一輪試作；優先聲線連貫與容易修正 | 官方將其列為穩定長篇合成與專業內容選项。[V1] |
| ElevenLabs Eleven v3 | 若 v2 試聽偏平，可用相同聲線比較開頭與保育段；最後全片統一模型 | 官方強調表現力與語氣標籤；不能把 v2 設定直接當成 v3 通用參數。[V1][V2] |
| Azure AI Speech | 已使用 Azure、或需要以 SSML 明確控制停頓、速率與讀法時 | 官方 SSML 支援結構與發音／語音調整，實際元素能力依聲線而異。[V3–V5] |

不需要為三分鐘單人旁白建立聲音複製或多角色對話。這份建議不指定可能改名／下架的 Voice Library 人名；選好後記錄 voice ID、模型與設定，後續補錄才能一致。僅使用平台可授權使用的聲線；不需要模仿名人或賽事評審。

方案價格與可用聲線未逐一核價；先用短句預覽確認品質，再依帳號當下顯示的公開使用權與方案決定，不能假設免費預覽音檔一定適用正式發布。比賽對 AI 使用的完整條款仍列於 RULE-03 待核對。

## 3. ElevenLabs v2 的實用起點

選 `eleven_multilingual_v2`，先以 Speed **1.0**、Stability **50**、Similarity **75**、Style **0** 預覽；滑桿若以 0–1 顯示，對應為 0.50／0.75／0。這與官方常見起始設定一致，不能保證相同輸出。[V2]

再依實際音檔調整：

- 自然朗讀以 **125–135 wpm** 為製作目標；這是本案節奏建議，Speed 1.0 不等於固定 wpm。
- 字句不清先换聲線或修正發音；不要只靠降速拖長。
- 段落太平可小幅降低穩定度後試聽；不要同時改所有參數。
- 語速超出段落預算時，先重配或縮句；只有少量差距才考慮小幅速度調整。
- 使用句點、逗號與空行控制基本節奏；此份純稿不含引擎特定標籤。v3 的情緒 tags 不要直接貼給 v2，完整 SSML 也不能假設各引擎通用。

官方配音指南的不同段落對 v3 速度支援描述有差異，本案不依賴 v3 的 speed／similarity 控制；以實際介面及選定模型支援為準。[V2]

### 聲音 brief（供選音／支援指令的介面使用）

```text
English product-demo narration for an international hackathon audience.
Use a clear, warm adult voice with a neutral American accent.
Sound like a thoughtful product maker explaining an app to a first-time user.
Keep the delivery conversational, confident, and lightly energetic.
Use short pauses between ideas and clear pronunciation of product names.
Avoid a trailer voice, exaggerated excitement, whispering, and sales pressure.
Make the conservation section warm and the transaction section precise.
Preserve the distinction between the working demo and planned partnerships.
```

此 brief 是製作指示。只有介面提供獨立 voice description／instruction 欄位時才貼入；一般 Text to Speech 文字欄僅貼 [英文稿](demo-voiceover-en.txt)，否則引擎可能把指示也念出來。

## 4. 發音與字幕寫法

以下為本案建議讀法，不宣稱商標所有者指定的唯一標準。先在候選聲線試聽；需要時改合成輸入或使用引擎支援的字典，字幕保留正式拼法。

| 字詞 | 建議讀法／處理 | 字幕與畫面 |
|---|---|---|
| NeonShift | `NEE-on shift`，Neon 與 Shift 清楚銜接 | NeonShift |
| Solana | `suh-LAH-nuh`，避免念成 Soluna | Solana |
| devnet | `dev net`，兩部分辨識清楚 | devnet |
| Health Connect | 分成兩個清楚的字 | Health Connect |
| Wild Guardians | 重音落在 Wild 與 Guardians 首音節 | Wild Guardians |
| hawksbill turtle | `HAWKS-bill TUR-tul`；不要把 hawksbill 拆成陌生縮寫 | hawksbill turtle |
| onchain | 可在合成輸入寫 `on chain` | onchain |
| tSKR | 正式旁白用 test tokens 避免冗長縮寫 | 畫面標 tSKR，並說明無金錢價值、非官方 SKR |

不要把 `SOL`、`MWA`、`NFT`、`attestation` 全塞進旁白；本片以 Solana、wallet、claim、shoe finishes 說明可見體驗。這是面向評審的語言選擇，不代表技術名詞錯誤。

若採 Azure，`break`、`prosody`、`sub` 等應依所選聲線的支援表使用；先用短句驗證。官方提供 SSML 文件結構與發音控制說明。[V3–V5] 不需要為了停頓把所有旁白改成大量標籤。

## 5. 六段音檔與交付順序

1. 從純英文稿依空行拆成六段，沿用同一 voice ID、模型與設定；依序輸出 `01-purpose`、`02-progress`、`03-claim`、`04-wild-guardians`、`05-community`、`06-next`。
2. 每段試作兩次，選最自然的一次；不用拼接同一個字的音節，以免聲音跳變。
3. 量測音檔含停頓的總長，分別不超過 **17／22／38／29／23／19 秒**。上限共 148 秒，整片 170 秒內還有至少 22 秒操作空間。這些是製作限制，不是已量測結果。
4. 第 03 段配合實際交易錄影校正；必要時以句子為單位分段，插入操作停頓。不可讓旁白先說成功、畫面卻還沒確認。
5. 先鎖定旁白，再對齊英文字幕、鏡頭及音樂。之後若改句子，同步更新純稿與腳本，重算字數及音檔長度。
6. 匯出最終影片，再實測 ≤180 秒；聽完整片確認無漏字、重複音節、錯誤讀法、爆音或過長尾音。

若支援無損輸出，保留原始 WAV 作剪輯母檔；在剪輯工程中統一取樣率，48 kHz 可作本案影片工程設定，但不要將重新取樣當成增加原始品質。音樂選無人聲、節奏輕的電子／環境配樂；旁白出現時自動或手動降低音樂，重點是手機外放也聽得清楚。保育段保留同一音樂語彙，避免忽然變成另一支公益廣告。

最後請未參與開發者只聽一次，回答：「它是什麼 App？Solana 做什麼？保育合作現在有沒有發生？」三題若答不清，先改敘事，再修音色。

## 6. 本次查閱的第一手來源

查阅日期：2026-09-18。模型和介面會變動；數值設定僅作試聽起點。旁白、時間配置、聲線風格與混音建議均為本案製作判斷。

- V1：[ElevenLabs — Models](https://elevenlabs.io/docs/overview/models)
- V2：[ElevenLabs — Text to Speech product guide](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech)
- V3：[Microsoft — SSML document structure](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-structure)
- V4：[Microsoft — SSML pronunciation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-pronunciation)
- V5：[Microsoft — SSML voice and sound](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice)
