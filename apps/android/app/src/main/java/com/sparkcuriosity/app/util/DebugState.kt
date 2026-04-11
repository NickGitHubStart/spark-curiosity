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

    private val _log = ArrayDeque<String>(60)
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    fun log(msg: String) {
        val entry = "${fmt.format(Date())}  $msg"
        synchronized(_log) {
            _log.addLast(entry)
            if (_log.size > 50) _log.removeFirst()
        }
    }

    fun snapshot(): List<String> = synchronized(_log) { _log.reversed().toList() }
}
