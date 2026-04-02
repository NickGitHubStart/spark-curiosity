package com.sparkcuriosity.app.data.api

import com.sparkcuriosity.app.BuildConfig
import com.sparkcuriosity.app.data.model.*
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * HTTP client for the Spark Cloud Companion (Cloudflare Worker).
 * All calls go through the Worker; no direct AI API calls from the device.
 */
class SparkApi(private val tokenProvider: () -> String?) {

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

    private fun authHeaders(): Map<String, String> {
        val token = tokenProvider() ?: return emptyMap()
        return mapOf("Authorization" to "Bearer $token")
    }

    private fun buildRequest(method: String, path: String, body: Any? = null): Request {
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

    private suspend inline fun <reified T> execute(request: Request): T = withContext(Dispatchers.IO) {
        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: throw Exception("Empty response body")
        if (!response.isSuccessful) {
            throw Exception("HTTP ${response.code}: $responseBody")
        }
        moshi.adapter(T::class.java).fromJson(responseBody)
            ?: throw Exception("Failed to parse response")
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

    suspend fun sendChat(message: String): ChatResponse {
        val chatReq = ChatRequest(
            message = message,
            timestamp = java.time.Instant.now().toString()
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
        val response: Map<String, Any> = execute(request)
        @Suppress("UNCHECKED_CAST")
        val templates = response["templates"] as? List<Map<String, Any>> ?: return emptyList()
        return templates.map { map ->
            OnboardingTemplate(
                id = map["id"] as? String ?: "",
                name = map["name"] as? String ?: "",
                description = map["description"] as? String ?: "",
                highlights = (map["highlights"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
            )
        }
    }

    suspend fun completeOnboarding(name: String?, wishes: String?): Map<String, Any> {
        val body = mapOf("name" to (name ?: ""), "wishes" to (wishes ?: ""))
        val json = moshi.adapter<Map<String, String>>(
            Types.newParameterizedType(Map::class.java, String::class.java, String::class.java)
        ).toJson(body)
        val request = Request.Builder()
            .url("$baseUrl/onboarding/complete")
            .apply { for ((k, v) in authHeaders()) addHeader(k, v) }
            .post(json.toRequestBody(jsonMediaType))
            .build()
        return execute(request)
    }

    suspend fun submitBugReport(message: String, context: String? = null) {
        val body = mutableMapOf<String, String>("message" to message)
        if (context != null) body["context"] = context
        val json = moshi.adapter<Map<String, String>>(
            Types.newParameterizedType(Map::class.java, String::class.java, String::class.java)
        ).toJson(body)
        val request = Request.Builder()
            .url("$baseUrl/bug-report")
            .apply { for ((k, v) in authHeaders()) addHeader(k, v) }
            .post(json.toRequestBody(jsonMediaType))
            .build()
        execute<Map<String, Any>>(request)
    }
}
