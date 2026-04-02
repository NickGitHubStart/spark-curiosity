package com.sparkcuriosity.app.data.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = false)
data class EventIngest(
    val timestamp: String,
    val platform: String,
    val contentMode: String = "other",
    val url: String,
    val title: String? = null,
    val sessionSeconds: Int = 0,
    val scrollCount: Int = 0,
    val returnedAfterRedirect: Boolean = false,
    val redirectedFromUrl: String? = null
)

@JsonClass(generateAdapter = false)
data class Command(
    val type: String,
    val url: String? = null,
    val closeTab: Boolean? = null,
    val reason: String? = null,
    val text: String? = null,
    val author: String? = null,
    val question: String? = null
)

@JsonClass(generateAdapter = false)
data class EventDecisionResponse(
    val commands: List<Command>? = null,
    val nextCheckSeconds: Int? = null,
    val reason: String? = null,
    val agentSkipped: Boolean? = null
)

@JsonClass(generateAdapter = false)
data class ChatRequest(
    val message: String,
    val timestamp: String
)

@JsonClass(generateAdapter = false)
data class ChatResponse(
    val reply: String,
    val memoryUpdated: Boolean = false,
    val openUrl: String? = null
)

@JsonClass(generateAdapter = false)
data class OverlayInitResponse(
    val onboardingComplete: Boolean,
    val welcome: String? = null,
    val lang: String = "de"
)

@JsonClass(generateAdapter = false)
data class StatsResult(
    val range: String,
    val totalBlocks: Int = 0,
    val totalSessionSeconds: Int = 0,
    val byPlatform: Map<String, PlatformStats> = emptyMap(),
    val byAction: Map<String, Int> = emptyMap()
)

@JsonClass(generateAdapter = false)
data class PlatformStats(
    val blocks: Int = 0,
    val seconds: Int = 0
)

@JsonClass(generateAdapter = false)
data class RegisterResponse(
    val token: String
)

@JsonClass(generateAdapter = false)
data class OnboardingTemplate(
    val id: String,
    val name: String,
    val description: String = "",
    val highlights: List<String> = emptyList()
)
