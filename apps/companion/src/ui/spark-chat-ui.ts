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
    .composer{padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px}
    textarea{
      flex:1;min-height:42px;max-height:140px;resize:vertical;
      background:#0b1220;border:1px solid var(--border);border-radius:10px;
      color:var(--text);padding:8px 10px;font-size:13px;
    }
    .btn{
      border:1px solid var(--border);background:#0b1220;color:var(--text);
      border-radius:10px;padding:0 10px;cursor:pointer;font-weight:600;
    }
    .btn.send{background:var(--accent);color:#062016;border-color:transparent}
    .btn.mic{width:40px}
    .btn.mic.recording{border-color:var(--danger);color:var(--danger)}
    .status{padding:6px 16px 10px 16px;color:var(--muted);font-size:12px}
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
        <button class="close" id="spark-close" title="Schliessen">×</button>
      </div>
      <div class="msgs" id="spark-msgs"></div>
      <div class="composer">
        <button class="btn mic" id="spark-mic" title="Spracheingabe">Mic</button>
        <textarea id="spark-input" placeholder="Schreib Sparky..." spellcheck="true"></textarea>
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

    let mediaRecorder = null;
    let mediaStream = null;
    let recording = false;
    let chunks = [];

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
      const length = Math.ceil(buffer.duration * targetRate);
      const offline = new OfflineAudioContext(1, length, targetRate);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start(0);
      return await offline.startRendering();
    }

    async function audioBlobToPcmBase64(blob, targetRate){
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
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

    async function startRecording(){
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setStatus('Mikrofon nicht verfuegbar.');
        return;
      }
      try{
        if (!mediaStream) {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        chunks = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
        mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          recording = false;
          micBtn.classList.remove('recording');
          micBtn.textContent = 'Mic';
          if (!chunks.length) { setStatus('Keine Audiodaten.'); return; }
          setStatus('Transkribiere...');
          try{
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const audioBase64 = await audioBlobToPcmBase64(blob, 16000);
            const res = await fetch('/stt', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ audioBase64, sampleRate: 16000 })
            });
            const data = await res.json();
            const text = (data && data.text) ? String(data.text) : '';
            if (text) input.value = (input.value ? input.value + ' ' : '') + text;
            setStatus(text ? 'Bereit.' : 'Keine Transkription.');
          }catch(e){
            setStatus('STT fehlgeschlagen.');
          }
        };
        mediaRecorder.start();
        recording = true;
        micBtn.classList.add('recording');
        micBtn.textContent = 'Stop';
        setStatus('Hoere zu...');
      }catch(e){
        setStatus('Mikrofon-Zugriff verweigert.');
      }
    }

    function stopRecording(){
      if (mediaRecorder && recording) mediaRecorder.stop();
    }

    micBtn.addEventListener('click', () => {
      if (recording) { stopRecording(); return; }
      startRecording();
    });
  </script>
</body>
</html>`;
}
