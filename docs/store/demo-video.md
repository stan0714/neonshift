# CLOCK IN 影片製作稿 v4：五段、Devnet SKR

**FlexClip 製作方式（10/2）：** 使用[十一頁專用投影片包](../../output/hackathon-flexclip-en/flexclip-v4/README.md)上傳 AI PPT/PDF to Video。以下五章各拆兩頁，旁白內容不變；先生成介紹片，再於 C／D 場景補操作實錄。無須先用外部 TTS。

更新：2026-10-02。**現行時間軸與拍攝入口**；取代舊六段與舊 D 段主網文案。[英文純稿](demo-voiceover-en.txt)為配音唯一來源，五段 A–E；[盤點與待拍清單](submission-materials-audit-2026-10-02.md)記錄交付缺口。歷史稿保留在 `demo-video-v3-archive.md`，不得用來配音。

## 時間與旁白

目標 177 秒、上限 180 秒，含轉場與片尾。五段共 **283 字**（空白分詞），125–135 wpm 約 126–136 秒純朗讀；其餘供操作與停頓，非音訊實測。舊稿「265 字需 2:35–2:45，另留 25–35 秒」的估算不成立，已移除。

| 段落 | 時間 | 字數 | 音檔預算上限 | 必拍鏡頭／文字 |
|---|---|---:|---:|---|
| A · MOVE WITH PURPOSE | 0:00–0:25 | 38 | 20 秒 | 同提交 APK 首頁任務卡；品牌最多 2 秒；Daily movement. Visible progress. |
| B · RECORD & SEE PROGRESS | 0:25–1:00 | 52 | 27 秒 | GPS 就緒→開始→保存→Activity 詳情；連網同步。長運動用預錄並標時間省略；不得把保存等同取得資格 |
| C · VERIFY & COLLECT | 1:00–1:35 | 53 | 28 秒 | 合格摘要→核准→錢包→confirmed→同筆 Devnet Explorer；首次 5K 收藏僅於另有真實資格與 Mint 證據時加入 |
| D · SKR IN USE | 1:35–2:20 | 69 | 36 秒 | 資格→訂單／2.5 TEST SKR／Devnet／收款人→錢包→確認→OWNED／邊框；全段 TEST SKR · devnet · not official SKR |
| E · EVIDENCE & WHAT'S NEXT | 2:20–2:57 | 71 | 34 秒 | 野生動物鞋／故事；NEXT: LOCAL PILOTS；規劃頁：SKR 質押依等級加成＋保育提撥（ROADMAP · NOT LIVE · RATES NOT FINAL）；版本與交易入口簡短呈現；片尾至少靜止 2 秒 |

英文逐字內容直接取純稿，不再在多份文件各自維護。活動雙角色不占主片必要鏡頭，詳解放 [活動手冊](event-demo-playbook.md)。若 C 段未取得成功錄影，仍是交付缺口，不能以流程示意宣稱完成實機 Demo。

## SKR 可說與不可說

[10/1 證據](../evidence/2026-10-01-skr-devnet-payment.md)記錄 versionCode 11、commit `c477b8e` 的真實 Devnet 付款、伺服器驗證、OWNED 截圖；可作歷史成功證據。尚不等於最終提交 APK 完整錄影、重裝／登出恢復與全部失敗情境通過。新版旁白因此不承諾「重裝、登出都已驗證」。

主辦回覆接受 Devnet／tSKR 是參賽環境許可，不是技術驗收通過，也不是保證得獎。SKR 為選配獎項；最終版仍須通過付款正確性及恢復 gate。若不通過，修正或停用相關入口，改稿並重配 D 段；不得僅憑主辦允許就判定 Go。

D 段採實際 Devnet 文案，不顯示 `Solana mainnet`／`official SKR`。確認金額以錄製時訂單為準；2.5 為 10/1 歷史值。資格需真實活動與核准，不能以 DEMO_LEVEL 覆寫取得。付款已 OWNED 的帳號不能假拍首次購買；新付款須由本人操作並保留真實交易證據。

## 拍攝與剪輯

1. 固定 APK／commit／SHA、API／網路、裝置與錢包版本；新 APK 不沿用舊版 PASS。完整版本填 [提交登錄 §9](clock-in-submission.md#9-最終交付登錄)。
2. 先錄 B／C／D 全流程，保留原始檔。錢包 secure surface 若錄黑屏，使用外部相機拍攝，避免露出解鎖資訊。等待可縮短，標 `Wait time shortened`，保留授權與成功因果。
3. 早期截圖只標 EARLY BUILD；展示覆寫標 DEMO DATA／DESIGN PREVIEW；活動原型標 WORKFLOW PREVIEW；未來合作標 PLANNED。不以覆蓋文字偽造新版 UI。
4. 依 A–E 各自產生音訊，再做英文字幕。最多兩行，避開按鈕、網路標籤與交易結果。五段音檔建議命名 `A-purpose.wav` 至 `E-next.wav`，不要沿用六段配音編號。
5. 建議 1920×1080、30 fps、H.264＋AAC；直式手機保持比例。旁白和音樂授權登錄 [素材表](../legal/asset-sources.md)；音樂可省略。
6. 成片完整播放並量測 ≤180 秒，實際片長／URL／配音設定登錄提交文件。沒有最終音訊前不產生假精準 SRT。

```sh
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 NeonShift_CLOCKIN_EN.mp4
```

## 成片說明欄草稿

以下僅在影片確實包含相應實錄後使用，補真實公開連結；採 AI 配音才保留 AI narration 字句。

> NeonShift connects daily movement, collectible achievements, and wildlife-inspired progression on Solana Mobile. This demo shows wallet-approved claims and a cosmetic payment on Solana devnet. TEST SKR has no monetary value and is not official SKR. Local pilots and conservation partnerships are planned. AI-generated narration. APK, source, pitch, and reviewer guide: links provided with this submission.

本次已備妥十一頁 FlexClip v4 投影片與逐頁旁白，不代表音訊、字幕、影片或最終 RC 驗收完成。六頁／九頁既有簡報仍保留為 v3 歷史參考。
