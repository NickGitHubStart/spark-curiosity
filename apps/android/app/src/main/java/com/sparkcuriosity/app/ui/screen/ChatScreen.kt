package com.sparkcuriosity.app.ui.screen

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.clip
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
    var autoSendAfterTranscribe by remember { mutableStateOf(false) }

    val startRecording: () -> Unit = {
        try {
            recorder.start()
            isRecording = true
            autoSendAfterTranscribe = false
        } catch (e: Exception) {
            messages.add(ChatMessage("Mic-Fehler: ${e.message}", isUser = false))
        }
    }
    val micPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) startRecording() }

    /** Stop recording, transcribe, and optionally auto-send */
    fun stopAndTranscribe(andSend: Boolean) {
        val file = recorder.stop()
        isRecording = false
        autoSendAfterTranscribe = andSend
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
    }

    /** Send function for the chat */
    fun sendMessage() {
        val text = input.trim()
        if (text.isEmpty() || sending) return
        messages.add(ChatMessage(text, isUser = true))
        input = ""
        sending = true
        scope.launch {
            try {
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
                if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
            }
        }
    }

    // Auto-send after transcription completes
    LaunchedEffect(transcribing, autoSendAfterTranscribe) {
        if (!transcribing && autoSendAfterTranscribe && input.isNotBlank()) {
            autoSendAfterTranscribe = false
            sendMessage()
        }
    }

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
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
        ) {
            // Wave animation when recording
            if (isRecording) {
                WaveAnimation(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(40.dp)
                        .padding(horizontal = 16.dp)
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = if (transcribing) "" else input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        if (isRecording) {
                            Text("Aufnahme...", color = MaterialTheme.colorScheme.error)
                        } else if (transcribing) {
                            TranscribingDots()
                        } else {
                            Text("Nachricht...")
                        }
                    },
                    singleLine = false,
                    maxLines = 4,
                    shape = RoundedCornerShape(20.dp),
                    enabled = !sending && !transcribing && !isRecording
                )
                // Mic button: tap to start recording, tap again to stop + transcribe (no auto-send)
                IconButton(
                    onClick = {
                        if (isRecording) {
                            stopAndTranscribe(andSend = false)
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
                // Send button: if recording → stop + transcribe + auto-send
                IconButton(
                    onClick = {
                        if (isRecording) {
                            // Enter while recording → stop, transcribe, then auto-send
                            stopAndTranscribe(andSend = true)
                        } else {
                            sendMessage()
                        }
                    },
                    enabled = (input.isNotBlank() || isRecording) && !sending && !transcribing
                ) {
                    if (sending || transcribing) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.AutoMirrored.Filled.Send,
                            contentDescription = "Senden",
                            tint = if (isRecording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
        }
    }
}

/** Animated wave bars shown while recording — similar to Windows STT wave */
@Composable
private fun WaveAnimation(modifier: Modifier = Modifier) {
    val infiniteTransition = rememberInfiniteTransition(label = "wave")
    val barCount = 20

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        for (i in 0 until barCount) {
            val phase = i * 0.3f
            val height by infiniteTransition.animateFloat(
                initialValue = 4f,
                targetValue = 28f,
                animationSpec = infiniteRepeatable(
                    animation = tween(
                        durationMillis = 600,
                        delayMillis = (phase * 100).toInt(),
                        easing = EaseInOut
                    ),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "bar$i"
            )
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height(height.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.7f))
            )
        }
    }
}

/** Animated "..." dots shown while transcribing */
@Composable
private fun TranscribingDots() {
    val infiniteTransition = rememberInfiniteTransition(label = "dots")
    val dotCount = 3
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (i in 0 until dotCount) {
            val alpha by infiniteTransition.animateFloat(
                initialValue = 0.3f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(500, delayMillis = i * 200, easing = EaseInOut),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "dot$i"
            )
            Text(
                "●",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = alpha)
            )
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
