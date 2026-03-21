export function renderOnboardPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark – Willkommen</title>
<style>
  :root{--bg:#0b0f1e;--panel:#11182d;--border:#24304f;--text:#e8eefc;--muted:#95a3c7;--accent:#4a8af5;--accent2:#34d399;--danger:#ef4444}
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:radial-gradient(1200px 600px at 50% -20%,#1a2440,transparent),var(--bg);color:var(--text);font-family:Segoe UI,system-ui,sans-serif;min-height:100vh}

  .container{max-width:860px;margin:0 auto;padding:40px 24px 60px}
  .hero{text-align:center;margin-bottom:40px}
  .hero h1{font-size:32px;margin:0 0 8px;background:linear-gradient(135deg,#4a8af5,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .hero p{color:var(--muted);font-size:15px;max-width:520px;margin:0 auto;line-height:1.6}

  .step{display:none}
  .step.active{display:block}

  .step-indicator{display:flex;justify-content:center;gap:8px;margin-bottom:32px}
  .dot{width:10px;height:10px;border-radius:50%;background:#1e2a48;transition:background .3s}
  .dot.active{background:var(--accent)}
  .dot.done{background:var(--accent2)}

  .templates{display:grid;grid-template-columns:1fr;gap:16px}
  .tpl{background:var(--panel);border:2px solid var(--border);border-radius:16px;padding:22px 24px;cursor:pointer;transition:border-color .2s,transform .15s,box-shadow .2s}
  .tpl:hover{border-color:#3a5a9f;transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3)}
  .tpl.selected{border-color:var(--accent);box-shadow:0 0 0 3px rgba(74,138,245,0.2)}
  .tpl h3{margin:0 0 6px;font-size:18px;color:#dbe7ff}
  .tpl .desc{color:var(--muted);font-size:13px;margin-bottom:12px;line-height:1.5}
  .tpl .highlights{display:flex;flex-wrap:wrap;gap:6px}
  .tpl .hl{background:#0d2520;color:#86efac;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:600}

  .wishes-section{margin-top:8px}
  .wishes-section label{display:block;font-size:14px;color:#b9c7e6;margin-bottom:8px}
  /* Composer-Zeile (Mic | Textarea | Wellen bei Aufnahme), gleiches Muster wie /setup */
  .wishes-composer{display:flex;gap:8px;align-items:flex-end;margin-top:8px}
  .wishes-composer textarea{
    flex:1;min-height:120px;resize:vertical;background:#0a1328;border:1px solid #2a3a62;border-radius:12px;
    padding:14px;color:var(--text);font-size:14px;font-family:inherit;line-height:1.5
  }
  .wishes-composer textarea::placeholder{color:#5a6d94}
  .btn{border:1px solid #2a3a62;background:#0a1328;color:var(--text);border-radius:10px;cursor:pointer;font-weight:600}
  .btn.mic{width:42px;min-height:42px;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s ease;padding:0}
  .btn.mic.recording{
    background:rgba(239,68,68,.12);border-color:var(--danger);color:var(--danger);
    box-shadow:0 0 0 3px rgba(239,68,68,.15);animation:mic-pulse-chat 1.8s ease-in-out infinite;
  }
  @keyframes mic-pulse-chat{
    0%,100%{box-shadow:0 0 0 3px rgba(239,68,68,.15)}
    50%{box-shadow:0 0 0 8px rgba(239,68,68,.08)}
  }
  .wave-container{
    display:none;flex:1;min-height:42px;align-items:center;gap:2px;
    background:linear-gradient(135deg,rgba(239,68,68,.06),rgba(239,68,68,.02));
    border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:0 14px;position:relative;overflow:hidden;
  }
  .wave-container::before{
    content:'';position:absolute;inset:0;
    background:linear-gradient(90deg,transparent,rgba(239,68,68,.04),transparent);
    animation:wave-sweep 2s ease-in-out infinite;
  }
  @keyframes wave-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
  .wave-container.active{display:flex}
  .wave-bar{
    width:3px;border-radius:99px;
    background:linear-gradient(180deg,var(--danger),rgba(239,68,68,.4));
    animation:wave-bars 1s ease-in-out infinite;
  }
  .wave-bar:nth-child(1){height:6px;animation-delay:0s}
  .wave-bar:nth-child(2){height:14px;animation-delay:.08s}
  .wave-bar:nth-child(3){height:22px;animation-delay:.16s}
  .wave-bar:nth-child(4){height:28px;animation-delay:.24s}
  .wave-bar:nth-child(5){height:22px;animation-delay:.12s}
  .wave-bar:nth-child(6){height:14px;animation-delay:.2s}
  .wave-bar:nth-child(7){height:18px;animation-delay:.28s}
  .wave-bar:nth-child(8){height:10px;animation-delay:.32s}
  .wave-bar:nth-child(9){height:24px;animation-delay:.04s}
  .wave-bar:nth-child(10){height:16px;animation-delay:.36s}
  .wave-bar:nth-child(11){height:8px;animation-delay:.4s}
  @keyframes wave-bars{0%,100%{transform:scaleY(.3);opacity:.4}50%{transform:scaleY(1);opacity:1}}
  .rec-time{color:var(--danger);font-size:11px;font-weight:700;margin-left:10px;min-width:28px;letter-spacing:.3px}
  .rec-stop{
    margin-left:6px;width:24px;height:24px;border-radius:8px;border:none;
    background:var(--danger);cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:transform .15s;flex-shrink:0;
  }
  .rec-stop:hover{transform:scale(1.1)}
  .rec-stop::after{content:'';display:block;width:8px;height:8px;border-radius:2px;background:#fff}
  .mic-status{font-size:12px;color:var(--muted);margin-top:8px;min-height:18px}
  .mic-status.err{color:var(--danger)}

  .nav{display:flex;justify-content:space-between;align-items:center;margin-top:28px;gap:12px}
  .btn{border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer;transition:transform .1s,box-shadow .2s}
  .btn:active{transform:scale(.97)}
  .btn-primary{background:linear-gradient(135deg,#4a8af5,#3672d9);color:#fff;box-shadow:0 4px 16px rgba(74,138,245,0.3)}
  .btn-primary:hover{box-shadow:0 6px 20px rgba(74,138,245,0.45)}
  .btn-primary:disabled{opacity:.5;cursor:not-allowed}
  .btn-ghost{background:transparent;border:1px solid #2a3a62;color:#c0d8ff;padding:14px 20px}
  .btn-ghost:hover{background:#151e38}

  .done-screen{text-align:center;padding:40px 0}
  .done-screen h2{font-size:26px;margin:0 0 12px;color:#34d399}
  .done-screen p{color:var(--muted);font-size:14px;max-width:440px;margin:8px auto;line-height:1.6}
  .checkmark{font-size:48px;margin-bottom:16px}

  .loader-dots{display:inline-flex;gap:6px;vertical-align:middle}
  .loader-dots span{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:dot-pulse 1.4s ease-in-out infinite}
  .loader-dots span:nth-child(2){animation-delay:.2s}
  .loader-dots span:nth-child(3){animation-delay:.4s}
  @keyframes dot-pulse{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1.1)}}

  .status{font-size:13px;color:var(--muted);margin-top:12px;min-height:20px}
  .status.error{color:var(--danger)}
</style></head>
<body>
<div class="container">
  <div class="hero">
    <h1>Willkommen bei Spark</h1>
    <p>Dein persoenlicher Agent, der dich vor Ablenkung schuetzt und zu deinen Zielen fuehrt.</p>
  </div>

  <div class="step-indicator">
    <div class="dot active" id="dot0"></div>
    <div class="dot" id="dot1"></div>
    <div class="dot" id="dot2"></div>
  </div>

  <!-- Step 1: Template Selection -->
  <div class="step active" id="step0">
    <div class="templates" id="templates"></div>
    <div class="nav">
      <div></div>
      <button class="btn btn-primary" id="nextStep1" disabled>Weiter</button>
    </div>
  </div>

  <!-- Step 2: Custom Wishes -->
  <div class="step" id="step1">
    <div class="wishes-section">
      <label>Hast du besondere Wuensche an Spark? (optional)</label>
      <p style="color:var(--muted);font-size:13px;margin-top:0">z.B. welche Seiten blockiert werden sollen, wann Pausen ok sind, spezielle Ziele...</p>
      <div class="wishes-composer">
        <button type="button" class="btn mic" id="onboard-mic" title="Spracheingabe">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <textarea id="wishes" placeholder="Beschreibe deine Wuensche... oder nutze das Mikrofon."></textarea>
        <div class="wave-container" id="onboard-wave">
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div>
          <span class="rec-time" id="onboard-rec-time">0s</span>
          <button type="button" class="rec-stop" id="onboard-rec-stop" title="Aufnahme stoppen"></button>
        </div>
      </div>
      <div class="mic-status" id="onboard-mic-status">Bereit.</div>
    </div>
    <div class="nav">
      <button class="btn btn-ghost" id="backStep2">Zurueck</button>
      <div>
        <button class="btn btn-ghost" id="skipStep2" style="margin-right:8px">Ueberspringen</button>
        <button class="btn btn-primary" id="nextStep2">Fertig</button>
      </div>
    </div>
    <div class="status" id="saveStatus"></div>
  </div>

  <!-- Step 3: Done -->
  <div class="step" id="step2">
    <div class="done-screen">
      <div class="checkmark">&#10003;</div>
      <h2>Spark ist bereit!</h2>
      <p>Dein Agent laeuft jetzt im Hintergrund. Er wird dich sanft zurueckfuehren, wenn du abdriftest, und dir helfen, fokussiert zu bleiben.</p>
      <p style="margin-top:16px">Du kannst das Fenster jetzt schliessen und normal weiterarbeiten.</p>
      <button class="btn btn-primary" id="closeBtn" style="margin-top:20px">Los geht's</button>
    </div>
  </div>
</div>

<script>
const $=id=>document.getElementById(id);
let currentStep=0;
let selectedTemplate=null;

function setStep(n){
  for(let i=0;i<3;i++){
    $('step'+i).classList.toggle('active',i===n);
    $('dot'+i).classList.toggle('active',i===n);
    $('dot'+i).classList.toggle('done',i<n);
  }
  currentStep=n;
}

async function loadTemplates(){
  try{
    const r=await fetch('/onboarding/templates');
    const data=await r.json();
    const el=$('templates');
    el.innerHTML='';
    (data.templates||[]).forEach(t=>{
      const div=document.createElement('div');
      div.className='tpl';
      div.dataset.id=t.id;
      const h=document.createElement('h3');
      h.textContent=t.name||t.id;
      div.appendChild(h);
      const desc=document.createElement('div');
      desc.className='desc';
      desc.textContent=t.description||'';
      div.appendChild(desc);
      const hl=document.createElement('div');
      hl.className='highlights';
      (t.highlights||[]).forEach(txt=>{
        const pill=document.createElement('span');
        pill.className='hl';
        pill.textContent=txt;
        hl.appendChild(pill);
      });
      div.appendChild(hl);
      div.onclick=()=>{
        document.querySelectorAll('.tpl').forEach(e=>e.classList.remove('selected'));
        div.classList.add('selected');
        selectedTemplate=t.id;
        $('nextStep1').disabled=false;
      };
      el.appendChild(div);
    });
  }catch(e){
    $('templates').textContent='Fehler beim Laden der Vorlagen.';
  }
}

$('nextStep1').onclick=()=>{ if(selectedTemplate) setStep(1); };
$('backStep2').onclick=()=>setStep(0);
$('skipStep2').onclick=()=>save();
$('nextStep2').onclick=()=>save();
$('closeBtn').onclick=()=>{ window.close(); window.location.href='/debug/ui'; };

async function save(){
  const status=$('saveStatus');
  status.className='status';
  status.innerHTML='Wird gespeichert <span class="loader-dots"><span></span><span></span><span></span></span>';
  $('nextStep2').disabled=true;
  $('skipStep2').disabled=true;
  try{
    const payload={templateId:selectedTemplate,customNotes:$('wishes').value.trim()};
    const r=await fetch('/onboarding/select',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json();
    if(!r.ok||data.error) throw new Error(data.error||'save_failed');
    setStep(2);
  }catch(e){
    status.className='status error';
    status.textContent='Fehler: '+String(e);
    $('nextStep2').disabled=false;
    $('skipStep2').disabled=false;
  }
}

// Mic / STT — WebM/Opus-Browser-Pipeline (frischer Stream, kein Timeslice, min. Blob, JSON POST /stt)
(function(){
  const micBtn=$('onboard-mic'), wishes=$('wishes'), waveEl=$('onboard-wave'), recTimeEl=$('onboard-rec-time');
  const micStatus=$('onboard-mic-status');
  let recording=false, recStart=0, recTimer=null;
  let recorder=null, currentStream=null;
  function setMicStatus(t, err){
    micStatus.className='mic-status'+(err?' err':'');
    micStatus.textContent=t;
  }
  function showRec(){
    recording=true; micBtn.classList.add('recording');
    wishes.style.display='none'; waveEl.classList.add('active');
    recStart=Date.now(); recTimeEl.textContent='0s';
    recTimer=setInterval(()=>{recTimeEl.textContent=Math.floor((Date.now()-recStart)/1000)+'s';},500);
    setMicStatus('Aufnahme...');
  }
  function hideRec(){
    recording=false; micBtn.classList.remove('recording');
    wishes.style.display=''; waveEl.classList.remove('active');
    if(recTimer){clearInterval(recTimer);recTimer=null;}
  }
  function releaseStream(){
    if(currentStream){currentStream.getTracks().forEach(t=>t.stop());currentStream=null;}
  }
  function toBase64(bytes){
    let bin='';
    for(let i=0;i<bytes.length;i+=0x8000)
      bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
    return btoa(bin);
  }
  async function startRecording(){
    if(!navigator.mediaDevices?.getUserMedia){setMicStatus('Kein Mikrofon (HTTPS?).',true);return;}
    if(!window.MediaRecorder){setMicStatus('MediaRecorder fehlt.',true);return;}
    try{
      releaseStream();
      currentStream=await navigator.mediaDevices.getUserMedia({
        audio:{
          echoCancellation:true,
          noiseSuppression:true,
          autoGainControl:true,
          sampleRate:{ideal:16000},
          channelCount:1
        }
      });
      const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ?'audio/webm;codecs=opus'
        :MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'';
      recorder=new MediaRecorder(currentStream,{
        ...(mime?{mimeType:mime}:{}),
        audioBitsPerSecond:64000
      });
      const chunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size) chunks.push(e.data);};
      recorder.onstop=async()=>{
        hideRec();
        releaseStream();
        if(!chunks.length){setMicStatus('Keine Audiodaten.',true);return;}
        setMicStatus('Transkribiere...');
        try{
          const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
          if(blob.size<500){setMicStatus('Aufnahme zu kurz.',true);return;}
          console.log('[onboard:stt] blob size:',blob.size,'type:',blob.type);
          const buf=new Uint8Array(await blob.arrayBuffer());
          const res=await fetch('/stt',{
            method:'POST', headers:{'content-type':'application/json'},
            body:JSON.stringify({audioBase64:toBase64(buf), mimeType:blob.type})
          });
          const data=await res.json();
          if(data.error){setMicStatus('STT: '+(data.error+'').slice(0,80),true);return;}
          const text=String(data.text||'').trim();
          if(text){
            wishes.value+=(wishes.value? '\\n':'')+text;
            setMicStatus('Bereit.');
            wishes.focus();
          }else{
            setMicStatus('Keine Sprache erkannt.',true);
          }
        }catch(e){
          console.error('[onboard:stt]',e);
          setMicStatus('STT Fehler: '+(e.message||e).toString().slice(0,60),true);
        }
      };
      recorder.onerror=e=>{console.error('[onboard:stt] rec error:',e);hideRec();releaseStream();setMicStatus('Aufnahme-Fehler.',true);};
      recorder.start();
      showRec();
    }catch(e){
      console.error('[onboard:stt]',e);
      releaseStream();
      setMicStatus(e.name==='NotAllowedError'?'Mikrofon verweigert.':'Mikrofon: '+(e.message||e).toString().slice(0,60),true);
    }
  }
  micBtn.addEventListener('click',()=>{ recording?(recorder&&recorder.stop()):startRecording(); });
  $('onboard-rec-stop').addEventListener('click',()=>{ if(recording&&recorder) recorder.stop(); });
})();

loadTemplates();
</script></body></html>`;
}
