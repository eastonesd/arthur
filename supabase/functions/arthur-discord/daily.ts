// 財經日報：/market 即時截圖、Instagram 限時動態
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { API, AVATAR, BOT, getLink, ghHeaders, GOLD, KIND_NAME, RED, send } from "./shared.ts";
import { todayTaipei } from "./when.ts";

// ---------- 財經日報截圖 ----------
// 經 GitHub API 讀 daily-report 分支（raw 網址有 5 分鐘快取，剛更新會讀到舊檔）
export const DAILY_API = "https://api.github.com/repos/eastonesd/eastone.com/contents";
export const dailyFile = (path: string) => fetch(`${DAILY_API}/${path}?ref=daily-report`, { headers: { Accept: "application/vnd.github.raw", "User-Agent": "arthur" } });
// 把 daily-report 上的日報截圖傳到頻道
export async function postDaily(ch: string, meta: any, note: string) {
  const file = meta.image;
  if (!file) return { ok: false, detail: "這次沒有產生截圖" };
  const v = await dailyFile(file);
  if (!v.ok) return { ok: false, detail: `下載失敗（${v.status}）` };
  const buf = await v.arrayBuffer();
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify({
    embeds: [{ title: `財經日報 ${meta.date.replaceAll("-", ".")}`, description: note, color: GOLD,
      author: { name: KIND_NAME.arthur, icon_url: AVATAR.arthur }, footer: { text: "A.R.T.H.U.R." } }],
    attachments: [{ id: 0, filename: file }],
  }));
  fd.append("files[0]", new Blob([buf], { type: "image/jpeg" }), file);
  const r = await fetch(`${API}/channels/${ch}/messages`, { method: "POST", headers: { Authorization: `Bot ${BOT()}` }, body: fd });
  return { ok: r.ok, status: r.status, bytes: buf.byteLength, detail: r.ok ? "" : (await r.text()).slice(0, 300) };
}

// ---------- /market：即時財經日報 ----------
// 指令先記一筆請求並觸發 GitHub 截圖流程；排程每分鐘呼叫 market-deliver，
// 等 daily-report 分支出現比請求更新的版本，就把截圖送到發指令的頻道。
export const SNAP_REPO = "eastonesd/eastone.com";
export const ghToken = () => Deno.env.get("GITHUB_TOKEN") ?? "";
export async function marketRequest(db: SupabaseClient, kind: string, channel: string, who: string) {
  const token = ghToken();
  if (!token) return "還沒設定 GITHUB_TOKEN，無法觸發截圖流程。";
  const { data: pending } = await db.from("arthur_market_requests").select("id").eq("status", "pending")
    .gte("requested_at", new Date(Date.now() - 8 * 60_000).toISOString()).limit(1);
  const { error } = await db.from("arthur_market_requests").insert({ kind, channel_id: channel, who });
  if (error) return `記錄請求失敗：${error.message}`;
  // 已經有一個正在跑，就不重複觸發，跑完一起送
  if (!pending?.length) {
    const r = await fetch(`https://api.github.com/repos/${SNAP_REPO}/actions/workflows/daily-snapshot.yml/dispatches`, {
      method: "POST", headers: { ...ghHeaders(token) }, body: JSON.stringify({ ref: "main" }) });
    if (r.status !== 204) {
      await db.from("arthur_market_requests").update({ status: "failed", note: `dispatch ${r.status}` }).eq("status", "pending").eq("channel_id", channel);
      return `觸發截圖流程失敗（GitHub ${r.status}）。`;
    }
  }
  return "收到，先生。正在抓最新行情製作截圖，約 1～2 分鐘後送到這裡。";
}
export async function marketDeliver(db: SupabaseClient) {
  const { data: rows } = await db.from("arthur_market_requests").select("*").eq("status", "pending").order("requested_at");
  if (!rows?.length) return { idle: true };
  const c = await fetch(`https://api.github.com/repos/${SNAP_REPO}/commits/daily-report`, { headers: ghHeaders(ghToken()) });
  if (!c.ok) return { error: `讀取 daily-report 失敗（${c.status}）` };
  const updated = Date.parse((await c.json()).commit?.committer?.date ?? "");
  let meta: any = null;
  const out = [];
  for (const row of rows) {
    const asked = Date.parse(row.requested_at);
    if (updated > asked) {
      if (!meta) { const m = await dailyFile("latest.json"); meta = m.ok ? await m.json() : null; }
      const r = meta ? await postDaily(row.channel_id, meta, "即時截圖：1080×1920，可直接下載。")
                     : { ok: false, detail: "讀不到 latest.json" };
      await db.from("arthur_market_requests").update({ status: r.ok ? "done" : "failed", note: r.detail || null, done_at: new Date().toISOString() }).eq("id", row.id);
      if (!r.ok) await send(row.channel_id, "arthur", { title: "財經日報送出失敗", text: r.detail, color: RED });
      out.push({ id: row.id, ok: r.ok });
    } else if (Date.now() - asked > 10 * 60_000) {
      await db.from("arthur_market_requests").update({ status: "failed", note: "逾時", done_at: new Date().toISOString() }).eq("id", row.id);
      await send(row.channel_id, "arthur", { title: "財經日報逾時", text: "等了 10 分鐘還沒做好，可能是 GitHub 的截圖流程失敗了。請稍後再試一次 /market。", color: RED });
      out.push({ id: row.id, ok: false, timeout: true });
    }
  }
  return { delivered: out };
}

