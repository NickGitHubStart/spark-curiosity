package com.sparkcuriosity.app.util

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import android.util.Log
import com.sparkcuriosity.app.data.model.UsageSignal
import java.util.Calendar

/**
 * Reads usage statistics via [UsageStatsManager]. Requires the special
 * PACKAGE_USAGE_STATS permission which the user must grant via Settings →
 * Special Access → Usage Access. Gracefully returns null if not granted.
 */
object UsageStatsHelper {
    private const val TAG = "UsageStatsHelper"

    fun hasPermission(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
            ?: return false
        val mode = try {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } catch (_: Exception) {
            return false
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /**
     * Returns usage for [pkg] over the last 24h window (today's consumption)
     * and the last 1h. Also counts foreground-starts (launches) today.
     * Returns null if permission is missing or stats are unavailable.
     */
    fun snapshotForPackage(context: Context, pkg: String): UsageSignal? {
        if (!hasPermission(context)) return null
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return null

        val now = System.currentTimeMillis()
        val startOfDay = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val hourAgo = now - 60 * 60 * 1000L

        return try {
            val dayMs = aggregateForeground(usm, pkg, startOfDay, now)
            val hourMs = aggregateForeground(usm, pkg, hourAgo, now)
            val launches = countLaunches(usm, pkg, startOfDay, now)
            UsageSignal(
                todaySeconds = (dayMs / 1000).toInt().coerceAtLeast(0),
                last1hSeconds = (hourMs / 1000).toInt().coerceAtLeast(0),
                launchesToday = launches
            )
        } catch (e: Exception) {
            Log.w(TAG, "snapshotForPackage($pkg) failed: ${e.message}")
            null
        }
    }

    private fun aggregateForeground(
        usm: UsageStatsManager, pkg: String, from: Long, to: Long
    ): Long {
        val events = usm.queryEvents(from, to)
        val evt = android.app.usage.UsageEvents.Event()
        var lastResume: Long = 0
        var totalMs: Long = 0
        while (events.hasNextEvent()) {
            events.getNextEvent(evt)
            if (evt.packageName != pkg) continue
            when (evt.eventType) {
                android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED,
                android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    lastResume = evt.timeStamp
                }
                android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED,
                android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    if (lastResume > 0) {
                        totalMs += (evt.timeStamp - lastResume).coerceAtLeast(0)
                        lastResume = 0
                    }
                }
            }
        }
        // Still in foreground at end of window
        if (lastResume > 0) totalMs += (to - lastResume).coerceAtLeast(0)
        return totalMs
    }

    private fun countLaunches(
        usm: UsageStatsManager, pkg: String, from: Long, to: Long
    ): Int {
        val events = usm.queryEvents(from, to)
        val evt = android.app.usage.UsageEvents.Event()
        var count = 0
        while (events.hasNextEvent()) {
            events.getNextEvent(evt)
            if (evt.packageName != pkg) continue
            if (evt.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED ||
                evt.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND
            ) count++
        }
        return count
    }
}
