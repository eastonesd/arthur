// ============================================================
// 把口語的日期、時間轉成儀表板用的格式（純函式，可在本機測試）
//   日期 → "YYYY-MM-DD"：今天、明天、後天、大後天、3天後、週五、下週一、11/20、11月20日、2026-11-20
//   時間 → "HH:MM"：14:30、1430、14點、下午3點、下午3點半、晚上8:15、中午、早上9點
//          沒說上下午的 1～6 點當作下午（凌晨請寫「凌晨3點」）
// 一律以台北時間計算。看不懂時回傳 null，留白回傳 ""。
// ============================================================

const DAY = 86400_000;
const WEEK: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const CN: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// 台北今天 00:00 的 UTC 毫秒（只拿來做日期運算）
const taipeiMidnight = (now: Date) => { const t = new Date(now.getTime() + 8 * 3600_000); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const valid = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.getTime() : null; };

// 「十二」「二十」「三」之類的中文數字（到 99）
function cnNum(s: string): number | null {
  if (/^\d+$/.test(s)) return +s;
  if (!s || [...s].some((c) => !(c in CN))) return null;
  if (s === "十") return 10;
  const i = s.indexOf("十");
  if (i < 0) return s.length === 1 ? CN[s] : null;
  return (i === 0 ? 1 : CN[s.slice(0, i)]) * 10 + (s.slice(i + 1) ? CN[s.slice(i + 1)] : 0);
}

export function parseDate(input: string, now = new Date()): string | null {
  const s = (input ?? "").replace(/\s+/g, "").replace(/[／]/g, "/").replace(/[－]/g, "-");
  if (!s) return "";
  const today = taipeiMidnight(now);
  const rel: Record<string, number> = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 後天: 2, 大後天: 3 };
  if (s in rel) return iso(today + rel[s] * DAY);

  let m = s.match(/^(\d+|[一二兩三四五六七八九十]+)天(後|以後|之後)$/);
  if (m) { const n = cnNum(m[1]); return n === null ? null : iso(today + n * DAY); }

  // 週五／星期五／禮拜五／下週一／下下週三
  m = s.match(/^((?:下)*)(?:這|本)?(?:週|周|星期|禮拜|拜)([一二三四五六日天])$/);
  if (m) {
    const target = WEEK[m[2]], dow = new Date(today).getUTCDay(), next = m[1].length;
    if (!next) return iso(today + ((target - dow + 7) % 7) * DAY);          // 本週還沒過的那天（今天也算）
    const monday = today - ((dow + 6) % 7) * DAY;                            // 以週一為一週的開始
    return iso(monday + next * 7 * DAY + ((target + 6) % 7) * DAY);
  }

  // 2026-11-20、2026/11/20、2026年11月20日
  m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日號]?$/);
  if (m) { const t = valid(+m[1], +m[2], +m[3]); return t === null ? null : iso(t); }

  // 11/20、11-20、11.20、11月20日、十一月二十號 → 今年；已經過了就算明年
  m = s.match(/^(\d{1,2}|[一二三四五六七八九十]+)[-/.月](\d{1,2}|[一二三四五六七八九十]+)[日號]?$/);
  if (m) {
    const mo = cnNum(m[1]), d = cnNum(m[2]);
    if (mo === null || d === null) return null;
    const y = new Date(today).getUTCFullYear();
    let t = valid(y, mo, d);
    if (t !== null && t < today) t = valid(y + 1, mo, d);
    return t === null ? null : iso(t);
  }

  // 只寫「20號」「20日」→ 這個月，過了就下個月
  m = s.match(/^(\d{1,2}|[一二三四五六七八九十]+)[日號]$/);
  if (m) {
    const d = cnNum(m[1]); if (d === null) return null;
    const t0 = new Date(today), y = t0.getUTCFullYear(), mo = t0.getUTCMonth() + 1;
    let t = valid(y, mo, d);
    if (t === null || t < today) t = mo === 12 ? valid(y + 1, 1, d) : valid(y, mo + 1, d);
    return t === null ? null : iso(t);
  }
  return null;
}

export function parseTime(input: string): string | null {
  let s = (input ?? "").replace(/\s+/g, "").replace(/[：]/g, ":");
  if (!s || s === "全天" || s === "整天") return "";
  let pm: boolean | null = null;
  const pre = s.match(/^(凌晨|清晨|早上|上午|早|中午|下午|傍晚|晚上|夜裡|半夜)/);
  if (pre) {
    s = s.slice(pre[1].length);
    pm = ["下午", "傍晚", "晚上", "夜裡"].includes(pre[1]) ? true : pre[1] === "中午" ? null : false;
    if (pre[1] === "中午" && !s) return "12:00";
  }
  let h: number | null = null, mi = 0;
  let m = s.match(/^(\d{1,2}):(\d{2})$/) || s.match(/^(\d{2})(\d{2})$/);
  if (m) { h = +m[1]; mi = +m[2]; }
  else {
    m = s.match(/^(\d{1,2}|[一二兩三四五六七八九十]+)[點时時](半|(\d{1,2}|[一二三四五六七八九十]+)分?)?$/);
    if (m) {
      h = cnNum(m[1]);
      if (m[2] === "半") mi = 30; else if (m[3]) mi = cnNum(m[3]) ?? -1;
    }
  }
  if (h === null || mi < 0 || mi > 59 || h > 24) return null;
  if (pm === true && h < 12) h += 12;
  if (pm === false && pre?.[1] && ["凌晨", "半夜"].includes(pre[1]) && h === 12) h = 0;
  if (pre?.[1] === "中午" && h < 6) h += 12;            // 中午1點 = 13:00
  if (!pre && h >= 1 && h <= 6) h += 12;               // 沒說上下午的「3點」「3:30」當作下午（凌晨請寫「凌晨3點」）
  if (h === 24) h = 0;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

// 給人看的日期：今天、明天、11/20（週五）
export function niceDate(dateIso: string, now = new Date()): string {
  if (!dateIso) return "";
  const today = taipeiMidnight(now), t = Date.parse(dateIso + "T00:00:00Z");
  const diff = Math.round((t - today) / DAY);
  const w = "日一二三四五六"[new Date(t).getUTCDay()];
  const md = `${+dateIso.slice(5, 7)}/${+dateIso.slice(8, 10)}（週${w}）`;
  return diff === 0 ? `今天 ${md}` : diff === 1 ? `明天 ${md}` : diff === 2 ? `後天 ${md}` : md;
}
export const todayTaipei = (now = new Date()) => iso(taipeiMidnight(now));
