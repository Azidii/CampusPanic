package com.campuspanic.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

data class GunDetection(
    val box: IntArray, // [x1, y1, x2, y2]
    val confidence: Float,
    val label: String = "gun"
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is GunDetection) return false
        return box.contentEquals(other.box) && confidence == other.confidence && label == other.label
    }

    override fun hashCode(): Int {
        var result = box.contentHashCode()
        result = 31 * result + confidence.hashCode()
        result = 31 * result + label.hashCode()
        return result
    }
}

class GunDetector(
    context: Context,
    private val modelAsset: String = "gun_model.tflite",
    var threshold: Float = 0.50f,
    private val iouThreshold: Float = 0.45f
) {
    companion object {
        private const val TAG = "GunDetector"
        const val INPUT_SIZE = 640
    }

    private var interpreter: Interpreter? = null
    var isModelLoaded = false
        private set

    private val inputBuffer = ByteBuffer.allocateDirect(1 * 3 * INPUT_SIZE * INPUT_SIZE * 4).apply {
        order(ByteOrder.nativeOrder())
    }
    private val outputBuffer = Array(1) { Array(5) { FloatArray(8400) } }

    init {
        try {
            val assetFileDescriptor = context.assets.openFd(modelAsset)
            val inputStream = FileInputStream(assetFileDescriptor.fileDescriptor)
            val fileChannel = inputStream.channel
            val startOffset = assetFileDescriptor.startOffset
            val declaredLength = assetFileDescriptor.declaredLength
            val modelByteBuffer = fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)

            val options = Interpreter.Options().apply {
                numThreads = 4
            }
            interpreter = Interpreter(modelByteBuffer, options)
            isModelLoaded = true
            Log.i(TAG, "YOLO11 gun detection model loaded successfully from assets/$modelAsset")
        } catch (e: Exception) {
            Log.w(TAG, "On-device gun_model.tflite not found in assets or failed to load: ${e.message}. Running in camera-only streaming mode.")
            isModelLoaded = false
        }
    }

    private data class Letterbox(
        val bitmap: Bitmap,
        val ratio: Float,
        val left: Int,
        val top: Int
    )

    private fun letterbox(frame: Bitmap, size: Int = INPUT_SIZE): Letterbox {
        val w = frame.width
        val h = frame.height
        val ratio = min(size.toFloat() / h, size.toFloat() / w)
        val nw = (w * ratio).roundToInt()
        val nh = (h * ratio).roundToInt()
        val left = (size - nw) / 2
        val top = (size - nh) / 2

        val scaled = Bitmap.createScaledBitmap(frame, nw, nh, true)
        val padded = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(padded)
        canvas.drawColor(Color.rgb(114, 114, 114))
        canvas.drawBitmap(scaled, left.toFloat(), top.toFloat(), null)
        if (scaled !== frame) scaled.recycle()

        return Letterbox(padded, ratio, left, top)
    }

    fun predict(frame: Bitmap): Pair<List<GunDetection>, Float> {
        val activeInterpreter = interpreter
        if (!isModelLoaded || activeInterpreter == null) {
            return Pair(emptyList(), 0f)
        }

        val startTime = System.nanoTime()
        val lb = letterbox(frame, INPUT_SIZE)
        val padded = lb.bitmap

        // Convert Bitmap to float32 CHW [1, 3, 640, 640] normalized to [0, 1]
        inputBuffer.rewind()
        val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
        padded.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)

        // CHW layout: R channel block, then G channel block, then B channel block
        for (c in 0 until 3) {
            for (i in 0 until (INPUT_SIZE * INPUT_SIZE)) {
                val pixel = pixels[i]
                val channelVal = when (c) {
                    0 -> ((pixel shr 16) and 0xFF) / 255.0f // Red
                    1 -> ((pixel shr 8) and 0xFF) / 255.0f  // Green
                    else -> (pixel and 0xFF) / 255.0f        // Blue
                }
                inputBuffer.putFloat(channelVal)
            }
        }
        padded.recycle()

        // Run TFLite inference
        activeInterpreter.run(inputBuffer, outputBuffer)
        val inferenceMs = (System.nanoTime() - startTime) / 1_000_000f

        val detections = decode(outputBuffer[0], frame.width, frame.height, lb.ratio, lb.left, lb.top)
        return Pair(detections, inferenceMs)
    }

    private data class Candidate(val x: Float, val y: Float, val w: Float, val h: Float, val score: Float)

    private fun decode(
        output: Array<FloatArray>,
        origWidth: Int,
        origHeight: Int,
        ratio: Float,
        left: Int,
        top: Int
    ): List<GunDetection> {
        val candidates = mutableListOf<Candidate>()
        val numBoxes = 8400

        for (i in 0 until numBoxes) {
            val score = output[4][i]
            if (score >= threshold) {
                val cx = output[0][i] * INPUT_SIZE.toFloat()
                val cy = output[1][i] * INPUT_SIZE.toFloat()
                val bw = output[2][i] * INPUT_SIZE.toFloat()
                val bh = output[3][i] * INPUT_SIZE.toFloat()

                val x = (cx - bw / 2f - left) / ratio
                val y = (cy - bh / 2f - top) / ratio
                val w = bw / ratio
                val h = bh / ratio

                candidates.add(Candidate(x, y, w, h, score))
            }
        }

        if (candidates.isEmpty()) return emptyList()

        // Sort descending by score
        candidates.sortByDescending { it.score }
        val topCandidates = candidates.take(100)

        // Non-Maximum Suppression (NMS)
        val selected = mutableListOf<Candidate>()
        for (c in topCandidates) {
            var keep = true
            for (s in selected) {
                if (computeIoU(c, s) > iouThreshold) {
                    keep = false
                    break
                }
            }
            if (keep) {
                selected.add(c)
                if (selected.size >= 100) break
            }
        }

        val result = mutableListOf<GunDetection>()
        for (c in selected) {
            val x1 = max(0, min(c.x.roundToInt(), origWidth - 1))
            val y1 = max(0, min(c.y.roundToInt(), origHeight - 1))
            val x2 = max(0, min((c.x + c.w).roundToInt(), origWidth - 1))
            val y2 = max(0, min((c.y + c.h).roundToInt(), origHeight - 1))
            if (x2 > x1 && y2 > y1) {
                result.add(GunDetection(intArrayOf(x1, y1, x2, y2), c.score, "gun"))
            }
        }

        return result
    }

    private fun computeIoU(a: Candidate, b: Candidate): Float {
        val x1 = max(a.x, b.x)
        val y1 = max(a.y, b.y)
        val x2 = min(a.x + a.w, b.x + b.w)
        val y2 = min(a.y + a.h, b.y + b.h)
        val interW = max(0f, x2 - x1)
        val interH = max(0f, y2 - y1)
        val inter = interW * interH
        val union = (a.w * a.h) + (b.w * b.h) - inter
        return if (union > 0f) inter / union else 0f
    }

    fun close() {
        interpreter?.close()
        interpreter = null
        isModelLoaded = false
    }
}

