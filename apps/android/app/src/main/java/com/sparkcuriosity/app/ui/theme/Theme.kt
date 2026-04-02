package com.sparkcuriosity.app.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Spark brand colors — dark theme matching the desktop overlay
private val SparkDarkColors = darkColorScheme(
    primary = Color(0xFF7B68EE),        // Medium slate blue — accent
    onPrimary = Color.White,
    primaryContainer = Color(0xFF3D2E8C),
    secondary = Color(0xFF64FFDA),       // Teal accent
    onSecondary = Color.Black,
    background = Color(0xFF1A1A2E),      // Deep navy background
    onBackground = Color(0xFFE0E0E0),
    surface = Color(0xFF16213E),         // Slightly lighter navy
    onSurface = Color(0xFFE0E0E0),
    surfaceVariant = Color(0xFF1F2B47),
    onSurfaceVariant = Color(0xFFB0B0B0),
    error = Color(0xFFCF6679),
    outline = Color(0xFF3A3A5C)
)

@Composable
fun SparkTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SparkDarkColors,
        content = content
    )
}
