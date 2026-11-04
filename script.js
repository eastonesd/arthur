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
  const KEYS = { clients: "jarvis.clients", book: "jarvis.book", people: "jarvis.people", ledger: "jarvis.ledger", agenda: "jarvis.agenda", todos: "jarvis.todos", gcal: "jarvis.gcal", routines: "jarvis.routines", tomb: "jarvis.tomb" };
  const SYNCED = ["people", "ledger", "agenda", "todos", "gcal", "routines", "tomb"];    // 會同步到 Supabase 的資料
  const state = {
    events: null, mail: null, fx: null,
    clients: store.get(KEYS.clients),               // imported from 東石系統
    book: store.get(KEYS.book),                     // policy stats from 東石系統
    people: store.get(KEYS.people, []),             // typed in by hand
    ledger: store.get(KEYS.ledger, null),           // { items:[], fixed:[] }
    agenda: store.get(KEYS.agenda, []),             // 手動登打的行程
    todos: store.get(KEYS.todos, []),               // 待辦
    gcal: store.get(KEYS.gcal, null),               // 今天的 Google 日曆（給 LINE 推播用）
    routines: store.get(KEYS.routines, null),       // 生活提醒（以 config.js 為準，同步給後端推播）
    tomb: store.get(KEYS.tomb, {}),                 // 已刪除項目的 id → 刪除時間（合併同步時才知道哪些是真的刪掉）
    cloudClients: null, cloudPolicies: null,        // 從東石系統（Supabase）讀到的客戶
  };
  // 本機儲存 + 排程上傳雲端
  function persist() {
    SYNCED.forEach((k) => store.set(KEYS[k], state[k]));
    cloud.schedulePush();
  }
  // 每筆資料帶修改時間 u；刪除時留下墓碑，同步時才不會被別台裝置的舊資料「救回來」
  const stamp = (o) => ({ ...o, u: Date.now() });
  const bury = (...ids) => { ids.forEach((id) => { if (id) state.tomb[id] = Date.now(); }); };

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
    if (m) return valid(1904, +m[1], +m[2]);      // 不知道年份時記成 1904 年（閏年，2/29 也能存；不會撞到真實生日）
    return null;
  }
  function daysUntilBirthday(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if (!m) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let b = new Date(t.getFullYear(), +m[2] - 1, +m[3]);
    if (b < t) b = new Date(t.getFullYear() + 1, +m[2] - 1, +m[3]);
    return Math.round((b - t) / 86400000);
  }
  const mdLabel = (iso) => iso.slice(0, 4) === "1904" ? `${+iso.slice(5, 7)}/${+iso.slice(8)}` : iso.replace(/-/g, "/");

  /* ---------- people (imported + typed in) ---------- */
  const SAMPLE_PEOPLE = (() => {
    const d = new Date(), md = (off) => { const x = new Date(d); x.setDate(x.getDate() + off); return `1985-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    return [["林小姐", 0], ["張先生", 3], ["黃太太", 6], ["吳先生", 12], ["李小姐", 21], ["陳先生", 27]].map(([name, o]) => ({ name, birthday: md(o), group: "客戶" }));
  })();
  const clientSource = () => state.cloudClients || state.clients || [];
  const hasPeopleData = () => clientSource().length > 0 || state.people.length > 0;
  function everyone() {
    if (!hasPeopleData()) return SAMPLE_PEOPLE;
    // 生日簿裡已有的人，以生日簿的分類為準（例如東石系統裡的下屬歸為朋友）
    const own = new Set(state.people.map((p) => p.name));
    return [...clientSource().filter((c) => !own.has(c.name)).map((c) => ({ ...c, group: "客戶" })), ...state.people];
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
    state.people.push(stamp({ id: uid(), name, birthday, group: $("pGroup").value }));
    persist();
    $("pMsg").textContent = ""; $("pName").value = ""; $("pBday").value = ""; $("pName").focus();
    renderPeople();
  });
  $("peopleList").addEventListener("click", (e) => {
    const id = e.target.dataset.delPerson; if (!id) return;
    state.people = state.people.filter((p) => p.id !== id); bury(id);
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
    const manual = state.agenda.filter((a) => a.date === todayISO()).map((a) => ({ id: a.id, time: a.time || "全天", title: a.title, where: a.where }));
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
      const m = mins(e.time), cls = ["item", e.bday ? "bday" : "", e.id ? "editable" : "", i === nextIdx ? "now" : "", m >= 0 && m < nowMin && i !== nextIdx ? "past" : ""].join(" ");
      return `<li class="${cls}"${e.id ? ` data-edit="${e.id}" title="點一下修改"` : ""}><span class="pin"></span><span class="t">${esc(e.time)}</span><span class="what">${esc(e.title)}${e.where ? `<small>${esc(e.where)}</small>` : ""}</span></li>`;
    }).join("") : `<li class="empty-note">今天沒有行程，先生可以喘口氣。</li>`;
    const tag = $("agendaTag");
    tag.textContent = live ? "Google 日曆" : useSample ? "範例" : "手動"; tag.classList.toggle("live", !useSample);
    state.agendaCount = events.length;
    renderSummary();
    renderTodoMini();
  }

  /* 行程登打 dialog：新增、修改、刪除 */
  let editingId = null;
  const mdShort = (iso) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
  function renderAgendaDialog() {
    const t = todayISO();
    const list = state.agenda.filter((a) => a.date >= t).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    $("agendaList").innerHTML = list.length ? list.map((a) =>
      `<li class="${a.id === editingId ? "editing" : ""}"><span class="n">${esc(a.title)}${a.where ? `<small>${esc(a.where)}</small>` : ""}</span><span class="m">${a.date === t ? "今天" : mdShort(a.date)} ${a.time || "全天"}</span><span class="acts"><button class="edit" type="button" data-edit-agenda="${a.id}">修改</button><button class="del" type="button" data-del-agenda="${a.id}" aria-label="刪除 ${esc(a.title)}">刪除</button></span></li>`
    ).join("") : `<li class="empty-note">還沒有手動登打的行程。</li>`;
    renderTodoDialog();
  }
  function resetAgendaForm() {
    editingId = null;
    $("aDate").value = todayISO(); $("aTime").value = ""; $("aTitle").value = ""; $("aWhere").value = "";
    $("aSubmit").textContent = "新增"; $("aCancel").hidden = true;
  }
  function startEdit(id) {
    const a = state.agenda.find((x) => x.id === id); if (!a) return;
    editingId = id;
    $("aDate").value = a.date; $("aTime").value = a.time || ""; $("aTitle").value = a.title; $("aWhere").value = a.where || "";
    $("aSubmit").textContent = "儲存修改"; $("aCancel").hidden = false;
    renderAgendaDialog(); $("aTitle").focus();
  }
  function openAgendaDialog(editId) {
    resetAgendaForm(); renderAgendaDialog(); open("dlgAgenda");
    if (editId) startEdit(editId); else $("aTitle").focus();
  }
  $("openAgenda").addEventListener("click", () => openAgendaDialog());
  $("agenda").addEventListener("click", (e) => { const li = e.target.closest("[data-edit]"); if (li) openAgendaDialog(li.dataset.edit); });
  $("aCancel").addEventListener("click", () => { resetAgendaForm(); renderAgendaDialog(); });
  $("agendaForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const item = { date: $("aDate").value, time: $("aTime").value, title: $("aTitle").value.trim(), where: $("aWhere").value.trim() };
    if (editingId) state.agenda = state.agenda.map((a) => a.id === editingId ? stamp({ ...a, ...item }) : a);
    else state.agenda.push(stamp({ id: uid(), ...item }));
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10); // 只留最近 30 天以後的
    bury(...state.agenda.filter((a) => a.date < cutoff).map((a) => a.id));
    state.agenda = state.agenda.filter((a) => a.date >= cutoff);
    persist(); resetAgendaForm(); renderAgenda(); renderAgendaDialog(); $("aTitle").focus();
  });
  $("agendaList").addEventListener("click", (e) => {
    const ed = e.target.dataset.editAgenda; if (ed) return startEdit(ed);
    const id = e.target.dataset.delAgenda; if (!id) return;
    state.agenda = state.agenda.filter((a) => a.id !== id); bury(id);
    if (editingId === id) resetAgendaForm();
    persist(); renderAgenda(); renderAgendaDialog();
  });

  /* 待辦 */
  const openTodoList = () => state.todos.filter((t) => !t.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  function renderTodoMini() {
    const t = todayISO();
    $("todoMini").innerHTML = openTodoList().slice(0, 5).map((x) =>
      `<li><input type="checkbox" class="chk" data-done="${x.id}" aria-label="完成 ${esc(x.title)}"><span class="n">${esc(x.title)}</span><span class="due${x.due && x.due < t ? " late" : ""}">${x.due ? (x.due === t ? "今天" : mdShort(x.due)) : ""}</span></li>`).join("");
  }
  function renderTodoDialog() {
    const t = todayISO();
    const list = [...openTodoList(), ...state.todos.filter((x) => x.done)];
    $("todoList").innerHTML = list.length ? list.map((x) =>
      `<li class="todo${x.done ? " done" : ""}"><input type="checkbox" class="chk" data-done="${x.id}" ${x.done ? "checked" : ""} aria-label="完成 ${esc(x.title)}"><span class="n">${esc(x.title)}</span><span class="m">${x.due ? (x.due === t ? "今天" : mdShort(x.due)) : ""}</span><button class="del" type="button" data-del-todo="${x.id}" aria-label="刪除 ${esc(x.title)}">刪除</button></li>`
    ).join("") : `<li class="empty-note">沒有待辦事項。</li>`;
  }
  function toggleTodo(id) {
    state.todos = state.todos.map((x) => x.id === id ? stamp({ ...x, done: !x.done, doneAt: !x.done ? new Date().toISOString() : undefined }) : x);
    // 完成超過 7 天的自動清掉
    const old = (x) => x.done && x.doneAt && Date.now() - new Date(x.doneAt) >= 7 * 86400000;
    bury(...state.todos.filter(old).map((x) => x.id));
    state.todos = state.todos.filter((x) => !old(x));
    persist(); renderTodoMini(); renderTodoDialog();
  }
  $("todoForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.todos.push(stamp({ id: uid(), title: $("tTitle").value.trim(), due: $("tDue").value || "", done: false }));
    persist(); renderTodoMini(); renderTodoDialog();
    $("tTitle").value = ""; $("tDue").value = ""; $("tTitle").focus();
  });
  $("todoList").addEventListener("click", (e) => {
    if (e.target.dataset.done) return toggleTodo(e.target.dataset.done);
    const id = e.target.dataset.delTodo; if (!id) return;
    state.todos = state.todos.filter((x) => x.id !== id); bury(id);
    persist(); renderTodoMini(); renderTodoDialog();
  });
  $("todoMini").addEventListener("change", (e) => { if (e.target.dataset.done) toggleTodo(e.target.dataset.done); });

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
      `<li><span class="dot${x.important ? " imp" : ""}"></span><span class="from">${x.acct ? `<em class="acct">${esc(x.acct)}</em>` : ""}${esc(x.from)}</span><span class="when">${esc(x.when)}</span><span class="subj">${esc(x.subject)}</span></li>`
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
    saveLedger((L) => L.items.push(stamp({ id: uid(), kind: $("bKind").value, name: $("bName").value.trim(), amount, cur: $("bCur").value })));
    $("bName").value = ""; $("bAmt").value = ""; $("bName").focus();
  });
  $("fixForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = num($("fAmt").value), day = parseInt($("fDay").value, 10);
    if (!(amount >= 0) || !(day >= 1 && day <= 31)) return;
    saveLedger((L) => L.fixed.push(stamp({ id: uid(), dir: $("fDir").value, name: $("fName").value.trim(), day, amount })));
    $("fName").value = ""; $("fDay").value = ""; $("fAmt").value = ""; $("fName").focus();
  });
  $("balList").addEventListener("click", (e) => { const id = e.target.dataset.delItem; if (id) saveLedger((L) => { L.items = L.items.filter((i) => i.id !== id); bury(id); }); });
  $("fixList").addEventListener("click", (e) => { const id = e.target.dataset.delFixed; if (id) saveLedger((L) => { L.fixed = L.fixed.filter((f) => f.id !== id); bury(id); }); });

  fetch("https://open.er-api.com/v6/latest/USD").then((r) => r.json()).then((j) => {
    if (j.result !== "success") throw new Error();
    state.fx = j.rates.TWD;
    $("fxUsd").textContent = state.fx.toFixed(3);
    renderMoney();
  }).catch(() => { $("fxUsd").textContent = "—"; });

  /* ---------- 備份與還原 ---------- */
  $("syncBtn").addEventListener("click", () => { $("backupHint").textContent = ""; $("syncMsg").textContent = ""; cloud.renderStatus(); cloud.lineStatus(); cloud.pushStatus(); open("dlgSync"); });
  $("exportBtn").addEventListener("click", () => {
    const data = { app: "jarvis", version: 1, exported: new Date().toISOString(), clients: state.clients, book: state.book, people: state.people, ledger: state.ledger, agenda: state.agenda, todos: state.todos };
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
      const st = (arr) => (arr || []).map((x) => ({ ...x, u: Date.now() }));
      state.clients = d.clients || null; state.book = d.book || null; state.people = st(d.people); state.agenda = st(d.agenda); state.todos = st(d.todos);
      state.ledger = d.ledger ? { items: st(d.ledger.items), fixed: st(d.ledger.fixed) } : null;
      store.set(KEYS.clients, state.clients); store.set(KEYS.book, state.book);
      persist(); renderPeople(); renderMoney();
      $("backupHint").textContent = "已還原。";
    } catch (err) { $("backupHint").textContent = `還原失敗：${err.message}`; }
    e.target.value = "";
  });

  /* ---------- Supabase 雲端同步 ---------- */
  const cloud = (() => {
    const sb = CFG.supabaseUrl && CFG.supabaseKey && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;
    let user = null, timer = null, lastSync = null, busy = false, again = false;
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
      SYNCED.forEach((k) => { state[k] = data[k] ?? (["ledger", "gcal", "routines"].includes(k) ? null : k === "tomb" ? {} : []); });
      SYNCED.forEach((k) => store.set(KEYS[k], state[k]));
      renderPeople(); renderMoney(); renderAgenda();
      if ($("dlgAgenda").open) renderAgendaDialog();
    }
    // 合併兩份資料：以 id 聯集，同一筆取較新的（u），墓碑裡的才算刪除。
    // 任何一邊是空的或舊的，都不會把另一邊的資料蓋掉。
    function mergeList(a, b, tomb) { // a = 本機, b = 雲端
      const m = new Map();
      // 雲端（b）先放，同時間時以雲端為準（例如在 LINE 上按了完成待辦）
      for (const x of [...(b || []), ...(a || [])]) {
        if (!x || !x.id || tomb[x.id]) continue;
        const cur = m.get(x.id);
        if (!cur || (x.u || 0) > (cur.u || 0)) m.set(x.id, x);
      }
      return [...m.values()];
    }
    function merge(local, remote) {
      const tomb = { ...(remote.tomb || {}), ...(local.tomb || {}) };
      const keepAfter = Date.now() - 90 * 86400000; // 墓碑保留 90 天
      Object.keys(tomb).forEach((id) => { if (tomb[id] < keepAfter) delete tomb[id]; });
      const L = local.ledger || {}, R = remote.ledger || {};
      const hasLedger = local.ledger || remote.ledger;
      const newer = (x, y) => (!x ? y : !y ? x : (x.date || "") >= (y.date || "") ? x : y);
      return {
        tomb,
        people: mergeList(local.people, remote.people, tomb),
        agenda: mergeList(local.agenda, remote.agenda, tomb),
        todos: mergeList(local.todos, remote.todos, tomb),
        ledger: hasLedger ? { items: mergeList(L.items, R.items, tomb), fixed: mergeList(L.fixed, R.fixed, tomb) } : null,
        gcal: newer(local.gcal, remote.gcal),
        routines: CFG.routines,
      };
    }
    const canon = (d) => JSON.stringify(SYNCED.map((k) => { const v = d[k]; return Array.isArray(v) ? [...v].sort((a, b) => String(a.id).localeCompare(String(b.id))) : v ?? null; }));
    // 同步 = 讀雲端 → 合併 → 套用到本機 → 有差異才寫回雲端
    async function sync() {
      if (!user) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        const { data, error } = await sb.from("jarvis_state").select("data").eq("owner", user.id).maybeSingle();
        if (error) throw error;
        const remote = data?.data || {};
        const merged = merge(snapshot(), remote);
        // 套用前留一份本機備份（最近 3 份），以防萬一
        try { const bk = store.get("jarvis.localBackups", []); bk.unshift({ at: Date.now(), data: snapshot() }); store.set("jarvis.localBackups", bk.slice(0, 3)); } catch {}
        apply(merged);
        if (canon(merged) !== canon(remote)) {
          const { error: e2 } = await sb.from("jarvis_state").upsert({ owner: user.id, data: merged, updated_at: new Date().toISOString() });
          if (e2) throw e2;
        }
        lastSync = new Date(); renderStatus();
      } catch (err) { renderStatus(`同步失敗：${err.message}`); }
      finally { busy = false; if (again) { again = false; sync(); } }
    }
    const pull = sync;
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
    // J.A.R.V.I.S LINE 綁定
    async function lineStatus() {
      if (!user) return;
      const { data } = await sb.from("jarvis_line_links").select("linked_at").eq("owner", user.id).maybeSingle();
      $("lineState").textContent = data ? `已綁定（${new Date(data.linked_at).toLocaleDateString("zh-TW")}）` : "未綁定";
      $("lineUnlink").hidden = !data;
      $("lineCodeBtn").textContent = data ? "重新綁定" : "綁定 LINE";
      if (data) $("lineCodeOut").hidden = true;
    }
    $("lineCodeBtn").addEventListener("click", async () => {
      if (!user) return;
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", buf = crypto.getRandomValues(new Uint8Array(8));
      const code = Array.from(buf, (n) => abc[n % abc.length]).join("");
      await sb.from("jarvis_link_codes").delete().eq("owner", user.id);
      const { error } = await sb.from("jarvis_link_codes").insert({ code });
      if (error) { renderStatus(`產生綁定碼失敗：${error.message}`); return; }
      $("lineCode").textContent = code; $("lineCodeOut").hidden = false;
    });
    $("lineUnlink").addEventListener("click", async () => { await sb.from("jarvis_line_links").delete().eq("owner", user.id); lineStatus(); });
    // 手機通知（Web Push）
    const FN = `${CFG.supabaseUrl}/functions/v1/jarvis-line`;
    const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const b64ToBytes = (b64) => { const s = atob((b64 + "=".repeat((4 - b64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
    async function currentSub() { const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
    async function pushStatus() {
      const show = (state, hint, on) => {
        $("pushState").textContent = state; $("pushHint").textContent = hint || "";
        $("pushOn").hidden = !!on || !pushSupported; $("pushTest").hidden = !on; $("pushOff").hidden = !on;
      };
      if (!pushSupported) return show("不支援", isIOS && !standalone ? "iPhone 要先用 Safari「加入主畫面」，再從主畫面的 JARVIS 開啟，才能開通知（需 iOS 16.4 以上）。" : "這個瀏覽器不支援推播通知。");
      if (Notification.permission === "denied") return show("已封鎖", "請到手機「設定 → 通知 → JARVIS」打開通知。");
      const sub = await currentSub().catch(() => null);
      show(sub ? "已開啟" : "未開啟", sub ? `每天 ${CFG.routines.map((r) => `${r.time} ${r.label}`).join("、")} 會推播提醒。` : "", !!sub);
    }
    $("pushOn").addEventListener("click", async () => {
      if (!user) return;
      try {
        // 必須直接由點擊觸發，iPhone 才會跳出允許通知的視窗
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return pushStatus();
        const { publicKey } = await (await fetch(`${FN}?vapid=1`)).json();
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
        const j = sub.toJSON();
        const { error } = await sb.from("jarvis_push_subs").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: navigator.userAgent.slice(0, 200) });
        if (error) throw error;
        await pushStatus(); $("pushHint").textContent = "已開啟，正在傳送測試通知…"; await testPush();
      } catch (err) { $("pushHint").textContent = `開啟失敗：${err.message}`; }
    });
    async function testPush() {
      const { data, error } = await sb.functions.invoke("jarvis-line", { body: { action: "test-push" } });
      $("pushHint").textContent = error ? `測試通知失敗：${error.message}` : data?.sent ? "測試通知已送出，請看看手機。" : "沒有送出，請重新開啟通知。";
    }
    $("pushTest").addEventListener("click", testPush);
    $("pushOff").addEventListener("click", async () => {
      const sub = await currentSub().catch(() => null);
      if (sub) { await sb.from("jarvis_push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
      pushStatus();
    });
    // 生活提醒存到雲端，讓後端知道幾點要提醒
    function syncRoutines() { /* merge() 一律寫入 config.js 的 routines */ }
    async function onUser(u) {
      user = u || null;
      if (!user) { state.cloudClients = null; state.cloudPolicies = null; lastSync = null; renderStatus(); renderPeople(); return; }
      renderStatus(); await pull(); syncRoutines(); await loadClients(); lineStatus();
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
      renderStatus, lineStatus, pushStatus,
      schedulePush() { if (!user) return; clearTimeout(timer); timer = setTimeout(sync, 1200); },
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

  /* ---------- Google（Gmail + 日曆），可同時連接多個帳號 ---------- */
  const SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly";
  const ACCT_KEY = "jarvis.gaccounts";
  let tokenClient = null;
  // [{ email, access_token, exp }]；token 只放 sessionStorage，關掉瀏覽器就失效
  let accounts = (() => { try { return JSON.parse(sessionStorage.getItem(ACCT_KEY) || "[]"); } catch { return []; } })();
  // 記住連過哪些信箱，下次一鍵重新連接
  let known = store.get("jarvis.gemails", []);
  const live = () => accounts.filter((a) => a.exp > Date.now());
  const saveAccounts = () => { try { sessionStorage.setItem(ACCT_KEY, JSON.stringify(accounts)); } catch {} store.set("jarvis.gemails", known); };
  const tagOf = (email) => email.split("@")[0];

  const gapi = async (acct, url) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${acct.access_token}` } });
    if (r.status === 401) { acct.exp = 0; saveAccounts(); setBtn(); throw new Error("登入已過期"); }
    if (!r.ok) throw new Error(`Google API ${r.status}`);
    return r.json();
  };
  async function loadCalendar() {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    const q = new URLSearchParams({ timeMin: s.toISOString(), timeMax: e.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "20" });
    const results = await Promise.allSettled(live().map((a) => gapi(a, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CFG.calendarId)}/events?${q}`)));
    const seen = new Set(), events = [];
    results.forEach((r) => { if (r.status !== "fulfilled") return;
      (r.value.items || []).forEach((ev) => {
        const st = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
        const item = { time: st ? `${pad(st.getHours())}:${pad(st.getMinutes())}` : "全天", title: ev.summary || "（無標題）", where: ev.location || "" };
        const k = item.time + item.title; if (!seen.has(k)) { seen.add(k); events.push(item); }
      });
    });
    if (!results.some((r) => r.status === "fulfilled")) return;
    state.events = events.sort((a, b) => (a.time === "全天" ? "" : a.time).localeCompare(b.time === "全天" ? "" : b.time));
    // 今天的 Google 行程存一份到雲端，讓 LINE 推播也看得到
    const gcal = { date: todayISO(), events: state.events };
    if (JSON.stringify(gcal) !== JSON.stringify(state.gcal)) { state.gcal = gcal; persist(); }
    renderAgenda();
  }
  async function loadMailFor(acct) {
    const label = await gapi(acct, "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX");
    const list = await gapi(acct, "https://gmail.googleapis.com/gmail/v1/users/me/messages?" + new URLSearchParams({ q: "in:inbox is:unread", maxResults: "5" }));
    const msgs = await Promise.all((list.messages || []).map((m) =>
      gapi(acct, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)));
    return { unread: label.messagesUnread ?? 0, msgs: msgs.map((m) => ({ ...m, acct: acct.email })) };
  }
  async function loadMail() {
    const results = (await Promise.allSettled(live().map(loadMailFor))).filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!results.length) return;
    const today = new Date().toDateString(), yest = new Date(Date.now() - 86400000).toDateString();
    const multi = results.length > 1;
    const all = results.flatMap((r) => r.msgs).sort((a, b) => +b.internalDate - +a.internalDate).slice(0, 6);
    state.mail = {
      unread: results.reduce((s, r) => s + r.unread, 0),
      items: all.map((m) => {
        const h = (n) => (m.payload?.headers || []).find((x) => x.name === n)?.value || "";
        const raw = h("From"), named = raw.replace(/<.*?>/, "").replace(/"/g, "").trim();
        const d = new Date(+m.internalDate);
        const when = d.toDateString() === today ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : d.toDateString() === yest ? "昨天" : `${d.getMonth() + 1}/${pad(d.getDate())}`;
        return { from: named || raw.replace(/[<>]/g, ""), subject: h("Subject") || "（無主旨）", when, important: (m.labelIds || []).includes("IMPORTANT"), acct: multi ? tagOf(m.acct) : "" };
      }),
    };
    renderMail();
  }
  function setBtn() {
    const b = $("googleBtn");
    if (!CFG.googleClientId) { b.textContent = "設定 Google"; b.title = "請先在 config.js 填入 googleClientId"; return; }
    const n = live().length;
    b.textContent = n > 1 ? `Google ${n} 個帳號` : n ? "Google 已連接" : "連接 Google";
    b.classList.toggle("on", n > 0);
    renderGoogleDialog();
  }
  function renderGoogleDialog() {
    const emails = [...new Set([...known, ...accounts.map((a) => a.email)])];
    $("gList").innerHTML = emails.length ? emails.map((em) => {
      const a = accounts.find((x) => x.email === em), ok = a && a.exp > Date.now();
      return `<li><span class="n">${esc(em)}</span><span class="m ${ok ? "in" : ""}">${ok ? "已連接" : "未連接"}</span><span class="acts">${ok ? "" : `<button class="edit" type="button" data-g-connect="${esc(em)}">連接</button>`}<button class="del" type="button" data-g-remove="${esc(em)}">移除</button></span></li>`;
    }).join("") : `<li class="empty-note">還沒有連接任何 Google 帳號。</li>`;
  }
  async function refreshGoogle() { if (live().length) await Promise.allSettled([loadCalendar(), loadMail()]); }
  function loadGIS() {
    return new Promise((res, rej) => {
      if (window.google?.accounts?.oauth2) return res();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = res; s.onerror = () => rej(new Error("無法載入 Google 登入元件"));
      document.head.appendChild(s);
    });
  }
  async function connect(hint) {
    if (!CFG.googleClientId) { $("gMsg").textContent = "請先在 config.js 填入 Google OAuth 用戶端 ID（設定步驟見 README.md）。"; return; }
    try {
      await loadGIS();
      tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({
        client_id: CFG.googleClientId, scope: SCOPES,
        callback: async (resp) => {
          if (resp.error) { $("gMsg").textContent = "沒有完成授權。"; return; }
          const acct = { access_token: resp.access_token, exp: Date.now() + (resp.expires_in - 60) * 1000, email: "" };
          try { acct.email = (await gapi(acct, "https://gmail.googleapis.com/gmail/v1/users/me/profile")).emailAddress; }
          catch { $("gMsg").textContent = "授權成功，但讀不到這個帳號的信箱。"; return; }
          accounts = [...accounts.filter((a) => a.email !== acct.email), acct];
          if (!known.includes(acct.email)) known.push(acct.email);
          saveAccounts(); $("gMsg").textContent = `已連接 ${acct.email}`; setBtn(); refreshGoogle();
        },
      });
      // 新增帳號時讓使用者挑帳號；重新連接時直接帶入該信箱
      tokenClient.requestAccessToken(hint ? { prompt: "", hint } : { prompt: "select_account consent" });
    } catch (err) { $("gMsg").textContent = err.message; }
  }
  $("googleBtn").addEventListener("click", () => { $("gMsg").textContent = ""; renderGoogleDialog(); open("dlgGoogle"); });
  $("gAdd").addEventListener("click", () => connect());
  $("gList").addEventListener("click", (e) => {
    const c = e.target.dataset.gConnect; if (c) return connect(c);
    const r = e.target.dataset.gRemove; if (!r) return;
    accounts = accounts.filter((a) => a.email !== r); known = known.filter((x) => x !== r);
    saveAccounts(); setBtn();
    if (!live().length) { state.mail = null; state.events = null; renderMail(); renderAgenda(); } else refreshGoogle();
  });
  // 舊版只存一組 token 的，直接清掉
  try { sessionStorage.removeItem("jarvis.gtoken"); } catch {}

  /* ---------- boot ---------- */
  setBtn();
  renderMail();
  renderPeople();
  renderMoney();
  refreshGoogle();
  setInterval(renderAgenda, 60000);                 // 「下一個行程」高亮跟著時間走
  setInterval(refreshGoogle, 5 * 60000);            // 每 5 分鐘更新 Gmail 與日曆
})();
