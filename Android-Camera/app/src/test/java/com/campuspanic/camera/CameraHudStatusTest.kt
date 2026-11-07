package com.campuspanic.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraHudStatusTest {
    @Test fun acceptedFramesWithoutCurrentNodeStatusDoNotReportClear() {
        assertEquals("NODE STATUS UNAVAILABLE",
            CameraHudStatus.banner(true, true, false, emptyList(), false))
    }

    @Test fun currentClearStatusCanReportNoActiveAlerts() {
        assertEquals("NO ACTIVE ALERTS REPORTED",
            CameraHudStatus.banner(true, true, true, emptyList(), false))
    }

    @Test fun localThreatRemainsVisibleWhenGatewayStatusIsUnavailable() {
        assertEquals("SHOOTING ALERT",
            CameraHudStatus.banner(true, false, false, listOf("Shooting"), false))
        assertEquals("AUDIO ALERT",
            CameraHudStatus.banner(true, true, false, emptyList(), true))
    }

    @Test fun disconnectedAndStoppedSessionsDoNotReportClear() {
        assertEquals("CONNECTING TO CAMPUS CCTV",
            CameraHudStatus.banner(true, false, false, emptyList(), false))
        assertEquals("NOT STREAMING",
            CameraHudStatus.banner(false, false, false, listOf("Shooting"), true))
    }
}
