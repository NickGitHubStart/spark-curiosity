package com.sparkcuriosity.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.sparkcuriosity.app.data.crypto.MemoryCrypto
import com.sparkcuriosity.app.data.repository.TokenRepository

class SparkApp : Application() {

    lateinit var tokenRepository: TokenRepository
        private set

    lateinit var memoryCrypto: MemoryCrypto
        private set

    override fun onCreate() {
        super.onCreate()
        tokenRepository = TokenRepository(this)
        memoryCrypto = MemoryCrypto(this)
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Spark Curiosity",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Spark laeuft im Hintergrund und hilft dir fokussiert zu bleiben."
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "spark_monitoring"
    }
}
