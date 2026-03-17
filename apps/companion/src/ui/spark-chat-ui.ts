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
      font-family: "Space Grotesk", "Sora", "Manrope", system-ui, sans-serif;
    }
    *{box-sizing:border-box}
    body{margin:0;background:transparent;color:var(--text)}
    .spark-root{
      position:fixed;right:18px;bottom:18px;z-index:99999;
    }
    .fab{
      width:64px;height:64px;border-radius:999px;border:1px solid var(--border);
      background:radial-gradient(120% 120% at 30% 20%, #1f2937 0%, #0b1020 60%);
      color:var(--text);font-weight:700;letter-spacing:.2px;
      display:flex;align-items:center;justify-content:center;cursor:pointer;
      box-shadow:0 10px 30px rgba(0,0,0,.35);
      padding:0;
    }
    .fab img{
      width:100%;height:100%;border-radius:999px;object-fit:cover;
      border:1px solid rgba(255,255,255,.08);
      transform:scale(1.12);
    }
    .panel{
      position:absolute;right:0;bottom:70px;width:360px;max-width:90vw;
      background:linear-gradient(160deg, var(--panel) 0%, var(--panel-2) 100%);
      border:1px solid var(--border);border-radius:16px;overflow:hidden;
      box-shadow:0 20px 50px rgba(0,0,0,.45);
      display:none;
    }
    .panel.open{display:block}
    .head{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px}
    .brand{display:flex;align-items:center;gap:10px}
    .brand img{width:28px;height:28px;border-radius:999px;object-fit:cover;transform:scale(1.08)}
    .title{font-size:14px;font-weight:700}
    .close{background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px}
    .msgs{padding:12px 16px;max-height:280px;overflow:auto}
    .msg{margin:0 0 10px 0;font-size:13px;line-height:1.5}
    .msg.user{color:var(--accent-2)}
    .msg.ai{color:var(--accent)}
    .msg.sys{color:var(--muted);font-size:12px}
    .composer{padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:flex-end}
    textarea{
      flex:1;min-height:42px;max-height:140px;resize:vertical;
      background:#0b1220;border:1px solid var(--border);border-radius:10px;
      color:var(--text);padding:8px 10px;font-size:13px;
    }
    .btn{
      border:1px solid var(--border);background:#0b1220;color:var(--text);
      border-radius:10px;padding:0 10px;cursor:pointer;font-weight:600;
      min-height:42px;
    }
    .btn.send{background:var(--accent);color:#062016;border-color:transparent}
    .btn.mic{width:42px;display:flex;align-items:center;justify-content:center;position:relative}
    .btn.mic.recording{border-color:var(--danger);color:var(--danger)}
    .status{padding:6px 16px 10px 16px;color:var(--muted);font-size:12px}

    /* Wave animation for recording */
    .wave-container{
      display:none;flex:1;height:42px;align-items:center;justify-content:center;gap:3px;
      background:#0b1220;border:1px solid var(--danger);border-radius:10px;padding:0 12px;
    }
    .wave-container.active{display:flex}
    .wave-bar{
      width:3px;border-radius:2px;background:var(--danger);
      animation:wave 1.2s ease-in-out infinite;
    }
    .wave-bar:nth-child(1){height:8px;animation-delay:0s}
    .wave-bar:nth-child(2){height:16px;animation-delay:0.1s}
    .wave-bar:nth-child(3){height:24px;animation-delay:0.2s}
    .wave-bar:nth-child(4){height:16px;animation-delay:0.3s}
    .wave-bar:nth-child(5){height:20px;animation-delay:0.15s}
    .wave-bar:nth-child(6){height:12px;animation-delay:0.25s}
    .wave-bar:nth-child(7){height:8px;animation-delay:0.35s}
    @keyframes wave{
      0%,100%{transform:scaleY(0.4);opacity:0.5}
      50%{transform:scaleY(1);opacity:1}
    }
    .rec-time{color:var(--danger);font-size:12px;font-weight:600;margin-left:8px;min-width:32px}
  </style>
</head>
<body>
  <div class="spark-root">
    <button class="fab" id="spark-fab" title="Spark Chat" aria-label="Spark Chat">
      <img src="/spark/icon" alt="Spark Icon" />
    </button>
    <div class="panel" id="spark-panel">
      <div class="head">
        <div class="brand">
          <img src="/spark/icon" alt="Spark Icon" />
          <div class="title">Spark Curiosity</div>
        </div>
        <button class="close" id="spark-close" title="Schliessen">&times;</button>
      </div>
      <div class="msgs" id="spark-msgs"></div>
      <div class="composer">
        <button class="btn mic" id="spark-mic" title="Spracheingabe">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <textarea id="spark-input" placeholder="Schreib Sparky..." spellcheck="true"></textarea>
        <div class="wave-container" id="spark-wave">
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div>
          <span class="rec-time" id="spark-rec-time">0s</span>
        </div>
        <button class="btn send" id="spark-send">Send</button>
      </div>
      <div class="status" id="spark-status">Bereit.</div>
    </div>
  </div>
  <script>
    const panel = document.getElementById('spark-panel');
    const fab = document.getElementById('spark-fab');
    const closeBtn = document.getElementById('spark-close');
    const input = document.getElementById('spark-input');
    const sendBtn = document.getElementById('spark-send');
    const micBtn = document.getElementById('spark-mic');
    const msgs = document.getElementById('spark-msgs');
    const statusEl = document.getElementById('spark-status');
    const waveEl = document.getElementById('spark-wave');
    const recTimeEl = document.getElementById('spark-rec-time');

    function addMsg(kind, text){
      const p = document.createElement('p');
      p.className = 'msg ' + kind;
      p.textContent = text;
      msgs.appendChild(p);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function setStatus(text){ statusEl.textContent = text; }

    function toggle(open){
      const isOpen = open ?? !panel.classList.contains('open');
      panel.classList.toggle('open', isOpen);
      if (isOpen) input.focus();
    }

    fab.addEventListener('click', () => toggle(true));
    closeBtn.addEventListener('click', () => toggle(false));

    async function sendMessage(){
      const message = (input.value || '').trim();
      if (!message) return;
      input.value = '';
      addMsg('user', message);
      setStatus('Sende...');
      try{
        const res = await fetch('/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (data.reply) addMsg('ai', data.reply);
        if (data.openUrl) window.open(data.openUrl, '_blank', 'noopener');
        if (data.memoryUpdated) addMsg('sys', 'Memory aktualisiert.');
        setStatus('Bereit.');
      }catch(e){
        setStatus('Fehler beim Senden.');
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    let mediaStream = null;
    let recording = false;
    let recStartTime = 0;
    let recTimer = null;
    let audioChunks = [];
    let mediaRecorder = null;

    function base64FromBytes(bytes){
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      return btoa(binary);
    }

    async function resampleAudioBuffer(buffer, targetRate){
      if (buffer.sampleRate === targetRate) return buffer;
      const length = Math.round(buffer.duration * targetRate);
      if (length <= 0) return buffer;
      const offline = new OfflineAudioContext(1, length, targetRate);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start(0);
      return await offline.startRendering();
    }

    async function audioBlobToPcmBase64(blob, targetRate){
      const arrayBuffer = await blob.arrayBuffer();
      if (arrayBuffer.byteLength < 100) throw new Error('audio_too_short');
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 48000 });
      let decoded;
      try {
        decoded = await ctx.decodeAudioData(arrayBuffer);
      } catch (e) {
        if (ctx.close) await ctx.close();
        throw new Error('decode_failed: ' + (e.message || e));
      }
      if (decoded.duration < 0.3) {
        if (ctx.close) await ctx.close();
        throw new Error('audio_too_short');
      }
      const buffer = await resampleAudioBuffer(decoded, targetRate);
      const channel = buffer.getChannelData(0);
      const pcm = new ArrayBuffer(channel.length * 2);
      const view = new DataView(pcm);
      for (let i = 0; i < channel.length; i++) {
        let s = Math.max(-1, Math.min(1, channel[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      if (ctx.close) await ctx.close();
      return base64FromBytes(new Uint8Array(pcm));
    }

    function showRecordingUI(){
      recording = true;
      micBtn.classList.add('recording');
      input.style.display = 'none';
      waveEl.classList.add('active');
      recStartTime = Date.now();
      recTimeEl.textContent = '0s';
      recTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - recStartTime) / 1000);
        recTimeEl.textContent = sec + 's';
      }, 500);
      setStatus('Aufnahme laeuft...');
    }

    function hideRecordingUI(){
      recording = false;
      micBtn.classList.remove('recording');
      input.style.display = '';
      waveEl.classList.remove('active');
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
    }

    async function startRecording(){
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Mikrofon nicht verfuegbar (kein HTTPS?).');
        return;
      }
      if (!window.MediaRecorder) {
        setStatus('MediaRecorder nicht unterstuetzt.');
        return;
      }
      try{
        if (!mediaStream) {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
          });
        }
        audioChunks = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
        mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) audioChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          hideRecordingUI();
          if (!audioChunks.length) { setStatus('Keine Audiodaten aufgenommen.'); return; }
          setStatus('Transkribiere...');
          try{
            const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            console.log('[spark:stt] blob size:', blob.size, 'type:', blob.type);
            const audioBase64 = await audioBlobToPcmBase64(blob, 16000);
            console.log('[spark:stt] pcm base64 length:', audioBase64.length);
            const res = await fetch('/stt', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ audioBase64, sampleRate: 16000 })
            });
            const data = await res.json();
            if (data.error) {
              console.error('[spark:stt] server error:', data.error);
              setStatus('STT Fehler: ' + data.error.slice(0, 80));
              return;
            }
            const text = (data && data.text) ? String(data.text).trim() : '';
            if (text) {
              input.value = (input.value ? input.value + ' ' : '') + text;
              setStatus('Bereit.');
              input.focus();
            } else {
              setStatus('Keine Sprache erkannt. Nochmal versuchen.');
            }
          }catch(e){
            console.error('[spark:stt] client error:', e);
            const msg = e.message || String(e);
            if (msg.includes('decode_failed')) {
              setStatus('Audio-Format nicht lesbar. Browser wechseln?');
            } else if (msg.includes('audio_too_short')) {
              setStatus('Aufnahme zu kurz. Laenger sprechen.');
            } else {
              setStatus('STT fehlgeschlagen: ' + msg.slice(0, 60));
            }
          }
        };
        mediaRecorder.onerror = (e) => {
          console.error('[spark:stt] recorder error:', e);
          hideRecordingUI();
          setStatus('Aufnahme-Fehler.');
        };
        mediaRecorder.start(250); // collect chunks every 250ms
        showRecordingUI();
      }catch(e){
        console.error('[spark:stt] getUserMedia error:', e);
        if (e.name === 'NotAllowedError') {
          setStatus('Mikrofon-Zugriff verweigert. Bitte erlauben.');
        } else {
          setStatus('Mikrofon-Fehler: ' + (e.message || e).toString().slice(0, 60));
        }
      }
    }

    function stopRecording(){
      if (mediaRecorder && recording) {
        try { mediaRecorder.stop(); } catch(e) {
          console.error('[spark:stt] stop error:', e);
          hideRecordingUI();
          setStatus('Stopp-Fehler.');
        }
      }
    }

    micBtn.addEventListener('click', () => {
      if (recording) { stopRecording(); return; }
      startRecording();
    });
  </script>
</body>
</html>`;
}
