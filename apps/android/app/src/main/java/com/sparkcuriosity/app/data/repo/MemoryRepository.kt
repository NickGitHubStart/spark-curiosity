package com.sparkcuriosity.app.data.repo

import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.crypto.MemoryCrypto
import com.sparkcuriosity.app.data.model.EncryptedMemoryWriteRequest

private const val DEFAULT_BODY = """## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)"""

/**
 * Local-encrypted, cloud-synced memory.
 *
 * - Plaintext lives only in client RAM.
 * - Cloud stores AES-GCM ciphertext (key never leaves the device, except via QR pairing).
 * - Caller can build prompts with `loadPlaintext()` and persist updates with `savePlaintext()`.
 */
class MemoryRepository(
    private val api: SparkApi,
    private val crypto: MemoryCrypto,
) {
    /** Loads memory from cloud and decrypts. Returns DEFAULT_BODY for fresh installs. */
    suspend fun loadPlaintext(): MemorySnapshot {
        val resp = runCatching { api.getEncryptedMemory() }.getOrNull()
        if (resp == null || !resp.exists || resp.encryptedBody == null || resp.nonce == null) {
            return MemorySnapshot(body = DEFAULT_BODY, onboardingComplete = false)
        }
        val plaintext = runCatching {
            crypto.decrypt(resp.encryptedBody, resp.nonce)
        }.getOrElse {
            // Decryption failure usually means the local key doesn't match the cloud blob
            // (e.g. fresh install on a device that hasn't been paired). Treat as empty.
            return MemorySnapshot(body = DEFAULT_BODY, onboardingComplete = false, keyMismatch = true)
        }
        return MemorySnapshot(body = plaintext, onboardingComplete = resp.onboardingComplete)
    }

    suspend fun savePlaintext(body: String, onboardingComplete: Boolean) {
        val enc = crypto.encrypt(body)
        api.putEncryptedMemory(
            EncryptedMemoryWriteRequest(
                encryptedBody = enc.ciphertextB64,
                nonce = enc.nonceB64,
                onboardingComplete = onboardingComplete,
            )
        )
    }
}

data class MemorySnapshot(
    val body: String,
    val onboardingComplete: Boolean,
    val keyMismatch: Boolean = false,
)
