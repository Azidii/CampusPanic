package com.campuspanic.camera

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.os.Bundle
import android.os.SystemClock
import android.text.InputFilter
import android.text.InputType
import android.util.Size
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : ComponentActivity() {
    private lateinit var preview: PreviewView
    private lateinit var address: EditText
    private lateinit var pairingCode: EditText
    private lateinit var action: Button
    private lateinit var status: TextView
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val stopExecutor = Executors.newSingleThreadExecutor()
    private val generation = AtomicInteger()
    private var cameraProvider: ProcessCameraProvider? = null
    @Volatile private var running = false
    @Volatile private var session: String? = null
    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var settings: Settings? = null
    private var nextFrameAt = 0L
    private var sent = 0L
    private var permissionPending = false
    private data class Settings(val base: String, val code: String)
    private class ReceiverError(val httpCode: Int, message: String) : IOException(message)

    private val requestCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val shouldStart = permissionPending
        permissionPending = false
        if (granted && shouldStart) startTransmission()
        else status.text = "Camera permission is needed to send video."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(16))
            setBackgroundColor(Color.rgb(11, 18, 32))
        }
        ViewCompat.setOnApplyWindowInsetsListener(panel) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(dp(20) + bars.left, dp(16) + bars.top, dp(20) + bars.right, dp(16) + bars.bottom)
            insets
        }
        panel.addView(label("Campus Panic Camera", 24, Color.WHITE))
        panel.addView(label("Phone camera → laptop detection", 14, Color.rgb(155, 174, 201)))
        preview = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.BLACK)
        }
        panel.addView(preview, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(16); bottomMargin = dp(12) })
        panel.addView(label("Laptop Wi-Fi address", 13, Color.LTGRAY))
        address = EditText(this).apply {
            hint = "LAPTOP_WIFI_IP:5055"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(getPreferences(MODE_PRIVATE).getString("laptop", ""))
        }
        panel.addView(address)
        panel.addView(label("8-digit pairing code shown on the laptop", 13, Color.LTGRAY))
        pairingCode = EditText(this).apply {
            hint = "Pairing code"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(8))
            setSingleLine(true)
        }
        panel.addView(pairingCode)
        action = Button(this).apply {
            text = "Start camera"
            setOnClickListener {
                if (running) stopTransmission()
                else if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    permissionPending = true
                    requestCamera.launch(Manifest.permission.CAMERA)
                } else startTransmission()
            }
        }
        panel.addView(action)
        status = label("Connect this phone and the laptop to the same Wi-Fi.", 14, Color.rgb(56, 189, 248))
        status.setPadding(0, dp(8), 0, dp(8))
        panel.addView(status)
        panel.addView(label("Video only · No audio · Inference runs on the laptop\nKeep this screen open while streaming.", 12, Color.rgb(155, 174, 201)))
        setContentView(panel)
    }

    private fun label(value: String, sp: Int, color: Int) = TextView(this).apply {
        text = value; textSize = sp.toFloat(); setTextColor(color)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun startTransmission() {
        val base: String
        try { base = LaptopAddress.parse(address.text.toString()) }
        catch (error: Exception) { status.text = error.message ?: "Check the laptop address."; return }
        val code = pairingCode.text.toString().trim()
        if (!code.matches(Regex("[0-9]{8}"))) { status.text = "Enter the laptop's 8-digit pairing code."; return }
        settings = Settings(base, code)
        getPreferences(MODE_PRIVATE).edit().putString("laptop", base.removePrefix("http://")).apply()
        session = null
        sent = 0
        nextFrameAt = 0
        val epoch = generation.incrementAndGet()
        running = true
        address.isEnabled = false
        pairingCode.isEnabled = false
        action.text = "Stop camera"
        status.text = "Opening rear camera…"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            if (!running || generation.get() != epoch) return@addListener
            try {
                val provider = future.get()
                cameraProvider = provider
                val cameraPreview = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(
                        ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(analysisExecutor) { image -> analyze(image, epoch) }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, analysis)
                status.text = "Connecting to laptop…"
            } catch (error: Exception) {
                stopTransmission("Could not open camera: ${error.message}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun analyze(image: ImageProxy, epoch: Int) {
        val config = settings
        if (!running || generation.get() != epoch || config == null || SystemClock.elapsedRealtime() < nextFrameAt) {
            image.close(); return
        }
        val activeSession = session
        if (activeSession == null) {
            image.close()
            try {
                val response = send(config, "/api/camera/connect", null, null)
                val newSession = JSONObject(response).getString("sessionId")
                if (!running || generation.get() != epoch) {
                    stopExecutor.execute { runCatching { send(config, "/api/camera/disconnect", newSession, null, false) } }
                    return
                }
                session = newSession
                nextFrameAt = 0
                showStatus(epoch, "Connected. Sending camera frames…")
            } catch (error: Exception) { handleNetworkFailure(error, epoch) }
            return
        }
        var bitmap: Bitmap? = null
        var rotated: Bitmap? = null
        var imageClosed = false
        try {
            val rotation = image.imageInfo.rotationDegrees
            bitmap = image.toBitmap()
            image.close(); imageClosed = true
            rotated = if (rotation == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height,
                Matrix().apply { postRotate(rotation.toFloat()) }, true)
            val maxSide = maxOf(rotated.width, rotated.height)
            if (maxSide > 960) {
                val scaled = Bitmap.createScaledBitmap(rotated, rotated.width * 960 / maxSide, rotated.height * 960 / maxSide, true)
                if (rotated !== bitmap) rotated.recycle()
                rotated = scaled
            }
            val prepared = checkNotNull(rotated)
            val bytes = ByteArrayOutputStream().use { output ->
                check(prepared.compress(Bitmap.CompressFormat.JPEG, 75, output)) { "Could not encode camera image" }
                output.toByteArray()
            }
            if (!running || generation.get() != epoch) return
            send(config, "/api/camera/frame", activeSession, bytes)
            if (!running || generation.get() != epoch) return
            sent++
            nextFrameAt = SystemClock.elapsedRealtime() + 100 // At most ~10 uploads/second, with no frame queue.
            showStatus(epoch, "Sending video · $sent frames received by laptop")
        } catch (error: Exception) { handleNetworkFailure(error, epoch) }
        finally {
            if (!imageClosed) image.close()
            if (rotated !== bitmap) rotated?.recycle()
            bitmap?.recycle()
        }
    }

    private fun handleNetworkFailure(error: Exception, epoch: Int) {
        if (generation.get() != epoch || !running) return
        session = null
        nextFrameAt = SystemClock.elapsedRealtime() + 1000
        if (error is ReceiverError && error.httpCode == 401) {
            runOnUiThread { if (generation.get() == epoch) stopTransmission("Pairing code rejected. Check the laptop's code.") }
        } else showStatus(epoch, "Reconnecting… ${error.message ?: "Check Wi-Fi and the laptop receiver."}")
    }

    private fun showStatus(epoch: Int, text: String) {
        runOnUiThread { if (running && generation.get() == epoch) status.text = text }
    }

    private fun send(config: Settings, path: String, sessionId: String?, bytes: ByteArray?, track: Boolean = true): String {
        val request = URL(config.base + path).openConnection(Proxy.NO_PROXY) as HttpURLConnection
        if (track) connection = request
        try {
            request.connectTimeout = 2000
            request.readTimeout = 2000
            request.instanceFollowRedirects = false
            request.requestMethod = "POST"
            request.setRequestProperty("X-Camera-Token", config.code)
            sessionId?.let { request.setRequestProperty("X-Camera-Session", it) }
            request.setRequestProperty("Content-Type", if (bytes != null) "image/jpeg" else "application/octet-stream")
            request.doOutput = true
            request.setFixedLengthStreamingMode(bytes?.size ?: 0)
            request.outputStream.use { if (bytes != null) it.write(bytes) }
            val code = request.responseCode
            val bodyStream = if (code in 200..299) request.inputStream else request.errorStream
            val body = bodyStream?.bufferedReader()?.use { reader ->
                val text = StringBuilder()
                val chars = CharArray(1024)
                while (true) {
                    val count = reader.read(chars)
                    if (count < 0) break
                    if (text.length + count > 8192) throw IOException("Unexpected laptop response")
                    text.append(chars, 0, count)
                }
                text.toString()
            } ?: ""
            if (code !in 200..299) {
                val message = runCatching { JSONObject(body).getString("error") }.getOrDefault("Laptop returned HTTP $code")
                throw ReceiverError(code, message)
            }
            return body
        } finally {
            request.disconnect()
            if (track && connection === request) connection = null
        }
    }

    private fun stopTransmission(message: String = "Camera stopped.") {
        permissionPending = false
        running = false
        generation.incrementAndGet()
        val oldSession = session
        val oldSettings = settings
        session = null
        settings = null
        connection?.disconnect()
        cameraProvider?.unbindAll()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        address.isEnabled = true
        pairingCode.isEnabled = true
        action.text = "Start camera"
        status.text = message
        if (oldSession != null && oldSettings != null) {
            stopExecutor.execute { runCatching { send(oldSettings, "/api/camera/disconnect", oldSession, null, false) } }
        }
    }

    override fun onStop() { stopTransmission(); super.onStop() }
    override fun onDestroy() {
        analysisExecutor.shutdown()
        stopExecutor.shutdown()
        super.onDestroy()
    }
}
