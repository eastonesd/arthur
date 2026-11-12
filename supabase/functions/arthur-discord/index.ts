// ============================================================
// A.R.T.H.U.R. Discord（arthur-discord）
// 網址：https://<project>.supabase.co/functions/v1/arthur-discord
//
// 1. Discord Interactions endpoint（帶 X-Signature-Ed25519）：
//    /saga  開表單 → 東石影音開拍新劇（eastone.saga 開「新劇」Issue）
//    /ec    開表單 → 東石電商加入 queue.yaml，機器人接著發文到 Threads
//    /dpf   開表單 → 東石數位收件匣，電腦上的 DPF 領取後產生企劃
//    /saga-ref 丟一段標竿短劇片段 → eastone.saga 開「標竿」Issue，自動分析（規格見 eastone.saga 的 ARTHUR-DISCORD.md）
//    /saga-stats 手動回報 TikTok 粉絲／上月有效觀看 → 寫入 eastone.saga 的 stats/manual.json
//    /todo   開表單 → 新增待辦到 A.R.T.H.U.R.（jarvis_state.todos，儀表板與 LINE 21:00 待辦追蹤都看得到）
//    /agenda 開表單 → 新增行程到 A.R.T.H.U.R. 行事曆（jarvis_state.agenda，早安簡報與 LINE 行程前一小時提醒都會用到）
//    /todos  查看未完成待辦與未來 7 天行程，按按鈕即可完成待辦
//    /channel 把目前頻道設為某個專案的通知頻道
//    /status  專案狀態
//    /allow、/deny  讓伺服器裡的某個人可以（或不再可以）使用這些指令
// 2. 排程／管理（x-cron-token）：
//    {task:"setup"}  註冊指令到伺服器、依頻道名稱自動對應通知頻道
//    {task:"test"}   每個通知頻道各發一則測試訊息
//    {task:"line-menu-off"}  撤掉 LINE 的 SAGA／EC／DPF 圖文選單（工作改到 Discord）
//    {task:"daily-video"}    把 eastone.com 財經日報的 15 秒影音版（daily-report 分支的 latest.json → video）傳到 A.R.T.H.U.R. 頻道
//                            只傳今天的；加 force:true 不檢查日期
//
// Secrets：DISCORD_BOT_TOKEN、ARTHUR_GITHUB_TOKEN（DISCORD_PUBLIC_KEY、DISCORD_APP_ID 有預設值，可覆寫）
// verify_jwt 關閉：改用 Discord 簽章與 cron token 驗證。
// 第一位使用指令的人自動成為主人；主人（或已授權的人）用 /allow 把其他人加進來。
// ============================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { niceDate, parseDate, parseTime, todayTaipei } from "./when.ts";

// 應用程式 ID 與公鑰是公開資訊（不是密碼），直接當預設值；機器人金鑰 DISCORD_BOT_TOKEN 才是秘密
const PUB = () => Deno.env.get("DISCORD_PUBLIC_KEY") || "f95399e38b012bcaff1f3b49c0c488e856c8cc1e25570812bc261136ab8531ae";
const APP = () => Deno.env.get("DISCORD_APP_ID") || "1569963735659839549";
const BOT = () => Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const API = "https://discord.com/api/v10";
const GOLD = 0xf5b43a, RED = 0xff7a7a;
const AVATAR: Record<string, string> = {
  saga: "https://eastonesd.github.io/arthur/assets/projects/saga.png",
  ec: "https://eastonesd.github.io/arthur/assets/projects/ec.png",
  dpf: "https://eastonesd.github.io/arthur/assets/projects/dpf.png",
  arthur: "https://eastonesd.github.io/arthur/assets/projects/arthur.png",
};
const KIND_NAME: Record<string, string> = { saga: "東石影音", ec: "東石電商", dpf: "東石數位", arthur: "A.R.T.H.U.R." };

