function sanitize(text: string, max: number): string {
  return (text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim().slice(0, max);
}

export function renderQuotePage(params: URLSearchParams): string {
  const text = sanitize(params.get("text") || "Kurze Pause. Atme durch, dann weiter mit Fokus.", 260);
  const author = sanitize(params.get("author") || "", 120);
  const textJson = JSON.stringify(text);
  const authorJson = JSON.stringify(author);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Quote</title>
<style>
  :root{--bg:#0c0f1d;--panel:#111a2e;--border:#24304f;--text:#e8eefc;--muted:#94a3c7;--accent:#34d399;}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(900px 500px at 10% -10%,#1a2440,transparent),var(--bg);color:var(--text);font-family:Segoe UI,system-ui,sans-serif;padding:24px}
  .card{position:relative;max-width:720px;background:var(--panel);border:1px solid var(--border);border-radius:18px;padding:26px 28px;box-shadow:0 20px 40px rgba(0,0,0,0.45)}
  .pill{display:inline-block;background:#0d2520;color:#86efac;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;margin-bottom:14px}
  .quote{font-size:22px;line-height:1.5;margin:0 0 12px 0}
  .author{font-size:14px;color:var(--muted);text-align:right}
  .hint{margin-top:18px;font-size:12px;color:#6b7aa0}
  .feedback{position:absolute;top:12px;right:12px;display:flex;gap:8px}
  .fb-btn{border:none;border-radius:10px;padding:6px 10px;font-size:14px;cursor:pointer;font-weight:700}
  .fb-up{background:#0d2520;color:#86efac}
  .fb-down{background:#2a0d0d;color:#fca5a5}
  .fb-msg{margin-top:10px;font-size:12px;color:#86efac;display:none}
</style></head>
<body><div class="card">
  <div class="feedback">
    <button class="fb-btn fb-up" id="fb-up" title="Quote hilfreich">👍</button>
    <button class="fb-btn fb-down" id="fb-down" title="Quote nicht hilfreich">👎</button>
  </div>
  <div class="pill">Focus Impuls</div>
  <p class="quote">"${text}"</p>
  ${author ? `<div class="author">- ${author}</div>` : ""}
  <div class="hint">Wenn du bereit bist, geh zur letzten produktiven Aufgabe zurueck.</div>
  <div class="fb-msg" id="fb-msg">Danke fuer dein Feedback.</div>
</div>
<script>
const quoteText = ${textJson};
const quoteAuthor = ${authorJson};
async function sendFeedback(feedback){
  try{
    await fetch('/quote/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:quoteText,author:quoteAuthor,feedback})});
  }catch(e){}
  const msg=document.getElementById('fb-msg'); if(msg){msg.style.display='block';}
  document.getElementById('fb-up').disabled=true;
  document.getElementById('fb-down').disabled=true;
}
document.getElementById('fb-up').onclick=()=>sendFeedback('up');
document.getElementById('fb-down').onclick=()=>sendFeedback('down');
</script></body></html>`;
}
