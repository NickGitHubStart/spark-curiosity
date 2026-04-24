package com.sparkcuriosity.app.util

import android.content.Context
import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Persisted per-calendar-day counters for agent traffic (survives process restarts).
 * Used by the debug HTTP UI on port 4567.
 */
object SparkApiStats {
    private const val PREFS = "spark_api_stats"
    private const val KEY_DAY = "stats_day_yyyy_mm_dd"
    private const val KEY_API = "count_api_send"
    private const val KEY_CACHE = "count_cache_block"
    private const val KEY_SKIP_NEXT = "count_skip_nextcheck"
    private const val KEY_SKIP_COOLDOWN = "count_skip_local_cooldown"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun dayStamp(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

    /** Reset counters when the calendar day changes (local timezone). */
    private fun ensureCurrentDay(p: SharedPreferences) {
        val today = dayStamp()
        if (p.getString(KEY_DAY, null) != today) {
            p.edit()
                .putString(KEY_DAY, today)
                .putInt(KEY_API, 0)
                .putInt(KEY_CACHE, 0)
                .putInt(KEY_SKIP_NEXT, 0)
                .putInt(KEY_SKIP_COOLDOWN, 0)
                .apply()
        }
    }

    fun recordApiSend(ctx: Context) {
        val p = prefs(ctx)
        ensureCurrentDay(p)
        val p2 = prefs(ctx)
        p2.edit().putInt(KEY_API, p2.getInt(KEY_API, 0) + 1).apply()
    }

    fun recordCacheBlock(ctx: Context) {
        val p = prefs(ctx)
        ensureCurrentDay(p)
        val p2 = prefs(ctx)
        p2.edit().putInt(KEY_CACHE, p2.getInt(KEY_CACHE, 0) + 1).apply()
    }

    fun recordSkipNextCheck(ctx: Context) {
        val p = prefs(ctx)
        ensureCurrentDay(p)
        val p2 = prefs(ctx)
        p2.edit().putInt(KEY_SKIP_NEXT, p2.getInt(KEY_SKIP_NEXT, 0) + 1).apply()
    }

    fun recordSkipLocalCooldown(ctx: Context) {
        val p = prefs(ctx)
        ensureCurrentDay(p)
        val p2 = prefs(ctx)
        p2.edit().putInt(KEY_SKIP_COOLDOWN, p2.getInt(KEY_SKIP_COOLDOWN, 0) + 1).apply()
    }

    /** One line for the debug HTML card. */
    fun summaryHtmlLine(ctx: Context): String {
        val p = prefs(ctx)
        val today = dayStamp()
        val stored = p.getString(KEY_DAY, null)
        if (stored != today) {
            return "${today.escHtml()}: noch keine Events heute (Zähler starten bei erstem Vorkommnis)"
        }
        val api = p.getInt(KEY_API, 0)
        val cache = p.getInt(KEY_CACHE, 0)
        val sn = p.getInt(KEY_SKIP_NEXT, 0)
        val sc = p.getInt(KEY_SKIP_COOLDOWN, 0)
        return buildString {
            append("<strong>${today.escHtml()}</strong> — ")
            append("API-Sends: <code>$api</code> · ")
            append("Cache-Blocks (ohne API): <code>$cache</code> · ")
            append("Übersprungen (nextCheck): <code>$sn</code> · ")
            append("Übersprungen (30s-Cooldown): <code>$sc</code>")
        }
    }

    private fun String.escHtml() =
        replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
