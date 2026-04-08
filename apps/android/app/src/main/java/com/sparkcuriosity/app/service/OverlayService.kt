package com.sparkcuriosity.app.service

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.sparkcuriosity.app.MainActivity
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.model.Command
import com.sparkcuriosity.app.ui.theme.SparkTheme

/**
 * Foreground service that manages the floating overlay using ComposeView in WindowManager.
 *
 * Shows a persistent floating bubble + transient cards for AI interventions:
 * - quote command → quote card (auto-dismisses after 8s)
 * - prompt command → prompt card with two action chips
 * - redirect command → opens URL via Intent (no overlay needed)
 *
 * Uses TYPE_APPLICATION_OVERLAY (Android 8+, requires SYSTEM_ALERT_WINDOW permission).
 */
class OverlayService : Service(), LifecycleOwner, SavedStateRegistryOwner {

    private val lifecycleRegistry = LifecycleRegistry(this)
    private val savedStateRegistryController = SavedStateRegistryController.create(this)

    override val lifecycle: androidx.lifecycle.Lifecycle get() = lifecycleRegistry
    override val savedStateRegistry: SavedStateRegistry get() = savedStateRegistryController.savedStateRegistry

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null

    // Reactive state for the Compose overlay
    private val activeCard = mutableStateOf<OverlayCard?>(null)

    override fun onCreate() {
        super.onCreate()
        savedStateRegistryController.performAttach()
        savedStateRegistryController.performRestore(null)
        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.CREATED

        instance = this
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        startForegroundNotification()

        if (Settings.canDrawOverlays(this)) {
            attachOverlay()
        }

        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.STARTED
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.DESTROYED
        instance = null
        detachOverlay()
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

    private fun attachOverlay() {
        val composeView = ComposeView(this).apply {
            setViewTreeLifecycleOwner(this@OverlayService)
            setViewTreeSavedStateRegistryOwner(this@OverlayService)
            setContent {
                SparkTheme {
                    OverlayContent(
                        card = activeCard.value,
                        onDismiss = { activeCard.value = null }
                    )
                }
            }
        }

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = 80
        }

        try {
            windowManager?.addView(composeView, params)
            overlayView = composeView
        } catch (_: Exception) {
            // Permission denied or already attached
        }
    }

    private fun detachOverlay() {
        overlayView?.let {
            try { windowManager?.removeView(it) } catch (_: Exception) {}
            overlayView = null
        }
    }

    fun processCommand(cmd: Command) {
        when (cmd.type) {
            "redirect" -> {
                cmd.url?.let { url ->
                    if (url.startsWith("spark://curated")) {
                        activeCard.value = OverlayCard.Quote(
                            text = "Spark hat diese Seite blockiert. Zeit fuer was Besseres!",
                            author = null
                        )
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
                activeCard.value = OverlayCard.Quote(
                    text = cmd.text ?: return,
                    author = cmd.author
                )
            }
            "prompt" -> {
                activeCard.value = OverlayCard.Prompt(
                    question = cmd.question ?: return
                )
            }
        }
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        private var instance: OverlayService? = null

        fun handleCommand(cmd: Command) {
            instance?.processCommand(cmd)
        }
    }
}

// ── Overlay UI ──

sealed class OverlayCard {
    data class Quote(val text: String, val author: String?) : OverlayCard()
    data class Prompt(val question: String) : OverlayCard()
}

@Composable
private fun OverlayContent(card: OverlayCard?, onDismiss: () -> Unit) {
    if (card == null) return

    // Auto-dismiss quotes after 8s
    LaunchedEffect(card) {
        if (card is OverlayCard.Quote) {
            kotlinx.coroutines.delay(8000)
            onDismiss()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(
                containerColor = Color(0xFF16213E)
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF7B68EE))
                    )
                    Text(
                        "Spark",
                        color = Color(0xFF7B68EE),
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))

                when (card) {
                    is OverlayCard.Quote -> {
                        Text(
                            "\u201C${card.text}\u201D",
                            color = Color(0xFFE0E0E0),
                            fontSize = 15.sp,
                            lineHeight = 22.sp
                        )
                        if (card.author != null) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                "— ${card.author}",
                                color = Color(0xFFB0B0B0),
                                fontSize = 13.sp
                            )
                        }
                    }
                    is OverlayCard.Prompt -> {
                        Text(
                            card.question,
                            color = Color(0xFFE0E0E0),
                            fontSize = 15.sp,
                            lineHeight = 22.sp
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        TextButton(onClick = onDismiss) {
                            Text("Verstanden", color = Color(0xFF7B68EE))
                        }
                    }
                }
            }
        }
    }
}
