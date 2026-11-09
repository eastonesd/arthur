# A.R.T.H.U.R.

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

左下「人脈雷達」右上角的「生日簿」可以手動登打客戶、朋友、家人的生日。生日可輸入 `1990-05-12`、民國 `79/05/12` 或只填 `05/12`（不知道年份時）。

同一個視窗也能匯入東石系統的 `clients.db`（或含「姓名」「生日」欄位的 CSV），只讀取姓名、生日與保單數，不讀 Email、電話、地址。

## 金流 / 帳務

右下角「登打」可以輸入：

- **資產負債**：每筆標示資產或負債、台幣或美元，面板顯示淨資產（美元以即時匯率換算）。
- **每月固定收支**：每月幾號、項目、金額，面板依日期列出接下來要扣款或入帳的項目，並加總每月固定支出與收入。

### 每月收入目標

核心上方的進度條顯示本月收入達成率。「登打 → 收入登打」有進帳的那天新增一筆（日期、金額、來源），進度條立即更新；只計算當月的進帳，每月 1 日自動歸零重算（舊月份的紀錄仍保留）。目標金額在 `config.js` 的 `incomeGoal`（預設 180,000）。

## 跨裝置同步（Supabase）

右上角「登入同步」，用**東石系統的帳號**（Email + 密碼）登入：

- 行程登打、生日簿、金流資料存到 Supabase 的 `jarvis_state` 資料表，電腦與手機共用同一份；兩邊都改過時，以較新的一次為準。
- 客戶生日直接讀東石系統的 `clients` 資料表（唯讀），不必再匯入檔案。
- 資料表都開啟 RLS，每個帳號只看得到自己的資料。`config.js` 裡的 publishable key 是公開金鑰，可以放在 repo；**絕對不要**放 service_role / secret key。

沒登入時資料只存在瀏覽器，可在同一個視窗「下載備份」與「從備份還原」。備份檔含個人資料，請勿放進這個公開 repo。

## 安裝與下載

- **安裝成 App**：用 Chrome / Edge 開網頁，按右上角「安裝 App」（或網址列的安裝圖示）。iPhone 用 Safari →「分享」→「加入主畫面」。安裝後有自己的圖示，斷線也能開啟。
- **下載原始碼**：GitHub repo 頁面 →「Code」→「Download ZIP」。本機開啟請用簡易伺服器（例如在資料夾內執行 `python -m http.server 8000`，再開 `http://localhost:8000`），直接雙擊 `index.html` 會無法登入 Google。

## LINE 推播（A.R.T.H.U.R. 官方帳號）

後端是 Supabase Edge Function `jarvis-line`（原始碼在 `supabase/functions/jarvis-line/`），排程：

| 時間（台北） | 內容 |
|---|---|
| 每天 08:00 | 早安簡報：行程數、客戶生日、3 天內到期款項、第一個行程時間、待辦；有壽星時附「好」按鈕，按下後產生生日祝福 |
| 每 5 分鐘檢查 | 行程開始前一小時提醒（手動登打的行程，以及當天打開過儀表板時同步的 Google 日曆） |
| 每天 21:00 | 今天到期或已逾期的待辦，可直接按按鈕打勾 |
| 每月 15 日 09:00 | 本月收入目標進度（%、已進帳金額、還差多少、平均每天需要多少） |

在 LINE 傳「今天」看簡報、「待辦」看未完成事項、「進度」看本月收入目標、「解除綁定」停止推播。

設定步驟：

1. 到 LINE Official Account Manager 建立官方帳號「A.R.T.H.U.R.」，在「設定 → Messaging API」啟用。
2. 到 LINE Developers 該 channel：複製 **Channel secret**；在 Messaging API 分頁發行 **Channel access token (long-lived)**。
3. Webhook URL 填 `https://kocyedkngpxckixtudku.supabase.co/functions/v1/jarvis-line`，打開「Use webhook」。官方帳號後台把「自動回應訊息」關閉。
4. Supabase 專案 → Edge Functions → Secrets 新增 `JARVIS_LINE_CHANNEL_SECRET`、`JARVIS_LINE_CHANNEL_ACCESS_TOKEN`；要用 AI 寫祝福再加 `ANTHROPIC_API_KEY`（沒有的話使用內建範本）。
5. 加 A.R.T.H.U.R. 好友 → 儀表板「登入同步」→「綁定 LINE」→ 把 8 碼綁定碼傳給官方帳號。

LINE 免費方案每月 200 則推播；回覆訊息（「今天」「待辦」、祝福按鈕）不計入。

## 專案指揮中心

右上角「專案」列出所有 eastone 專案的狀態（燈號：金＝正常、藍＝執行中、紅＝需要處理），資料來自 Supabase Edge Function `arthur-hub`（原始碼 `supabase/functions/arthur-hub/`），每 30 分鐘自動檢查一次：

- 最後一次推送、每個 GitHub Actions 流程最近一次的結果、GitHub Pages 網站是否打得開。
- 24 小時內新出現的失敗，會用 LINE 通知一次（同一個失敗不重複通知）。
- 成果：SAGA（劇數、完成集數、7 天產出）、蝦皮分潤機器人（佣金、成交、發文數）。早安簡報會附上「🛠 專案」段落。
- 監看哪些 repo 存在 `arthur_hub.projects`；`kind` 為 `readonly` 的專案（量化交易）只監看，不接受任何指令。

### 其他專案的統一回報格式

任何 repo 只要在根目錄放一個 `arthur.json`，A.R.T.H.U.R. 就會把它顯示在專案卡片與早安簡報：

```json
{
  "headline": "今天選出 3 檔觀察股",
  "metrics": [{ "label": "觀察清單", "value": "12 檔" }, { "label": "近 7 天訊號", "value": "4 次" }],
  "updated_at": "2026-11-10T08:00:00+08:00"
}
```

### LINE 指令：SAGA 開拍

在 LINE 傳「SAGA：一句靈感」，A.R.T.H.U.R. 先請您確認（開拍／取消），按「開拍」後在 eastone.saga 開一張「新劇」Issue，工廠就會自動企劃（預設 60 集、每集 90 秒）。

### GitHub 金鑰（ARTHUR_GITHUB_TOKEN）

沒有金鑰時只能讀公開 repo，且每小時最多檢查一次；私人 repo（eastone.dpf、eastone.trader）與 LINE 開拍都需要金鑰：

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token。
2. Repository access：Only select repositories，勾選所有 eastone 專案與 arthur。
3. Permissions：Actions、Contents、Pages、Metadata 設 Read-only；**Issues 設 Read and write**（用於 SAGA 開拍）。
4. Supabase 專案 → Edge Functions → Secrets 新增 `ARTHUR_GITHUB_TOKEN`。

## 目前限制

- **TimeTree**：官方已停止提供公開 API，無法直接串接。建議把行程放在 Google 日曆，或在 TimeTree 與 Google 日曆之間手動同步。
- **LINE 個人訊息**：LINE 沒有開放讀取個人帳號聊天的 API，只有官方帳號（Messaging API）能收到「傳給機器人」的訊息。
- **台銀定存利率**：目前寫死在 `index.html`；美元／台幣匯率則即時抓取 open.er-api.com 的市場中價。
