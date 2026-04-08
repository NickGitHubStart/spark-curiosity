package com.sparkcuriosity.app.data.crypto

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Client-side AES-GCM encryption for the user memory body.
 *
 * The Worker / Cloudflare D1 only ever sees ciphertext. The 256-bit key is
 * generated on first install and stored in EncryptedSharedPreferences (backed
 * by the Android Keystore). Pairing across devices transfers token + key via
 * QR code, never via the server.
 */
class MemoryCrypto(context: Context) {

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "spark_secure_prefs",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** Returns the existing memory key, or generates and stores a new 256-bit key. */
    fun getOrCreateKey(): ByteArray {
        val existing = prefs.getString(KEY_NAME, null)
        if (existing != null) return Base64.decode(existing, Base64.NO_WRAP)
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        prefs.edit().putString(KEY_NAME, Base64.encodeToString(bytes, Base64.NO_WRAP)).apply()
        return bytes
    }

    /** Replace the local key (used after QR pairing imports a key from another device). */
    fun setKey(keyBytes: ByteArray) {
        require(keyBytes.size == 32) { "key must be 32 bytes" }
        prefs.edit().putString(KEY_NAME, Base64.encodeToString(keyBytes, Base64.NO_WRAP)).apply()
    }

    fun hasKey(): Boolean = prefs.contains(KEY_NAME)

    data class Encrypted(val ciphertextB64: String, val nonceB64: String)

    fun encrypt(plaintext: String): Encrypted {
        val key = getOrCreateKey()
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        val ct = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return Encrypted(
            ciphertextB64 = Base64.encodeToString(ct, Base64.NO_WRAP),
            nonceB64 = Base64.encodeToString(nonce, Base64.NO_WRAP),
        )
    }

    fun decrypt(ciphertextB64: String, nonceB64: String): String {
        val key = getOrCreateKey()
        val ct = Base64.decode(ciphertextB64, Base64.NO_WRAP)
        val nonce = Base64.decode(nonceB64, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }

    companion object {
        private const val KEY_NAME = "memory_aes_key"
    }
}
