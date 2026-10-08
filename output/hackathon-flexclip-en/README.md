# NeonShift｜英文黑客松影片投影片包

**FlexClip 最新可上傳版本：** [flexclip-v4/NeonShift_FlexClip_v4.pptx](flexclip-v4/NeonShift_FlexClip_v4.pptx)，十頁對應五章、目標 2:50。請先看[操作指南](flexclip-v4/README.md)與[逐頁講稿](flexclip-v4/scene-guide.md)。下方舊六頁產物保留歷史用途。

**2026-10-02 現行入口：** [交付／待拍盤點](../../docs/store/submission-materials-audit-2026-10-02.md)與[v4 五段稿](../../docs/store/demo-video.md)。`voiceover-en.txt` 已同步五段新版；既有 PPTX／PDF／PNG、storyboard.md、slide-content.json 仍是 v3 六段視覺參考，尚未重建。生成器改讀 `voiceover-v3-archive.txt`，只重建歷史六頁，不覆寫新版配音。下文六段組裝流程屬歷史說明。

建立日期：2026-09-18；更新：2026-09-22。第 2、4 頁為示意素材；相關 App 功能已有程式，提交版實機驗收待完成；中文募資稿同步另存 v4。

## 交付內容

| 檔案 | 用途 |
|---|---|
| [NeonShift_Hackathon_EN.pptx](NeonShift_Hackathon_EN.pptx) | 6 頁英文簡報，16:9；文字、流程框與图片可編輯；備忘稿含英文旁白與中文製作說明 |
| [NeonShift_Hackathon_EN.pdf](NeonShift_Hackathon_EN.pdf) | 六頁靜態閱讀版；圖片式 PDF |
| [slides/](slides/) | 01–06.png，1920×1080，可作 FlexClip 場景底圖 |
| [overview.jpg](overview.jpg) | 六頁總覽 |
| [preview.html](preview.html) | 離線預覽；需保留 slides 子資料夾 |
| [production-plan.md](production-plan.md) | 時間軸、FlexClip 組裝方式、素材與補錄清單 |
| [storyboard.md](storyboard.md) | 逐頁英文文案、完整旁白、中文分鏡與狀態 |
| [voiceover-en.txt](voiceover-en.txt) | 僅含英文旁白；六段對應六頁，可逐段貼入配音工具 |
| [assets/](assets/) | 本包使用的原始專案素材副本 |
| [slide-content.json](slide-content.json) | 結構化旁白、時間與製作註記 |
| [build_deck.py](build_deck.py) | 重建腳本，需 python-pptx、Pillow 與 Arial 或 DejaVu Sans |

## 建議從這裡開始

1. 開啟 PPTX 或 PDF 審稿；查看 overview.jpg 快速掌握六頁。
2. 把 slides/01.png 到 06.png 依序匯入影片專案；以 production-plan.md 分配時間。
3. 依 voiceover-en.txt 分六段製作旁白，加入英文字幕。
4. 補入提交 APK 的真實操作錄影、實際交易與發布連結，最後量測影片時長。

投影片與 PNG 共用相同版面座標。PNG/PDF 是腳本直接繪製的配套輸出，並非 PowerPoint 的匯出截圖；不同簡報軟體的字型排版可能略有差異。用 PNG 剪片可固定外觀。

## 完成範圍

已產出投影片、PDF、1080p 圖片、旁白文字與規劃文件。未生成語音、錄製 App、製作最終影片或完成提交 APK 驗收。時間表是剪輯目標，非實測片長；網站 Brief 已於 2026-09-21 查核要求三分鐘 Demo；本片目標 2:50，仍需量測成片。

第 1 頁早期實機圖標 EARLY BUILD；第 2 頁為 Activity／有序同步設計預覽，第 4 頁為多鞋切換與可關閉背景設計；第 3、5 頁為流程示意。所有計畫中的試辦與合作均使用 planned／next，不暗示已營運。

