export function renderDesktopSetupUi(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Desktop Setup</title>
<style>
body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#0b1020;color:#e8eefc;margin:0;padding:24px}
.card{max-width:720px;margin:0 auto;background:#131a2e;border:1px solid #24304f;border-radius:14px;padding:20px}
h1{margin:0 0 8px 0;font-size:22px}
p{color:#a8b8d8}
label{display:block;margin-top:14px;margin-bottom:6px;font-size:13px;color:#b9c7e6}
input,select,textarea,button{box-sizing:border-box;border-radius:10px;border:1px solid #2a3a62;background:#0a1328;color:#e8eefc;padding:10px}
input,select{width:100%}
textarea{min-height:96px;resize:vertical;flex:1}
button{margin-top:18px;background:#2f6df6;border:none;font-weight:700;cursor:pointer;width:100%}
.setup-notes-row{display:flex;gap:8px;align-items:flex-end;width:100%}
.setup-notes-row textarea{min-height:96px}
.btn-mic{width:42px;min-height:42px;flex-shrink:0;margin-top:0;padding:0;display:flex;align-items:center;justify-content:center;border:1px solid #2a3a62;background:#0a1328;color:#e8eefc;border-radius:10px;cursor:pointer;transition:all .2s ease}
.btn-mic.recording{background:rgba(239,68,68,.12);border-color:#f87171;color:#f87171;box-shadow:0 0 0 3px rgba(239,68,68,.15);animation:setup-mic-pulse 1.8s ease-in-out infinite}
@keyframes setup-mic-pulse{0%,100%{box-shadow:0 0 0 3px rgba(239,68,68,.15)}50%{box-shadow:0 0 0 8px rgba(239,68,68,.08)}}
.wave-box{display:none;flex:1;min-height:42px;align-items:center;gap:2px;background:linear-gradient(135deg,rgba(239,68,68,.06),rgba(239,68,68,.02));border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:0 14px;position:relative;overflow:hidden}
.wave-box.active{display:flex}
.wave-box .wb{width:3px;border-radius:99px;background:linear-gradient(180deg,#f87171,rgba(248,113,113,.4));animation:setup-wave 1s ease-in-out infinite}
.wave-box .wb:nth-child(1){height:6px}
.wave-box .wb:nth-child(2){height:14px;animation-delay:.08s}
.wave-box .wb:nth-child(3){height:22px;animation-delay:.16s}
.wave-box .wb:nth-child(4){height:28px;animation-delay:.24s}
.wave-box .wb:nth-child(5){height:22px;animation-delay:.12s}
.wave-box .wb:nth-child(6){height:14px;animation-delay:.2s}
.wave-box .wb:nth-child(7){height:18px;animation-delay:.28s}
.wave-box .wb:nth-child(8){height:10px;animation-delay:.32s}
.wave-box .wb:nth-child(9){height:24px;animation-delay:.04s}
.wave-box .wb:nth-child(10){height:16px;animation-delay:.36s}
.wave-box .wb:nth-child(11){height:8px;animation-delay:.4s}
@keyframes setup-wave{0%,100%{transform:scaleY(.3);opacity:.4}50%{transform:scaleY(1);opacity:1}}
.rec-t{color:#f87171;font-size:11px;font-weight:700;margin-left:10px;min-width:28px}
.rec-x{margin-left:6px;width:24px;height:24px;border-radius:8px;border:none;background:#f87171;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.rec-x::after{content:'';width:8px;height:8px;border-radius:2px;background:#fff}
.mic-line{font-size:12px;color:#8da0c8;margin-top:6px;min-height:18px}
.mic-line.err{color:#fca5a5}
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
<div><label>Model</label><input id="model" type="text" value="grok-4-1-fast"/></div>
<div><label>Vorlage</label><select id="template"></select></div>
</div>
<label>Notizen (optional)</label>
<div class="setup-notes-row">
<button type="button" class="btn-mic" id="setup-mic" title="Spracheingabe">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
</button>
<textarea id="notes" placeholder="z.B. Fokus auf Deep Work... oder per Mikrofon (WebM → /stt)."></textarea>
<div class="wave-box" id="setup-wave">
<div class="wb"></div><div class="wb"></div><div class="wb"></div><div class="wb"></div><div class="wb"></div><div class="wb"></div>
<div class="wb"></div><div class="wb"></div><div class="wb"></div><div class="wb"></div><div class="wb"></div>
<span class="rec-t" id="setup-rec-time">0s</span>
<button type="button" class="rec-x" id="setup-rec-stop" title="Stop"></button>
</div>
</div>
<div class="mic-line" id="setup-mic-line">Bereit.</div>
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
  $('model').value = cfg.grokModel || 'grok-4-1-fast';
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
// Mic / STT — WebM/Opus, JSON POST /stt (wie /onboard)
(function(){
  const mic=$('setup-mic'), notes=$('notes'), wave=$('setup-wave'), recT=$('setup-rec-time'), line=$('setup-mic-line');
  let recording=false, recStart=0, recTimer=null, recorder=null, currentStream=null;
  function setL(t,err){line.className='mic-line'+(err?' err':'');line.textContent=t;}
  function showRec(){recording=true;mic.classList.add('recording');notes.style.display='none';wave.classList.add('active');
    recStart=Date.now();recT.textContent='0s';recTimer=setInterval(()=>{recT.textContent=Math.floor((Date.now()-recStart)/1000)+'s';},500);setL('Aufnahme...');}
  function hideRec(){recording=false;mic.classList.remove('recording');notes.style.display='';wave.classList.remove('active');if(recTimer){clearInterval(recTimer);recTimer=null;}}
  function releaseStream(){if(currentStream){currentStream.getTracks().forEach(t=>t.stop());currentStream=null;}}
  function toBase64(bytes){let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(bin);}
  async function startRecording(){
    if(!navigator.mediaDevices?.getUserMedia){setL('Kein Mikrofon (HTTPS?).',true);return;}
    if(!window.MediaRecorder){setL('MediaRecorder fehlt.',true);return;}
    try{
      releaseStream();
      currentStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,sampleRate:{ideal:16000},channelCount:1}});
      const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'';
      recorder=new MediaRecorder(currentStream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});
      const chunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      recorder.onstop=async()=>{
        hideRec();releaseStream();
        if(!chunks.length){setL('Keine Audiodaten.',true);return;}
        setL('Transkribiere...');
        try{
          const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
          if(blob.size<500){setL('Aufnahme zu kurz.',true);return;}
          const buf=new Uint8Array(await blob.arrayBuffer());
          const res=await fetch('/stt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audioBase64:toBase64(buf),mimeType:blob.type})});
          const data=await res.json();
          if(data.error){setL('STT: '+(data.error+'').slice(0,80),true);return;}
          const text=String(data.text||'').trim();
          if(text){notes.value+=(notes.value?' ':'')+text;setL('Bereit.');notes.focus();}
          else setL('Keine Sprache erkannt.',true);
        }catch(e){console.error('[setup:stt]',e);setL('STT Fehler: '+(e.message||e).toString().slice(0,60),true);}
      };
      recorder.onerror=e=>{console.error('[setup:stt]',e);hideRec();releaseStream();setL('Aufnahme-Fehler.',true);};
      recorder.start();showRec();
    }catch(e){console.error('[setup:stt]',e);releaseStream();setL(e.name==='NotAllowedError'?'Mikrofon verweigert.':'Mikrofon: '+(e.message||e).toString().slice(0,60),true);}
  }
  mic.addEventListener('click',()=>{recording?(recorder&&recorder.stop()):startRecording();});
  $('setup-rec-stop').addEventListener('click',()=>{if(recording&&recorder)recorder.stop();});
})();
load().catch(e=>{$('status').textContent='Fehler: '+String(e);});
</script></body></html>`;
}
