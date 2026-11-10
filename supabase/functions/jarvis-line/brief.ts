// ============================================================
// A.R.T.H.U.R. 推播內容（純函式，沒有外部相依，可在本機測試）
// ============================================================

export type Person = { name: string; birthday: string; group: string };
export type AgendaItem = { id?: string; date: string; time?: string; title: string; where?: string };
export type Todo = { id: string; title: string; due?: string; done?: boolean };
export type Income = { id: string; date: string; amount: number; note?: string };
export type Fixed = { id: string; dir: "in" | "out"; name: string; day: number; amount: number };
export type JarvisData = {
  people?: Person[];
  agenda?: AgendaItem[];
  todos?: Todo[];
  ledger?: { items?: unknown[]; fixed?: Fixed[]; income?: Income[]; goal?: number } | null;
  gcal?: { date: string; events: { time: string; title: string; where?: string }[] } | null;
  routines?: Routine[];
};
export type Routine = { label: string; time: string; msg?: string };
export type HubStatus = Record<string, { name: string; repo: string; kind: string; health: string; headline?: string; failed?: { name: string; at: string }[]; site?: { ok: boolean } | null }>;

// 早安簡報的「專案」段落：有狀況的專案 + 有成果的專案
export function projectLines(hub: HubStatus | null | undefined): string[] {
  if (!hub) return [];
  const all = Object.values(hub);
  const lines: string[] = [];
  for (const p of all.filter((x) => x.health === "fail")) {
    const why = (p.failed ?? []).map((f) => `「${f.name}」失敗`).concat(p.site && !p.site.ok ? ["網站打不開"] : []);
    lines.push(`・⚠️ ${p.name}：${why.join("、") || "需要處理"}`);
  }
  for (const p of all.filter((x) => x.headline && !x.headline.startsWith("示範模式") && x.health !== "fail" && (x.kind === "saga" || x.kind === "ec" || x.kind === "generic"))) lines.push(`・${p.name}：${p.headline}`);
  if (!lines.length) return [];
  return ["", "🛠 專案", ...lines.slice(0, 6)];
}

// 生活提醒預設值（儀表板可改，存在 jarvis_state.routines）
export const DEFAULT_ROUTINES: Routine[] = [
  { label: "午餐", time: "12:00", msg: "先生，午餐時間到了，該去吃飯了。" },
  { label: "洗澡", time: "17:00", msg: "先生，17:00 了，該去洗澡了。" },
  { label: "睡覺", time: "23:00", msg: "先生，已經 23:00，該上床睡覺了。明天見。" },
];

// 這一輪排程（每 5 分鐘）該發的生活提醒
export function routinesDue(data: JarvisData, now = taipeiNow(), windowMin = 5) {
  const list = data.routines?.length ? data.routines : DEFAULT_ROUTINES;
  return list.filter((r) => { const m = mins(r.time); return m >= 0 && now.minutes >= m && now.minutes < m + windowMin; })
    .map((r) => ({ ...r, msg: r.msg || `先生，${r.time} 了，提醒您：${r.label}。` }));
}

// 台北時間
export function taipeiNow(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600_000);
  const iso = t.toISOString();
  return { date: iso.slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), day: t.getUTCDate(), year: t.getUTCFullYear(), month: t.getUTCMonth() };
}

const mins = (hhmm?: string) => (hhmm && /^\d\d:\d\d$/.test(hhmm) ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) : -1);
const money = (n: number) => Math.round(n).toLocaleString("en-US");

// 東石系統客戶 + 生日簿；同名以生日簿為準
export function everyone(data: JarvisData, clients: { name: string; birthday: string }[]): Person[] {
  const people = data.people ?? [];
  const own = new Set(people.map((p) => p.name));
  return [...clients.filter((c) => !own.has(c.name)).map((c) => ({ ...c, group: "客戶" })), ...people];
}

export function birthdaysOn(list: Person[], dateIso: string): Person[] {
  const md = dateIso.slice(5);
  return list.filter((p) => (p.birthday || "").slice(5) === md);
}