## 重建

```sh
python3 -m venv /tmp/neonshift-deck-venv
/tmp/neonshift-deck-venv/bin/pip install -r requirements.txt
/tmp/neonshift-deck-venv/bin/python build_deck.py
```

以上在本資料夾執行。重建會覆寫簡報、配套視覺、JSON 與純英文旁白；如手改 PPTX，請另存新檔。storyboard.md 由生成器同步；production-plan.md 為製作文件，改稿後需同步檢查。

## 2026-09-19 文件 Review

配音唯一來源為 [正式英文稿](../../docs/store/demo-voiceover-en.txt)，本包純稿及 PPTX 備忘稿均已核對一致（280 字；09-19 新需求修訂）。最新開發對應的拍攝調整見 [production-plan.md](production-plan.md#2026-09-19-review-決策)。簡報中的早期圖與流程圖仍待實機替換，本次僅更新文件與交付登錄，不假裝已拍攝。


新增需求：[跑鞋／同步／Activity 設計](../../docs/shoe-sync-activity.md)。第 2 頁示例三筆紀錄為測試文案，不是真實運動資料；預設自動同步關閉，開啟後依運動時間由舊到新。第 4 頁選擇已取得鞋款，背景可關閉且不改有效等級。


## 2026-09-20 Activity 與睡眠清理

第 1 頁 EARLY BUILD 截圖仍含舊睡眠卡；現行 App 已停用睡眠讀取與入口，正式影片須替換新 APK 實錄。本次不將歷史截圖修飾成新實機證據。


## 2026-09-20 實機截圖（USB）

[captures/2026-09-20/](captures/2026-09-20/README.md)：APK `373a180` 的 Home（含新「Workout mission」）、Activity 儀表板／月曆／卡片、Workouts、Gear（Origin 詳情、系列一覽、維持期）、Profile 共 20 張，可直接替換第 1 頁 EARLY BUILD 與第 2 頁靜態預覽；第 3（完整打卡）、4（Lv.2+ 切鞋與棲地背景）、5（活動雙角色）仍待實機錄影。擷取工具 `scripts/demo/capture.sh`；錢包授權視窗為 secure surface，需相機側拍。

第 4 頁的 Lv.2+ 畫面另以**展示版覆寫**（`EXPO_PUBLIC_DEMO_LEVEL=3`，畫面帶 DEMO DATA 標籤）擷取了揭曉儀式、切鞋、森林／海洋背景、關背景與路線底圖選擇（`captures/2026-09-20/*-demo*.png`）；影片中須標 DESIGN PREVIEW／DEMO DATA。

## 2026-09-21 個人成就 NFT 評審展示

新增 [九頁評審版 PPTX](NeonShift_Hackathon_EN_Judges.pptx)：原六頁＋三頁 NFT 樣式／鑄造領取／收藏查證附錄。原六頁影片版與六段旁白不變，附錄不計入原影片時長。完整 [展示包、中文講稿與樣式預覽](../achievement-nft/README.md)。附錄是設計與流程示意，真實交易實錄待補。重建主簡報後，需再執行附錄生成器。

## 參賽開發與素材凍結

以 [2026-09-21 開發計畫](../../docs/store/competition-development-plan.md) 追蹤功能與規則。SKR 完成前保留規劃標示；10/1 決定是否納入，影片實機與 APK 同版後才更新完成宣稱。簡報附錄不視為實際鑄造／付款證據。

## 2026-09-22 功能與素材同步

正式旁白第 2、4 段改為現行功能描述，生成器、PPTX／PDF／PNG、JSON、分鏡與九頁評審版同步重建。畫面仍為 DESIGN PREVIEW，未新增實機錄影。拍攝需使用新版 Workouts 四欄統計與 PB 說明，補任務進度、手動鞋款預覽、錢包階段提示；詳見 [評審指南](../../docs/store/judges-guide.md)。SKR 仍為提案，不新增完成宣稱。
