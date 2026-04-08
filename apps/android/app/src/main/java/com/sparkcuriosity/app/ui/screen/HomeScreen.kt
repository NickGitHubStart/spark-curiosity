package com.sparkcuriosity.app.ui.screen

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.StatsResult
import com.sparkcuriosity.app.service.OverlayService
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(
    api: SparkApi,
    onOpenChat: () -> Unit,
    onOpenStats: () -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var stats by remember { mutableStateOf<StatsResult?>(null) }
    var accessibilityEnabled by remember { mutableStateOf(isAccessibilityEnabled(context)) }
    var overlayPermission by remember { mutableStateOf(Settings.canDrawOverlays(context)) }

    // Re-check permissions every time the screen resumes (user comes back from Settings)
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                accessibilityEnabled = isAccessibilityEnabled(context)
                overlayPermission = Settings.canDrawOverlays(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(Unit) {
        try { stats = api.getStats("today") } catch (_: Exception) {}
    }

    val ready = accessibilityEnabled && overlayPermission

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(32.dp))

            Text(
                "Spark Curiosity",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )

            // ── Permission cards ──
            if (!accessibilityEnabled) {
                PermissionCard(
                    title = "Accessibility Service",
                    description = "Spark braucht den Accessibility Service um zu erkennen, welche Apps und Webseiten du nutzt.",
                    buttonText = "Aktivieren",
                    onClick = {
                        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
                )
            }

            if (!overlayPermission) {
                PermissionCard(
                    title = "Overlay-Berechtigung",
                    description = "Erlaubt Spark, den Chat als Overlay ueber anderen Apps anzuzeigen.",
                    buttonText = "Erlauben",
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:${context.packageName}"))
                        )
                    }
                )
            }

            if (accessibilityEnabled && overlayPermission) {
                // All good — start overlay service
                LaunchedEffect(Unit) {
                    val intent = Intent(context, OverlayService::class.java)
                    context.startForegroundService(intent)
                }

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1B3A2D))
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("●", color = Color(0xFF64FFDA), fontSize = 20.sp)
                        Text(
                            "Spark laeuft im Hintergrund",
                            color = Color(0xFF64FFDA),
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ── Stats card ──
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text(
                        "Heute",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(12.dp))

                    if (stats != null) {
                        StatRow("Interventionen", "${stats!!.totalBlocks}")
                        StatRow("Zeit gespart", "${stats!!.totalSessionSeconds / 60} Min")
                        if (stats!!.byPlatform.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            stats!!.byPlatform.forEach { (platform, data) ->
                                StatRow(platform, "${data.blocks} Blocks, ${data.seconds / 60}m")
                            }
                        }
                    } else {
                        Text(
                            "Lade Statistiken...",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 14.sp
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = {
                            scope.launch {
                                try { stats = api.getStats("today") } catch (_: Exception) {}
                            }
                        }) {
                            Text("Aktualisieren")
                        }
                        TextButton(onClick = onOpenStats) {
                            Text("Mehr Details →")
                        }
                    }
                }
            }

            // ── Chat button ── (gated until perms granted)
            Button(
                onClick = onOpenChat,
                enabled = ready,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(16.dp)
            ) {
                Text(
                    if (ready) "Chat mit Spark" else "Erst Berechtigungen aktivieren",
                    fontSize = 18.sp
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Text(value, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Medium, fontSize = 14.sp)
    }
}

@Composable
private fun PermissionCard(
    title: String,
    description: String,
    buttonText: String,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Spacer(modifier = Modifier.height(4.dp))
            Text(description, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = onClick, shape = RoundedCornerShape(12.dp)) {
                Text(buttonText)
            }
        }
    }
}

private fun isAccessibilityEnabled(context: Context): Boolean {
    val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    val enabled = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
    return enabled.any { it.resolveInfo.serviceInfo.packageName == context.packageName }
}