// ---------- Instagram 限時動態：每天的財經日報截圖 ----------
// 權杖放在 Secret IG_MAIN_TOKEN（主人自己在 Supabase 後台填）。支援兩種：
//   IGAA 開頭（Instagram 登入，graph.instagram.com）；EAA 開頭（Meta 統一登入／粉絲專頁，graph.facebook.com）
// 錯誤訊息一律不帶權杖內容。
export async function igAccount(tok: string, want?: string) {
  if (!tok.startsWith("EAA")) {
    const base = "https://graph.instagram.com/v23.0";
    const r = await fetch(`${base}/me?fields=user_id,username&access_token=${encodeURIComponent(tok)}`);
    if (!r.ok) return { error: `權杖無效或過期（HTTP ${r.status}）` };
    const d = await r.json();
    return { base, id: String(d.user_id), username: d.username as string };
  }
  const base = "https://graph.facebook.com/v23.0";
  const get = (path: string) => fetch(`${base}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(tok)}`);
  const ids: string[] = [];
  for (const p of ["me/instagram_accounts?fields=id", "me/assigned_instagram_accounts?fields=id"]) {
    const r = await get(p); if (r.ok) ids.push(...((await r.json()).data ?? []).map((x: any) => String(x.id)));
  }
  const pages = await get("me/accounts?fields=instagram_business_account");
  if (pages.ok) ids.push(...((await pages.json()).data ?? []).filter((p: any) => p.instagram_business_account).map((p: any) => String(p.instagram_business_account.id)));
  const found: { id: string; username: string }[] = [];
  for (const id of [...new Set(ids)]) {
    const r = await get(`${id}?fields=username`);
    if (r.ok) { const d = await r.json(); if (d.username) found.push({ id, username: d.username }); }
  }
  if (!found.length) return { error: "權杖有效，但找不到可發文的 Instagram 專業帳號" };
  const pick = want ? found.find((a) => a.username.toLowerCase() === want.toLowerCase()) : found.length === 1 ? found[0] : null;
  if (!pick) return { error: `這個權杖可以管理 ${found.map((a) => "@" + a.username).join("、")}，請告訴亞瑟要發到哪一個` };
  return { base, ...pick };
}

export async function igStory(db: SupabaseClient, opts: { force?: boolean; last?: boolean; username?: string }) {
  const link = await getLink(db);
  const ch = (link?.channels ?? {}).arthur;
  const today = todayTaipei();
  const { data: done } = await db.from("arthur_ig_story").select("media_id").eq("date", today).maybeSingle();
  if (done && !opts.force) return { skip: "今天已經發過了" };
  const fail = async (why: string) => {
    if (ch) await send(ch, "arthur", { title: "Instagram 限時動態沒有發出", text: why, color: RED });
    return { error: why };
  };
  const tok = (Deno.env.get("IG_MAIN_TOKEN") ?? "").trim();
  if (!tok) return await fail("還沒設定 IG_MAIN_TOKEN（Instagram 主帳號的權杖）。");
  const m = await dailyFile("latest.json");
  if (!m.ok) return await fail(`讀不到今天的截圖資訊（HTTP ${m.status}）。`);
  const meta = await m.json();
  if (meta.date !== today) return opts.force || opts.last ? await fail(`今天的截圖還沒拍好（最新的是 ${meta.date}）。`) : { wait: `最新的是 ${meta.date}，等補發時再試` };
  const acct: any = await igAccount(tok, opts.username);
  if (acct.error) return await fail(acct.error);
  const imageUrl = `https://raw.githubusercontent.com/${SNAP_REPO}/daily-report/${meta.image}`;
  const q = (o: Record<string, string>) => new URLSearchParams({ ...o, access_token: tok });
  const c = await fetch(`${acct.base}/${acct.id}/media`, { method: "POST", body: q({ media_type: "STORIES", image_url: imageUrl }) });
  if (!c.ok) return await fail(`Instagram 建立限時動態失敗（HTTP ${c.status}）：${(await c.text()).slice(0, 200)}`);
  const cid = (await c.json()).id;
  for (let i = 0; i < 12; i++) {             // 圖片通常幾秒內就處理好，最多等 1 分鐘
    const s = await (await fetch(`${acct.base}/${cid}?fields=status_code&access_token=${encodeURIComponent(tok)}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") return await fail(`Instagram 處理圖片失敗（${s.status_code}）。`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  const p = await fetch(`${acct.base}/${acct.id}/media_publish`, { method: "POST", body: q({ creation_id: cid }) });
  if (!p.ok) return await fail(`Instagram 發布失敗（HTTP ${p.status}）：${(await p.text()).slice(0, 200)}`);
  const mediaId = (await p.json()).id;
  await db.from("arthur_ig_story").upsert({ date: today, media_id: mediaId, username: acct.username, posted_at: new Date().toISOString() });
  if (ch) await postDaily(ch, meta, `已發到 @${acct.username} 的限時動態。`);
  return { ok: true, username: acct.username, media_id: mediaId };
}
