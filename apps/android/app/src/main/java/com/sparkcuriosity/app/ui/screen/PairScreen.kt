package com.sparkcuriosity.app.ui.screen

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.repo.MemoryRepository
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch

/**
 * Pairing screen with three states:
 * 1. Already paired → shows green status card
 * 2. Show own QR code → other device scans this
 * 3. Scan other device's QR → imports token+key
 */
@Composable
fun PairScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as SparkApp
    val scope = rememberCoroutineScope()

    var token by remember { mutableStateOf<String?>(null) }
    var hasKey by remember { mutableStateOf(false) }
    var mode by remember { mutableStateOf("status") } // "status", "show", "scan"
    var error by remember { mutableStateOf<String?>(null) }
    var syncStatus by remember { mutableStateOf<String?>(null) }
    var memoryPreview by remember { mutableStateOf<String?>(null) }
    var syncing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        token = app.tokenRepository.getToken()
        hasKey = try { app.memoryCrypto.getOrCreateKey().isNotEmpty() } catch (_: Exception) { false }
    }

    val isPaired = token != null && hasKey

    val api = remember {
        SparkApi(tokenProvider = { token })
    }
    val memoryRepo = remember {
        MemoryRepository(api, app.memoryCrypto)
    }

    // QR scan launcher
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@rememberLauncherForActivityResult
        try {
            val uri = Uri.parse(text)
            require(uri.scheme == "spark" && uri.host == "pair") { "Kein Spark Pair-Link" }
            val t = uri.getQueryParameter("t") ?: error("Token fehlt")
            val k = uri.getQueryParameter("k") ?: error("Key fehlt")
            val keyBytes = Base64.decode(k, Base64.NO_WRAP or Base64.URL_SAFE)
            app.memoryCrypto.setKey(keyBytes)
            syncing = true
            error = null
            syncStatus = "Kopple..."
            scope.launch {
                app.tokenRepository.setToken(t)
                token = t
                hasKey = true
                try {
                    val snapshot = memoryRepo.loadPlaintext()
                    syncStatus = if (snapshot.body.isNotBlank()) "Gekoppelt + Memory synchronisiert" else "Gekoppelt"
                } catch (_: Exception) {
                    syncStatus = "Gekoppelt (Memory-Sync fehlgeschlagen)"
                }
                syncing = false
                mode = "status"
            }
        } catch (e: Exception) {
            syncing = false
            error = "Pairing fehlgeschlagen: ${e.message}"
        }
    }

    // QR payload
    val payload = remember(token, hasKey) {
        val t = token ?: return@remember null
        if (!hasKey) return@remember null
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
        Spacer(modifier = Modifier.height(16.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            TextButton(onClick = onBack) {
                Text("<", fontSize = 20.sp)
            }
            Text(
                "Geraet koppeln",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }

        // Already paired status
        if (isPaired && mode == "status") {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1B3A2D))
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("●", color = Color(0xFF64FFDA), fontSize = 20.sp)
                        Text(
                            "Gekoppelt & synchronisiert",
                            color = Color(0xFF64FFDA),
                            fontWeight = FontWeight.Medium,
                            fontSize = 16.sp
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Dein Geraet ist mit dem Cloud-Memory verbunden. " +
                            "Aenderungen werden automatisch synchronisiert.",
                        color = Color(0xFFB0B0B0),
                        fontSize = 13.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Re-sync + preview button
            Button(
                onClick = {
                    syncing = true
                    syncStatus = null
                    memoryPreview = null
                    scope.launch {
                        try {
                            val snapshot = memoryRepo.loadPlaintext()
                            if (snapshot.keyMismatch) {
                                syncStatus = "Key stimmt nicht ueberein — neu koppeln noetig"
                            } else if (snapshot.body.isNotBlank() && !snapshot.body.contains("(leer)\n\n## Mid-Term\n- (leer)")) {
                                syncStatus = "Memory synchronisiert (${snapshot.body.length} Zeichen)"
                                memoryPreview = snapshot.body
                            } else {
                                syncStatus = "Memory ist leer"
                                memoryPreview = snapshot.body
                            }
                        } catch (e: Exception) {
                            syncStatus = "Sync fehlgeschlagen: ${e.message}"
                        }
                        syncing = false
                    }
                },
                enabled = !syncing,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                if (syncing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Memory synchronisieren & anzeigen")
                }
            }

            if (syncStatus != null) {
                Text(
                    syncStatus!!,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Memory content preview
            if (memoryPreview != null) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF161B22))
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "User Memory",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = Color(0xFF58A6FF)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            memoryPreview!!,
                            fontSize = 12.sp,
                            color = Color(0xFFC9D1D9),
                            lineHeight = 18.sp
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(modifier = Modifier.height(8.dp))

            Text(
                "Weiteres Geraet koppeln",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }

        // Mode toggle buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(
                onClick = { mode = "show"; error = null },
                modifier = Modifier.weight(1f).height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = if (mode == "show") ButtonDefaults.buttonColors()
                else ButtonDefaults.outlinedButtonColors()
            ) {
                Text("Meinen Code zeigen", fontSize = 13.sp)
            }
            Button(
                onClick = {
                    mode = "scan"
                    error = null
                    scanLauncher.launch(
                        ScanOptions()
                            .setBeepEnabled(false)
                            .setOrientationLocked(false)
                            .setPrompt("Pair-QR vom anderen Geraet scannen")
                            .setCaptureActivity(com.journeyapps.barcodescanner.CaptureActivity::class.java)
                    )
                },
                modifier = Modifier.weight(1f).height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = if (mode == "scan") ButtonDefaults.buttonColors()
                else ButtonDefaults.outlinedButtonColors()
            ) {
                Text("Code scannen", fontSize = 13.sp)
            }
        }

        // Show QR code
        if (mode == "show") {
            if (payload != null) {
                Text(
                    "Scanne diesen Code auf einem anderen Geraet um " +
                        "Token + Schluessel direkt zu uebertragen.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(8.dp))
                val bitmap = remember(payload) { generateQrBitmap(payload, 600) }
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = "Pair QR",
                    modifier = Modifier.size(280.dp)
                )
            } else {
                Text(
                    "Kein Token vorhanden. Bitte zuerst ein Konto erstellen.",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center
                )
            }
        }

        // Error
        if (error != null) {
            Text(
                error!!,
                color = MaterialTheme.colorScheme.error,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }

        Spacer(modifier = Modifier.weight(1f))
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
