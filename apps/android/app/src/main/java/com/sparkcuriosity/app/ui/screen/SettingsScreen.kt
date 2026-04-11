package com.sparkcuriosity.app.ui.screen

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlin.math.roundToInt

/**
 * Settings screen where users can configure session duration thresholds per platform.
 *
 * Session duration = how long Spark lets you browse a platform before intervening.
 * Values are stored in EncryptedSharedPreferences and read by the AccessibilityService.
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val prefs = remember { getSettingsPrefs(context) }

    // Platform-specific session durations (in seconds)
    val platforms = remember {
        listOf(
            PlatformSetting("youtube", "YouTube", 120),
            PlatformSetting("tiktok", "TikTok", 60),
            PlatformSetting("instagram", "Instagram", 90),
            PlatformSetting("reddit", "Reddit", 120),
            PlatformSetting("x", "X / Twitter", 90),
            PlatformSetting("facebook", "Facebook", 120),
            PlatformSetting("other", "Andere Seiten", 300),
        )
    }

    // Load saved values or defaults
    val durations = remember {
        platforms.associate { p ->
            p.key to mutableStateOf(
                prefs.getInt("session_${p.key}", p.defaultSeconds).toFloat()
            )
        }
    }

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

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                TextButton(onClick = onBack) {
                    Text("<", fontSize = 20.sp)
                }
                Text(
                    "Einstellungen",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            Text(
                "Session-Dauer pro Plattform",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                "Wie lange darf Spark dich auf einer Plattform scrollen lassen, bevor ein Hinweis kommt?",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            platforms.forEach { platform ->
                val duration = durations[platform.key]!!
                SessionDurationCard(
                    label = platform.label,
                    seconds = duration.value,
                    onValueChange = { newVal ->
                        duration.value = newVal
                        prefs.edit()
                            .putInt("session_${platform.key}", newVal.roundToInt())
                            .apply()
                    }
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun SessionDurationCard(
    label: String,
    seconds: Float,
    onValueChange: (Float) -> Unit
) {
    val minutes = (seconds / 60f)
    val displayText = if (minutes >= 1f) {
        "${minutes.roundToInt()} Min"
    } else {
        "${seconds.roundToInt()} Sek"
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    label,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 15.sp
                )
                Text(
                    displayText,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Slider(
                value = seconds,
                onValueChange = onValueChange,
                valueRange = 30f..600f,
                steps = 18, // 30s increments: (600-30)/30 - 1 = 18
                colors = SliderDefaults.colors(
                    thumbColor = MaterialTheme.colorScheme.primary,
                    activeTrackColor = MaterialTheme.colorScheme.primary
                )
            )
        }
    }
}

private data class PlatformSetting(
    val key: String,
    val label: String,
    val defaultSeconds: Int
)

/** Encrypted SharedPreferences for session settings — readable by the AccessibilityService. */
fun getSettingsPrefs(context: Context): SharedPreferences {
    val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    return EncryptedSharedPreferences.create(
        context,
        "spark_settings",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
}

/** Read session duration for a given platform key. Returns seconds. */
fun getSessionDuration(context: Context, platformKey: String): Int {
    return try {
        val prefs = getSettingsPrefs(context)
        val defaults = mapOf(
            "youtube" to 120, "tiktok" to 60, "instagram" to 90,
            "reddit" to 120, "x" to 90, "facebook" to 120, "other" to 300
        )
        prefs.getInt("session_$platformKey", defaults[platformKey] ?: 120)
    } catch (_: Exception) {
        120
    }
}
