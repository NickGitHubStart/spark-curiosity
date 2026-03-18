export function renderCuratedPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Curated Feed</title>
<style>
  :root{
    --bg:#0b0f1e;--panel:#11182d;--border:#24304f;--text:#e8eefc;--muted:#95a3c7;--accent:#4a8af5;--accent2:#34d399;--danger:#ef4444;
  }
  body{margin:0;padding:28px;background:radial-gradient(1200px 600px at 10% -10%,#1a2440,transparent),var(--bg);color:var(--text);font-family:Segoe UI,system-ui,sans-serif}
  body.player-open{overflow:hidden}
  .wrap{max-width:980px;margin:0 auto}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px 22px;box-shadow:0 18px 40px rgba(0,0,0,0.45)}
  h1{margin:0 0 6px 0;font-size:22px}
  .meta{color:var(--muted);font-size:12px}
  .search{display:flex;gap:10px;margin-top:16px}
  input{flex:1;background:#0a1328;border:1px solid #2a3a62;border-radius:10px;padding:12px;color:var(--text);font-size:14px}
  button{background:var(--accent);border:none;border-radius:10px;padding:12px 16px;color:white;font-weight:700;cursor:pointer}
  button.secondary{background:#1a2540;color:#c0d8ff}
  button.ghost{background:transparent;border:1px solid #2a3a62;color:#c0d8ff}
  button:disabled{opacity:.55;cursor:not-allowed}
  .items{margin-top:18px;display:grid;grid-template-columns:1fr;gap:12px}
  .item{background:#0d142a;border:1px solid #22304f;border-radius:12px;padding:14px;display:grid;grid-template-columns:180px 1fr;gap:14px}
  .thumb{width:180px;height:100px;border-radius:10px;overflow:hidden;background:#0a1328;display:flex;align-items:center;justify-content:center;color:#6f7ea8;font-size:11px}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .item h3{margin:0 0 6px 0;font-size:16px;color:#cfe0ff}
  .item .summary{font-size:13px;line-height:1.4;color:var(--muted);margin-bottom:6px}
  .item .url{font-size:12px;color:#7d8ab0;word-break:break-all}
  .item .actions{margin-top:10px;display:flex;gap:8px}
  .pill{background:#0d2520;color:#86efac;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600}
  .warn{color:var(--danger);font-size:12px;margin-top:6px}
  .loader{display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 0;color:var(--muted)}
  .loader-text{font-size:14px}
  .loader-dots{display:flex;gap:8px}
  .loader-dots span{width:10px;height:10px;border-radius:50%;background:var(--accent);animation:pulse 1.4s ease-in-out infinite}
  .loader-dots span:nth-child(2){animation-delay:.2s}
  .loader-dots span:nth-child(3){animation-delay:.4s}
  @keyframes pulse{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1.1)}}
  .skeleton{display:grid;grid-template-columns:1fr;gap:12px}
  .skeleton-item{background:#0d142a;border:1px solid #22304f;border-radius:12px;padding:14px;display:grid;grid-template-columns:180px 1fr;gap:14px;animation:shimmer 1.5s ease-in-out infinite alternate}
  .skeleton-thumb{width:180px;height:100px;border-radius:10px;background:#151e38}
  .skeleton-line{height:14px;border-radius:6px;background:#151e38;margin-bottom:8px}
  .skeleton-line.w60{width:60%}
  .skeleton-line.w90{width:90%}
  .skeleton-line.w40{width:40%}
  @keyframes shimmer{0%{opacity:.5}100%{opacity:1}}
  .player{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(6,10,22,0.82);z-index:999}
  .player.open{display:flex}
  .player-card{background:#0d142a;border:1px solid #22304f;border-radius:16px;box-shadow:0 18px 40px rgba(0,0,0,0.55);width:min(1400px,96vw);max-height:94vh;display:flex;flex-direction:column}
  .player-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #22304f}
  .player-title{font-weight:700;font-size:15px;color:#dbe7ff;max-width:80%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .player-body{display:grid;grid-template-columns:2fr 1fr;gap:16px;padding:16px;overflow:auto}
  .player-video{background:#000;border-radius:12px;overflow:hidden;min-height:480px}
  .player-video iframe{width:100%;height:100%;border:0}
  .player-side{display:flex;flex-direction:column;gap:12px}
  .player-summary{font-size:13px;line-height:1.5;color:var(--muted)}
  .player-full{font-size:13px;line-height:1.5;color:#cfe0ff;background:#0a1328;border:1px solid #2a3a62;border-radius:10px;padding:10px;min-height:90px;white-space:pre-wrap}
  .player-actions{display:flex;gap:8px;flex-wrap:wrap}
  @media(max-width:900px){
    .item{grid-template-columns:1fr}
    .thumb{width:100%;height:170px}
    .player-body{grid-template-columns:1fr}
  }
</style></head>
<body><div class="wrap">
  <div class="card">
    <div class="pill">Curated Gate aktiv</div>
    <h1>Kuratiertes Fenster</h1>
    <div class="meta" id="meta">Lade...</div>
    <div class="meta" id="notice"></div>
    <div class="search">
      <input id="q" type="text" placeholder="Suche genau das, was du brauchst..." />
      <button id="searchBtn">Suchen</button>
    </div>
    <div class="items" id="items"></div>
  </div>
</div>
<div class="player" id="player">
  <div class="player-card" id="playerCard">
    <div class="player-header">
      <div class="player-title" id="playerTitle">Video</div>
      <button class="ghost" id="playerClose">Schliessen</button>
    </div>
    <div class="player-body">
      <div class="player-video" id="playerVideo"></div>
      <div class="player-side">
        <div class="player-summary" id="playerSummary"></div>
        <div class="player-actions">
          <button class="secondary" id="playerSummarize">Zusammenfassen</button>
        </div>
        <div class="player-full" id="playerFull">Noch keine Zusammenfassung.</div>
      </div>
    </div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const from=params.get('from')||'';
const site=params.get('site')|| (from?new URL(from).hostname:'');
const meta=$('meta'); meta.textContent = site ? ('Quelle: '+site+' - Feed blockiert, nur kuratierte Inhalte.') : 'Feed blockiert, kuratierte Inhalte.';
const notice=$('notice');
const itemsEl=$('items');
const player=$('player');
const playerCard=$('playerCard');
const playerTitle=$('playerTitle');
const playerVideo=$('playerVideo');
const playerSummary=$('playerSummary');
const playerFull=$('playerFull');
const playerSummarize=$('playerSummarize');
let currentItem=null;

function isYouTubeShorts(url){
  try{
    const u=new URL(url);
    return u.hostname.includes('youtube.com') && u.pathname.toLowerCase().startsWith('/shorts/');
  }catch{ return false; }
}
function extractYouTubeId(url){
  try{
    const u=new URL(url);
    const host=u.hostname.toLowerCase();
    if(host.includes('youtu.be')){
      const id=u.pathname.replace(/^\\//,'').trim();
      return id||'';
    }
    if(host.includes('youtube.com')){
      if(u.pathname.startsWith('/watch')) return u.searchParams.get('v')||'';
      if(u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2]||'';
      if(u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2]||'';
    }
  }catch{}
  return '';
}
function buildThumb(item){
  if(item.thumbnail) return item.thumbnail;
  const id=extractYouTubeId(item.url||'');
  if(id) return 'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg';
  return '';
}
function renderPlayerVideo(url){
  playerVideo.innerHTML='';
  const id=extractYouTubeId(url);
  if(id){
    const iframe=document.createElement('iframe');
    iframe.src='https://www.youtube-nocookie.com/embed/'+id;
    iframe.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen=true;
    playerVideo.appendChild(iframe);
    return;
  }
  const fallback=document.createElement('div');
  fallback.style.padding='16px';
  fallback.style.color='#c0d8ff';
  fallback.textContent='Kein Embed verfuegbar. Oeffne extern.';
  const btn=document.createElement('button');
  btn.className='secondary';
  btn.style.marginTop='10px';
  btn.textContent='Extern oeffnen';
  btn.onclick=()=>window.open(url,'_blank','noopener');
  fallback.appendChild(document.createElement('br'));
  fallback.appendChild(btn);
  playerVideo.appendChild(fallback);
}
function openPlayer(item){
  if(isYouTubeShorts(item.url)) {
    notice.textContent='Shorts sind im Curated Mode nicht erlaubt.';
    return false;
  }
  notice.textContent='';
  currentItem=item;
  playerTitle.textContent=item.title||item.url;
  playerSummary.textContent=item.summary||'Kurzbeschreibung fehlt.';
  playerFull.textContent='Noch keine Zusammenfassung.';
  playerSummarize.disabled=false;
  playerSummarize.textContent='Zusammenfassen';
  renderPlayerVideo(item.url);
  player.classList.add('open');
  document.body.classList.add('player-open');
  return true;
}
function closePlayer(){
  player.classList.remove('open');
  document.body.classList.remove('player-open');
  currentItem=null;
}
async function summarizeUrl(url, title, btn, targetEl){
  btn.disabled=true; btn.textContent='...';
  try{
    const r=await fetch('/curated/summarize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,title})});
    const data=await r.json();
    if(!data || data.ok===false) throw new Error(data.error||'summarize_failed');
    targetEl.textContent=(data.summary||'').trim()||'Keine Zusammenfassung erhalten.';
  }catch(e){
    targetEl.textContent='Fehler beim Zusammenfassen.';
  }
  btn.disabled=false; btn.textContent='Zusammenfassen';
}
playerSummarize.onclick=()=>{
  if(!currentItem) return;
  void summarizeUrl(currentItem.url, currentItem.title||'', playerSummarize, playerFull);
};
$('playerClose').onclick=closePlayer;
player.addEventListener('click',e=>{ if(e.target===player) closePlayer(); });
playerCard.addEventListener('click',e=>e.stopPropagation());

function itemCard(item){
  const div=document.createElement('div'); div.className='item';
  const thumb=document.createElement('div'); thumb.className='thumb';
  const thumbUrl=buildThumb(item);
  if(thumbUrl){
    const img=document.createElement('img'); img.src=thumbUrl; img.alt=item.title||'Thumbnail'; thumb.appendChild(img);
  }else{
    thumb.textContent='Kein Thumbnail';
  }
  div.appendChild(thumb);

  const body=document.createElement('div');
  const h=document.createElement('h3'); h.textContent=item.title||item.url; body.appendChild(h);
  const s=document.createElement('div'); s.className='summary'; s.textContent=item.summary||'Kurzbeschreibung fehlt.'; body.appendChild(s);
  const u=document.createElement('div'); u.className='url'; u.textContent=item.url; body.appendChild(u);
  const actions=document.createElement('div'); actions.className='actions';
  const open=document.createElement('button'); open.className='secondary'; open.textContent='Ansehen';
  const isShorts=isYouTubeShorts(item.url);
  if(isShorts){
    open.disabled=true; open.textContent='Shorts blockiert';
    const warn=document.createElement('div'); warn.className='warn'; warn.textContent='Shorts sind im Curated Mode nicht erlaubt.'; body.appendChild(warn);
  }else{
    open.onclick=()=>openPlayer(item);
  }
  actions.appendChild(open);
  body.appendChild(actions);
  div.appendChild(body);
  return div;
}
function showLoader(msg){
  itemsEl.innerHTML='';
  const loader=document.createElement('div'); loader.className='loader';
  const text=document.createElement('div'); text.className='loader-text'; text.textContent=msg;
  const dots=document.createElement('div'); dots.className='loader-dots';
  for(let i=0;i<3;i++){const s=document.createElement('span');dots.appendChild(s);}
  loader.appendChild(text); loader.appendChild(dots);
  itemsEl.appendChild(loader);
  const skel=document.createElement('div'); skel.className='skeleton';
  for(let i=0;i<3;i++){
    const si=document.createElement('div'); si.className='skeleton-item';
    const th=document.createElement('div'); th.className='skeleton-thumb'; si.appendChild(th);
    const body=document.createElement('div');
    const l1=document.createElement('div'); l1.className='skeleton-line w60'; body.appendChild(l1);
    const l2=document.createElement('div'); l2.className='skeleton-line w90'; body.appendChild(l2);
    const l3=document.createElement('div'); l3.className='skeleton-line w40'; body.appendChild(l3);
    si.appendChild(body); skel.appendChild(si);
  }
  itemsEl.appendChild(skel);
}
function showItems(items,emptyMsg){
  itemsEl.innerHTML='';
  if(!items.length){ itemsEl.textContent=emptyMsg; return; }
  items.forEach(i=>itemsEl.appendChild(itemCard(i)));
}
async function loadRecs(){
  showLoader('Empfehlungen werden geladen...');
  try{
    const r=await fetch('/curated/recommendations?site='+encodeURIComponent(site||'')+'&limit=5');
    const data=await r.json();
    showItems(data.items||[],'Keine Empfehlungen gefunden. Nutze die Suche.');
  }catch(e){
    itemsEl.innerHTML=''; itemsEl.textContent='Fehler beim Laden.';
  }
}
async function doSearch(){
  const q=$('q').value.trim(); if(!q) return;
  $('searchBtn').disabled=true;
  $('searchBtn').textContent='...';
  showLoader('Suche nach "'+q+'"...');
  try{
    const r=await fetch('/curated/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,site})});
    const data=await r.json();
    showItems(data.items||[],'Keine Ergebnisse. Versuche eine andere Suche.');
  }catch(e){
    itemsEl.innerHTML=''; itemsEl.textContent='Fehler bei der Suche.';
  }
  $('searchBtn').disabled=false;
  $('searchBtn').textContent='Suchen';
}
$('searchBtn').onclick=()=>{void doSearch();};
$('q').addEventListener('keydown',e=>{ if(e.key==='Enter'){ void doSearch(); }});
loadRecs();
</script></body></html>`;
}
