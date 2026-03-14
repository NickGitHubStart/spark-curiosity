export function renderCuratedPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Curated Feed</title>
<style>
  :root{
    --bg:#0b0f1e;--panel:#11182d;--border:#24304f;--text:#e8eefc;--muted:#95a3c7;--accent:#4a8af5;--accent2:#34d399;
  }
  body{margin:0;padding:28px;background:radial-gradient(1200px 600px at 10% -10%,#1a2440,transparent),var(--bg);color:var(--text);font-family:Segoe UI,system-ui,sans-serif}
  .wrap{max-width:900px;margin:0 auto}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px 22px;box-shadow:0 18px 40px rgba(0,0,0,0.45)}
  h1{margin:0 0 6px 0;font-size:22px}
  .meta{color:var(--muted);font-size:12px}
  .search{display:flex;gap:10px;margin-top:16px}
  input{flex:1;background:#0a1328;border:1px solid #2a3a62;border-radius:10px;padding:12px;color:var(--text);font-size:14px}
  button{background:var(--accent);border:none;border-radius:10px;padding:12px 16px;color:white;font-weight:700;cursor:pointer}
  button.secondary{background:#1a2540;color:#c0d8ff}
  .items{margin-top:18px;display:grid;grid-template-columns:1fr;gap:12px}
  .item{background:#0d142a;border:1px solid #22304f;border-radius:12px;padding:14px}
  .item h3{margin:0 0 6px 0;font-size:16px;color:#cfe0ff}
  .item .url{font-size:12px;color:#7d8ab0;word-break:break-all}
  .item .actions{margin-top:10px;display:flex;gap:8px}
  .pill{background:#0d2520;color:#86efac;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600}
  .loading{opacity:.7}
</style></head>
<body><div class="wrap">
  <div class="card">
    <div class="pill">Curated Gate aktiv</div>
    <h1>Kuratiertes Fenster</h1>
    <div class="meta" id="meta">Lade...</div>
    <div class="search">
      <input id="q" type="text" placeholder="Suche genau das, was du brauchst..." />
      <button id="searchBtn">Suchen</button>
    </div>
    <div class="items" id="items"></div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const from=params.get('from')||'';
const site=params.get('site')|| (from?new URL(from).hostname:'');
const meta=$('meta'); meta.textContent = site ? ('Quelle: '+site+' - Feed blockiert, nur kuratierte Inhalte.') : 'Feed blockiert, kuratierte Inhalte.';
const itemsEl=$('items');
async function allowAndOpen(url){
  window.open(url,'_blank','noopener');
}
function itemCard(item){
  const div=document.createElement('div'); div.className='item';
  const h=document.createElement('h3'); h.textContent=item.title||item.url; div.appendChild(h);
  const u=document.createElement('div'); u.className='url'; u.textContent=item.url; div.appendChild(u);
  const actions=document.createElement('div'); actions.className='actions';
  const open=document.createElement('button'); open.className='secondary'; open.textContent='Oeffnen';
  open.onclick=async()=>{open.disabled=true;open.textContent='...';await allowAndOpen(item.url);open.disabled=false;open.textContent='Oeffnen';};
  actions.appendChild(open); div.appendChild(actions);
  return div;
}
async function loadRecs(){
  itemsEl.innerHTML=''; itemsEl.classList.add('loading'); itemsEl.textContent='Lade Empfehlungen...';
  try{
    const r=await fetch('/curated/recommendations?site='+encodeURIComponent(site||'')+'&limit=10');
    const data=await r.json();
    const items=(data.items||[]);
    itemsEl.classList.remove('loading'); itemsEl.innerHTML='';
    if(!items.length){ itemsEl.textContent='Keine Empfehlungen gefunden. Nutze die Suche.'; return; }
    items.forEach(i=>itemsEl.appendChild(itemCard(i)));
  }catch(e){
    itemsEl.classList.remove('loading'); itemsEl.textContent='Fehler beim Laden.';
  }
}
async function doSearch(){
  const q=$('q').value.trim(); if(!q) return;
  $('searchBtn').disabled=true;
  $('searchBtn').textContent='...';
  try{
    const r=await fetch('/curated/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,site})});
    const data=await r.json();
    if(data && data.url){ await allowAndOpen(data.url); }
  }catch(e){}
  $('searchBtn').disabled=false;
  $('searchBtn').textContent='Suchen';
}
$('searchBtn').onclick=()=>{void doSearch();};
$('q').addEventListener('keydown',e=>{ if(e.key==='Enter'){ void doSearch(); }});
loadRecs();
</script></body></html>`;
}
