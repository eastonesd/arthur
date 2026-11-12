/* A.R.T.H.U.R. 核心：東石知識圖譜（球形視圖）
   資料在 atlas-data.js（window.ATLAS：repos／nodes／edges），由 build_atlas.py 從七個 repo 的原始碼產生。
   操作：拖曳旋轉、點節點看說明、點兩下回到初始視角；放開 2 秒沒再碰就繼續自轉。手機上直向滑動仍是捲動頁面。 */
(function () {
  "use strict";
  const DATA = window.ATLAS, canvas = document.getElementById("atlas"), chip = document.getElementById("atlasChip");
  if (!DATA || !canvas) return;
  const { nodes, edges, repos } = DATA;
  const ctx = canvas.getContext("2d"), TAU = 2 * Math.PI;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const files = repos.map((r, i) => nodes.filter((n) => n.r === i && n.type === "file"));
  const linksOf = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => { linksOf.get(e[0]).push(e); linksOf.get(e[1]).push(e); });

  // 節點位置：每個專案在球面上一個中心，檔案以黃金角螺旋散開
  const xyz = (lon, lat) => [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
  const normal = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const mix = (a, b, t) => a.map((x, k) => x * (1 - t) + b[k] * t);
  repos.forEach((r, i) => {
    const c = xyz(r.lon, r.lat), east = [Math.cos(r.lon), 0, -Math.sin(r.lon)];
    const north = [-Math.sin(r.lon) * Math.sin(r.lat), Math.cos(r.lat), -Math.cos(r.lon) * Math.sin(r.lat)];
    byId.get(r.r).v = c;
    files[i].forEach((n, j) => {
      const a = j * 2.39996 + i, t = 0.13 + 0.39 * Math.sqrt((j + 0.4) / files[i].length);
      n.v = normal(c.map((x, k) => x + t * (east[k] * Math.cos(a) + north[k] * Math.sin(a))));
    });
  });

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let selected = null, yaw = 0, tilt = -0.06, auto = !reduce, dirty = true, frame = 0;
  let width = 0, height = 0, rad = 0, hits = [], visible = true;
  let lastTouch = 0;                 // 最後一次觸碰的時間；放開 2 秒沒再碰就恢復自轉
  const RESUME_MS = 2000;

  const wire = [];
  for (let i = 1; i < 14; i++) { const lat = Math.PI * (i / 14 - 0.5); wire.push(Array.from({ length: 61 }, (_, j) => xyz((j * TAU) / 60, lat))); }
  for (let i = 0; i < 24; i++) wire.push(Array.from({ length: 31 }, (_, j) => xyz((i * TAU) / 24, (j / 30 - 0.5) * Math.PI)));

  function project(v) {
    const x = Math.cos(yaw) * v[0] + Math.sin(yaw) * v[2], z0 = -Math.sin(yaw) * v[0] + Math.cos(yaw) * v[2];
    const y = Math.cos(tilt) * v[1] - Math.sin(tilt) * z0, z = Math.sin(tilt) * v[1] + Math.cos(tilt) * z0;
    const k = 1 / (1.17 - 0.15 * z);
    return { x: width / 2 + x * rad * k, y: height / 2 - y * rad * k, z };
  }
  function stroke(pts, color, w) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); }
  function dot(p, r, c) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fillStyle = c; ctx.fill(); }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    rad = Math.min(width, height) * 0.46;
    const c0 = { x: width / 2, y: height / 2 }, g = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, rad * 1.08);
    g.addColorStop(0, "rgba(94,200,255,.16)"); g.addColorStop(0.78, "rgba(94,200,255,.1)");
    g.addColorStop(0.86, "rgba(245,180,58,.12)"); g.addColorStop(1, "rgba(3,6,13,0)");
    dot(c0, rad * 1.08, g);
    for (const line of wire) {
      const ps = line.map(project);
      stroke(ps, "rgba(94,200,255,.07)", 0.7);
      ctx.beginPath(); let prev = false;
      for (const p of ps) { if (p.z > 0) { prev ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); prev = true; } else prev = false; }
      ctx.strokeStyle = "rgba(94,200,255,.13)"; ctx.stroke();
    }
    const at = new Map(nodes.map((n) => [n.id, project(n.v)]));
    const sel = selected && selected.id;
    for (const [a, b, kind] of edges) {
      const A = byId.get(a), B = byId.get(b), p = at.get(a), q = at.get(b), toRepo = B.type === "repo";
      const active = sel && (a === sel || b === sel);
      ctx.globalAlpha = (toRepo ? 0.8 : active ? 0.85 : kind === "收錄檔案" ? 0.26 : 0.18) * (p.z + q.z < 0 ? 0.4 : 1);
      const pts = toRepo ? Array.from({ length: 25 }, (_, j) => project(normal(mix(A.v, B.v, j / 24)))) : [p, q];
      stroke(pts, repos[B.r].color, toRepo ? 1.4 : active ? 1.2 : 0.7);
    }
    ctx.globalAlpha = 1; hits = [];
    const order = nodes.slice().sort((a, b) => at.get(a.id).z - at.get(b.id).z);
    for (const n of order) {
      const p = at.get(n.id), repo = n.type === "repo", on = n.id === sel, col = repos[n.r].color;
      ctx.globalAlpha = repo ? 1 : 0.35 + 0.6 * (p.z + 1) / 2;
      if (repo || on) {
        dot(p, on ? 16 : 10, col + "22");
        ctx.beginPath(); ctx.arc(p.x, p.y, on ? 10 : 6.5, 0, TAU); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
        ctx.shadowBlur = 12; ctx.shadowColor = col;
      }
      dot(p, repo ? 3.6 : on ? 3.4 : 1.9, col); ctx.shadowBlur = 0;
      hits.push({ n, p });
    }
    // 專案名稱（背面的淡一點）
    ctx.globalAlpha = 1;
    const fs = width < 420 ? 11 : 12;
    ctx.font = `600 ${fs}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
    for (const n of order.filter((n) => n.type === "repo" || n.id === sel)) {
      const p = at.get(n.id), r = repos[n.r], label = n.type === "repo" ? r.title : n.name.split("/").pop();
      const w = ctx.measureText(label).width + 14, h = fs + 10;
      const x = clamp(p.x + 9, 2, width - w - 2), y = clamp(p.y - h - 6, 2, height - h - 2);
      ctx.globalAlpha = p.z < -0.15 ? 0.45 : 1;
      ctx.fillStyle = "rgba(6,14,26,.88)"; ctx.strokeStyle = r.color + "99"; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 4) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = r.color; ctx.fillText(label, x + 7, y + fs + 3);
    }
    ctx.globalAlpha = 1;
  }

  function showChip(n) {
    if (!chip) return;
    if (!n) { chip.hidden = true; return; }
    const r = repos[n.r], isRepo = n.type === "repo";
    const others = linksOf.get(n.id).filter((e) => e[2] !== "收錄檔案").length;
    const sub = isRepo ? `${files[n.r].length} 個檔案・${r.kind}` : `${r.title}・${(n.sy || []).length} 個函式・${others} 條關聯`;
    chip.style.setProperty("--tone", r.color);
    chip.innerHTML = `<i></i><span class="atlas-name">${esc(isRepo ? r.title : n.name.split("/").pop())}</span>`
      + `<span class="atlas-sub">${esc(sub)}</span><a href="${esc(n.url)}" target="_blank" rel="noopener">原始碼 ↗</a>`;
    chip.hidden = false;
  }
  function choose(n) {
    selected = n; showChip(n); dirty = true;
    if (n) auto = false;
  }

  // 尺寸一律跟著外框（.core）走，不讀 canvas 自己的大小：
  // 否則樣式還沒載入時，canvas 的像素寬度會回頭撐大自己，越長越大直到瀏覽器畫不出來。
  const box = canvas.parentElement;
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
  function resize() {
    width = Math.max(1, Math.min(box.clientWidth, 1600)); height = Math.max(1, Math.min(box.clientHeight, 1600));
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); dirty = true;
  }
  new ResizeObserver(resize).observe(box);
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(canvas);

  function tick(t) {
    const dt = Math.min(t - frame, 50); frame = t;
    if (!auto && !reduce && !start && t - lastTouch > RESUME_MS) auto = true;
    if (auto && visible) { yaw += dt * 0.00007; dirty = true; }
    if (dirty && visible) { draw(); dirty = false; }
    requestAnimationFrame(tick);
  }

  // 拖曳旋轉；點一下選節點；點兩下回到初始視角
  let start = null, last = null, drag = false;
  const pt = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  canvas.addEventListener("pointerdown", (e) => { start = last = pt(e); drag = false; auto = false; lastTouch = e.timeStamp; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!start) return;
    const p = pt(e); lastTouch = e.timeStamp;
    if (!drag && Math.hypot(p.x - start.x, p.y - start.y) > 4) drag = true;
    if (drag) {
      yaw += (p.x - last.x) * 0.007;
      if (e.pointerType !== "touch") tilt = clamp(tilt + (p.y - last.y) * 0.007, -1.4, 1.4);
      auto = false; dirty = true;
    }
    last = p;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (start && !drag) {
      const p = pt(e);
      const h = hits.map((v) => ({ ...v, d: Math.hypot(v.p.x - p.x, v.p.y - p.y) }))
        .filter((v) => v.p.z > -0.2 && v.d < (v.n.type === "repo" ? 16 : 10)).sort((a, b) => a.d - b.d)[0];
      choose(h ? h.n : null);
    }
    start = null; lastTouch = e.timeStamp;
  });
  canvas.addEventListener("pointercancel", (e) => { start = null; lastTouch = e.timeStamp; });
  canvas.addEventListener("dblclick", () => { yaw = 0; tilt = -0.06; auto = !reduce; choose(null); });

  resize(); requestAnimationFrame(tick);
})();
