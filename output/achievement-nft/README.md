# 個人成就 NFT｜評審展示包

2026-09-21。三頁英文投影片＋中文講稿，供參賽簡報與評審問答使用。

- [九頁參賽評審版 PPTX](../hackathon-flexclip-en/NeonShift_Hackathon_EN_Judges.pptx)：原六頁＋本次三頁附錄。
- [三頁 NFT 專題 PPTX](NeonShift_Achievement_NFT_Judges_EN.pptx)／[PDF](NeonShift_Achievement_NFT_Judges_EN.pdf)。
- [離線預覽與既有 NFT 圖樣](preview.html)／[總覽](overview.jpg)／[中文講稿](講稿.md)。

## 設計

首次 5 km、10 km、半馬、全馬共用卡片結構：系列 → 距離 → 成就名稱 → 驗證來源 → 個人資訊區。色彩依序為薄荷、青、紫、金；半馬 21.0975 km、全馬 42.195 km。DEVICE 與 ORGANIZER 必須清楚標示，不能把裝置紀錄包裝成官方認證。

第一頁為新資訊版式提案；HTML 另展示既有 SVG，包含 First Finish 與主辦方來源。本次不覆寫已發行 NFT metadata，也未部署新鑄造資產。PB 與活動款式維持原規則；不保證所有來源類型均已開放鑄造。

## 評審示範順序

1. Workouts 查看成就資格：區分未達標、待審、等待核准、可領取、已領取。
2. 選擇可領取成就，展示公開內容選擇；可選資料不公開不等於鏈上擁有者匿名。
3. 展示實際 metadata 預覽與當次 SOL 費用；不花 tSKR 不代表完全無費用。
4. 使用者在錢包核准，等待鏈上確認；取消不顯示領取成功。
5. 展示揭曉與個人收藏，核對真實 asset／交易與網路。
6. 再次查看已領取狀態，說明 receipt 防重複；不為示範重複送交易。

首次距離的「領取」是使用者發起鑄造，達標不自動鑄造。流程依據 Milestones.tsx、AchievementService.ts 與 docs/commemorative-nfts.md。

本包沒有執行鑄造、假造 asset ID 或冒充實機畫面。九頁版原六頁的素材狀態沿用原 README；原六段影片旁白與時間不變，附錄供問答使用。

## 重建與驗證

先重建原六頁簡報，再以含 python-pptx、Pillow 的 Python 執行本目錄 build_deck.py。目前使用 /tmp/neonshift-slides-313/bin/python，字型為 macOS Arial。HTML 需保留 slides 與專案 web/nft 相對位置。

已檢查輸出圖片、文字邊界與 PPTX 頁數；PowerPoint／Keynote 及真機實錄仍待驗收。
