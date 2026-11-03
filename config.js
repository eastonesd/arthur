/* JARVIS 設定檔 — 只需要改這裡 */
window.JARVIS_CONFIG = {
  // Google Cloud 的「OAuth 用戶端 ID」（網頁應用程式類型）。
  // 這串 ID 是公開資訊，可以放進 GitHub；請勿放「用戶端密鑰」(client secret)。
  googleClientId: "678637279500-tocvq9136ehbpihr5ou3oje5ugu1vb6r.apps.googleusercontent.com",

  // 要讀取的 Google 日曆，"primary" 代表主要日曆
  calendarId: "primary",

  // 今日指揮中心下方的生活提醒
  routines: [
    { label: "吃飯", time: "12:00" },
    { label: "洗澡", time: "22:30" }
  ]
};
