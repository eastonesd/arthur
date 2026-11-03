/* JARVIS personal dashboard */
(() => {
  "use strict";
  const CFG = Object.assign({ googleClientId: "", calendarId: "primary", routines: [] }, window.JARVIS_CONFIG || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const state = { events: null, clients: null, mail: null };

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

  /* ---------- routines ---------- */
  $("routines").innerHTML = CFG.routines.map((r) => `<span class="routine">${esc(r.label)} <b>${esc(r.time)}</b></span>`).join("");

  /* ---------- 今日指揮中心 ---------- */
  const SAMPLE_EVENTS = [
    { time: "10:30", title: "王先生 保單檢視" },
    { time: "14:00", title: "拜訪 陳小姐" },
    { time: "17:30", title: "寄出解約文件" },
    { time: "20:00", title: "整理客戶資料" },
  ];
  function renderAgenda() {
    const live = Array.isArray(state.events);
    const events = live ? state.events : SAMPLE_EVENTS;
    const bdays = todaysBirthdays().map((c) => ({ time: "全天", title: `${c.name} 生日`, bday: true }));
    const items = [...bdays, ...events];
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const mins = (t) => /^\d\d:\d\d$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : -1;
    let nextIdx = items.findIndex((e) => mins(e.time) >= nowMin);
    $("agenda").innerHTML = items.length ? items.map((e, i) => {
      const m = mins(e.time), cls = [e.bday ? "bday" : "", i === nextIdx ? "now" : "", m >= 0 && m < nowMin && i !== nextIdx ? "past" : ""].join(" ");
      return `<li class="${cls}"><span class="pin"></span><span class="t">${esc(e.time)}</span><span class="what">${esc(e.title)}${e.where ? `<small>${esc(e.where)}</small>` : ""}</span></li>`;
    }).join("") : `<li class="empty">今天沒有行程，先生可以喘口氣。</li>`;
    const tag = $("agendaTag");
    tag.textContent = live ? "Google 日曆" : "範例"; tag.classList.toggle("live", live);
    state.agendaCount = events.length;
    renderSummary();
  }

  /* ---------- 客戶 / 人脈雷達 ---------- */
  const SAMPLE_CLIENTS = (() => {
    const d = new Date(), md = (off) => { const x = new Date(d); x.setDate(x.getDate() + off); return `1985-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    return [
      { name: "林小姐", birthday: md(0) }, { name: "張先生", birthday: md(3) }, { name: "黃太太", birthday: md(6) },
      { name: "吳先生", birthday: md(12) }, { name: "李小姐", birthday: md(21) }, { name: "陳先生", birthday: md(27) },
    ].map((c, i) => ({ ...c, lastContact: i % 2 ? null : "2026-08-01" }));
  })();
  function clients() { return state.clients || SAMPLE_CLIENTS; }
  function daysUntilBirthday(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if (!m) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let b = new Date(t.getFullYear(), +m[2] - 1, +m[3]);
    if (b < t) b = new Date(t.getFullYear() + 1, +m[2] - 1, +m[3]);
    return Math.round((b - t) / 86400000);
  }
  function todaysBirthdays() { return clients().filter((c) => daysUntilBirthday(c.birthday) === 0); }
  function renderClients() {
    const list = clients(), live = !!state.clients;
    const within = (n) => list.filter((c) => { const d = daysUntilBirthday(c.birthday); return d !== null && d <= n; });
    const today = within(0), week = within(7);
    const hasContact = list.some((c) => c.lastContact);
    const stale = list.filter((c) => c.lastContact && (Date.now() - new Date(c.lastContact)) / 86400000 > 30);
    const names = (arr) => arr.slice(0, 2).map((c) => c.name).join("、") + (arr.length > 2 ? "…" : "");
    $("clientStats").innerHTML = [
      `<li><span class="k">今日生日${today.length ? `<small>${esc(names(today))}</small>` : ""}</span><span class="v">${today.length}</span></li>`,
      `<li><span class="k">7 天內生日${week.length ? `<small>${esc(names(week))}</small>` : ""}</span><span class="v">${week.length}</span></li>`,
      hasContact ? `<li><span class="k">超過 30 天未聯絡</span><span class="v">${stale.length}</span></li>` : "",
      `<li><span class="k">客戶總數</span><span class="v">${list.length}</span></li>`,
    ].join("");
    const tag = $("clientTag");
    tag.textContent = live ? "已匯入" : "範例"; tag.classList.toggle("live", live);
    state.bdayWeek = week.length;
    drawRadar(list);
    renderAgenda();
  }
  function drawRadar(list) {
    const cv = $("radar"), ctx = cv.getContext("2d"), dpr = Math.min(devicePixelRatio || 1, 2), S = 150;
    cv.width = S * dpr; cv.height = S * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = S / 2, R = S / 2 - 6;
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = "rgba(94,200,255,.28)"; ctx.lineWidth = 1;
    [1, .66, .33].forEach((f) => { ctx.beginPath(); ctx.arc(c, c, R * f, 0, 6.283); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();
    // distance = days until birthday (0–30); angle = spread by name
    list.forEach((cl, i) => {
      const d = daysUntilBirthday(cl.birthday); if (d === null || d > 30) return;
      const a = (i * 2.399) % 6.283, r = 10 + (R - 12) * d / 30;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r, hot = d <= 7;
      ctx.fillStyle = hot ? "#f5b43a" : "#5ec8ff";
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, hot ? 4 : 3, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
    });
    ctx.fillStyle = "#f5b43a"; ctx.beginPath(); ctx.arc(c, c, 4, 0, 6.283); ctx.fill();
  }

  /* CSV import: needs a 姓名 column and a 生日 column; 最後聯絡 is optional */
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
  function normDate(s) {
    s = String(s || "").trim(); if (!s) return null;
    let m = /^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(s);
    if (!m && /^\d{7,8}$/.test(s)) m = [s, s.slice(0, s.length - 4), s.slice(-4, -2), s.slice(-2)];
    if (m) { let y = +m[1]; if (y < 200) y += 1911; return `${y}-${pad(m[2])}-${pad(m[3])}`; } // 民國年 → 西元
    m = /^(\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
    if (m) return `2000-${pad(m[1])}-${pad(m[2])}`;
    return null;
  }
  function importClients(text) {
    const rows = parseCSV(text.replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw new Error("檔案裡沒有資料列");
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (...keys) => head.findIndex((h) => keys.some((k) => h.includes(k)));
    const iName = find("姓名", "名字", "客戶", "name"), iBday = find("生日", "出生", "birth"), iLast = find("最後聯絡", "上次聯絡", "last");
    if (iName < 0 || iBday < 0) throw new Error("找不到「姓名」或「生日」欄位");
    const out = rows.slice(1).map((r) => ({ name: (r[iName] || "").trim(), birthday: normDate(r[iBday]), lastContact: iLast >= 0 ? normDate(r[iLast]) : null }))
      .filter((c) => c.name && c.birthday);
    if (!out.length) throw new Error("生日欄位的日期格式無法辨識");
    return out;
  }
  $("csvInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const buf = await f.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) text = new TextDecoder("big5").decode(buf); // Excel 存成 Big5 的 CSV
    try {
      state.clients = importClients(text);
      store.set("jarvis.clients", state.clients);
      $("csvHint").textContent = `已匯入 ${state.clients.length} 位客戶，只存在這台瀏覽器`;
      renderClients();
    } catch (err) { $("csvHint").textContent = `匯入失敗：${err.message}`; }
    e.target.value = "";
  });
  state.clients = store.get("jarvis.clients");

  /* ---------- 通訊中心 ---------- */
  const SAMPLE_MAIL = {
    unread: 12,
    items: [
      { from: "王先生", subject: "保單資料補件", when: "08:42", important: true },
      { from: "保險公司", subject: "契約審核通知", when: "昨天", important: false },
      { from: "合作廠商", subject: "報價單已寄出，請確認", when: "11/01", important: false },
    ],
  };
  function renderMail() {
    const live = !!state.mail, m = state.mail || SAMPLE_MAIL;
    $("mailCount").textContent = m.unread;
    $("mailRing").style.strokeDashoffset = 264 - 264 * Math.min(m.unread, 30) / 30;
    $("mailList").innerHTML = m.items.length ? m.items.map((x) =>
      `<li><span class="dot${x.important ? " imp" : ""}"></span><span class="from">${esc(x.from)}</span><span class="when">${esc(x.when)}</span><span class="subj">${esc(x.subject)}</span></li>`
    ).join("") : `<li class="empty">收件匣已清空。</li>`;
    const tag = $("mailTag");
    tag.textContent = live ? "Gmail" : "範例"; tag.classList.toggle("live", live);
    state.unread = m.unread;
    renderSummary();
  }

  /* ---------- summary bar ---------- */
  function renderSummary() {
    $("summary").innerHTML = `今日 <b>${state.agendaCount ?? "–"}</b> 個行程・<b>${state.bdayWeek ?? "–"}</b> 位客戶生日將至・<b>${state.unread ?? "–"}</b> 封未讀郵件`;
  }

  /* ---------- 金流 / 帳務：匯率 ---------- */
  fetch("https://open.er-api.com/v6/latest/USD").then((r) => r.json()).then((j) => {
    if (j.result !== "success") throw new Error();
    $("fxUsd").textContent = j.rates.TWD.toFixed(3);
    const t = new Date(j.time_last_update_unix * 1000);
    $("fxNote").textContent = `市場中價・${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())} 更新`;
  }).catch(() => { $("fxNote").textContent = "匯率暫時無法取得"; });

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
        const from = h("From").replace(/<.*?>/, "").replace(/"/g, "").trim() || h("From");
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
  async function refreshGoogle() {
    if (!token) return;
    await Promise.allSettled([loadCalendar(), loadMail()]);
  }
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
  renderClients();
  refreshGoogle();
  setInterval(() => { renderAgenda(); }, 60000);          // 讓「下一個行程」高亮跟著時間走
  setInterval(() => { refreshGoogle(); }, 5 * 60000);     // 每 5 分鐘更新 Gmail 與日曆
})();
