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
    private var lastSentUrl: String = ""
    private var lastEventSentAt: Long = 0
    private var pendingEventJob: Job? = null
    private var nextCheckJob: Job? = null

    // Scroll tracking (#7)
    private var scrollCount: Int = 0

    // Redirect-return tracking (#8)
    private var lastRedirectedUrl: String = ""
    private var lastRedirectTime: Long = 0

    // Debounce: don't send events more than once per 2 seconds
    private val debounceMs = 2000L
    // Minimum interval between API calls for the same URL (short so re-opens get caught fast)
    private val sameUrlCooldownMs = 5_000L
    // Blocked URLs get an even shorter cooldown so persistent users can't just swipe back
    private val blockedUrlCooldownMs = 2_000L

    // ── Local decision cache (mirrors companion's in-memory cache) ──
    private data class CachedDecision(
        val wasBlocked: Boolean,
        val expiresAt: Long
    )
    private val decisionCache = HashMap<String, CachedDecision>()

    private var memoryRepo: com.sparkcuriosity.app.data.repo.MemoryRepository? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        val app = application as SparkApp
        api = SparkApi(tokenProvider = {
            runBlocking { app.tokenRepository.getToken() }
        })
        memoryRepo = com.sparkcuriosity.app.data.repo.MemoryRepository(api!!, app.memoryCrypto)
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
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> {
                scrollCount++
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
        scrollCount = 0
        scheduleEvent()
    }

    private fun onBrowserNavigated(packageName: String, url: String) {
        currentPackage = packageName
        currentUrl = url
        currentTitle = ""
        sessionStart = System.currentTimeMillis()
        scrollCount = 0
        scheduleEvent()
    }

    private fun scheduleEvent() {
        pendingEventJob?.cancel()
        pendingEventJob = scope.launch {
            delay(debounceMs)
            sendEvent()
        }
    }

    private fun cacheKey(url: String): String {
        // Cache by hostname (like the companion), not full URL
        return try {
            java.net.URI(url).host ?: url
        } catch (_: Exception) {
            url
        }
    }

    private suspend fun sendEvent() {
        val now = System.currentTimeMillis()
        val urlAtSendTime = currentUrl
        val key = cacheKey(urlAtSendTime)

        // ── Check local cache first — instant block without network roundtrip ──
        val cached = decisionCache[key]
        if (cached != null && now < cached.expiresAt && cached.wasBlocked) {
            // Re-apply block immediately
            if (urlAtSendTime.startsWith("app://")) {
                performGlobalAction(GLOBAL_ACTION_HOME)
            }
            OverlayService.handleCommand(
                com.sparkcuriosity.app.data.model.Command(
                    type = "redirect",
                    url = "spark://curated?site=${java.net.URLEncoder.encode(key, "UTF-8")}",
                    closeTab = true,
                    reason = "cached_block"
                )
            )
            return
        }

        // Cooldown: don't re-send for same URL too quickly
        val cooldown = if (cached?.wasBlocked == true) blockedUrlCooldownMs else sameUrlCooldownMs
        if (urlAtSendTime == lastSentUrl && now - lastEventSentAt < cooldown) return

        val sessionSeconds = ((now - sessionStart) / 1000).toInt()
        val platform = if (currentUrl.startsWith("app://")) {
            PlatformDetector.fromPackage(currentPackage)
        } else {
            PlatformDetector.fromUrl(currentUrl)
        }

        // Decrypt local memory and send inline so the server stays stateless.
        val snapshot = try { memoryRepo?.loadPlaintext() } catch (_: Exception) { null }
        val inline = snapshot?.let {
            com.sparkcuriosity.app.data.model.InlineMemory(it.body, it.onboardingComplete)
        }

        // Detect if user returned to a previously redirected URL (#8)
        val returnedAfterRedirect = lastRedirectedUrl.isNotEmpty() &&
            cacheKey(urlAtSendTime) == cacheKey(lastRedirectedUrl) &&
            now - lastRedirectTime < 120_000 // within 2 minutes

        val event = EventIngest(
            timestamp = Instant.now().toString(),
            platform = platform,
            contentMode = if (currentUrl.startsWith("app://")) "other"
                          else PlatformDetector.contentModeFromUrl(currentUrl),
            url = currentUrl,
            title = currentTitle,
            sessionSeconds = sessionSeconds,
            scrollCount = scrollCount,
            returnedAfterRedirect = returnedAfterRedirect,
            redirectedFromUrl = if (returnedAfterRedirect) lastRedirectedUrl else null,
            memory = inline
        )

        try {
            val response = api?.sendEvent(event) ?: return
            // Persist any memory mutations the AI made
            response.updatedMemoryBody?.let { newBody ->
                try { memoryRepo?.savePlaintext(newBody, snapshot?.onboardingComplete ?: false) } catch (_: Exception) {}
            }
            lastEventSentAt = now
            lastSentUrl = urlAtSendTime

            // ── Update local cache ──
            val hasRedirect = response.commands?.any { it.type == "redirect" } == true
            val nextSec = response.nextCheckSeconds ?: 1200
            decisionCache[key] = CachedDecision(
                wasBlocked = hasRedirect,
                expiresAt = now + (nextSec * 5 * 1000L) // cache for 5x nextCheck like companion
            )
            // Evict stale entries
            decisionCache.entries.removeIf { now > it.value.expiresAt }

            // Process commands (all command types are handled by OverlayService)
            response.commands?.forEach { cmd ->
                when (cmd.type) {
                    "redirect" -> {
                        // Track redirected URL for returnedAfterRedirect detection (#8)
                        lastRedirectedUrl = urlAtSendTime
                        lastRedirectTime = now

                        OverlayService.handleCommand(cmd)
                        // For app:// blocks, also pull the user out of the offending app.
                        if (urlAtSendTime.startsWith("app://")) {
                            performGlobalAction(GLOBAL_ACTION_HOME)
                        }
                    }
                    "quote" -> OverlayService.handleCommand(cmd)
                    "prompt" -> OverlayService.handleCommand(cmd)
                }
            }

            // Schedule next check if specified — cancel previous to avoid stacking jobs
            response.nextCheckSeconds?.let { seconds ->
                nextCheckJob?.cancel()
                nextCheckJob = scope.launch {
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
