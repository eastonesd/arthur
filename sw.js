/* A.R.T.H.U.R. service worker：讓安裝後的 App 可離線開啟。
   只快取本站檔案；Google、Supabase、匯率等外部請求一律直接走網路。 */
const VERSION = "jarvis-3.3.5";
const SHELL = [
  "./", "index.html", "style.css", "script.js", "config.js", "atlas.js", "atlas-data.js", "manifest.webmanifest",
  "assets/core.jpg", "assets/icon-192.png", "assets/icon-512.png", "assets/favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 本站檔案：先用網路（拿到最新版），斷線時才用快取
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});

// 手機推播：收到後顯示通知
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "A.R.T.H.U.R.", {
    body: d.body || "", tag: d.tag, icon: "assets/icon-192.png", badge: "assets/icon-192.png",
  }));
});
// 點通知打開 A.R.T.H.U.R.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow("./");
  }));
});
