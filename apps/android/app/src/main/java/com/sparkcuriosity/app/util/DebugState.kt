package com.sparkcuriosity.app.util

import java.text.SimpleDateFormat
import java.util.*

/**
 * Process-scoped debug state — updated by AccessibilityService, read by DebugHttpServer.
 */
object DebugState {
    @Volatile var currentUrl: String = "—"
    @Volatile var currentPlatform: String = "—"
    @Volatile var lastReason: String = "—"
    @Volatile var lastCommands: String = "—"
    @Volatile var pollStatus: String = "—"
    @Volatile var lastSentAt: String = "—"
    @Volatile var lastSendTrigger: String = "—"

    // Signals (Android): refreshed whenever sendEvent builds a SignalBundle.
    // Show permission status when null to make debugging obvious for the user.
    @Volatile var currentMedia: String = "—"
    @Volatile var currentUsage: String = "—"
    @Volatile var currentRecentHosts: String = "—"

    // Permission status — updated each sendEvent so the debug page always reflects the live state.
    @Volatile var mediaPermission: String = "unbekannt"
    @Volatile var usagePermission: String = "unbekannt"

    /** Internal verbose log — every a11y tick, poll attempt, cooldown hit, etc. */
    private val _log = ArrayDeque<String>(120)
    /** API-only log — exactly what the agent sent / received per API call. */
    private val _apiLog = ArrayDeque<String>(40)
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private val dayTimeFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

    /**
     * Copy-friendly log for the debug HTTP page: one section per trigger/outcome for the **local calendar day**.
     * Cleared at day rollover; in-memory only (nicht über App-Neustart hinaus).
     */
    private val todayTraffic = ArrayDeque<String>(200)
    private var todayTrafficDay: String = ""

    private fun rollTodayIfNeeded() {
        val d = dayFmt.format(Date())
        if (todayTrafficDay != d) {
            todayTrafficDay = d
            todayTraffic.clear()
        }
    }

    /** Plain text for textarea export (German header). */
    fun todayTrafficExport(): String {
        synchronized(todayTraffic) {
            rollTodayIfNeeded()
            val d = dayFmt.format(Date())
            if (todayTraffic.isEmpty()) {
                return "(Noch keine Einträge für $d.)"
            }
            return buildString {
                appendLine("Spark — Trigger & Antworten ($d, lokales Datum)")
                appendLine("=".repeat(72))
                appendLine()
                todayTraffic.forEach { appendLine(it); appendLine() }
            }
        }
    }

    fun appendTodayTraffic(block: String) {
        synchronized(todayTraffic) {
            rollTodayIfNeeded()
            val head = "--- ${dayTimeFmt.format(Date())} ---"
            todayTraffic.addLast("$head\n${block.trimEnd()}")
            while (todayTraffic.size > 200) todayTraffic.removeFirst()
        }
    }

    fun log(msg: String) {
        val entry = "${fmt.format(Date())}  $msg"
        synchronized(_log) {
            _log.addLast(entry)
            if (_log.size > 100) _log.removeFirst()
        }
    }

    /**
     * Log something that represents an actual agent API interaction
     * (SEND payload, RESP, commands, agent-triggered actions).
     * Mirrored to the internal log for full chronology.
     */
    fun logApi(msg: String) {
        val entry = "${fmt.format(Date())}  $msg"
        synchronized(_apiLog) {
            _apiLog.addLast(entry)
            if (_apiLog.size > 30) _apiLog.removeFirst()
        }
        log(msg)
    }

    fun snapshot(): List<String> = synchronized(_log) { _log.reversed().toList() }
    fun snapshotApi(): List<String> = synchronized(_apiLog) { _apiLog.reversed().toList() }
}
