package com.sparkcuriosity.app.data.api

import com.sparkcuriosity.app.BuildConfig
import com.sparkcuriosity.app.data.model.*
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * HTTP client for the Spark Cloud Companion (Cloudflare Worker).
 * All calls go through the Worker; no direct AI API calls from the device.
 *
 * tokenProvider is a suspend function to avoid runBlocking in callers.
 */
class SparkApi(private val tokenProvider: suspend () -> String?) {

    private val baseUrl = BuildConfig.CLOUD_BASE_URL.trimEnd('/')

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS) // AI calls can be slow
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val moshi = Moshi.Builder()
        .addLast(KotlinJsonAdapterFactory())
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private suspend fun authHeaders(): Map<String, String> {
        val token = tokenProvider() ?: return emptyMap()
        return mapOf("Authorization" to "Bearer $token")
    }

    private suspend fun buildRequest(method: String, path: String, body: Any? = null): Request {
        val builder = Request.Builder()
            .url("$baseUrl$path")

        for ((k, v) in authHeaders()) {
            builder.addHeader(k, v)
        }

        if (body != null) {
            val json = moshi.adapter(body.javaClass).toJson(body)
            builder.method(method, json.toRequestBody(jsonMediaType))
        } else if (method == "POST") {
            builder.method(method, "{}".toRequestBody(jsonMediaType))
        } else {
            builder.method(method, null)
        }

        return builder.build()
    }

    /**
     * Executes a request with retry logic for transient failures.
     * Retries up to 2 times with exponential backoff (1s, 2s) for network errors and 5xx responses.
     */
    private suspend inline fun <reified T> execute(request: Request, maxRetries: Int = 2): T = withContext(Dispatchers.IO) {
        var lastException: Exception? = null
        repeat(maxRetries + 1) { attempt ->
            try {
                val response = client.newCall(request).execute()
                val responseBody = response.body?.string() ?: throw Exception("Empty response body")
                if (!response.isSuccessful) {
                    val ex = Exception("HTTP ${response.code}: ${responseBody.take(500)}")
                    // Retry on 5xx server errors, not on 4xx client errors
                    if (response.code in 500..599 && attempt < maxRetries) {
                        lastException = ex
                        kotlinx.coroutines.delay(1000L * (attempt + 1))
                        return@repeat
                    }
                    throw ex
                }
                return@withContext moshi.adapter(T::class.java).fromJson(responseBody)
                    ?: throw Exception("Failed to parse response as ${T::class.java.simpleName}")
            } catch (e: java.io.IOException) {
                // Network error — retry
                lastException = e
                if (attempt < maxRetries) {
                    kotlinx.coroutines.delay(1000L * (attempt + 1))
                } else {
                    throw e
                }
            }
        }
        throw lastException ?: Exception("Request failed after retries")
    }

    // ── Public API methods ──

    suspend fun register(secret: String? = null): RegisterResponse {
        val body = if (secret != null) mapOf("secret" to secret) else emptyMap<String, String>()
        val json = moshi.adapter<Map<String, String>>(
            Types.newParameterizedType(Map::class.java, String::class.java, String::class.java)
        ).toJson(body)
        val request = Request.Builder()
            .url("$baseUrl/register")
            .post(json.toRequestBody(jsonMediaType))
            .build()
        return execute(request)
    }

    suspend fun sendEvent(event: EventIngest): EventDecisionResponse {
        val request = buildRequest("POST", "/event", event)
        return execute(request)
    }

    suspend fun sendChat(message: String, memory: InlineMemory? = null): ChatResponse {
        val chatReq = ChatRequest(
            message = message,
            timestamp = java.time.Instant.now().toString(),
            memory = memory
        )
        val request = buildRequest("POST", "/chat", chatReq)
        return execute(request)
    }

    suspend fun getOverlayInit(): OverlayInitResponse {
        val request = buildRequest("GET", "/overlay/init")
        return execute(request)
    }

    suspend fun getStats(range: String = "today"): StatsResult {
        val request = buildRequest("GET", "/stats?range=$range")
        return execute(request)
    }

    suspend fun getOnboardingTemplates(): List<OnboardingTemplate> {
        val request = buildRequest("GET", "/onboarding/templates")
        val response: TemplatesResponse = execute(request)
        return response.templates
    }

    suspend fun completeOnboarding(name: String?, wishes: String?): OnboardingCompleteResponse {
        val request = buildRequest("POST", "/onboarding/complete", OnboardingCompleteRequest(name, wishes))
        return execute(request)
    }

    suspend fun getEncryptedMemory(): EncryptedMemoryResponse {
        val request = buildRequest("GET", "/memory/encrypted")
        return execute(request)
    }

    suspend fun putEncryptedMemory(req: EncryptedMemoryWriteRequest): SimpleOkResponse {
        val request = buildRequest("POST", "/memory/encrypted", req)
        return execute(request)
    }

    suspend fun getCuratedGate(): CuratedGateResponse {
        val request = buildRequest("GET", "/curated-gate")
        return execute(request)
    }

    suspend fun submitBugReport(message: String, context: String? = null) {
        val request = buildRequest("POST", "/bug-report", BugReportRequest(message, context))
        execute<SimpleOkResponse>(request)
    }

    /**
     * Transcribes an audio file via the cloud proxy's OpenAI-compatible STT endpoint.
     * Uses multipart/form-data — the same format Whisper expects.
     */
    suspend fun transcribeAudio(audioFile: File, language: String = "de"): String {
        val token = tokenProvider() ?: throw Exception("stt_no_token: Not registered")
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file",
                audioFile.name,
                audioFile.asRequestBody("audio/m4a".toMediaType())
            )
            .addFormDataPart("model", "whisper-1")
            .addFormDataPart("language", language)
            .addFormDataPart("response_format", "json")
            .build()

        val request = Request.Builder()
            .url("$baseUrl/v1/audio/transcriptions")
            .addHeader("Authorization", "Bearer $token")
            .post(body)
            .build()

        val response: TranscriptionResponse = execute(request)
        return response.text
    }
}
