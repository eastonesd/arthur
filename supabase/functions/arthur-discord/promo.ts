// ============================================================
// /ec 帶貨片流程（東石電商 × 東石影音）
//   1. /ec 連結＋商品頁截圖＋商品圖 → 附件轉存 Supabase Storage（公開 bucket promo）
//   2. Claude 讀截圖寫「商品資料卡＋腳本＋貼文」→ 規格寫進 eastone.saga promo/<slug>/spec.json（push 觸發剪片）
//   3. 每分鐘 promoTick：影片做好 → 預覽送到頻道，附「核准發布／退回重寫」
//   4. 核准 → 發布包寫進 eastone.ecommerce promo/<slug>.json（含發布時段），東石電商依時段發到 Threads
// 規則：只寫截圖上看得到的事實；不寫醫療效果、100%、最、價格承諾；不捏造使用心得。
// ============================================================
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

const API = "https://discord.com/api/v10";
const GOLD = 0xf5b43a, RED = 0xff7a7a;
const AV = "https://eastonesd.github.io/arthur/assets/projects/ec.png";
const SAGA = "eastonesd/eastone.saga", EC = "eastonesd/eastone.ecommerce";
const BOT = () => Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const GH = () => Deno.env.get("ARTHUR_GITHUB_TOKEN") ?? "";
const MODEL = () => Deno.env.get("PROMO_MODEL") || "claude-sonnet-5-5";
const SLOTS = [[12, 30], [20, 30]];            // 發布時段（台北），一個時段最多一篇
export type Result = { ok: boolean; title: string; text: string; url?: string };

