package com.sparkcuriosity.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.foundation.shape.RoundedCornerShape
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.model.InlineMemory
import com.sparkcuriosity.app.data.repo.MemoryRepository
import com.sparkcuriosity.app.util.AudioRecorder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ChatMessage(
    val text: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis()
)

/** Process-scoped chat history. Survives navigation, dies with the process (= full app close). */
object ChatHistory {
    val messages = mutableStateListOf<ChatMessage>()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    api: SparkApi,
    memoryRepo: MemoryRepository,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val messages = ChatHistory.messages
    var input by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    val context = LocalContext.current
    val recorder = remember { AudioRecorder(context) }
    var isRecording by remember { mutableStateOf(false) }
    var transcribing by remember { mutableStateOf(false) }

    val startRecording: () -> Unit = {
        try {
            recorder.start()
            isRecording = true
        } catch (e: Exception) {
            messages.add(ChatMessage("Mic-Fehler: ${e.message}", isUser = false))
        }
    }
    val micPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) startRecording() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // Top bar
        TopAppBar(
            title = { Text("Spark Chat", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurueck")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface
            )
        )

        // Messages
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 16.dp)
        ) {
            if (messages.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier.fillParentMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "Jederzeit Feedback geben.\nUmso mehr Anforderungen und Feedback,\numso besser macht Spark was du willst.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 14.sp,
                            lineHeight = 22.sp,
                            modifier = Modifier.padding(32.dp)
                        )
                    }
                }
            }
            items(messages) { msg ->
                ChatBubble(msg)
            }
        }

        // Input row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text(if (isRecording) "Aufnahme..." else if (transcribing) "Transkribiere..." else "Nachricht...") },
                singleLine = false,
                maxLines = 4,
                shape = RoundedCornerShape(20.dp),
                enabled = !sending && !transcribing
            )
            IconButton(
                onClick = {
                    if (isRecording) {
                        val file = recorder.stop()
                        isRecording = false
                        if (file != null) {
                            transcribing = true
                            scope.launch {
                                try {
                                    val text = withContext(Dispatchers.IO) { api.transcribeAudio(file) }
                                    if (text.isNotBlank()) {
                                        input = if (input.isBlank()) text else "$input $text"
                                    }
                                } catch (e: Exception) {
                                    messages.add(ChatMessage("STT-Fehler: ${e.message}", isUser = false))
                                } finally {
                                    transcribing = false
                                    file.delete()
                                }
                            }
                        }
                    } else {
                        val granted = ContextCompat.checkSelfPermission(
                            context, Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED
                        if (granted) startRecording()
                        else micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                },
                enabled = !sending && !transcribing
            ) {
                Text(
                    if (isRecording) "■" else "🎤",
                    fontSize = 20.sp,
                    color = if (isRecording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
                )
            }
            IconButton(
                onClick = {
                    val text = input.trim()
                    if (text.isEmpty() || sending) return@IconButton
                    messages.add(ChatMessage(text, isUser = true))
                    input = ""
                    sending = true
                    scope.launch {
                        try {
                            // Decrypt local memory, send inline, persist updated body if any
                            val snapshot = memoryRepo.loadPlaintext()
                            val response = api.sendChat(
                                text,
                                memory = InlineMemory(snapshot.body, snapshot.onboardingComplete)
                            )
                            messages.add(ChatMessage(response.reply, isUser = false))
                            response.updatedMemoryBody?.let { newBody ->
                                memoryRepo.savePlaintext(newBody, snapshot.onboardingComplete)
                            }
                        } catch (e: Exception) {
                            messages.add(ChatMessage("Fehler: ${e.message}", isUser = false))
                        } finally {
                            sending = false
                            listState.animateScrollToItem(messages.size - 1)
                        }
                    }
                },
                enabled = input.isNotBlank() && !sending
            ) {
                if (sending) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                } else {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Senden",
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatBubble(msg: ChatMessage) {
    val alignment = if (msg.isUser) Alignment.End else Alignment.Start
    val bgColor = if (msg.isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val textColor = if (msg.isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface

    Box(modifier = Modifier.fillMaxWidth()) {
        Card(
            modifier = Modifier.align(
                if (msg.isUser) Alignment.CenterEnd else Alignment.CenterStart
            ).widthIn(max = 300.dp),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = bgColor)
        ) {
            Text(
                text = msg.text,
                modifier = Modifier.padding(12.dp),
                color = textColor,
                fontSize = 15.sp
            )
        }
    }
}
