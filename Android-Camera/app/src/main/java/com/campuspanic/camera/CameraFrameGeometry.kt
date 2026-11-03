package com.campuspanic.camera

/** CameraX crop coordinates precede sensor rotation; JPEG dimensions follow it. */
internal data class CameraFrameGeometry(
    val cropLeft: Int,
    val cropTop: Int,
    val cropWidth: Int,
    val cropHeight: Int,
    val rotationDegrees: Int,
    val jpegWidth: Int,
    val jpegHeight: Int
) {
    companion object {
        fun calculate(imageWidth: Int, imageHeight: Int, left: Int, top: Int,
                      right: Int, bottom: Int, rotationDegrees: Int,
                      maxLongEdge: Int = 960): CameraFrameGeometry {
            require(imageWidth > 0 && imageHeight > 0 && maxLongEdge > 0)
            require(rotationDegrees in listOf(0, 90, 180, 270))
            val cropLeft = left.coerceIn(0, imageWidth)
            val cropTop = top.coerceIn(0, imageHeight)
            val cropRight = right.coerceIn(0, imageWidth)
            val cropBottom = bottom.coerceIn(0, imageHeight)
            val width = cropRight - cropLeft
            val height = cropBottom - cropTop
            require(width > 0 && height > 0) { "Camera crop is empty." }
            val uprightWidth = if (rotationDegrees % 180 == 0) width else height
            val uprightHeight = if (rotationDegrees % 180 == 0) height else width
            val longest = maxOf(uprightWidth, uprightHeight)
            val jpegWidth = if (longest > maxLongEdge) maxOf(1, (uprightWidth.toLong() * maxLongEdge / longest).toInt()) else uprightWidth
            val jpegHeight = if (longest > maxLongEdge) maxOf(1, (uprightHeight.toLong() * maxLongEdge / longest).toInt()) else uprightHeight
            return CameraFrameGeometry(cropLeft, cropTop, width, height,
                rotationDegrees, jpegWidth, jpegHeight)
        }
    }
}
