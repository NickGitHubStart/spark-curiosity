package com.sparkcuriosity.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.util.Log
import com.sparkcuriosity.app.service.OverlayService
import com.sparkcuriosity.app.service.SparkVpnService

/**
 * Starts Spark services automatically after device boot.
 *
 * - OverlayService (foreground service with floating bubble)
 * - SparkVpnService (DNS-level blocking) — only if VPN permission was previously granted
 *
 * Note: AccessibilityService is managed by the OS and auto-restarts after boot
 * if the user has it enabled — no manual start needed.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d("SparkBoot", "Boot completed — starting Spark services")

        // Start overlay service
        try {
            context.startForegroundService(Intent(context, OverlayService::class.java))
        } catch (e: Exception) {
            Log.e("SparkBoot", "Failed to start OverlayService: ${e.message}")
        }

        // Start VPN if permission was previously granted
        try {
            if (VpnService.prepare(context) == null) {
                context.startService(Intent(context, SparkVpnService::class.java))
            }
        } catch (e: Exception) {
            Log.e("SparkBoot", "Failed to start VPN: ${e.message}")
        }
    }
}