// 今天的行程：手動登打 + 當天快取的 Google 日曆
export function todaysEvents(data: JarvisData, dateIso: string) {
  const manual = (data.agenda ?? []).filter((a) => a.date === dateIso).map((a) => ({ time: a.time || "", title: a.title, where: a.where || "" }));
  const g = data.gcal && data.gcal.date === dateIso ? data.gcal.events.map((e) => ({ time: e.time === "全天" ? "" : e.time, title: e.title, where: e.where || "" })) : [];
  return [...g, ...manual].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

// N 天內（含今天）要付的固定支出
export function duePayments(data: JarvisData, now: ReturnType<typeof taipeiNow>, withinDays = 3) {
  const out: { name: string; amount: number; left: number; label: string }[] = [];
  for (const f of data.ledger?.fixed ?? []) {
    if (f.dir !== "out") continue;
    for (const add of [0, 1]) {
      const y = now.year, m = now.month + add;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const d = new Date(Date.UTC(y, m, Math.min(f.day, last)));
      const today = Date.UTC(now.year, now.month, now.day);
      const left = Math.round((d.getTime() - today) / 86400000);
      if (left >= 0 && left <= withinDays) { out.push({ name: f.name, amount: f.amount, left, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` }); break; }
    }
  }
  return out.sort((a, b) => a.left - b.left);
}

export function openTodos(data: JarvisData, dateIso: string) {
  return (data.todos ?? []).filter((t) => !t.done).map((t) => ({ ...t, overdue: !!t.due && t.due < dateIso, today: t.due === dateIso }))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
}

// 早安簡報
export function morningBrief(data: JarvisData, clients: { name: string; birthday: string }[], now = taipeiNow(), hub?: HubStatus | null) {
  const events = todaysEvents(data, now.date);
  const bdays = birthdaysOn(everyone(data, clients), now.date);
  const clientB = bdays.filter((p) => p.group === "客戶"), otherB = bdays.filter((p) => p.group !== "客戶");
  const pays = duePayments(data, now);
  const todos = openTodos(data, now.date);
  const first = events.find((e) => e.time);

  const lines: string[] = [];
  lines.push("早上好，葉里克先生。");
  lines.push(`今天您有 ${events.length} 項行程，有 ${clientB.length} 位客戶生日，以及 ${pays.length} 筆即將到期的款項。`);
  lines.push(first ? `您的第一個行程將於 ${first.time} 開始。` : events.length ? "今天的行程都是全天事項。" : "今天沒有排定的行程。");

  if (events.length) {
    lines.push("", "📅 行程");
    events.forEach((e) => lines.push(`・${e.time || "全天"}　${e.title}${e.where ? `（${e.where}）` : ""}`));
  }
  if (bdays.length) {
    lines.push("", "🎂 今日壽星");
    if (clientB.length) lines.push(`・客戶：${clientB.map((p) => p.name).join("、")}`);
    if (otherB.length) lines.push(`・${[...new Set(otherB.map((p) => p.group))].join("／")}：${otherB.map((p) => p.name).join("、")}`);
  }
  if (pays.length) {
    lines.push("", "💳 即將到期的款項（3 天內）");
    pays.forEach((p) => lines.push(`・${p.label} ${p.name}　NT$ ${money(p.amount)}${p.left === 0 ? "（今天）" : ""}`));
  }
  if (todos.length) {
    lines.push("", `✅ 待辦 ${todos.length} 項`);
    todos.slice(0, 6).forEach((t) => lines.push(`・${t.title}${t.overdue ? "（已逾期）" : t.today ? "（今天）" : t.due ? `（${+t.due.slice(5, 7)}/${+t.due.slice(8)}）` : ""}`));
    if (todos.length > 6) lines.push(`・…另有 ${todos.length - 6} 項`);
  }
  lines.push(...projectLines(hub));
  if (bdays.length) lines.push("", "需為您準備生日祝福嗎？");
  return { text: lines.join("\n"), birthdays: bdays, events, todos };
}

// 一小時內即將開始、且有時間的行程
export function upcomingEvents(data: JarvisData, now = taipeiNow(), withinMinutes = 60) {
  return todaysEvents(data, now.date)
    .map((e) => ({ ...e, left: mins(e.time) - now.minutes }))
    .filter((e) => e.time && e.left > 0 && e.left <= withinMinutes);
}

export function eventReminderText(list: ReturnType<typeof upcomingEvents>) {
  const lines = ["先生，提醒您接下來的行程："];
  list.forEach((e) => lines.push(`・${e.time}　${e.title}${e.where ? `（${e.where}）` : ""}，約 ${e.left} 分鐘後開始`));
  return lines.join("\n");
}

// 晚間待辦追蹤：今天到期或已逾期、還沒完成的
export function eveningTodos(data: JarvisData, now = taipeiNow()) {
  return openTodos(data, now.date).filter((t) => t.today || t.overdue);
}

// 祝福範本：客戶固定用公版；朋友家人在沒有 AI 金鑰時用這裡的範本
export function fallbackGreeting(p: Person, i = 0): string {
  const name = p.name;
  // 客戶一律用這則公版（固定文字，不交給 AI 改寫）
  const client = [
    `${name}您好，祝您生日快樂！感謝這段時間的信任與支持，願新的一歲身體健康、平安順心，有任何保險及金融相關需求我都在。`,
  ];
  const friend = [
    `${name}生日快樂！🎉 新的一歲繼續發光，願你健康、快樂，想做的事都順順利利！`,
    `生日快樂呀${name}！🎂 祝你新的一歲吃好睡好、好運連連，找時間一起吃個飯！`,
  ];
  const pool = p.group === "客戶" ? client : friend;
  return pool[i % pool.length];
}

// 每月收入目標進度（每月 15 日推播）
export const DEFAULT_GOAL = 180000;
export function goalProgress(data: JarvisData, now = taipeiNow()) {
  const goal = Number(data.ledger?.goal) || DEFAULT_GOAL;
  const ym = now.date.slice(0, 7);
  const list = (data.ledger?.income ?? []).filter((x) => (x.date || "").startsWith(ym));
  const sum = list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const pct = goal ? (sum / goal) * 100 : 0;
  const pctTxt = `${pct >= 100 ? Math.floor(pct) : Math.round(pct * 10) / 10}%`;
  const month = now.month + 1;
  const daysInMonth = new Date(Date.UTC(now.year, now.month + 1, 0)).getUTCDate();
  const timePct = Math.round((now.day / daysInMonth) * 100);
  const lines = [`先生，${month} 月已過一半，收入目標進度回報：`, "",
    `▸ 進度 ${pctTxt}`, `▸ 已進帳 NT$ ${money(sum)} / ${money(goal)}（${list.length} 筆）`];
  if (sum >= goal) lines.push(`▸ 已超標 NT$ ${money(sum - goal)}`, "", "目標已提前達成。剩下的日子，就當作是額外的紅利吧。");
  else {
    const left = goal - sum, days = daysInMonth - now.day;
    lines.push(`▸ 還差 NT$ ${money(left)}，剩 ${days} 天，平均每天需 NT$ ${money(left / Math.max(days, 1))}`, "",
      pct >= timePct ? "步調領先時間進度，請保持。" : `時間已走了 ${timePct}%，進度稍微落後，接下來需要加把勁了。`);
  }
  return { goal, sum, pct, text: lines.join("\n") };
}
