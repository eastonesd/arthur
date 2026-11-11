/* A.R.T.H.U.R. 設定檔 — 只需要改這裡 */
window.JARVIS_CONFIG = {
  // Google Cloud 的「OAuth 用戶端 ID」（網頁應用程式類型）。
  // 這串 ID 是公開資訊，可以放進 GitHub；請勿放「用戶端密鑰」(client secret)。
  googleClientId: "678637279500-tocvq9136ehbpihr5ou3oje5ugu1vb6r.apps.googleusercontent.com",

  // 要讀取的 Google 日曆，"primary" 代表主要日曆
  calendarId: "primary",

  // Supabase（與東石保險服務平台共用同一個專案）。
  // publishable key 是公開金鑰，資料由資料表的 RLS 保護，可以放進 GitHub；
  // 請勿放 service_role / secret key。
  supabaseUrl: "https://kocyedkngpxckixtudku.supabase.co",
  supabaseKey: "sb_publishable_n309GkhFeBRtg7thi9cSdQ_m6MiBpoU",

  // 每月收入目標（台幣）：核心上方的進度條、每月 15 日的 LINE 進度提醒
  incomeGoal: 180000,

  // 今日指揮中心下方的生活提醒
  // 開啟手機通知後，時間到會推播 msg 的內容
  routines: [
    { label: "午餐", time: "12:00", msg: "先生，午餐時間到了，該去吃飯了。" },
    { label: "洗澡", time: "17:00", msg: "先生，17:00 了，該去洗澡了。" },
    // time＝推播時間；at＝事情本身的時間（畫面顯示用，沒填就顯示 time）
    { label: "倒垃圾", at: "21:50", time: "21:20", msg: "先生，21:50 要倒垃圾，還有半小時，可以先把垃圾整理好了。" },
    { label: "睡覺", time: "00:00", msg: "先生，已經 00:00，該上床睡覺了。明天見。" }
  ]
};
