# NeonShift

Solana Mobile 健康追蹤 dApp。將日常運動轉化為「打卡」任務，以鏈上驗證的方式發放 tSKR 測試代幣。

> **tSKR 是 devnet 測試代幣，無金錢價值，不是官方 SKR。**

## Repo 結構

| 路徑 | 內容 |
|---|---|
| `app/` | React Native Android App（Expo custom dev build） |
| `backend/` | Attestor 後端（Node.js + TypeScript + Fastify） |
| `programs/` | Anchor 鏈上程式與共用 Rust crate |
| `scripts/` | 建置與部署腳本 |
| `docs/` | 需求、分析、設計與開發文件 |

## 文件

| 文件 | 用途 |
|---|---|
| `docs/brd-detailed.md` | 業務需求 |
| `docs/sa.md` | 系統分析 |
| `docs/sd.md` | 系統設計 |
| `docs/pg.md` | 開發項目與進度追蹤 |
| `docs/build-and-test.md` | 實機建置與測試流程 |
| `docs/style.md` | UI 樣式規範 |

## 快速開始

環境安裝依 `docs/build-and-test.md` 第 1 章。

```bash
# 共用 attestation 模組測試（唯一不需外部工具鏈的部分）
cd programs/attestation-core && cargo test

# 產生跨語言測試向量
cargo run --bin gen_vectors > ../../backend/src/lib/attestation-vectors.json
```

## 平台範圍

Android 單一平台，目標裝置 Solana Mobile Seeker。iOS 不在範圍內（BRD 決策 D-04）。

正式網域 `neonshift.cc`；Android package `cc.neonshift.app`（SD 8）。
