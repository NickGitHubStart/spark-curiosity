export function renderDesktopSetupUi(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Desktop Setup</title>
<style>
body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#0b1020;color:#e8eefc;margin:0;padding:24px}
.card{max-width:720px;margin:0 auto;background:#131a2e;border:1px solid #24304f;border-radius:14px;padding:20px}
h1{margin:0 0 8px 0;font-size:22px}
p{color:#a8b8d8}
label{display:block;margin-top:14px;margin-bottom:6px;font-size:13px;color:#b9c7e6}
input,select,textarea,button{width:100%;box-sizing:border-box;border-radius:10px;border:1px solid #2a3a62;background:#0a1328;color:#e8eefc;padding:10px}
textarea{min-height:96px;resize:vertical}
button{margin-top:18px;background:#2f6df6;border:none;font-weight:700;cursor:pointer}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ok{margin-top:14px;color:#68d391}
.err{margin-top:14px;color:#fca5a5}
.meta{margin-top:6px;font-size:12px;color:#8da0c8}
a{color:#84aefc}
</style></head>
<body><div class="card">
<h1>Spark Desktop Setup</h1>
<p>API-Key + Vorlage setzen. Danach laeuft Spark im Hintergrund weiter.</p>
<div id="status" class="meta">Lade Setup-Daten...</div>
<label>Grok API Key</label><input id="apiKey" type="password" placeholder="xai-..."/>
<div class="row">
<div><label>Model</label><input id="model" type="text" value="grok-4-1-fast-reasoning"/></div>
<div><label>Vorlage</label><select id="template"></select></div>
</div>
<label>Notizen (optional)</label><textarea id="notes" placeholder="z.B. Fokus auf Deep Work, keine Social Apps nach 23 Uhr"></textarea>
<button id="saveBtn">Speichern & weiter</button>
<div id="result"></div>
<button id="enableExtBtn" style="background:#0f3d8a">Browser-Kontrolle aktivieren (Admin)</button>
<div id="extResult" class="meta"></div>
<button id="assistExtBtn" style="background:#0f3d8a">Extension manuell aktivieren (1‑Klick)</button>
<div id="assistResult" class="meta"></div>
<div class="meta">Debug UI: <a href="/debug/ui" target="_blank">/debug/ui</a></div>
<div class="meta" id="updateStatus">Update-Check: ...</div>
<button id="updateBtn" style="display:none;background:#0f3d8a">Update starten (Command kopieren)</button>
</div>
<script>
const $=id=>document.getElementById(id);
async function j(url,opt){const r=await fetch(url,opt);if(!r.ok)throw new Error(await r.text());return r.json();}
async function load(){
  const [cfg, tpls] = await Promise.all([j('/desktop/config'), j('/onboarding/templates')]);
  $('status').textContent = cfg.runtimeConfigPath ? ('Config: '+cfg.runtimeConfigPath) : 'Config-Pfad fehlt (SPARK_WINDOWS_APP_ROOT)';
  $('model').value = cfg.grokModel || 'grok-4-1-fast-reasoning';
  const sel=$('template'); sel.innerHTML='';
  (tpls.templates||[]).forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name||t.id; sel.appendChild(o); });
  if(!sel.options.length){const o=document.createElement('option');o.value='';o.textContent='(keine Vorlage gefunden)';sel.appendChild(o);}
  try{
    const u=await j('/desktop/update-check');
    if(u && u.updateAvailable){
      $('updateStatus').textContent='Update verfuegbar: '+u.currentVersion+' -> '+u.latestVersion;
      const btn=$('updateBtn');
      btn.style.display='block';
      btn.onclick=async()=>{
        try{ await navigator.clipboard.writeText('spark-curiosity update'); }catch{}
        btn.textContent='Command kopiert: spark-curiosity update';
      };
    }else if(u && u.currentVersion){
      $('updateStatus').textContent='Version aktuell: '+u.currentVersion;
    }
  }catch(e){
    $('updateStatus').textContent='Update-Check fehlgeschlagen';
  }
}
$('saveBtn').onclick=async()=>{
  const result=$('result'); result.className='meta'; result.textContent='Speichere...';
  try{
    const payload={grokApiKey:$('apiKey').value.trim(),grokModel:$('model').value.trim(),templateId:$('template').value,customNotes:$('notes').value.trim()};
    await j('/desktop/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    result.className='ok';
    result.textContent='Gespeichert. Debug UI wird geoeffnet...';
    setTimeout(()=>{ window.location.href='/debug/ui'; },700);
  }catch(e){
    result.className='err';
    result.textContent='Fehler: '+String(e);
  }
};
$('enableExtBtn').onclick=async()=>{
  const out=$('extResult'); out.className='meta'; out.textContent='Starte Admin-Setup (UAC)...';
  try{
    await j('/admin/enable-extension',{method:'POST'});
    out.className='ok';
    out.textContent='UAC-Prompt geoeffnet. Danach Chrome neu starten.';
  }catch(e){
    out.className='err';
    out.textContent='Fehler: '+String(e);
  }
};
$('assistExtBtn').onclick=async()=>{
  const out=$('assistResult'); out.className='meta'; out.textContent='Oeffne Chrome Extensions + Ordner...';
  try{
    await j('/desktop/extension-assist',{method:'POST'});
    out.className='ok';
    out.textContent='Jetzt in Chrome: "Entpackt laden" klicken und den geoeffneten Ordner waehlen.';
  }catch(e){
    out.className='err';
    out.textContent='Fehler: '+String(e);
  }
};
load().catch(e=>{$('status').textContent='Fehler: '+String(e);});
</script></body></html>`;
}
