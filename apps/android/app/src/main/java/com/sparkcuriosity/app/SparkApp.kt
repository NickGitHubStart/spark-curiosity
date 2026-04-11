package com.sparkcuriosity.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.sparkcuriosity.app.data.crypto.MemoryCrypto
import com.sparkcuriosity.app.data.repository.TokenRepository
import com.sparkcuriosity.app.service.HealthCheckWorker

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
        HealthCheckWorker.schedule(this)
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Spark Curiosity", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Spark laeuft im Hintergrund und hilft dir fokussiert zu bleiben."
            }
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_BLOCKS, "Blockierungen", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Benachrichtigung wenn Spark eine Ablenkung blockiert."
            }
        )
    }

    companion object {
        const val CHANNEL_ID = "spark_monitoring"
        const val CHANNEL_BLOCKS = "spark_blocks"
    }
}
