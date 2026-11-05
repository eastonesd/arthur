// ============================================================
// J.A.R.V.I.S LINE 官方帳號
// 網址：https://<project>.supabase.co/functions/v1/jarvis-line
//
// 1. LINE webhook（帶 x-line-signature）：綁定、解除綁定、「今天」、「待辦」、「進度」、生日祝福按鈕、完成待辦按鈕
// 2. 排程（帶 x-cron-token，body {task}）：
//    morning  每天 08:00 早安簡報
//    tick     每 5 分鐘，行程開始前一小時提醒
//    evening  每天 21:00 今日／逾期待辦追蹤
//    goal     每月 15 日 09:00 收入目標進度
//    body {dry_run:true} 只回報內容，不發送、不記錄
//
// Secrets：JARVIS_LINE_CHANNEL_SECRET、JARVIS_LINE_CHANNEL_ACCESS_TOKEN
//          ANTHROPIC_API_KEY（選填，用來寫生日祝福；沒有就用範本）
// verify_jwt 關閉：LINE 不帶 Supabase JWT，改用 LINE 簽章與 cron token 驗證。
// ============================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import webpush from "npm:web-push@3.6.7";
import {
  type JarvisData, type Person, eventReminderText, eveningTodos, everyone, birthdaysOn,
  fallbackGreeting, goalProgress, morningBrief, openTodos, routinesDue, taipeiNow, upcomingEvents,
} from "./brief.ts";

const SECRET = () => Deno.env.get("JARVIS_LINE_CHANNEL_SECRET") ?? "";
const TOKEN = () => Deno.env.get("JARVIS_LINE_CHANNEL_ACCESS_TOKEN") ?? "";

function adminClient() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const key = keys ? JSON.parse(keys)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
}
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