function adminClient() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const key = keys ? JSON.parse(keys)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
}
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// ---------- Discord 簽章 ----------
const hex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
async function verify(raw: string, sig: string | null, ts: string | null) {
  if (!sig || !ts || !PUB()) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(PUB()), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + raw));
  } catch { return false; }
}
const bot = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bot ${BOT()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

// ---------- 指令與表單 ----------
const PROJECT_CHOICES = [
  { name: "東石影音（SAGA）", value: "saga" }, { name: "東石電商（EC）", value: "ec" },
  { name: "東石數位（DPF）", value: "dpf" }, { name: "A.R.T.H.U.R.（其他專案與總覽）", value: "arthur" },
];
const COMMANDS = [
  { name: "saga", description: "東石影音：開拍一部新短劇" },
  { name: "ec", description: "東石電商：加入商品並發文到 Threads" },
  { name: "dpf", description: "東石數位：產生一個數位商品企劃" },
  { name: "saga-ref", description: "東石影音：丟一段標竿短劇片段，自動分析",
    options: [
      { type: 11, name: "video", name_localizations: { "zh-TW": "影片" }, description: "短劇片段（30～60 秒、10MB 以內最好）", required: true },
      { type: 3, name: "likes", name_localizations: { "zh-TW": "喜歡哪裡" }, description: "例如：男主吼的那句、運鏡", required: true, max_length: 500 },
      { type: 3, name: "source", name_localizations: { "zh-TW": "出處" }, description: "例如：紅果《某某》", required: false, max_length: 200 },
    ] },
  { name: "saga-stats", description: "東石影音：手動回報 TikTok 數字（TikTok 不開放個人帳號數據）",
    options: [
      { type: 3, name: "platform", name_localizations: { "zh-TW": "平台" }, description: "平台", required: true, choices: [{ name: "TikTok", value: "tiktok" }] },
      { type: 3, name: "metric", name_localizations: { "zh-TW": "項目" }, description: "要回報的數字", required: true,
        choices: [{ name: "粉絲", value: "followers" }, { name: "觀看（上個月有效觀看）", value: "views_last_month" }] },
      { type: 4, name: "value", name_localizations: { "zh-TW": "數字" }, description: "目前的數字", required: true, min_value: 0 },
    ] },
  { name: "todo", description: "A.R.T.H.U.R.：新增待辦" },
  { name: "agenda", description: "A.R.T.H.U.R.：新增行程到行事曆" },
  { name: "todos", description: "A.R.T.H.U.R.：查看待辦與近期行程，按一下就完成" },
  { name: "status", description: "查看所有專案狀態" },
  { name: "allow", description: "讓這個人也可以使用 A.R.T.H.U.R. 的所有指令",
    options: [{ type: 6, name: "user", description: "要加入的人", required: true }] },
  { name: "deny", description: "不再讓這個人使用 A.R.T.H.U.R. 的指令",
    options: [{ type: 6, name: "user", description: "要移除的人", required: true }] },
  { name: "channel", description: "把這個頻道設為某個專案的通知頻道",
    options: [{ type: 3, name: "project", description: "哪個專案的通知要送到這裡", required: true, choices: PROJECT_CHOICES }] },
];

type Field = { id: string; label: string; long?: boolean; required?: boolean; placeholder?: string; value?: string; max?: number };
const FORMS: Record<string, { title: string; fields: Field[] }> = {
  saga: { title: "東石影音：開拍新劇", fields: [
    { id: "idea", label: "靈感（一句話的故事點子）", long: true, required: true, max: 500, placeholder: "被趕出家門的千金，三年後以神秘投資人身分回歸" },
    { id: "eps", label: "集數", value: "60", max: 3 },
    { id: "secs", label: "每集秒數", value: "90", max: 3 },
  ] },
  ec: { title: "東石電商：上架發文", fields: [
    { id: "name", label: "商品名稱", required: true, max: 200 },
    { id: "link", label: "分潤連結", required: true, max: 300, placeholder: "s.shopee.tw 開頭的網址" },
    { id: "cat", label: "分類", max: 40, placeholder: "例：保護貼" },
    { id: "pricing", label: "價格／佣金比例", max: 40, placeholder: "例：189／10%" },
    { id: "note", label: "賣點", long: true, max: 300, placeholder: "一句話就好" },
  ] },
  dpf: { title: "東石數位：生成商品", fields: [
    { id: "name", label: "商品名稱", required: true, max: 120 },
    { id: "audience", label: "目標客群", max: 300 },
    { id: "type", label: "商品類型", max: 120, placeholder: "例：電子書、模板、課程講義" },
    { id: "price", label: "預期售價（台幣）", max: 10, placeholder: "例：399" },
    { id: "detail", label: "需求說明", long: true, max: 4000, placeholder: "痛點、想解決的問題、參考資料、特別要求" },
  ] },
  todo: { title: "A.R.T.H.U.R.：新增待辦", fields: [
    { id: "title", label: "待辦事項", required: true, max: 200, placeholder: "例：回覆王先生的保單問題" },
    { id: "due", label: "期限（可留白）", max: 30, placeholder: "例：明天、週五、下週一、11/20" },
  ] },
  agenda: { title: "A.R.T.H.U.R.：新增行程", fields: [
    { id: "title", label: "行程", required: true, max: 200, placeholder: "例：拜訪陳小姐談保單健診" },
    { id: "date", label: "日期", required: true, max: 30, value: "今天", placeholder: "例：今天、明天、週五、11/20" },
    { id: "time", label: "時間（留白＝全天）", max: 20, placeholder: "例：14:30、下午3點、晚上7點半" },
    { id: "where", label: "地點（可留白）", max: 100 },
  ] },
};
function modal(kind: string) {
  const f = FORMS[kind];
  return { type: 9, data: { custom_id: `form:${kind}`, title: f.title, components: f.fields.map((x) => ({ type: 1, components: [{
    type: 4, custom_id: x.id, label: x.label, style: x.long ? 2 : 1, required: !!x.required, max_length: x.max ?? 4000,
    ...(x.placeholder ? { placeholder: x.placeholder } : {}), ...(x.value ? { value: x.value } : {}),
  }] })) } };
}
const num = (s?: string) => { const n = Number(String(s ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

// ---------- 執行（與 LINE 版同一套邏輯） ----------
const ghHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "arthur" });
const b64encode = (s: string) => { const b = new TextEncoder().encode(s); let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const yq = (v: string) => JSON.stringify(v);
type Result = { ok: boolean; title: string; text: string; url?: string };
// 舊名 saga.ai 已改為 eastone.saga；固定用新名稱（POST 遇到改名轉址會失敗）
const SAGA_REPO = "eastonesd/eastone.saga";

async function sagaCreate(d: Record<string, string>): Promise<Result> {
  const token = Deno.env.get("ARTHUR_GITHUB_TOKEN");
  if (!token) return { ok: false, title: "無法開拍", text: "還沒設定 GitHub 金鑰（ARTHUR_GITHUB_TOKEN）。" };
  const idea = (d.idea ?? "").trim();
  if (idea.length < 4) return { ok: false, title: "無法開拍", text: "靈感至少要 4 個字。" };
  const eps = Math.min(Math.max(Math.round(num(d.eps) ?? 60), 1), 120), secs = Math.min(Math.max(Math.round(num(d.secs) ?? 90), 15), 180);
  const res = await fetch(`https://api.github.com/repos/${SAGA_REPO}/issues`, { method: "POST", headers: ghHeaders(token), body: JSON.stringify({
    title: "新劇：" + idea.slice(0, 24), labels: ["新劇"],
    body: `### 靈感\n\n${idea}\n\n### 類型\n\n_No response_\n\n### 畫風\n\n_No response_\n\n### 集數\n\n${eps}\n\n### 每集長度（秒）\n\n${secs}\n\n> 由 A.R.T.H.U.R. 從 Discord 送出`,
  }) });
  if (!res.ok) return { ok: false, title: "無法開拍", text: `GitHub 回應 ${res.status}，請確認金鑰對 eastone.saga 有 Issues 寫入權限。` };
  const j = await res.json();
  return { ok: true, title: `第 ${j.number} 號劇開始企劃`, url: `https://eastonesd.github.io/eastone.saga/#/s/${j.number}`,
    text: `「${idea.slice(0, 200)}」\n${eps} 集・每集 ${secs} 秒。幾分鐘後會寫好角色表與分集大綱。` };
}

// Discord 的附件網址幾小時內就失效：先轉存到 Supabase Storage（私有 bucket saga-refs），Issue 放 90 天的簽名網址
async function keepVideo(db: SupabaseClient, att: any): Promise<string | null> {
  try {
    const r = await fetch(att.url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ext = (String(att.filename ?? "").match(/\.(mp4|mov|webm|mkv|3gp)$/i)?.[1] ?? "mp4").toLowerCase();
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("saga-refs").upload(path, buf, { contentType: att.content_type || "video/mp4", upsert: false });
    if (up.error) { console.error("storage upload", up.error.message); return null; }
    const signed = await db.storage.from("saga-refs").createSignedUrl(path, 90 * 86400);
    return signed.data?.signedUrl ?? null;
  } catch (e) { console.error("keepVideo", e); return null; }
}

async function sagaRef(db: SupabaseClient, opts: Record<string, string>, attachment: any, who: string): Promise<Result> {
  const token = Deno.env.get("ARTHUR_GITHUB_TOKEN");
  if (!token) return { ok: false, title: "無法送出", text: "還沒設定 GitHub 金鑰（ARTHUR_GITHUB_TOKEN）。" };
  const likes = (opts.likes ?? "").trim(), source = (opts.source ?? "").trim();
  const url = String(attachment?.url ?? "");
  if (!/^https:\/\//.test(url)) return { ok: false, title: "無法送出", text: "沒有收到影片附件。" };
  if (attachment?.content_type && !String(attachment.content_type).startsWith("video/"))
    return { ok: false, title: "無法送出", text: `這不是影片檔（${attachment.content_type}）。` };
  const kept = await keepVideo(db, attachment);
  const res = await fetch(`https://api.github.com/repos/${SAGA_REPO}/issues`, { method: "POST", headers: ghHeaders(token), body: JSON.stringify({
    title: "標竿：" + likes.slice(0, 24), labels: ["標竿"],
    body: `### 影片\n\n${kept ?? url}\n\n### 喜歡哪裡\n\n${likes}\n\n### 出處\n\n${source || "_No response_"}\n\n由 A.R.T.H.U.R. 從 Discord 送出（${who}）`,
  }) });
  if (!res.ok) return { ok: false, title: "無法送出", text: `GitHub 回應 ${res.status}，請確認金鑰對 eastone.saga 有 Issues 寫入權限。` };
  const j = await res.json();
  return { ok: true, title: `標竿 #${j.number} 已送出分析`, url: j.html_url,
    text: `「${likes.slice(0, 200)}」${source ? `\n出處：${source}` : ""}\n${kept ? "影片已轉存（90 天有效）。" : "⚠️ 影片轉存失敗，用的是 Discord 原始網址（幾小時後失效）。"}\n幾分鐘後分析完成，結果會貼在這個頻道。` };
}

async function sagaStats(opts: Record<string, string>, who: string): Promise<Result> {
  const token = Deno.env.get("ARTHUR_GITHUB_TOKEN");
  if (!token) return { ok: false, title: "無法回報", text: "還沒設定 GitHub 金鑰（ARTHUR_GITHUB_TOKEN）。" };
  const platform = opts.platform, metric = opts.metric, value = Math.max(0, Math.round(Number(opts.value)));
  if (platform !== "tiktok" || !["followers", "views_last_month"].includes(metric) || !Number.isFinite(value))
    return { ok: false, title: "無法回報", text: "格式不對。" };
  const url = `https://api.github.com/repos/${SAGA_REPO}/contents/stats/manual.json`;
  const cur = await fetch(url, { headers: ghHeaders(token) });
  let data: Record<string, any> = {}, sha: string | undefined;
  if (cur.ok) { const j = await cur.json(); sha = j.sha; try { data = JSON.parse(b64decode(j.content)); } catch { data = {}; } }
  else if (cur.status !== 404) return { ok: false, title: "無法回報", text: `讀取 stats/manual.json 失敗（GitHub ${cur.status}）。` };
  const before = data[platform]?.[metric];
  data[platform] = { ...(data[platform] ?? {}), [metric]: value };
  const label = metric === "followers" ? "粉絲" : "上個月有效觀看";
  const put = await fetch(url, { method: "PUT", headers: ghHeaders(token), body: JSON.stringify({
    message: `TikTok ${label} ${value}（${who} 從 Discord 回報）[skip ci]`, content: b64encode(JSON.stringify(data, null, 2) + "\n"), ...(sha ? { sha } : {}),
    committer: { name: "A.R.T.H.U.R.", email: "arthur@users.noreply.github.com" } }) });
  if (!put.ok) return { ok: false, title: "無法回報", text: `寫入失敗（GitHub ${put.status}），請確認金鑰對 eastone.saga 有 Contents 寫入權限。` };
  return { ok: true, title: `TikTok ${label}：${value.toLocaleString("zh-TW")}`,
    text: `${before !== undefined ? `上次是 ${Number(before).toLocaleString("zh-TW")}。` : ""}明天 06:41 營利進度更新時會算進去。` };
}

async function ecEnqueue(d: Record<string, string>): Promise<Result> {
  const token = Deno.env.get("ARTHUR_GITHUB_TOKEN");
  if (!token) return { ok: false, title: "無法加入", text: "還沒設定 GitHub 金鑰（ARTHUR_GITHUB_TOKEN）。" };
  const name = (d.name ?? "").trim(), link = (d.link ?? "").trim();
  if (!/^https:\/\/(s\.shopee\.tw|shopee\.tw)\//.test(link)) return { ok: false, title: "無法加入", text: "分潤連結要是蝦皮的網址（https://s.shopee.tw/…）。" };
  const nums = (d.pricing ?? "").match(/\d+(?:\.\d+)?/g) ?? [];
  const price = nums[0] ? Number(nums[0]) : null, rateRaw = nums[1] ? Number(nums[1]) : null;
  const rate = rateRaw ? (rateRaw > 1 ? rateRaw / 100 : rateRaw) : null;
  const repo = Deno.env.get("ARTHUR_EC_REPO") || "eastonesd/eastone.ecommerce";
  const url = `https://api.github.com/repos/${repo}/contents/queue.yaml`;
  const cur = await fetch(url, { headers: ghHeaders(token) });
  if (!cur.ok) return { ok: false, title: "無法加入", text: `讀取 queue.yaml 失敗（GitHub ${cur.status}）。` };
  const j = await cur.json();
  let yaml = b64decode(j.content);
  const item = [`  - name: ${yq(name)}`, `    link: ${yq(link)}`];
  if (d.cat?.trim()) item.push(`    keyword: ${yq(d.cat.trim())}`);
  if (price) item.push(`    price: ${price}`);
  if (rate) item.push(`    commission_rate: ${rate}`);
  if (d.note?.trim()) item.push(`    note: ${yq(d.note.trim())}`);
  if (/^items:\s*\[\s*\]\s*$/m.test(yaml)) yaml = yaml.replace(/^items:\s*\[\s*\]\s*$/m, "items:");
  if (!/^items:\s*$/m.test(yaml)) yaml = yaml.replace(/\s*$/, "\n\nitems:\n");
  yaml = yaml.replace(/\s*$/, "\n") + item.join("\n") + "\n";
  const put = await fetch(url, { method: "PUT", headers: ghHeaders(token), body: JSON.stringify({
    message: `Discord 加入商品：${name.slice(0, 40)}`, content: b64encode(yaml), sha: j.sha,
    committer: { name: "A.R.T.H.U.R.", email: "arthur@users.noreply.github.com" } }) });
  if (!put.ok) return { ok: false, title: "無法加入", text: `寫入 queue.yaml 失敗（GitHub ${put.status}），請確認金鑰有 Contents 寫入權限。` };
  return { ok: true, title: `已加入「${name}」`, text: "機器人約 1～2 分鐘內會發文到 Threads，發出後會在這裡通知您。" };
}

async function dpfEnqueue(db: SupabaseClient, owner: string, d: Record<string, string>): Promise<Result> {
  const price = num(d.price);
  const brief = {
    title: (d.name ?? "").trim().slice(0, 120), audience: d.audience ?? "", product_type: (d.type ?? "").slice(0, 120),
    pain_points: d.detail ?? "", problem: "", language: "zh-TW", target_price_twd: price ? Math.round(price) : null,
    reference_notes: "", special_requests: "",
  };
  const { error } = await db.from("arthur_dpf_inbox").insert({ owner, brief });
  if (error) return { ok: false, title: "無法送出", text: String(error.message) };
  return { ok: true, title: `已送到 DPF：「${brief.title}」`, text: "電腦上的 DPF 開著時，約 1 分鐘內會建立商品並產生 AI 企劃；完成後會在這裡通知您。" };
}

// ---------- 待辦與行事曆（寫進儀表板的 jarvis_state） ----------
// 與儀表板相同的格式：每筆有 id 與更新時間 u；儀表板同步時依 id 合併、取較新的那筆，所以不會互相覆蓋。
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
type Todo = { id: string; title: string; due?: string; done?: boolean; doneAt?: string; u?: number };
type Agenda = { id: string; date: string; time?: string; title: string; where?: string; u?: number };
async function loadState(db: SupabaseClient, owner: string): Promise<Record<string, any>> {
  const { data, error } = await db.from("jarvis_state").select("data").eq("owner", owner).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.data ?? {}) as Record<string, any>;
}
async function saveState(db: SupabaseClient, owner: string, data: Record<string, any>) {
  const { error } = await db.from("jarvis_state").upsert({ owner, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
const openTodos = (todos: Todo[]) => todos.filter((t) => !t.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
const dueText = (due?: string) => {
  if (!due) return "";
  const t = todayTaipei();
  return due < t ? `⚠️ 已過期 ${niceDate(due)}` : niceDate(due);
};
const DATE_HELP = "例：今天、明天、後天、週五、下週一、11/20、3天後";

async function todoAdd(db: SupabaseClient, owner: string, d: Record<string, string>): Promise<Result> {
  const title = (d.title ?? "").trim();
  if (!title) return { ok: false, title: "無法新增", text: "待辦事項不能空白。" };
  const due = parseDate(d.due ?? "");
  if (due === null) return { ok: false, title: "看不懂期限", text: `「${d.due}」我讀不懂，先生。\n${DATE_HELP}` };
  const data = await loadState(db, owner);
  const todos: Todo[] = Array.isArray(data.todos) ? data.todos : [];
  todos.push({ id: newId(), title, due, done: false, u: Date.now() });
  await saveState(db, owner, { ...data, todos });
  const left = openTodos(todos).length;
  return { ok: true, title: "已加入待辦", text: `「${title}」${due ? `\n期限：${niceDate(due)}` : ""}\n目前共有 ${left} 件未完成。輸入 /todos 可以查看並勾選完成。` };
}

async function agendaAdd(db: SupabaseClient, owner: string, d: Record<string, string>): Promise<Result> {
  const title = (d.title ?? "").trim(), where = (d.where ?? "").trim();
  if (!title) return { ok: false, title: "無法新增", text: "行程不能空白。" };
  const date = parseDate(d.date?.trim() ? d.date : "今天");
  if (!date) return { ok: false, title: "看不懂日期", text: `「${d.date}」我讀不懂，先生。\n${DATE_HELP}` };
  if (date < todayTaipei()) return { ok: false, title: "日期已經過了", text: `${date} 已經過去了，先生。` };
  const time = parseTime(d.time ?? "");
  if (time === null) return { ok: false, title: "看不懂時間", text: `「${d.time}」我讀不懂，先生。\n例：14:30、下午3點、晚上7點半；留白代表全天。` };
  const data = await loadState(db, owner);
  const agenda: Agenda[] = Array.isArray(data.agenda) ? data.agenda : [];
  const clash = time ? agenda.find((a) => a.date === date && a.time === time) : undefined;
  agenda.push({ id: newId(), date, time, title, where, u: Date.now() });
  await saveState(db, owner, { ...data, agenda });
  const sameDay = agenda.filter((a) => a.date === date).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const lines = sameDay.map((a) => `${a.time || "全天"}　${a.title}${a.where ? `（${a.where}）` : ""}`);
  return { ok: true, title: `已排入行程：${niceDate(date)}`, text: [
    `**${time || "全天"}　${title}**${where ? `\n地點：${where}` : ""}`,
    clash ? `\n⚠️ 同一時間已經有「${clash.title}」，先生恐怕得分身了。` : "",
    time ? "開始前一小時，LINE 會提醒您。" : "",
    sameDay.length > 1 ? `\n當天行程：\n${lines.join("\n")}` : "",
  ].filter(Boolean).join("\n") };
}

// /todos 的畫面：未完成待辦（附完成按鈕）＋ 未來 7 天的行程
async function todosView(db: SupabaseClient, owner: string, note?: string) {
  const data = await loadState(db, owner);
  const todos = openTodos(Array.isArray(data.todos) ? data.todos : []);
  const t = todayTaipei(), end = new Date(Date.parse(t + "T00:00:00Z") + 7 * 86400_000).toISOString().slice(0, 10);
  const agenda = ((Array.isArray(data.agenda) ? data.agenda : []) as Agenda[])
    .filter((a) => a.date >= t && a.date <= end)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const todoLines = todos.slice(0, 20).map((x, i) => `${i + 1}. ${x.title}${x.due ? `　·　${dueText(x.due)}` : ""}`);
  if (todos.length > 20) todoLines.push(`…另外還有 ${todos.length - 20} 件，請到儀表板查看。`);
  let lastDay = "";
  const agendaLines: string[] = [];
  for (const a of agenda) {
    if (a.date !== lastDay) { agendaLines.push(`**${niceDate(a.date)}**`); lastDay = a.date; }
    agendaLines.push(`　${a.time || "全天"}　${a.title}${a.where ? `（${a.where}）` : ""}`);
  }
  const description = [
    note ? `${note}\n` : null,
    `📝 **待辦（${todos.length} 件）**`, todoLines.join("\n") || "全部完成了，先生。",
    "", "📅 **未來 7 天行程**", agendaLines.join("\n") || "沒有排行程。",
    todos.length ? "\n按下面的按鈕即可完成該項待辦。" : null,
  ].filter((x) => x !== null).join("\n");
  const buttons = todos.slice(0, 20).map((x, i) => ({ type: 2, style: 2, custom_id: `done:${x.id}`, label: `✓ ${i + 1}. ${x.title}`.slice(0, 80) }));
  const components = [];
  for (let i = 0; i < buttons.length; i += 5) components.push({ type: 1, components: buttons.slice(i, i + 5) });
  return { embeds: [{ title: "待辦與行事曆", description: description.slice(0, 4000), color: GOLD,
    author: { name: KIND_NAME.arthur, icon_url: AVATAR.arthur }, footer: { text: "A.R.T.H.U.R." } }], components, flags: 64 };
}

async function todoDone(db: SupabaseClient, owner: string, id: string) {
  const data = await loadState(db, owner);
  const todos: Todo[] = Array.isArray(data.todos) ? data.todos : [];
  const x = todos.find((t) => t.id === id);
  if (!x) return "找不到這項待辦，可能已經在儀表板刪掉了。";
  if (x.done) return `「${x.title}」早就完成了。`;
  x.done = true; x.doneAt = new Date().toISOString(); x.u = Date.now();
  await saveState(db, owner, { ...data, todos });
  return `✅ 已完成「${x.title}」。`;
}

// ---------- 通知 ----------
async function getLink(db: SupabaseClient) {
  const { data: hub } = await db.from("arthur_hub").select("owner").limit(1).maybeSingle();
  if (!hub) return null;
  const { data } = await db.from("arthur_discord").select("*").eq("owner", hub.owner).maybeSingle();
  return data ?? { owner: hub.owner, guild_id: null, discord_user_id: null, allowed_users: [], channels: {} };
}
async function send(channelId: string, kind: string, e: { title: string; text?: string; url?: string; color?: number }) {
  const r = await bot(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ embeds: [{
    title: e.title.slice(0, 256), description: e.text?.slice(0, 4000), url: e.url, color: e.color ?? GOLD,
    author: { name: KIND_NAME[kind] ?? "A.R.T.H.U.R.", icon_url: AVATAR[kind] ?? AVATAR.arthur },
    footer: { text: "A.R.T.H.U.R." }, timestamp: new Date().toISOString(),
  }] }) });
  return { ok: r.ok, status: r.status };
}

// ---------- 財經日報影音版 ----------
// 經 GitHub API 讀 daily-report 分支（raw 網址有 5 分鐘快取，剛更新會讀到舊檔）
const DAILY_API = "https://api.github.com/repos/eastonesd/eastone.com/contents";
const dailyFile = (path: string) => fetch(`${DAILY_API}/${path}?ref=daily-report`, { headers: { Accept: "application/vnd.github.raw", "User-Agent": "arthur" } });
async function dailyVideo(db: SupabaseClient, force = false) {
  const link = await getLink(db);
  const ch = (link?.channels ?? {}).arthur;
  if (!ch) return { error: "還沒有指定 A.R.T.H.U.R. 通知頻道" };
  const m = await dailyFile("latest.json");
  if (!m.ok) return { error: `讀取 latest.json 失敗（${m.status}）` };
  const meta = await m.json();
  if (!meta.video) return { skip: `${meta.date} 沒有影音版` };
  if (!force && meta.date !== todayTaipei()) return { skip: `最新的是 ${meta.date}，不是今天` };
  const v = await dailyFile(meta.video);
  if (!v.ok) return { error: `下載影片失敗（${v.status}）` };
  const buf = await v.arrayBuffer();
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify({
    embeds: [{ title: `財經日報 ${meta.date.replaceAll("-", ".")}`, description: "15 秒影音版，可直接下載發到限時動態。", color: GOLD,
      author: { name: KIND_NAME.arthur, icon_url: AVATAR.arthur }, footer: { text: "A.R.T.H.U.R." } }],
    attachments: [{ id: 0, filename: meta.video }],
  }));
  fd.append("files[0]", new Blob([buf], { type: "video/mp4" }), meta.video);
  const r = await fetch(`${API}/channels/${ch}/messages`, { method: "POST", headers: { Authorization: `Bot ${BOT()}` }, body: fd });
  return { ok: r.ok, status: r.status, bytes: buf.byteLength, detail: r.ok ? "" : (await r.text()).slice(0, 300) };
}

// ---------- 設定：註冊指令＋自動對應頻道 ----------
async function setup(db: SupabaseClient) {
  if (!BOT() || !APP()) return { error: "缺少 DISCORD_BOT_TOKEN 或 DISCORD_APP_ID" };
  const guilds = await (await bot("/users/@me/guilds")).json();
  if (!Array.isArray(guilds) || !guilds.length) return { error: "機器人還沒加入任何伺服器", detail: guilds };
  const guild = guilds[0];
  const reg = await bot(`/applications/${APP()}/guilds/${guild.id}/commands`, { method: "PUT", body: JSON.stringify(COMMANDS) });
  const regText = reg.ok ? `${(await reg.json()).length} 個指令` : `失敗 ${reg.status} ${await reg.text()}`;
  const chans = await (await bot(`/guilds/${guild.id}/channels`)).json();
  const link = await getLink(db);
  if (!link) return { error: "找不到 A.R.T.H.U.R. 使用者" };
  const channels: Record<string, string> = { ...(link.channels ?? {}) };
  const RULES: [string, RegExp][] = [["saga", /saga|影音|短劇/i], ["ec", /(^|[^a-z])ec([^a-z]|$)|電商|蝦皮|shopee/i], ["dpf", /dpf|數位/i], ["arthur", /arthur|亞瑟|a-r-t-h-u-r/i]];
  const matched: Record<string, string> = {};
  for (const c of Array.isArray(chans) ? chans : []) {
    if (c.type !== 0) continue;
    for (const [k, re] of RULES) if (!channels[k] && !matched[k] && re.test(c.name)) { matched[k] = c.name; channels[k] = c.id; }
  }
  await db.from("arthur_discord").upsert({ owner: link.owner, guild_id: guild.id, discord_user_id: link.discord_user_id, allowed_users: link.allowed_users ?? [], channels, updated_at: new Date().toISOString() });
  const names = Object.fromEntries((Array.isArray(chans) ? chans : []).map((c: any) => [c.id, c.name]));
  return { ok: true, guild: guild.name, commands: regText, channels: Object.fromEntries(Object.entries(channels).map(([k, id]) => [k, names[id] ?? id])),
    all_text_channels: (Array.isArray(chans) ? chans : []).filter((c: any) => c.type === 0).map((c: any) => c.name) };
}

// ---------- 互動 ----------
// 先回「處理中」，做完再更新同一則訊息（Discord 只給 3 秒）
function deferred(body: any, kind: string, run: () => Promise<Result>) {
  const work = (async () => {
    let r: Result;
    try { r = await run(); } catch (e) { r = { ok: false, title: "出了點狀況", text: String(e).slice(0, 300) }; }
    await fetch(`${API}/webhooks/${APP()}/${body.token}/messages/@original`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [{ title: r.title, description: r.text, url: r.url, color: r.ok ? GOLD : RED,
        author: { name: KIND_NAME[kind], icon_url: AVATAR[kind] }, footer: { text: "A.R.T.H.U.R." } }] }) });
  })();
  // @ts-ignore EdgeRuntime 在 Supabase 執行環境中存在
  (globalThis as any).EdgeRuntime?.waitUntil?.(work);
  return json({ type: 5 });
}
const reply = (content: string, ephemeral = true) => json({ type: 4, data: { content, flags: ephemeral ? 64 : 0 } });

async function interaction(db: SupabaseClient, body: any) {
  if (body.type === 1) return json({ type: 1 });
  const uid = body.member?.user?.id ?? body.user?.id;
  const link = await getLink(db);
  if (!link) return reply("A.R.T.H.U.R. 尚未設定。");
  // 第一位使用者綁定為主人；其他人要由已授權的人用 /allow 加入
  const allowed = new Set<string>([link.discord_user_id, ...(link.allowed_users ?? [])].filter(Boolean));
  const save = (patch: Record<string, unknown>) => db.from("arthur_discord").upsert({ owner: link.owner, guild_id: body.guild_id ?? link.guild_id,
    discord_user_id: link.discord_user_id, allowed_users: link.allowed_users ?? [], channels: link.channels ?? {}, ...patch, updated_at: new Date().toISOString() });
  if (!link.discord_user_id) {
    link.discord_user_id = uid;
    await save({ discord_user_id: uid });
  } else if (!allowed.has(uid)) return reply("抱歉，您還沒有使用權限。請葉里克先生用 /allow 把您加進來。");

  if (body.type === 2) {
    const name = body.data?.name;
    if (name in FORMS) return json(modal(name));
    if (name === "saga-ref") {
      const opts: Record<string, string> = Object.fromEntries((body.data.options ?? []).map((o: any) => [o.name, String(o.value ?? "")]));
      const att = body.data.resolved?.attachments?.[opts.video];
      const u = body.member?.user ?? body.user ?? {};
      const who = u.global_name || u.username || "Discord";
      return deferred(body, "saga", () => sagaRef(db, opts, att, who));
    }
    if (name === "saga-stats") {
      const opts: Record<string, string> = Object.fromEntries((body.data.options ?? []).map((o: any) => [o.name, String(o.value ?? "")]));
      const u = body.member?.user ?? body.user ?? {};
      return deferred(body, "saga", () => sagaStats(opts, u.global_name || u.username || "Discord"));
    }
    if (name === "allow" || name === "deny") {
      const target = String(body.data.options?.[0]?.value ?? "");
      if (!target) return reply("請選擇一個人。");
      if (name === "deny" && target === link.discord_user_id) return reply("主人不能被移除。");
      const list = new Set<string>(link.allowed_users ?? []);
      if (name === "allow") list.add(target); else list.delete(target);
      await save({ allowed_users: [...list] });
      return reply(name === "allow" ? `好的，<@${target}> 現在可以使用 A.R.T.H.U.R. 的所有指令了。` : `好的，<@${target}> 不再能使用 A.R.T.H.U.R. 的指令。`, false);
    }
    if (name === "channel") {
      const kind = body.data.options?.[0]?.value;
      const channels = { ...(link.channels ?? {}), [kind]: body.channel_id };
      await save({ channels });
      return reply(`好的，${KIND_NAME[kind]} 的通知之後都送到這個頻道。`);
    }
    if (name === "todos") {
      try { return json({ type: 4, data: await todosView(db, link.owner) }); }
      catch (e) { return reply(`讀取失敗：${String(e).slice(0, 200)}`); }
    }
    if (name === "status") {
      const { data: hub } = await db.from("arthur_hub").select("status, scanned_at").eq("owner", link.owner).maybeSingle();
      const items = Object.values((hub?.status ?? {}) as Record<string, any>);
      const H: Record<string, string> = { ok: "🟡 正常", running: "🔵 執行中", fail: "🔴 需要處理", unknown: "⚪ 無法讀取" };
      const lines = items.map((x) => `${H[x.health] ?? H.unknown}　**${x.name}**${x.headline ? `　${x.headline}` : ""}`);
      return json({ type: 4, data: { embeds: [{ title: "專案狀態", description: lines.join("\n") || "尚無資料", color: GOLD,
        footer: { text: hub?.scanned_at ? `檢查於 ${new Date(hub.scanned_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` : "尚未檢查" } }] } });
    }
    return reply("不認得這個指令。");
  }

  // 按鈕：/todos 畫面上的「✓ 完成」→ 原地更新畫面
  if (body.type === 3) {
    const cid = String(body.data?.custom_id ?? "");
    if (cid.startsWith("done:")) {
      try {
        const note = await todoDone(db, link.owner, cid.slice(5));
        return json({ type: 7, data: await todosView(db, link.owner, note) });
      } catch (e) { return reply(`更新失敗：${String(e).slice(0, 200)}`); }
    }
    return json({ type: 6 });
  }

  if (body.type === 5) {
    const kind = String(body.data?.custom_id ?? "").replace(/^form:/, "");
    if (!(kind in FORMS)) return reply("表單已過期。");
    const d: Record<string, string> = {};
    for (const row of body.data.components ?? []) for (const c of row.components ?? []) d[c.custom_id] = String(c.value ?? "");
    if (kind === "todo") return deferred(body, "arthur", () => todoAdd(db, link.owner, d));
    if (kind === "agenda") return deferred(body, "arthur", () => agendaAdd(db, link.owner, d));
    return deferred(body, kind, () => kind === "saga" ? sagaCreate(d) : kind === "ec" ? ecEnqueue(d) : dpfEnqueue(db, link.owner, d));
  }
  return json({ type: 1 });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const db = adminClient();
  const cron = req.headers.get("x-cron-token");
  if (cron !== null) {
    const { data: allowed } = await db.rpc("check_reminder_token", { t: cron });
    if (!allowed) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.task === "setup") return json(await setup(db));
    if (body.task === "daily-video") return json(await dailyVideo(db, body.force === true));
    if (body.task === "test") {
      const link = await getLink(db);
      const out: Record<string, unknown> = {};
      for (const [k, id] of Object.entries((link?.channels ?? {}) as Record<string, string>))
        out[k] = await send(id, k, { title: `${KIND_NAME[k]} 通知頻道已連線`, text: k === "arthur" ? "先生，A.R.T.H.U.R. 已就位。其他專案的狀況與總覽會送到這裡。" : `之後 ${KIND_NAME[k]} 的進度、成果與異常都會送到這裡。輸入 /${k} 可以開表單開工。` });
      return json(out);
    }
    if (body.task === "line-menu-off") {
      // 工作入口搬到 Discord：撤掉 LINE 預設圖文選單並刪除 arthur-studio 選單（LINE 金鑰是專案共用的 secret）
      const LT = Deno.env.get("JARVIS_LINE_CHANNEL_ACCESS_TOKEN") ?? "";
      if (!LT) return json({ error: "沒有 LINE 金鑰" });
      const H = { Authorization: `Bearer ${LT}` };
      const off = await fetch("https://api.line.me/v2/bot/user/all/richmenu", { method: "DELETE", headers: H });
      const list = await (await fetch("https://api.line.me/v2/bot/richmenu/list", { headers: H })).json().catch(() => ({ richmenus: [] }));
      const removed = [];
      for (const m of list.richmenus ?? []) if (m.name === "arthur-studio") {
        const r = await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE", headers: H });
        removed.push({ id: m.richMenuId, ok: r.ok });
      }
      return json({ default_off: off.status, removed });
    }
    return json({ error: "unknown task" }, 400);
  }
  const raw = await req.text();
  if (!(await verify(raw, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp")))) return new Response("bad signature", { status: 401 });
  return await interaction(db, JSON.parse(raw));
});
