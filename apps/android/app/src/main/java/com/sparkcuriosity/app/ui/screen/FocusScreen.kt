package com.sparkcuriosity.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Shown when Spark redirects the user away from a distracting app/site.
 * Minimal by design — no links, no suggestions, just a clear signal to put the phone down.
 */
@Composable
fun FocusScreen(onBack: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0A0A0A)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(40.dp)
        ) {
            Text(
                "⚡",
                fontSize = 48.sp,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Focus.",
                fontSize = 42.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                textAlign = TextAlign.Center
            )
            Text(
                "Leg das Handy weg.",
                fontSize = 20.sp,
                color = Color(0xFF8B949E),
                textAlign = TextAlign.Center
            )
        }

        // Subtle back link at the very bottom
        TextButton(
            onClick = onBack,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 32.dp)
        ) {
            Text(
                "Zurueck",
                color = Color(0xFF30363D),
                fontSize = 13.sp
            )
        }
    }
}
