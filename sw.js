/* JARVIS service worker：讓安裝後的 App 可離線開啟。
   只快取本站檔案；Google、Supabase、匯率等外部請求一律直接走網路。 */
const VERSION = "jarvis-2.5.0";
const SHELL = [
  "./", "index.html", "style.css", "script.js", "config.js", "manifest.webmanifest",
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
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
