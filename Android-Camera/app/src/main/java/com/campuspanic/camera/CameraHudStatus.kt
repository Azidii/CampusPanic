package com.campuspanic.camera

/** A connected upload alone does not confirm that node threat status is current. */
internal object CameraHudStatus {
    fun banner(streaming: Boolean, connected: Boolean, freshStatus: Boolean,
               activeThreats: Collection<String>, audioAlert: Boolean): String = when {
        !streaming -> "NOT STREAMING"
        activeThreats.isNotEmpty() -> activeThreats.joinToString(" / ").uppercase() + " ALERT"
        audioAlert -> "AUDIO ALERT"
        !connected -> "CONNECTING TO CAMPUS CCTV"
        !freshStatus -> "NODE STATUS UNAVAILABLE"
        else -> "NO ACTIVE ALERTS REPORTED"
    }
}