async function verifySignature(secret: string, raw: string, sig: string | null) {
  if (!secret || !sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  let bin = ""; for (const b of mac) bin += String.fromCharCode(b);
  const expected = btoa(bin);
  if (expected.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function line(path: "push" | "reply", body: unknown) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN()}` }, body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}
const text = (t: string, quickReply?: unknown) => (quickReply ? { type: "text", text: t.slice(0, 4900), quickReply } : { type: "text", text: t.slice(0, 4900) });

// 讀某位使用者的 JARVIS 資料 + 東石系統客戶
async function loadOwner(db: SupabaseClient, owner: string) {
  const [st, cl] = await Promise.all([
    db.from("jarvis_state").select("data").eq("owner", owner).maybeSingle(),
    db.from("clients").select("name:data->>name, birthday:data->>birthday").eq("owner", owner),
  ]);
  const data = (st.data?.data ?? {}) as JarvisData;
  const clients = ((cl.data ?? []) as { name: string | null; birthday: string | null }[])
    .filter((c) => c.name && c.birthday && /^\d{4}-\d{2}-\d{2}/.test(c.birthday))
    .map((c) => ({ name: c.name!.trim(), birthday: c.birthday!.slice(0, 10) }));
  return { data, clients };
}

// 已推播過就不再推（同一天、同一件事）
async function claim(db: SupabaseClient, owner: string, kind: string, ref: string, day: string) {
  const { error } = await db.from("jarvis_push_log").insert({ owner, kind, ref, sent_on: day });
  return !error; // 主鍵衝突 = 已推過
}
async function unclaim(db: SupabaseClient, owner: string, kind: string, ref: string, day: string) {
  await db.from("jarvis_push_log").delete().match({ owner, kind, ref, sent_on: day });
}

// ---------- 生日祝福 ----------
async function writeGreetings(people: Person[]): Promise<{ name: string; text: string }[]> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (key && people.length) {
    try {
      const prompt = `請用繁體中文（台灣用語）幫一位保險業務員寫 LINE 生日祝福，每人一則，60 到 90 字，溫暖自然、不浮誇、不推銷。` +
        `「客戶」用敬語並帶一句感謝支持；「朋友」「家人」「重要的人」語氣親切，可用一個表情符號。不要提年齡。` +
        `只回傳 JSON 陣列，格式 [{"name":"…","text":"…"}]，不要其他文字。\n名單：` +
        JSON.stringify(people.map((p) => ({ name: p.name, relation: p.group })));
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: Deno.env.get("JARVIS_MODEL") || "claude-haiku-5-5", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const j = await res.json();
        const raw = (j.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
        const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
        if (Array.isArray(arr) && arr.length) return arr.filter((a) => a?.name && a?.text);
      } else console.error("anthropic", res.status, await res.text());
    } catch (e) { console.error("greeting AI failed", e); }
  }
  return people.map((p, i) => ({ name: p.name, text: fallbackGreeting(p, i) }));
}

function greetingMessages(list: { name: string; text: string }[]) {
  const blocks = list.map((g) => `【${g.name}】\n${g.text}`);
  const msgs: unknown[] = [text("已為您準備好生日祝福，長按即可複製轉傳：")];
  // 一次最多 5 則訊息：前 3 位各一則，其餘合併成最後一則
  blocks.slice(0, 3).forEach((b) => msgs.push(text(b)));
  if (blocks.length > 3) msgs.push(text(blocks.slice(3).join("\n\n")));
  return msgs;
}

const greetButton = (day: string) => ({ items: [{ type: "action", action: { type: "postback", label: "好", data: `greet:${day}`, displayText: "好" } }] });
const todoButtons = (todos: { id: string; title: string }[]) => ({
  items: todos.slice(0, 13).map((t) => ({ type: "action", action: { type: "postback", label: `✓ ${t.title}`.slice(0, 20), data: `done:${t.id}`, displayText: `完成：${t.title}` } })),
});

// ---------- 手機推播（Web Push）----------
async function vapidKeys(db: SupabaseClient) {
  const { data } = await db.from("jarvis_vapid").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await db.from("jarvis_vapid").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: "id", ignoreDuplicates: true });
  const { data: again } = await db.from("jarvis_vapid").select("public_key, private_key").eq("id", 1).single();
  return again!;
}
async function webPush(db: SupabaseClient, owner: string, payload: { title: string; body: string; tag?: string }) {
  const { data: subs } = await db.from("jarvis_push_subs").select("endpoint, p256dh, auth").eq("owner", owner);
  if (!subs?.length) return { sent: 0, failed: 0 };
  const k = await vapidKeys(db);
  // Apple 要求 subject 是真實可用的 https 網址或 mailto，否則回 403 BadJwtToken
  webpush.setVapidDetails(Deno.env.get("JARVIS_PUSH_SUBJECT") || "https://eastonesd.github.io/jarvis/", k.public_key, k.private_key);
  let sent = 0, failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e: any) {
      failed++;
      // 裝置取消訂閱或過期：刪掉這筆
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("jarvis_push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("web push failed", e?.statusCode, e?.body);
    }
  }
  return { sent, failed };
}
async function runRoutines(db: SupabaseClient, dryRun: boolean) {
  const now = taipeiNow();
  const { data: rows } = await db.from("jarvis_push_subs").select("owner");
  const owners = [...new Set((rows ?? []).map((r: { owner: string }) => r.owner))];
  const out = [];
  for (const owner of owners) {
    const { data } = await db.from("jarvis_state").select("data").eq("owner", owner).maybeSingle();
    for (const r of routinesDue((data?.data ?? {}) as JarvisData, now)) {
      const entry: Record<string, unknown> = { owner, routine: r.label };
      if (dryRun) { entry.preview = r.msg; out.push(entry); continue; }
      if (!(await claim(db, owner, "routine", `${r.time}|${r.label}`, now.date))) continue;
      entry.result = await webPush(db, owner, { title: "J.A.R.V.I.S", body: r.msg!, tag: `routine-${r.label}` });
      out.push(entry);
    }
  }
  return out;
}

// ---------- 排程 ----------
async function runTask(db: SupabaseClient, task: string, dryRun: boolean) {
  const now = taipeiNow();
  const { data: links, error } = await db.from("jarvis_line_links").select("owner, line_user_id");
  if (error) throw error;
  const out = [];
  for (const link of links ?? []) {
    const { data, clients } = await loadOwner(db, link.owner);
    let msg: unknown = null, kind = task, ref = now.date;
    if (task === "morning") {
      const b = morningBrief(data, clients, now);
      msg = text(b.text, b.birthdays.length ? greetButton(now.date) : undefined);
    } else if (task === "tick") {
      const up = upcomingEvents(data, now);
      const fresh = [];
      for (const e of up) {
        const r = `${e.time}|${e.title}`;
        if (dryRun || await claim(db, link.owner, "event", r, now.date)) fresh.push(e);
      }
      if (fresh.length) msg = text(eventReminderText(fresh));
      kind = ""; // 已逐筆記錄
    } else if (task === "goal") {
      msg = text(goalProgress(data, now).text);
      ref = now.date.slice(0, 7);
    } else if (task === "evening") {
      const t = eveningTodos(data, now);
      if (t.length) msg = text(`晚安，先生。今天還有 ${t.length} 項待辦尚未完成：\n` + t.map((x) => `・${x.title}${x.overdue ? "（已逾期）" : ""}`).join("\n") + "\n\n完成的話點下方按鈕，我會幫您打勾。", todoButtons(t));
    }
    const entry: Record<string, unknown> = { owner: link.owner, task };
    if (!msg) { entry.result = "nothing to send"; out.push(entry); continue; }
    if (dryRun) { entry.preview = msg; out.push(entry); continue; }
    if (kind && !(await claim(db, link.owner, kind, ref, now.date))) { entry.result = "already sent"; out.push(entry); continue; }
    const res = await line("push", { to: link.line_user_id, messages: [msg] });
    entry.result = res.ok ? "sent" : `LINE error ${res.status}: ${res.text}`;
    if (!res.ok && kind) await unclaim(db, link.owner, kind, ref, now.date);
    out.push(entry);
  }
  const routines = task === "tick" ? await runRoutines(db, dryRun) : [];
  return { today: now.date, task, dry_run: dryRun, report: out, routines };
}

// ---------- webhook ----------
const HELP = "您好，我是 J.A.R.V.I.S。\n\n綁定方式：\n1. 打開 JARVIS 儀表板，點右上「登入同步」\n2. 按「綁定 LINE」產生 8 碼綁定碼\n3. 把綁定碼傳到這裡\n\n綁定後可以傳：\n・「今天」：今日簡報\n・「待辦」：未完成的待辦\n・「進度」：本月收入目標進度\n・「解除綁定」：停止推播";

async function handleEvent(db: SupabaseClient, ev: any) {
  const uid: string | undefined = ev.source?.userId;
  if (!ev.replyToken || ev.source?.type !== "user" || !uid) return;
  const reply = (...messages: unknown[]) => line("reply", { replyToken: ev.replyToken, messages });
  const { data: link } = await db.from("jarvis_line_links").select("owner").eq("line_user_id", uid).maybeSingle();
  const now = taipeiNow();

  if (ev.type === "follow") return void await reply(text(link ? "歡迎回來，先生。" : HELP));

  if (ev.type === "postback") {
    if (!link) return void await reply(text(HELP));
    const d: string = ev.postback?.data ?? "";
    const { data, clients } = await loadOwner(db, link.owner);
    if (d.startsWith("greet:")) {
      const people = birthdaysOn(everyone(data, clients), d.slice(6) || now.date);
      if (!people.length) return void await reply(text("今天沒有壽星，先生。"));
      return void await reply(...greetingMessages(await writeGreetings(people)));
    }
    if (d.startsWith("done:")) {
      const id = d.slice(5);
      const todos = data.todos ?? [];
      const t = todos.find((x) => x.id === id);
      if (!t) return void await reply(text("找不到這項待辦，可能已經被刪除了。"));
      if (!t.done) {
        t.done = true;
        await db.from("jarvis_state").update({ data: { ...data, todos }, updated_at: new Date().toISOString() }).eq("owner", link.owner);
      }
      const left = openTodos({ ...data, todos }, now.date).length;
      return void await reply(text(`已完成「${t.title}」。${left ? `還有 ${left} 項待辦。` : "待辦全數清空，辛苦了。"}`));
    }
    return;
  }

  if (ev.type !== "message" || ev.message?.type !== "text") return;
  const t = String(ev.message.text || "").trim().toUpperCase().replace(/\s+/g, "");

  if (["解除綁定", "取消綁定", "UNLINK"].includes(t)) {
    const { data } = await db.from("jarvis_line_links").delete().eq("line_user_id", uid).select("owner");
    return void await reply(text(data?.length ? "已解除綁定，之後不會再推播。" : "這個 LINE 目前沒有綁定。"));
  }
  const code = t.replace(/^綁定[:：]?/, "").match(/^[A-HJ-NP-Z2-9]{8}$/)?.[0];
  if (code) {
    const { data: c } = await db.from("jarvis_link_codes").select("owner, expires_at").eq("code", code).maybeSingle();
    if (!c || new Date(c.expires_at) < new Date()) return void await reply(text("綁定碼錯誤或已過期（有效 30 分鐘），請在儀表板重新產生。"));
    await db.from("jarvis_line_links").delete().eq("line_user_id", uid);
    const { error } = await db.from("jarvis_line_links").upsert({ owner: c.owner, line_user_id: uid, linked_at: new Date().toISOString() }, { onConflict: "owner" });
    if (error) throw error;
    await db.from("jarvis_link_codes").delete().eq("owner", c.owner);
    return void await reply(text("綁定完成，先生。\n每天 08:00 早安簡報、行程前一小時提醒、21:00 待辦追蹤，都會傳到這裡。\n隨時傳「今天」可以看今日簡報。"));
  }
  if (!link) {
    if (["綁定", "說明", "HELP", "?", "？"].includes(t)) await reply(text(HELP));
    return;
  }
  if (["今天", "今日", "簡報", "早安"].includes(t)) {
    const { data, clients } = await loadOwner(db, link.owner);
    const b = morningBrief(data, clients, now);
    return void await reply(text(b.text.replace(/^早上好，史塔克先生。/, "史塔克先生，這是今天的簡報。"), b.birthdays.length ? greetButton(now.date) : undefined));
  }
  if (["待辦", "TODO"].includes(t)) {
    const { data } = await loadOwner(db, link.owner);
    const list = openTodos(data, now.date);
    return void await reply(list.length
      ? text(`未完成的待辦 ${list.length} 項：\n` + list.map((x) => `・${x.title}${x.overdue ? "（已逾期）" : x.today ? "（今天）" : ""}`).join("\n"), todoButtons(list))
      : text("目前沒有未完成的待辦，先生。"));
  }
  if (["進度", "目標", "收入"].includes(t)) {
    const { data } = await loadOwner(db, link.owner);
    return void await reply(text(goalProgress(data, now).text.replace(/^先生，\d+ 月已過一半，/, "先生，")));
  }
  if (["說明", "HELP", "?", "？"].includes(t)) await reply(text(HELP));
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const corsJson = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = adminClient();
  // 儀表板取得推播公鑰（公開資訊）
  if (req.method === "GET" && new URL(req.url).searchParams.has("vapid")) {
    const k = await vapidKeys(db);
    return new Response(JSON.stringify({ publicKey: k.public_key }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (req.method !== "POST") return new Response("ok");

  // 排程呼叫
  const cron = req.headers.get("x-cron-token");
  if (cron !== null) {
    const { data: allowed } = await db.rpc("check_reminder_token", { t: cron });
    if (!allowed) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    try { return json(await runTask(db, String(body.task || "morning"), !!body.dry_run)); }
    catch (e) { return json({ error: String(e) }, 500); }
  }

  // 儀表板（已登入的使用者）：傳一則測試通知到自己的裝置
  const auth = req.headers.get("authorization");
  if (!req.headers.get("x-line-signature") && auth?.startsWith("Bearer ")) {
    const { data: u } = await db.auth.getUser(auth.slice(7));
    if (!u?.user) return corsJson({ error: "unauthorized" }, 401);
    const r = await webPush(db, u.user.id, { title: "J.A.R.V.I.S", body: "先生，通知已開啟。每天 12:00、17:00、23:00 我會準時提醒您。", tag: "test" });
    return corsJson(r);
  }

  // LINE webhook
  if (!SECRET() || !TOKEN()) return new Response("LINE not configured", { status: 503 });
  const raw = await req.text();
  if (!(await verifySignature(SECRET(), raw, req.headers.get("x-line-signature")))) return new Response("bad signature", { status: 401 });
  for (const ev of JSON.parse(raw || "{}").events ?? []) {
    try { await handleEvent(db, ev); } catch (e) { console.error("event failed", e); }
  }
  return new Response("ok"); // LINE 一律要 200
});
