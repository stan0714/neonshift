# NeonShift 募資討論稿

目前版本：[中文 PowerPoint v4](NeonShift_募資簡報_中文草稿_v4.pptx)，2026-09-19，35 頁（31 頁主文＋4 頁附錄）。

- [網頁預覽](preview.html)：與簡報由同一份生成器產生，可列印。
- [逐頁講稿與資料來源](講稿與資料來源.md)。
- [永續研究與共同方向](../../docs/sustainability-direction.md)：完整建議、證據邊界、單案算術與 90 天路線。

v4 第 16 頁新增跑鞋／背景連動、可選連網同步與 Activity 個人運動日誌（待實作）；後續頁碼順延一頁。

v3 更新封面主張為「為自己而動，為棲地同行」；第 16–22 頁新增共同方向、SOL 角色、保育任務、合作分工、單案收支、成果證據及 90 天驗證；第 33 頁為新增研究來源。v1／v2／v3 保留供歷史比對，舊版本不再代表最新提案。

新增內容在 `sustainability_slides.json`，其餘頁面與排版在 `build_deck.py`。所有商業數字、合作與試辦門檻皆屬待驗證假設。既有市場來源沿用 2026-09-14、物種来源沿用 2026-09-17 查核；只有 C0～C6 是本次查閱，不能將整份簡報稱作所有資料都已於 2026-09-18 重新驗證。

重建（Python 環境需安裝 `python-pptx==1.0.2`）：

```sh
python output/fundraising/build_deck.py
```

需保留 `assets/brand/` 與本目錄 `wildlife-assets/`。重建會更新 v4 PPTX、預覽、講稿和 sources.json；來源圖為既有資產，新增頁面採可編輯文字與圖形。


新增設計與驗收：[跑鞋連動、同步與 Activity](../../docs/shoe-sync-activity.md)。本次只更新產品設計，未重新查核既有外部研究來源日期。


## 2026-09-20 Activity 與睡眠清理

募資 v4 第 3 頁移除睡眠任務宣傳，重建 PPTX、HTML 與講稿；歷史 v1–v3 保留。完整殘留／相容性與維持門檻影響見 [盤點](../../docs/activity-sleep-review.md)。

## 2026-09-21 個人成就 NFT 補充

新增 [NFT 專題展示包](../achievement-nft/README.md)，包含成就款式、驗證到鑄造領取流程、公開資訊／費用及收藏查證。本次作為三頁獨立補充，中文 v4 主簡報未改頁碼。

## 參賽開發與素材凍結

以 [2026-09-21 開發計畫](../../docs/store/competition-development-plan.md) 追蹤功能與規則。SKR 完成前保留規劃標示；10/1 決定是否納入，影片實機與 APK 同版後才更新完成宣稱。簡報附錄不視為實際鑄造／付款證據。
