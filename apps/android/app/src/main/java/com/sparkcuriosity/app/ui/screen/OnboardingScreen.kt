package com.sparkcuriosity.app.ui.screen

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.core.content.ContextCompat
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.OnboardingTemplate
import com.sparkcuriosity.app.data.repo.MemoryRepository
import com.sparkcuriosity.app.util.AudioRecorder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun OnboardingScreen(
    api: SparkApi,
    memoryRepo: MemoryRepository,
    onComplete: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val recorder = remember { AudioRecorder(context) }

    var step by remember { mutableStateOf(0) } // 0=template, 1=wishes (+ Mic)
    var templates by remember { mutableStateOf<List<OnboardingTemplate>>(emptyList()) }
    var loadingTpl by remember { mutableStateOf(true) }
    var selectedTemplate by remember { mutableStateOf<OnboardingTemplate?>(null) }
    var wishes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    var transcribing by remember { mutableStateOf(false) }

    val micPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            try {
                recorder.start()
                isRecording = true
            } catch (e: Exception) {
                error = "Mikrofon: ${e.message}"
            }
        }
    }

    fun startRecording() {
        try {
            recorder.start()
            isRecording = true
            error = null
        } catch (e: Exception) {
            error = "Mikrofon: ${e.message}"
        }
    }

    fun stopRecordingAndTranscribe() {
        val file = recorder.stop()
        isRecording = false
        if (file != null) {
            transcribing = true
            scope.launch {
                try {
                    val text = withContext(Dispatchers.IO) { api.transcribeAudio(file) }
                    if (text.isNotBlank()) {
                        wishes = if (wishes.isBlank()) text.trim()
                        else wishes.trimEnd() + "\n" + text.trim()
                    }
                } catch (e: Exception) {
                    error = "Spracherkennung: ${e.message}"
                } finally {
                    transcribing = false
                    file.delete()
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        try {
            templates = api.getOnboardingTemplates()
        } catch (e: Exception) {
            error = "Templates konnten nicht geladen werden: ${e.message}"
        } finally {
            loadingTpl = false
        }
    }

    val wishesReady = wishes.trim().isNotEmpty()
    val canFinish = wishesReady && !saving && !isRecording && !transcribing

    val finish: () -> Unit = lambda@{
        val tpl = selectedTemplate ?: return@lambda
        if (!wishes.trim().isNotEmpty()) return@lambda
        scope.launch {
            saving = true
            try {
                val sections = StringBuilder(tpl.body.ifBlank { DEFAULT_BODY })
                val finalBody = appendToLongTerm(sections.toString(), listOf(wishes.trim()))
                memoryRepo.savePlaintext(finalBody, onboardingComplete = true)
                onComplete()
            } catch (e: Exception) {
                error = "Fehler beim Speichern: ${e.message}"
            } finally {
                saving = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Spacer(Modifier.height(32.dp))
        Text(
            "Willkommen bei Spark!",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            when (step) {
                0 -> "Waehl die gleiche Vorlage wie auf dem PC — oder was zu dir passt. Du kannst sie spaeter im Chat anpassen."
                else -> "Damit Spark dich richtig unterstuetzt, braucht er deine eigenen Regeln in deinen Worten."
            },
            fontSize = 15.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(Modifier.height(8.dp))

        if (error != null) {
            Text("⚠ $error", color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }

        when (step) {
            0 -> {
                if (loadingTpl) {
                    CircularProgressIndicator(modifier = Modifier.padding(40.dp))
                } else {
                    templates.forEach { tpl ->
                        TemplateCard(
                            tpl = tpl,
                            selected = selectedTemplate?.id == tpl.id,
                            onSelect = { selectedTemplate = tpl }
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { step = 1 },
                        enabled = selectedTemplate != null,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        shape = RoundedCornerShape(16.dp)
                    ) { Text("Weiter", fontSize = 17.sp) }
                }
            }
            1 -> {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            "Was Spark auf deinem Handy kann",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            "Mit den Berechtigungen sieht Spark, welche App oder Seite du nutzt. " +
                                "Er hilft dir, fokussiert zu bleiben: bei klarer Ablenkung kann er dich " +
                                "aus der App holen (zurück zum Startbildschirm). Bei sinnvollem Inhalt " +
                                "kann er dich in Ruhe lassen. Genau das steuern deine Vorlage und dein Text unten.",
                            fontSize = 14.sp,
                            lineHeight = 20.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text("• Unproduktives Scrollen oder Drift erkennen und begrenzen", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("• Lern- oder Ziel-Inhalte stärker durchlassen, wenn du es so willst", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            "• Wichtig: Schreib oder sprich, was Spark tun soll — und wann du auf keinen Fall unterbrochen werden willst.",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }

                Text(
                    "Deine Regeln (Pflichtfeld)",
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    "Formuliere konkret: Was soll Spark tun? Was ist tabu? Wann darf er eingreifen, wann niemals?",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                OutlinedTextField(
                    value = wishes,
                    onValueChange = { wishes = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 180.dp),
                    placeholder = {
                        Text(
                            "Beispiel: TikTok und Instagram-Scrollen begrenzen. " +
                                "YouTube nur, wenn ich ein konkretes Tutorial suche. " +
                                "Nie unterbrechen, wenn ich Spotify beim Sport hoere..."
                        )
                    },
                    shape = RoundedCornerShape(12.dp),
                    enabled = !isRecording && !transcribing
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    FilledTonalButton(
                        onClick = {
                            if (isRecording) {
                                stopRecordingAndTranscribe()
                            } else {
                                val ok = ContextCompat.checkSelfPermission(
                                    context,
                                    Manifest.permission.RECORD_AUDIO
                                ) == PackageManager.PERMISSION_GRANTED
                                if (ok) startRecording()
                                else micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        },
                        enabled = !saving && !transcribing,
                        modifier = Modifier.height(48.dp)
                    ) {
                        Text(
                            when {
                                isRecording -> "Aufnahme stoppen & uebernehmen"
                                transcribing -> "…"
                                else -> "Per Mikrofon einsprechen"
                            },
                            fontSize = 14.sp
                        )
                    }
                    if (isRecording) {
                        Text("Aufnahme…", color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    } else if (transcribing) {
                        Text("Wird transkribiert…", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                    }
                }

                if (!wishesReady) {
                    Text(
                        "Erst ausfuellen oder einsprechen — dann geht es weiter.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.tertiary
                    )
                }

                Button(
                    onClick = finish,
                    enabled = canFinish,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    if (saving) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Los geht's!", fontSize = 17.sp)
                    }
                }
                TextButton(
                    onClick = { step = 0 },
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                ) { Text("← Zurueck", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun TemplateCard(
    tpl: OnboardingTemplate,
    selected: Boolean,
    onSelect: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .then(
                if (selected) Modifier.border(
                    2.dp,
                    MaterialTheme.colorScheme.primary,
                    RoundedCornerShape(16.dp)
                ) else Modifier
            ),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected)
                MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surface
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                tpl.name,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(Modifier.height(4.dp))
            Text(
                tpl.description,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (tpl.highlights.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                tpl.highlights.forEach { h ->
                    Text("• $h", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private const val DEFAULT_BODY = """## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)"""

/** Inserts entries under the ## Long-Term section, replacing a "(leer)" placeholder if present. */
private fun appendToLongTerm(body: String, entries: List<String>): String {
    val lines = body.lines().toMutableList()
    val idx = lines.indexOfFirst { it.trim().equals("## Long-Term", ignoreCase = true) }
    if (idx < 0) {
        return body + "\n" + entries.joinToString("\n") { "- $it" }
    }
    var end = lines.size
    for (i in (idx + 1) until lines.size) {
        if (lines[i].startsWith("## ")) { end = i; break }
    }
    val sectionLines = lines.subList(idx + 1, end)
    val cleaned = sectionLines.filter { !it.trim().equals("- (leer)", ignoreCase = true) }
    val newSection = cleaned + entries.map { "- $it" }
    val before = lines.subList(0, idx + 1)
    val after = if (end < lines.size) lines.subList(end, lines.size) else emptyList()
    return (before + newSection + after).joinToString("\n")
}
