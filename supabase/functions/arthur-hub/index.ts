// ============================================================
// A.R.T.H.U.R. 專案指揮中心（arthur-hub）
// 網址：https://<project>.supabase.co/functions/v1/arthur-hub
//
// 檢查 arthur_hub.projects 裡每個 repo 的健康狀態與成果，寫回 arthur_hub.status：
//   ・最後推送時間、各 GitHub Actions 流程最近一次結果、GitHub Pages 網站是否正常
//   ・成果：SAGA（劇數、完成集數、7 天產出）、蝦皮機器人（佣金、成交、發文）
//   ・其他專案：repo 根目錄若有 arthur.json（統一回報格式，見 README）就一併讀取
//
// 呼叫方式：
//   x-cron-token + {task:"scan"}   排程每 10 分鐘；新成果與失敗送 Discord（未設定時退回 LINE）
//   Authorization: Bearer <使用者 JWT> + {action:"scan"}   儀表板「立即檢查」
//
// Secrets：ARTHUR_GITHUB_TOKEN（fine-grained，唯讀即可；沒有時只能看公開 repo，且每小時最多檢查一次）
//          JARVIS_LINE_CHANNEL_ACCESS_TOKEN（推播失敗通知）
// ============================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

type Project = { repo: string; name: string; kind: "arthur" | "saga" | "ec" | "generic" | "readonly" };
type Metric = { label: string; value: string };
type RepoStatus = {
  name: string; repo: string; kind: string; url?: string; private?: boolean;
  health: "ok" | "running" | "fail" | "unknown"; note?: string;
  pushed_at?: string; site?: { url: string; ok: boolean; code?: number } | null;
  workflows?: { name: string; status: string; conclusion: string | null; at: string; url: string; id: number }[];
  failed?: { name: string; at: string; url: string; id: number }[];
  headline?: string; metrics?: Metric[]; checked_at: string;
  refs?: { n: number; title: string; url: string }[]; // 東石影音：已分析的標竿 Issue（偵測新完成的分析用，不顯示）
  monet?: any; // 東石影音：營利進度（stats/monetization.json 原樣，儀表板顯示＋里程碑通知）
};

const GH_TOKEN = () => Deno.env.get("ARTHUR_GITHUB_TOKEN") ?? "";
const LINE_TOKEN = () => Deno.env.get("JARVIS_LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function adminClient() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const key = keys ? JSON.parse(keys)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
}

class GhError extends Error { constructor(public status: number, msg: string) { super(msg); } }
async function gh(path: string, raw = false) {
  const headers: Record<string, string> = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "arthur-hub",
  };
  if (GH_TOKEN()) headers.Authorization = `Bearer ${GH_TOKEN()}`;
  const res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new GhError(res.status, `${res.status} ${path}`);
  return raw ? res.text() : res.json();
}
const ghJSON = async (owner: string, repo: string, file: string) => JSON.parse(await gh(`/repos/${owner}/${repo}/contents/${file}`, true) as string);
const money = (n: number) => `NT$${Math.round(n).toLocaleString("en-US")}`;
const DAY = 86400000;

