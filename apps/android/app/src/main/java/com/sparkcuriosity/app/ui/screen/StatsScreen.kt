package com.sparkcuriosity.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.StatsResult
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    api: SparkApi,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val ranges = listOf("today" to "Heute", "week" to "Woche", "total" to "Gesamt")
    var rangeIdx by remember { mutableStateOf(0) }
    var stats by remember { mutableStateOf<StatsResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun load(range: String) {
        loading = true
        error = null
        scope.launch {
            try {
                stats = api.getStats(range)
            } catch (e: Exception) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(rangeIdx) { load(ranges[rangeIdx].first) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        TopAppBar(
            title = { Text("Statistiken", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurueck")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface
            )
        )

        TabRow(selectedTabIndex = rangeIdx) {
            ranges.forEachIndexed { i, (_, label) ->
                Tab(
                    selected = rangeIdx == i,
                    onClick = { rangeIdx = i },
                    text = { Text(label) }
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            when {
                loading && stats == null -> Box(
                    modifier = Modifier.fillMaxWidth().padding(40.dp),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }

                error != null -> Text(
                    "Fehler: $error",
                    color = MaterialTheme.colorScheme.error
                )

                stats != null -> {
                    val s = stats!!
                    SummaryCard(
                        blocks = s.totalBlocks,
                        minutes = s.totalSessionSeconds / 60
                    )

                    if (s.byPlatform.isNotEmpty()) {
                        SectionCard(title = "Nach Plattform") {
                            s.byPlatform.entries
                                .sortedByDescending { it.value.blocks }
                                .forEach { (platform, data) ->
                                    StatLine(
                                        label = platform.replaceFirstChar { it.uppercase() },
                                        value = "${data.blocks} • ${data.seconds / 60} Min"
                                    )
                                }
                        }
                    }

                    if (s.byAction.isNotEmpty()) {
                        SectionCard(title = "Nach Aktion") {
                            s.byAction.entries
                                .sortedByDescending { it.value }
                                .forEach { (action, count) ->
                                    StatLine(label = action, value = count.toString())
                                }
                        }
                    }

                    if (s.totalBlocks == 0) {
                        Text(
                            "Noch keine Daten in diesem Zeitraum.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 14.sp
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryCard(blocks: Int, minutes: Int) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            BigStat(value = blocks.toString(), label = "Interventionen")
            BigStat(value = "${minutes}m", label = "Zeit erfasst")
        }
    }
}

@Composable
private fun BigStat(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 32.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(12.dp))
            content()
        }
    }
}

@Composable
private fun StatLine(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Text(value, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Medium, fontSize = 14.sp)
    }
}
