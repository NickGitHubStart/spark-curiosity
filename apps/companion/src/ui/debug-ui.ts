export function renderDebugUi(): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Debug</title>
<style>
*{box-sizing:border-box;margin:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0e1a;color:#d8e0f0;padding:20px}
h1{font-size:22px;color:#7eb8ff;margin-bottom:4px}
.sub{font-size:13px;color:#5a6a8a;margin-bottom:16px}
.toolbar{display:flex;gap:8px;margin-bottom:16px;align-items:center}
.toolbar button{background:#1a2240;color:#7eb8ff;border:1px solid #2a3a5a;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px}
.toolbar button:hover{background:#243060}
.status{font-size:12px;color:#4a5a7a}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
@media(max-width:1100px){.grid{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
.card{background:#10172a;border:1px solid #1a2545;border-radius:10px;overflow:hidden}
.card.span2{grid-column:span 2}
@media(max-width:1100px){.card.span2{grid-column:span 1}}
.card-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#131c33;border-bottom:1px solid #1a2545}
.card-head h3{font-size:14px;color:#8ab4e8;font-weight:600}
.badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600}
.badge-green{background:#0d3320;color:#34d399}
.badge-blue{background:#0d2640;color:#60a5fa}
.badge-yellow{background:#332d0d;color:#fbbf24}
.badge-red{background:#330d0d;color:#f87171}
.card-body{padding:12px 14px;max-height:320px;overflow-y:auto}
.card-body.tall{max-height:480px}
.stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.stat-item{background:#0d1225;border-radius:8px;padding:10px}
.stat-val{font-size:22px;font-weight:700;color:#fff}
.stat-label{font-size:11px;color:#5a6a8a;margin-top:2px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;color:#a0b0d0;margin:0}
.decision-card{background:#0d1225;border-radius:10px;padding:12px;margin-bottom:10px;border-left:3px solid #2a3a5a}
.decision-card.prompted{border-left-color:#34d399;background:#0d1528}
.decision-card .meta{font-size:11px;color:#5a6a8a;margin-bottom:4px}
.decision-card .reason{font-size:13px;color:#c0d0e8}
.decision-card .ai-thought{font-size:12px;color:#8090b0;margin-top:4px;font-style:italic}
.insight-line{padding:4px 0;border-bottom:1px solid #151f35;font-size:13px;line-height:1.5}
.log-entry{padding:4px 0;border-bottom:1px solid #151f35;font-size:12px}
.log-entry .ts{color:#4a5a7a;font-size:11px}
.log-entry.error{color:#f87171}
.log-entry.warn{color:#fbbf24}
.mem-section{margin-bottom:10px}
.mem-section h4{font-size:12px;color:#5a6a8a;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px}
.mem-tag{display:inline-block;background:#1a2545;color:#8ab4e8;padding:2px 8px;border-radius:4px;margin:2px;font-size:12px}
.platform-bar{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.platform-chip{padding:4px 10px;border-radius:6px;font-size:13px;font-weight:600}
.platform-chip.youtube{background:#1a0d0d;color:#ff6b6b}
.platform-chip.x{background:#0d1a2a;color:#60a5fa}
.platform-chip.other{background:#1a1a0d;color:#9a9a6a}
.goal-card{background:#0d1a25;border:1px solid #1a3545;border-radius:8px;padding:8px 10px;margin-bottom:6px}
.goal-card .label{font-size:11px;color:#5a7a8a;text-transform:uppercase}
.goal-card .val{font-size:14px;color:#60d0a0;font-weight:600}
.media-card{background:#1a0d25;border-radius:8px;padding:6px 10px;margin-bottom:4px;font-size:12px}
.media-card a{color:#a080d0;text-decoration:none}
.chat-entry{margin-bottom:8px}
.chat-entry .user{color:#7eb8ff;font-weight:600}
.chat-entry .ai{color:#34d399;font-weight:600}
.chat-entry .msg{font-size:13px;margin-top:2px}
</style>
</head><body>
<h1>Spark Curiosity - Debug Dashboard</h1>
<div class="sub" id="runtime-info"></div>
<div class="toolbar">
  <button onclick="refresh()">Aktualisieren</button>
  <button onclick="clearView()">Logs leeren</button>
  <span class="status" id="refresh-status"></span>
</div>
<div class="grid">
  <div class="card">
    <div class="card-head"><h3>Stats</h3><span class="badge badge-green" id="stats-badge">-</span></div>
    <div class="card-body"><div class="stat-grid" id="stats"></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Ziele & Praeferenzen</h3><span class="badge badge-green" id="goals-badge">-</span></div>
    <div class="card-body" id="goals"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Memory</h3><span class="badge badge-blue" id="mem-badge">-</span></div>
    <div class="card-body" id="memory"></div>
  </div>
  <div class="card span2">
    <div class="card-head"><h3>Agent-Entscheidungen</h3><span class="badge badge-yellow" id="dec-badge">-</span></div>
    <div class="card-body tall" id="decisions"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Insights & AI-Notizen</h3></div>
    <div class="card-body tall" id="insights"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Chat-Verlauf</h3><span class="badge badge-blue" id="chat-badge">-</span></div>
    <div class="card-body" id="chats"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Feedback</h3><span class="badge badge-blue" id="fb-badge">-</span></div>
    <div class="card-body" id="feedback"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Client Logs</h3></div>
    <div class="card-body tall" id="logs"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Runtime</h3></div>
    <div class="card-body"><pre id="runtime"></pre></div>
  </div>
</div>
<script>
async function j(u){try{const r=await fetch(u);return r.json()}catch{return null}}
function ts(iso){if(!iso)return'-';const d=new Date(iso);return d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function renderStats(s){
  const usd=(v)=>typeof v==='number'?'$'+v.toFixed(4):'-';
  document.getElementById('stats-badge').textContent=s.eventsReceived+' events';
  document.getElementById('stats').innerHTML=[
    {v:s.eventsReceived,l:'Events'},{v:s.agentCalls||0,l:'Agent-Calls'},
    {v:s.agentSkips||0,l:'Agent-Skips'},{v:s.feedbackReceived,l:'Feedback'},
    {v:s.chatMessages||0,l:'Chat-Nachr.'},{v:s.aiTotalTokens||0,l:'AI Tokens'},
    {v:usd(s.aiEstimatedCostUsd||0),l:'AI Kosten (USD)'},{v:s.aiCostTrackedCalls||0,l:'Cost-Calls'},
    {v:s.aiUnpricedCalls||0,l:'Unpriced-Calls'},{v:ts(s.lastEventAt),l:'Letztes Event'}
  ].map(x=>'<div class="stat-item"><div class="stat-val">'+x.v+'</div><div class="stat-label">'+x.l+'</div></div>').join('');
}

function renderGoals(m){
  const el=document.getElementById('goals');
  const badge=document.getElementById('goals-badge');
  let html='';
  if(m.goals&&m.goals.length){
    badge.textContent=m.goals.length+' Ziele';
    m.goals.forEach(g=>{
      const labels={avoid:'Vermeiden',reduce:'Reduzieren',keep:'Beibehalten'};
      html+='<div class="goal-card"><div class="label">'+g.platform+'</div><div class="val">'+(labels[g.intention]||g.intention)+(g.dailyLimitMinutes?' ('+g.dailyLimitMinutes+' min/Tag)':'')+'</div>'+(g.context?'<div style="font-size:11px;color:#5a7a8a;margin-top:2px">'+g.context+'</div>':'')+'</div>';
    });
  }else{badge.textContent='Keine';html='<div style="color:#5a6a8a">Noch keine Ziele gesetzt.</div>';}
  if(m.motivationalMedia&&m.motivationalMedia.length){
    html+='<div class="mem-section" style="margin-top:10px"><h4>Motivationale Medien</h4>';
    m.motivationalMedia.forEach(x=>{html+='<div class="media-card"><a href="'+x.url+'" target="_blank">'+x.title+'</a>'+(x.context?' - '+x.context:'')+'</div>';});
    html+='</div>';
  }
  if(Object.keys(m.userPreferences||{}).length){
    html+='<div class="mem-section" style="margin-top:10px"><h4>Praeferenzen</h4>';
    for(const[k,v]of Object.entries(m.userPreferences)){html+='<div class="mem-tag">'+k+': '+v+'</div>';}
    html+='</div>';
  }
  el.innerHTML=html;
}
function renderMemory(m){
  const el=document.getElementById('memory');
  document.getElementById('mem-badge').textContent=m.totalEvents+' total';
  let html='<div class="mem-section"><h4>Plattformen</h4><div class="platform-bar">';
  for(const[p,c]of Object.entries(m.platformCounts||{})){html+='<div class="platform-chip '+p+'">'+p+': '+c+'</div>';}
  html+='</div></div>';
  html+='<div class="mem-section"><h4>Zusammenfassung</h4><div class="stat-grid">';
  html+='<div class="stat-item"><div class="stat-val">'+m.totalPrompts+'</div><div class="stat-label">Prompts</div></div>';
  html+='<div class="stat-item"><div class="stat-val">'+m.totalFeedback+'</div><div class="stat-label">Feedback</div></div>';
  html+='</div></div>';
  if(m.notes&&m.notes.length){html+='<div class="mem-section"><h4>Notizen</h4>';m.notes.slice(-8).reverse().forEach(n=>{html+='<div class="mem-tag">'+n+'</div>';});html+='</div>';}
  el.innerHTML=html;
}
function renderInsights(text,llmInsights){
  const el=document.getElementById('insights');
  let html='';
  if(llmInsights&&llmInsights.length){
    html+='<div class="mem-section"><h4>AI-Erkenntnisse</h4>';
    llmInsights.slice(-10).reverse().forEach(i=>{html+='<div class="insight-line" style="color:#60d0a0">'+i+'</div>';});
    html+='</div>';
  }
  if(text&&text.trim()){
    html+='<div class="mem-section"><h4>Insights-Log</h4>';
    text.trim().split('\\n').filter(l=>l.trim()).slice(-10).reverse().forEach(l=>{html+='<div class="insight-line">'+l.replace(/^- /,'')+'</div>';});
    html+='</div>';
  }
  if(!html)html='<div style="color:#5a6a8a">Noch keine Insights.</div>';
  el.innerHTML=html;
}
function renderDecisions(traces){
  const el=document.getElementById('decisions');
  const called=traces.filter(t=>!(t.response||{}).agentSkipped).length;
  const skipped=traces.filter(t=>(t.response||{}).agentSkipped).length;
  document.getElementById('dec-badge').textContent=called+' calls / '+skipped+' skips';
  el.innerHTML=traces.slice(0,30).map(t=>{
    const r=t.response||{};const e=t.event||{};const ai=r.ai||{};
    const wasSkipped=Boolean(r.agentSkipped);const agentOn=ai.used;const prompted=false;
    const toolCalls=t.toolCalls||[];
    if(wasSkipped){
      let h='<div class="decision-card" style="opacity:0.6;border-left-color:#2a2a3a">';
      h+='<div class="meta">'+ts(t.at)+' - <span style="color:#5a6a8a">Skipped</span>';
      if(t.skipReason)h+=' - <span style="color:#4a5a7a">'+t.skipReason+'</span>';
      h+='</div>';
      if(e.url){h+='<div class="meta" style="color:#4a5a6a;margin:2px 0">'+String(e.url).slice(0,80)+'</div>';}
      const skipThought=t.agentThinking||ai.thought||r.reason;
      if(skipThought){
        h+='<div style="margin:6px 0;padding:8px;background:#080d1a;border-radius:6px;border-left:2px solid #555">';
        h+='<div style="font-size:11px;color:#5a6a8a;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px">Agent-Denken (Skip)</div>';
        h+='<div style="font-size:13px;color:#aab8d0;line-height:1.5">'+skipThought+'</div>';
        h+='</div>';
      }
      h+='</div>';return h;
    }
    let h='<div class="decision-card'+(prompted?' prompted':'')+'">';
    h+='<div class="meta">'+ts(t.at)+' - '+(e.platform||'?')+' - '+(e.contentMode||'?');
    h+=(agentOn?' - <span style="color:#34d399">Agent</span>':' - <span style="color:#f87171">Agent offline</span>');
    if(r.nextCheckSeconds)h+=' - Next: '+r.nextCheckSeconds+'s';
    h+='</div>';
    if(e.url){h+='<div class="meta" style="color:#6a7a9a;margin:2px 0">'+String(e.url).slice(0,100)+'</div>';}
    if(e.title){h+='<div class="meta" style="color:#8a9aba">'+String(e.title).slice(0,80)+'</div>';}
    h+='<div style="margin:6px 0;padding:8px;background:#080d1a;border-radius:6px;border-left:2px solid '+(agentOn?'#4a8af5':'#555')+'">';
    h+='<div style="font-size:11px;color:#5a6a8a;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px">Agent-Denken</div>';
    h+='<div style="font-size:13px;color:#c0d0e8;line-height:1.5">'+(t.agentThinking||ai.thought||r.reason||'(kein Output)')+'</div>';
    h+='</div>';
    if(toolCalls.length){
      h+='<div class="meta" style="margin-top:6px">Tools: <span style="color:#60a5fa">'+toolCalls.map(x=>x.tool).join(', ')+'</span></div>';
    }
    if(r.commands&&r.commands.length){
      h+='<div class="meta" style="margin-top:2px">Commands: '+r.commands.map(c=>c.type+': '+String(c.url).slice(0,60)).join(' | ')+'</div>';
    }
    h+='</div>';return h;
  }).join('');
}
function renderChats(chats){
  const el=document.getElementById('chats');
  document.getElementById('chat-badge').textContent=(chats.length||0)+' Nachr.';
  el.innerHTML=chats.slice(0,20).map(c=>{
    let h='<div class="chat-entry"><span class="ts">'+ts(c.at)+'</span>';
    h+='<div><span class="user">Du:</span> <span class="msg">'+c.userMessage+'</span></div>';
    h+='<div><span class="ai">Spark:</span> <span class="msg">'+c.reply+'</span></div>';
    if(c.memoryUpdated)h+='<span class="badge badge-green" style="margin-top:4px">Memory aktualisiert</span>';
    h+='</div>';return h;
  }).join('');
}
function renderFeedback(traces){
  const el=document.getElementById('feedback');
  document.getElementById('fb-badge').textContent=traces.length+' Eintr.';
  el.innerHTML=traces.slice(0,15).map(t=>{
    const p=t.payload||{};
    const feedbackType=p.feedback||'?';
    const rating=p.rating||'';
    const emoji=feedbackType==='quote'?(rating==='down'?'[quote-]':'[quote+]'):feedbackType==='up'?'[up]':feedbackType==='down'?'[down]':'[nav]';
    const label=feedbackType==='quote'
      ? ('quote '+(rating||'?')+': '+(p.text||'').slice(0,50))
      : (feedbackType==='review'?'review: '+(p.selectedOption||'?'):feedbackType);
    let h='<div class="log-entry"><span class="ts">'+ts(t.at)+'</span> '+emoji+' '+label;
    if(t.redirectUrl)h+=' -> <span style="color:#34d399">'+t.redirectUrl+'</span>';
    return h+'</div>';
  }).join('');
}
function renderLogs(logs){
  document.getElementById('logs').innerHTML=logs.slice(0,40).map(l=>{
    const cls=l.level==='error'?'error':l.level==='warn'?'warn':'';
    let h='<div class="log-entry '+cls+'"><span class="ts">'+ts(l.at)+'</span> <strong>'+l.message+'</strong>';
    if(l.context&&l.context.reason)h+=' ('+l.context.reason+')';
    return h+'</div>';
  }).join('');
}
function renderRuntime(rt){
  document.getElementById('runtime-info').textContent='PID '+rt.pid+' - Provider: '+rt.provider+' - Model: '+rt.model;
  document.getElementById('runtime').textContent=JSON.stringify(rt,null,2);
}
async function refresh(){
  document.getElementById('refresh-status').textContent='Lade...';
  try{
    const[rt,s,l,d,f,m,i,ch]=await Promise.all([
      j('/debug/runtime'),j('/debug/stats'),j('/debug/client-logs?limit=40'),j('/debug/traces?limit=20'),
      j('/debug/feedback-traces?limit=15'),j('/memory'),j('/memory/insights'),j('/debug/chat-log?limit=20')
    ]);
    if(rt)renderRuntime(rt);if(s)renderStats(s);if(l)renderLogs(l.logs||[]);
    if(d)renderDecisions(d.traces||[]);if(f)renderFeedback(f.traces||[]);
    if(m){renderMemory(m);renderGoals(m);renderInsights(i?i.text:'',m.llmInsights||[]);}
    if(ch)renderChats(ch.chats||[]);
    document.getElementById('refresh-status').textContent='Aktualisiert: '+new Date().toLocaleTimeString('de-DE');
  }catch(e){document.getElementById('refresh-status').textContent='Fehler: '+e;}
}
function clearView(){['logs','decisions','feedback','chats'].forEach(id=>{document.getElementById(id).innerHTML='';})}
refresh();setInterval(refresh,3000);
</script></body></html>`;
}
