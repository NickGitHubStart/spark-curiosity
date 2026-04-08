package com.sparkcuriosity.app.ui.screen

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.sparkcuriosity.app.SparkApp
import androidx.compose.ui.platform.LocalContext

/**
 * Displays a QR code containing token + key so a second device can pair
 * by scanning. Payload format: spark://pair?t=<token>&k=<base64key>
 */
@Composable
fun PairScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as SparkApp
    var token by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { token = app.tokenRepository.getToken() }

    val payload = remember(token) {
        val t = token ?: return@remember null
        val keyB64 = Base64.encodeToString(app.memoryCrypto.getOrCreateKey(), Base64.NO_WRAP or Base64.URL_SAFE)
        "spark://pair?t=$t&k=$keyB64"
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Geraet koppeln", fontSize = 22.sp, fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary)
        Text(
            "Scanne diesen Code auf einem anderen Geraet, um dort dein bestehendes " +
                "Memory zu uebernehmen. Token + Schluessel werden direkt uebertragen — " +
                "nichts laeuft ueber den Server.",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(16.dp))
        if (payload != null) {
            val bitmap = remember(payload) { generateQrBitmap(payload, 600) }
            Image(bitmap = bitmap.asImageBitmap(), contentDescription = "Pair QR",
                modifier = Modifier.size(280.dp))
        } else {
            CircularProgressIndicator()
        }
        Spacer(Modifier.weight(1f))
        TextButton(onClick = onBack) { Text("Zurueck") }
    }
}

private fun generateQrBitmap(content: String, size: Int): Bitmap {
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    for (x in 0 until size) for (y in 0 until size) {
        bmp.setPixel(x, y, if (matrix[x, y]) AndroidColor.BLACK else AndroidColor.WHITE)
    }
    return bmp
}
