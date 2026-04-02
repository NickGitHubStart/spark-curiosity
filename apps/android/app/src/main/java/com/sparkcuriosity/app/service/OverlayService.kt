package com.sparkcuriosity.app.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.IBinder
import android.view.Gravity
import android.view.WindowManager
import androidx.compose.runtime.mutableStateOf
import androidx.core.app.NotificationCompat
import com.sparkcuriosity.app.MainActivity
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.model.Command

/**
 * Foreground service that manages the floating overlay (chat bubble + notifications).
 *
 * The overlay shows:
 * - Quotes from AI interventions (show_quote)
 * - Check-in prompts (show_prompt)
 * - A mini chat bubble for quick access
 *
 * Redirect commands are handled by opening URLs via Intent.ACTION_VIEW.
 */
class OverlayService : Service() {

    private var windowManager: WindowManager? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        startForegroundNotification()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    private fun startForegroundNotification() {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, SparkApp.CHANNEL_ID)
            .setContentTitle("Spark Curiosity")
            .setContentText("Laeuft im Hintergrund")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    fun processCommand(cmd: Command) {
        when (cmd.type) {
            "redirect" -> {
                cmd.url?.let { url ->
                    if (url.startsWith("spark://curated")) {
                        // Show a curated gate notification/toast
                        showOverlayNotification("Spark hat diese Seite blockiert.")
                    } else {
                        // Open URL in browser
                        val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        try { startActivity(intent) } catch (_: Exception) {}
                    }
                }
            }
            "quote" -> {
                val text = cmd.text ?: return
                val author = cmd.author
                val display = if (author != null) "\"$text\" — $author" else "\"$text\""
                showOverlayNotification(display)
            }
            "prompt" -> {
                val question = cmd.question ?: return
                showOverlayNotification(question)
            }
        }
    }

    private fun showOverlayNotification(message: String) {
        // For now, use a system notification. A true floating overlay with Compose
        // requires ComposeView in WindowManager — we'll add that in the next iteration.
        val notification = NotificationCompat.Builder(this, SparkApp.CHANNEL_ID)
            .setContentTitle("Spark")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setAutoCancel(true)
            .build()

        val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.notify(OVERLAY_NOTIFICATION_ID, notification)
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        private const val OVERLAY_NOTIFICATION_ID = 2

        private var instance: OverlayService? = null

        fun handleCommand(cmd: Command) {
            instance?.processCommand(cmd)
        }
    }
}