const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/${path}`, {
  ...init, headers: { Authorization: `Bearer ${GH()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "arthur" },
});
const b64 = (s: string) => { let bin = ""; for (const x of new TextEncoder().encode(s)) bin += String.fromCharCode(x); return btoa(bin); };
async function putFile(repo: string, path: string, content: string, message: string) {
  const cur = await gh(`repos/${repo}/contents/${path}`);
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const r = await gh(`repos/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify({
    message, content: b64(content), ...(sha ? { sha } : {}), committer: { name: "A.R.T.H.U.R.", email: "arthur@users.noreply.github.com" } }) });
  if (!r.ok) throw new Error(`寫入 ${repo}/${path} 失敗（GitHub ${r.status}）`);
}
const bot = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bot ${BOT()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
async function say(ch: string, title: string, text: string, color = GOLD) {
  await bot(`/channels/${ch}/messages`, { method: "POST", body: JSON.stringify({ embeds: [{ title, description: text.slice(0, 4000), color,
    author: { name: "東石電商", icon_url: AV }, footer: { text: "A.R.T.H.U.R." } }] }) });
}
const taipei = (d: Date) => new Date(d.getTime() + 8 * 3600_000);
const when = (iso: string) => { const t = taipei(new Date(iso)); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（週${"日一二三四五六"[t.getUTCDay()]}）${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`; };

// ---------- 1. 收件 ----------
export async function promoStart(db: SupabaseClient, opts: Record<string, string>, resolved: Record<string, any>, ch: string, who: string): Promise<Result> {
  const link = (opts.link ?? "").trim();
  if (!/^https:\/\/(s\.)?shopee\.tw\//.test(link)) return { ok: false, title: "無法建立", text: "連結要是蝦皮網址（https://s.shopee.tw/… 或 https://shopee.tw/…）。" };
  if (!GH()) return { ok: false, title: "無法建立", text: "還沒設定 GitHub 金鑰（ARTHUR_GITHUB_TOKEN）。" };
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return { ok: false, title: "無法建立", text: "還沒設定 ANTHROPIC_API_KEY。" };
  const t = taipei(new Date());
  const slug = `p${t.toISOString().slice(2, 10).replaceAll("-", "")}${crypto.randomUUID().slice(0, 4)}`;
  const keep = async (key: string, name: string) => {
    const a = resolved?.[opts[key]];
    if (!a) return null;
    if (a.content_type && !String(a.content_type).startsWith("image/")) throw new Error(`「${name}」不是圖片檔`);
    const r = await fetch(a.url);
    if (!r.ok) throw new Error(`下載「${name}」失敗`);
    const ext = (String(a.filename).match(/\.(png|jpe?g|webp)$/i)?.[1] ?? "jpg").toLowerCase();
    const path = `${slug}/${key}.${ext}`;
    const up = await db.storage.from("promo").upload(path, new Uint8Array(await r.arrayBuffer()), { contentType: a.content_type || "image/jpeg", upsert: true });
    if (up.error) throw new Error(`轉存「${name}」失敗：${up.error.message}`);
    return db.storage.from("promo").getPublicUrl(path).data.publicUrl;
  };
  const pages = (await Promise.all(["page1", "page2", "page3"].map((k, i) => keep(k, `商品頁截圖 ${i + 1}`)))).filter(Boolean) as string[];
  const imgs = (await Promise.all(["img1", "img2", "img3", "img4", "img5"].map((k, i) => keep(k, `商品圖 ${i + 1}`)))).filter(Boolean) as string[];
  if (!pages.length || !imgs.length) return { ok: false, title: "無法建立", text: "至少要 1 張商品頁截圖和 1 張商品圖。" };
  const { data: row, error } = await db.from("arthur_promo").insert({ slug, link, note: opts.note ?? "", page_urls: pages, img_urls: imgs, channel_id: ch, who, status: "writing" }).select().single();
  if (error) return { ok: false, title: "無法建立", text: error.message };
  return await write(db, row);
}

// ---------- 2. 寫稿（Claude 讀截圖）＋送剪片 ----------
const RULES = `你是東石電商的帶貨短片企劃，替 Threads 帳號寫商品短片與貼文。繁體中文、台灣用語。
硬性規則：
1. 只使用商品頁截圖上「看得到」的資訊。看不到的一律寫進 unknown，不得自行補寫、推測或美化。
2. 不得寫醫療或療效宣稱（助眠、治療、改善失眠、消除疲勞、瘦身…），不得寫「100%」「最」「第一」「保證」「限時」。
3. 不寫具體價格、折扣、優惠券（會變動）；銷量只寫「熱銷」，除非補充說明要求寫數字。
4. 不得用第一人稱捏造使用經驗（例如「我用了以後…」），用商品介紹的口吻。
5. 一支片只講一個客群、一個核心賣點、一個行動呼籲；行動呼籲固定是「連結放在留言」。
6. 腳本 4 幕＋結尾 1 幕，旁白合計約 55～65 個字（15 秒內念完）；每幕 head 不超過 12 字（可用「｜」換行），say 不超過 24 字（可用「｜」換行）。
7. 商品圖編號從 1 開始；每幕挑最能呈現該句的圖，含有贈品、價格、促銷文字的圖片盡量不要用。
只輸出一個 JSON 物件，不要其他文字：
{"facts":{"name":"","shop":"","rating":"","sold":"","spec":[""],"selling_points":[{"point":"","source":"截圖上的原句"}],"cautions":[""],"unknown":[""],"risky_claims":[""]},
 "brief":{"audience":"","need":"","point":"","angle":""},
 "keyword":"商品分類（2～4 字）",
 "scenes":[{"img":1,"head":"","say":""},{"img":2,"head":"","say":""},{"img":3,"head":"","say":""},{"img":4,"head":"","say":""},{"img":1,"head":"連結放在留言","say":"連結放在留言。","end":true}],
 "post":"Threads 主文（80～160 字，不放網址，結尾一個問句引導留言，最後一行 2～3 個 hashtag）",
 "check":["自我檢查：列出你刻意避開的宣稱或需要人工確認的地方"]}`;

async function claude(row: any, extra = "") {
  const content: any[] = [
    ...row.page_urls.map((u: string) => ({ type: "image", source: { type: "url", url: u } })),
    { type: "text", text: `以上是商品頁截圖。商品圖共有 ${row.img_urls.length} 張（依序編號 1～${row.img_urls.length}），如下：` },
    ...row.img_urls.map((u: string) => ({ type: "image", source: { type: "url", url: u } })),
    { type: "text", text: `分潤連結：${row.link}\n補充說明：${row.note || "（無）"}${row.feedback ? `\n上一版被退回，修改意見：${row.feedback}\n上一版：${JSON.stringify(row.pkg?.scenes ?? [])}／${row.pkg?.post ?? ""}` : ""}` },
  ];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(110_000),
    headers: { "content-type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL(), max_tokens: 8000, system: extra ? `${RULES}\n\n補充規則（優先於上面的規則，但補充說明欄另有要求時以補充說明為準）：\n${extra}` : RULES, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`Claude 回應 ${r.status}：${(await r.text()).slice(0, 200)}`);
  const res = await r.json();
  const raw = (res.content ?? []).map((c: any) => c.text ?? "").join("");
  if (res.stop_reason === "max_tokens") throw new Error("Claude 的回覆太長被截斷了");
  let j: any;
  try { j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); }
  catch { throw new Error(`Claude 沒有回傳可讀的 JSON（${res.stop_reason}）：${raw.slice(0, 300)}`); }
  if (!Array.isArray(j.scenes) || j.scenes.length < 3 || !j.post) throw new Error("Claude 回傳格式不完整");
  return j;
}

async function write(db: SupabaseClient, row: any): Promise<Result> {
  try {
    // 可隨時調整的寫作規則放在資料表 arthur_settings（key = promo_rules），改規則不必重新部署
    const { data: st } = await db.from("arthur_settings").select("value").eq("key", "promo_rules").maybeSingle();
    const extra = String(st?.value ?? "");
    let pkg: any;
    try { pkg = await claude(row, extra); }
    catch (e) { console.error("promo claude 第一次失敗", String(e)); pkg = await claude(row, extra); }   // 偶發失敗重試一次
    const n = row.img_urls.length;
    const spec = {
      name: pkg.facts?.name || "商品", source: row.link, voice: "zh-TW-HsiaoChenNeural", rate: "+15%",
      scenes: pkg.scenes.slice(0, 6).map((s: any, i: number, all: any[]) => ({
        img: row.img_urls[Math.min(Math.max(Number(s.img) || 1, 1), n) - 1], head: String(s.head ?? "").slice(0, 30), say: String(s.say ?? "").slice(0, 60),
        ...(i === all.length - 1 ? { end: true, min: 1.7 } : i === 0 ? { min: 2.0 } : {}),
      })),
    };
    await db.from("arthur_promo").update({ pkg, status: "rendering", updated_at: new Date().toISOString() }).eq("id", row.id);
    await putFile(SAGA, `promo/${row.slug}/spec.json`, JSON.stringify(spec, null, 2) + "\n", `帶貨片：${spec.name.slice(0, 30)}（${row.slug}）`);
    return { ok: true, title: `收到：${String(spec.name).slice(0, 60)}`,
      text: `腳本與貼文寫好了，東石影音正在剪片，約 3～5 分鐘後把預覽送到這裡給您核准。\n代號：${row.slug}` };
  } catch (e) {
    await db.from("arthur_promo").update({ status: "failed", error: String(e).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, title: "寫稿失敗", text: String(e).slice(0, 500) };
  }
}

// ---------- 3. 影片做好 → 預覽 ----------
export async function promoTick(db: SupabaseClient) {
  const { data: rows } = await db.from("arthur_promo").select("*").eq("status", "rendering");
  const out = [];
  for (const row of rows ?? []) {
    const rel = await gh(`repos/${SAGA}/releases/tags/promo-${row.slug}`);
    const asset = rel.ok ? ((await rel.json()).assets ?? []).find((a: any) => a.name === `${row.slug}.mp4`) : null;
    if (!asset || Date.parse(asset.updated_at) < Date.parse(row.updated_at)) {
      if (Date.now() - Date.parse(row.updated_at) > 20 * 60_000) {
        await db.from("arthur_promo").update({ status: "failed", error: "剪片逾時" }).eq("id", row.id);
        await say(row.channel_id, "剪片逾時", `${row.slug}：等了 20 分鐘影片還沒做好，可能是東石影音的流程失敗了。`, RED);
      }
      continue;
    }
    const v = await fetch(asset.browser_download_url);
    if (!v.ok) continue;
    const p = row.pkg ?? {}, f = p.facts ?? {};
    const facts = [
      `**商品：**${f.name ?? ""}`, f.selling_points?.length ? `**賣點：**${f.selling_points.map((x: any) => x.point).join("、")}` : "",
      `**客群／角度：**${p.brief?.audience ?? ""}／${p.brief?.point ?? ""}`,
      f.unknown?.length ? `**截圖上沒有：**${f.unknown.join("、")}` : "", p.check?.length ? `**避開：**${p.check.join("；")}` : "",
    ].filter(Boolean).join("\n");
    const fd = new FormData();
    fd.append("payload_json", JSON.stringify({
      embeds: [{ title: `帶貨片預覽：${String(f.name ?? row.slug).slice(0, 80)}`, color: GOLD, author: { name: "東石電商", icon_url: AV }, footer: { text: `A.R.T.H.U.R.・${row.slug}` },
        description: `${facts}\n\n**Threads 主文：**\n${p.post}\n\n**留言：**${row.link}`.slice(0, 4000) }],
      components: [{ type: 1, components: [
        { type: 2, style: 3, label: "核准發布", custom_id: `promo-ok:${row.id}` },
        { type: 2, style: 4, label: "退回重寫", custom_id: `promo-no:${row.id}` }] }],
      attachments: [{ id: 0, filename: `${row.slug}.mp4` }],
    }));
    fd.append("files[0]", new Blob([await v.arrayBuffer()], { type: "video/mp4" }), `${row.slug}.mp4`);
    const r = await fetch(`${API}/channels/${row.channel_id}/messages`, { method: "POST", headers: { Authorization: `Bot ${BOT()}` }, body: fd });
    await db.from("arthur_promo").update({ status: r.ok ? "review" : "rendering", video_url: asset.browser_download_url, updated_at: r.ok ? new Date().toISOString() : row.updated_at }).eq("id", row.id);
    out.push({ slug: row.slug, sent: r.ok });
  }
  return out;
}

// ---------- 4. 核准／退回 ----------
async function nextSlot(db: SupabaseClient) {
  const { data } = await db.from("arthur_promo").select("post_at").in("status", ["approved", "posted"]).gte("post_at", new Date().toISOString());
  const taken = new Set((data ?? []).map((r) => Date.parse(r.post_at)));
  const now = Date.now() + 10 * 60_000;
  const t0 = taipei(new Date());
  for (let d = 0; d < 60; d++) for (const [h, m] of SLOTS) {
    const at = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate() + d, h, m) - 8 * 3600_000;
    if (at > now && !taken.has(at)) return new Date(at).toISOString();
  }
  throw new Error("排不到時段");
}

export async function promoApprove(db: SupabaseClient, id: string, who: string) {
  const { data: row } = await db.from("arthur_promo").select("*").eq("id", id).maybeSingle();
  if (!row) return { text: "找不到這個帶貨片。", done: true };
  if (row.status !== "review") return { text: `這支已經是「${row.status === "approved" ? "已核准" : row.status}」狀態了。`, done: true };
  const post_at = await nextSlot(db);
  const p = row.pkg ?? {};
  const pkg = {
    slug: row.slug, account: "ambition._6268", name: p.facts?.name ?? row.slug, keyword: p.keyword || "帶貨片", price: 0,
    link: row.link, video_url: row.video_url, text: p.post, reply: row.link,
    post_at, approved_by: `${who}（Discord 核准）`, approved_at: new Date().toISOString(),
  };
  await putFile(EC, `promo/${row.slug}.json`, JSON.stringify(pkg, null, 2) + "\n", `帶貨片發布包：${String(pkg.name).slice(0, 30)}（${when(post_at)} 發布）`);
  await db.from("arthur_promo").update({ status: "approved", post_at, updated_at: new Date().toISOString() }).eq("id", id);
  return { text: `✅ 已核准，排在 **${when(post_at)}** 發到 @ambition._6268。`, done: true };
}

export function promoRejectModal(id: string) {
  return { type: 9, data: { custom_id: `promo-fix:${id}`, title: "退回重寫：要改哪裡？", components: [{ type: 1, components: [{
    type: 4, custom_id: "fb", label: "修改意見", style: 2, required: true, max_length: 1000, placeholder: "例：開場換成通勤族、不要提頭帶、語氣再活潑一點" }] }] } };
}

export async function promoRewrite(db: SupabaseClient, id: string, feedback: string): Promise<Result> {
  const { data: row } = await db.from("arthur_promo").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, title: "找不到", text: "找不到這個帶貨片。" };
  if (!["review", "failed"].includes(row.status)) return { ok: false, title: "無法重寫", text: `目前狀態是「${row.status}」。` };
  const upd = { ...row, feedback, status: "writing" };
  await db.from("arthur_promo").update({ feedback, status: "writing", updated_at: new Date().toISOString() }).eq("id", id);
  return await write(db, upd);
}

// 管理用：重跑寫稿（cron token 呼叫 {task:"promo-retry", slug}）
export async function promoRetry(db: SupabaseClient, slug: string) {
  const { data: row } = await db.from("arthur_promo").select("*").eq("slug", slug).maybeSingle();
  if (!row) return { error: "找不到" };
  await db.from("arthur_promo").update({ status: "writing", error: null, updated_at: new Date().toISOString() }).eq("id", row.id);
  const r = await write(db, row);
  if (row.channel_id) await say(row.channel_id, r.title, r.text, r.ok ? GOLD : RED);
  return r;
}
