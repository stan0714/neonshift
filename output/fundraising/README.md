# NeonShift 募資討論稿

目前版本：[中文 PowerPoint v3](NeonShift_募資簡報_中文草稿_v3.pptx)，2026-09-18，34 頁（30 頁主文＋4 頁附錄）。

- [網頁預覽](preview.html)：與簡報由同一份生成器產生，可列印。
- [逐頁講稿與資料來源](講稿與資料來源.md)。
- [永續研究與共同方向](../../docs/sustainability-direction.md)：完整建議、證據邊界、單案算術與 90 天路線。

v3 更新封面主張為「為自己而動，為棲地同行」；第 16–22 頁新增共同方向、SOL 角色、保育任務、合作分工、單案收支、成果證據及 90 天驗證；第 33 頁為新增研究來源。v1／v2 保留供歷史比對，舊版本不再代表最新提案。

新增內容在 `sustainability_slides.json`，其餘頁面與排版在 `build_deck.py`。所有商業數字、合作與試辦門檻皆屬待驗證假設。既有市場來源沿用 2026-09-14、物種来源沿用 2026-09-17 查核；只有 C0～C6 是本次查閱，不能將整份簡報稱作所有資料都已於 2026-09-18 重新驗證。

重建（Python 環境需安裝 `python-pptx==1.0.2`）：

```sh
python output/fundraising/build_deck.py
```

需保留 `assets/brand/` 與本目錄 `wildlife-assets/`。重建會更新 v3 PPTX、預覽、講稿和 sources.json；來源圖為既有資產，新增頁面採可編輯文字與圖形。
