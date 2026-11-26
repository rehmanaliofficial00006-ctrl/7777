// WhatsApp session ko Upstash Redis (Vercel Storage) me auto-save karta hai.
// Vercel me Storage -> Upstash Redis connect karo, env vars khud lag jate hain.
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

export const hasStore = Boolean(URL_ && TOKEN);

async function cmd(args) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const K = (k) => `wa:${k}`;

export async function useRedisAuthState() {
  const read = async (k) => {
    const v = await cmd(["GET", K(k)]);
    return v ? JSON.parse(v, BufferJSON.reviver) : null;
  };
  const write = (k, d) => cmd(["SET", K(k), JSON.stringify(d, BufferJSON.replacer)]);
  const del = (k) => cmd(["DEL", K(k)]);

  const creds = (await read("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let v = await read(`${type}-${id}`);
              if (type === "app-state-sync-key" && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
              data[id] = v;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const cat in data) {
            for (const id in data[cat]) {
              const v = data[cat][id];
              tasks.push(v ? write(`${cat}-${id}`, v) : del(`${cat}-${id}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write("creds", creds),
    clear: async () => {
      const keys = await cmd(["KEYS", "wa:*"]);
      for (const k of keys || []) await cmd(["DEL", k]);
    },
  };
}
