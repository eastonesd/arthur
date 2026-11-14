// 共用：Discord／Supabase／GitHub 小工具與通知
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

// 應用程式 ID 與公鑰是公開資訊（不是密碼），直接當預設值；機器人金鑰 DISCORD_BOT_TOKEN 才是秘密
export const PUB = () => Deno.env.get("DISCORD_PUBLIC_KEY") || "f95399e38b012bcaff1f3b49c0c488e856c8cc1e25570812bc261136ab8531ae";
export const APP = () => Deno.env.get("DISCORD_APP_ID") || "1569963735659839549";
export const BOT = () => Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
export const API = "https://discord.com/api/v10";
export const GOLD = 0xf5b43a, RED = 0xff7a7a;
export const AVATAR: Record<string, string> = {
  saga: "https://eastonesd.github.io/arthur/assets/projects/saga.png",
  ec: "https://eastonesd.github.io/arthur/assets/projects/ec.png",
  dpf: "https://eastonesd.github.io/arthur/assets/projects/dpf.png",
  arthur: "https://eastonesd.github.io/arthur/assets/projects/arthur.png",
};
export const KIND_NAME: Record<string, string> = { saga: "東石影音", ec: "東石電商", dpf: "東石數位", arthur: "A.R.T.H.U.R." };

export function adminClient() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const key = keys ? JSON.parse(keys)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
}
export const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export const bot = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bot ${BOT()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });


export const ghHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "arthur" });
export const b64encode = (s: string) => { const b = new TextEncoder().encode(s); let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
export const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
export type Result = { ok: boolean; title: string; text: string; url?: string };

// ---------- 通知 ----------
export async function getLink(db: SupabaseClient) {
  const { data: hub } = await db.from("arthur_hub").select("owner").limit(1).maybeSingle();
  if (!hub) return null;
  const { data } = await db.from("arthur_discord").select("*").eq("owner", hub.owner).maybeSingle();
  return data ?? { owner: hub.owner, guild_id: null, discord_user_id: null, allowed_users: [], channels: {} };
}
export async function send(channelId: string, kind: string, e: { title: string; text?: string; url?: string; color?: number }) {
  const r = await bot(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ embeds: [{
    title: e.title.slice(0, 256), description: e.text?.slice(0, 4000), url: e.url, color: e.color ?? GOLD,
    author: { name: KIND_NAME[kind] ?? "A.R.T.H.U.R.", icon_url: AVATAR[kind] ?? AVATAR.arthur },
    footer: { text: "A.R.T.H.U.R." }, timestamp: new Date().toISOString(),
  }] }) });
  return { ok: r.ok, status: r.status };
}

export const num = (s?: string) => { const n = Number(String(s ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
