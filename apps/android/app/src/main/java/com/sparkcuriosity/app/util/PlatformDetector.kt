package com.sparkcuriosity.app.util

/**
 * Maps Android package names and browser URLs to Spark platform identifiers.
 */
object PlatformDetector {

    private val APP_PLATFORM_MAP = mapOf(
        "com.google.android.youtube" to "youtube",
        "com.zhiliaoapp.musically" to "tiktok",  // TikTok international
        "com.ss.android.ugc.trill" to "tiktok",  // TikTok regional
        "com.instagram.android" to "instagram",
        "com.instagram.barcelona" to "threads", // Threads (Meta)
        "com.twitter.android" to "x",
        "com.reddit.frontpage" to "reddit",
        "com.facebook.katana" to "facebook",
        "com.snapchat.android" to "snapchat",
        "com.linkedin.android" to "linkedin",
        "com.pinterest" to "pinterest",
        "tv.twitch.android.app" to "twitch",
    )

    private val URL_PLATFORM_MAP = listOf(
        "youtube.com" to "youtube",
        "youtu.be" to "youtube",
        "grok.com" to "grok",
        "x.ai" to "grok",
        "tiktok.com" to "tiktok",
        "instagram.com" to "instagram",
        "threads.net" to "threads",
        "x.com" to "x",
        "twitter.com" to "x",
        "reddit.com" to "reddit",
        "facebook.com" to "facebook",
        "snapchat.com" to "snapchat",
        "linkedin.com" to "linkedin",
        "pinterest.com" to "pinterest",
        "pinterest.de" to "pinterest",
        "twitch.tv" to "twitch",
    )

    fun fromPackage(packageName: String): String {
        return APP_PLATFORM_MAP[packageName] ?: "other"
    }

    fun fromUrl(url: String): String {
        val lower = url.lowercase()
        for ((domain, platform) in URL_PLATFORM_MAP) {
            if (lower.contains(domain)) return platform
        }
        return "other"
    }

    fun contentModeFromUrl(url: String): String {
        val lower = url.lowercase()
        if (lower.contains("/shorts")) return "shorts"
        if (lower.contains("/reels")) return "shorts"
        if (lower.contains("/feed") || lower.contains("/home") || lower.contains("/foryou")) return "feed"
        if (lower.contains("/search") || lower.contains("/results")) return "search"
        return "other"
    }

    /**
     * Infers content mode from an Android Activity class name (TYPE_WINDOW_STATE_CHANGED).
     * Activity class names reliably indicate which "section" of an app the user is in,
     * e.g. YouTube ShortsActivity vs. WatchWhileActivity vs. home feed.
     * Returns null if no specific mode can be determined (caller keeps current mode).
     */
    fun contentModeFromActivity(pkg: String, activityClass: String): String? {
        val cls = activityClass.lowercase()
        return when (pkg) {
            "com.google.android.youtube" -> when {
                cls.contains("shorts") -> "shorts"
                cls.contains("watch") || cls.contains("player") -> "video"
                cls.contains("home") || cls.contains("feed") || cls.contains("main") || cls.contains("shell") -> "feed"
                cls.contains("search") || cls.contains("results") -> "search"
                else -> null
            }
            "com.zhiliaoapp.musically",
            "com.ss.android.ugc.trill" -> "shorts"  // TikTok is always feed/shorts
            "com.instagram.android",
            "com.instagram.barcelona" -> when {
                cls.contains("reel") || cls.contains("igreel") -> "shorts"
                cls.contains("feed") || cls.contains("home") -> "feed"
                cls.contains("story") -> "shorts"
                else -> null
            }
            "com.twitter.android" -> when {
                cls.contains("home") || cls.contains("timeline") -> "feed"
                cls.contains("search") -> "search"
                else -> null
            }
            "com.reddit.frontpage" -> when {
                cls.contains("feed") || cls.contains("home") -> "feed"
                cls.contains("video") || cls.contains("shorts") -> "shorts"
                else -> null
            }
            "com.snapchat.android" -> when {
                cls.contains("spotlight") || cls.contains("story") -> "shorts"
                else -> null
            }
            "com.facebook.katana" -> when {
                cls.contains("feed") || cls.contains("home") -> "feed"
                cls.contains("reel") -> "shorts"
                else -> null
            }
            else -> null
        }
    }

    /**
     * Human-readable label for the content mode, used in the URL suffix so the AI
     * and curated gate can treat e.g. app://com.google.android.youtube/shorts like
     * a browser URL that contains "/shorts".
     */
    fun appUrlWithMode(pkg: String, contentMode: String?): String {
        return if (!contentMode.isNullOrEmpty() && contentMode != "other") {
            "app://$pkg/$contentMode"
        } else {
            "app://$pkg"
        }
    }

    /** Known browser packages — used to extract URL from address bar */
    val BROWSER_PACKAGES = setOf(
        "com.android.chrome",
        "org.mozilla.firefox",
        "com.brave.browser",
        "com.opera.browser",
        "com.microsoft.emmx",      // Edge
        "com.sec.android.app.sbrowser", // Samsung Internet
        "com.vivaldi.browser",
        "org.chromium.chrome",
    )
}
