package com.sparkcuriosity.app.util

import android.util.Log
import java.net.ServerSocket

/**
 * Tiny HTTP server (port 4567) that serves a live debug page for the Spark agent.
 *
 * Access from PC:
 *   adb forward tcp:4567 tcp:4567
 *   then open http://localhost:4567 in any browser — manuell neu laden für frische Logs.
 */
class DebugHttpServer(private val port: Int = 4567) {

    private val TAG = "SparkDebugServer"
    private var serverSocket: ServerSocket? = null
    @Volatile private var running = false

    fun start() {
        if (running) return
        running = true
        Thread({
            try {
                serverSocket = ServerSocket(port)
                Log.d(TAG, "Debug server listening on port $port")
                while (running) {
                    val client = try { serverSocket?.accept() } catch (_: Exception) { null } ?: break
                    Thread({ serveClient(client) }, "spark-debug-client").start()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server error: ${e.message}")
            }
        }, "spark-debug-server").start()
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
    }

    private fun serveClient(socket: java.net.Socket) {
        try {
            // Drain the request
            val input = socket.getInputStream().bufferedReader()
            var line = input.readLine()
            while (!line.isNullOrBlank()) line = input.readLine()

            val html = buildHtml()
            val bytes = html.toByteArray(Charsets.UTF_8)
            val response = buildString {
                append("HTTP/1.1 200 OK\r\n")
                append("Content-Type: text/html; charset=utf-8\r\n")
                append("Content-Length: ${bytes.size}\r\n")
                append("Connection: close\r\n")
                append("\r\n")
            }
            socket.getOutputStream().apply {
                write(response.toByteArray())
                write(bytes)
                flush()
            }
        } catch (_: Exception) {
        } finally {
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun buildHtml(): String {
        val apiLog = DebugState.snapshotApi()
        val internalLog = DebugState.snapshot()
        val trafficExport = DebugState.todayTrafficExport()

        val apiHtml = if (apiLog.isEmpty()) "<div class='entry dim'>Noch keine API-Calls</div>"
                      else apiLog.joinToString("\n") { "<div class='entry'>${it.escHtml()}</div>" }
        val internalHtml = if (internalLog.isEmpty()) "<div class='entry dim'>Kein interner Log</div>"
                      else internalLog.joinToString("\n") { "<div class='entry internal'>${it.escHtml()}</div>" }

        val mediaClass = when {
            DebugState.currentMedia.startsWith("⚠") -> "warn"
            DebugState.currentMedia == "—" || DebugState.currentMedia.startsWith("keine") -> "dim"
            else -> "ok"
        }
        val usageClass = when {
            DebugState.currentUsage.startsWith("⚠") -> "warn"
            DebugState.currentUsage == "—" || DebugState.currentUsage.startsWith("—") -> "dim"
            else -> "ok"
        }

        return """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Spark Debug</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px;font-size:14px}
h1{color:#58a6ff;font-size:20px;margin-bottom:6px}
.sub{color:#8b949e;font-size:12px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.label{color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.value{color:#e6edf3;font-size:15px;word-break:break-all}
.value.ok{color:#3fb950}
.value.warn{color:#d29922}
.value.err{color:#f85149}
.value.dim{color:#6e7681}
.section-title{color:#58a6ff;font-size:14px;text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px 0;font-weight:bold}
.section-title small{color:#8b949e;font-weight:normal;text-transform:none;letter-spacing:0;margin-left:8px}
.log-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;height:480px;overflow-y:auto}
.log-box.internal-box{height:260px;background:#0d1117;border-style:dashed}
.entry{color:#7ee787;font-size:12px;margin:6px 0;white-space:pre-wrap;word-break:break-all;padding:4px 0;border-bottom:1px dashed #1f2937}
.entry:last-child{border-bottom:none}
.entry.internal{color:#6e7681;font-size:11px;margin:1px 0;padding:0;border:none}
details{margin-top:12px}
summary{cursor:pointer;color:#8b949e;font-size:12px;padding:8px 0;user-select:none}
summary:hover{color:#c9d1d9}
.footer{color:#484f58;font-size:11px;margin-top:10px}
.copy-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.copy-row button{background:#238636;color:#fff;border:1px solid #2ea043;border-radius:6px;padding:8px 14px;font-family:inherit;font-size:13px;cursor:pointer}
.copy-row button:hover{background:#2ea043}
.traffic-export{width:100%;min-height:320px;max-height:480px;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px;color:#7ee787;font-size:12px;line-height:1.45;font-family:ui-monospace,monospace;resize:vertical;box-sizing:border-box}
.bc-in{width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;color:#c9d1d9;font-size:13px;margin:6px 0}
.bc-ta{min-height:80px;resize:vertical;font-family:ui-monospace,monospace}
.bc-out{white-space:pre-wrap;word-break:break-all;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;font-size:12px;color:#7ee787;min-height:60px;max-height:220px;overflow-y:auto;margin-top:6px}
.bc-err{color:#f85149;font-size:12px;margin-top:6px}
.bc-mod{color:#58a6ff;font-size:12px;margin-top:4px}
.bc-hint{color:#6e7681;font-size:11px;margin:6px 0 0 0;line-height:1.4}
</style>
<script>
function copyTrafficExport(){
  var el=document.getElementById('traffic-export');
  if(!el)return;
  el.focus(); el.select();
  try{
    navigator.clipboard.writeText(el.value).then(function(){
      var b=document.getElementById('copy-feedback');
      if(b){ b.textContent='Kopiert.'; setTimeout(function(){b.textContent='';},2000);}
    });
  }catch(e){
    try{ document.execCommand('copy'); }catch(_){}
  }
}
function trimBase(b){
  if(!b) return b;
  while(b.length>0 && b.charAt(b.length-1) === '/') b=b.substring(0,b.length-1);
  return b;
}
function getCompanionBase(){
  var i=document.getElementById('companionBase');
  var b= i&&i.value? String(i.value).trim() : 'http://127.0.0.1:4343';
  if(b.length>0 && b.indexOf('http')!==0) b='http://'+b;
  return trimBase(b);
}
function saveCompanionBase(){
  try{ localStorage.setItem('sparkDebugCompanion', getCompanionBase()); }catch(e){}
}
function loadCompanionBase(){
  try{
    var s=localStorage.getItem('sparkDebugCompanion');
    if(s){
      var i=document.getElementById('companionBase');
      if(i) i.value=s;
    }
  }catch(e){}
}
function runBrainCompress(){
  var base=getCompanionBase();
  saveCompanionBase();
  var ta=document.getElementById('bc-source');
  var text=ta&&ta.value? String(ta.value).trim() : '';
  var errEl=document.getElementById('bc-err');
  var outEl=document.getElementById('bc-out');
  var modEl=document.getElementById('bc-mod');
  var st=document.getElementById('bc-status');
  var btn=document.getElementById('bc-run');
  if(!errEl||!outEl||!modEl||!st||!btn) return;
  errEl.style.display='none'; outEl.style.display='none'; modEl.style.display='none';
  if(!text){ errEl.textContent='Quelltext leer.'; errEl.style.display='block'; return; }
  st.textContent='…'; btn.disabled=true;
  var url=base + '/brain/compress-preview';
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) })
  .then(function(r){ return r.text().then(function(t){ return { ok: r.ok, status: r.status, t: t }; }); })
  .then(function(x){
    if(!x.ok){
      var d=null; try{ d=JSON.parse(x.t);}catch(e1){ d=null; }
      errEl.textContent= d&&d.error ? d.error : (x.t || String(x.status));
      errEl.style.display='block';
      st.textContent='Fehler';
      return;
    }
    var d2=null; try{ d2=JSON.parse(x.t);}catch(e2){
      errEl.textContent=x.t; errEl.style.display='block'; st.textContent='Fehler';
      return;
    }
    outEl.textContent= d2&&d2.content ? d2.content : '(leer)';
    outEl.style.display='block';
    if(d2&&d2.model){ modEl.textContent='Modell: '+d2.model; modEl.style.display='block'; }
    st.textContent='OK';
  })
  .catch(function(e){
    errEl.textContent=String(e&&e.message?e.message:e);
    errEl.style.display='block';
    st.textContent='Fehler';
  })
  .finally(function(){ btn.disabled=false; });
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', loadCompanionBase); } else { loadCompanionBase(); }
</script>
</head>
<body>
<h1>⚡ Spark Agent Debug</h1>
<div class="sub">adb forward tcp:4567 tcp:4567 &bull; <button type="button" style="font:inherit;padding:4px 10px;cursor:pointer;border-radius:4px;border:1px solid #30363d;background:#161b22;color:#58a6ff" onclick="location.reload()">Seite neu laden</button> (Logs) &bull; <code>http://localhost:4567</code> auf dem PC</div>

<div class="card" style="margin-bottom:14px;border-color:#238636">
  <div class="label">Brain · Kompression (Test) <small style="font-weight:normal">POST /brain/compress-preview</small></div>
  <p class="bc-hint">Companion muss laufen. PC-Browser: <code>http://127.0.0.1:4343</code>. Handy: PC-LAN-IP:4343, oder <code>adb reverse tcp:4343 tcp:4343</code> und Basis <code>http://127.0.0.1:4343</code>.</p>
  <div class="label" style="margin-top:8px">Companion-URL (ohne Pfad)</div>
  <input type="url" class="bc-in" id="companionBase" value="http://127.0.0.1:4343" autocomplete="off" />
  <div class="label">Quelle</div>
  <textarea class="bc-in bc-ta" id="bc-source" placeholder="Text zum Komprimieren…"></textarea>
  <div class="copy-row" style="margin-top:4px">
    <button type="button" id="bc-run" onclick="runBrainCompress()">Komprimieren</button>
    <span id="bc-status" class="bc-hint"></span>
  </div>
  <div id="bc-err" class="bc-err" style="display:none"></div>
  <div id="bc-mod" class="bc-mod" style="display:none"></div>
  <div id="bc-out" class="bc-out" style="display:none"></div>
</div>

<div class="card" style="margin-bottom:14px;border-color:#388bfd">
  <div class="label">Heute: Trigger &amp; Antworten <small style="color:#6e7681;font-weight:normal">(lokal, zum Kopieren)</small></div>
  <div class="copy-row">
    <button type="button" onclick="copyTrafficExport()">In Zwischenablage kopieren</button>
    <span id="copy-feedback" style="color:#3fb950;font-size:12px"></span>
  </div>
  <textarea id="traffic-export" class="traffic-export" readonly spellcheck="false">${trafficExport.escHtml()}</textarea>
  <div class="footer" style="margin-top:8px">Oben <strong>Seite neu laden</strong> für frische Trigger/Logs. Vor dem Kopieren kurz warten, bis der letzte Stand sichtbar ist.</div>
</div>

<div class="grid">
  <div class="card">
    <div class="label">URL</div>
    <div class="value">${DebugState.currentUrl.escHtml()}</div>
  </div>
  <div class="card">
    <div class="label">Platform</div>
    <div class="value">${DebugState.currentPlatform.escHtml()}</div>
  </div>
  <div class="card">
    <div class="label">Letzter Grund (AI)</div>
    <div class="value">${DebugState.lastReason.escHtml()}</div>
  </div>
  <div class="card">
    <div class="label">Commands</div>
    <div class="value ${if (DebugState.lastCommands.contains("redirect")) "err" else "ok"}">${DebugState.lastCommands.escHtml()}</div>
  </div>
  <div class="card">
    <div class="label">Medien-Session <small style="color:#6e7681;font-size:10px">(Perm: ${DebugState.mediaPermission.escHtml()})</small></div>
    <div class="value $mediaClass">${DebugState.currentMedia.escHtml()}</div>
  </div>
  <div class="card">
    <div class="label">Nutzung (App) <small style="color:#6e7681;font-size:10px">(Perm: ${DebugState.usagePermission.escHtml()})</small></div>
    <div class="value $usageClass">${DebugState.currentUsage.escHtml()}</div>
  </div>
  <div class="card" style="grid-column:1 / -1">
    <div class="label">Recent DNS-Hosts (60s, via VPN)</div>
    <div class="value">${DebugState.currentRecentHosts.escHtml()}</div>
  </div>
</div>

<div class="section-title">API-Calls <small>(was der Agent tatsächlich sieht &amp; antwortet)</small></div>
<div class="log-box">$apiHtml</div>

<details>
<summary>▸ Intern (A11y-Events, Cooldowns, Poll-Status …)</summary>
<div class="log-box internal-box">$internalHtml</div>
</details>

<div class="footer">Letztes Event: ${DebugState.lastSentAt.escHtml()} &bull; API-Trigger: <code>${DebugState.lastSendTrigger.escHtml()}</code> &bull; Poll: ${DebugState.pollStatus.escHtml()}</div>
</body>
</html>"""
    }

    private fun String.escHtml() = replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
