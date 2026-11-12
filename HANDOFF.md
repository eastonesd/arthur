# A.R.T.H.U.R. 工作階段交接（2026-11-01 ～ 11-12）

> 寫給：接手的下一個 Claude 工作階段。整理時間 2026-11-12 11:00（台北）。
> 範圍：本工作階段（亞瑟）在 11/01 之後做過的事。其他專案對話（東石影音、東石電商、東石數位、東石交易）各自的交接文件另見各 repo。
> 依據：各 repo 的 git 紀錄（commit 結尾有本工作階段的 Claude-Session 標記）與工作階段摘要。

## 0. 先讀這段

- **主人**：葉里克先生。我是「亞瑟」，語氣優雅、冷靜、帶點英式幽默。
- **只用繁體中文**：主人看不懂英文。回覆、文件、commit 訊息都用中文。
- **主人不想打指令**：不要叫他 cd、開終端機；能用 .bat、捷徑、Discord 指令就用。不想每次手動 merge PR，直接 push 到 main。
- **本機 repo 位置**：`C:\Users\krfin\Documents\GitHub\`（GitHub Desktop）。
- **金鑰一律由主人自己填**：Supabase secrets、GitHub secrets 或 `.env`。不要叫他把金鑰貼進對話，也不要在輸出裡印出金鑰。
- **eastone.trader 鐵則**：不准真實下單（Phase 5 前）、不准把秘密放進 git。詳見該 repo 的 CLAUDE.md。
- **eastone.com 必須保持公開**。
- **財經日報頁尾刻意保留「東石系統」**（主人的決定），不要改成新品牌名，也不要再提議。
- **需要先問主人的事**：刪除資料、公開發文。
- **改程式前先用 Graphify 定位**（見第 6 節），再讀必要的原始碼。圖譜不是執行結果，改完一樣要測試。

## 1. 系統全貌

```
                         ┌──────────── Discord「EASTONE SYSTEM」────────────┐
                         │ #東石影音 #東石電商 #東石數位 #亞瑟智能管家 #東石交易 │
                         └───────▲───────────────────────────┬──────────────┘
                     通知（每10分）│                           │ /saga /ec /dpf /saga-ref /saga-stats …
┌─────────────────────────────────┴───────────────────────────▼──────────────┐
│ Supabase（專案 kocyedkngpxckixtudku）                                         │
│  arthur-discord  指令入口 → 開 Issue／寫 queue.yaml／寫 DPF 收件匣             │
│  arthur-hub      每 10 分鐘掃描各 repo → 專案狀態、里程碑、失敗通知；DPF 收件匣 API │
│  jarvis-line     LINE webhook、早安簡報 09:00、生活提醒、生日、待辦、Web Push      │
└──────┬──────────────────────┬──────────────────────┬────────────────────────┘
       │ GitHub API            │ GitHub API            │ 輪詢收件匣
  eastone.saga（影音）     eastone.ecommerce（電商）   eastone.dpf（數位，主人 PC 上 Docker）
                                    ▲
  A.R.T.H.U.R. 儀表板（GitHub Pages，eastonesd/arthur）── 讀寫 Supabase、顯示六個專案磚
