package com.sparkcuriosity.app.ui.screen

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.OnboardingTemplate
import com.sparkcuriosity.app.data.repo.MemoryRepository
import kotlinx.coroutines.launch

@Composable
fun OnboardingScreen(
    api: SparkApi,
    memoryRepo: MemoryRepository,
    onComplete: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(0) } // 0=template, 1=name+wishes
    var templates by remember { mutableStateOf<List<OnboardingTemplate>>(emptyList()) }
    var loadingTpl by remember { mutableStateOf(true) }
    var selectedTemplate by remember { mutableStateOf<OnboardingTemplate?>(null) }
    var name by remember { mutableStateOf("") }
    var wishes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            templates = api.getOnboardingTemplates()
        } catch (e: Exception) {
            error = "Templates konnten nicht geladen werden: ${e.message}"
        } finally {
            loadingTpl = false
        }
    }

    val finish: () -> Unit = lambda@{
        val tpl = selectedTemplate ?: return@lambda
        scope.launch {
            saving = true
            try {
                // Build memory body locally from template + custom inputs
                val sections = StringBuilder(tpl.body.ifBlank { DEFAULT_BODY })
                val extraLong = buildList {
                    if (name.isNotBlank()) add("Name: ${name.trim()}")
                    if (wishes.isNotBlank()) add(wishes.trim())
                }
                val finalBody = if (extraLong.isEmpty()) sections.toString()
                                else appendToLongTerm(sections.toString(), extraLong)
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
                0 -> "Waehl eine Vorlage, die zu dir passt. Du kannst sie spaeter jederzeit anpassen."
                else -> "Ein paar Worte ueber dich machen Spark deutlich besser."
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
                Text("Dein Name", fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("z.B. Nick") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp)
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Was soll Spark fuer dich tun?",
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    "Beschreibe deine Ziele, was du vermeiden willst, wie Spark dir helfen soll.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = wishes,
                    onValueChange = { wishes = it },
                    modifier = Modifier.fillMaxWidth().height(160.dp),
                    placeholder = {
                        Text("z.B. Schliesse YouTube wenn ich laenger als 10min Shorts schaue. " +
                             "Erinnere mich an meine Lernziele. Social Media nur 30min pro Tag...")
                    },
                    shape = RoundedCornerShape(12.dp)
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = finish,
                    enabled = !saving,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    if (saving) CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    ) else Text("Los geht's!", fontSize = 17.sp)
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
        // No section — just append at end
        return body + "\n" + entries.joinToString("\n") { "- $it" }
    }
    // Find end of section (next ## or EOF)
    var end = lines.size
    for (i in (idx + 1) until lines.size) {
        if (lines[i].startsWith("## ")) { end = i; break }
    }
    // Drop "(leer)" placeholder
    val sectionLines = lines.subList(idx + 1, end)
    val cleaned = sectionLines.filter { !it.trim().equals("- (leer)", ignoreCase = true) }
    val newSection = cleaned + entries.map { "- $it" }
    val before = lines.subList(0, idx + 1)
    val after = if (end < lines.size) lines.subList(end, lines.size) else emptyList()
    return (before + newSection + after).joinToString("\n")
}