// ---------- 各專案成果 ----------
async function sagaMetrics(owner: string, repo: string): Promise<{ headline: string; metrics: Metric[]; refs: { n: number; title: string; url: string }[]; monet: any }> {
  const [issues, releases, analyzed, monet] = await Promise.all([
    gh(`/repos/${owner}/${repo}/issues?labels=%E6%96%B0%E5%8A%87&state=all&per_page=100`) as Promise<any[]>,
    gh(`/repos/${owner}/${repo}/releases?per_page=100`) as Promise<any[]>,
    // label「已分析」：標竿片分析完成
    (gh(`/repos/${owner}/${repo}/issues?labels=${encodeURIComponent("已分析")}&state=all&per_page=50&sort=updated`) as Promise<any[]>).catch(() => []),
    // 營利進度：eastone.saga 每天 06:41（台北）更新
    ghJSON(owner, repo, "stats/monetization.json").catch(() => null),
  ]);
  const refs = analyzed.filter((i) => !i.pull_request).map((i) => ({ n: i.number, title: String(i.title), url: i.html_url }));
  const series = issues.filter((i) => !i.pull_request);
  const eps = releases.flatMap((r) => (r.assets ?? []).filter((a: any) => /-ep\d+\.mp4$/.test(a.name)));
  const week = eps.filter((a: any) => Date.now() - Date.parse(a.created_at) < 7 * DAY).length;
  const day = eps.filter((a: any) => Date.now() - Date.parse(a.created_at) < DAY).length;
  return {
    headline: day ? `過去 24 小時完成 ${day} 集` : week ? `本週完成 ${week} 集` : "本週沒有新集數",
    metrics: [
      { label: "劇數", value: String(series.length) },
      { label: "已完成集數", value: String(eps.length) },
      { label: "7 天產出", value: `${week} 集` },
    ],
    refs,
    monet,
  };
}

async function ecMetrics(owner: string, repo: string): Promise<{ headline: string; metrics: Metric[] }> {
  let meta: any = null, conv: any[] = [];
  try { meta = await ghJSON(owner, repo, "dashboard/data/meta.json"); } catch (e) { if (!(e instanceof GhError && e.status === 404)) throw e; }
  if (!meta || !(meta.total_posts || meta.total_drafts)) return { headline: "示範模式（尚未接上真實資料）", metrics: [] };
  try { conv = await ghJSON(owner, repo, "dashboard/data/conversions.json"); } catch { conv = []; }
  const since = (Date.now() - 7 * DAY) / 1000;
  const week = conv.filter((c) => (c.purchase_time || 0) >= since);
  const weekSum = week.reduce((s, c) => s + (Number(c.commission) || 0), 0);
  const yest = conv.filter((c) => (c.purchase_time || 0) >= Date.now() / 1000 - 86400);
  return {
    headline: yest.length ? `過去 24 小時成交 ${yest.length} 筆` : `近 7 天佣金 ${money(weekSum)}`,
    metrics: [
      { label: "累計佣金", value: money(meta.total_commission || 0) },
      { label: "近 7 天", value: `${money(weekSum)}・${week.length} 筆` },
      { label: "發文數", value: String(meta.total_posts || 0) },
      { label: "待發布", value: String(meta.total_drafts || 0) },
    ],
  };
}

// 統一回報格式：repo 根目錄 arthur.json = { headline, metrics:[{label,value}], updated_at }
async function genericMetrics(owner: string, repo: string) {
  try {
    const j = await ghJSON(owner, repo, "arthur.json");
    const metrics = Array.isArray(j.metrics) ? j.metrics.slice(0, 6).map((m: any) => ({ label: String(m.label).slice(0, 20), value: String(m.value).slice(0, 40) })) : [];
    return { headline: j.headline ? String(j.headline).slice(0, 80) : "", metrics };
  } catch { return null; }
}

