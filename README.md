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

## 生日簿

左下「人脈雷達」右上角的「生日簿」可以手動登打客戶、朋友、家人與重要的人的生日。生日可輸入 `1990-05-12`、民國 `79/05/12` 或只填 `05/12`（不知道年份時）。

同一個視窗也能匯入東石系統的 `clients.db`（或含「姓名」「生日」欄位的 CSV），只讀取姓名、生日與保單數，不讀 Email、電話、地址。

## 金流 / 帳務

右下角「登打」可以輸入：

- **資產負債**：每筆標示資產或負債、台幣或美元，面板顯示淨資產（美元以即時匯率換算）。
- **每月固定收支**：每月幾號、項目、金額，面板依日期列出接下來要扣款或入帳的項目，並加總每月固定支出與收入。

## 資料存放與備份

生日簿、匯入的客戶與金流資料都只存在**這個瀏覽器**的 localStorage，不會上傳。換電腦或手機時，用右上角「備份」下載 JSON 檔，再到新裝置還原。備份檔含個人資料，請勿放進這個公開 repo（`.gitignore` 已擋下 `.db`、`.csv`，備份檔請另外保管）。

## 目前限制

- **TimeTree**：官方已停止提供公開 API，無法直接串接。建議把行程放在 Google 日曆，或在 TimeTree 與 Google 日曆之間手動同步。
- **LINE 個人訊息**：LINE 沒有開放讀取個人帳號聊天的 API，只有官方帳號（Messaging API）能收到「傳給機器人」的訊息。
- **台銀定存利率**：目前寫死在 `index.html`；美元／台幣匯率則即時抓取 open.er-api.com 的市場中價。
