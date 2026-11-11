// ============================================================
// A.R.T.H.U.R. Discord（arthur-discord）
// 網址：https://<project>.supabase.co/functions/v1/arthur-discord
//
// 1. Discord Interactions endpoint（帶 X-Signature-Ed25519）：
//    /saga  開表單 → 東石影音開拍新劇（eastone.saga 開「新劇」Issue）
//    /ec    開表單 → 東石電商加入 queue.yaml，機器人接著發文到 Threads
//    /dpf   開表單 → 東石數位收件匣，電腦上的 DPF 領取後產生企劃
//    /saga-ref 丟一段標竿短劇片段 → eastone.saga 開「標竿」Issue，自動分析（規格見 eastone.saga 的 ARTHUR-DISCORD.md）
//    /channel 把目前頻道設為某個專案的通知頻道
//    /status  專案狀態
//    /allow、/deny  讓伺服器裡的某個人可以（或不再可以）使用這些指令
// 2. 排程／管理（x-cron-token）：
//    {task:"setup"}  註冊指令到伺服器、依頻道名稱自動對應通知頻道
//    {task:"test"}   每個通知頻道各發一則測試訊息
//    {task:"line-menu-off"}  撤掉 LINE 的 SAGA／EC／DPF 圖文選單（工作改到 Discord）
//
// Secrets：DISCORD_BOT_TOKEN、ARTHUR_GITHUB_TOKEN（DISCORD_PUBLIC_KEY、DISCORD_APP_ID 有預設值，可覆寫）
// verify_jwt 關閉：改用 Discord 簽章與 cron token 驗證。
// 第一位使用指令的人自動成為主人；主人（或已授權的人）用 /allow 把其他人加進來。
// ============================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

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

async function sagaRef(opts: Record<string, string>, attachment: any, who: string): Promise<Result> {
  const token = Deno.env.get("ARTHUR_GITHUB_TOKEN");
  if (!token) return { ok: false, title: "無法送出", text: "還沒設定 GitHub 金鑰（ARTHUR_GITHUB_TOKEN）。" };
  const likes = (opts.likes ?? "").trim(), source = (opts.source ?? "").trim();
  const url = String(attachment?.url ?? "");
  if (!/^https:\/\//.test(url)) return { ok: false, title: "無法送出", text: "沒有收到影片附件。" };
  if (attachment?.content_type && !String(attachment.content_type).startsWith("video/"))
    return { ok: false, title: "無法送出", text: `這不是影片檔（${attachment.content_type}）。` };
  const res = await fetch(`https://api.github.com/repos/${SAGA_REPO}/issues`, { method: "POST", headers: ghHeaders(token), body: JSON.stringify({
    title: "標竿：" + likes.slice(0, 24), labels: ["標竿"],
    body: `### 影片\n\n${url}\n\n### 喜歡哪裡\n\n${likes}\n\n### 出處\n\n${source || "_No response_"}\n\n由 A.R.T.H.U.R. 從 Discord 送出（${who}）`,
  }) });
  if (!res.ok) return { ok: false, title: "無法送出", text: `GitHub 回應 ${res.status}，請確認金鑰對 eastone.saga 有 Issues 寫入權限。` };
  const j = await res.json();
  return { ok: true, title: `標竿 #${j.number} 已送出分析`, url: j.html_url,
    text: `「${likes.slice(0, 200)}」${source ? `\n出處：${source}` : ""}\n幾分鐘後分析完成，結果會貼在這個頻道。` };
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
      return deferred(body, "saga", () => sagaRef(opts, att, who));
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

  if (body.type === 5) {
    const kind = String(body.data?.custom_id ?? "").replace(/^form:/, "");
    if (!(kind in FORMS)) return reply("表單已過期。");
    const d: Record<string, string> = {};
    for (const row of body.data.components ?? []) for (const c of row.components ?? []) d[c.custom_id] = String(c.value ?? "");
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