// ---------- 單一 repo 檢查 ----------
async function checkRepo(owner: string, p: Project): Promise<RepoStatus> {
  const now = new Date().toISOString();
  const base: RepoStatus = { name: p.name, repo: p.repo, kind: p.kind, health: "unknown", checked_at: now };
  let info: any;
  try { info = await gh(`/repos/${owner}/${p.repo}`); }
  catch (e) {
    const s = e instanceof GhError ? e.status : 0;
    return { ...base, note: s === 404 ? (GH_TOKEN() ? "找不到 repo（名稱改了？或金鑰沒有權限）" : "私人 repo，需要設定 GitHub 金鑰") : s === 403 ? "GitHub 暫時限制查詢次數，稍後再試" : `讀取失敗（${s || "網路"}）` };
  }
  const out: RepoStatus = { ...base, url: info.html_url, private: info.private, pushed_at: info.pushed_at };

  // Actions：每個流程取最近一次（排程中的、已完成的都算）
  try {
    const { workflow_runs: runs = [] } = await gh(`/repos/${owner}/${p.repo}/actions/runs?per_page=40&exclude_pull_requests=true`) as any;
    const latest = new Map<string, any>();
    for (const r of runs) if (!latest.has(r.name)) latest.set(r.name, r);
    out.workflows = [...latest.values()].map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, at: r.updated_at, url: r.html_url, id: r.id }));
    out.failed = out.workflows.filter((w) => w.status === "completed" && ["failure", "timed_out", "startup_failure"].includes(w.conclusion ?? ""))
      .map(({ name, at, url, id }) => ({ name, at, url, id }));
  } catch { out.workflows = []; out.failed = []; }

  // GitHub Pages 網站
  if (info.has_pages) {
    // /pages 需要金鑰才讀得到；讀不到就用預設網址
    const url = await (gh(`/repos/${owner}/${p.repo}/pages`) as Promise<any>).then((pg) => pg.html_url).catch(() => `https://${owner.toLowerCase()}.github.io/${p.repo}/`);
    let ok = false, code = 0;
    try { const r = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10000) }); code = r.status; ok = r.ok; await r.body?.cancel(); } catch { /* 連不上 */ }
    out.site = { url, ok, code };
  }

  // 成果
  try {
    const m = p.kind === "saga" ? await sagaMetrics(owner, p.repo)
      : p.kind === "ec" ? await ecMetrics(owner, p.repo)
      : await genericMetrics(owner, p.repo);
    if (m) { out.headline = m.headline; out.metrics = m.metrics; if ("refs" in m) out.refs = (m as any).refs; if ((m as any).monet) out.monet = (m as any).monet; }
  } catch (e) { out.headline = `成果讀取失敗：${(e as Error).message}`.slice(0, 80); }

  const running = (out.workflows ?? []).some((w) => w.status !== "completed");
  out.health = (out.failed?.length || (out.site && !out.site.ok)) ? "fail" : running ? "running" : "ok";
  if (out.site && !out.site.ok) out.note = `網站回應異常（${out.site.code || "連不上"}）`;
  return out;
}

async function pushLine(to: string, text: string) {
  if (!LINE_TOKEN()) return false;
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN()}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  return res.ok;
}

