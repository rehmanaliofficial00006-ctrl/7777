# WhatsApp MD Bot (Baileys)

Commands: `.menu` (bot image ke sath), `.ping`, `.alive`, `.setdp <link>`, `.setdp` (image par reply).

## Local chalana
```
npm install
OWNER_NUMBER=923001234567 npm start
```
Browser me `http://localhost:3000` kholo, number dalo, pairing code WhatsApp me enter karo.

## Vercel par deploy
1. Ye folder GitHub par push karo, Vercel me import karo (ya `npx vercel`).
2. Environment Variables:
   - `OWNER_NUMBER` = 923001234567
   - `SESSION_SECRET` = koi lamba random password
   - optional: `PREFIX`, `BOT_NAME`, `BOT_IMAGE_URL`
3. Deploy ke baad `https://<app>.vercel.app/` kholo, number dalo, code WhatsApp → Linked Devices me enter karo.
4. `https://<app>.vercel.app/session?key=<SESSION_SECRET>` kholo, jo text mile wo `SESSION_ID` env me paste karke redeploy karo.
5. Bot ko jagaye rakhne ke liye cron-job.org / UptimeRobot se `https://<app>.vercel.app/ping` har 1 minute hit karwao.

## Zaroori limitation
Vercel serverless hai: WhatsApp ka WebSocket har function instance ke sath band ho sakta hai
(max 300s). Isliye bot kabhi kabhi offline ho sakta hai jab tak `/ping` use na aaye.
24/7 reliable bot ke liye Railway / Render / VPS behtar hain (same code, `npm start`).

## Session ID ke baghair (auto-save)
Vercel dashboard -> Storage -> Create -> Upstash Redis (free) -> is project se Connect.
Env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) khud lag jate hain. Redeploy karo, bas.
Session Redis me save hota hai, `SESSION_ID` / `SESSION_SECRET` ki zaroorat nahi.

## Bot ko jaga rakhna
cron-job.org par `https://<app>.vercel.app/ping` har 4 minute par set karo.

## Movie commands
- `.movie <naam>` : poster, rating, kahani, trailer (env `TMDB_API_KEY` chahiye, themoviedb.org se free)
- `.freemovie <naam>` : Internet Archive ki free / public domain movies ke links
- `.getmovie <id>` : free movie ka mp4 WhatsApp par bhejta hai (default limit 2GB (WhatsApp ki max limit), env `MAX_VIDEO_MB` se badlo)

## Railway par deploy (24/7, tez jawab)
1. Code GitHub par push karo. railway.app -> New Project -> Deploy from GitHub repo.
2. Variables: `OWNER_NUMBER`, `TMDB_API_KEY` (optional), `PREFIX`, `BOT_NAME`.
3. Session save karne ke liye ek option chuno:
   - Redis: Railway me + New -> Database -> Redis, phir `UPSTASH_REDIS_REST_*` ki jagah ye bot Upstash use karta hai, to Upstash ke 2 env vars daalo, ya
   - Volume: service me Volume banao, mount path `/data`, aur variable `SESSION_DIR=/data/session`.
4. Settings -> Networking -> Generate Domain. Us link par pairing karo.
5. Vercel wala deployment band/delete karo, warna dono ek hi session par ladte hain.
