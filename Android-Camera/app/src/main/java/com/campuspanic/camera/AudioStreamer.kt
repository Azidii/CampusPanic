package com.campuspanic.camera

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

data class AudioAlertResult(
    val classification: String,
    val confidence: Float,
    val alert: Boolean,
    val threatType: String?,
    val inferenceMs: Float
)

class AudioStreamer(
    private val getBaseUrl: () -> String?,
    private val getPairingCode: () -> String?,
    private val getSessionId: () -> String?,
    private val onResult: (AudioAlertResult) -> Unit,
    private val onError: (String) -> Unit
) {
    companion object {
        private const val TAG = "AudioStreamer"
        const val SAMPLE_RATE = 16000
        const val CHANNELS = AudioFormat.CHANNEL_IN_MONO
        const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        const val BYTES_PER_SAMPLE = 2 // 16-bit
        const val SAMPLES_PER_SECOND = SAMPLE_RATE
        const val CHUNK_BYTES = SAMPLES_PER_SECOND * BYTES_PER_SAMPLE // 32,000 bytes per 1s
    }

    private val isRunning = AtomicBoolean(false)
    private var recordThread: Thread? = null
    private var audioRecord: AudioRecord? = null

    @SuppressLint("MissingPermission")
    fun start() {
        if (isRunning.getAndSet(true)) return

        val minBufSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNELS, ENCODING)
        val bufferSize = maxOf(minBufSize * 2, CHUNK_BYTES)

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNELS,
                ENCODING,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                onError("Failed to initialize microphone AudioRecord")
                stop()
                return
            }

            audioRecord?.startRecording()
            Log.i(TAG, "Continuous 16kHz audio capture started (1s chunk size = $CHUNK_BYTES bytes)")
        } catch (e: Exception) {
            onError("Microphone error: ${e.message}")
            stop()
            return
        }

        recordThread = Thread({
            val readBuffer = ByteArray(4096)
            val chunkBuffer = ByteArrayOutputStream(CHUNK_BYTES)

            while (isRunning.get()) {
                val session = getSessionId()
                val base = getBaseUrl()
                val code = getPairingCode()

                if (session == null || base == null || code == null) {
                    SystemClock.sleep(200)
                    continue
                }

                val recorder = audioRecord ?: break
                val read = recorder.read(readBuffer, 0, readBuffer.size)
                if (read > 0) {
                    chunkBuffer.write(readBuffer, 0, read)

                    if (chunkBuffer.size() >= CHUNK_BYTES) {
                        val pcmPayload = chunkBuffer.toByteArray()
                        chunkBuffer.reset()

                        // Send 1s chunk to server
                        try {
                            sendAudioChunk(base, code, session, pcmPayload)
                        } catch (e: Exception) {
                            Log.w(TAG, "Audio upload error: ${e.message}")
                        }
                    }
                } else {
                    SystemClock.sleep(10)
                }
            }
        }, "CampusPanicAudioStreamer").apply {
            isDaemon = true
            start()
        }
    }

    private fun sendAudioChunk(base: String, code: String, session: String, pcmData: ByteArray) {
        val url = URL("$base/api/camera/audio")
        val conn = url.openConnection(Proxy.NO_PROXY) as HttpURLConnection
        try {
            conn.connectTimeout = 2500
            conn.readTimeout = 2500
            conn.requestMethod = "POST"
            conn.setRequestProperty("X-Camera-Token", code)
            conn.setRequestProperty("X-Camera-Session", session)
            conn.setRequestProperty("Content-Type", "application/octet-stream")
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(pcmData.size)

            conn.outputStream.use { it.write(pcmData) }

            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val responseText = stream?.bufferedReader()?.use { it.readText() } ?: ""

            if (status in 200..299) {
                val json = JSONObject(responseText)
                val alert = json.optBoolean("alert", false)
                val cls = json.optString("class", "Non-Scream")
                val conf = json.optDouble("confidence", 0.0).toFloat()
                val threat = if (json.has("threatType") && !json.isNull("threatType")) json.getString("threatType") else null
                val ms = json.optDouble("inferenceMs", 0.0).toFloat()

                val result = AudioAlertResult(
                    classification = cls,
                    confidence = conf,
                    alert = alert,
                    threatType = threat,
                    inferenceMs = ms
                )
                onResult(result)
            } else {
                Log.w(TAG, "Server returned HTTP $status for audio chunk: $responseText")
            }
        } finally {
            conn.disconnect()
        }
    }

    fun stop() {
        isRunning.set(false)
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (_: Exception) {}
        audioRecord = null
        recordThread = null
        Log.i(TAG, "AudioStreamer stopped.")
    }
}

