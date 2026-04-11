package com.sparkcuriosity.app.service

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.sparkcuriosity.app.MainActivity
import com.sparkcuriosity.app.SparkApp
import java.util.concurrent.TimeUnit

/**
 * Periodic WorkManager worker that checks if the AccessibilityService and VPN are still running.
 * If either is disabled, it sends a high-priority notification to the user.
 *
 * Runs every 15 minutes (WorkManager minimum for periodic work).
 * Survives Doze mode and battery optimization.
 */
class HealthCheckWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {

    override fun doWork(): Result {
        val accessibilityRunning = isAccessibilityServiceRunning()
        val vpnRunning = SparkVpnService.isRunning()

        if (!accessibilityRunning) {
            sendNotification(
                title = "Spark ist deaktiviert",
                text = "Der Accessibility Service wurde beendet. Tippe hier um ihn wieder zu aktivieren.",
                id = NOTIFICATION_ACCESSIBILITY
            )
        }

        if (!vpnRunning) {
            sendNotification(
                title = "DNS-Blocker inaktiv",
                text = "Der VPN-Blocker ist nicht aktiv. Tippe hier um ihn zu starten.",
                id = NOTIFICATION_VPN
            )
        }

        // If both are running, clear any stale notifications
        if (accessibilityRunning) clearNotification(NOTIFICATION_ACCESSIBILITY)
        if (vpnRunning) clearNotification(NOTIFICATION_VPN)

        return Result.success()
    }

    private fun isAccessibilityServiceRunning(): Boolean {
        val am = applicationContext.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val enabled = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
        return enabled.any { it.resolveInfo.serviceInfo.packageName == applicationContext.packageName }
    }

    private fun sendNotification(title: String, text: String, id: Int) {
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, id,
            Intent(applicationContext, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, SparkApp.CHANNEL_BLOCKS)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(id, notification)
    }

    private fun clearNotification(id: Int) {
        val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(id)
    }

    companion object {
        private const val NOTIFICATION_ACCESSIBILITY = 10
        private const val NOTIFICATION_VPN = 11
        private const val WORK_NAME = "spark_health_check"

        /**
         * Schedule the periodic health check. Safe to call multiple times —
         * ExistingPeriodicWorkPolicy.KEEP ensures only one instance runs.
         */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<HealthCheckWorker>(
                15, TimeUnit.MINUTES
            ).setConstraints(
                Constraints.Builder()
                    .setRequiresBatteryNotLow(false)
                    .build()
            ).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }
}
