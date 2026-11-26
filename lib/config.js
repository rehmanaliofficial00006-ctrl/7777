export const config = {
  prefix: process.env.PREFIX || ".",
  botName: process.env.BOT_NAME || "MD BOT",
  // Sirf owner .setdp chala sakta hai. Number country code ke sath, + ke baghair: 923001234567
  owner: (process.env.OWNER_NUMBER || "").replace(/\D/g, ""),
  // Menu image: URL do, warna assets/bot.jpg use hogi
  imageUrl: process.env.BOT_IMAGE_URL || "",
  // Purani session restore karne ke liye (base64 creds.json)
  tmdbKey: process.env.TMDB_API_KEY || "",
  sessionId: process.env.SESSION_ID || "",
  // Vercel par sirf /tmp writable hai
  sessionDir: process.env.SESSION_DIR || (process.env.VERCEL ? "/tmp/session" : "./session"),
};
