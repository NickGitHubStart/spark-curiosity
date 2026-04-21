package com.sparkcuriosity.app.service

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.sparkcuriosity.app.data.model.MediaSignal
import java.util.concurrent.ConcurrentHashMap

/**
 * NotificationListenerService that is *only* used as the permission host for
 * [MediaSessionManager.getActiveSessions] — we never read notification content.
 *
 * Once bound, we register a [MediaSessionManager.OnActiveSessionsChangedListener]
 * and a per-controller [MediaController.Callback], so that whenever an app
 * (YouTube, Spotify, …) publishes new metadata we cache it.
 *
 * This matters because reading metadata synchronously at send time often yields
 * empty titles — YouTube only publishes `METADATA_KEY_TITLE` once playback has
 * actually started (a few hundred ms after the Activity becomes foreground).
 * With the callback pattern we always have the latest good metadata available.
 */
class SparkMediaListenerService : NotificationListenerService() {

    private var sessionsListener: MediaSessionManager.OnActiveSessionsChangedListener? = null
    private val registeredControllers = ConcurrentHashMap<MediaController, MediaController.Callback>()

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "NotificationListener connected — wiring MediaSession callbacks")
        isConnected = true

        val manager = getSystemService(MEDIA_SESSION_SERVICE) as? MediaSessionManager ?: return
        val component = ComponentName(this, SparkMediaListenerService::class.java)

        val listener = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
            updateControllers(controllers ?: emptyList())
        }
        sessionsListener = listener
        try {
            manager.addOnActiveSessionsChangedListener(listener, component)
            updateControllers(manager.getActiveSessions(component))
        } catch (e: SecurityException) {
            Log.w(TAG, "addOnActiveSessionsChangedListener failed: ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "session wiring failed: ${e.message}")
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "NotificationListener disconnected")
        isConnected = false

        // Unregister callbacks
        for ((c, cb) in registeredControllers) {
            try { c.unregisterCallback(cb) } catch (_: Exception) {}
        }
        registeredControllers.clear()

        val manager = getSystemService(MEDIA_SESSION_SERVICE) as? MediaSessionManager
        sessionsListener?.let { l ->
            try { manager?.removeOnActiveSessionsChangedListener(l) } catch (_: Exception) {}
        }
        sessionsListener = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {}
    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}

    private fun updateControllers(controllers: List<MediaController>) {
        val current = controllers.toSet()
        // Remove callbacks from controllers that disappeared
        val toRemove = registeredControllers.keys.filter { it !in current }
        for (old in toRemove) {
            val cb = registeredControllers.remove(old)
            cb?.let { try { old.unregisterCallback(it) } catch (_: Exception) {} }
        }
        // Add callbacks to new controllers + capture current snapshot
        for (c in controllers) {
            if (registeredControllers.containsKey(c)) {
                snapshotController(c) // refresh in case metadata changed
                continue
            }
            val cb = object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) { snapshotController(c) }
                override fun onPlaybackStateChanged(state: PlaybackState?) { snapshotController(c) }
                override fun onSessionDestroyed() {
                    registeredControllers.remove(c)
                }
            }
            try {
                c.registerCallback(cb)
                registeredControllers[c] = cb
                snapshotController(c)
            } catch (_: Exception) {}
        }
    }

    companion object {
        private const val TAG = "SparkMediaListener"
        private const val CACHE_TTL_MS = 5L * 60_000 // 5 minutes

        @Volatile var isConnected: Boolean = false
            private set

        private data class CachedMedia(val signal: MediaSignal, val capturedAt: Long)

        /** pkg → latest media snapshot (including state). */
        private val metadataCache = ConcurrentHashMap<String, CachedMedia>()

        /**
         * Snapshot current state of a controller into the cache. Only overwrites with
         * an empty title if we have nothing cached yet (avoids losing a good title to
         * a transient empty-metadata callback from the source app).
         */
        private fun snapshotController(c: MediaController) {
            val signal = controllerToSignal(c) ?: return
            val pkg = signal.pkg ?: return
            val titleNonEmpty = !signal.title.isNullOrBlank()
            val existing = metadataCache[pkg]
            val existingHasTitle = !existing?.signal?.title.isNullOrBlank()
            val shouldWrite = titleNonEmpty || !existingHasTitle
            if (shouldWrite) {
                metadataCache[pkg] = CachedMedia(signal, System.currentTimeMillis())
            } else if (existing != null) {
                // Keep existing title but refresh state + capturedAt if we got a new callback
                metadataCache[pkg] = CachedMedia(
                    existing.signal.copy(state = signal.state, positionMs = signal.positionMs),
                    System.currentTimeMillis()
                )
            }
        }

        /**
         * Read the cached (or live-polled) MediaSignal for the preferred package.
         *
         * Strategy:
         * 1. Return cached signal for preferredPkg if fresh (within CACHE_TTL).
         * 2. Otherwise, live-poll `getActiveSessions` and pick the matching controller.
         * 3. As a last resort, any active controller.
         */
        fun readActiveMediaSignal(context: android.content.Context, preferredPkg: String? = null): MediaSignal? {
            if (!isConnected) return null

            // 1. Cache-first
            if (preferredPkg != null) {
                val cached = metadataCache[preferredPkg]
                if (cached != null && System.currentTimeMillis() - cached.capturedAt < CACHE_TTL_MS) {
                    return cached.signal
                }
            }

            // 2. Live poll
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
            if (controllers.isEmpty()) {
                // 3. Fall back to any recent cached entry within TTL
                return metadataCache.values
                    .filter { System.currentTimeMillis() - it.capturedAt < CACHE_TTL_MS }
                    .maxByOrNull { it.capturedAt }
                    ?.signal
            }

            // Opportunistically snapshot everything we see right now
            for (c in controllers) snapshotController(c)

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
                    title = md?.getString(MediaMetadata.METADATA_KEY_TITLE)
                        ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
                    artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                        ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
                        ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST),
                    album = md?.getString(MediaMetadata.METADATA_KEY_ALBUM),
                    durationMs = md?.getLong(MediaMetadata.METADATA_KEY_DURATION)?.takeIf { it > 0 },
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
