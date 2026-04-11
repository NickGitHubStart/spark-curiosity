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
        val log = DebugState.snapshot()
        val logHtml = if (log.isEmpty()) "<div class='entry dim'>Keine Einträge</div>"
                      else log.joinToString("\n") { "<div class='entry'>${it.escHtml()}</div>" }

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
h1{color:#58a6ff;font-size:20px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.label{color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.value{color:#e6edf3;font-size:15px;word-break:break-all}
.value.ok{color:#3fb950}
.value.warn{color:#d29922}
.value.err{color:#f85149}
.log-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;height:420px;overflow-y:auto}
.entry{color:#7ee787;font-size:12px;margin:2px 0;white-space:pre-wrap;word-break:break-all}
.dim{color:#484f58}
.footer{color:#484f58;font-size:11px;margin-top:10px}
</style>
</head>
<body>
<h1>⚡ Spark Agent Debug</h1>
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
    <div class="label">Poll Status</div>
    <div class="value">${DebugState.pollStatus.escHtml()}</div>
  </div>
  <div class="card">
    <div class="label">Letztes Event</div>
    <div class="value">${DebugState.lastSentAt.escHtml()}</div>
  </div>
</div>
<div class="log-box">$logHtml</div>
<div class="footer">auto-refresh 2s &bull; adb forward tcp:4567 tcp:4567 &bull; http://localhost:4567</div>
</body>
</html>"""
    }

    private fun String.escHtml() = replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
