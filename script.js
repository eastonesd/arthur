/* JARVIS personal dashboard */
(() => {
  "use strict";
  const CFG = Object.assign({ googleClientId: "", calendarId: "primary", routines: [] }, window.JARVIS_CONFIG || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const money = (n) => Math.round(n).toLocaleString("zh-TW");
  const num = (s) => { const v = parseFloat(String(s).replace(/[,\s，]/g, "")); return Number.isFinite(v) ? v : NaN; };
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const KEYS = { clients: "jarvis.clients", book: "jarvis.book", people: "jarvis.people", ledger: "jarvis.ledger", agenda: "jarvis.agenda" };
  const SYNCED = ["people", "ledger", "agenda"];    // 會同步到 Supabase 的資料
  const state = {
    events: null, mail: null, fx: null,
    clients: store.get(KEYS.clients),               // imported from 東石系統
    book: store.get(KEYS.book),                     // policy stats from 東石系統
    people: store.get(KEYS.people, []),             // typed in by hand
    ledger: store.get(KEYS.ledger, null),           // { items:[], fixed:[] }
    agenda: store.get(KEYS.agenda, []),             // 手動登打的行程
    cloudClients: null, cloudPolicies: null,        // 從東石系統（Supabase）讀到的客戶
  };
  // 本機儲存 + 排程上傳雲端
  function persist() {
    SYNCED.forEach((k) => store.set(KEYS[k], state[k]));
    store.set("jarvis.savedAt", Date.now());
    cloud.schedulePush();
  }

  /* ---------- clock ---------- */
  const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
  function tick() {
    const d = new Date();
    $("time").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $("date").textContent = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}（${WEEK[d.getDay()]}）`;
  }
  tick(); setInterval(tick, 10000);

  /* ---------- starfield ---------- */
  (function stars() {
    const cv = $("stars"), ctx = cv.getContext("2d");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W, H, pts = [];
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pts = Array.from({ length: Math.round(W * H / 5000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.2 + .2, p: Math.random() * 6.28, g: Math.random() < .15 }));
    }
    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      const neb = ctx.createRadialGradient(W * .85, H * .1, 0, W * .85, H * .1, W * .5);
      neb.addColorStop(0, "rgba(40,90,170,.18)"); neb.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
      const neb2 = ctx.createRadialGradient(W * .12, H * .95, 0, W * .12, H * .95, W * .4);
      neb2.addColorStop(0, "rgba(200,130,40,.12)"); neb2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H);
      for (const s of pts) {
        const a = .35 + .5 * Math.abs(Math.sin(t / 1600 + s.p));
        ctx.fillStyle = s.g ? `rgba(255,200,120,${a})` : `rgba(200,225,255,${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    size(); addEventListener("resize", size); requestAnimationFrame(draw);
  })();

  /* ---------- dialogs ---------- */
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
  const open = (id) => { const d = $(id); if (d.showModal) d.showModal(); else d.setAttribute("open", ""); };

  /* ---------- routines ---------- */
  $("routines").innerHTML = CFG.routines.map((r) => `<span class="routine">${esc(r.label)} <b>${esc(r.time)}</b></span>`).join("");

  /* ---------- dates ---------- */
  function valid(y, mo, d) {
    const t = new Date(y, mo - 1, d);
    return t.getMonth() === mo - 1 && t.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  function normDate(s) {
    s = String(s || "").trim(); if (!s) return null;
    let m = /^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(s);
    if (!m && /^\d{7,8}$/.test(s)) m = [s, s.slice(0, s.length - 4), s.slice(-4, -2), s.slice(-2)];
    if (m) { let y = +m[1]; if (y < 200) y += 1911; return valid(y, +m[2], +m[3]); } // 民國年 → 西元
    m = /^(\d{1,2})[\/\-.月](\d{1,2})日?$/.exec(s);
    if (m) return valid(2000, +m[1], +m[2]);      // 不知道年份時記成 2000 年
    return null;
  }
  function daysUntilBirthday(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if (!m) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let b = new Date(t.getFullYear(), +m[2] - 1, +m[3]);
    if (b < t) b = new Date(t.getFullYear() + 1, +m[2] - 1, +m[3]);
    return Math.round((b - t) / 86400000);
  }
  const mdLabel = (iso) => iso.slice(0, 4) === "2000" ? `${+iso.slice(5, 7)}/${+iso.slice(8)}` : iso.replace(/-/g, "/");

  /* ---------- people (imported + typed in) ---------- */
  const SAMPLE_PEOPLE = (() => {
    const d = new Date(), md = (off) => { const x = new Date(d); x.setDate(x.getDate() + off); return `1985-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    return [["林小姐", 0], ["張先生", 3], ["黃太太", 6], ["吳先生", 12], ["李小姐", 21], ["陳先生", 27]].map(([name, o]) => ({ name, birthday: md(o), group: "客戶" }));
  })();
  const clientSource = () => state.cloudClients || state.clients || [];
  const hasPeopleData = () => clientSource().length > 0 || state.people.length > 0;
  function everyone() {
    if (!hasPeopleData()) return SAMPLE_PEOPLE;
    return [...clientSource().map((c) => ({ ...c, group: "客戶" })), ...state.people];
  }
  const todaysBirthdays = () => everyone().filter((c) => daysUntilBirthday(c.birthday) === 0);

  function renderPeople() {
    const list = everyone(), live = hasPeopleData();
    const within = (n) => list.filter((c) => { const d = daysUntilBirthday(c.birthday); return d !== null && d <= n; })
      .sort((a, b) => daysUntilBirthday(a.birthday) - daysUntilBirthday(b.birthday));
    const today = within(0), week = within(7), month = within(30);
    const names = (arr) => arr.slice(0, 2).map((c) => c.name).join("、") + (arr.length > 2 ? "…" : "");
    const rows = [["今日生日", today], ["7 天內生日", week], ["30 天內生日", month]]
      .map(([k, arr]) => `<li><span class="k">${k}${arr.length ? `<small>${esc(names(arr))}</small>` : ""}</span><span class="v">${arr.length}</span></li>`);
    rows.push(`<li><span class="k">生日簿人數</span><span class="v">${list.length}</span></li>`);
    const policies = state.cloudPolicies ?? state.book?.policies;
    if (policies != null) rows.push(`<li><span class="k">有效保單<small>東石系統</small></span><span class="v">${policies}</span></li>`);
    $("clientStats").innerHTML = rows.join("");
    const tag = $("clientTag");
    tag.textContent = state.cloudClients ? "東石系統" : live ? "已登錄" : "範例"; tag.classList.toggle("live", live);
    state.bdayWeek = week.length;
    drawRadar(list);
    renderAgenda();
    renderPeopleDialog();
  }
  function drawRadar(list) {
    const cv = $("radar"), S = cv.clientWidth || 150, ctx = cv.getContext("2d"), dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = S * dpr; cv.height = S * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = S / 2, R = S / 2 - 6;
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = "rgba(94,200,255,.28)"; ctx.lineWidth = 1;
    [1, .66, .33].forEach((f) => { ctx.beginPath(); ctx.arc(c, c, R * f, 0, 6.283); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();
    // distance from centre = days until birthday (0–30)
    list.forEach((p, i) => {
      const d = daysUntilBirthday(p.birthday); if (d === null || d > 30) return;
      const a = (i * 2.399) % 6.283, r = 8 + (R - 10) * d / 30, hot = d <= 7;
      ctx.fillStyle = hot ? "#f5b43a" : "#5ec8ff"; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, hot ? 4 : 3, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
    });
    ctx.fillStyle = "#f5b43a"; ctx.beginPath(); ctx.arc(c, c, 4, 0, 6.283); ctx.fill();
  }
  if (window.ResizeObserver) new ResizeObserver(() => drawRadar(everyone())).observe($("radar"));

  /* 生日簿 dialog */
  function renderPeopleDialog() {
    const ps = [...state.people].sort((a, b) => daysUntilBirthday(a.birthday) - daysUntilBirthday(b.birthday));
    $("peopleList").innerHTML = ps.length ? ps.map((p) => {
      const d = daysUntilBirthday(p.birthday);
      return `<li><span class="n">${esc(p.name)}<small>${esc(p.group)}</small></span><span class="m">${mdLabel(p.birthday)}${d === 0 ? "・今天" : `・${d} 天後`}</span><button class="del" type="button" data-del-person="${p.id}" aria-label="刪除 ${esc(p.name)}">刪除</button></li>`;
    }).join("") : `<li class="empty-note">還沒有手動登打的生日。</li>`;
    const n = (state.clients || []).length;
    $("importHint").textContent = state.cloudClients ? `已連線東石系統，客戶 ${state.cloudClients.length} 位` : n ? `已匯入東石系統客戶 ${n} 位` : "";
    $("clearImport").hidden = !n;
  }
  $("openPeople").addEventListener("click", () => { renderPeopleDialog(); open("dlgPeople"); $("pName").focus(); });
  $("personForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("pName").value.trim(), birthday = normDate($("pBday").value);
    if (!birthday) { $("pMsg").textContent = "生日格式看不懂，請用 1990-05-12、民國 79/05/12 或 05/12。"; return; }
    state.people.push({ id: uid(), name, birthday, group: $("pGroup").value });
    persist();
    $("pMsg").textContent = ""; $("pName").value = ""; $("pBday").value = ""; $("pName").focus();
    renderPeople();
  });
  $("peopleList").addEventListener("click", (e) => {
    const id = e.target.dataset.delPerson; if (!id) return;
    state.people = state.people.filter((p) => p.id !== id);
    persist(); renderPeople();
  });
  $("clearImport").addEventListener("click", () => {
    state.clients = null; state.book = null;
    store.set(KEYS.clients, null); store.set(KEYS.book, null); renderPeople();
  });

  /* 匯入：東石系統 clients.db（sql.js 讀 SQLite）或 CSV */
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function importCSV(text) {
    const rows = parseCSV(text.replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw new Error("檔案裡沒有資料列");
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (...keys) => head.findIndex((h) => keys.some((k) => h.includes(k)));
    const iName = find("姓名", "名字", "客戶", "name"), iBday = find("生日", "出生", "birth");
    if (iName < 0 || iBday < 0) throw new Error("找不到「姓名」或「生日」欄位");
    const out = rows.slice(1).map((r) => ({ name: (r[iName] || "").trim(), birthday: normDate(r[iBday]) })).filter((c) => c.name && c.birthday);
    if (!out.length) throw new Error("生日欄位的日期格式無法辨識");
    return out;
  }
  const SQLJS = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/";
  function loadSqlJs() {
    if (window.initSqlJs) return window.initSqlJs({ locateFile: (f) => SQLJS + f });
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = SQLJS + "sql-wasm.js";
      s.onload = () => res(window.initSqlJs({ locateFile: (f) => SQLJS + f }));
      s.onerror = () => rej(new Error("無法載入 SQLite 讀取元件"));
      document.head.appendChild(s);
    });
  }
  async function importDb(buf) {
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(buf));
    try {
      const all = (sql) => { const r = db.exec(sql)[0]; return r ? r.values : []; };
      const tables = all("select name from sqlite_master where type='table'").map((r) => r[0]);
      if (!tables.includes("clients")) throw new Error("資料庫裡沒有 clients 資料表");
      const list = all("select name, birthday from clients").map(([name, b]) => ({ name: String(name || "").trim(), birthday: normDate(b) }))
        .filter((c) => c.name && c.birthday);
      let book = null;
      if (tables.includes("policies")) {
        book = { policies: 0, premium: {} };
        all("select coalesce(currency,'TWD'), count(*), coalesce(sum(total_premium),0) from policies where client_id in (select id from clients) group by 1")
          .forEach(([cur, n, sum]) => { book.policies += n; book.premium[cur] = sum; });
      }
      return { list, book };
    } finally { db.close(); }
  }
  $("importInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const hint = $("importHint");
    hint.textContent = "匯入中…";
    try {
      const buf = await f.arrayBuffer();
      if (new TextDecoder("ascii").decode(buf.slice(0, 15)) === "SQLite format 3") {
        const { list, book } = await importDb(buf);
        if (!list.length) throw new Error("沒有可用的生日資料");
        state.clients = list; state.book = book;
      } else {
        let text = new TextDecoder("utf-8").decode(buf);
        if (text.includes("\uFFFD")) text = new TextDecoder("big5").decode(buf); // Excel 存成 Big5 的 CSV
        state.clients = importCSV(text); state.book = null;
      }
      store.set(KEYS.clients, state.clients); store.set(KEYS.book, state.book);
      renderPeople();
    } catch (err) { hint.textContent = `匯入失敗：${err.message}`; }
    e.target.value = "";
  });

  /* ---------- 今日指揮中心 ---------- */
  const SAMPLE_EVENTS = [
    { time: "10:30", title: "王先生 保單檢視" }, { time: "14:00", title: "拜訪 陳小姐" },
    { time: "17:30", title: "寄出解約文件" }, { time: "20:00", title: "整理客戶資料" },
  ];
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  function renderAgenda() {
    const live = Array.isArray(state.events);
    const manual = state.agenda.filter((a) => a.date === todayISO()).map((a) => ({ time: a.time || "全天", title: a.title, where: a.where }));
    const useSample = !live && state.agenda.length === 0;
    const events = [...(live ? state.events : useSample ? SAMPLE_EVENTS : []), ...manual]
      .sort((a, b) => (a.time === "全天" ? "" : a.time).localeCompare(b.time === "全天" ? "" : b.time));
    const items = [...todaysBirthdays().map((c) => ({ time: "全天", title: `${c.name} 生日`, bday: true })), ...events];
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const mins = (t) => /^\d\d:\d\d$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : -1;
    const nextIdx = items.findIndex((e) => mins(e.time) >= nowMin);
    const el = $("agenda");
    el.classList.toggle("has-items", items.length > 0);
    el.innerHTML = items.length ? items.map((e, i) => {
      const m = mins(e.time), cls = ["item", e.bday ? "bday" : "", i === nextIdx ? "now" : "", m >= 0 && m < nowMin && i !== nextIdx ? "past" : ""].join(" ");
      return `<li class="${cls}"><span class="pin"></span><span class="t">${esc(e.time)}</span><span class="what">${esc(e.title)}${e.where ? `<small>${esc(e.where)}</small>` : ""}</span></li>`;
    }).join("") : `<li class="empty-note">今天沒有行程，先生可以喘口氣。</li>`;
    const tag = $("agendaTag");
    tag.textContent = live ? "Google 日曆" : useSample ? "範例" : "手動"; tag.classList.toggle("live", !useSample);
    state.agendaCount = events.length;
    renderSummary();
  }

  /* 行程登打 dialog */
  function renderAgendaDialog() {
    const t = todayISO();
    const list = state.agenda.filter((a) => a.date >= t).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    $("agendaList").innerHTML = list.length ? list.map((a) => {
      const [, m, d] = a.date.split("-");
      const day = a.date === t ? "今天" : `${+m}/${+d}`;
      return `<li><span class="n">${esc(a.title)}${a.where ? `<small>${esc(a.where)}</small>` : ""}</span><span class="m">${day} ${a.time || "全天"}</span><button class="del" type="button" data-del-agenda="${a.id}" aria-label="刪除 ${esc(a.title)}">刪除</button></li>`;
    }).join("") : `<li class="empty-note">還沒有手動登打的行程。</li>`;
  }
  $("openAgenda").addEventListener("click", () => { $("aDate").value = todayISO(); renderAgendaDialog(); open("dlgAgenda"); $("aTitle").focus(); });
  $("agendaForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.agenda.push({ id: uid(), date: $("aDate").value, time: $("aTime").value, title: $("aTitle").value.trim(), where: $("aWhere").value.trim() });
    state.agenda = state.agenda.filter((a) => a.date >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)); // 只留最近 30 天以後的
    persist(); renderAgenda(); renderAgendaDialog();
    $("aTitle").value = ""; $("aTime").value = ""; $("aWhere").value = ""; $("aTitle").focus();
  });
  $("agendaList").addEventListener("click", (e) => {
    const id = e.target.dataset.delAgenda; if (!id) return;
    state.agenda = state.agenda.filter((a) => a.id !== id);
    persist(); renderAgenda(); renderAgendaDialog();
  });

  /* ---------- 通訊中心 ---------- */
  const SAMPLE_MAIL = { unread: 12, items: [
    { from: "王先生", subject: "保單資料補件", when: "08:42", important: true },
    { from: "保險公司", subject: "契約審核通知", when: "昨天", important: false },
    { from: "合作廠商", subject: "報價單已寄出，請確認", when: "11/01", important: false },
  ] };
  function renderMail() {
    const live = !!state.mail, m = state.mail || SAMPLE_MAIL;
    $("mailCount").textContent = m.unread;
    $("mailRing").style.strokeDashoffset = 264 - 264 * Math.min(m.unread, 30) / 30;
    $("mailList").innerHTML = m.items.length ? m.items.map((x) =>
      `<li><span class="dot${x.important ? " imp" : ""}"></span><span class="from">${esc(x.from)}</span><span class="when">${esc(x.when)}</span><span class="subj">${esc(x.subject)}</span></li>`
    ).join("") : `<li class="empty-note">收件匣沒有未讀信件。</li>`;
    const tag = $("mailTag");
    tag.textContent = live ? "Gmail" : "範例"; tag.classList.toggle("live", live);
    state.unread = m.unread;
    renderSummary();
  }

  function renderSummary() {
    $("summary").innerHTML = `今日 <b>${state.agendaCount ?? "–"}</b> 個行程・<b>${state.bdayWeek ?? "–"}</b> 位生日將至・<b>${state.unread ?? "–"}</b> 封未讀郵件`;
  }

  /* ---------- 金流 / 帳務 ---------- */
  const SAMPLE_LEDGER = {
    items: [
      { id: "s1", kind: "asset", name: "活存", amount: 320000, cur: "TWD" },
      { id: "s2", kind: "asset", name: "美元定存", amount: 10000, cur: "USD" },
      { id: "s3", kind: "debt", name: "信用貸款", amount: 180000, cur: "TWD" },
    ],
    fixed: [
      { id: "f1", dir: "in", name: "薪水", day: 10, amount: 52000 },
      { id: "f2", dir: "out", name: "房租", day: 5, amount: 15000 },
      { id: "f3", dir: "out", name: "信用卡", day: 12, amount: 12000 },
      { id: "f4", dir: "out", name: "APP 訂閱", day: 6, amount: 1290 },
    ],
  };
  const ledger = () => state.ledger || SAMPLE_LEDGER;
  const toTWD = (amt, cur) => cur === "USD" ? amt * (state.fx || 32) : amt;
  function nextDate(day) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const at = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
    let d = at(t.getFullYear(), t.getMonth());
    if (d < t) d = at(t.getFullYear(), t.getMonth() + 1);
    return { date: d, left: Math.round((d - t) / 86400000) };
  }
  function renderMoney() {
    const L = ledger(), live = !!state.ledger;
    const assets = L.items.filter((i) => i.kind === "asset").reduce((s, i) => s + toTWD(i.amount, i.cur), 0);
    const debts = L.items.filter((i) => i.kind === "debt").reduce((s, i) => s + toTWD(i.amount, i.cur), 0);
    const hasUSD = L.items.some((i) => i.cur === "USD");
    $("nw").textContent = L.items.length ? `NT$ ${money(assets - debts)}` : "–";
    $("nwSub").textContent = L.items.length ? `資產 ${money(assets)}・負債 ${money(debts)}${hasUSD && !state.fx ? "・美元以 32 估算" : ""}` : "尚未登打資產負債";
    const out = L.fixed.filter((f) => f.dir === "out").reduce((s, f) => s + f.amount, 0);
    const inc = L.fixed.filter((f) => f.dir === "in").reduce((s, f) => s + f.amount, 0);
    $("mOut").textContent = money(out); $("mIn").textContent = money(inc);
    const due = L.fixed.map((f) => ({ ...f, ...nextDate(f.day) })).sort((a, b) => a.left - b.left);
    $("due").innerHTML = due.length ? due.map((f) => {
      const when = f.left === 0 ? "今天" : f.left === 1 ? "明天" : `${f.left} 天後`;
      return `<li><span class="d">${f.date.getMonth() + 1}/${pad(f.date.getDate())}</span><span class="n">${esc(f.name)}<small>${when}</small></span><span class="a ${f.dir}">${f.dir === "out" ? "−" : "+"}${money(f.amount)}</span></li>`;
    }).join("") : `<li class="empty-note">還沒有每月固定收支，按「登打」新增。</li>`;
    const tag = $("moneyTag");
    tag.textContent = live ? "已登打" : "範例"; tag.classList.toggle("live", live);
    renderMoneyDialog();
  }
  function renderMoneyDialog() {
    const L = state.ledger || { items: [], fixed: [] };
    const groups = [["asset", "資產"], ["debt", "負債"]];
    $("balList").innerHTML = L.items.length ? groups.map(([k, label]) => {
      const rows = L.items.filter((i) => i.kind === k);
      if (!rows.length) return "";
      const sum = rows.reduce((s, i) => s + toTWD(i.amount, i.cur), 0);
      return `<li><span class="n sum">${label}合計</span><span class="m">NT$ ${money(sum)}</span><span></span></li>` +
        rows.map((i) => `<li><span class="n">${esc(i.name)}</span><span class="m">${i.cur === "USD" ? "US$" : "NT$"} ${money(i.amount)}</span><button class="del" type="button" data-del-item="${i.id}" aria-label="刪除 ${esc(i.name)}">刪除</button></li>`).join("");
    }).join("") : `<li class="empty-note">例：活存、定存、股票、保單價值是資產；房貸、車貸、信貸是負債。</li>`;
    const fx = [...L.fixed].sort((a, b) => a.day - b.day);
    $("fixList").innerHTML = fx.length ? fx.map((f) =>
      `<li><span class="n">每月 ${f.day} 號・${esc(f.name)}<small>${f.dir === "out" ? "支出" : "收入"}</small></span><span class="m ${f.dir}">${f.dir === "out" ? "−" : "+"}${money(f.amount)}</span><button class="del" type="button" data-del-fixed="${f.id}" aria-label="刪除 ${esc(f.name)}">刪除</button></li>`
    ).join("") : `<li class="empty-note">例：房租 5 號、信用卡 12 號、薪水 10 號。</li>`;
  }
  function saveLedger(mut) {
    if (!state.ledger) state.ledger = { items: [], fixed: [] };
    mut(state.ledger); persist(); renderMoney();
  }
  $("openMoney").addEventListener("click", () => { renderMoneyDialog(); open("dlgMoney"); });
  $("balForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = num($("bAmt").value); if (!(amount >= 0)) { $("bAmt").focus(); return; }
    saveLedger((L) => L.items.push({ id: uid(), kind: $("bKind").value, name: $("bName").value.trim(), amount, cur: $("bCur").value }));
    $("bName").value = ""; $("bAmt").value = ""; $("bName").focus();
  });
  $("fixForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = num($("fAmt").value), day = parseInt($("fDay").value, 10);
    if (!(amount >= 0) || !(day >= 1 && day <= 31)) return;
    saveLedger((L) => L.fixed.push({ id: uid(), dir: $("fDir").value, name: $("fName").value.trim(), day, amount }));
    $("fName").value = ""; $("fDay").value = ""; $("fAmt").value = ""; $("fName").focus();
  });
  $("balList").addEventListener("click", (e) => { const id = e.target.dataset.delItem; if (id) saveLedger((L) => { L.items = L.items.filter((i) => i.id !== id); }); });
  $("fixList").addEventListener("click", (e) => { const id = e.target.dataset.delFixed; if (id) saveLedger((L) => { L.fixed = L.fixed.filter((f) => f.id !== id); }); });

  fetch("https://open.er-api.com/v6/latest/USD").then((r) => r.json()).then((j) => {
    if (j.result !== "success") throw new Error();
    state.fx = j.rates.TWD;
    $("fxUsd").textContent = state.fx.toFixed(3);
    renderMoney();
  }).catch(() => { $("fxUsd").textContent = "—"; });

  /* ---------- 備份與還原 ---------- */
  $("syncBtn").addEventListener("click", () => { $("backupHint").textContent = ""; $("syncMsg").textContent = ""; cloud.renderStatus(); open("dlgSync"); });
  $("exportBtn").addEventListener("click", () => {
    const data = { app: "jarvis", version: 1, exported: new Date().toISOString(), clients: state.clients, book: state.book, people: state.people, ledger: state.ledger, agenda: state.agenda };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const d = new Date(); a.download = `jarvis-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $("backupHint").textContent = "備份已下載。檔案含個人資料，請勿上傳到 GitHub。";
  });
  $("restoreInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "jarvis") throw new Error("這不是 JARVIS 的備份檔");
      state.clients = d.clients || null; state.book = d.book || null; state.people = d.people || []; state.ledger = d.ledger || null; state.agenda = d.agenda || [];
      store.set(KEYS.clients, state.clients); store.set(KEYS.book, state.book);
      persist(); renderPeople(); renderMoney();
      $("backupHint").textContent = "已還原。";
    } catch (err) { $("backupHint").textContent = `還原失敗：${err.message}`; }
    e.target.value = "";
  });

  /* ---------- Supabase 雲端同步 ---------- */
  const cloud = (() => {
    const sb = CFG.supabaseUrl && CFG.supabaseKey && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;
    let user = null, timer = null, lastSync = null, busy = false;
    const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    function renderStatus(msg) {
      const b = $("syncBtn");
      b.textContent = user ? (lastSync ? `已同步 ${fmtTime(lastSync)}` : "同步中…") : "登入同步";
      b.classList.toggle("on", !!user);
      $("syncOut").hidden = !!user; $("syncIn").hidden = !user;
      if (user) {
        $("syncWho").textContent = user.email;
        $("syncState").textContent = lastSync ? `上次同步：${lastSync.toLocaleString("zh-TW", { hour12: false })}` : "尚未同步";
      }
      if (msg !== undefined) $("syncMsg").textContent = msg;
    }
    const snapshot = () => Object.fromEntries(SYNCED.map((k) => [k, state[k]]));
    function apply(data) {
      SYNCED.forEach((k) => { if (k in data) state[k] = data[k] ?? (k === "ledger" ? null : []); });
      SYNCED.forEach((k) => store.set(KEYS[k], state[k]));
      renderPeople(); renderMoney(); renderAgenda();
    }
    async function push() {
      if (!user) return;
      const { error } = await sb.from("jarvis_state").upsert({ owner: user.id, data: snapshot(), updated_at: new Date().toISOString() });
      if (error) { renderStatus(`同步失敗：${error.message}`); return; }
      lastSync = new Date(); renderStatus();
    }
    // 雲端與本機比較，較新的一方勝出
    async function pull() {
      if (!user || busy) return; busy = true;
      try {
        const { data, error } = await sb.from("jarvis_state").select("data, updated_at").eq("owner", user.id).maybeSingle();
        if (error) throw error;
        const localAt = store.get("jarvis.savedAt", 0), localHas = SYNCED.some((k) => Array.isArray(state[k]) ? state[k].length : !!state[k]);
        if (!data) { if (localHas) await push(); else { lastSync = new Date(); renderStatus(); } }
        else if (new Date(data.updated_at).getTime() >= localAt || !localHas) {
          apply(data.data); store.set("jarvis.savedAt", new Date(data.updated_at).getTime()); lastSync = new Date(); renderStatus();
        } else await push();
      } catch (err) { renderStatus(`同步失敗：${err.message}`); }
      finally { busy = false; }
    }
    // 東石系統的客戶（唯讀）
    async function loadClients() {
      if (!user) return;
      const c = await sb.from("clients").select("name:data->>name, birthday:data->>birthday");
      if (c.error) return;
      state.cloudClients = (c.data || []).map((r) => ({ name: String(r.name || "").trim(), birthday: normDate(r.birthday) })).filter((r) => r.name && r.birthday);
      const p = await sb.from("policies").select("id", { count: "exact", head: true });
      state.cloudPolicies = p.error ? null : p.count;
      renderPeople();
    }
    async function onUser(u) {
      user = u || null;
      if (!user) { state.cloudClients = null; state.cloudPolicies = null; lastSync = null; renderStatus(); renderPeople(); return; }
      renderStatus(); await pull(); await loadClients();
    }
    if (sb) {
      sb.auth.getSession().then(({ data }) => onUser(data.session?.user));
      sb.auth.onAuthStateChange((evt, session) => { if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") onUser(session?.user); });
      document.addEventListener("visibilitychange", () => { if (!document.hidden) { pull(); loadClients(); } });
      setInterval(() => { pull(); }, 5 * 60000);
    }
    $("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!sb) { renderStatus("無法載入 Supabase 元件，請檢查網路或 config.js。"); return; }
      renderStatus("登入中…");
      const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
      if (error) renderStatus(error.message === "Invalid login credentials" ? "Email 或密碼不正確。" : `登入失敗：${error.message}`);
      else { $("lPass").value = ""; renderStatus(""); }
    });
    $("logoutBtn").addEventListener("click", () => sb && sb.auth.signOut());
    $("syncNow").addEventListener("click", async () => { await pull(); await loadClients(); });
    return {
      renderStatus,
      schedulePush() { if (!user) return; clearTimeout(timer); timer = setTimeout(push, 1200); },
    };
  })();

  /* ---------- 安裝成 App ---------- */
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  let installEvt = null;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS && !standalone) $("installBtn").hidden = false;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; });
  addEventListener("appinstalled", () => { $("installBtn").hidden = true; });
  $("installBtn").addEventListener("click", async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("installBtn").hidden = true; }
    else open("dlgInstall");
  });

  /* ---------- Google（Gmail + 日曆）---------- */
  const SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly";
  let tokenClient = null, token = null;
  try { const t = JSON.parse(sessionStorage.getItem("jarvis.gtoken") || "null"); if (t && t.exp > Date.now()) token = t; } catch { /* ignore */ }

  const gapi = async (url) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (r.status === 401) { token = null; try { sessionStorage.removeItem("jarvis.gtoken"); } catch {} setBtn(); throw new Error("登入已過期"); }
    if (!r.ok) throw new Error(`Google API ${r.status}`);
    return r.json();
  };
  async function loadCalendar() {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    const q = new URLSearchParams({ timeMin: s.toISOString(), timeMax: e.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "20" });
    const j = await gapi(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CFG.calendarId)}/events?${q}`);
    state.events = (j.items || []).map((ev) => {
      const st = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
      return { time: st ? `${pad(st.getHours())}:${pad(st.getMinutes())}` : "全天", title: ev.summary || "（無標題）", where: ev.location || "" };
    });
    renderAgenda();
  }
  async function loadMail() {
    const label = await gapi("https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX");
    const list = await gapi("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + new URLSearchParams({ q: "in:inbox is:unread", maxResults: "5" }));
    const msgs = await Promise.all((list.messages || []).map((m) =>
      gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)));
    const today = new Date().toDateString(), yest = new Date(Date.now() - 86400000).toDateString();
    state.mail = {
      unread: label.messagesUnread ?? 0,
      items: msgs.map((m) => {
        const h = (n) => (m.payload?.headers || []).find((x) => x.name === n)?.value || "";
        const raw = h("From"), named = raw.replace(/<.*?>/, "").replace(/"/g, "").trim();
        const from = named || raw.replace(/[<>]/g, "");
        const d = new Date(+m.internalDate);
        const when = d.toDateString() === today ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : d.toDateString() === yest ? "昨天" : `${d.getMonth() + 1}/${pad(d.getDate())}`;
        return { from, subject: h("Subject") || "（無主旨）", when, important: (m.labelIds || []).includes("IMPORTANT") };
      }),
    };
    renderMail();
  }
  function setBtn() {
    const b = $("googleBtn");
    if (!CFG.googleClientId) { b.textContent = "設定 Google"; b.title = "請先在 config.js 填入 googleClientId"; return; }
    b.textContent = token ? "Google 已連接" : "連接 Google";
    b.classList.toggle("on", !!token);
  }
  async function refreshGoogle() { if (token) await Promise.allSettled([loadCalendar(), loadMail()]); }
  function loadGIS() {
    return new Promise((res, rej) => {
      if (window.google?.accounts?.oauth2) return res();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = res; s.onerror = () => rej(new Error("無法載入 Google 登入元件"));
      document.head.appendChild(s);
    });
  }
  $("googleBtn").addEventListener("click", async () => {
    if (!CFG.googleClientId) { alert("請先在 config.js 填入 Google OAuth 用戶端 ID（設定步驟見 README.md）。"); return; }
    try {
      await loadGIS();
      tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({
        client_id: CFG.googleClientId, scope: SCOPES,
        callback: (resp) => {
          if (resp.error) return;
          token = { access_token: resp.access_token, exp: Date.now() + (resp.expires_in - 60) * 1000 };
          try { sessionStorage.setItem("jarvis.gtoken", JSON.stringify(token)); } catch {}
          setBtn(); refreshGoogle();
        },
      });
      tokenClient.requestAccessToken({ prompt: token ? "" : "consent" });
    } catch (err) { alert(err.message); }
  });

  /* ---------- boot ---------- */
  setBtn();
  renderMail();
  renderPeople();
  renderMoney();
  refreshGoogle();
  setInterval(renderAgenda, 60000);                 // 「下一個行程」高亮跟著時間走
  setInterval(refreshGoogle, 5 * 60000);            // 每 5 分鐘更新 Gmail 與日曆
})();
