package com.sparkcuriosity.app.util

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/**
 * Records mic audio to an M4A/AAC file (universally supported by Whisper).
 *
 * Usage:
 *   val rec = AudioRecorder(context)
 *   rec.start()
 *   ...
 *   val file = rec.stop()
 */
class AudioRecorder(private val context: Context) {

    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

    fun start() {
        val file = File(context.cacheDir, "spark_stt_${System.currentTimeMillis()}.m4a")
        outputFile = file

        @Suppress("DEPRECATION")
        val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            MediaRecorder()
        }

        rec.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(16000)        // Whisper-friendly
            setAudioEncodingBitRate(64_000)
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }
        recorder = rec
    }

    /** Stops and returns the audio file, or null on error. */
    fun stop(): File? {
        return try {
            recorder?.apply {
                stop()
                release()
            }
            outputFile
        } catch (_: Exception) {
            try { recorder?.release() } catch (_: Exception) {}
            null
        } finally {
            recorder = null
        }
    }

    /** Discards the recording without returning the file. */
    fun cancel() {
        try {
            recorder?.apply { stop(); release() }
        } catch (_: Exception) {
            try { recorder?.release() } catch (_: Exception) {}
        }
        recorder = null
        outputFile?.delete()
        outputFile = null
    }
}
