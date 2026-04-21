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
    val redirectedFromUrl: String? = null,
    val sessionExceeded: Boolean = false,
    val maxSessionSeconds: Int? = null,
    val memory: InlineMemory? = null,
    val thisPlatform: String = "android",
    val signals: SignalBundle? = null
)

/**
 * Zusätzliche, strukturierte Signale vom Client an den Agent.
 * Optional — Agent soll sie nutzen, aber auch ohne entscheiden können.
 */
@JsonClass(generateAdapter = false)
data class SignalBundle(
    val media: MediaSignal? = null,
    val usage: UsageSignal? = null,
    val recentHosts: List<String>? = null
)

/** Aktive Medien-Wiedergabe (via MediaSessionManager). */
@JsonClass(generateAdapter = false)
data class MediaSignal(
    val pkg: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val durationMs: Long? = null,
    val positionMs: Long? = null,
    val state: String? = null // "playing" | "paused" | "stopped"
)

/** Nutzungsstatistik heute (via UsageStatsManager). */
@JsonClass(generateAdapter = false)
data class UsageSignal(
    val todaySeconds: Int? = null,
    val last1hSeconds: Int? = null,
    val launchesToday: Int? = null
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
    val agentSkipped: Boolean? = null,
    val updatedMemoryBody: String? = null
)

@JsonClass(generateAdapter = false)
data class InlineMemory(
    val body: String,
    val onboardingComplete: Boolean
)

@JsonClass(generateAdapter = false)
data class ChatRequest(
    val message: String,
    val timestamp: String,
    val memory: InlineMemory? = null
)

@JsonClass(generateAdapter = false)
data class ChatResponse(
    val reply: String,
    val memoryUpdated: Boolean = false,
    val openUrl: String? = null,
    val updatedMemoryBody: String? = null
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
    val highlights: List<String> = emptyList(),
    val body: String = ""
)

@JsonClass(generateAdapter = false)
data class TemplatesResponse(
    val templates: List<OnboardingTemplate> = emptyList()
)

@JsonClass(generateAdapter = false)
data class OnboardingCompleteResponse(
    val ok: Boolean = false,
    val welcome: String? = null
)

@JsonClass(generateAdapter = false)
data class SimpleOkResponse(
    val ok: Boolean = false,
    val error: String? = null
)

@JsonClass(generateAdapter = false)
data class OnboardingCompleteRequest(
    val name: String? = null,
    val wishes: String? = null
)

@JsonClass(generateAdapter = false)
data class BugReportRequest(
    val message: String,
    val context: String? = null
)

@JsonClass(generateAdapter = false)
data class TranscriptionResponse(
    val text: String = ""
)

@JsonClass(generateAdapter = false)
data class EncryptedMemoryResponse(
    val exists: Boolean = false,
    val encryptedBody: String? = null,
    val nonce: String? = null,
    val cipherVersion: Int = 1,
    val onboardingComplete: Boolean = false,
    val updatedAt: String? = null
)

@JsonClass(generateAdapter = false)
data class EncryptedMemoryWriteRequest(
    val encryptedBody: String,
    val nonce: String,
    val onboardingComplete: Boolean,
    val cipherVersion: Int = 1
)

// ── Curated Gate ──

@JsonClass(generateAdapter = false)
data class CuratedGateRule(
    val id: String? = null,
    val host: String? = null,
    val hostSuffix: String? = null,
    val pathPrefix: String? = null,
    val pathRegex: String? = null,
    val urlRegex: String? = null,
    val note: String? = null
)

@JsonClass(generateAdapter = false)
data class CuratedGateResponse(
    val enabled: Boolean = false,
    val rules: List<CuratedGateRule> = emptyList(),
    val note: String? = null
)
