/* JARVIS 設定檔 — 只需要改這裡 */
window.JARVIS_CONFIG = {
  // Google Cloud 的「OAuth 用戶端 ID」（網頁應用程式類型）。
  // 這串 ID 是公開資訊，可以放進 GitHub；請勿放「用戶端密鑰」(client secret)。
  googleClientId: "678637279500-tocvq9136ehbpihr5ou3oje5ugu1vb6r.apps.googleusercontent.com",

  // 要讀取的 Google 日曆，"primary" 代表主要日曆
  calendarId: "primary",

  // Supabase（與東石系統共用同一個專案）。
  // publishable key 是公開金鑰，資料由資料表的 RLS 保護，可以放進 GitHub；
  // 請勿放 service_role / secret key。
  supabaseUrl: "https://kocyedkngpxckixtudku.supabase.co",
  supabaseKey: "sb_publishable_n309GkhFeBRtg7thi9cSdQ_m6MiBpoU",

  // 今日指揮中心下方的生活提醒
  // 開啟手機通知後，時間到會推播 msg 的內容
  routines: [
    { label: "午餐", time: "12:00", msg: "先生，午餐時間到了，該去吃飯了。" },
    { label: "洗澡", time: "17:00", msg: "先生，17:00 了，該去洗澡了。" },
    { label: "睡覺", time: "23:00", msg: "先生，已經 23:00，該上床睡覺了。明天見。" }
  ]
};
