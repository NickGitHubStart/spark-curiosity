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
