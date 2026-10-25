package com.campuspanic.camera

import android.Manifest
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.SystemClock
import android.text.InputFilter
import android.text.InputType
import android.util.Size
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
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
    private lateinit var panel: LinearLayout
    private lateinit var headerTitle: TextView
    private lateinit var headerSubtitle: TextView
    private lateinit var themeButton: TextView
    private lateinit var preview: PreviewView
    private lateinit var previewCard: FrameLayout
    private lateinit var previewTitle: TextView
    private lateinit var previewSubtitle: TextView
    private lateinit var connectionTitle: TextView
    private lateinit var addressLabel: TextView
    private lateinit var pairingLabel: TextView
    private lateinit var address: EditText
    private lateinit var pairingCode: EditText
    private lateinit var action: Button
    private lateinit var status: TextView
    private lateinit var statusCard: LinearLayout
    private lateinit var note: TextView
    private lateinit var connectionCard: LinearLayout

    private var darkMode = true

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

    private val requestCamera =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val shouldStart = permissionPending
            permissionPending = false
            if (granted && shouldStart) startTransmission()
            else status.text = "Camera permission is needed to send video."
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        darkMode = getPreferences(MODE_PRIVATE).getBoolean("dark_mode", true)

        val root = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
        }

        panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(24))
        }

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        root.addView(
            panel,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val logo = TextView(this).apply {
            text = "CP"
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = rounded(Color.rgb(37, 99, 235), 16)
        }
        header.addView(logo, LinearLayout.LayoutParams(dp(48), dp(48)))

        val headerTexts = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(4), 0)
        }
        headerTitle = label("CampusPanic", 23, Color.WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD
        }
        headerSubtitle = label("Camera monitoring", 13, Color.LTGRAY)
        headerTexts.addView(headerTitle)
        headerTexts.addView(headerSubtitle)
        header.addView(
            headerTexts,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )

        // Icon-only theme button: tap the sun/moon to switch appearance.
        themeButton = TextView(this).apply {
            textSize = 25f
            gravity = Gravity.CENTER
            contentDescription = "Toggle light or dark mode"
            background = rounded(Color.rgb(30, 41, 59), 14)
            setOnClickListener {
                darkMode = !darkMode
                getPreferences(MODE_PRIVATE).edit().putBoolean("dark_mode", darkMode).apply()
                applyTheme()
            }
        }
        header.addView(
            themeButton,
            LinearLayout.LayoutParams(dp(46), dp(46)).apply { leftMargin = dp(8) }
        )
        panel.addView(header)

        addSpace(panel, 20)

        // Camera preview section
        val previewHeading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        previewTitle = label("Live camera", 18, Color.WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD
        }
        previewSubtitle = label("Rear camera · Video only", 13, Color.LTGRAY)
        previewHeading.addView(previewTitle)
        previewHeading.addView(previewSubtitle)
        panel.addView(previewHeading)

        addSpace(panel, 12)

        previewCard = FrameLayout(this).apply {
            background = rounded(Color.BLACK, 18, Color.rgb(51, 65, 85), dp(1))
            clipToOutline = true
        }
        preview = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.BLACK)
        }
        previewCard.addView(
            preview,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        panel.addView(
            previewCard,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(250)
            )
        )

        addSpace(panel, 20)

        // Connection details card
        connectionCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = rounded(Color.DKGRAY, 18)
        }

        connectionTitle = label("Laptop connection", 17, Color.WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD
        }
        connectionCard.addView(connectionTitle)
        addSpace(connectionCard, 14)

        addressLabel = label("Laptop Wi-Fi address", 13, Color.LTGRAY)
        connectionCard.addView(addressLabel)
        addSpace(connectionCard, 6)

        address = EditText(this).apply {
            hint = "LAPTOP_WIFI_IP:5055"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(getPreferences(MODE_PRIVATE).getString("laptop", ""))
            textSize = 15f
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        connectionCard.addView(
            address,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        addSpace(connectionCard, 14)

        pairingLabel = label("8-digit pairing code shown on the laptop", 13, Color.LTGRAY)
        connectionCard.addView(pairingLabel)
        addSpace(connectionCard, 6)

        pairingCode = EditText(this).apply {
            hint = "Enter pairing code"
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(8))
            setSingleLine(true)
            textSize = 15f
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        connectionCard.addView(
            pairingCode,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        addSpace(connectionCard, 16)

        action = Button(this).apply {
            text = "Start camera"
            isAllCaps = false
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            minHeight = dp(52)
            setOnClickListener {
                if (running) {
                    stopTransmission()
                } else if (
                    ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.CAMERA
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    permissionPending = true
                    requestCamera.launch(Manifest.permission.CAMERA)
                } else {
                    startTransmission()
                }
            }
        }
        connectionCard.addView(
            action,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )
        panel.addView(connectionCard)

        addSpace(panel, 14)

        // Connection status
        statusCard = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = rounded(Color.DKGRAY, 14)
        }

        val statusDot = TextView(this).apply {
            text = "●"
            textSize = 14f
            setTextColor(Color.rgb(56, 189, 248))
        }
        statusCard.addView(statusDot)
        status = label(
            "Connect this phone and the laptop to the same Wi-Fi.",
            13,
            Color.rgb(56, 189, 248)
        ).apply {
            setPadding(dp(9), 0, 0, 0)
        }
        statusCard.addView(
            status,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )
        panel.addView(statusCard)

        addSpace(panel, 12)

        note = label(
            "Video only · No audio · Detection runs on the laptop\nKeep this screen open while streaming.",
            12,
            Color.LTGRAY
        )
        panel.addView(note)

        setContentView(root)
        applyTheme()
    }

    private fun applyTheme() {
        val background = if (darkMode) Color.rgb(11, 18, 32) else Color.rgb(246, 248, 252)
        val surface = if (darkMode) Color.rgb(17, 24, 39) else Color.WHITE
        val primaryText = if (darkMode) Color.rgb(248, 250, 252) else Color.rgb(15, 23, 42)
        val secondaryText = if (darkMode) Color.rgb(148, 163, 184) else Color.rgb(100, 116, 139)
        val fieldBackground = if (darkMode) Color.rgb(30, 41, 59) else Color.rgb(241, 245, 249)
        val border = if (darkMode) Color.rgb(51, 65, 85) else Color.rgb(203, 213, 225)
        val statusBackground = if (darkMode) Color.rgb(15, 35, 57) else Color.rgb(230, 244, 255)
        val accent = Color.rgb(37, 99, 235)

        panel.setBackgroundColor(background)
        headerTitle.setTextColor(primaryText)
        headerSubtitle.setTextColor(secondaryText)
        // Show the opposite theme's icon as the action available to the user.
        themeButton.text = if (darkMode) "☀" else "☾"
        themeButton.contentDescription = if (darkMode) "Switch to light mode" else "Switch to dark mode"
        themeButton.setTextColor(if (darkMode) Color.rgb(253, 224, 71) else Color.rgb(37, 99, 235))
        themeButton.background = rounded(surface, 14, border, dp(1))

        previewTitle.setTextColor(primaryText)
        previewSubtitle.setTextColor(secondaryText)
        previewCard.background = rounded(Color.BLACK, 18, border, dp(1))

        connectionCard.background = rounded(surface, 18, border, dp(1))
        connectionTitle.setTextColor(primaryText)
        addressLabel.setTextColor(secondaryText)
        pairingLabel.setTextColor(secondaryText)

        listOf(address, pairingCode).forEach { field ->
            field.setTextColor(primaryText)
            field.setHintTextColor(secondaryText)
            field.background = rounded(fieldBackground, 12, border, dp(1))
        }

        action.background = rounded(accent, 14)
        action.backgroundTintList = ColorStateList.valueOf(accent)
        action.setTextColor(Color.WHITE)

        statusCard.background = rounded(statusBackground, 14)
        status.setTextColor(if (darkMode) Color.rgb(125, 211, 252) else Color.rgb(3, 105, 161))
        note.setTextColor(secondaryText)
    }

    private fun rounded(
        color: Int,
        radiusDp: Int,
        strokeColor: Int? = null,
        strokeWidthPx: Int = 0
    ): GradientDrawable {
        return GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeColor != null && strokeWidthPx > 0) {
                setStroke(strokeWidthPx, strokeColor)
            }
        }
    }

    private fun addSpace(parent: LinearLayout, heightDp: Int) {
        parent.addView(
            android.view.View(this),
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(heightDp)
            )
        )
    }

    private fun label(value: String, sp: Int, color: Int) =
        TextView(this).apply {
            text = value
            textSize = sp.toFloat()
            setTextColor(color)
        }

    private fun dp(value: Int) =
        (value * resources.displayMetrics.density).toInt()

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
        getPreferences(MODE_PRIVATE).edit()
            .putString("laptop", base.removePrefix("http://"))
            .apply()

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
                val cameraPreview = Preview.Builder().build().also {
                    it.surfaceProvider = preview.surfaceProvider
                }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setResolutionStrategy(
                                ResolutionStrategy(
                                    Size(640, 480),
                                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER
                                )
                            )
                            .build()
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                analysis.setAnalyzer(analysisExecutor) { image -> analyze(image, epoch) }
                provider.unbindAll()
                provider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    cameraPreview,
                    analysis
                )
                status.text = "Connecting to laptop…"
            } catch (error: Exception) {
                stopTransmission("Could not open camera: ${error.message}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun analyze(image: ImageProxy, epoch: Int) {
        val config = settings
        if (
            !running ||
            generation.get() != epoch ||
            config == null ||
            SystemClock.elapsedRealtime() < nextFrameAt
        ) {
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
                    stopExecutor.execute {
                        runCatching {
                            send(config, "/api/camera/disconnect", newSession, null, false)
                        }
                    }
                    return
                }
                session = newSession
                nextFrameAt = 0
                showStatus(epoch, "Connected. Sending camera frames…")
            } catch (error: Exception) {
                handleNetworkFailure(error, epoch)
            }
            return
        }

        var bitmap: Bitmap? = null
        var rotated: Bitmap? = null
        var imageClosed = false
        try {
            val rotation = image.imageInfo.rotationDegrees
            bitmap = image.toBitmap()
            image.close()
            imageClosed = true
            rotated = if (rotation == 0) bitmap else Bitmap.createBitmap(
                bitmap,
                0,
                0,
                bitmap.width,
                bitmap.height,
                Matrix().apply { postRotate(rotation.toFloat()) },
                true
            )

            val maxSide = maxOf(rotated.width, rotated.height)
            if (maxSide > 960) {
                val scaled = Bitmap.createScaledBitmap(
                    rotated,
                    rotated.width * 960 / maxSide,
                    rotated.height * 960 / maxSide,
                    true
                )
                if (rotated !== bitmap) rotated.recycle()
                rotated = scaled
            }

            val prepared = checkNotNull(rotated)
            val bytes = ByteArrayOutputStream().use { output ->
                check(prepared.compress(Bitmap.CompressFormat.JPEG, 75, output)) {
                    "Could not encode camera image"
                }
                output.toByteArray()
            }

            if (!running || generation.get() != epoch) return
            send(config, "/api/camera/frame", activeSession, bytes)
            if (!running || generation.get() != epoch) return
            sent++
            nextFrameAt = SystemClock.elapsedRealtime() + 100
            showStatus(epoch, "Sending video · $sent frames received by laptop")
        } catch (error: Exception) {
            handleNetworkFailure(error, epoch)
        } finally {
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
            runOnUiThread {
                if (generation.get() == epoch) {
                    stopTransmission("Pairing code rejected. Check the laptop's code.")
                }
            }
        } else {
            showStatus(
                epoch,
                "Reconnecting… ${error.message ?: "Check Wi-Fi and the laptop receiver."}"
            )
        }
    }

    private fun showStatus(epoch: Int, text: String) {
        runOnUiThread {
            if (running && generation.get() == epoch) status.text = text
        }
    }

    private fun send(
        config: Settings,
        path: String,
        sessionId: String?,
        bytes: ByteArray?,
        track: Boolean = true
    ): String {
        val request =
            URL(config.base + path).openConnection(Proxy.NO_PROXY) as HttpURLConnection
        if (track) connection = request

        try {
            request.connectTimeout = 2000
            request.readTimeout = 2000
            request.instanceFollowRedirects = false
            request.requestMethod = "POST"
            request.setRequestProperty("X-Camera-Token", config.code)
            sessionId?.let { request.setRequestProperty("X-Camera-Session", it) }
            request.setRequestProperty(
                "Content-Type",
                if (bytes != null) "image/jpeg" else "application/octet-stream"
            )
            request.doOutput = true
            request.setFixedLengthStreamingMode(bytes?.size ?: 0)
            request.outputStream.use {
                if (bytes != null) it.write(bytes)
            }

            val code = request.responseCode
            val bodyStream =
                if (code in 200..299) request.inputStream else request.errorStream
            val body = bodyStream?.bufferedReader()?.use { reader ->
                val text = StringBuilder()
                val chars = CharArray(1024)
                while (true) {
                    val count = reader.read(chars)
                    if (count < 0) break
                    if (text.length + count > 8192) {
                        throw IOException("Unexpected laptop response")
                    }
                    text.append(chars, 0, count)
                }
                text.toString()
            } ?: ""

            if (code !in 200..299) {
                val message = runCatching {
                    JSONObject(body).getString("error")
                }.getOrDefault("Laptop returned HTTP $code")
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
            stopExecutor.execute {
                runCatching {
                    send(oldSettings, "/api/camera/disconnect", oldSession, null, false)
                }
            }
        }
    }

    override fun onStop() {
        stopTransmission()
        super.onStop()
    }

    override fun onDestroy() {
        analysisExecutor.shutdown()
        stopExecutor.shutdown()
        super.onDestroy()
    }
}
