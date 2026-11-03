package com.campuspanic.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CameraFrameGeometryTest {
    @Test fun sensorCropIsAppliedBeforePortraitRotation() {
        // A 4:3 center viewport inside a 16:9 sensor image. Its horizontal
        // sensor offset must remain horizontal until the bitmap is rotated.
        val frame = CameraFrameGeometry.calculate(1920, 1080, 240, 0, 1680, 1080, 90)
        assertEquals(240, frame.cropLeft)
        assertEquals(0, frame.cropTop)
        assertEquals(1440, frame.cropWidth)
        assertEquals(1080, frame.cropHeight)
        assertEquals(720, frame.jpegWidth)
        assertEquals(960, frame.jpegHeight)
    }

    @Test fun unchangedFullFrameKeepsItsSizeWithoutUpscaling() {
        val frame = CameraFrameGeometry.calculate(640, 480, 0, 0, 640, 480, 0)
        assertEquals(640, frame.jpegWidth)
        assertEquals(480, frame.jpegHeight)
        val upsideDown = CameraFrameGeometry.calculate(640, 480, 0, 0, 640, 480, 180)
        assertEquals(frame.jpegWidth, upsideDown.jpegWidth)
        assertEquals(frame.jpegHeight, upsideDown.jpegHeight)
    }

    @Test fun extremeCropNeverProducesAZeroPixelJpegEdge() {
        val frame = CameraFrameGeometry.calculate(1, 2000, 0, 0, 1, 2000, 270)
        assertEquals(960, frame.jpegWidth)
        assertEquals(1, frame.jpegHeight)
    }

    @Test fun cropIsBoundedToImageAndEmptyCropsAreRejected() {
        val frame = CameraFrameGeometry.calculate(640, 480, -20, -10, 700, 500, 0)
        assertEquals(0, frame.cropLeft)
        assertEquals(0, frame.cropTop)
        assertEquals(640, frame.cropWidth)
        assertEquals(480, frame.cropHeight)
        assertThrows(IllegalArgumentException::class.java) {
            CameraFrameGeometry.calculate(640, 480, 400, 0, 200, 480, 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            CameraFrameGeometry.calculate(640, 480, 0, 0, 640, 480, 45)
        }
    }
}
