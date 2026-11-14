// ============================================================
// A.R.T.H.U.R. Discord（arthur-discord）
// 網址：https://<project>.supabase.co/functions/v1/arthur-discord
//
// 1. Discord Interactions endpoint（帶 X-Signature-Ed25519）：
//    /saga  開表單 → 東石影音開拍新劇（eastone.saga 開「新劇」Issue）
//    /ec    蝦皮連結＋商品頁截圖＋商品圖 → 帶貨片（腳本、影片、貼文）→ 頻道預覽核准 → 排程發到 Threads（見 promo.ts）
//    /dpf   開表單 → 東石數位收件匣，電腦上的 DPF 領取後產生企劃
//    /saga-ref 丟一段標竿短劇片段 → eastone.saga 開「標竿」Issue，自動分析（規格見 eastone.saga 的 ARTHUR-DISCORD.md）
//    /saga-stats 手動回報 TikTok 粉絲／上月有效觀看 → 寫入 eastone.saga 的 stats/manual.json
//    /todo   開表單 → 新增待辦到 A.R.T.H.U.R.（jarvis_state.todos，儀表板與 LINE 21:00 待辦追蹤都看得到）
//    /agenda 開表單 → 新增行程到 A.R.T.H.U.R. 行事曆（jarvis_state.agenda，早安簡報與 LINE 行程前一小時提醒都會用到）
//    /todos  查看未完成待辦與未來 7 天行程，按按鈕即可完成待辦
//    /market 立刻產生最新財經日報截圖：觸發 eastone.com 的截圖流程，完成後由 market-deliver 送到頻道
//    /channel 把目前頻道設為某個專案的通知頻道
//    /status  專案狀態
//    /allow、/deny  讓伺服器裡的某個人可以（或不再可以）使用這些指令
// 2. 排程／管理（x-cron-token）：
//    {task:"setup"}  註冊指令到伺服器、依頻道名稱自動對應通知頻道
//    {task:"test"}   每個通知頻道各發一則測試訊息
//    {task:"line-menu-off"}  撤掉 LINE 的 SAGA／EC／DPF 圖文選單（工作改到 Discord）
//    {task:"ig-story"}       週一到週五 09:00（09:30 補發，帶 last:true，仍失敗就通知）把今天的財經日報截圖發到 Instagram 主帳號限時動態
//                            需要 Secret IG_MAIN_TOKEN；同一天只發一次（arthur_ig_story）；可帶 username 指定帳號、force:true 重發
//    {task:"market-deliver"} 每分鐘由排程呼叫：/market 的請求在新截圖完成後送出（arthur_market_requests）
//
// 模組：shared.ts 共用工具與通知｜work.ts 影音與數位｜todo.ts 待辦行事曆｜daily.ts 財經日報與 IG｜promo.ts 帶貨片｜when.ts 日期解析
// Secrets：DISCORD_BOT_TOKEN、ARTHUR_GITHUB_TOKEN（DISCORD_PUBLIC_KEY、DISCORD_APP_ID 有預設值，可覆寫）
// verify_jwt 關閉：改用 Discord 簽章與 cron token 驗證。
// 第一位使用指令的人自動成為主人；主人（或已授權的人）用 /allow 把其他人加進來。
// ============================================================
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { adminClient, API, APP, AVATAR, bot, BOT, getLink, GOLD, json, KIND_NAME, PUB, RED, type Result, send } from "./shared.ts";
import { dpfEnqueue, sagaCreate, sagaRef, sagaStats } from "./work.ts";
import { agendaAdd, todoAdd, todoDone, todosView } from "./todo.ts";
import { igStory, marketDeliver, marketRequest } from "./daily.ts";
import { promoApprove, promoRejectModal, promoRetry, promoRewrite, promoStart, promoTick } from "./promo.ts";

// ---------- Discord 簽章 ----------
const hex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
async function verify(raw: string, sig: string | null, ts: string | null) {
  if (!sig || !ts || !PUB()) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(PUB()), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + raw));
  } catch { return false; }
}

