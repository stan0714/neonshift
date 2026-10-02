# FlexClip 專用投影片包 v4

## 中英兩版（10/2 對稿修訂）

| 用途 | 投影片 | 固定版面 PDF | 快速總覽 |
|---|---|---|---|
| 英文製片 | [EN PPTX](NeonShift_FlexClip_v4_EN.pptx) | [EN PDF](NeonShift_FlexClip_v4_EN.pdf) | [英文總覽](overview.jpg) |
| 繁體中文對稿 | [中文 PPTX](NeonShift_FlexClip_v4_ZH-TW_Review.pptx) | [中文 PDF](NeonShift_FlexClip_v4_ZH-TW_Review.pdf) | [中文總覽](zh-TW/overview.jpg) |

[中英逐頁旁白對照](bilingual-review.md)。兩版均十頁、同頁碼／同圖片／同英文時間軸；中文版翻譯標題、說明、標籤與備忘稿，App 原始截圖不翻修。中文用於確認意思，不取代英文 FlexClip 稿，亦不保證中文配音是 170 秒。

本次調整：第 2 頁具體呈現手機運動／健康摘要／錢包；第 3–4 頁旁白依運動與同步重新分段；第 4／5／7 頁加入流程圖解；第 6 頁加入 9/23 Passport 歷史截圖；第 7 頁標題縮短。仍保留歷史版本、Devnet、規劃中項目的界線，不補造成功畫面。原無語言後綴 PPTX／PDF 同步為英文相容副本。

重建英文後再執行同一腳本加 `--lang zh-TW`，會生成中文版與中英對照文件。中文圖片採系統黑體；在沒有該字型的電腦請優先用 PDF 對稿。

更新：2026-10-02。用途是**上傳投影片，讓 FlexClip 生成英文 App 介紹片**。五個章節拆為十個短場景，目標 170 秒；實際時長依配音與匯出調整。素材為產品介紹、歷史截圖與流程圖；本包本身不是完整實機 Demo。

## 上傳哪個檔案

- **首選：[NeonShift_FlexClip_v4.pptx](NeonShift_FlexClip_v4.pptx)**：十頁、可編輯文字，每頁備忘稿只有英文旁白。
- [PDF](NeonShift_FlexClip_v4.pdf)：外觀固定的備用輸入，圖片式 PDF 不保證 AI 能完整辨識文字，需貼逐頁旁白。
- [總覽](overview.jpg)／[離線逐頁預覽](preview.html)：上傳前確認內容。
- [逐頁講稿](scene-guide.md)：生成講稿時逐頁比對；`narration/01.txt`–`10.txt` 可直接複製，只有英文。
- [PNG](slides/)：PPTX 匯入排版不符預期時，用圖片場景手動組裝。
- [時間表](timeline.csv)／[結構化場景資料](scene-manifest.json)：人工剪輯參照；**不宣稱 FlexClip 支援匯入這兩種格式**。

## FlexClip 操作順序

1. 進入 **AI PPT/PDF to Video**，上傳本包 PPTX。不要選會以圖庫／AI 畫面重建產品的 Text to Full Video 當主要流程。
2. Text Settings 選 English、簡短介紹、清楚自然的產品說明語氣；若有片長選項，選接近 3 分鐘，再於編輯器調成 2:50。選項名稱與可用值依帳號介面為準。
3. 到 **Text Generation**，按 `scene-guide.md` 修改生成文字。AI 可能自行加內容，務必保留 test token／Devnet／planned；不能加「官方 SKR 已上線」「已合作捐款」等敘述。不要把中文備註、時間碼、DEVICE CAPTURE／REAL DATA 等標籤念出來。
4. 到 **Avatar & Voice**，全片同一英文聲線，先試聽第 7、8 頁的 Devnet 與 SKR。若介面可停用 avatar，採純投影片＋旁白；若必須選 avatar，選不遮住投影片的布局並預覽，再於編輯器調整可用元素。不要預設一定有無 avatar 選項。
5. 字幕選英文、清楚對比，最多兩行。投影片下方 150 px 留空供字幕；標籤在其上方，不能被字幕蓋掉。若 avatar 並排令投影片太小，改回以投影片為主的布局。
6. 先確認顯示的 credits，再自行 Generate。工具自動產生並匯出時，可用 **Cancel Export / Back to Edit** 返回編輯器，檢查字幕、各頁時長及內容。備忘稿不保證自動成為正式旁白，要在生成前後核對。
7. 編輯器內按時間表分配十頁。音訊過長先縮句／重配，再調整停頓，勿硬截語尾；音訊過短可短暫停留或微幅推近圖片，不要把 170 秒當成必須湊滿的長度。片尾至少 2 秒。
8. 輸出 16:9、1920×1080（依方案可用設定）。完整播放、量測 ≤180 秒；查看有無方案浮水印、字幕截斷及付款標籤被遮。未實際操作你的帳號，不能保證帳號方案或匯入結果。

