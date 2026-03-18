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
  .wishes-wrap{position:relative}
  textarea{width:100%;min-height:120px;resize:vertical;background:#0a1328;border:1px solid #2a3a62;border-radius:12px;padding:14px;padding-right:52px;color:var(--text);font-size:14px;font-family:inherit;line-height:1.5}
  textarea::placeholder{color:#5a6d94}
  .mic-btn{position:absolute;right:12px;bottom:12px;width:36px;height:36px;border-radius:50%;background:#1a2540;border:1px solid #2a3a62;color:#c0d8ff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:background .2s}
  .mic-btn:hover{background:#253050}
  .mic-btn.recording{background:#7f1d1d;border-color:#ef4444;animation:mic-pulse 1s ease-in-out infinite}
  @keyframes mic-pulse{0%,100%{opacity:1}50%{opacity:.6}}

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
      <div class="wishes-wrap">
        <textarea id="wishes" placeholder="Beschreibe deine Wuensche... oder nutze das Mikrofon rechts."></textarea>
        <button class="mic-btn" id="micBtn" title="Spracheingabe">&#127908;</button>
      </div>
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

// Mic / STT
let mediaRecorder=null;
let audioChunks=[];
$('micBtn').onclick=async()=>{
  const btn=$('micBtn');
  if(mediaRecorder&&mediaRecorder.state==='recording'){
    mediaRecorder.stop();
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[];
    mediaRecorder=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});
    mediaRecorder.ondataavailable=e=>{if(e.data.size>0)audioChunks.push(e.data);};
    mediaRecorder.onstop=async()=>{
      btn.classList.remove('recording');
      btn.innerHTML='&#8987;';
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:'audio/webm'});
      const form=new FormData();
      form.append('audio',blob,'recording.webm');
      try{
        const r=await fetch('/stt',{method:'POST',body:form});
        const data=await r.json();
        if(data.text){
          const ta=$('wishes');
          ta.value=(ta.value?ta.value+'\\n':'')+data.text;
        }
      }catch{}
      btn.innerHTML='&#127908;';
    };
    mediaRecorder.start();
    btn.classList.add('recording');
    btn.innerHTML='&#9632;';
  }catch(e){
    btn.innerHTML='&#127908;';
  }
};

loadTemplates();
</script></body></html>`;
}