// ---------- 指令與表單 ----------
const PROJECT_CHOICES = [
  { name: "東石影音（SAGA）", value: "saga" }, { name: "東石電商（EC）", value: "ec" },
  { name: "東石數位（DPF）", value: "dpf" }, { name: "A.R.T.H.U.R.（其他專案與總覽）", value: "arthur" },
];
const COMMANDS = [
  { name: "saga", description: "東石影音：開拍一部新短劇" },
  { name: "ec", description: "東石電商：做一支帶貨短片並排程發到 Threads",
    options: [
      { type: 3, name: "link", name_localizations: { "zh-TW": "分潤連結" }, description: "蝦皮分潤連結（s.shopee.tw 開頭）", required: true, max_length: 300 },
      { type: 11, name: "page1", name_localizations: { "zh-TW": "商品頁截圖1" }, description: "名稱、價格、評分、已售那一段", required: true },
      { type: 11, name: "img1", name_localizations: { "zh-TW": "商品圖1" }, description: "商品圖（在蝦皮 App 長按存下來）", required: true },
      { type: 11, name: "page2", name_localizations: { "zh-TW": "商品頁截圖2" }, description: "商品說明那一段", required: false },
      { type: 11, name: "page3", name_localizations: { "zh-TW": "商品頁截圖3" }, description: "其他規格", required: false },
      { type: 11, name: "img2", name_localizations: { "zh-TW": "商品圖2" }, description: "商品圖", required: false },
      { type: 11, name: "img3", name_localizations: { "zh-TW": "商品圖3" }, description: "商品圖", required: false },
      { type: 11, name: "img4", name_localizations: { "zh-TW": "商品圖4" }, description: "商品圖", required: false },
      { type: 11, name: "img5", name_localizations: { "zh-TW": "商品圖5" }, description: "商品圖", required: false },
      { type: 3, name: "note", name_localizations: { "zh-TW": "補充" }, description: "例：主打午休族、可以寫銷量", required: false, max_length: 500 },
    ] },
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
  { name: "market", name_localizations: { "zh-TW": "財經日報" }, description: "A.R.T.H.U.R.：立刻產生最新財經日報截圖" },
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
    if (name === "ec") {
      const opts: Record<string, string> = Object.fromEntries((body.data.options ?? []).map((o: any) => [o.name, String(o.value ?? "")]));
      const u = body.member?.user ?? body.user ?? {};
      return deferred(body, "ec", () => promoStart(db, opts, body.data.resolved?.attachments ?? {}, body.channel_id, u.global_name || u.username || "Discord"));
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
    if (name === "market") {
      const u = body.member?.user ?? body.user ?? {};
      return json({ type: 4, data: { content: await marketRequest(db, "image", body.channel_id, u.global_name || u.username || "Discord") } });
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
    if (cid.startsWith("promo-no:")) return json(promoRejectModal(cid.slice(9)));
    if (cid.startsWith("promo-ok:")) {
      const u = body.member?.user ?? body.user ?? {};
      const work = (async () => {
        let text: string;
        try { text = (await promoApprove(db, cid.slice(9), u.global_name || u.username || "Discord")).text; }
        catch (e) { text = `核准失敗：${String(e).slice(0, 300)}`; }
        await fetch(`${API}/webhooks/${APP()}/${body.token}/messages/@original`, { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, components: [] }) });
      })();
      (globalThis as any).EdgeRuntime?.waitUntil?.(work);
      return json({ type: 6 });
    }
    if (cid.startsWith("done:")) {
      try {
        const note = await todoDone(db, link.owner, cid.slice(5));
        return json({ type: 7, data: await todosView(db, link.owner, note) });
      } catch (e) { return reply(`更新失敗：${String(e).slice(0, 200)}`); }
    }
    return json({ type: 6 });
  }

  if (body.type === 5) {
    const fid = String(body.data?.custom_id ?? "");
    if (fid.startsWith("promo-fix:")) {
      const fb = String(body.data.components?.[0]?.components?.[0]?.value ?? "");
      return deferred(body, "ec", () => promoRewrite(db, fid.slice(10), fb));
    }
    const kind = fid.replace(/^form:/, "");
    if (!(kind in FORMS)) return reply("表單已過期。");
    const d: Record<string, string> = {};
    for (const row of body.data.components ?? []) for (const c of row.components ?? []) d[c.custom_id] = String(c.value ?? "");
    if (kind === "todo") return deferred(body, "arthur", () => todoAdd(db, link.owner, d));
    if (kind === "agenda") return deferred(body, "arthur", () => agendaAdd(db, link.owner, d));
    return deferred(body, kind, () => kind === "saga" ? sagaCreate(d) : dpfEnqueue(db, link.owner, d));
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
    if (body.task === "ig-story") return json(await igStory(db, { force: body.force === true, last: body.last === true, username: body.username }));
    if (body.task === "promo-retry") return json(await promoRetry(db, String(body.slug ?? "")));
    if (body.task === "market-deliver") return json({ market: await marketDeliver(db), promo: await promoTick(db) });
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