```

LINE 只留**個人用途**（早安簡報、行程、生日、待辦、提醒）。**專案的開工與通知全部改走 Discord**。

## 2. 依 repo 的工作紀錄

### 2.1 A.R.T.H.U.R.（eastonesd/arthur；本機資料夾名稱 jarvis，舊網址 eastonesd/jarvis 會自動轉址）

| 日期 | 內容 |
|---|---|
| 11/04 | 2.0.0 JARVIS 個人儀表板誕生。之後陸續加入：直接匯入東石系統 clients.db、生日簿、資產負債與固定收支、行程登打、Supabase 同步、可安裝 App、待辦、LINE 推播、多個 Gmail、手機推播（VAPID）；修正同步覆蓋與 2000 年生日的 bug |
| 11/05 | 2.7.0 每月收入目標進度條、收入登打、每月 15 日 LINE 推播進度 |
| 11/08 | 2.8.0 更名為 **A.R.T.H.U.R.**，網址改為 `/arthur/`；早安簡報稱呼改為「葉里克先生」 |
| 11/09 | 淨資產顯示開關（iOS 樣式、主題金色） |
| 11/10 | 2.9.x 專案指揮中心：專案健康總覽、失敗通知、早安簡報加專案段落、各專案頭像；LINE 開拍 SAGA；LINE 表單（SAGA／EC／DPF，填表→確認→執行，失敗可重試）；arthur-hub 的 DPF 收件匣（claim／done，用裝置金鑰認證） |
| 11/11 | eastone.com、eastone.stock 換頭像；更名「東石系統」→「東石保險服務平台」；**主控／專案切換**（六個專案磚飛入：左 東石保險、東石診股、東石交易；右 東石影音、東石電商、東石數位）；**Discord 上線**（/saga /ec /dpf 表單、各頻道通知、掃描改每 10 分鐘、/allow /deny 多人使用、撤掉 LINE 選單）；/saga-ref；東石電商磚加業績結案倒計時與撥款日；生活提醒調整 |
| 11/12 | 東石影音營利進度（磚上四個平台的小進度條，點擊看完整門檻）、arthur-hub 讀 monetization.json 並在跨過 25/50/75/100% 時通知、/saga-ref 影片轉存 Storage、/saga-stats 回報 TikTok、提醒拿掉小字 |
| 11/12 下午 | **Discord 待辦與行事曆**：`/todo`（新增待辦）、`/agenda`（新增行程）、`/todos`（查看＋按鈕完成）。直接寫入 `jarvis_state` 的 todos／agenda，儀表板、早安簡報、LINE 行程提醒與 21:00 待辦追蹤都吃得到。口語日期時間解析在 `arthur-discord/when.ts` |

### 2.2 東石影音（eastonesd/eastone.saga）— 本工作階段只做串接

- 11/10：App 改東石藍金配色；YouTube 上架沿用既有播放清單並依集數排序、統一封面；清掉播放清單空殼；IG 一次上 3 集，文案統一為「🔍點擊主頁連結，觀看完整版劇情」。
- 11/11～11/12：寫 `ARTHUR-DISCORD.md`（Discord 串接說明）並標註 A.R.T.H.U.R. 已上線的項目。
- 其餘製作、標竿分析、營利統計、排程上架都是東石影音對話做的，它有自己的交接紀錄（`3ca2272 交接紀錄：東石影音 11/01–11/12`）。

### 2.3 東石電商（eastonesd/eastone.ecommerce，原 shopee.robot）

- 11/10：
  - 儀表板改藍金配色、換 EC 頭像。
  - Threads 授權回呼改用新網址。
  - 排程改為每天 12:00、19:00、22:00。
  - **修 Threads 400**：使用者 ID 超過 JS 數字精度，改用 `me`。
  - 手動挑的商品不套用選品門檻。
  - 首兩篇正式發文。
- 11/11：發文拿掉揭露行與「價格與庫存以蝦皮頁面為準」（主人要求；已告知公平會揭露的風險）。
- 11/12：寫 `PROGRESS.md` 給電商對話；我這邊的本機 repo 改連新網址。

### 2.4 東石數位（eastonesd/eastone.dpf，原 aidpf）

- 11/10：藍金介面、可安裝成 App（PWA＋桌面捷徑）、A.R.T.H.U.R. 收件匣輪詢（LINE/Discord → DPF）；START 會合併 `.env.arthur`。
- 11/11：修 Windows CRLF：
  - compose 的 wp-setup 執行前先 `tr -d '\r'`。
  - start.ps1 用 LF 寫回。
- 之後 Phase 3（WooCommerce 上架與交付）是東石數位對話做的，見該 repo 的 `docs/HANDOFF.md`。

### 2.5 東石交易（eastonesd/eastone.trader）

- 11/10：
  - 換 EASTONE Trader 頭像，桌面捷徑同步更新工作列圖示。
  - 「更新並測試LINE.bat」改用有簽章的官方 Python。
  - 新增「開啟設定檔.bat」。
  - **永豐 Shioaji 唯讀行情接口**與「測試永豐連線.bat」，安全測試禁止任何下單呼叫。
  - 配合 Shioaji 1.7 改版：模擬環境讀行情、等待背景合約下載。
- 之後的模擬交易機器人、回測（SIP-01 停用、SWG-01 未過門檻）都是交易對話做的。

### 2.6 東石保險服務平台（eastonesd/eastone.com）／東石診股（eastonesd/eastone.stock）

- 11/12：**財經日報每日截圖改為 IG 限時動態版面**：`market/index.html?story=1` 是 9:16 版面（內容避開 IG 上方 13%、下方 15.5%），`tools/snapshot.mjs` 改拍 1080×1920（LINE 預覽 360×640）。觸發仍是 Supabase `trigger-snapshot`（08:25）＋ GitHub 排程備援。
- 11/11：
  - 兩邊都換上新版藍金頭像。
  - eastone.com 更名「東石保險服務平台」（主畫面「東石保險」），LINE 圖文選單換圖與標題。
  - eastone.stock 標題改「東石診股」，頭像外框改金色。

## 3. 基礎設施（目前狀態）

### Supabase 函式

| 函式 | 版本 | 作用 |
|---|---|---|
| jarvis-line | v17 | LINE webhook、排程任務、早安簡報、生活提醒、Web Push |
| arthur-hub | v12 | 掃描各 repo、專案通知、DPF 收件匣 API |
| arthur-discord | v11 | Discord 指令（Ed25519 驗簽；表單用 modal type 9；先回 type 5 延遲回應，再 PATCH `@original`） |

部署時要貼**完整檔案內容**。arthur-discord 有兩個檔（index.ts、when.ts），要一起部署。
另有 `trigger-snapshot`（每天 08:25 觸發 eastone.com 的財經日報截圖）等函式，不在本 repo。

### pg_cron
- `jarvis-morning-0800` → `0 1 * * *`（台北 09:00）。名稱沒改，時間已改。
- `arthur-hub-scan` → `*/10 * * * *`。
- 手動觸發：`net.http_post` 加 `x-cron-token` header。token 存在 Vault 的 `reminder_cron_token`。

### 資料表
| 資料表 | 用途 |
|---|---|
| `jarvis_state` | 儀表板資料，含 `data.routines` |
| `jarvis_line_links`、`jarvis_link_codes`、`jarvis_push_log` | LINE 綁定與推播紀錄 |
| `arthur_hub` | `projects` 與 `status`；每個 repo 的 refs、monet 都放在 status jsonb |
| `arthur_discord` | owner、guild_id、discord_user_id、allowed_users、channels {saga, ec, dpf, arthur} |
| `arthur_pending` | LINE 表單等待確認 |
| `arthur_dpf_inbox` | DPF 工作收件匣 |
| `arthur_device_tokens` | DPF 裝置金鑰 |

### Storage
- 私有 bucket `saga-refs`，上限 50MB。存標竿影片，對外給 90 天簽名網址。

### Secrets（只列名稱）
`ARTHUR_GITHUB_TOKEN`（eastone.ecommerce 與 eastone.saga 有 Contents 寫入權）、`DISCORD_BOT_TOKEN`、`JARVIS_LINE_CHANNEL_SECRET`、`JARVIS_LINE_CHANNEL_ACCESS_TOKEN`、`ANTHROPIC_API_KEY` 等。

### Discord
- 應用程式 ID：1569963735659839549。公鑰寫在程式預設值，也可用環境變數覆蓋。
- 伺服器「EASTONE SYSTEM」，主人與女朋友（用 /allow 加入）都能使用全部指令。
- 指令共 12 個：`/saga` `/ec` `/dpf` `/saga-ref` `/saga-stats` `/todo` `/agenda` `/todos` `/status` `/allow` `/deny` `/channel`。
- `/todo`、`/agenda` 寫進主人的 `jarvis_state`（女朋友用也一樣寫到主人那份）；時間沒寫上下午的 1～6 點當下午。
- 管理任務（`?task=`）：`setup`、`test`、`line-menu-off`。
- 「東石交易」頻道目前**沒有指定 kind**，交易通知走 trader 自己的 Discord webhook。

### 儀表板設定
- **生活提醒的唯一來源是 `config.js`**：儀表板的 merge() 會用它覆蓋資料庫。`time`＝推播時間，`at`＝顯示時間。

| 提醒 | 顯示時間 | 推播時間 |
|---|---|---|
| 午餐 | 12:00 | 12:00 |
| 洗澡 | 17:00 | 17:00 |
| 倒垃圾 | 21:50 | 21:20 |
| 睡覺 | 00:00 | 00:00 |

- 早安簡報 09:00。
- **東石電商撥款表**：9 月→11/10、10 月→12/10、11 月→12/28、12 月→1/25，之後每月業績於次月 25 日撥款。
- **結案倒計時**：每月最後一天 23:50。
- `sw.js` VERSION：`jarvis-3.2.0`。改前端記得往上加。

### 改 GitHub 的方式
- 雲端這邊可直接 push。
- 主人 PC 上的 repo 用 git bundle 搭配 device_commit_files 更新。PC 的 VM 沒有 GitHub 憑證。

## 4. 跨 repo 契約（改了會壞，兩邊要一起改）

| A.R.T.H.U.R. 那邊 | 對方 repo | 依賴的東西 |
|---|---|---|
| `sagaCreate` | eastone.saga | label「新劇」與 Issue 表單標題（`### 靈感`…） |
| `sagaRef` | eastone.saga | label「標竿」／「已分析」，`### 影片`／`### 喜歡哪裡`／`### 出處` |
| `sagaStats` | eastone.saga | `stats/manual.json`（commit 加 `[skip ci]`） |
| `sagaMetrics`／`projectEvents` | eastone.saga | Release 附件名 `-epNN.mp4`、`stats/monetization.json` |
| `ecEnqueue` | eastone.ecommerce | `queue.yaml` 頂層 `items:`；push 到 queue.yaml 會觸發發文（**不加** `[skip ci]`） |
| `ecMetrics`／`projectEvents` | eastone.ecommerce | `dashboard/data/meta.json` 的 `total_posts`，以及 `posts.json` 的 name、permalink、price、commission_rate |
| `dpfEnqueue`／`dpfInbox` | eastone.dpf | `arthur_dpf_inbox` 與裝置金鑰 |

