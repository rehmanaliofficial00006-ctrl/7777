import express from "express";
import { waitUntil } from "@vercel/functions";
import { startBot, requestPairing, exportSession, state } from "../lib/bot.js";
import { config } from "../lib/config.js";
import { hasStore } from "../lib/authstore.js";
import { pairingPage } from "../lib/page.js";

const app = express();

// Bot ko module load par start karo (warm instance me chalta rahega)
startBot().catch((e) => console.error("startBot error:", e));

app.get("/", (req, res) => res.send(pairingPage(config.botName)));

app.get("/status", (req, res) => res.json({ status: state.status, persistent: hasStore }));

app.get("/code", async (req, res) => {
  try {
    const number = String(req.query.number || "");
    if (number.replace(/\D/g, "").length < 8) return res.status(400).json({ error: "Number sahi do" });
    const code = await requestPairing(number);
    // Vercel function ko jaga rakho jab tak link na ho (max 4 min), warna handshake beech me ruk jata hai
    if (process.env.VERCEL) {
      waitUntil(
        new Promise((resolve) => {
          const stop = () => { clearTimeout(t); clearInterval(i); resolve(); };
          const t = setTimeout(stop, 240000);
          const i = setInterval(() => { if (state.status === "open") stop(); }, 2000);
        })
      );
    }
    res.json({ code });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/ping", (req, res) => {
  startBot().catch(() => {});
  // function ko ~4.5 min jaga rakho taake bot messages sunta rahe
  if (process.env.VERCEL) waitUntil(new Promise((r) => setTimeout(r, 270000)));
  res.json({ ok: true, status: state.status });
});

app.get("/pair", async (req, res) => {
  try {
    const number = String(req.query.number || "");
    if (number.replace(/\D/g, "").length < 8) return res.status(400).send("Number sahi do");
    const code = await requestPairing(number);
    res.send(`<body style="font-family:system-ui;text-align:center;margin-top:60px">
<h1 style="letter-spacing:6px">${code}</h1>
<p>WhatsApp → Linked Devices → Link with phone number → ye code dalo.</p>
<p>Link hone ke baad <a href="/session">/session</a> kholo.</p></body>`);
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

// Session ID: Vercel env me SESSION_ID bana kar paste karo taake redeploy par logout na ho.
// SECURITY: URL sirf SESSION_SECRET ke sath chalta hai.
app.get("/session", (req, res) => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || req.query.key !== secret) {
    return res.status(403).send("Forbidden. Vercel env me SESSION_SECRET set karo, phir /session?key=<secret> kholo.");
  }
  const id = exportSession();
  if (!id) return res.status(404).send("Abhi session nahi bana. Pehle pair karo.");
  res.type("text/plain").send(id);
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server http://localhost:${port}`));
}

export default app;
