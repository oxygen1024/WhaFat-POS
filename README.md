# 華發 iPad POS

使用 [華發網站](https://whafat-hk.com/) 的實際商品、規格、港幣價格與圖片建立的第一版收銀網頁 App。商品快照時間為 **2026-10-20 17:11 HKT**。

## 使用

私人試用網址於部署完成後記錄在 `docs/release.md`。在 iPad 用 Safari 開啟，按分享選單 → 加入主畫面；若顯示「以網頁 App 開啟」，請開啟該選項。私人網址可能需要使用建立此網站的帳戶登入。

搜尋／分類 → 選擇規格 → 加入訂單 → 設定折扣 → 收款 → 保存試用記錄。

付款按鈕用來保存記錄。FPS、PayMe、信用卡及八達通需要自行在外部確認收款，本版沒有支付連接。商品價格來自匯入時的網站；可疑價格及網站不可售規格無法加入訂單。

## 資料保存

訂單與購物車儲存在當前瀏覽器，不會同步到其他 iPad 或 Shopify。不同網址／瀏覽器的記錄分開。清除網站資料可能令記錄消失，請經資料備份功能匯出。

首次使用需連線。程式與商品目錄可在支援的瀏覽器完成快取後離線重開；只有部分看過的圖片會快取。不要把本版當作已完成正式付款、雲端備份或即時庫存系統。

## 本機開發

```sh
cd /Users/oxygen/Developer/WahFatPOS
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

在這部 Mac 開啟 `http://127.0.0.1:8765/`。此本機網址不能在另一部 iPad 開啟；iPad 請使用發布後的 HTTPS 網址。

```sh
node --test tests/*.test.mjs
python3 scripts/import_catalog.py
```

更新資料時會讀取公開網站並保存新來源快照。先檢查價格提示及變更，再重新發布；本機更新不會自動改變已發布網站。

## 檔案

- `dist/`：可部署的網頁 App 與商品目錄。
- `scripts/import_catalog.py`：可重用公開商品匯入工具。
- `docs/website-analysis.md`：REA 分析、設計依據及正式使用前所需工作。
- `docs/catalog-audit.md`：逐項資料核對、缺失與價格異常。
- `docs/rea-evidence.json`：REA 證據識別與觀察摘要。
- `tests/`：資料與收銀驗證。
- `data/source/`：只存本機的原始來源快照，不部署。

第一版沒有連接正式門市庫存、支付服務或收據機；iPad 真機操作需要另外驗收。
