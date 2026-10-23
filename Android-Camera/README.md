# Campus Panic Camera for Android

A native Kotlin + CameraX app. Enter the laptop's private IPv4 address and
eight-digit pairing code, then tap **Start camera**. The rear camera sends
upright JPEG frames over local Wi-Fi. The laptop runs the gun model and shows
bounding boxes and confidence percentages.

## Install and connect

1. On the laptop, start `Video-Live/Start-PhoneCamera.ps1`. The video environment
   is already installed on this machine. Note the generated pairing code.
2. Connect the phone and laptop to the same Wi-Fi.
3. On the phone, open `http://LAPTOP_WIFI_IP:5055/download/camera.apk` and install
   `CampusPanicCamera-debug.apk`. Android may ask you to allow APK installation
   from that browser.
4. Open **Campus Panic Camera**, enter `LAPTOP_WIFI_IP:5055` and the code.
5. Tap **Start camera** and grant camera access.
6. On the laptop, open `http://localhost:5055` for the annotated feed. Other local
   devices can use `http://LAPTOP_WIFI_IP:5055`.

Find the laptop Wi-Fi address in its network settings; it can change.
The app remembers the address, not the pairing code. The receiver generates
a new code on each start. Keep the app open; leaving it stops the camera.

The APK also resides in `releases/CampusPanicCamera-debug.apk` for USB transfer.
If the local download cannot open, verify Wi-Fi connectivity and Windows
private-network access for the video Python process. No firewall rules were
changed automatically. There is no public hosting, tunnel, or cloud inference.

## Implementation

- Kotlin, CameraX 1.5.3, minimum Android 6.0 (API 23), target API 35.
- Rear camera preview and analysis request about 640 x 480. CameraX may choose
  the nearest supported size. Uploaded frames are upright, bounded to 960
  pixels on the longest side, JPEG quality 75.
- CameraX keeps the latest frame. A single analyzer encodes and uploads one
  image at a time, at most about ten times per second before network delay.
- Pairing code authenticates uploads. Session IDs prevent old requests from
  replacing or stopping a newer connection. Lost connections retry; a wrong
  pairing code stops with an explanatory message.
- Stop, backgrounding, and camera errors release the camera. There is no audio
  permission, background camera service, on-phone model, or saved recording.
- The phone shows upload acknowledgments. Detection boxes appear on the laptop;
  upload acceptance alone does not mean inference has completed.

| Request | Purpose |
| --- | --- |
| `POST /api/camera/connect` | With `X-Camera-Token`; returns session ID |
| `POST /api/camera/frame` | JPEG body, token, and `X-Camera-Session`; returns 202 |
| `POST /api/camera/disconnect` | Closes only the matching session |

## Build and verification

Open this directory in Android Studio, or use the Gradle wrapper with Android
platform 35, build tools 35.0.0, and a compatible JDK (17 or newer; 22 was tested).
Configure the SDK in `local.properties` or `ANDROID_HOME`.

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

Generated APK: `app/build/outputs/apk/debug/app-debug.apk`. To enable the local
download endpoint, copy it to `releases/CampusPanicCamera-debug.apk` (create the
`releases` directory if needed). APKs are build outputs and are excluded from Git.
Pinned tooling: Android Gradle plugin 8.9.2, Kotlin 2.1.10, Gradle 8.11.1.
Task build tools/caches reside in the chat workspace, outside the website.

On October 23, 2026, the APK compiled, two address-validation tests passed,
and Android lint completed without errors. Nine Python checks passed against
the actual detector on synthetic inputs, including upload authentication,
session isolation, expiry, reconnect, box mapping, and the earlier MJPEG mode.

The user confirmed that the Android-to-laptop live pipeline works. Laptop
inference was observed receiving real phone frames. Full visible delay has not
been benchmarked. The prior model-quality test is accepted.
Website integration is the next milestone. Website source files remain
unchanged, and audio remains out of scope.

References: [CameraX image analysis](https://developer.android.com/media/camera/camerax/analyze),
[CameraX releases](https://developer.android.com/jetpack/androidx/releases/camera),
[Android build compatibility](https://developer.android.com/build/releases/agp-8-9-0-release-notes).
