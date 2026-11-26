import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import pino from "pino";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  normalizeMessageContent,
  jidNormalizedUser,
  Browsers,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import yts from "yt-search";
import ytdl from "@distube/ytdl-core";
import { config } from "./config.js";
import { hasStore, useRedisAuthState } from "./authstore.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ level: "silent" });

export const state = { sock: null, status: "idle", starting: false };

// ---------- session helpers ----------
function restoreSession() {
  fs.mkdirSync(config.sessionDir, { recursive: true });
  const credsPath = path.join(config.sessionDir, "creds.json");
  if (config.sessionId && !fs.existsSync(credsPath)) {
    try {
      fs.writeFileSync(credsPath, Buffer.from(config.sessionId, "base64").toString("utf8"));
      console.log("Session restore ho gayi SESSION_ID se");
    } catch (e) {
      console.error("SESSION_ID invalid hai:", e.message);
    }
  }
}

export function exportSession() {
  const credsPath = path.join(config.sessionDir, "creds.json");
  if (!fs.existsSync(credsPath)) return null;
  return Buffer.from(fs.readFileSync(credsPath)).toString("base64");
}

// ---------- menu ----------
function menuText(pushName) {
  const p = config.prefix;
  return `╭━━〔 *${config.botName}* 〕━━⬣
┃ 👋 Hello, ${pushName || "User"}
┃ ⚙️ Prefix : ${p}
┃ 🟢 Status : Online
╰━━━━━━━━━━━━━━⬣

╭━━〔 *MAIN* 〕━━⬣
┃ ${p}menu  - ye menu
┃ ${p}ping  - speed check
┃ ${p}alive - bot zinda hai?
┃ ${p}play <song naam> - gana
┃ ${p}movie <naam> - movie info + trailer
┃ ${p}freemovie <naam> - free movies ki list
┃ ${p}getmovie <id> - free movie ka video
╰━━━━━━━━━━━━━━⬣

╭━━〔 *OWNER* 〕━━⬣
┃ ${p}setdp <link>
┃ ${p}setdp (image par reply)
┃ ${p}setdp demo - demo dp
╰━━━━━━━━━━━━━━⬣

╭━━〔 *TOOLS* 〕━━⬣
┃ ${p}vv  - view-once isi chat me (owner)
┃ ${p}vv2 - view-once apne inbox me (owner)
┃ ${p}calc <2+2*5>
┃ ${p}weather <shehar>
┃ ${p}joke
┃ ${p}quote
┃ ${p}runtime
┃ ${p}owner
╰━━━━━━━━━━━━━━⬣

╭━━〔 *GROUP* 〕━━⬣
┃ ${p}tagall - sab ko tag (admin)
┃ ${p}groupinfo
╰━━━━━━━━━━━━━━⬣

_Powered by ${config.botName}_`;
}

let imageCache; // ek baar load, phir RAM se
async function getBotImage() {
  if (imageCache !== undefined) return imageCache;
  imageCache = null;
  if (config.imageUrl) {
    try {
      const r = await fetch(config.imageUrl);
      if (r.ok) imageCache = Buffer.from(await r.arrayBuffer());
    } catch {}
  }
  if (!imageCache) {
    const local = path.join(__dirname, "..", "assets", "bot.jpg");
    if (fs.existsSync(local)) imageCache = fs.readFileSync(local);
  }
  return imageCache;
}

// ---------- helpers ----------
function getText(m) {
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  );
}

function isOwner(msg, sock) {
  if (msg.key.fromMe) return true;
  if (!config.owner) return false;
  const sender = (msg.key.participant || msg.key.remoteJid || "").split("@")[0].split(":")[0];
  return sender === config.owner;
}

