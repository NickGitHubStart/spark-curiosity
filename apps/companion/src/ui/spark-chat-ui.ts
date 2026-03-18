export function renderSparkChatUi(): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spark Chat</title>
  <style>
    :root{
      --bg:#0b0f1a;
      --panel:#111827;
      --panel-2:#0f172a;
      --border:#1f2937;
      --text:#e5e7eb;
      --muted:#9ca3af;
      --accent:#34d399;
      --accent-2:#60a5fa;
      --danger:#f87171;
      font-family:"Space Grotesk","Sora","Manrope",system-ui,sans-serif;
    }
    *{box-sizing:border-box}
    body{margin:0;background:transparent;color:var(--text)}

    .spark-root{position:fixed;right:18px;bottom:18px;z-index:99999}

    .fab{
      width:64px;height:64px;border-radius:999px;border:1px solid var(--border);
      background:radial-gradient(120% 120% at 30% 20%,#1f2937 0%,#0b1020 60%);
      color:var(--text);font-weight:700;
      display:flex;align-items:center;justify-content:center;cursor:pointer;
      box-shadow:0 10px 30px rgba(0,0,0,.35);padding:0;
    }
    .fab img{width:100%;height:100%;border-radius:999px;object-fit:cover;
      border:1px solid rgba(255,255,255,.08);transform:scale(1.12)}

    /* Panel — dimensions set by JS using screen.availWidth/Height */
    .panel{
      position:absolute;right:0;bottom:70px;
      background:linear-gradient(160deg,var(--panel) 0%,var(--panel-2) 100%);
      border:1px solid var(--border);border-radius:16px;
      box-shadow:0 20px 50px rgba(0,0,0,.45);
      display:none;flex-direction:column;
    }
    .panel.open{display:flex}

    .head{
      flex-shrink:0;padding:12px 14px;border-bottom:1px solid var(--border);
      display:flex;align-items:center;justify-content:space-between;gap:10px;
      border-radius:16px 16px 0 0;
    }
    .brand{display:flex;align-items:center;gap:10px}
    .brand img{width:28px;height:28px;border-radius:999px;object-fit:cover;transform:scale(1.08)}
    .title{font-size:14px;font-weight:700}
    .close{background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px}

    .msgs{flex:1 1 0;min-height:60px;overflow-y:auto;padding:12px 16px}
    .msg{margin:0 0 10px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
    .msg.user{color:var(--accent-2)}
    .msg.ai{color:var(--accent)}
    .msg.sys{color:var(--muted);font-size:12px}

    .msg.typing{display:flex;align-items:center;gap:4px;padding:4px 0}
    .dot{display:inline-block;width:6px;height:6px;background:var(--accent);
      border-radius:50%;animation:dot-blink 1.2s ease-in-out infinite}
    .dot:nth-child(2){animation-delay:.2s}
    .dot:nth-child(3){animation-delay:.4s}
    @keyframes dot-blink{
      0%,60%,100%{opacity:.2;transform:scale(.8)}
      30%{opacity:1;transform:scale(1.15)}
    }

    .composer{
      flex-shrink:0;padding:12px 16px;border-top:1px solid var(--border);
      display:flex;gap:8px;align-items:flex-end;
    }
    textarea{
      flex:1;min-height:42px;max-height:40vh;resize:none;overflow-y:auto;
      background:#0b1220;border:1px solid var(--border);border-radius:10px;
      color:var(--text);padding:10px;font-size:13px;font-family:inherit;line-height:1.5;
    }
    .btn{
      border:1px solid var(--border);background:#0b1220;color:var(--text);
      border-radius:10px;padding:0 10px;cursor:pointer;font-weight:600;
      min-height:42px;flex-shrink:0;
    }
    .btn.send{background:var(--accent);color:#062016;border-color:transparent}
    .btn.mic{width:42px;display:flex;align-items:center;justify-content:center}
    .btn.mic.recording{border-color:var(--danger);color:var(--danger)}

    .wave-container{
      display:none;flex:1;height:42px;align-items:center;justify-content:center;gap:3px;
      background:#0b1220;border:1px solid var(--danger);border-radius:10px;padding:0 12px;
    }
    .wave-container.active{display:flex}
    .wave-bar{width:3px;border-radius:2px;background:var(--danger);animation:wave 1.2s ease-in-out infinite}
    .wave-bar:nth-child(1){height:8px;animation-delay:0s}
    .wave-bar:nth-child(2){height:16px;animation-delay:.1s}
    .wave-bar:nth-child(3){height:24px;animation-delay:.2s}
    .wave-bar:nth-child(4){height:16px;animation-delay:.3s}
    .wave-bar:nth-child(5){height:20px;animation-delay:.15s}
    .wave-bar:nth-child(6){height:12px;animation-delay:.25s}
    .wave-bar:nth-child(7){height:8px;animation-delay:.35s}
    @keyframes wave{0%,100%{transform:scaleY(.4);opacity:.5}50%{transform:scaleY(1);opacity:1}}
    .rec-time{color:var(--danger);font-size:12px;font-weight:600;margin-left:8px;min-width:32px}

    .status{
      flex-shrink:0;padding:6px 16px 10px;color:var(--muted);font-size:11px;
      border-radius:0 0 16px 16px;
    }
  </style>
</head>
<body>
  <div class="spark-root">
    <button class="fab" id="spark-fab" title="Spark Chat"><img src="/spark/icon" alt="Spark" /></button>
    <div class="panel" id="spark-panel">
      <div class="head">
        <div class="brand"><img src="/spark/icon" alt="" /><div class="title">Spark Curiosity</div></div>
        <button class="close" id="spark-close">&times;</button>
      </div>
      <div class="msgs" id="spark-msgs"></div>
      <div class="composer">
        <button class="btn mic" id="spark-mic" title="Spracheingabe">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <textarea id="spark-input" placeholder="Nachricht... (Ctrl+Enter sendet)" rows="1"></textarea>
        <div class="wave-container" id="spark-wave">
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div>
          <span class="rec-time" id="spark-rec-time">0s</span>
        </div>
        <button class="btn send" id="spark-send" title="Ctrl+Enter">&#10148;</button>
      </div>
      <div class="status" id="spark-status">Bereit.</div>
    </div>
  </div>
<script>
(function(){
  const $ = id => document.getElementById(id);
  const panel=$('spark-panel'), fab=$('spark-fab'), input=$('spark-input');
  const msgs=$('spark-msgs'), statusEl=$('spark-status');
  const waveEl=$('spark-wave'), recTimeEl=$('spark-rec-time');
  const micBtn=$('spark-mic'), sendBtn=$('spark-send');

  // ── Panel sizing from physical screen, not browser viewport ──
  function sizePanel(){
    const w = Math.max(360, Math.min(680, Math.round(screen.availWidth / 3)));
    const h = Math.round(screen.availHeight * 0.85);
    panel.style.width = w+'px';
    panel.style.maxHeight = h+'px';
  }
  sizePanel();
  window.addEventListener('resize', sizePanel);

  // ── Helpers ──
  function addMsg(kind, text){
    const p = document.createElement('p');
    p.className = 'msg '+kind;
    p.textContent = text;
    msgs.appendChild(p);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function setStatus(t){ statusEl.textContent = t; }
  function toggle(open){
    panel.classList.toggle('open', open ?? !panel.classList.contains('open'));
    if(panel.classList.contains('open')) input.focus();
  }

  // Auto-expand textarea (capped by CSS max-height:40vh)
  function resizeInput(){
    input.style.height = 'auto';
    input.style.height = input.scrollHeight+'px';
  }
  input.addEventListener('input', resizeInput);

  // Typing dots
  let typingEl = null;
  function showTyping(){
    typingEl = document.createElement('p');
    typingEl.className = 'msg ai typing';
    typingEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    msgs.appendChild(typingEl);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function hideTyping(){ if(typingEl){typingEl.remove(); typingEl=null;} }

  // ── Chat ──
  fab.addEventListener('click', ()=>toggle(true));
  $('spark-close').addEventListener('click', ()=>toggle(false));

  async function sendMessage(){
    const message = (input.value||'').trim();
    if(!message) return;
    input.value = '';
    resizeInput();
    addMsg('user', message);
    setStatus('Sende...');
    sendBtn.disabled = true;
    showTyping();
    try{
      const res = await fetch('/chat',{
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({message})
      });
      const data = await res.json();
      hideTyping();
      if(data.reply) addMsg('ai', data.reply);
      if(data.openUrl) window.open(data.openUrl,'_blank','noopener');
      if(data.memorySummary?.length){
        addMsg('sys', 'Memory: '+data.memorySummary.join(' \\u00b7 '));
      } else if(data.memoryUpdated){
        addMsg('sys', 'Memory aktualisiert.');
      }
      setStatus('Bereit.');
    }catch{
      hideTyping();
      setStatus('Fehler beim Senden.');
    }finally{
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  // Ctrl+Enter sends — plain Enter creates newlines (safe for paste)
  input.addEventListener('keydown', e=>{
    if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); sendMessage(); }
  });

  // ── Speech-to-text ──
  // Records WebM/Opus, sends raw blob to server — no client-side PCM conversion.
  // Whisper API accepts WebM directly, eliminating the most common failure point.

  let mediaStream=null, recording=false, recStart=0, recTimer=null;
  let chunks=[], recorder=null;

  function showRec(){
    recording=true; micBtn.classList.add('recording');
    input.style.display='none'; waveEl.classList.add('active');
    recStart=Date.now(); recTimeEl.textContent='0s';
    recTimer=setInterval(()=>{recTimeEl.textContent=Math.floor((Date.now()-recStart)/1000)+'s';},500);
    setStatus('Aufnahme...');
  }
  function hideRec(){
    recording=false; micBtn.classList.remove('recording');
    input.style.display=''; waveEl.classList.remove('active');
    if(recTimer){clearInterval(recTimer);recTimer=null;}
  }

  function toBase64(bytes){
    let bin='';
    for(let i=0;i<bytes.length;i+=0x8000)
      bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
    return btoa(bin);
  }

  async function startRecording(){
    if(!navigator.mediaDevices?.getUserMedia){setStatus('Kein Mikrofon (HTTPS?).'); return;}
    if(!window.MediaRecorder){setStatus('MediaRecorder fehlt.'); return;}
    try{
      if(!mediaStream){
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio:{echoCancellation:true, noiseSuppression:true}
        });
      }
      chunks=[];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      recorder = new MediaRecorder(mediaStream, mime?{mimeType:mime}:undefined);
      recorder.ondataavailable = e=>{ if(e.data?.size) chunks.push(e.data); };
      recorder.onstop = async()=>{
        hideRec();
        if(!chunks.length){setStatus('Keine Audiodaten.');return;}
        setStatus('Transkribiere...');
        try{
          const blob = new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
          if(blob.size<200){setStatus('Aufnahme zu kurz.');return;}
          const buf = new Uint8Array(await blob.arrayBuffer());
          const res = await fetch('/stt',{
            method:'POST', headers:{'content-type':'application/json'},
            body:JSON.stringify({audioBase64:toBase64(buf), mimeType:blob.type})
          });
          const data = await res.json();
          if(data.error){setStatus('STT: '+data.error.slice(0,80));return;}
          const text = String(data.text||'').trim();
          if(text){
            input.value += (input.value?' ':'')+text;
            resizeInput();
            setStatus('Bereit.');
            input.focus();
          } else {
            setStatus('Keine Sprache erkannt.');
          }
        }catch(e){
          console.error('[spark:stt]',e);
          setStatus('STT Fehler: '+(e.message||e).toString().slice(0,60));
        }
      };
      recorder.onerror = e=>{console.error('[spark:stt] rec error:',e);hideRec();setStatus('Aufnahme-Fehler.');};
      recorder.start(250);
      showRec();
    }catch(e){
      console.error('[spark:stt]',e);
      setStatus(e.name==='NotAllowedError'?'Mikrofon verweigert.':'Mikrofon: '+(e.message||e).toString().slice(0,60));
    }
  }

  micBtn.addEventListener('click',()=>{ recording ? (recorder&&recorder.stop()) : startRecording(); });
})();
</script>
</body>
</html>`;
}
