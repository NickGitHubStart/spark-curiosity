package com.sparkcuriosity.app.service

import android.content.ComponentName
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.sparkcuriosity.app.data.model.MediaSignal

/**
 * Minimal NotificationListenerService — required as the *host* of our
 * [MediaSessionManager] access permission. We do NOT read notification
 * content (privacy concern from the user) — we only need this class to
 * be bound so we can pass our ComponentName into
 * [MediaSessionManager.getActiveSessions].
 *
 * To enable: Settings → Apps → Special Access → Notification Access → enable Spark.
 */
class SparkMediaListenerService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "NotificationListener connected (needed for MediaSession access)")
        isConnected = true
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "NotificationListener disconnected")
        isConnected = false
    }

    // We intentionally do nothing with notifications — privacy constraint.
    override fun onNotificationPosted(sbn: StatusBarNotification?) {}
    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}

    companion object {
        private const val TAG = "SparkMediaListener"

        @Volatile var isConnected: Boolean = false
            private set

        /** Read the currently playing/active MediaSession (any app) and map it into a [MediaSignal]. */
        fun readActiveMediaSignal(context: android.content.Context, preferredPkg: String? = null): MediaSignal? {
            if (!isConnected) return null
            val manager = context.getSystemService(android.content.Context.MEDIA_SESSION_SERVICE)
                as? MediaSessionManager ?: return null
            val component = ComponentName(context, SparkMediaListenerService::class.java)
            val controllers: List<MediaController> = try {
                manager.getActiveSessions(component)
            } catch (e: SecurityException) {
                Log.w(TAG, "getActiveSessions failed: ${e.message}")
                return null
            } catch (e: Exception) {
                Log.w(TAG, "getActiveSessions error: ${e.message}")
                return null
            }
            if (controllers.isEmpty()) return null

            // Priority 1: controller from the foreground app, if matching
            val chosen = preferredPkg?.let { pkg ->
                controllers.firstOrNull { it.packageName == pkg }
            } ?: controllers.firstOrNull { isPlaying(it) }
              ?: controllers.first()

            return controllerToSignal(chosen)
        }

        private fun isPlaying(controller: MediaController): Boolean {
            val state = controller.playbackState?.state ?: return false
            return state == PlaybackState.STATE_PLAYING
        }

        private fun controllerToSignal(c: MediaController): MediaSignal? {
            return try {
                val md = c.metadata
                val pbs = c.playbackState
                MediaSignal(
                    pkg = c.packageName,
                    title = md?.getString(android.media.MediaMetadata.METADATA_KEY_TITLE)
                        ?: md?.getString(android.media.MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
                    artist = md?.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST)
                        ?: md?.getString(android.media.MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE),
                    album = md?.getString(android.media.MediaMetadata.METADATA_KEY_ALBUM),
                    durationMs = md?.getLong(android.media.MediaMetadata.METADATA_KEY_DURATION)?.takeIf { it > 0 },
                    positionMs = pbs?.position?.takeIf { it >= 0 },
                    state = when (pbs?.state) {
                        PlaybackState.STATE_PLAYING -> "playing"
                        PlaybackState.STATE_PAUSED -> "paused"
                        PlaybackState.STATE_STOPPED -> "stopped"
                        PlaybackState.STATE_BUFFERING -> "buffering"
                        else -> null
                    }
                )
            } catch (_: Exception) { null }
        }
    }
}
