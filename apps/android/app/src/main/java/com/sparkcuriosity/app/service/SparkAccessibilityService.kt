package com.sparkcuriosity.app.service

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.sparkcuriosity.app.BuildConfig
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.Command
import com.sparkcuriosity.app.data.model.EventIngest
import com.sparkcuriosity.app.data.model.SignalBundle
import com.sparkcuriosity.app.util.DebugHttpServer
import com.sparkcuriosity.app.util.DebugState
import com.sparkcuriosity.app.util.SparkApiStats
import com.sparkcuriosity.app.util.PlatformDetector
import com.sparkcuriosity.app.util.UsageStatsHelper
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

        /** Apps for which we attempt rich title extraction from the accessibility tree. */
        private val CONTENT_APP_PACKAGES = setOf(
            "com.google.android.youtube",
            "com.zhiliaoapp.musically",
            "com.ss.android.ugc.trill",
            "com.instagram.android",
            "com.instagram.barcelona", // Threads
            "com.twitter.android",
            "com.reddit.frontpage",
            "com.netflix.mediaclient",
            "com.facebook.katana",
            "com.snapchat.android",
            "com.linkedin.android",
            "com.pinterest",
            "tv.twitch.android.app",
        )

        /**
         * Browser/native `platform` ids that get the longer post-block cooldown on Android
         * (same formula as known drift native apps in [CONTENT_APP_PACKAGES]).
         */
        private val EXTENDED_SOCIAL_COOLDOWN_PLATFORMS = setOf(
            "youtube", "x", "tiktok", "instagram", "threads", "reddit", "facebook",
            "snapchat", "linkedin", "pinterest", "twitch",
        )

        /**
         * Generic single-word app names that are NOT meaningful content titles.
         * These come from event.text or shallow toolbar nodes and should be filtered out.
         */
        private val GENERIC_APP_NAMES = setOf(
            "YouTube", "Instagram", "TikTok", "Twitter", "X", "Reddit",
            "Facebook", "Snapchat", "Netflix", "Home", "Startseite", "Search",
            "Suche", "Explore", "Reels", "Shorts", "Feed", "Notifications",
            "Benachrichtigungen", "Messages", "Nachrichten", "Profile", "Profil",
        )

        /**
         * Package-specific resource ID substrings that identify actual content title nodes.
         * Listed in priority order — first match wins.
         */
        private val TITLE_IDS_BY_PACKAGE = mapOf(
            "com.google.android.youtube" to listOf(
                "video_title", "player_video_title", "title_text_view",
                "watch_title", "title_anchor", "expandable_header_title", "title"
            ),
            "com.zhiliaoapp.musically" to listOf(
                "caption_content", "caption_tv", "title_tv", "author_name", "title"
            ),
            "com.ss.android.ugc.trill" to listOf(
                "caption_content", "caption_tv", "title_tv", "author_name", "title"
            ),
            "com.instagram.android" to listOf(
                "caption_text_view", "media_caption_text", "title", "username"
            ),
            "com.twitter.android" to listOf(
                "tweet_text", "card_name", "card_title", "title"
            ),
            "com.reddit.frontpage" to listOf(
                "post_title", "title", "link_title_text"
            ),
            "com.facebook.katana" to listOf(
                "story_title", "message_text", "title"
            ),
            "com.netflix.mediaclient" to listOf(
                "video_title", "title", "content_title"
            ),
            "com.snapchat.android" to listOf(
                "title", "caption_text_view"
            ),
        )
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var api: SparkApi? = null
    private val debugServer = if (BuildConfig.DEBUG) DebugHttpServer(applicationContext) else null

    // State — marked volatile because accessed from main thread (onAccessibilityEvent)
    // and IO coroutines (sendEvent, urlPolling)
    @Volatile private var currentPackage: String = ""
    @Volatile private var currentUrl: String = ""
    @Volatile private var currentTitle: String = ""
    @Volatile private var currentContentMode: String = "other"
    @Volatile private var sessionStart: Long = 0
    @Volatile private var lastSentUrl: String = ""
    @Volatile private var lastEventSentAt: Long = 0
    private var pendingEventJob: Job? = null
    private var nextCheckJob: Job? = null
    private var urlPollJob: Job? = null   // polls rootInActiveWindow until a URL is found

    // Scroll tracking (#7)
    @Volatile private var scrollCount: Int = 0

    // Redirect-return tracking (#8)
    @Volatile private var lastRedirectedUrl: String = ""
    @Volatile private var lastRedirectTime: Long = 0

    // Debounce: wait before scheduling a network decision (aligned with desktop ~4–5s “still there?” idea).
    // Cached bad-site blocks bypass this — see [scheduleEvent].
    private val debounceMs = 5000L
    // Minimum interval between API calls for the same URL — 30 s to avoid flooding
    private val sameUrlCooldownMs = 30_000L
    // Blocked URLs get a shorter cooldown so persistent users can't immediately swipe back
    private val blockedUrlCooldownMs = 2_000L
    // Per-key: timestamp after which a new API call is allowed (set from server's nextCheckSeconds)
    private val nextAllowedSendAt = LinkedHashMap<String, Long>(32, 0.75f, true)

    // ── Local decision cache (mirrors companion's in-memory cache) ──
    // Bounded to 200 entries — expired entries cleaned on every sendEvent
    private data class CachedDecision(
        val wasBlocked: Boolean,
        val expiresAt: Long
    )
    private val decisionCache = LinkedHashMap<String, CachedDecision>(32, 0.75f, true)
    private val maxCacheSize = 200

    // ── Cooldown block: after AI redirect, instantly block the same app/site for N minutes ──
    // Key = package name (native apps) or hostname (browser URLs). Value = expiry timestamp.
    private val cooldownBlocks = LinkedHashMap<String, Long>(16, 0.75f, true)
    private val maxCooldownSize = 100
    // Fallback cooldown for cache-hit re-blocks (AI-set duration used for first block)
    private val fallbackCooldownMs = 20 * 60 * 1000L

    // ── Post-block suppression window ──
    // After we perform GLOBAL_ACTION_HOME, the launcher/systemui comes to the foreground and
    // often the user immediately taps back. To avoid a visible flicker loop, we:
    //  (a) silently ignore repeat blocks of the SAME key within 2s (no second HOME)
    //  (b) ignore launcher/systemui TYPE_WINDOW_STATE_CHANGED for 2s after a block
    @Volatile private var lastBlockedKey: String = ""
    @Volatile private var lastBlockedAt: Long = 0
    private val postBlockSuppressMs = 2_000L
    private val LAUNCHER_PACKAGES = setOf(
        "com.android.launcher3",
        "com.motorola.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.sec.android.app.launcher",
        "com.android.systemui"
    )

    private var memoryRepo: com.sparkcuriosity.app.data.repo.MemoryRepository? = null

    /**
     * Why this API call is being made. **User-initiated** paths are
     * [APP_FOREGROUND], [BROWSER_URL_CHANGE], [NATIVE_MODE_OR_CONTENT].  
     * **Follow-ups** are [NATIVE_TITLE_RETRY] (one-shot late title on YouTube, etc.) and
     * [SERVER_FOLLOWUP] ([nextCheckSeconds] re-check) — if we ever dropped these, we would
     * miss late titles and time-based / drift rules the server still cares about.  
     * This is *classification + observability*, not a long domain allowlist.
     */
    private enum class SendTrigger {
        APP_FOREGROUND,
        BROWSER_URL_CHANGE,
        NATIVE_MODE_OR_CONTENT,
        NATIVE_TITLE_RETRY,
        SERVER_FOLLOWUP,
    }

    private fun normalizeUrlForCompare(url: String): String {
        if (url.isEmpty() || url.startsWith("app://")) return url
        return try {
            val u = java.net.URI(if (url.contains("://")) url else "https://$url")
            val host = (u.host ?: "").lowercase()
            val path = (u.path ?: "").trimEnd('/')
            "${u.scheme}://$host$path"
        } catch (_: Exception) {
            url.lowercase().trim()
        }
    }

    private fun isLocalLoopbackUrl(url: String): Boolean {
        if (url.startsWith("app://")) return false
        return try {
            val raw = if (url.contains("://")) url else "https://$url"
            val h = java.net.URI(raw).host?.lowercase() ?: return false
            h == "127.0.0.1" || h == "localhost" || h.endsWith(".localhost")
        } catch (_: Exception) {
            false
        }
    }

    private fun isChromiumOmniboxStrictExtraction(packageName: String): Boolean {
        return packageName == "com.android.chrome" || packageName == "org.chromium.chrome"
    }

    private fun isSameBrowserUrl(a: String, b: String): Boolean {
        return normalizeUrlForCompare(a) == normalizeUrlForCompare(b)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "AccessibilityService connected")

        // Re-apply service info programmatically to ensure events flow after APK updates
        val info = serviceInfo
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_SCROLLED
        info.feedbackType = android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        info.notificationTimeout = 300
        serviceInfo = info
        Log.d(TAG, "ServiceInfo re-applied: eventTypes=${info.eventTypes}")
        debugServer?.start()
        DebugState.log("AccessibilityService connected")

        val app = application as SparkApp
        api = SparkApi(tokenProvider = { app.tokenRepository.getToken() })
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

                // Post-block suppression: after a HOME action, the launcher/systemui
                // shows up briefly. Don't treat that as a fresh "APP change".
                val sinceBlock = System.currentTimeMillis() - lastBlockedAt
                if (sinceBlock < postBlockSuppressMs && pkg in LAUNCHER_PACKAGES) {
                    return
                }

                // For browsers: try URL extraction on every state-change (incl. same-package),
                // because WebView fires TYPE_WINDOW_STATE_CHANGED when a page finishes loading.
                if (PlatformDetector.BROWSER_PACKAGES.contains(pkg)) {
                    val root = try { rootInActiveWindow } catch (_: Exception) { null }
                    val url = extractUrlFromNode(root, pkg)
                    if (url != null && !isSameBrowserUrl(url, currentUrl)) {
                        Log.d(TAG, "URL from state-changed root: $url")
                        onBrowserNavigated(pkg, url)
                        return
                    }
                    // No URL found — fall through to onAppChanged only if it's a new package
                    if (pkg == currentPackage) return
                } else {
                    if (pkg == currentPackage) {
                        // For content apps: detect in-app activity change (e.g. Home→Shorts→Video)
                        if (CONTENT_APP_PACKAGES.contains(pkg)) {
                            val activityClass = event.className?.toString() ?: ""
                            val newMode = PlatformDetector.contentModeFromActivity(pkg, activityClass)

                            if (newMode != null && newMode != currentContentMode) {
                                // Mode changed (e.g. entered Shorts) — reset session and resend
                                currentContentMode = newMode
                                currentUrl = PlatformDetector.appUrlWithMode(pkg, newMode)
                                currentTitle = ""
                                sessionStart = System.currentTimeMillis()
                                scrollCount = 0
                                DebugState.currentUrl = currentUrl
                                DebugState.log("MODE-CHANGE  $newMode  url=$currentUrl")
                                // Trigger tree scan for new title in this mode
                                scope.launch {
                                    delay(600L)
                                    if (currentPackage != pkg) return@launch
                                    val richTitle = extractNativeAppTitle(pkg)
                                    if (!richTitle.isNullOrBlank()) {
                                        currentTitle = richTitle
                                        DebugState.log("TITLE-TREE  $richTitle")
                                    }
                                    scheduleEvent(SendTrigger.NATIVE_MODE_OR_CONTENT)
                                }
                                return
                            }

                            // Same mode but title may have changed (e.g. next Shorts video)
                            val newTitle = event.text?.joinToString(" ")?.trim() ?: ""
                            if (newTitle.isNotEmpty()
                                && newTitle != currentTitle
                                && !looksLikeUrl(newTitle)
                                && !GENERIC_APP_NAMES.contains(newTitle)
                                && newTitle.length >= 8) {
                                currentTitle = newTitle
                                DebugState.log("TITLE-CHANGE  $newTitle")
                                scheduleEvent(SendTrigger.NATIVE_MODE_OR_CONTENT)
                            }
                        }
                        return
                    }
                }

                val rawTitle = event.text?.joinToString(" ")?.trim() ?: ""
                val title = if (GENERIC_APP_NAMES.contains(rawTitle)) "" else rawTitle
                val activityClass = event.className?.toString() ?: ""
                onAppChanged(pkg, title, activityClass)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val pkg = event.packageName?.toString() ?: return
                if (!PlatformDetector.BROWSER_PACKAGES.contains(pkg)) return

                // Try to extract URL from browser address bar (event source or root)
                var url = extractUrlFromNode(event.source, pkg)
                if (url == null) {
                    val root = try { rootInActiveWindow } catch (_: Exception) { null }
                    url = extractUrlFromNode(root, pkg)
                }
                if (url == null) return
                if (isSameBrowserUrl(url, currentUrl)) return
                Log.d(TAG, "URL from content-changed: $url")
                onBrowserNavigated(pkg, url)
            }
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                // Firefox Fenix Compose: fires when user finishes typing a URL or page navigates.
                // The source node contains the new text in its text field.
                val pkg = event.packageName?.toString() ?: return
                if (!PlatformDetector.BROWSER_PACKAGES.contains(pkg)) return
                val text = event.text?.firstOrNull()?.toString()?.trim() ?: return
                if (!looksLikeUrl(text)) return
                val url = if (text.contains("://")) text else "https://$text"
                if (isSameBrowserUrl(url, currentUrl)) return
                Log.d(TAG, "URL from text-changed ($pkg): $url")
                onBrowserNavigated(pkg, url)
            }
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> {
                scrollCount++
            }
        }
    }

    override fun onInterrupt() {
        urlPollJob?.cancel()
        debugServer?.stop()
        scope.cancel()
    }

    override fun onDestroy() {
        super.onDestroy()
        urlPollJob?.cancel()
        debugServer?.stop()
        scope.cancel()
    }

    private fun onAppChanged(packageName: String, title: String, activityClass: String = "") {
        // If user switches app within [debounceMs] of a prior onAppChanged, a pending
        // [APP_FOREGROUND] / NATIVE coroutine would still run after state was already
        // updated to the *new* app (e.g. Chrome) — the log would show wrong trigger+URL
        // (e.g. APP_FOREGROUND + app://com.android.chrome). Always cancel.
        pendingEventJob?.cancel()
        Log.d(TAG, "App changed: $packageName title='$title' activity='$activityClass'")
        currentPackage = packageName
        currentTitle = title
        // Infer initial content mode from activity class if available
        val initialMode = if (activityClass.isNotEmpty())
            PlatformDetector.contentModeFromActivity(packageName, activityClass) ?: "other"
        else "other"
        currentContentMode = initialMode
        currentUrl = PlatformDetector.appUrlWithMode(packageName, initialMode)
        sessionStart = System.currentTimeMillis()
        scrollCount = 0
        DebugState.currentUrl = currentUrl
        DebugState.currentPlatform = PlatformDetector.fromPackage(packageName)
        DebugState.log("APP  $packageName${if (initialMode != "other") "  mode=$initialMode" else ""}")

        // ── Cooldown block: instant HOME if this app was recently redirected ──
        if (checkCooldownBlock(packageName)) return

        // For browsers: poll rootInActiveWindow until we find the real URL.
        // The URL bar is often empty at the moment of the switch (page still loading).
        if (PlatformDetector.BROWSER_PACKAGES.contains(packageName)) {
            startUrlPolling(packageName)
        } else {
            urlPollJob?.cancel()
            // For known content apps: try to extract a meaningful title from the a11y tree
            if (CONTENT_APP_PACKAGES.contains(packageName)) {
                scope.launch {
                    delay(600L) // let the UI settle before traversing
                    if (currentPackage != packageName) return@launch
                    val richTitle = extractNativeAppTitle(packageName)
                    if (!richTitle.isNullOrBlank() && richTitle != currentTitle) {
                        currentTitle = richTitle
                        DebugState.log("TITLE-TREE  $richTitle")
                    }
                    scheduleEvent(SendTrigger.NATIVE_MODE_OR_CONTENT)
                }
            } else {
                scheduleEvent(SendTrigger.APP_FOREGROUND)
            }
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
                val url = extractUrlFromNode(root, pkg)
                if (url != null && !isSameBrowserUrl(url, currentUrl)) {
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
        // Same as [onAppChanged]: pending debounced [APP_FOREGROUND] from a non-browser
        // app must not fire after we have moved to a real browser [currentUrl].
        pendingEventJob?.cancel()
        Log.d(TAG, "Browser navigated: $url (pkg=$packageName)")
        if (packageName == currentPackage && isSameBrowserUrl(url, currentUrl)) {
            return
        }
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

        if (isLocalLoopbackUrl(url)) {
            nextCheckJob?.cancel()
            DebugState.log("LOCAL-DEV-URL  kein API-Send: $url")
            return
        }

        scheduleEvent(SendTrigger.BROWSER_URL_CHANGE)
    }

    /**
     * Checks if a package/host is in cooldown. If so, instantly sends HOME and returns true.
     * Cleans up expired entries opportunistically.
     */
    private fun checkCooldownBlock(key: String): Boolean {
        val kl = key.lowercase()
        if (kl == "127.0.0.1" || kl == "localhost" || kl.endsWith(".localhost")) return false
        val now = System.currentTimeMillis()
        // Cleanup expired entries and enforce size limit
        cooldownBlocks.entries.removeIf { now > it.value }
        while (cooldownBlocks.size > maxCooldownSize) {
            cooldownBlocks.remove(cooldownBlocks.keys.first())
        }
        val expiresAt = cooldownBlocks[key] ?: return false
        if (now >= expiresAt) {
            cooldownBlocks.remove(key)
            return false
        }
        val remainingSec = (expiresAt - now) / 1000
        Log.d(TAG, "Cooldown block: $key blocked for ${remainingSec}s more")

        DebugState.log("COOLDOWN-BLOCK $key (${remainingSec}s verbleibend)")
        performGlobalAction(GLOBAL_ACTION_HOME)
        lastBlockedKey = key
        lastBlockedAt = now
        val urlParam = if (currentUrl.isNotEmpty()) {
            currentUrl
        } else {
            "app://$key"
        }
        presentPondonAfterHome(
            Command(
                type = "close_tab",
                url = urlParam,
                closeTab = true,
                reason = "cooldown_block"
            )
        )
        return true
    }

    /**
     * Pondon ([MainActivity] black screen) must open **after** [GLOBAL_ACTION_HOME], otherwise
     * the launcher stays on top and the user never sees the screen. [OverlayService] starts
     * [MainActivity] on a short main-thread delay; see also [MainActivity.setIntent] for relaunch.
     */
    private fun presentPondonAfterHome(cmd: Command) {
        scope.launch(Dispatchers.Main.immediate) {
            delay(200L)
            OverlayService.handleCommand(cmd)
        }
    }

    /** Adds a package or hostname to the cooldown block map. */
    private fun addCooldownBlock(key: String, durationMs: Long = fallbackCooldownMs) {
        val expiresAt = System.currentTimeMillis() + durationMs
        cooldownBlocks[key] = expiresAt
        DebugState.log("COOLDOWN-SET $key für ${durationMs / 1000}s")
    }

    /**
     * Local cache hit for a still-active “was blocked” decision → run immediately (no debounce).
     * Cooldown-block HOME is already handled synchronously in [onAppChanged] / [onBrowserNavigated].
     */
    private fun shouldInstantCacheBlockNow(): Boolean {
        val url = currentUrl
        if (isLocalLoopbackUrl(url)) return false
        val key = cacheKey(url)
        val isLoopbackKey = key == "127.0.0.1" || key == "localhost" || key.endsWith(".localhost")
        val cached = decisionCache[key] ?: return false
        val now = System.currentTimeMillis()
        return !isLoopbackKey && now < cached.expiresAt && cached.wasBlocked
    }

    private fun scheduleEvent(trigger: SendTrigger) {
        pendingEventJob?.cancel()
        val t = trigger
        if (shouldInstantCacheBlockNow()) {
            pendingEventJob = scope.launch {
                sendEvent(t)
            }
            return
        }
        pendingEventJob = scope.launch {
            delay(debounceMs)
            sendEvent(t)
        }
    }

    private fun cacheKey(url: String): String {
        // For native apps: block/cache by package name regardless of mode suffix
        if (url.startsWith("app://")) {
            return url.removePrefix("app://").substringBefore("/")
        }
        // For browser URLs: cache by hostname
        return try {
            java.net.URI(url).host ?: url
        } catch (_: Exception) {
            url
        }
    }

    private suspend fun sendEvent(sendTrigger: SendTrigger) {
        val now = System.currentTimeMillis()
        val urlAtSendTime = currentUrl
        val pkgAtSendTime = currentPackage  // capture now — currentPackage may change during AI call
        val key = cacheKey(urlAtSendTime)
        DebugState.lastSendTrigger = sendTrigger.name

        if (isLocalLoopbackUrl(urlAtSendTime)) {
            nextCheckJob?.cancel()
            return
        }

        val compareCurrent =
            if (urlAtSendTime.startsWith("app://")) urlAtSendTime else normalizeUrlForCompare(urlAtSendTime)
        val compareLast =
            if (lastSentUrl.isEmpty()) "" else
                (if (lastSentUrl.startsWith("app://")) lastSentUrl else normalizeUrlForCompare(lastSentUrl))

        // ── Check local cache first — instant block without network roundtrip ──
        val cached = decisionCache[key]
        val isLoopbackKey = key == "127.0.0.1" || key == "localhost" || key.endsWith(".localhost")
        if (cached != null && !isLoopbackKey && now < cached.expiresAt && cached.wasBlocked) {
            Log.d(TAG, "Cache hit: blocking $key instantly")
            SparkApiStats.recordCacheBlock(applicationContext)
            DebugState.logApi("⚡ CACHE-BLOCK  $key  (lokaler Cache, kein API-Call)")
            performGlobalAction(GLOBAL_ACTION_HOME)
            lastBlockedKey = key
            lastBlockedAt = now
            presentPondonAfterHome(
                Command(
                    type = "close_tab",
                    url = if (urlAtSendTime.startsWith("app://")) urlAtSendTime else null,
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

        // Same “content key” (full app:// URL incl. mode, or normalized browser URL): Tier-2 signals
        // (e.g. native title tweaks) must not bypass the server’s next-check window — only a real
        // context change (compareCurrent != compareLast, e.g. new host or app mode) can.
        val cooldown = if (cached?.wasBlocked == true) blockedUrlCooldownMs else sameUrlCooldownMs
        if (compareCurrent == compareLast && now - lastEventSentAt < cooldown) {
            SparkApiStats.recordSkipLocalCooldown(applicationContext)
            DebugState.log("SKIP  dedupe local cooldown  trigger=$sendTrigger  key=$key  Δ=${now - lastEventSentAt}ms")
            return
        }
        val serverAllowedAt = nextAllowedSendAt[key] ?: 0L
        if (compareCurrent == compareLast && now < serverAllowedAt) {
            SparkApiStats.recordSkipNextCheck(applicationContext)
            DebugState.log("SKIP  dedupe nextCheck window  trigger=$sendTrigger  key=$key  untilIn=${serverAllowedAt - now}ms")
            return
        }

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

        // ── Collect rich client-side signals for the agent ──
        val mediaPermGranted = SparkMediaListenerService.isConnected
        val usagePermGranted = UsageStatsHelper.hasPermission(applicationContext)
        DebugState.mediaPermission = if (mediaPermGranted) "OK" else "fehlt (Einstellungen → Benachrichtigungszugriff)"
        DebugState.usagePermission = if (usagePermGranted) "OK" else "fehlt (Einstellungen → Nutzungszugriff)"

        val media = try {
            SparkMediaListenerService.readActiveMediaSignal(applicationContext, pkgAtSendTime)
        } catch (_: Exception) { null }
        val usage = try {
            if (urlAtSendTime.startsWith("app://")) {
                UsageStatsHelper.snapshotForPackage(applicationContext, pkgAtSendTime)
            } else null
        } catch (_: Exception) { null }

        // Hosts bewusst NICHT mehr in signals gepackt — Nick: unnoetiger Noise fuer den Agent.
        val signals: SignalBundle? = if (media != null || usage != null) {
            SignalBundle(media = media, usage = usage, recentHosts = null)
        } else null

        // Mirror collected signals into DebugState for the Android debug HTML (http://localhost:4567).
        // When signal is null, surface WHY (permission missing vs no active session) so the user can act.
        DebugState.currentMedia = when {
            media != null -> buildString {
                media.pkg?.let { append(it) }
                media.title?.let { append(" · titel=\"${it.take(60)}\"") }
                media.artist?.let { append(" · artist=\"$it\"") }
                media.state?.let { append(" · state=$it") }
            }.ifEmpty { "—" }
            !mediaPermGranted -> "⚠ Permission fehlt (Benachrichtigungszugriff)"
            else -> "keine aktive Session"
        }
        DebugState.currentUsage = when {
            usage != null -> "heute=${(usage.todaySeconds ?: 0) / 60}m · 1h=${(usage.last1hSeconds ?: 0) / 60}m · starts=${usage.launchesToday ?: 0}"
            !urlAtSendTime.startsWith("app://") -> "— (nur bei Native-Apps)"
            !usagePermGranted -> "⚠ Permission fehlt (Nutzungszugriff)"
            else -> "—"
        }
        DebugState.currentRecentHosts = "—"

        // Last-chance a11y tree scan for a proper title if we still have nothing.
        // This runs even if the app-change tree scan already failed — YouTube/X often
        // mount the title view lazily, so a re-scan right before send catches it.
        val treeTitleLate: String? = if (currentTitle.isEmpty()
            && CONTENT_APP_PACKAGES.contains(pkgAtSendTime)) {
            try { extractNativeAppTitle(pkgAtSendTime) } catch (_: Exception) { null }
        } else null
        if (!treeTitleLate.isNullOrBlank()) {
            currentTitle = treeTitleLate
            DebugState.log("TITLE-TREE-LATE  $treeTitleLate")
        }

        // Priority: Media-Titel (gleiches Paket) = echter Video-/Track-Titel; dann A11y-Baum.
        val mt = media?.title?.trim()?.takeIf { it.isNotEmpty() }
        val titleToSend: String = when {
            mt != null && media?.pkg == pkgAtSendTime -> mt
            currentTitle.isNotEmpty() -> currentTitle
            mt != null -> mt
            else -> ""
        }

        val event = EventIngest(
            timestamp = Instant.now().toString(),
            platform = platform,
            // Use tracked contentMode directly (covers native app modes like Shorts)
            // For browser URLs, derive from URL path as before
            contentMode = if (currentUrl.startsWith("app://"))
                              currentContentMode
                          else PlatformDetector.contentModeFromUrl(currentUrl),
            url = currentUrl,
            title = titleToSend,
            sessionSeconds = sessionSeconds,
            scrollCount = scrollCount,
            returnedAfterRedirect = returnedAfterRedirect,
            redirectedFromUrl = if (returnedAfterRedirect) lastRedirectedUrl else null,
            sessionExceeded = sessionExceeded,
            maxSessionSeconds = maxSessionSeconds,
            memory = inline,
            signals = signals
        )

        try {
            Log.d(TAG, "Sending event: platform=$platform url=$urlAtSendTime session=${sessionSeconds}s exceeded=$sessionExceeded")

            // Full SEND payload block — exactly what the agent will see.
            val sendLines = mutableListOf<String>()
            sendLines += "→ SEND  trigger=$sendTrigger  platform=$platform  mode=${event.contentMode}"
            sendLines += "   url=$urlAtSendTime"
            sendLines += "   title=${if (titleToSend.isNullOrEmpty()) "(leer)" else "\"${titleToSend.take(80)}\""}"
            sendLines += "   session=${sessionSeconds}s  scroll=$scrollCount" +
                (if (returnedAfterRedirect) "  returnedAfterRedirect=true" else "") +
                (if (sessionExceeded) "  sessionExceeded(${maxSessionSeconds}s)" else "")
            if (media != null) {
                sendLines += "   media: pkg=${media.pkg ?: "?"}  title=\"${(media.title ?: "").take(60)}\"" +
                    (media.artist?.let { "  artist=\"$it\"" } ?: "") +
                    (media.state?.let { "  state=$it" } ?: "")
            } else {
                sendLines += "   media: — (${if (mediaPermGranted) "keine Session" else "Permission fehlt"})"
            }
            if (usage != null) {
                sendLines += "   usage: today=${(usage.todaySeconds ?: 0) / 60}m  1h=${(usage.last1hSeconds ?: 0) / 60}m  starts=${usage.launchesToday ?: 0}"
            } else if (urlAtSendTime.startsWith("app://")) {
                sendLines += "   usage: — (${if (usagePermGranted) "keine Daten" else "Permission fehlt"})"
            }
            sendLines += "   inline_memory=${inline?.body?.length ?: 0} chars"
            DebugState.logApi(sendLines.joinToString("\n"))
            DebugState.lastSentAt = "$platform  $urlAtSendTime"

            val apiClient = api ?: return
            SparkApiStats.recordApiSend(applicationContext)
            val apiStartMs = System.currentTimeMillis()
            val response = apiClient.sendEvent(event)
            val latencyMs = System.currentTimeMillis() - apiStartMs
            val cmdTypes = response.commands?.map { it.type } ?: emptyList()
            Log.d(TAG, "Response: commands=$cmdTypes nextCheck=${response.nextCheckSeconds} reason=${response.reason}")
            DebugState.lastReason = response.reason ?: "—"
            DebugState.lastCommands = if (cmdTypes.isEmpty()) "none" else cmdTypes.joinToString()

            val respLines = mutableListOf<String>()
            respLines += "← RESP  (${latencyMs}ms)  commands=${DebugState.lastCommands}  nextCheck=${response.nextCheckSeconds}s"
            response.commands?.forEach { cmd ->
                when (cmd.type) {
                    "close_tab" -> respLines += "    close_tab${cmd.reason?.let { " ($it)" } ?: ""}"
                    "redirect" -> respLines += "    close_tab (legacy)${cmd.url?.let { " $it" } ?: ""}"
                    "quote" -> respLines += "    quote: ${cmd.text?.take(80)}"
                    "prompt" -> respLines += "    prompt: ${cmd.question?.take(80)}"
                }
            }
            respLines += "    reason: ${response.reason?.take(200) ?: "—"}"
            response.updatedMemoryBody?.let { body -> respLines += "    [memory updated, ${body.length} chars]" }
            DebugState.logApi(respLines.joinToString("\n"))

            // Persist any memory mutations the AI made
            response.updatedMemoryBody?.let { newBody ->
                try { memoryRepo?.savePlaintext(newBody, snapshot?.onboardingComplete ?: false) } catch (_: Exception) {}
            }
            lastEventSentAt = now
            lastSentUrl = urlAtSendTime

            // ── Update local cache ──
            val hasBlockingCommand = response.commands?.any {
                it.type == "close_tab" || it.type == "redirect"
            } == true
            val nextSec = response.nextCheckSeconds ?: 1200
            decisionCache[key] = CachedDecision(
                wasBlocked = hasBlockingCommand,
                expiresAt = now + (nextSec * 5 * 1000L)
            )
            decisionCache.entries.removeIf { now > it.value.expiresAt }
            // Enforce size limit — remove oldest entries (LinkedHashMap access order)
            while (decisionCache.size > maxCacheSize) {
                decisionCache.remove(decisionCache.keys.first())
            }

            // Process commands
            response.commands?.forEach { cmd ->
                when (cmd.type) {
                    "close_tab", "redirect" -> {
                        lastRedirectedUrl = urlAtSendTime
                        lastRedirectTime = now
                        Log.d(TAG, "Executing ${cmd.type} (block)")
                        DebugState.log("BLOCK ${cmd.type} reason=${cmd.reason}")
                        val blockCmd = when {
                            cmd.type == "close_tab" && cmd.url.isNullOrBlank() && urlAtSendTime.startsWith("app://") ->
                                cmd.copy(url = urlAtSendTime)
                            else -> cmd
                        }
                        // Leave distracting app first, then show Pondon — startActivity *before* HOME
                        // would leave the launcher on top and the user would never see the black screen.
                        performGlobalAction(GLOBAL_ACTION_HOME)
                        lastBlockedKey = key
                        lastBlockedAt = now
                        presentPondonAfterHome(blockCmd)
                        // Social/Drift: laengere lokale Sperre (Mindestzeit + Faktor auf AI-nextCheck).
                        val socialDrift = CONTENT_APP_PACKAGES.contains(pkgAtSendTime)
                            || platform.lowercase() in EXTENDED_SOCIAL_COOLDOWN_PLATFORMS
                        val baseMinMs = if (socialDrift) 5 * 60 * 1000L else 2 * 60 * 1000L
                        val mult = if (socialDrift) 2L else 1L
                        val aiMs = (response.nextCheckSeconds ?: 1200) * 1000L
                        val cooldownMs = minOf(45 * 60 * 1000L, maxOf(baseMinMs, aiMs * mult))
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

            // ── Title-refresh retry: if we sent with an empty title on a content app,
            //    schedule a one-shot retry after [debounceMs] (same wait as [scheduleEvent]).
            //    [nextAllowedSendAt] is slightly shorter than the delay so a slightly early
            //    wakeup cannot hit SKIP nextCheck.
            val shouldRetryForTitle = titleToSend.isEmpty()
                && CONTENT_APP_PACKAGES.contains(pkgAtSendTime)
                && !hasBlockingCommand
            if (shouldRetryForTitle) {
                val retryGateMs = (debounceMs - 1000L).coerceAtLeast(500L)
                nextAllowedSendAt[key] = now + retryGateMs
                lastEventSentAt = now - sameUrlCooldownMs + debounceMs
                nextCheckJob?.cancel()
                nextCheckJob = scope.launch {
                    delay(debounceMs)
                    if (currentPackage != pkgAtSendTime) return@launch
                    sendEvent(SendTrigger.NATIVE_TITLE_RETRY)
                }
            } else {
                // Schedule next check if specified — cancel previous to avoid stacking jobs
                response.nextCheckSeconds?.let { seconds ->
                    nextAllowedSendAt[key] = now + (seconds * 1000L)
                    if (nextAllowedSendAt.size > 200) nextAllowedSendAt.remove(nextAllowedSendAt.keys.first())
                    nextCheckJob?.cancel()
                    nextCheckJob = scope.launch {
                        delay(seconds * 1000L)
                        sendEvent(SendTrigger.SERVER_FOLLOWUP)
                    }
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
    private fun extractUrlFromNode(node: AccessibilityNodeInfo?, browserPkg: String? = null): String? {
        if (node == null) return null
        val pkg = browserPkg ?: (node.packageName?.toString() ?: "")
        val strict = isChromiumOmniboxStrictExtraction(pkg)
        return try {
            // Primary: tree traversal (works for Chrome, Brave, Samsung etc.)
            val urlText = findUrlText(node, depth = 0, inWebView = false, strictToolbarOnly = strict)
            if (urlText != null) {
                val full = if (urlText.contains("://")) urlText
                else if (urlText.contains(".") && !urlText.contains(" ")) "https://$urlText"
                else null
                if (full != null) return full
            }
            // Chrome/Chromium: do not fall back to "any URL-like text" — it often matches page links
            // and causes rapid duplicate sends + wrong host vs omnibox.
            if (strict) return null
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
    private fun findUrlText(
        node: AccessibilityNodeInfo,
        depth: Int = 0,
        inWebView: Boolean = false,
        strictToolbarOnly: Boolean = false
    ): String? {
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

        if (!strictToolbarOnly) {
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
            if (!nowInWebView && depth in 2..8 && text.isNotEmpty() && looksLikeUrl(text)) {
                return text
            }
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findUrlText(child, depth + 1, nowInWebView, strictToolbarOnly)
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

    /**
     * For known content apps (YouTube, TikTok, Instagram etc.), traverses the accessibility
     * tree and returns the most prominent content title (video title, post title, etc.).
     * Returns null if nothing meaningful is found or the traversal fails.
     */
    private fun extractNativeAppTitle(pkg: String): String? {
        if (!CONTENT_APP_PACKAGES.contains(pkg)) return null
        val root = try { rootInActiveWindow } catch (_: Exception) { return null } ?: return null
        return try {
            findContentTitle(root, pkg)
        } finally {
            try { root.recycle() } catch (_: Exception) {}
        }
    }

    /** Returns true if the text is a generic app name or otherwise not meaningful as a title. */
    private fun isGenericTitle(text: String): Boolean {
        if (text.length < 8) return true
        if (GENERIC_APP_NAMES.contains(text)) return true
        // Single word with no spaces is likely a label/button, not a real content title
        // Exception: some video titles are single (long) words
        if (!text.contains(" ") && text.length < 20) return true
        return false
    }

    /**
     * BFS over the accessibility tree looking for title-like text nodes.
     *
     * Strategy (in priority order):
     * 1. Package-specific resource IDs (e.g. "video_title" for YouTube) — high confidence
     * 2. Generic "title"-like resource IDs across all apps
     * 3. First prominent TextView at mid-depth (fallback, filtered for generic names)
     *
     * Skips nodes deeper than 14 levels and nodes inside WebView subtrees.
     */
    private fun findContentTitle(root: AccessibilityNodeInfo, pkg: String = ""): String? {
        val pkgSpecificIds = TITLE_IDS_BY_PACKAGE[pkg] ?: emptyList()
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.add(root to 0)
        // Rich structured descriptions (contentDescription) are often the best signal for
        // modern Compose-based apps (no resource IDs). Keep a ranked candidate list.
        val descCandidates = mutableListOf<Pair<String, Int>>()
        val textCandidates = mutableListOf<Pair<String, Int>>()

        while (queue.isNotEmpty()) {
            val (node, depth) = queue.removeFirst()
            if (depth > 14) continue

            val resId = (node.viewIdResourceName ?: "").lowercase()
            val rawText = node.text?.toString()?.trim() ?: ""
            val rawDesc = node.contentDescription?.toString()?.trim() ?: ""
            val cls = node.className?.toString() ?: ""
            val inWebView = cls.contains("WebView")

            if (!inWebView) {
                // Priority 1: package-specific resource IDs — high confidence
                if (resId.isNotEmpty() && pkgSpecificIds.any { resId.contains(it) }) {
                    val pick = if (rawText.isNotEmpty() && !looksLikeUrl(rawText)) rawText
                              else if (rawDesc.isNotEmpty() && !looksLikeUrl(rawDesc)) rawDesc
                              else ""
                    if (pick.isNotEmpty() && !isGenericTitle(pick)) return pick
                }

                // Priority 2: any resource id containing "title" (not inside another id that
                // is clearly generic like "app_title" or "bar_title")
                if (resId.contains("title") && !resId.contains("app_title") && !resId.contains("bar_title")) {
                    val pick = if (rawText.isNotEmpty() && !looksLikeUrl(rawText)) rawText
                              else if (rawDesc.isNotEmpty() && !looksLikeUrl(rawDesc)) rawDesc
                              else ""
                    if (pick.isNotEmpty() && !isGenericTitle(pick)) return pick
                }

                // Priority 3: rich contentDescription (modern Compose apps).
                // A descriptive contentDescription on a clickable container often looks like
                // "Video: <title>, <duration>, by <channel>" — that's gold.
                if (rawDesc.length >= 15 && depth in 3..11 && !looksLikeUrl(rawDesc) && !isGenericTitle(rawDesc)) {
                    descCandidates.add(rawDesc to depth)
                }

                // Priority 4: long TextView text in mid/deep range
                // (YouTube watch-screen title is often at depth 10-14)
                if (cls.contains("TextView") && rawText.length >= 12 && depth in 3..14
                    && !looksLikeUrl(rawText) && !isGenericTitle(rawText)
                ) {
                    textCandidates.add(rawText to depth)
                }
            }

            // Don't recurse into WebView subtrees (content is web, not native titles)
            if (!inWebView) {
                for (i in 0 until node.childCount) {
                    val child = node.getChild(i) ?: continue
                    queue.add(child to depth + 1)
                }
            }
        }
        // Prefer a rich contentDescription if we have one (most descriptive).
        descCandidates.maxByOrNull { it.first.length }?.let { return it.first }
        return textCandidates.maxByOrNull { it.first.length }?.first
    }
}
