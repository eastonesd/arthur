// /todo、/agenda、/todos（寫進儀表板的 jarvis_state）
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { AVATAR, GOLD, KIND_NAME, type Result } from "./shared.ts";
import { niceDate, parseDate, parseTime, todayTaipei } from "./when.ts";

// ---------- 待辦與行事曆（寫進儀表板的 jarvis_state） ----------
// 與儀表板相同的格式：每筆有 id 與更新時間 u；儀表板同步時依 id 合併、取較新的那筆，所以不會互相覆蓋。
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export type Todo = { id: string; title: string; due?: string; done?: boolean; doneAt?: string; u?: number };
export type Agenda = { id: string; date: string; time?: string; title: string; where?: string; u?: number };
export async function loadState(db: SupabaseClient, owner: string): Promise<Record<string, any>> {
  const { data, error } = await db.from("jarvis_state").select("data").eq("owner", owner).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.data ?? {}) as Record<string, any>;
}
export async function saveState(db: SupabaseClient, owner: string, data: Record<string, any>) {
  const { error } = await db.from("jarvis_state").upsert({ owner, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
export const openTodos = (todos: Todo[]) => todos.filter((t) => !t.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
export const dueText = (due?: string) => {
  if (!due) return "";
  const t = todayTaipei();
  return due < t ? `⚠️ 已過期 ${niceDate(due)}` : niceDate(due);
};
export const DATE_HELP = "例：今天、明天、後天、週五、下週一、11/20、3天後";

export async function todoAdd(db: SupabaseClient, owner: string, d: Record<string, string>): Promise<Result> {
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

export async function agendaAdd(db: SupabaseClient, owner: string, d: Record<string, string>): Promise<Result> {
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
export async function todosView(db: SupabaseClient, owner: string, note?: string) {
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

export async function todoDone(db: SupabaseClient, owner: string, id: string) {
  const data = await loadState(db, owner);
  const todos: Todo[] = Array.isArray(data.todos) ? data.todos : [];
  const x = todos.find((t) => t.id === id);
  if (!x) return "找不到這項待辦，可能已經在儀表板刪掉了。";
  if (x.done) return `「${x.title}」早就完成了。`;
  x.done = true; x.doneAt = new Date().toISOString(); x.u = Date.now();
  await saveState(db, owner, { ...data, todos });
  return `✅ 已完成「${x.title}」。`;
}
