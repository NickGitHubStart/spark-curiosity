package com.sparkcuriosity.app.service

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.EventIngest
import com.sparkcuriosity.app.util.PlatformDetector
import kotlinx.coroutines.*
import java.time.Instant

/**
 * Monitors foreground app changes and browser URL bar content.
 * Sends events to the Cloud Companion for AI decision-making.
 *
 * Key approach:
 * - TYPE_WINDOW_STATE_CHANGED → detects app switches
 * - TYPE_WINDOW_CONTENT_CHANGED on browser URL bars → detects navigation
 * - Debounces events to avoid flooding the API
 * - Tracks session duration per-app
 */
class SparkAccessibilityService : AccessibilityService() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var api: SparkApi? = null

    // State
    private var currentPackage: String = ""
    private var currentUrl: String = ""
    private var currentTitle: String = ""
    private var sessionStart: Long = 0
    private var lastEventSentAt: Long = 0
    private var pendingEventJob: Job? = null

    // Debounce: don't send events more than once per 2 seconds
    private val debounceMs = 2000L
    // Minimum interval between API calls for the same URL
    private val sameUrlCooldownMs = 30_000L

    override fun onServiceConnected() {
        super.onServiceConnected()
        val app = application as SparkApp
        api = SparkApi(tokenProvider = {
            runBlocking { app.tokenRepository.getToken() }
        })
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val pkg = event.packageName?.toString() ?: return
                if (pkg == packageName) return // Ignore self
                if (pkg == currentPackage) return

                val title = event.text?.joinToString(" ") ?: ""
                onAppChanged(pkg, title)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val pkg = event.packageName?.toString() ?: return
                if (!PlatformDetector.BROWSER_PACKAGES.contains(pkg)) return

                // Try to extract URL from browser address bar
                val url = extractUrlFromNode(event.source) ?: return
                if (url == currentUrl) return
                onBrowserNavigated(pkg, url)
            }
        }
    }

    override fun onInterrupt() {
        scope.cancel()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    private fun onAppChanged(packageName: String, title: String) {
        currentPackage = packageName
        currentTitle = title
        currentUrl = "app://$packageName"
        sessionStart = System.currentTimeMillis()
        scheduleEvent()
    }

    private fun onBrowserNavigated(packageName: String, url: String) {
        currentPackage = packageName
        currentUrl = url
        currentTitle = "" // Will be filled by next event
        sessionStart = System.currentTimeMillis()
        scheduleEvent()
    }

    private fun scheduleEvent() {
        pendingEventJob?.cancel()
        pendingEventJob = scope.launch {
            delay(debounceMs)
            sendEvent()
        }
    }

    private suspend fun sendEvent() {
        val now = System.currentTimeMillis()

        // Cooldown: don't re-send for same URL too quickly
        if (now - lastEventSentAt < sameUrlCooldownMs && currentUrl == currentUrl) return

        val sessionSeconds = ((now - sessionStart) / 1000).toInt()
        val platform = if (currentUrl.startsWith("app://")) {
            PlatformDetector.fromPackage(currentPackage)
        } else {
            PlatformDetector.fromUrl(currentUrl)
        }

        val event = EventIngest(
            timestamp = Instant.now().toString(),
            platform = platform,
            contentMode = if (currentUrl.startsWith("app://")) "other"
                          else PlatformDetector.contentModeFromUrl(currentUrl),
            url = currentUrl,
            title = currentTitle,
            sessionSeconds = sessionSeconds,
            scrollCount = 0
        )

        try {
            val response = api?.sendEvent(event) ?: return
            lastEventSentAt = now

            // Process commands (redirect = open URL via intent, quote = notify overlay)
            response.commands?.forEach { cmd ->
                when (cmd.type) {
                    "redirect" -> {
                        cmd.url?.let { url ->
                            if (url.startsWith("spark://")) {
                                // Internal command — tell overlay service
                                OverlayService.handleCommand(cmd)
                            } else {
                                // Open URL in browser via global action or intent
                                // For now, notify the overlay service which handles it
                                OverlayService.handleCommand(cmd)
                            }
                        }
                    }
                    "quote" -> OverlayService.handleCommand(cmd)
                    "prompt" -> OverlayService.handleCommand(cmd)
                }
            }

            // Schedule next check if specified
            response.nextCheckSeconds?.let { seconds ->
                scope.launch {
                    delay(seconds * 1000L)
                    sendEvent() // Re-evaluate after the delay
                }
            }
        } catch (_: Exception) {
            // Network error — will retry on next event
        }
    }

    /**
     * Attempts to extract a URL from a browser's address bar node.
     * Traverses the accessibility tree looking for an EditText with URL-like content.
     */
    private fun extractUrlFromNode(node: AccessibilityNodeInfo?): String? {
        if (node == null) return null
        return try {
            findUrlNode(node)?.text?.toString()?.let { text ->
                // Browser bars sometimes show "example.com" without scheme
                if (text.contains("://")) text
                else if (text.contains(".") && !text.contains(" ")) "https://$text"
                else null
            }
        } catch (_: Exception) {
            null
        } finally {
            try { node.recycle() } catch (_: Exception) {}
        }
    }

    private fun findUrlNode(node: AccessibilityNodeInfo, depth: Int = 0): AccessibilityNodeInfo? {
        if (depth > 10) return null

        // Look for EditText or URL bar by resource ID patterns
        val resourceId = node.viewIdResourceName ?: ""
        if (resourceId.contains("url_bar") ||
            resourceId.contains("url_field") ||
            resourceId.contains("location_bar") ||
            resourceId.contains("search_box") ||
            resourceId.contains("mozac_browser_toolbar_url_view")) {
            return node
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findUrlNode(child, depth + 1)
            if (result != null) return result
            try { child.recycle() } catch (_: Exception) {}
        }
        return null
    }
}
