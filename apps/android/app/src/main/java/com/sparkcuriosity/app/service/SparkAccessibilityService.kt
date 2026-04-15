package com.sparkcuriosity.app.service

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.EventIngest
import com.sparkcuriosity.app.util.DebugHttpServer
import com.sparkcuriosity.app.util.DebugState
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

    companion object {
        private const val TAG = "SparkAccessibility"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var api: SparkApi? = null
    private val debugServer = DebugHttpServer()

    // State
    private var currentPackage: String = ""
    private var currentUrl: String = ""
    private var currentTitle: String = ""
    private var sessionStart: Long = 0
    private var lastSentUrl: String = ""
    private var lastEventSentAt: Long = 0
    private var pendingEventJob: Job? = null
    private var nextCheckJob: Job? = null
    private var urlPollJob: Job? = null   // polls rootInActiveWindow until a URL is found

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

    // ── Cooldown block: after AI redirect, instantly block the same app/site for N minutes ──
    // Key = package name (native apps) or hostname (browser URLs). Value = expiry timestamp.
    private val cooldownBlocks = HashMap<String, Long>()
    // Fallback cooldown for cache-hit re-blocks (AI-set duration used for first block)
    private val fallbackCooldownMs = 20 * 60 * 1000L

    private var memoryRepo: com.sparkcuriosity.app.data.repo.MemoryRepository? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "AccessibilityService connected")

        // Re-apply service info programmatically to ensure events flow after APK updates
        val info = serviceInfo
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_SCROLLED
        info.feedbackType = android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        info.notificationTimeout = 300
        serviceInfo = info
        Log.d(TAG, "ServiceInfo re-applied: eventTypes=${info.eventTypes}")
        debugServer.start()
        DebugState.log("AccessibilityService connected")

        val app = application as SparkApp
        api = SparkApi(tokenProvider = {
            runBlocking { app.tokenRepository.getToken() }
        })
        memoryRepo = com.sparkcuriosity.app.data.repo.MemoryRepository(api!!, app.memoryCrypto)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: ""
        Log.d(TAG, "Event type=${event.eventType} pkg=$pkg cls=${event.className}")

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val pkg = event.packageName?.toString() ?: return
                if (pkg == packageName) return // Ignore self

                // For browsers: try URL extraction on every state-change (incl. same-package),
                // because WebView fires TYPE_WINDOW_STATE_CHANGED when a page finishes loading.
                if (PlatformDetector.BROWSER_PACKAGES.contains(pkg)) {
                    val root = try { rootInActiveWindow } catch (_: Exception) { null }
                    val url = extractUrlFromNode(root)
                    if (url != null && url != currentUrl) {
                        Log.d(TAG, "URL from state-changed root: $url")
                        onBrowserNavigated(pkg, url)
                        return
                    }
                    // No URL found — fall through to onAppChanged only if it's a new package
                    if (pkg == currentPackage) return
                } else {
                    if (pkg == currentPackage) return
                }

                val title = event.text?.joinToString(" ") ?: ""
                onAppChanged(pkg, title)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val pkg = event.packageName?.toString() ?: return
                if (!PlatformDetector.BROWSER_PACKAGES.contains(pkg)) return

                // Try to extract URL from browser address bar (event source or root)
                var url = extractUrlFromNode(event.source)
                if (url == null) {
                    val root = try { rootInActiveWindow } catch (_: Exception) { null }
                    url = extractUrlFromNode(root)
                }
                if (url == null) return
                if (url == currentUrl) return
                Log.d(TAG, "URL from content-changed: $url")
                onBrowserNavigated(pkg, url)
            }
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> {
                scrollCount++
            }
        }
    }

    override fun onInterrupt() {
        urlPollJob?.cancel()
        debugServer.stop()
        scope.cancel()
    }

    override fun onDestroy() {
        super.onDestroy()
        urlPollJob?.cancel()
        debugServer.stop()
        scope.cancel()
    }

    private fun onAppChanged(packageName: String, title: String) {
        Log.d(TAG, "App changed: $packageName title='$title'")
        currentPackage = packageName
        currentTitle = title
        currentUrl = "app://$packageName"
        sessionStart = System.currentTimeMillis()
        scrollCount = 0
        DebugState.currentUrl = "app://$packageName"
        DebugState.currentPlatform = PlatformDetector.fromPackage(packageName)
        DebugState.log("APP  $packageName")

        // ── Cooldown block: instant HOME if this app was recently redirected ──
        if (checkCooldownBlock(packageName)) return

        // For browsers: poll rootInActiveWindow until we find the real URL.
        // The URL bar is often empty at the moment of the switch (page still loading).
        if (PlatformDetector.BROWSER_PACKAGES.contains(packageName)) {
            startUrlPolling(packageName)
        } else {
            urlPollJob?.cancel()
            scheduleEvent()
        }
    }

    /**
     * Polls rootInActiveWindow up to 6 times (every 800 ms) until a real URL is found.
     * Fires onBrowserNavigated as soon as the URL bar is populated.
     * Falls back to sending the app:// event if no URL is found after all attempts.
     */
    private fun startUrlPolling(pkg: String) {
        urlPollJob?.cancel()
        urlPollJob = scope.launch {
            repeat(6) { attempt ->
                delay(800L)
                if (currentPackage != pkg) return@launch // user switched away
                val root = try { rootInActiveWindow } catch (_: Exception) { null }
                val url = extractUrlFromNode(root)
                if (url != null && url != currentUrl) {
                    Log.d(TAG, "URL from poll attempt $attempt: $url")
                    DebugState.pollStatus = "Gefunden bei Versuch $attempt: $url"
                    DebugState.log("POLL[$attempt] Gefunden: $url")
                    onBrowserNavigated(pkg, url)
                    return@launch
                }
                Log.d(TAG, "Poll attempt $attempt: no URL yet for $pkg")
                DebugState.pollStatus = "Versuch $attempt: kein URL für $pkg"
                DebugState.log("POLL[$attempt] Kein URL bei $pkg")
                // After all attempts: do NOT send app:// for browser packages.
                // Sending "app://org.mozilla.firefox" makes the AI think it's an unknown app
                // and trigger false redirects. Better to skip and wait for URL detection.
                if (attempt == 5) {
                    DebugState.log("POLL  Gab auf — kein Event gesendet für $pkg")
                }
            }
        }
    }

    private fun onBrowserNavigated(packageName: String, url: String) {
        Log.d(TAG, "Browser navigated: $url (pkg=$packageName)")
        currentPackage = packageName
        currentUrl = url
        currentTitle = ""
        sessionStart = System.currentTimeMillis()
        scrollCount = 0
        DebugState.currentUrl = url
        DebugState.currentPlatform = PlatformDetector.fromUrl(url)
        DebugState.log("URL  $url")

        // ── Cooldown block: instant HOME if this host was recently redirected ──
        val host = cacheKey(url)
        if (checkCooldownBlock(host)) return

        scheduleEvent()
    }

    /**
     * Checks if a package/host is in cooldown. If so, instantly sends HOME and returns true.
     * Cleans up expired entries opportunistically.
     */
    private fun checkCooldownBlock(key: String): Boolean {
        val now = System.currentTimeMillis()
        // Cleanup expired entries
        cooldownBlocks.entries.removeIf { now > it.value }
        val expiresAt = cooldownBlocks[key] ?: return false
        if (now >= expiresAt) {
            cooldownBlocks.remove(key)
            return false
        }
        val remainingSec = (expiresAt - now) / 1000
        Log.d(TAG, "Cooldown block: $key blocked for ${remainingSec}s more")
        DebugState.log("COOLDOWN-BLOCK $key (${remainingSec}s verbleibend)")
        performGlobalAction(GLOBAL_ACTION_HOME)
        return true
    }

    /** Adds a package or hostname to the cooldown block map. */
    private fun addCooldownBlock(key: String, durationMs: Long = fallbackCooldownMs) {
        val expiresAt = System.currentTimeMillis() + durationMs
        cooldownBlocks[key] = expiresAt
        DebugState.log("COOLDOWN-SET $key für ${durationMs / 1000}s")
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
        val pkgAtSendTime = currentPackage  // capture now — currentPackage may change during AI call
        val key = cacheKey(urlAtSendTime)

        // ── Check local cache first — instant block without network roundtrip ──
        val cached = decisionCache[key]
        if (cached != null && now < cached.expiresAt && cached.wasBlocked) {
            Log.d(TAG, "Cache hit: blocking $key instantly")
            DebugState.log("CACHE-BLOCK $key")
            performGlobalAction(GLOBAL_ACTION_HOME)
            OverlayService.handleCommand(
                com.sparkcuriosity.app.data.model.Command(
                    type = "redirect",
                    url = "spark://curated?site=${java.net.URLEncoder.encode(key, "UTF-8")}",
                    closeTab = true,
                    reason = "cached_block"
                )
            )
            // Reinforce cooldown on repeated attempts (use existing TTL, just refresh it)
            if (urlAtSendTime.startsWith("app://")) {
                addCooldownBlock(currentPackage, fallbackCooldownMs)
            } else {
                addCooldownBlock(key, fallbackCooldownMs)
            }
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

        // Session limit is determined by the AI from memory — no local settings.
        // We still report sessionSeconds so the AI can decide.
        val maxSessionSeconds: Int? = null
        val sessionExceeded = false

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
            sessionExceeded = sessionExceeded,
            maxSessionSeconds = maxSessionSeconds,
            memory = inline
        )

        try {
            Log.d(TAG, "Sending event: platform=$platform url=$urlAtSendTime session=${sessionSeconds}s exceeded=$sessionExceeded")
            DebugState.log("SEND platform=$platform  url=$urlAtSendTime  session=${sessionSeconds}s")
            DebugState.lastSentAt = "$platform  $urlAtSendTime"
            val response = api?.sendEvent(event) ?: return
            val cmdTypes = response.commands?.map { it.type } ?: emptyList()
            Log.d(TAG, "Response: commands=$cmdTypes nextCheck=${response.nextCheckSeconds} reason=${response.reason}")
            DebugState.lastReason = response.reason ?: "—"
            DebugState.lastCommands = if (cmdTypes.isEmpty()) "none" else cmdTypes.joinToString()
            DebugState.log("RESP commands=${DebugState.lastCommands}  next=${response.nextCheckSeconds}s")
            DebugState.log("     reason: ${response.reason?.take(120) ?: "—"}")

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
                expiresAt = now + (nextSec * 5 * 1000L)
            )
            decisionCache.entries.removeIf { now > it.value.expiresAt }

            // Process commands
            response.commands?.forEach { cmd ->
                when (cmd.type) {
                    "redirect" -> {
                        lastRedirectedUrl = urlAtSendTime
                        lastRedirectTime = now
                        Log.d(TAG, "Executing redirect to ${cmd.url}")
                        DebugState.log("BLOCK redirect → ${cmd.url}")
                        OverlayService.handleCommand(cmd)
                        // Always pull user away from the blocked context
                        performGlobalAction(GLOBAL_ACTION_HOME)
                        // Cooldown: block only what was actually visited.
                        // For native apps: block by package name.
                        // For browser URLs: block only by hostname — NOT the whole browser,
                        // otherwise the user can't open any website for 5 minutes.
                        // Cooldown duration = nextCheckSeconds from AI (the AI decides how long).
                        // Minimum 2 min so users can't immediately swipe back.
                        val cooldownMs = maxOf(2 * 60 * 1000L, (response.nextCheckSeconds ?: 1200) * 1000L)
                        val host = cacheKey(urlAtSendTime)
                        if (urlAtSendTime.startsWith("app://")) {
                            addCooldownBlock(pkgAtSendTime, cooldownMs)
                        } else {
                            addCooldownBlock(host, cooldownMs)
                        }
                    }
                    "quote" -> {
                        DebugState.log("QUOTE ${cmd.text?.take(60)}")
                        OverlayService.handleCommand(cmd)
                    }
                    "prompt" -> {
                        DebugState.log("PROMPT ${cmd.question?.take(60)}")
                        OverlayService.handleCommand(cmd)
                    }
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
        } catch (e: Exception) {
            Log.e(TAG, "sendEvent error: ${e.message}", e)
        }
    }

    /**
     * Attempts to extract a URL from a browser's address bar node.
     * Strategy: use rootInActiveWindow, traverse the node tree, find the URL bar by known IDs.
     * For Firefox (Fenix/Compose): ADDRESSBAR_URL_BOX has text in a child node.
     * For Chrome: com.android.chrome:id/url_bar or com.android.chrome:id/omnibox_url_bar.
     */
    private fun extractUrlFromNode(node: AccessibilityNodeInfo?): String? {
        if (node == null) return null
        return try {
            // Primary: tree traversal (works for Chrome, Brave, Samsung etc.)
            val urlText = findUrlText(node)
            if (urlText != null) {
                return if (urlText.contains("://")) urlText
                else if (urlText.contains(".") && !urlText.contains(" ")) "https://$urlText"
                else null
            }
            // Fallback for Firefox Fenix: search all nodes for editable URL-like text
            findUrlViaNodeSearch(node)
        } catch (_: Exception) {
            null
        } finally {
            try { node.recycle() } catch (_: Exception) {}
        }
    }

    /**
     * Firefox Fenix fallback: iterates ALL nodes looking for an editable field or
     * any node with URL-like text that isn't inside a WebView.
     * Less precise than findUrlText but catches Compose-based toolbars with no resource IDs.
     */
    private fun findUrlViaNodeSearch(root: AccessibilityNodeInfo): String? {
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Boolean>>() // node, inWebView
        queue.add(root to false)
        while (queue.isNotEmpty()) {
            val (node, inWebView) = queue.removeFirst()
            val cls = node.className?.toString() ?: ""
            val nowInWebView = inWebView || cls.contains("WebView")
            if (!nowInWebView) {
                val text = (node.text?.toString()?.trim()
                    ?: node.contentDescription?.toString()?.trim() ?: "")
                if (text.isNotEmpty() && looksLikeUrl(text) &&
                    (node.isEditable || cls.contains("EditText"))) {
                    return if (text.contains("://")) text else "https://$text"
                }
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                queue.add(child to nowInWebView)
            }
        }
        return null
    }

    /**
     * Finds URL text from the accessibility node tree.
     * Returns the URL string if found, null otherwise.
     *
     * @param inWebView true if we've already entered a WebView subtree — skip URL-text
     *   matching there to avoid picking up links from web page content.
     */
    private fun findUrlText(node: AccessibilityNodeInfo, depth: Int = 0, inWebView: Boolean = false): String? {
        if (depth > 12) return null

        val resourceId = node.viewIdResourceName ?: ""
        // Check both text and contentDescription — Firefox Fenix Compose may use either
        val text = (node.text?.toString()?.trim()
            ?: node.contentDescription?.toString()?.trim()
            ?: "")
        val cls = node.className?.toString() ?: ""
        val nowInWebView = inWebView || cls.contains("WebView")

        // Known URL bar resource IDs across view-based browsers (Chrome, Samsung, Brave…)
        val isUrlBar = resourceId.contains("url_bar") ||
                resourceId.contains("url_field") ||
                resourceId.contains("location_bar") ||
                resourceId.contains("omnibox") ||
                resourceId.contains("mozac_browser_toolbar_url_view") ||
                resourceId.contains("mozac_browser_toolbar_edit_url_view") ||
                resourceId.contains("ADDRESSBAR_URL_BOX") ||
                resourceId.contains("address_url")

        if (isUrlBar) {
            // If the URL bar node itself has text, use it
            if (text.isNotEmpty() && looksLikeUrl(text)) return text
            // Firefox Fenix legacy: URL text is in a child of ADDRESSBAR_URL_BOX
            val childUrl = findTextInChildren(node, maxDepth = 3)
            if (childUrl != null) return childUrl
        }

        // View-based browsers: EditText/TextView in toolbar area
        if (!nowInWebView && depth <= 5 && text.isNotEmpty() && looksLikeUrl(text)) {
            if (cls.contains("EditText") || cls.contains("TextView")) {
                val parentId = try { node.parent?.viewIdResourceName ?: "" } catch (_: Exception) { "" }
                if (parentId.contains("toolbar") || parentId.contains("ADDRESSBAR") ||
                    parentId.contains("url") || parentId.contains("omnibox") ||
                    resourceId.contains("toolbar") || resourceId.contains("url")) {
                    return text
                }
            }
        }

        // Compose-based browsers (Firefox Fenix new UI, etc.): no resource ID, class=View.
        // Accept any URL-like text outside of a WebView subtree at shallow depths —
        // the toolbar is always within the first ~8 levels, WebView content is deeper.
        if (!nowInWebView && depth in 2..8 && text.isNotEmpty() && looksLikeUrl(text)) {
            return text
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findUrlText(child, depth + 1, nowInWebView)
            if (result != null) return result
            try { child.recycle() } catch (_: Exception) {}
        }
        return null
    }

    /** Search children of a URL bar container for text that looks like a URL */
    private fun findTextInChildren(node: AccessibilityNodeInfo, depth: Int = 0, maxDepth: Int = 3): String? {
        if (depth > maxDepth) return null
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val text = child.text?.toString()?.trim()
                ?: child.contentDescription?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && looksLikeUrl(text)) {
                return text
            }
            val deeper = findTextInChildren(child, depth + 1, maxDepth)
            if (deeper != null) return deeper
            try { child.recycle() } catch (_: Exception) {}
        }
        return null
    }

    private fun looksLikeUrl(text: String): Boolean {
        if (text.contains("://")) return true
        if (text.contains(" ")) return false
        // Looks like a domain: has a dot, no spaces, reasonable length
        return text.contains(".") && text.length in 4..200
    }
}