// ---------- Discord 通知（有設定頻道就送 Discord，沒有就退回 LINE） ----------
const DISCORD_BOT = () => Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const KIND_OF: Record<string, string> = { "eastone.saga": "saga", "eastone.ecommerce": "ec", "eastone.dpf": "dpf" };
const KIND_NAME: Record<string, string> = { saga: "東石影音", ec: "東石電商", dpf: "東石數位", arthur: "A.R.T.H.U.R." };
const AV = (k: string) => `https://eastonesd.github.io/arthur/assets/projects/${k === "arthur" ? "arthur" : k}.png`;
type Embed = { title: string; text?: string; url?: string; color?: number };
async function discordChannels(db: SupabaseClient, owner: string): Promise<Record<string, string>> {
  if (!DISCORD_BOT()) return {};
  const { data } = await db.from("arthur_discord").select("channels").eq("owner", owner).maybeSingle();
  return (data?.channels ?? {}) as Record<string, string>;
}
async function discordSend(channels: Record<string, string>, kind: string, e: Embed) {
  const id = channels[kind] ?? channels.arthur;
  if (!id) return false;
  const k = channels[kind] ? kind : "arthur";
  const r = await fetch(`https://discord.com/api/v10/channels/${id}/messages`, {
    method: "POST", headers: { Authorization: `Bot ${DISCORD_BOT()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [{ title: e.title.slice(0, 256), description: e.text?.slice(0, 4000), url: e.url, color: e.color ?? 0xf5b43a,
      author: { name: KIND_NAME[k], icon_url: AV(k) }, footer: { text: "A.R.T.H.U.R." }, timestamp: new Date().toISOString() }] }),
  });
  if (!r.ok) console.error("discord", r.status, await r.text());
  return r.ok;
}
const metricNum = (st: any, label: string) => { const m = (st?.metrics ?? []).find((x: Metric) => x.label === label); const n = m ? Number(String(m.value).replace(/[^\d.]/g, "")) : NaN; return Number.isFinite(n) ? n : null; };

// 新成果：東石影音新集數／新劇、東石電商新貼文（跟上一次掃描比較；第一次掃描不通知）
async function projectEvents(ghOwner: string, prev: Record<string, any>, results: RepoStatus[]): Promise<{ kind: string; e: Embed }[]> {
  const out: { kind: string; e: Embed }[] = [];
  for (const r of results) {
    const p = prev[r.repo];
    if (!p?.metrics?.length || !r.metrics?.length) continue;
    if (r.kind === "saga") {
      const e0 = metricNum(p, "已完成集數"), e1 = metricNum(r, "已完成集數"), s0 = metricNum(p, "劇數"), s1 = metricNum(r, "劇數");
      if (s0 !== null && s1 !== null && s1 > s0) out.push({ kind: "saga", e: { title: `新劇開拍（共 ${s1} 部）`, text: "編劇部正在寫角色表與分集大綱。", url: "https://eastonesd.github.io/eastone.saga/" } });
      // 標竿片分析完成：上一次掃描沒有、這次出現在「已分析」裡的 Issue（第一次掃描不通知）
      if (Array.isArray(p.refs)) {
        const seen = new Set(p.refs.map((x: any) => x.n));
        for (const x of (r.refs ?? []).filter((x) => !seen.has(x.n)).slice(0, 5))
          out.push({ kind: "saga", e: { title: `🎯 標竿分析完成：${x.title}`, url: x.url, text: x.url } });
      }
      // 營利里程碑：每個門檻跨過 25／50／75／100% 時通知一次（跟上一次掃描比；資料每天更新一次）
      const PL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", threads: "Threads", tiktok: "TikTok" };
      for (const [k, pl] of Object.entries((r.monet?.progress ?? {}) as Record<string, any>)) {
        if (r.monet?.raw?.[k]?.error) continue;
        for (const t of pl.tiers ?? []) {
          const before = (p.monet?.progress?.[k]?.tiers ?? []).find((x: any) => x.name === t.name);
          if (!before) continue;                       // 第一次看到這個門檻：不通知
          const b0 = Math.floor(Math.min(before.pct ?? 0, 100) / 25), b1 = Math.floor(Math.min(t.pct ?? 0, 100) / 25);
          if (b1 > b0) out.push({ kind: "saga", e: t.achieved || b1 === 4
            ? { title: `🎉 ${PL[k] ?? k}「${t.name}」達成！`, text: "營利門檻全部達標，可以去後台申請了。", color: 0x6cc58f }
            : { title: `📈 ${PL[k] ?? k}「${t.name}」突破 ${b1 * 25}%`, text: (t.requirements ?? []).map((q: any) => `・${q.label}：${q.current} / ${q.target}${q.eta ? `（預計 ${q.eta}）` : ""}`).join("\n") } });
        }
      }
      if (e0 !== null && e1 !== null && e1 > e0) out.push({ kind: "saga", e: { title: `新完成 ${e1 - e0} 集`, text: `累計已完成 ${e1} 集。`, url: "https://eastonesd.github.io/eastone.saga/" } });
    }
    if (r.kind === "ec") {
      const n0 = metricNum(p, "發文數"), n1 = metricNum(r, "發文數");
      if (n0 !== null && n1 !== null && n1 > n0) {
        try {
          const posts = await ghJSON(ghOwner, r.repo, "dashboard/data/posts.json") as any[];
          for (const post of posts.slice(-(n1 - n0)).slice(-5))
            out.push({ kind: "ec", e: { title: `已發文：${post.name}`, url: post.permalink,
              text: `${String(post.text ?? "").split("\n")[0].slice(0, 200)}\n\n價格 NT$${post.price ?? "–"}・佣金 ${post.commission_rate ? Math.round(post.commission_rate * 1000) / 10 + "%" : "–"}` } });
        } catch { out.push({ kind: "ec", e: { title: `新發文 ${n1 - n0} 篇`, text: `累計 ${n1} 篇。` } }); }
      }
    }
  }
  return out;
}

// 檢查一位使用者的全部專案；notify = 有新失敗時推 LINE
async function scanOwner(db: SupabaseClient, row: any, notify: boolean) {
  const projects: Project[] = row.projects ?? [];
  const prev = (row.status ?? {}) as Record<string, any>;
  const results = await Promise.all(projects.map((p) => checkRepo(row.gh_owner, p).catch((e) => ({ name: p.name, repo: p.repo, kind: p.kind, health: "unknown", note: String(e).slice(0, 80), checked_at: new Date().toISOString() } as RepoStatus))));
  const status = Object.fromEntries(results.map((r) => [r.repo, r]));
  await db.from("arthur_hub").update({ status, scanned_at: new Date().toISOString() }).eq("owner", row.owner);

  const alerts: string[] = [];
  // 新成果（新集數、新貼文）不論是排程或手動檢查都要通知，否則手動檢查會把這次的差異吃掉
  const channels = await discordChannels(db, row.owner);
  for (const ev of await projectEvents(row.gh_owner, prev, results)) await discordSend(channels, ev.kind, ev.e);
  if (notify) {
    const { data: link } = await db.from("jarvis_line_links").select("line_user_id").eq("owner", row.owner).maybeSingle();
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    for (const r of results) {
      // 只通知 24 小時內的失敗，避免第一次接上時把陳年舊帳一次推過來
      const issues = (r.failed ?? []).filter((f) => Date.now() - Date.parse(f.at) < DAY)
        .map((f) => ({ ref: `run:${f.id}`, text: `・${r.name}：「${f.name}」執行失敗\n  ${f.url}` }));
      if (r.site && !r.site.ok) issues.push({ ref: `site:${r.repo}:${today}`, text: `・${r.name}：網站打不開（${r.site.code || "連不上"}）\n  ${r.site.url}` });
      for (const it of issues) {
        // 同一個失敗只通知一次
        const { data: seen } = await db.from("jarvis_push_log").select("ref").eq("owner", row.owner).eq("kind", "ci").eq("ref", it.ref).limit(1);
        if (seen?.length) continue;
        await db.from("jarvis_push_log").insert({ owner: row.owner, kind: "ci", ref: it.ref, sent_on: today });
        // 有 Discord 就送到該專案的頻道，沒有才走 LINE
        if (await discordSend(channels, KIND_OF[r.repo] ?? "arthur", { title: `${r.name} 出了狀況`, text: it.text.replace(/^・/, ""), color: 0xff7a7a })) continue;
        alerts.push(it.text);
      }
    }
    if (alerts.length && link?.line_user_id) await pushLine(link.line_user_id, `葉里克先生，專案出了點狀況：\n\n${alerts.join("\n")}\n\n詳細狀態可以在 A.R.T.H.U.R. 的「專案」查看。`);
  }
  return { owner: row.owner, scanned: results.length, alerts: alerts.length, status };
}

// ---------- DPF 收件匣 ----------
async function sha256hex(t: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function dpfInbox(db: SupabaseClient, token: string, body: any) {
  if (token.length < 32) return { error: "unauthorized" };
  const { data: dev } = await db.from("arthur_device_tokens").select("owner").eq("token_hash", await sha256hex(token)).eq("kind", "dpf").maybeSingle();
  if (!dev) return { error: "unauthorized" };
  const owner = dev.owner;
  if (body.action === "claim") {
    // 領走超過 30 分鐘沒回報的，視為電腦中途關機，放回待處理
    await db.from("arthur_dpf_inbox").update({ status: "pending", claimed_at: null }).eq("owner", owner).eq("status", "claimed").lt("claimed_at", new Date(Date.now() - 30 * 60000).toISOString());
    const { data: rows } = await db.from("arthur_dpf_inbox").select("id").eq("owner", owner).eq("status", "pending").order("created_at").limit(3);
    const ids = (rows ?? []).map((r) => r.id);
    if (!ids.length) return { ok: true, items: [] };
    const { data: items } = await db.from("arthur_dpf_inbox").update({ status: "claimed", claimed_at: new Date().toISOString() }).in("id", ids).eq("status", "pending").select("id, brief, created_at");
    return { ok: true, items: items ?? [] };
  }
  if (body.action === "done" && body.id) {
    const ok = body.ok !== false;
    const { data: row } = await db.from("arthur_dpf_inbox").update({ status: ok ? "done" : "failed", product_id: body.product_id ?? null, note: String(body.note ?? "").slice(0, 500) })
      .eq("id", body.id).eq("owner", owner).select("brief").maybeSingle();
    if (!row) return { error: "not found" };
    const title = row.brief?.title ?? "";
    const sent = await discordSend(await discordChannels(db, owner), "dpf", ok
      ? { title: `已建立「${title}」`, text: `${body.note || "已排入 AI 企劃"}\n請到電腦上的 DPF 後台審核企劃。` }
      : { title: `處理「${title}」時出了狀況`, text: body.note || "未知錯誤", color: 0xff7a7a });
    const { data: link } = sent ? { data: null } : await db.from("jarvis_line_links").select("line_user_id").eq("owner", owner).maybeSingle();
    if (link?.line_user_id) {
      await pushLine(link.line_user_id, ok
        ? `先生，DPF 已建立「${title}」${body.note ? `：${body.note}` : "。"}\n請到電腦上的 DPF 後台審核企劃。`
        : `先生，DPF 處理「${title}」時出了狀況：${body.note || "未知錯誤"}`);
    }
    return { ok: true };
  }
  return { error: "unknown action" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("ok");
  const db = adminClient();
  const body = await req.json().catch(() => ({}));

  // DPF（使用者電腦上的 Docker app）來領取 LINE 送來的商品需求；用裝置金鑰認證
  const dpfToken = req.headers.get("x-dpf-token");
  if (dpfToken !== null) return json(await dpfInbox(db, dpfToken, body));

  // 排程
  const cron = req.headers.get("x-cron-token");
  if (cron !== null) {
    const { data: allowed } = await db.rpc("check_reminder_token", { t: cron });
    if (!allowed) return json({ error: "unauthorized" }, 401);
    const { data: rows } = await db.from("arthur_hub").select("*");
    const out = [];
    for (const row of rows ?? []) {
      // 沒有金鑰時 GitHub 每小時只給 60 次查詢：至少間隔 55 分鐘
      if (!GH_TOKEN() && !body.force && row.scanned_at && Date.now() - Date.parse(row.scanned_at) < 55 * 60000) { out.push({ owner: row.owner, skipped: "rate" }); continue; }
      out.push(await scanOwner(db, row, !body.dry_run).then(({ status, ...rest }) => rest));
    }
    return json({ ok: true, token: !!GH_TOKEN(), report: out });
  }

  // 儀表板：立即檢查
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const { data: u } = await db.auth.getUser(auth.slice(7));
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: row } = await db.from("arthur_hub").select("*").eq("owner", u.user.id).maybeSingle();
    if (!row) return json({ error: "no projects" }, 404);
    if (!GH_TOKEN() && row.scanned_at && Date.now() - Date.parse(row.scanned_at) < 10 * 60000) return json({ ok: true, throttled: true, status: row.status, scanned_at: row.scanned_at, token: false });
    const r = await scanOwner(db, row, false);
    return json({ ok: true, status: r.status, scanned_at: new Date().toISOString(), token: !!GH_TOKEN() });
  }
  return json({ error: "unauthorized" }, 401);
});
