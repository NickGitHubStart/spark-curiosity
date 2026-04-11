export function renderBrainUi(): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Brain</title>
  <style>
    :root{
      --bg:#0b0f1a;--panel:#111827;--panel2:#0f172a;--text:#e5e7eb;--muted:#9ca3af;--border:#1f2937;--accent:#34d399;--accent2:#60a5fa;--danger:#f87171;
    }
    *{box-sizing:border-box} body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:radial-gradient(circle at top,#172033 0%,#0b0f1a 55%);color:var(--text)}
    .wrap{max-width:1300px;margin:0 auto;padding:24px}
    .head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px}
    .title{font-size:28px;font-weight:700}
    .sub{color:var(--muted);font-size:14px}
    .grid{display:grid;grid-template-columns:1.25fr 1fr;gap:18px}
    .card{background:linear-gradient(180deg,var(--panel) 0%,var(--panel2) 100%);border:1px solid var(--border);border-radius:18px;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.25)}
    textarea,input,select{width:100%;background:#0b1220;color:var(--text);border:1px solid var(--border);border-radius:12px;padding:12px;font:inherit}
    textarea{min-height:170px;resize:vertical}
    .row{display:grid;grid-template-columns:1fr 180px;gap:10px}
    .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
    .btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
    button{background:var(--accent);color:#052116;border:0;border-radius:12px;padding:11px 14px;font-weight:700;cursor:pointer}
    button.secondary{background:#152033;color:var(--text);border:1px solid var(--border)}
    button.danger{background:var(--danger);color:#fff}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
    .label{font-size:12px;color:var(--muted);margin:0 0 6px}
    .preview{white-space:pre-wrap;line-height:1.5;background:#0c1528;border:1px solid var(--border);border-radius:14px;padding:14px;min-height:180px;color:#b4cdff}
    .section-h{font-size:12px;font-weight:600;color:var(--muted);margin:14px 0 6px}
    .model-tag{font-size:11px;color:var(--accent2);margin-bottom:8px}
    .list{display:grid;gap:8px;max-height:600px;overflow:auto}
    .entry{padding:12px;border:1px solid var(--border);border-radius:12px;background:#0b1220}
    .entry .idx{color:var(--accent2);font-size:12px}
    .entry .ttl{font-weight:600;margin-top:4px}
    .status{margin-top:10px;color:var(--muted);font-size:13px}
    @media (max-width: 980px){.grid{grid-template-columns:1fr}.row,.row3,.meta{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <div class="title">Brain</div>
        <div class="sub">Getrennt von user-memory. Append-only. Preview vor Save.</div>
      </div>
      <div class="btns">
        <button class="secondary" id="btnInit">Brain initialisieren</button>
        <button class="secondary" id="btnRefresh">Aktualisieren</button>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <div class="label">Quelle / Input</div>
        <textarea id="sourceText" placeholder="Gedanke oder markierten Inhalt hier einfuegen..."></textarea>
        <div class="row" style="margin-top:10px">
          <div>
            <div class="label">Titel optional</div>
            <input id="titleInput" placeholder="leer lassen = AI waehlt Titel" />
          </div>
          <div>
            <div class="label">Capture-Modus</div>
            <select id="captureMode">
              <option value="thought">Thought</option>
              <option value="compress">Compress</option>
            </select>
          </div>
        </div>
        <div class="row3" style="margin-top:10px">
          <div>
            <div class="label">Type optional</div>
            <select id="typeInput">
              <option value="">AI entscheidet</option>
              <option value="thought">thought</option>
              <option value="knowledge">knowledge</option>
              <option value="mental_model">mental_model</option>
              <option value="principle">principle</option>
              <option value="maxim">maxim</option>
              <option value="log">log</option>
              <option value="limiting_step">limiting_step</option>
            </select>
          </div>
          <div>
            <div class="label">Themenpfad</div>
            <input id="themenpfadInput" placeholder="AI" />
          </div>
          <div>
            <div class="label">Parent Index</div>
            <input id="parentIndexInput" placeholder="AI" />
          </div>
        </div>
        <div class="btns">
          <button id="btnPreview">Preview erzeugen</button>
          <button class="secondary" id="btnClassify">Nur klassifizieren</button>
          <button class="secondary" id="btnSaveRaw">Roh speichern</button>
          <button id="btnSavePreview">Preview in Brain speichern</button>
        </div>
        <div class="meta">
          <div>
            <div class="label">Vorgeschlagener Titel</div>
            <input id="previewTitle" />
          </div>
          <div>
            <div class="label">Vorgeschlagener Type</div>
            <input id="previewType" />
          </div>
          <div>
            <div class="label">Vorgeschlagener Themenpfad</div>
            <input id="previewThemenpfad" />
          </div>
          <div>
            <div class="label">Vorgeschlagener Parent</div>
            <input id="previewParent" />
          </div>
        </div>
        <div class="section-h" style="margin-top:12px">Komprimiert (KI)</div>
        <div id="compressModel" class="model-tag"></div>
        <div id="previewBox" class="preview"></div>
        <div class="section-h">Deine Gedanken (optional)</div>
        <textarea id="userNotes" placeholder="Eigene Kommentare zum komprimierten Text..."></textarea>
        <div id="statusLine" class="status" style="margin-top:12px">Bereit.</div>
      </div>
      <div class="card">
        <div class="label">Letzte Brain-Eintraege</div>
        <div id="entries" class="list"></div>
      </div>
    </div>
  </div>
  <script>
    const el = id => document.getElementById(id);
    let latestPreview = "";
    let latestClassification = null;
    let lastCompressModel = "";

    async function j(url, opts){
      const r = await fetch(url, opts);
      const t = await r.text();
      try { return JSON.parse(t); } catch { throw new Error(t || ('HTTP '+r.status)); }
    }

    function setStatus(text){ el('statusLine').textContent = text; }

    function renderEntries(items){
      el('entries').innerHTML = (items || []).map(item => \`
        <div class="entry">
          <div class="idx">\${item.index}</div>
          <div class="ttl">\${item.title}</div>
          <div class="sub">\${item.file}</div>
        </div>\`).join('') || '<div class="sub">Noch keine Eintraege.</div>';
    }

    function applyClassification(c){
      latestClassification = c;
      el('previewTitle').value = c?.title || '';
      el('previewType').value = c?.type || '';
      el('previewThemenpfad').value = c?.themenpfad || '';
      el('previewParent').value = c?.parentIndex || '';
      if (!el('titleInput').value && c?.title) el('titleInput').value = c.title;
      if (!el('themenpfadInput').value && c?.themenpfad) el('themenpfadInput').value = c.themenpfad;
      if (!el('parentIndexInput').value && c?.parentIndex) el('parentIndexInput').value = c.parentIndex;
    }

    async function refresh(){
      const [status, entries] = await Promise.all([j('/brain/status'), j('/brain/entries?limit=50')]);
      setStatus(\`Brain: \${status.path} | Eintraege: \${status.entries}\`);
      renderEntries(entries.entries || []);
    }

    async function classify(content){
      const data = await j('/brain/classify', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          content,
          preferredType: el('typeInput').value || undefined
        })
      });
      applyClassification(data);
      return data;
    }

    async function preview(){
      const source = el('sourceText').value.trim();
      if(!source) return setStatus('Quelle fehlt.');
      const mode = el('captureMode').value;
      if(mode === 'compress'){
        const data = await j('/brain/compress-preview', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({ content: source })
        });
        latestPreview = data.content || '';
        lastCompressModel = data.model || '';
        el('previewBox').textContent = latestPreview || '';
        el('compressModel').textContent = lastCompressModel ? ('Modell: ' + lastCompressModel) : '';
        await classify(latestPreview || source);
        setStatus('Compression Preview erzeugt.');
        return;
      }
      el('compressModel').textContent = '';
      latestPreview = source;
      el('previewBox').textContent = source;
      await classify(source);
      setStatus('Thought Preview bereit.');
    }

    async function save(content){
      const compress = el('captureMode').value === 'compress';
      const payload = {
        content,
        title: el('previewTitle').value || el('titleInput').value || undefined,
        type: el('previewType').value || el('typeInput').value || undefined,
        themenpfad: el('previewThemenpfad').value || el('themenpfadInput').value || undefined,
        parentIndex: el('previewParent').value || el('parentIndexInput').value || undefined,
        relatedIndices: latestClassification?.relatedIndices || [],
        source: compress ? 'brain-compress' : 'brain-thought',
        originalSource: compress ? el('sourceText').value.trim() : undefined,
        userNotes: compress ? (el('userNotes').value || '').trim() || undefined : undefined,
        aiModel: compress ? (lastCompressModel || undefined) : undefined
      };
      const data = await j('/brain/save', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)
      });
      setStatus(\`Gespeichert: \${data.index} \${data.file}\`);
      await refresh();
    }

    el('btnInit').onclick = async()=>{
      await j('/brain/init',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ importCurrentMemory:false })});
      await refresh();
    };
    el('btnRefresh').onclick = refresh;
    el('btnClassify').onclick = async()=>{
      const source = el('sourceText').value.trim();
      if(!source) return setStatus('Quelle fehlt.');
      const basis = latestPreview || source;
      await classify(basis);
      setStatus('Klassifikation aktualisiert.');
    };
    el('btnPreview').onclick = preview;
    el('btnSaveRaw').onclick = async()=>{
      const source = el('sourceText').value.trim();
      if(!source) return setStatus('Quelle fehlt.');
      if(!latestClassification) await classify(source);
      await save(source);
    };
    el('btnSavePreview').onclick = async()=>{
      const source = (latestPreview || '').trim();
      if(!source) return setStatus('Erst Preview erzeugen.');
      await save(source);
    };
    refresh().catch(err=>setStatus(String(err)));
  </script>
</body>
</html>`;
}
