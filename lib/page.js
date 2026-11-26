export const pairingPage = (botName) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${botName} - Pairing</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:linear-gradient(160deg,#075e54,#128c7e 60%,#25d366);color:#111}
.card{background:#fff;border-radius:20px;padding:28px;width:min(92vw,420px);box-shadow:0 20px 50px rgba(0,0,0,.25);text-align:center}
h1{margin:0 0 4px;font-size:24px}p.sub{margin:0 0 20px;color:#667;font-size:14px}
input{width:100%;padding:14px;border:2px solid #dde;border-radius:12px;font-size:17px;text-align:center;outline:none}
input:focus{border-color:#128c7e}
button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;background:#128c7e;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
button:disabled{opacity:.6}
.code{font-size:38px;letter-spacing:6px;font-weight:800;background:#f0f7f5;border-radius:12px;padding:16px;margin-top:18px;cursor:pointer;word-break:break-all}
.msg{margin-top:14px;font-size:14px;color:#445}.err{color:#c0392b}.ok{color:#128c7e;font-weight:600}
.pill{display:inline-block;padding:4px 12px;border-radius:99px;background:#eef;font-size:12px;margin-bottom:14px}
textarea{width:100%;height:90px;margin-top:10px;border-radius:10px;border:1px solid #ccd;padding:8px;font-size:12px}
.hide{display:none}
</style></head><body><div class="card">
<img src="/dp.jpg" alt="dp" style="width:96px;height:96px;border-radius:50%;object-fit:cover;margin-bottom:10px;border:3px solid #25d366">
<h1>${botName}</h1>
<p class="sub">WhatsApp number link karo</p>
<div class="pill">Status: <b id="st">...</b></div>
<input id="num" inputmode="numeric" placeholder="923001234567" autocomplete="off">
<button id="go">Pairing code lo</button>
<div id="code" class="code hide" title="Copy karne ke liye tap karo"></div>
<div id="msg" class="msg">Number country code ke sath likho, + ke baghair.</div>
<div id="sess" class="hide">
  <input id="key" type="password" placeholder="SESSION_SECRET" style="margin-top:14px">
  <button id="get">Session ID lo</button>
  <textarea id="sid" readonly class="hide"></textarea>
</div>
</div>
<script>
const $=id=>document.getElementById(id);
const setMsg=(t,c)=>{$('msg').textContent=t;$('msg').className='msg '+(c||'')};
async function poll(){try{const r=await (await fetch('/status')).json();$('st').textContent=r.status;
 if(r.status==='open'){setMsg(r.persistent?'✅ Bot connected! Session auto-save ho gaya, kuch aur karne ki zaroorat nahi.':'✅ Bot connected! Storage connect nahi hai, Session ID le lo.','ok');if(!r.persistent)$('sess').classList.remove('hide');$('code').classList.add('hide')}}catch(e){}}
setInterval(poll,3000);poll();
$('go').onclick=async()=>{
 const n=$('num').value.replace(/\\D/g,'');
 if(n.length<8)return setMsg('Number sahi likho','err');
 $('go').disabled=true;setMsg('Code ban raha hai...');
 try{const r=await fetch('/code?number='+n);const j=await r.json();
  if(!r.ok)throw new Error(j.error);
  const c=j.code.match(/.{1,4}/g).join('-');
  $('code').textContent=c;$('code').classList.remove('hide');
  setMsg('WhatsApp → Linked Devices → Link with phone number → code dalo','');
 }catch(e){setMsg(e.message,'err')}
 $('go').disabled=false};
$('code').onclick=()=>{navigator.clipboard?.writeText($('code').textContent.replace(/-/g,''));setMsg('Code copy ho gaya ✅','ok')};
$('get').onclick=async()=>{
 const r=await fetch('/session?key='+encodeURIComponent($('key').value));const t=await r.text();
 $('sid').classList.remove('hide');$('sid').value=t;$('sid').select()};
</script></body></html>`;
