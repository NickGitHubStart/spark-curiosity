package com.sparkcuriosity.app.ui.screen

import android.app.Activity
import android.content.Intent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.min

/**
 * "Pondon" — block UX after a redirect (Android counterpart to **closing a tab** on PC).
 * Full black screen; the user must **hold** the center control for 2s, then we send them to
 * the **launcher (home screen)**. Deliberately minimal: no list of links, no "Focus." poetry.
 */
@Composable
fun PondonScreen(
    blockedSiteLabel: String?,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var holdProgress by remember { mutableFloatStateOf(0f) }
    val animated by animateFloatAsState(holdProgress, label = "hold")

    fun goToLauncherAndFinish() {
        val c = context
        onDismiss()
        c.startActivity(
            Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
        (c as? Activity)?.finish()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        if (!blockedSiteLabel.isNullOrBlank()) {
            Text(
                text = blockedSiteLabel,
                color = Color(0xFF6E7681),
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 32.dp, start = 24.dp, end = 24.dp)
            )
        }
        Column(
            modifier = Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                "2 Sekunden halten, dann bist du am Startbildschirm.",
                color = Color(0xFF8B949E),
                fontSize = 16.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp)
            )
            Spacer(Modifier.height(32.dp))
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            val pointerId = down.id
                            val startUptime = down.uptimeMillis
                            holdProgress = 0f
                            while (true) {
                                val e = awaitPointerEvent(PointerEventPass.Main)
                                val ch = e.changes.find { it.id == pointerId } ?: e.changes.first()
                                if (!ch.pressed) {
                                    holdProgress = 0f
                                    break
                                }
                                val ms = ch.uptimeMillis - startUptime
                                holdProgress = min(1f, ms / 2000f)
                                if (ms >= 2000) {
                                    holdProgress = 1f
                                    goToLauncherAndFinish()
                                    break
                                }
                            }
                        }
                    }
                    .semantics { contentDescription = "Zum Startbildschirm — 2 Sekunden halten" }
                    .background(Color(0xFF21262D), shape = CircleShape),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    progress = { animated },
                    modifier = Modifier.size(104.dp),
                    color = Color(0xFFFFA657),
                    trackColor = Color(0xFF30363D),
                    strokeWidth = 4.dp
                )
                if (animated < 0.02f) {
                    Text(
                        "Hier",
                        color = Color.White,
                        fontSize = 16.sp
                    )
                }
            }
        }
    }
}
