package com.campuspanic.camera

import android.Manifest
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.FrameLayout
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.text.InputFilter
import android.text.InputType
import android.util.Size
import android.view.View
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
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
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
    private lateinit var audioBadge: TextView
    private lateinit var cnnBadge: TextView
    private lateinit var alertBanner: TextView
    private lateinit var hudTop: TextView
    private lateinit var hudBottom: TextView
    private val hudHandler = Handler(Looper.getMainLooper())
    private val hudThreats = mutableMapOf<String, Boolean?>()
    @Volatile private var lastGatewayAt = 0L
    private var lastHudAt = 0L
    private var lastGunAt = 0L
    private var lastAudioAt = 0L
    private var audioAlert = false
    private var audioClass = ""
    private var audioConfidence = 0.0f
    private var lastGunConfidence = 0.0f
    private var hudAlarm = false
    @Volatile private var detectionUploading = false
    private var nextDetectionAt = 0L
    private val hudTick = object : Runnable {
        override fun run() {
            refreshHud()
            hudHandler.postDelayed(this, 1000)
        }
    }

    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val stopExecutor = Executors.newSingleThreadExecutor()
    private val detectionUploadExecutor = Executors.newSingleThreadExecutor()
    private val generation = AtomicInteger()

    private var cameraProvider: ProcessCameraProvider? = null
    private var pendingCameraLayout: View.OnLayoutChangeListener? = null
    @Volatile private var running = false
    @Volatile private var session: String? = null
    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var settings: Settings? = null

    private var nextFrameAt = 0L
    private var sent = 0L
    private var permissionPending = false

    private lateinit var gunDetector: GunDetector
    private var audioStreamer: AudioStreamer? = null

    private data class Settings(val base: String, val code: String)
    private class ReceiverError(val httpCode: Int, message: String) : IOException(message)

    private val requestPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val cameraGranted = permissions[Manifest.permission.CAMERA] == true
        val audioGranted = permissions[Manifest.permission.RECORD_AUDIO] == true
        val shouldStart = permissionPending
        permissionPending = false

        if (cameraGranted && audioGranted && shouldStart) {
            startTransmission()
        } else {
            status.text = "Camera & Audio permissions are both required."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize on-device YOLO11 TFLite gun detector
        gunDetector = GunDetector(this)

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

        panel.addView(label("Campus Panic Camera", 22, Color.WHITE, bold = true))
        panel.addView(label("Live camera connected to campus CCTV", 13, Color.rgb(155, 174, 201)))

        // Alert Banner (High priority downstream and local threat warnings)
        alertBanner = TextView(this).apply {
            text = "● SYSTEM NORMAL"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.rgb(52, 211, 153))
            setBackgroundColor(Color.argb(40, 16, 185, 129))
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        panel.addView(alertBanner, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8); bottomMargin = dp(4) })

        // Camera Preview
        preview = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.BLACK)
        }
        val cameraFrame = FrameLayout(this)
        cameraFrame.addView(preview, FrameLayout.LayoutParams(-1, -1))
        hudTop = label("Battery —    Network Offline", 11, Color.WHITE).apply {
            setPadding(dp(10), dp(7), dp(10), dp(7))
            setBackgroundColor(Color.argb(190, 8, 15, 25))
        }
        hudBottom = label("Smoke —   Fire —   Medical —   Shooting —", 11, Color.WHITE).apply {
            setPadding(dp(10), dp(7), dp(10), dp(7))
            setBackgroundColor(Color.argb(190, 8, 15, 25))
        }
        cameraFrame.addView(hudTop, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        cameraFrame.addView(hudBottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        panel.addView(cameraFrame, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(6); bottomMargin = dp(6) })

        // Live Badges Container
        val badges = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }
        cnnBadge = TextView(this).apply {
            text = if (gunDetector.isModelLoaded) "Video CNN: Ready" else "Video CNN: Off (model not in assets)"
            textSize = 11f
            setTextColor(Color.rgb(147, 197, 253))
        }
        audioBadge = TextView(this).apply {
            text = "Audio: Ready"
            textSize = 11f
            setTextColor(Color.rgb(167, 243, 208))
        }
        badges.addView(cnnBadge, LinearLayout.LayoutParams(0, -2, 1f))
        badges.addView(audioBadge, LinearLayout.LayoutParams(0, -2, 1f))
        panel.addView(badges)

        panel.addView(label("Laptop Wi-Fi address", 12, Color.LTGRAY))
        address = EditText(this).apply {
            hint = "LAPTOP_WIFI_IP:5000"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(getPreferences(MODE_PRIVATE).getString("laptop", ""))
        }
        panel.addView(address)

        panel.addView(label("8-digit pairing code shown on the laptop", 12, Color.LTGRAY))
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
            text = "Start dual streaming"
            setOnClickListener {
                if (running) {
                    stopTransmission()
                } else {
                    val hasCamera = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                    val hasAudio = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

                    if (!hasCamera || !hasAudio) {
                        permissionPending = true
                        requestPermissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
                    } else {
                        startTransmission()
                    }
                }
            }
        }
        panel.addView(action)

        status = label("Connect phone and laptop to same Wi-Fi.", 13, Color.rgb(56, 189, 248))
        status.setPadding(0, dp(4), 0, dp(4))
        panel.addView(status)

        setContentView(panel)
    }

    private fun label(value: String, sp: Int, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = sp.toFloat()
        setTextColor(color)
        if (bold) setTypeface(null, Typeface.BOLD)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun batteryPercentage(): Int? = runCatching {
        val manager = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }
    }.getOrNull()

    private fun networkKind(): String = runCatching {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = manager.getNetworkCapabilities(manager.activeNetwork)
        when {
            caps == null -> "offline"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "connected"
        }
    }.getOrDefault("unknown")

    private fun refreshHud() {
        if (!::hudTop.isInitialized) return
        val now = SystemClock.elapsedRealtime()
        val connected = running && lastGatewayAt > 0 && now - lastGatewayAt < 5000
        val network = if (connected) when (networkKind()) {
            "wifi" -> "Wi-Fi"
            "cellular" -> "Cellular"
            "ethernet" -> "Ethernet"
            else -> "Connected"
        } else if (running) "Reconnecting" else "Offline"
        hudTop.text = "Battery ${batteryPercentage()?.let { "$it%" } ?: "—"}    Network $network"
        val fresh = connected && lastHudAt > 0 && now - lastHudAt < 5000
        val videoGun = running && lastGunAt > 0 && now - lastGunAt < 2000
        val audioFresh = running && audioAlert && now - lastAudioAt < 5000
        val values = linkedMapOf<String, Boolean?>()
        for ((key, name) in linkedMapOf("smoke" to "Smoke", "fire" to "Fire", "medical" to "Medical", "shooting" to "Shooting")) {
            values[name] = if (key == "shooting" && (videoGun || (audioFresh && audioClass.equals("Gunshot", true)))) true
                else if (fresh) hudThreats[key] else null
        }
        hudBottom.text = values.entries.joinToString("   ") { (name, value) -> "$name ${when (value) { true -> "On"; false -> "Off"; null -> "—" }}" }
        val active = values.filterValues { it == true }.keys
        val alarm = active.isNotEmpty() || audioFresh || videoGun
        val audioPct = (audioConfidence * 100).toInt()
        val videoPct = (lastGunConfidence * 100).toInt()

        alertBanner.text = when {
            !running -> "NOT STREAMING"
            videoGun -> "🚨 ON-DEVICE THREAT: GUN DETECTED ($videoPct%)"
            audioFresh && audioClass.isNotBlank() -> "🚨 AUDIO THREAT: ${audioClass.uppercase()} ($audioPct%)"
            active.isNotEmpty() -> active.joinToString(" / ").uppercase() + " ALERT"
            !connected -> "CONNECTING TO CAMPUS CCTV"
            !fresh || values.values.any { it == null } -> "NODE STATUS UNAVAILABLE"
            else -> "NO ACTIVE ALERTS REPORTED"
        }
        alertBanner.setBackgroundColor(if (alarm) Color.rgb(220, 38, 38) else Color.argb(80, 8, 47, 73))
        alertBanner.setTextColor(if (alarm) Color.WHITE else Color.rgb(186, 230, 253))
        if (alarm && !hudAlarm) triggerThreatFeedback()
        hudAlarm = alarm
    }

    private fun receiveHud(body: String, epoch: Int) {
        val hud = runCatching { JSONObject(body).optJSONObject("hud") }.getOrNull() ?: return
        val threats = hud.optJSONObject("threats") ?: return
        runOnUiThread {
            if (running && generation.get() == epoch) {
                for (key in listOf("smoke", "fire", "medical", "shooting")) {
                    hudThreats[key] = if (threats.has(key) && !threats.isNull(key)) threats.optBoolean(key) else null
                }
                lastHudAt = SystemClock.elapsedRealtime()
                refreshHud()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        hudHandler.post(hudTick)
    }

    private fun triggerThreatFeedback() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator.vibrate(
                    VibrationEffect.createWaveform(longArrayOf(0, 200, 100, 200), -1)
                )
            } else {
                @Suppress("DEPRECATION")
                val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                @Suppress("DEPRECATION")
                vibrator.vibrate(400)
            }
        } catch (_: Exception) {}
    }

    private fun startTransmission() {
        val base: String
        try {
            base = LaptopAddress.parse(address.text.toString())
        } catch (error: Exception) {
            status.text = error.message ?: "Check the laptop address."
            return
        }
        val code = pairingCode.text.toString().trim()
        if (!code.matches(Regex("[0-9]{8}"))) {
            status.text = "Enter the laptop's 8-digit pairing code."
            return
        }

        settings = Settings(base, code)
        getPreferences(MODE_PRIVATE).edit().putString("laptop", base.removePrefix("http://")).apply()
        session = null
        sent = 0
        nextFrameAt = 0

        val epoch = generation.incrementAndGet()
        running = true
        address.isEnabled = false
        pairingCode.isEnabled = false
        action.text = "Stop streaming"
        status.text = "Opening camera & microphone…"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Initialize AudioStreamer (spliced audio pipeline)
        audioStreamer = AudioStreamer(
            getBaseUrl = { settings?.base },
            getPairingCode = { settings?.code },
            getSessionId = { session },
            onResult = { result ->
                runOnUiThread {
                    if (running && generation.get() == epoch) {
                        handleAudioResult(result)
                    }
                }
            },
            onError = { errMsg ->
                runOnUiThread {
                    if (running && generation.get() == epoch) {
                        audioBadge.text = "Audio: $errMsg"
                    }
                }
            }
        )
        audioStreamer?.start()

        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            if (!running || generation.get() != epoch) return@addListener
            try {
                val provider = future.get()
                cameraProvider = provider
                bindCameraWhenReady(provider, epoch)
            } catch (error: Exception) {
                stopTransmission("Could not open camera: ${error.message}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun cancelPendingCameraLayout() {
        pendingCameraLayout?.let { preview.removeOnLayoutChangeListener(it) }
        pendingCameraLayout = null
    }

    private fun bindCameraWhenReady(provider: ProcessCameraProvider, epoch: Int) {
        if (!running || generation.get() != epoch) return
        val rotation = preview.display?.rotation
        val viewPort = if (rotation != null) preview.viewPort else null
        if (rotation == null || viewPort == null) {
            cancelPendingCameraLayout()
            status.text = "Waiting for camera preview layout…"
            val listener = object : View.OnLayoutChangeListener {
                override fun onLayoutChange(view: View, left: Int, top: Int, right: Int, bottom: Int,
                                            oldLeft: Int, oldTop: Int, oldRight: Int, oldBottom: Int) {
                    preview.removeOnLayoutChangeListener(this)
                    if (pendingCameraLayout === this) pendingCameraLayout = null
                    if (running && generation.get() == epoch) bindCameraWhenReady(provider, epoch)
                }
            }
            pendingCameraLayout = listener
            preview.addOnLayoutChangeListener(listener)
            return
        }
        cancelPendingCameraLayout()
        try {
            val aspectRatio = AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
            val cameraPreview = Preview.Builder()
                .setTargetRotation(rotation)
                .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(aspectRatio).build())
                .build().also { it.surfaceProvider = preview.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setTargetRotation(rotation)
                .setResolutionSelector(
                    ResolutionSelector.Builder()
                        .setAspectRatioStrategy(aspectRatio)
                        .setResolutionStrategy(
                            ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)
                        ).build()
                )
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(analysisExecutor) { image -> analyze(image, epoch) }
            // A shared viewport makes the preview and uploaded image cover the
            // same sensor area even when their selected resolutions differ.
            val useCases = UseCaseGroup.Builder()
                .setViewPort(viewPort)
                .addUseCase(cameraPreview)
                .addUseCase(analysis)
                .build()
            provider.unbindAll()
            provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, useCases)
            status.text = "Connecting to laptop gateway…"
        } catch (error: Exception) {
            stopTransmission("Could not open camera: ${error.message}")
        }
    }

    private fun handleAudioResult(result: AudioAlertResult) {
        lastAudioAt = SystemClock.elapsedRealtime()
        audioAlert = result.alert
        audioClass = result.classification
        audioConfidence = result.confidence
        val pct = (result.confidence * 100).toInt()
        if (result.alert) {
            audioBadge.text = "Audio: ⚠️ ${result.classification} ($pct%)"
            audioBadge.setTextColor(Color.rgb(239, 68, 68))
            triggerThreatFeedback()
        } else {
            audioBadge.text = "Audio: Clear"
            audioBadge.setTextColor(Color.rgb(167, 243, 208))
        }
        refreshHud()
    }

    private fun analyze(image: ImageProxy, epoch: Int) {
        val config = settings
        if (!running || generation.get() != epoch || config == null || SystemClock.elapsedRealtime() < nextFrameAt) {
            image.close()
            return
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
                showStatus(epoch, "Connected. Streaming live video & audio…")
            } catch (error: Exception) {
                handleNetworkFailure(error, epoch)
            }
            return
        }

        var bitmap: Bitmap? = null
        var cropped: Bitmap? = null
        var rotated: Bitmap? = null
        var prepared: Bitmap? = null
        var imageClosed = false

        try {
            // Snapshot CameraX's crop and rotation while ImageProxy is open.
            // cropRect is in unrotated image coordinates, so cropping must come
            // before rotation for both inference and the uploaded JPEG.
            val crop = image.cropRect
            val geometry = CameraFrameGeometry.calculate(image.width, image.height,
                crop.left, crop.top, crop.right, crop.bottom, image.imageInfo.rotationDegrees)
            val originalBitmap = image.toBitmap()
            bitmap = originalBitmap
            image.close()
            imageClosed = true

            val croppedBitmap = Bitmap.createBitmap(originalBitmap, geometry.cropLeft, geometry.cropTop,
                geometry.cropWidth, geometry.cropHeight)
            cropped = croppedBitmap
            rotated = if (geometry.rotationDegrees == 0) croppedBitmap else Bitmap.createBitmap(
                croppedBitmap, 0, 0, croppedBitmap.width, croppedBitmap.height,
                Matrix().apply { postRotate(geometry.rotationDegrees.toFloat()) }, true
            )

            val frameBitmap = checkNotNull(rotated)

            // 1. Run on-device YOLO11 TFLite inference if model is present
            if (gunDetector.isModelLoaded) {
                val (detections, inferenceMs) = gunDetector.predict(frameBitmap)
                val numGuns = detections.size

                runOnUiThread {
                    if (running && generation.get() == epoch) {
                        if (numGuns > 0) {
                            val maxConf = (detections.maxOf { it.confidence } * 100).toInt()
                            lastGunAt = SystemClock.elapsedRealtime()
                            lastGunConfidence = detections.maxOf { it.confidence }
                            cnnBadge.text = "Video CNN: ⚠️ GUN DETECTED ($maxConf%) [${inferenceMs.toInt()}ms]"
                            cnnBadge.setTextColor(Color.rgb(239, 68, 68))
                            triggerThreatFeedback()
                        } else {
                            cnnBadge.text = "Video CNN: Clear [${inferenceMs.toInt()}ms]"
                            cnnBadge.setTextColor(Color.rgb(147, 197, 253))
                        }
                        refreshHud()
                    }
                }

                // Send detections upstream to server asynchronously
                if (!detectionUploading && SystemClock.elapsedRealtime() >= nextDetectionAt) {
                    detectionUploading = true
                    nextDetectionAt = SystemClock.elapsedRealtime() + 500
                    detectionUploadExecutor.execute {
                        try {
                            val payload = JSONObject().apply {
                                val arr = JSONArray()
                                for (d in detections) {
                                    arr.put(JSONObject().apply {
                                        put("box", JSONArray(d.box))
                                        put("confidence", d.confidence)
                                        put("label", d.label)
                                    })
                                }
                                put("detections", arr)
                                put("inferenceMs", inferenceMs)
                            }.toString()
                            sendJson(config, "/api/camera/detection", activeSession, payload)
                        } catch (_: Exception) {
                            // Retried with the latest model result; never grow an upload queue.
                        } finally { detectionUploading = false }
                    }
                }
            }

            // 2. Prepare frame for live CCTV feed
            val preparedBitmap = if (frameBitmap.width != geometry.jpegWidth || frameBitmap.height != geometry.jpegHeight) {
                Bitmap.createScaledBitmap(frameBitmap, geometry.jpegWidth, geometry.jpegHeight, true)
            } else frameBitmap
            prepared = preparedBitmap

            val bytes = ByteArrayOutputStream().use { output ->
                check(preparedBitmap.compress(Bitmap.CompressFormat.JPEG, 75, output)) { "Could not encode camera image" }
                output.toByteArray()
            }

            if (!running || generation.get() != epoch) return
            val frameResponse = send(config, "/api/camera/frame", activeSession, bytes)
            lastGatewayAt = SystemClock.elapsedRealtime()
            receiveHud(frameResponse, epoch)
            if (!running || generation.get() != epoch) return

            sent++
            nextFrameAt = SystemClock.elapsedRealtime() + 100 // ~10 FPS
            showStatus(epoch, "Streaming live · $sent frames delivered to server")
        } catch (error: Exception) {
            handleNetworkFailure(error, epoch)
        } finally {
            if (!imageClosed) image.close()
            // Bitmap creation may return its source unchanged. Recycle each
            // distinct allocation only after inference and JPEG encoding finish.
            for (buffer in arrayOf(prepared, rotated, cropped, bitmap)) {
                if (buffer != null && !buffer.isRecycled) buffer.recycle()
            }
        }
    }

    private fun handleNetworkFailure(error: Exception, epoch: Int) {
        if (generation.get() != epoch || !running) return
        session = null
        lastGatewayAt = 0
        nextFrameAt = SystemClock.elapsedRealtime() + 1000
        if (error is ReceiverError && error.httpCode == 401) {
            runOnUiThread {
                if (generation.get() == epoch) stopTransmission("Pairing code rejected. Check laptop's code.")
            }
        } else {
            showStatus(epoch, "Reconnecting… ${error.message ?: "Check Wi-Fi and server."}")
        }
    }

    private fun showStatus(epoch: Int, text: String) {
        runOnUiThread {
            if (running && generation.get() == epoch) status.text = text
        }
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
            batteryPercentage()?.let { request.setRequestProperty("X-Camera-Battery", it.toString()) }
            request.setRequestProperty("X-Camera-Network", networkKind())
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

    private fun sendJson(config: Settings, path: String, sessionId: String, jsonString: String) {
        val request = URL(config.base + path).openConnection(Proxy.NO_PROXY) as HttpURLConnection
        try {
            request.connectTimeout = 1500
            request.readTimeout = 1500
            request.requestMethod = "POST"
            request.setRequestProperty("X-Camera-Token", config.code)
            batteryPercentage()?.let { request.setRequestProperty("X-Camera-Battery", it.toString()) }
            request.setRequestProperty("X-Camera-Network", networkKind())
            request.setRequestProperty("X-Camera-Session", sessionId)
            request.setRequestProperty("Content-Type", "application/json")
            request.doOutput = true
            val bytes = jsonString.toByteArray(Charsets.UTF_8)
            request.setFixedLengthStreamingMode(bytes.size)
            request.outputStream.use { it.write(bytes) }
            request.responseCode
        } finally {
            request.disconnect()
        }
    }

    private fun stopTransmission(message: String = "Streaming stopped.") {
        permissionPending = false
        running = false
        lastGatewayAt = 0
        lastHudAt = 0
        lastGunAt = 0
        lastGunConfidence = 0.0f
        lastAudioAt = 0
        audioAlert = false
        audioClass = ""
        audioConfidence = 0.0f
        hudThreats.clear()
        generation.incrementAndGet()
        cancelPendingCameraLayout()

        val oldSession = session
        val oldSettings = settings
        session = null
        settings = null

        audioStreamer?.stop()
        audioStreamer = null

        connection?.disconnect()
        cameraProvider?.unbindAll()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        address.isEnabled = true
        pairingCode.isEnabled = true
        action.text = "Start dual streaming"
        status.text = message
        alertBanner.text = "● SYSTEM NORMAL"
        alertBanner.setTextColor(Color.rgb(52, 211, 153))
        alertBanner.setBackgroundColor(Color.argb(40, 16, 185, 129))
        refreshHud()

        if (oldSession != null && oldSettings != null) {
            stopExecutor.execute {
                runCatching { send(oldSettings, "/api/camera/disconnect", oldSession, null, false) }
            }
        }
    }

    override fun onStop() {
        hudHandler.removeCallbacks(hudTick)
        stopTransmission()
        super.onStop()
    }

    override fun onDestroy() {
        hudHandler.removeCallbacks(hudTick)
        analysisExecutor.shutdown()
        stopExecutor.shutdown()
        detectionUploadExecutor.shutdown()
        gunDetector.close()
        super.onDestroy()
    }
}
