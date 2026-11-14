// /saga、/saga-stats、/dpf
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { b64decode, b64encode, ghHeaders, num, type Result } from "./shared.ts";

export const SAGA_REPO = "eastonesd/eastone.saga";

export async function sagaCreate(d: Record<string, string>): Promise<Result> {
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

export async function sagaStats(opts: Record<string, string>, who: string): Promise<Result> {
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

export async function dpfEnqueue(db: SupabaseClient, owner: string, d: Record<string, string>): Promise<Result> {
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
