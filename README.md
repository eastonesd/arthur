# JARVIS

個人儀表板：今日行程、客戶生日雷達、Gmail 未讀、匯率與定存利率。純前端，可直接用 GitHub Pages 發佈。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 版面結構 |
| `style.css` | 樣式 |
| `script.js` | 資料讀取與互動 |
| `config.js` | **唯一需要修改的設定**（Google 用戶端 ID、生活提醒） |
| `assets/core.jpg` | 中央核心圖 |

## 連接 Gmail 與 Google 日曆

1. 到 Google Cloud Console，在現有專案中啟用 **Gmail API** 與 **Google Calendar API**。
2. 「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」，類型選 **網頁應用程式**。
3. 「已授權的 JavaScript 來源」填入 `https://eastonesd.github.io`（本機測試可再加 `http://localhost:8000`）。
4. 「OAuth 同意畫面 → 目標對象」把自己的 Gmail 加入**測試使用者**。
5. 複製用戶端 ID，貼進 `config.js` 的 `googleClientId`。
6. 打開網頁按右上角「連接 Google」並同意授權。

權限只有唯讀（`gmail.readonly`、`calendar.readonly`）。資料只在瀏覽器裡讀取與顯示，不會傳到任何伺服器。登入約一小時後過期，再按一次即可。

## 匯入客戶生日（東石系統）

左下角「匯入客戶 CSV」。第一列需要有標題，系統會自動辨識：

- **姓名**欄（必要）：`姓名`／`名字`／`客戶`／`name`
- **生日**欄（必要）：`生日`／`出生日期`／`birthday`，支援 `1986-03-12`、`1986/3/12`、民國 `75/03/12`、`750312`、`03/12`
- **最後聯絡**欄（選填）：有這欄才會顯示「超過 30 天未聯絡」

UTF-8 與 Excel 預設的 Big5 編碼都能讀。客戶資料只存在這台瀏覽器的 localStorage，**不會上傳到 GitHub**。

## 目前限制

- **TimeTree**：官方已停止提供公開 API，無法直接串接。建議把行程放在 Google 日曆，或在 TimeTree 與 Google 日曆之間手動同步。
- **LINE 個人訊息**：LINE 沒有開放讀取個人帳號聊天的 API，只有官方帳號（Messaging API）能收到「傳給機器人」的訊息。
- **台銀定存利率**：目前寫死在 `index.html`；美元／台幣匯率則即時抓取 open.er-api.com 的市場中價。
