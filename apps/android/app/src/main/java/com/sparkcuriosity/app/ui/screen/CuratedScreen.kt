package com.sparkcuriosity.app.ui.screen

import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val QUOTES = listOf(
    "Der beste Zeitpunkt anzufangen war gestern. Der zweitbeste ist jetzt." to "Sprichwort",
    "Disziplin ist die Bruecke zwischen Zielen und Erfolg." to "Jim Rohn",
    "Du wirst nie einen produktiven Tag bereuen." to null,
    "Fokus ist nicht Ja sagen zu dem Ding, auf das du dich konzentrierst. Es ist Nein sagen zu den hundert anderen guten Ideen." to "Steve Jobs",
    "Die Zeit, die du geniesst zu verschwenden, ist keine verschwendete Zeit." to "Bertrand Russell",
    "Kleine Schritte sind besser als grosse Vorsaetze." to null,
    "Ablenkung ist der Feind des Fortschritts." to null,
    "Was du heute tust, entscheidet, wer du morgen bist." to null,
)

/**
 * Shown when Spark blocks a site/app. Equivalent to the Windows curated-gate page.
 * Shows a motivational quote + DuckDuckGo search + suggestions.
 */
@Composable
fun CuratedScreen(
    blockedSite: String?,
    reason: String?,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val quote = remember { QUOTES.random() }
    var searchQuery by remember { mutableStateOf("") }

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
            "Moment der Achtsamkeit",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )

        if (blockedSite != null) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1B1B2F))
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        "Spark hat $blockedSite blockiert",
                        color = Color(0xFFE0E0E0),
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp
                    )
                    if (reason != null) {
                        Spacer(Modifier.height(4.dp))
                        Text(reason, color = Color(0xFF8B949E), fontSize = 13.sp)
                    }
                }
            }
        }

        // Motivational quote
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF16213E))
        ) {
            Column(Modifier.padding(20.dp)) {
                Text(
                    "\u201C${quote.first}\u201D",
                    color = Color(0xFFE0E0E0),
                    fontSize = 16.sp,
                    lineHeight = 24.sp
                )
                if (quote.second != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "— ${quote.second}",
                        color = Color(0xFF8B949E),
                        fontSize = 13.sp
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        // Search bar (DuckDuckGo)
        Text(
            "Was moechtest du stattdessen tun?",
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Suchen...") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )
            Button(
                onClick = {
                    if (searchQuery.isNotBlank()) {
                        val url = "https://duckduckgo.com/?q=${Uri.encode(searchQuery.trim())}"
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        })
                    }
                },
                enabled = searchQuery.isNotBlank(),
                shape = RoundedCornerShape(12.dp)
            ) { Text("Suchen") }
        }

        Spacer(Modifier.height(8.dp))

        // Quick links
        Text(
            "Empfehlungen",
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface
        )
        val suggestions = listOf(
            "Lernen" to "https://duckduckgo.com/?q=best+learning+resources",
            "Nachrichten" to "https://duckduckgo.com/?q=important+news+today",
            "Produktivitaet" to "https://duckduckgo.com/?q=productivity+tips",
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            suggestions.forEach { (label, url) ->
                OutlinedButton(
                    onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        })
                    },
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.weight(1f)
                ) { Text(label, fontSize = 12.sp) }
            }
        }

        Spacer(Modifier.height(16.dp))
        TextButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("Zurueck zum Homescreen")
        }
        Spacer(Modifier.height(32.dp))
    }
}
