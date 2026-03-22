export function renderDebugUi(): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Debug</title>
<style>
*{box-sizing:border-box;margin:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0e1a;color:#d8e0f0;padding:20px}
h1{font-size:20px;color:#7eb8ff;margin-bottom:12px}
.toolbar{display:flex;gap:8px;margin-bottom:14px;align-items:center}
.toolbar button{background:#1a2240;color:#7eb8ff;border:1px solid #2a3a5a;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px}
.toolbar button:hover{background:#243060}
.toolbar .status{font-size:12px;color:#4a5a7a;margin-left:auto}
.status-bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.status-chip{padding:5px 12px;border-radius:6px;font-size:13px;font-weight:600}
.chip-ok{background:#0d3320;color:#34d399}
.chip-warn{background:#332d0d;color:#fbbf24}
.chip-err{background:#330d0d;color:#f87171}
.chip-info{background:#0d2640;color:#60a5fa}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
.card{background:#10172a;border:1px solid #1a2545;border-radius:10px;overflow:hidden}
.card.full{grid-column:1/-1}
.card-head{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:#131c33;border-bottom:1px solid #1a2545}
.card-head h3{font-size:13px;color:#8ab4e8;font-weight:600}
.badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;background:#0d2640;color:#60a5fa}
.card-body{padding:10px 14px;max-height:360px;overflow-y:auto}
.card-body.tall{max-height:520px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px}
.stat-item{background:#0d1225;border-radius:6px;padding:8px}
.stat-val{font-size:18px;font-weight:700;color:#fff}
.stat-label{font-size:10px;color:#5a6a8a;margin-top:2px}
.kv-table{width:100%;font-size:12px;border-collapse:collapse}
.kv-table td{padding:4px 8px;border-bottom:1px solid #151f35}
.kv-table td:first-child{color:#5a6a8a;white-space:nowrap;width:160px}
.kv-table td:last-child{color:#c0d0e8;word-break:break-all}
.kv-table .ok{color:#34d399}
.kv-table .err{color:#f87171}
.trace{background:#0d1225;border-radius:8px;padding:10px;margin-bottom:8px;border-left:3px solid #2a3a5a}
.trace.active{border-left-color:#34d399}
.trace.skip{opacity:0.55;border-left-color:#2a2a3a}
.trace.policy{border-left-color:#60a5fa}
.trace .meta{font-size:11px;color:#5a6a8a;margin-bottom:3px}
.trace .thought{font-size:12px;color:#a0b0d0;margin-top:4px;padding:6px;background:#080d1a;border-radius:4px;border-left:2px solid #333;line-height:1.5}
.trace .tools{font-size:11px;color:#60a5fa;margin-top:4px}
.chat-entry{margin-bottom:8px;font-size:13px}
.chat-entry .ts{font-size:11px;color:#4a5a7a}
.chat-entry .user{color:#7eb8ff;font-weight:600}
.chat-entry .ai{color:#34d399;font-weight:600}
.log-entry{padding:3px 0;border-bottom:1px solid #151f35;font-size:12px}
.log-entry .ts{color:#4a5a7a;font-size:11px}
.log-entry.error{color:#f87171}
.log-entry.warn{color:#fbbf24}
</style>
</head><body>
<h1>Spark Debug</h1>
<div class="status-bar" id="status-bar"></div>
<div class="toolbar">
  <button onclick="refresh()">Aktualisieren</button>
  <button onclick="simulatePopup()">Popup testen</button>
  <span class="status" id="refresh-status"></span>
</div>
<div class="grid">
  <div class="card">
    <div class="card-head"><h3>Runtime</h3></div>
    <div class="card-body"><table class="kv-table" id="runtime"></table></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Stats</h3><span class="badge" id="stats-badge">-</span></div>
    <div class="card-body"><div class="stat-grid" id="stats"></div></div>
  </div>
  <div class="card full">
    <div class="card-head"><h3>Agent-Entscheidungen</h3><span class="badge" id="dec-badge">-</span></div>
    <div class="card-body tall" id="decisions"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Chat</h3><span class="badge" id="chat-badge">-</span></div>
    <div class="card-body" id="chats"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Logs</h3></div>
    <div class="card-body tall" id="logs"></div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
const j=async u=>{try{return(await fetch(u)).json()}catch{return null}};
const ts=iso=>{if(!iso)return'-';return new Date(iso).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})};
const esc=s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');

function renderStatus(rt){
  const bar=$('status-bar');
  const chips=[];
  const chip=(text,cls)=>'<span class="status-chip chip-'+cls+'">'+text+'</span>';
  chips.push(chip('PID '+rt.pid,'info'));
  chips.push(chip(rt.model||'?','info'));
  chips.push(rt.grokKeyPresent?chip('API Key ✓','ok'):chip('API Key ✗','err'));
  chips.push(rt.cloudProxyUrl?chip('Proxy ✓','ok'):chip('Proxy ✗','warn'));
  chips.push(rt.openAiKeyPresent?chip('STT Key ✓','ok'):chip('STT ✗','warn'));
  chips.push(rt.windowsNativeExe?chip('Overlay ✓','ok'):chip('Overlay ✗','warn'));
  bar.innerHTML=chips.join('');
}

function renderRuntime(rt,ex){
  const row=(k,v,cls)=>'<tr><td>'+k+'</td><td'+(cls?' class="'+cls+'"':'')+'>'+(v??'-')+'</td></tr>';
  $('runtime').innerHTML=[
    row('Model',rt.model),
    row('Base URL',rt.grokBaseUrl),
    row('Cloud Proxy',rt.cloudProxyUrl||'nicht konfiguriert'),
    row('API Key',rt.grokKeyPresent?'vorhanden':'FEHLT',rt.grokKeyPresent?'ok':'err'),
    row('STT Key',rt.openAiKeyPresent?'vorhanden':(rt.cloudProxyUrl?'via Proxy':'FEHLT'),rt.openAiKeyPresent||rt.cloudProxyUrl?'ok':'err'),
    row('Overlay',rt.windowsNativeExe||'nicht gefunden',rt.windowsNativeExe?'ok':'err'),
    row('Config',rt.runtimeConfigPath||'-'),
    row('Data',rt.dataDir),
    row('Timeout',rt.aiTimeoutMs+'ms'),
    row('Build',rt.buildId),
    row('Extension',ex&&ex.lastSeen?'Aktiv ('+ts(ex.lastSeen)+')':'Nicht verbunden',ex&&ex.lastSeen?'ok':'err'),
  ].join('');
}

function renderStats(s){
  const usd=v=>typeof v==='number'?'$'+v.toFixed(4):'-';
  $('stats-badge').textContent=s.eventsReceived+' events';
  $('stats').innerHTML=[
    {v:s.eventsReceived,l:'Events'},{v:s.agentCalls||0,l:'Agent Calls'},
    {v:s.agentSkips||0,l:'Skips'},{v:s.chatMessages||0,l:'Chats'},
    {v:s.aiTotalTokens||0,l:'Tokens'},{v:usd(s.aiEstimatedCostUsd||0),l:'Kosten'},
    {v:ts(s.lastEventAt),l:'Letztes Event'}
  ].map(x=>'<div class="stat-item"><div class="stat-val">'+x.v+'</div><div class="stat-label">'+x.l+'</div></div>').join('');
}

function renderDecisions(traces){
  const called=traces.filter(t=>!(t.response||{}).agentSkipped).length;
  const skipped=traces.length-called;
  $('dec-badge').textContent=called+' calls / '+skipped+' skips';
  $('decisions').innerHTML=traces.slice(0,30).map(t=>{
    const r=t.response||{};const e=t.event||{};const ai=r.ai||{};
    const isSkip=Boolean(r.agentSkipped);
    const isPolicy=typeof r.reason==='string'&&r.reason.includes('curated_gate');
    const cls=isSkip?'skip':isPolicy?'policy':'active';
    const label=isPolicy?'<span style="color:#60a5fa">Policy</span>'
      :ai.used?'<span style="color:#34d399">Agent</span>'
      :'<span style="color:#f87171">Offline</span>';
    let h='<div class="trace '+cls+'">';
    h+='<div class="meta">'+ts(t.at)+' '+label;
    if(e.platform)h+=' · '+e.platform;
    if(e.contentMode)h+=' · '+e.contentMode;
    if(r.nextCheckSeconds)h+=' · next '+r.nextCheckSeconds+'s';
    h+='</div>';
    if(e.url)h+='<div class="meta">'+esc(String(e.url).slice(0,100))+'</div>';
    const thought=t.agentThinking||ai.thought||r.reason;
    if(thought)h+='<div class="thought">'+esc(thought)+'</div>';
    const tools=t.toolCalls||[];
    if(tools.length)h+='<div class="tools">Tools: '+tools.map(x=>x.tool).join(', ')+'</div>';
    if(r.commands&&r.commands.length)h+='<div class="tools">Commands: '+r.commands.map(c=>c.type+': '+esc(String(c.url||'').slice(0,60))).join(' | ')+'</div>';
    h+='</div>';return h;
  }).join('');
}

function renderChats(chats){
  $('chat-badge').textContent=(chats.length||0);
  $('chats').innerHTML=chats.slice(0,15).map(c=>{
    let h='<div class="chat-entry"><span class="ts">'+ts(c.at)+'</span>';
    h+='<div><span class="user">Du:</span> '+esc(c.userMessage)+'</div>';
    h+='<div><span class="ai">Spark:</span> '+esc(c.reply)+'</div>';
    h+='</div>';return h;
  }).join('')||'<span style="color:#5a6a8a">Keine Chats.</span>';
}

function renderLogs(logs){
  $('logs').innerHTML=logs.slice(0,30).map(l=>{
    const cls=l.level==='error'?'error':l.level==='warn'?'warn':'';
    let h='<div class="log-entry '+cls+'"><span class="ts">'+ts(l.at)+'</span> '+esc(l.message);
    if(l.context&&l.context.reason)h+=' ('+esc(l.context.reason)+')';
    return h+'</div>';
  }).join('')||'<span style="color:#5a6a8a">Keine Logs.</span>';
}

async function refresh(){
  $('refresh-status').textContent='…';
  try{
    const[rt,s,l,d,ch,ex]=await Promise.all([
      j('/debug/runtime'),j('/debug/stats'),j('/debug/client-logs?limit=30'),
      j('/debug/traces?limit=25'),j('/debug/chat-log?limit=15'),j('/extension/status')
    ]);
    if(rt){renderStatus(rt);renderRuntime(rt,ex);}
    if(s)renderStats(s);
    if(d)renderDecisions(d.traces||[]);
    if(ch)renderChats(ch.chats||[]);
    if(l)renderLogs(l.logs||[]);
    $('refresh-status').textContent=new Date().toLocaleTimeString('de-DE');
  }catch(e){$('refresh-status').textContent='Fehler: '+e;}
}

async function simulatePopup(){
  try{
    const r=await fetch('/debug/simulate-popup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'quote',text:'Test-Popup von Spark Debug.',author:'Spark'})});
    const d=await r.json();
    $('refresh-status').textContent=d.ok?'Popup gestartet':'Fehler: '+(d.error||r.status);
  }catch(e){$('refresh-status').textContent='Fehler: '+e;}
}

refresh();setInterval(refresh,3000);
</script></body></html>`;
}
