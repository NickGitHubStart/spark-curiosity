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
        "com.twitter.android" to "x",
        "com.reddit.frontpage" to "reddit",
        "com.facebook.katana" to "facebook",
        "com.snapchat.android" to "snapchat",
    )

    private val URL_PLATFORM_MAP = listOf(
        "youtube.com" to "youtube",
        "youtu.be" to "youtube",
        "tiktok.com" to "tiktok",
        "instagram.com" to "instagram",
        "x.com" to "x",
        "twitter.com" to "x",
        "reddit.com" to "reddit",
        "facebook.com" to "facebook",
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
