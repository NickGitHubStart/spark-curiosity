package com.sparkcuriosity.app.util

import android.util.Log
import java.net.ServerSocket

/**
 * Tiny HTTP server (port 4567) that serves a live debug page for the Spark agent.
 *
 * Access from PC:
 *   adb forward tcp:4567 tcp:4567
 *   then open http://localhost:4567 in any browser — auto-refreshes every 2 s.
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
<meta http-equiv="refresh" content="2">
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
</style>
</head>
<body>
<h1>⚡ Spark Agent Debug</h1>
<div class="sub">Auto-Refresh 2s &bull; adb forward tcp:4567 tcp:4567 &bull; http://localhost:4567</div>

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
