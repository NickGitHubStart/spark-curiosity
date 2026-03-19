function sanitize(text: string, max: number): string {
  return (text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim().slice(0, max);
}

export function renderQuotePage(params: URLSearchParams): string {
  const text = sanitize(params.get("text") || "Kurze Pause. Atme durch, dann weiter mit Fokus.", 260);
  const author = sanitize(params.get("author") || "", 120);
  const textJson = JSON.stringify(text);
  const authorJson = JSON.stringify(author);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark – Focus Impuls</title>
<style>
  :root{--bg:#0b0f1e;--panel:#11182d;--border:#24304f;--text:#e8eefc;--muted:#95a3c7;--accent:#4a8af5;--accent2:#34d399;--danger:#ef4444}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(900px 500px at 50% 30%,#1a2440,transparent),var(--bg);color:var(--text);font-family:Segoe UI,system-ui,sans-serif;padding:24px;overflow:hidden}

  .card{position:relative;max-width:680px;width:100%;background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:36px 40px 32px;box-shadow:0 24px 48px rgba(0,0,0,0.5);animation:card-in .5s ease-out}
  @keyframes card-in{0%{opacity:0;transform:translateY(20px) scale(.97)}100%{opacity:1;transform:translateY(0) scale(1)}}

  .pill{display:inline-block;background:#0d2520;color:#86efac;border-radius:999px;padding:5px 14px;font-size:11px;font-weight:700;letter-spacing:.3px;margin-bottom:20px}

  .quote-mark{font-size:48px;line-height:1;color:var(--accent);opacity:.35;font-family:Georgia,serif;margin-bottom:-8px}
  .quote-text{font-size:22px;line-height:1.6;margin:0 0 16px;font-weight:400;color:#dbe7ff}
  .author{font-size:14px;color:var(--muted);text-align:right;font-style:italic}
  .author::before{content:'— '}

  .divider{height:1px;background:var(--border);margin:24px 0 20px}

  .hint{font-size:13px;color:#6b7aa0;line-height:1.5;text-align:center}

  .feedback{display:flex;justify-content:center;gap:12px;margin-top:20px}
  .fb-btn{border:none;border-radius:14px;padding:12px 24px;font-size:14px;cursor:pointer;font-weight:700;display:flex;align-items:center;gap:8px;transition:transform .15s,box-shadow .2s}
  .fb-btn:active{transform:scale(.95)}
  .fb-btn:disabled{opacity:.5;cursor:not-allowed}
  .fb-up{background:linear-gradient(135deg,#0d2520,#14332a);color:#86efac;border:1px solid #1a4a3a}
  .fb-up:hover:not(:disabled){box-shadow:0 4px 16px rgba(52,211,153,0.2)}
  .fb-down{background:linear-gradient(135deg,#2a0d0d,#3a1414);color:#fca5a5;border:1px solid #4a1a1a}
  .fb-down:hover:not(:disabled){box-shadow:0 4px 16px rgba(239,68,68,0.15)}

  .done{display:none;text-align:center;padding:10px 0}
  .done.show{display:block;animation:fade-in .3s ease-out}
  .done-text{font-size:14px;color:var(--accent2)}
  @keyframes fade-in{0%{opacity:0}100%{opacity:1}}

  .close-hint{margin-top:16px;font-size:12px;color:#4a5a80;text-align:center}

  .bg-glow{position:fixed;width:400px;height:400px;border-radius:50%;filter:blur(100px);opacity:.08;pointer-events:none}
  .bg-glow.g1{background:var(--accent);top:-100px;left:-100px}
  .bg-glow.g2{background:var(--accent2);bottom:-100px;right:-100px}
</style></head>
<body>
<div class="bg-glow g1"></div>
<div class="bg-glow g2"></div>
<div class="card">
  <div class="pill">Focus Impuls</div>
  <div class="quote-mark">&ldquo;</div>
  <p class="quote-text">${text}</p>
  ${author ? `<div class="author">${author}</div>` : ""}
  <div class="divider"></div>
  <div class="hint">Wenn du bereit bist, geh zurueck zu deiner Aufgabe.</div>
  <div class="feedback" id="feedback">
    <button class="fb-btn fb-up" id="fb-up">&#128077; Danke, hilft!</button>
    <button class="fb-btn fb-down" id="fb-down">&#128078; Nicht hilfreich</button>
  </div>
  <div class="done" id="done">
    <div class="done-text">Feedback gespeichert. Weiter so!</div>
  </div>
  <div class="close-hint">Seite schliesst automatisch nach Feedback.</div>
</div>
<script>
const quoteText = ${textJson};
const quoteAuthor = ${authorJson};
async function sendFeedback(feedback){
  try{
    await fetch('/quote/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:quoteText,author:quoteAuthor,feedback})});
  }catch(e){}
  document.getElementById('fb-up').disabled=true;
  document.getElementById('fb-down').disabled=true;
  document.getElementById('done').classList.add('show');
  setTimeout(()=>{ try{window.close();}catch(e){} },1800);
}
document.getElementById('fb-up').onclick=()=>sendFeedback('up');
document.getElementById('fb-down').onclick=()=>sendFeedback('down');
</script></body></html>`;
}
