package com.sparkcuriosity.app.ui.screen

import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.repo.MemoryRepository
import com.sparkcuriosity.app.data.repository.TokenRepository
import kotlinx.coroutines.launch

@Composable
fun SetupScreen(
    api: SparkApi,
    tokenRepo: TokenRepository,
    onSetupComplete: () -> Unit,
    onPairComplete: () -> Unit = onSetupComplete,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val app = context.applicationContext as SparkApp
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val memoryRepo = remember { MemoryRepository(api, app.memoryCrypto) }
    var pairing by remember { mutableStateOf(false) }

    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@rememberLauncherForActivityResult
        try {
            val uri = Uri.parse(text)
            require(uri.scheme == "spark" && uri.host == "pair") { "no spark pair link" }
            val t = uri.getQueryParameter("t") ?: error("missing token")
            val k = uri.getQueryParameter("k") ?: error("missing key")
            val keyBytes = Base64.decode(k, Base64.NO_WRAP or Base64.URL_SAFE)
            app.memoryCrypto.setKey(keyBytes)
            pairing = true
            scope.launch {
                tokenRepo.setToken(t)
                // Pull the encrypted memory from cloud so it's available locally
                try {
                    val snapshot = memoryRepo.loadPlaintext()
                    if (snapshot.body.isNotBlank() && snapshot.onboardingComplete) {
                        // Memory synced — skip onboarding
                        onPairComplete()
                        return@launch
                    }
                } catch (_: Exception) {}
                // Even if pull fails, pairing succeeded (token+key are set)
                onPairComplete()
            }
        } catch (e: Exception) {
            pairing = false
            error = "Pairing fehlgeschlagen: ${e.message}"
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            Text(
                text = "Spark Curiosity",
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )

            Text(
                text = "Dein persoenlicher AI-Begleiter fuer digitale Achtsamkeit",
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = {
                    scope.launch {
                        loading = true
                        error = null
                        try {
                            val result = api.register()
                            tokenRepo.setToken(result.token)
                            onSetupComplete()
                        } catch (e: Exception) {
                            error = "Verbindung fehlgeschlagen: ${e.message}"
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary
                )
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Jetzt starten", fontSize = 18.sp)
                }
            }

            OutlinedButton(
                onClick = {
                    scanLauncher.launch(
                        ScanOptions()
                            .setBeepEnabled(false)
                            .setOrientationLocked(true)
                            .setPrompt("Pair-QR vom anderen Geraet scannen")
                            .setCaptureActivity(com.journeyapps.barcodescanner.CaptureActivity::class.java)
                    )
                },
                enabled = !loading && !pairing,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp)
            ) {
                if (pairing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Mit existierendem Geraet koppeln", fontSize = 15.sp)
                }
            }

            if (error != null) {
                Text(
                    text = error!!,
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