async function downloadFromLink(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Link se download fail (HTTP ${res.status})`);
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error("Ye link image ka nahi hai (jpg/png link do)");
  return Buffer.from(await res.arrayBuffer());
}

async function getImageFromReply(msg, sock) {
  const ctx = normalizeMessageContent(msg.message)?.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;
  if (!quoted) return null;
  const q = normalizeMessageContent(quoted);
  if (!q?.imageMessage) return null;
  const fake = {
    key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
    message: quoted,
  };
  return downloadMediaMessage(fake, "buffer", {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage,
  });
}

async function revealViewOnce(sock, msg, to) {
  const ctx = normalizeMessageContent(msg.message)?.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;
  const q = quoted && normalizeMessageContent(quoted);
  const kind = q?.imageMessage ? "image" : q?.videoMessage ? "video" : q?.audioMessage ? "audio" : null;
  if (!kind) {
    await sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Kisi view-once photo/video/audio par reply karke command likho." }, { quoted: msg });
    return false;
  }
  try {
    const fake = { key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }, message: quoted };
    const buffer = await downloadMediaMessage(fake, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
    const caption = q[`${kind}Message`].caption || "";
    if (kind === "image") await sock.sendMessage(to, { image: buffer, caption });
    else if (kind === "video") await sock.sendMessage(to, { video: buffer, caption });
    else await sock.sendMessage(to, { audio: buffer, mimetype: "audio/mp4" });
    return true;
  } catch (e) {
    await sock.sendMessage(msg.key.remoteJid, { text: `❌ Media nahi mili (expire ho chuki hogi): ${e.message}` }, { quoted: msg });
    return false;
  }
}

// ---------- commands ----------
const commands = {
  async menu({ sock, from, msg }) {
    const caption = menuText(msg.pushName);
    const image = await getBotImage();
    if (image) {
      await sock.sendMessage(from, { image, caption }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text: caption }, { quoted: msg });
    }
  },

  async ping({ sock, from, msg }) {
    const ts = Number(msg.messageTimestamp?.toString?.() ?? msg.messageTimestamp ?? 0) * 1000;
    const ms = ts ? Math.max(0, Date.now() - ts) : 0;
    await sock.sendMessage(from, { text: `🏓 Pong! ${ms} ms` }, { quoted: msg });
  },

  async alive({ sock, from, msg }) {
    await sock.sendMessage(from, { text: `✅ *${config.botName}* online hai!` }, { quoted: msg });
  },

  async play({ sock, from, msg, args }) {
    const query = args.join(" ").trim();
    if (!query) {
      return sock.sendMessage(from, { text: `⚠️ Use: ${config.prefix}play <song ka naam>\nMisal: ${config.prefix}play tum hi ho` }, { quoted: msg });
    }
    try {
      await sock.sendMessage(from, { react: { text: "🔎", key: msg.key } });
      const res = await yts(query);
      const v = res.videos?.[0];
      if (!v) return sock.sendMessage(from, { text: "❌ Koi result nahi mila." }, { quoted: msg });
      if (v.seconds > 900) {
        return sock.sendMessage(from, { text: "❌ Ye gana 15 minute se lamba hai." }, { quoted: msg });
      }
      await sock.sendMessage(
        from,
        {
          image: { url: v.thumbnail },
          caption: `🎵 *${v.title}*\n👤 ${v.author?.name || "-"}\n⏱️ ${v.timestamp}\n\n⏳ Download ho raha hai...`,
        },
        { quoted: msg }
      );
      const stream = ytdl(v.url, {
        quality: "highestaudio",
        filter: (f) => f.hasAudio && !f.hasVideo && f.mimeType?.includes("audio/mp4"),
        highWaterMark: 1 << 25,
      });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const audio = Buffer.concat(chunks);
      await sock.sendMessage(
        from,
        { audio, mimetype: "audio/mp4", fileName: `${v.title}.m4a` },
        { quoted: msg }
      );
      await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
    } catch (e) {
      console.error("play error:", e);
      await sock.sendMessage(from, { text: `❌ Gana download nahi ho saka: ${e.message}` }, { quoted: msg });
    }
  },

  async movie({ sock, from, msg, args }) {
    const q = args.join(" ").trim();
    if (!q) return sock.sendMessage(from, { text: `⚠️ Use: ${config.prefix}movie <movie ka naam>` }, { quoted: msg });
    if (!config.tmdbKey) return sock.sendMessage(from, { text: "❌ TMDB_API_KEY set nahi hai (themoviedb.org se free key lo)." }, { quoted: msg });
    try {
      const api = (p, extra = "") => fetch(`https://api.themoviedb.org/3${p}?api_key=${config.tmdbKey}${extra}`).then((r) => r.json());
      const found = await api("/search/movie", `&query=${encodeURIComponent(q)}`);
      const hit = found.results?.[0];
      if (!hit) return sock.sendMessage(from, { text: "❌ Movie nahi mili." }, { quoted: msg });
      const d = await api(`/movie/${hit.id}`, "&append_to_response=videos");
      const trailer = d.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer");
      const caption =
        `🎬 *${d.title}* (${(d.release_date || "").slice(0, 4)})\n` +
        `⭐ ${d.vote_average?.toFixed(1)}/10  ⏱️ ${d.runtime || "?"} min\n` +
        `🎭 ${(d.genres || []).map((g) => g.name).join(", ")}\n\n` +
        `${(d.overview || "").slice(0, 600)}\n\n` +
        (trailer ? `▶️ Trailer: https://youtu.be/${trailer.key}` : "");
      if (d.poster_path) {
        await sock.sendMessage(from, { image: { url: `https://image.tmdb.org/t/p/w500${d.poster_path}` }, caption }, { quoted: msg });
      } else {
        await sock.sendMessage(from, { text: caption }, { quoted: msg });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
    }
  },

  async freemovie({ sock, from, msg, args }) {
    const q = args.join(" ").trim();
    if (!q) return sock.sendMessage(from, { text: `⚠️ Use: ${config.prefix}freemovie <naam>\nSirf public domain / free movies milti hain (Internet Archive).` }, { quoted: msg });
    try {
      const query = `title:(${q}) AND mediatype:movies AND collection:(feature_films OR moviesandfilms)`;
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=year&rows=5&output=json`;
      const j = await (await fetch(url)).json();
      const docs = j.response?.docs || [];
      if (!docs.length) return sock.sendMessage(from, { text: "❌ Free movie nahi mili. (Naye copyrighted movies yahan nahi hoti.)" }, { quoted: msg });
      const text =
        "🎞️ *Free movies (Internet Archive)*\n\n" +
        docs.map((d, i) => `${i + 1}. *${d.title}* ${d.year ? `(${d.year})` : ""}\n🆔 ${d.identifier}\n🔗 https://archive.org/details/${d.identifier}`).join("\n\n");
      await sock.sendMessage(from, { text }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
    }
  },

  async getmovie({ sock, from, msg, args }) {
    const id = (args[0] || "").trim();
    if (!id) return sock.sendMessage(from, { text: `⚠️ Use: ${config.prefix}getmovie <id>\n(id ${config.prefix}freemovie ki list se lo)` }, { quoted: msg });
    const maxMB = Number(process.env.MAX_VIDEO_MB || 2048);
    try {
      const meta = await (await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`)).json();
      const files = (meta.files || [])
        .filter((f) => /\.mp4$/i.test(f.name) && Number(f.size) > 0)
        .sort((a, b) => Number(a.size) - Number(b.size));
      if (!files.length) return sock.sendMessage(from, { text: "❌ Is item me mp4 video nahi mili." }, { quoted: msg });
      const small = files.filter((f) => Number(f.size) <= maxMB * 1024 * 1024).pop();
      const pageUrl = `https://archive.org/details/${id}`;
      if (!small) {
        return sock.sendMessage(from, { text: `⚠️ Video ${maxMB}MB se bari hai, WhatsApp par nahi bhej sakta.\n🔗 ${pageUrl}` }, { quoted: msg });
      }
      const mb = (Number(small.size) / 1048576).toFixed(1);
      await sock.sendMessage(from, { text: `⏳ *${meta.metadata?.title || id}* (${mb} MB) download ho rahi hai...` }, { quoted: msg });
      const res = await fetch(`https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(small.name)}`);
      if (!res.ok) throw new Error(`Download fail (HTTP ${res.status})`);
      const video = Readable.fromWeb(res.body); // stream: poori file RAM me load nahi hoti
      await sock.sendMessage(
        from,
        { video: { stream: video }, mimetype: "video/mp4", fileName: small.name, caption: `🎬 ${meta.metadata?.title || id}\n(Public domain - Internet Archive)` },
        { quoted: msg }
      );
    } catch (e) {
      console.error("getmovie error:", e);
      await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
    }
  },

  async vv({ sock, from, msg }) {
    if (!isOwner(msg, sock)) return sock.sendMessage(from, { text: "❌ Sirf owner." }, { quoted: msg });
    await revealViewOnce(sock, msg, from);
  },

  async vv2({ sock, from, msg }) {
    if (!isOwner(msg, sock)) return sock.sendMessage(from, { text: "❌ Sirf owner." }, { quoted: msg });
    const me = jidNormalizedUser(sock.user.id);
    const ok = await revealViewOnce(sock, msg, me);
    if (ok) await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
  },

  async calc({ sock, from, msg, args }) {
    const expr = args.join(" ").replace(/x/gi, "*").replace(/,/g, "");
    if (!expr || !/^[0-9+\-*/().%\s^]+$/.test(expr) || expr.length > 100) {
      return sock.sendMessage(from, { text: `⚠️ Use: ${config.prefix}calc 12*(3+4)` }, { quoted: msg });
    }
    try {
      const out = Function(`"use strict"; return (${expr.replace(/\^/g, "**")})`)();
      if (typeof out !== "number" || !isFinite(out)) throw new Error("bad");
      await sock.sendMessage(from, { text: `🧮 ${expr} = *${out}*` }, { quoted: msg });
    } catch {
      await sock.sendMessage(from, { text: "❌ Expression sahi nahi hai." }, { quoted: msg });
    }
  },

  async weather({ sock, from, msg, args }) {
    const city = args.join(" ").trim();
    if (!city) return sock.sendMessage(from, { text: `⚠️ Use: ${config.prefix}weather Karachi` }, { quoted: msg });
    try {
      const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%l:+%c+%t+(feels+%f)+💧%h+💨%w`);
      if (!r.ok) throw new Error("not found");
      await sock.sendMessage(from, { text: `🌤️ ${(await r.text()).trim()}` }, { quoted: msg });
    } catch {
      await sock.sendMessage(from, { text: "❌ Weather nahi mila." }, { quoted: msg });
    }
  },

  async joke({ sock, from, msg }) {
    try {
      const j = await (await fetch("https://official-joke-api.appspot.com/random_joke")).json();
      await sock.sendMessage(from, { text: `😂 ${j.setup}\n\n👉 ${j.punchline}` }, { quoted: msg });
    } catch {
      await sock.sendMessage(from, { text: "❌ Joke nahi mila, dobara try karo." }, { quoted: msg });
    }
  },

  async quote({ sock, from, msg }) {
    try {
      const [q] = await (await fetch("https://zenquotes.io/api/random")).json();
      await sock.sendMessage(from, { text: `💬 _${q.q}_\n\n— *${q.a}*` }, { quoted: msg });
    } catch {
      await sock.sendMessage(from, { text: "❌ Quote nahi mila, dobara try karo." }, { quoted: msg });
    }
  },

  async runtime({ sock, from, msg }) {
    const s = Math.floor(process.uptime());
    const t = `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
    await sock.sendMessage(from, { text: `⏱️ Runtime: *${t}*` }, { quoted: msg });
  },

  async owner({ sock, from, msg }) {
    if (!config.owner) return sock.sendMessage(from, { text: "Owner set nahi hai." }, { quoted: msg });
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Owner\nTEL;type=CELL;waid=${config.owner}:+${config.owner}\nEND:VCARD`;
    await sock.sendMessage(from, { contacts: { displayName: "Owner", contacts: [{ vcard }] } }, { quoted: msg });
  },

  async tagall({ sock, from, msg, args }) {
    if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ Ye command sirf group me chalti hai." }, { quoted: msg });
    const meta = await sock.groupMetadata(from);
    const sender = msg.key.participant || "";
    const isAdmin = meta.participants.some((p) => p.admin && (p.id === sender || p.lid === sender));
    if (!isAdmin && !isOwner(msg, sock)) return sock.sendMessage(from, { text: "❌ Sirf group admin." }, { quoted: msg });
    const list = meta.participants.map((p) => p.id);
    const text = `📢 *${args.join(" ") || "Attention!"}*\n\n` + list.map((j) => `@${j.split("@")[0]}`).join(" ");
    await sock.sendMessage(from, { text, mentions: list }, { quoted: msg });
  },

  async groupinfo({ sock, from, msg }) {
    if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ Ye command sirf group me chalti hai." }, { quoted: msg });
    const m = await sock.groupMetadata(from);
    const admins = m.participants.filter((p) => p.admin).length;
    const text = `👥 *${m.subject}*\n\n👤 Members: ${m.participants.length}\n🛡️ Admins: ${admins}\n📅 Bana: ${new Date((m.creation || 0) * 1000).toLocaleDateString("en-GB")}\n\n📝 ${m.desc || "Koi description nahi"}`;
    await sock.sendMessage(from, { text }, { quoted: msg });
  },

  async setdp({ sock, from, msg, args }) {
    if (!isOwner(msg, sock)) {
      return sock.sendMessage(from, { text: "❌ Ye command sirf owner ke liye hai." }, { quoted: msg });
    }
    let buffer;
    try {
      const link = args.find((a) => /^https?:\/\//i.test(a));
      if (args[0]?.toLowerCase() === "demo") {
        buffer = fs.readFileSync(path.join(__dirname, "..", "assets", "dp.jpg"));
      } else if (link) {
        buffer = await downloadFromLink(link);
      } else {
        buffer = await getImageFromReply(msg, sock);
      }
      if (!buffer) {
        return sock.sendMessage(
          from,
          { text: `⚠️ Use karo:\n${config.prefix}setdp <image link>\nya kisi image par reply karke ${config.prefix}setdp` },
          { quoted: msg }
        );
      }
      const botJid = jidNormalizedUser(sock.user.id);
      await sock.updateProfilePicture(botJid, buffer);
      await sock.sendMessage(from, { text: "✅ Profile picture update ho gayi!" }, { quoted: msg });
    } catch (e) {
      console.error("setdp error:", e);
      await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
    }
  },
};

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.remoteJid === "status@broadcast") return;
  const m = normalizeMessageContent(msg.message);
  const text = getText(m).trim();
  if (!text.startsWith(config.prefix)) return;

  const [cmdRaw, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  const handler = commands[cmd];
  if (!handler) return;
  try {
    await handler({ sock, msg, from: msg.key.remoteJid, args });
  } catch (e) {
    console.error(`Command ${cmd} fail:`, e);
  }
}

// ---------- connection ----------
export async function startBot() {
  if (state.starting || state.status === "open") return;
  state.starting = true;
  try {
    let store = null;
    let auth, saveCreds;
    if (hasStore) {
      store = await useRedisAuthState();
      auth = store.state;
      saveCreds = store.saveCreds;
    } else {
      restoreSession();
      ({ state: auth, saveCreds } = await useMultiFileAuthState(config.sessionDir));
    }
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
      browser: Browsers.ubuntu("Chrome"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: 20000,
      defaultQueryTimeoutMs: 20000,
      emitOwnEvents: true,
      getMessage: async () => undefined,
    });
    state.sock = sock;
    state.status = "connecting";

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection) state.status = connection;
      if (connection === "open") console.log("✅ Bot connected:", sock.user?.id);
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        state.sock = null;
        state.starting = false;
        if (code === DisconnectReason.loggedOut) {
          console.log("Logged out. Dobara pair karo.");
          if (store) await store.clear().catch(() => {});
          else fs.rmSync(config.sessionDir, { recursive: true, force: true });
          state.status = "logged_out";
        } else {
          console.log("Connection band (code", code, "), reconnecting...");
          setTimeout(startBot, 3000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      // phone se bheje gaye apne messages "append" ho sakte hain, is liye dono lo
      if (type !== "notify" && type !== "append") return;
      const now = Math.floor(Date.now() / 1000);
      await Promise.all(messages.map(async (msg) => {
        const ts = Number(msg.messageTimestamp?.toString?.() ?? msg.messageTimestamp ?? now);
        if (now - ts > 120) return; // purane messages ignore
        await handleMessage(sock, msg);
      }));
    });
  } finally {
    state.starting = false;
  }
}

export async function requestPairing(number) {
  await startBot();
  // socket ready hone ka intezar
  for (let i = 0; i < 20 && !state.sock; i++) await new Promise((r) => setTimeout(r, 500));
  const sock = state.sock;
  if (!sock) throw new Error("Socket start nahi hua");
  if (sock.authState.creds.registered) throw new Error("Bot pehle se linked hai");
  await new Promise((r) => setTimeout(r, 2000));
  return sock.requestPairingCode(number.replace(/\D/g, ""));
}