以上 UI 流程核對 [FlexClip 官方教學](https://help.flexclip.com/en/articles/11374566-ai-ppt-pdf-to-video)（2026-10-02）；十頁配置、字幕區與節奏是本案製作建議。

## 十頁節奏

| 頁 | 區間 | 用途 |
|---|---|---|
| 01–02 | 0:00–0:25 | 問題／產品定位 |
| 03–04 | 0:25–1:00 | 運動紀錄／自主同步 |
| 05–06 | 1:00–1:35 | 核准／鏈上申領／收藏界線 |
| 07–08 | 1:35–2:20 | SKR 外觀用途／付款證據 |
| 09–10 | 2:20–2:50 | 保育學習／下一步／片尾 |

「五章」不等於「五張投影片」；每頁只講一件事。十页旁白串回後與 `docs/store/demo-voiceover-en.txt` 完全相同，沒有另寫一套會漂移的口徑。

## 介紹片如何轉成黑客松 Demo

投影片可以直接生成介紹片。正式黑客松版在 **05–06、07–08** 場景嵌入同提交 APK 的真實申領、錢包簽署、確認與 Explorer 操作，保留旁白與總時間預算；03–04 可補運動操作，01 可換最新首頁。第 8 頁已有 10/1 付款成功截圖，標 code 11，不能視為全流程影片。不要讓 AI 生成錢包畫面或成功交易。

**10/2 換圖：** 第 1、3、4、6、9 頁改用 [10/2 v14 實機截圖](../captures/2026-10-02/README.md)（真實資料、無展示覆寫）；第 7、8 頁用 10/1 v11 真實付款的付款前與付款後兩張（[證據](../../../docs/evidence/2026-10-01-skr-devnet-payment.md)），依 10/2 決定不另錄付款影片。每張實機圖都標出拍攝日與 APK 版本代碼。第 2、5 頁仍是流程圖：第 5 頁（鏈上申領）尚無真實申領畫面，不以登入畫面代替。片尾公開連結放影片說明欄；未發布前不放假網址或 QR。

TTS／配樂改用 FlexClip 實際選定項目登錄 [素材表](../../../docs/legal/asset-sources.md)。先做無配樂版即可；想加音樂再選授權允許的曲目，降低音量，確保手機外放可聽清旁白。

## 重建

使用 Python 3.10+，在 repo 根目錄（若 `python3 --version` 為舊版，改用新版 Python 完整路徑）：

```sh
python3 -m venv /tmp/neonshift-flexclip-venv
/tmp/neonshift-flexclip-venv/bin/pip install -r output/hackathon-flexclip-en/requirements.txt
/tmp/neonshift-flexclip-venv/bin/python output/hackathon-flexclip-en/flexclip-v4/build_deck.py
```

重建只覆寫本包輸出，讀取正式五段旁白與 repo 既有素材；手工修改 PPTX 請另存。修改旁白後須重新檢查切句與時長；下方生成文字不應任由 AI 改變產品事實。