**注意**：`arthur-discord` 和 `jarvis-line` 各有一份 `ghHeaders`、`b64encode`、`yq`、`ecEnqueue`、`dpfEnqueue`、`sagaCreate`，改一份要記得改另一份。

## 5. 未完成／待辦

1. **東石數位資料庫密碼**：舊 aidpf volume 裡是舊密碼，所以出現「Error establishing a database connection」。主人選了「保留舊資料、沿用舊密碼」，有兩個解法：
   - (a) 在 Claude 桌面 App 用「新增資料夾」加入 `C:\Users\krfin\Documents\GitHub\aidpf`，由亞瑟把密碼搬過去。
   - (b) 主人自己把舊 `.env` 的 `POSTGRES_*`、`WP_DB_*`、`MARIADB_ROOT_PASSWORD`、`WP_ADMIN_*` 複製到新 `.env`。

   東石數位對話之後加了「沒 .env 但有舊資料庫時停止並提示」，並完成了 Phase 3 驗收，可能已經解決，請先確認。
2. **東石電商佇列已空**：需要主人用 `/ec` 補商品。蝦皮聯盟 API 尚未接上。
3. **東石交易 Discord 頻道**：要不要在 A.R.T.H.U.R. 加 `trader` kind，主人還沒回覆。
4. **SAGA 的 Threads 影片上架**：原本等主人設定 saga 的 Threads 金鑰，目前暫緩。
5. 主人 PC 上 eastone.dpf 留有一筆 git stash，無害，刪除前要先問。
6. Graphify 共用筆記有 3 則待審（arthur／eastone.saga／eastone.ecommerce）：主人要到後台 Memory → Needs review 按 Accept。

## 6. Graphify（省 token 的工作方式）

- 已建索引：`eastonesd/arthur`、`eastonesd/eastone.saga`、`eastonesd/eastone.ecommerce`。
- 未建索引：eastone.dpf、eastone.trader、eastone.com、eastone.stock。
- 建議流程：
  1. `graphify_rank_files`：找出相關檔案。
  2. `graphify_file_neighbors(symbols_only)`：看函式清單，不必讀整檔。
  3. `graphify_node`／`graphify_callers`：看函式本體與誰呼叫它。
  4. 只讀要改的那幾段原始碼。
  5. 修改後測試或部署驗證。
- 主要入口：
  - A.R.T.H.U.R.：
    - `arthur-discord/index.ts` `interaction()`
    - `jarvis-line/index.ts` `handleEvent()`
    - `arthur-hub/index.ts` `scanOwner()`
  - 東石影音：`saga/cli.py` `main()`，由它分派 `cmd_plan`、`cmd_produce`、`cmd_publish`、`cmd_benchmark`、`cmd_stats`…
  - 東石電商：`src/main.js` `main()`，流程是 `sync()`、`post()`、`sync()`。
