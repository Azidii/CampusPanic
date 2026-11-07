# Campus Panic Camera for Android

A native Kotlin + CameraX app that sends rear-camera video and microphone audio
to the CampusPanic website over local Wi-Fi. The laptop runs the video and audio
models and displays their results in the security console.

## Camera framing update (0.2.1)

The app preview and uploaded frames share one CameraX viewport and display
rotation. CameraX crop bounds are applied before rotation and JPEG resizing,
so the website displays the same field of view as the phone preview. Both
viewers preserve image proportions when fitting the frame.

## Install and connect to the website

1. On the laptop, finish the setup in `../DSP-Website/README.md`, then run
   `npm run db:check` and `npm start` from the repository root.
2. Sign in at `http://localhost:5000`. Open **Security Nodes** and create a node,
   or open an existing node and select **Reconnect / Pair Again**. Keep its
   eight-digit camera pairing code available.
3. Connect the phone and laptop to the same Wi-Fi. On the phone, open
   `http://LAPTOP_WIFI_IP:5000/public/downloads/camera.apk` and install
   **CampusPanicCamera-debug.apk**. Android may ask you to allow APK installation
   from that browser. **Download Android app** is also available on Security
   Nodes and in the node's enlarged view when browsing the website from a phone.
4. Open **Campus Panic Camera**, enter `LAPTOP_WIFI_IP:5000` and the node's code.
   Enter the laptop's Wi-Fi IPv4 address, not `localhost`. An address without a
   port defaults to `5000`.
5. Tap **Start dual streaming** and grant both camera and microphone permissions.
   Keep the app open; backgrounding it stops transmission.
6. On the laptop, open **All Cams (CCTV)** at `http://localhost:5000/cameras`.
   Select the node to view its live feed, connection state and model results.

The phone remembers the laptop address, not the pairing code. Camera codes allow
new connections for ten minutes; an established session continues after that
expiry. Generate a fresh code to pair again after expiry. The laptop's Wi-Fi
address can change when it joins a different network.

If the download cannot open, verify that the website is running, both devices
are on the same network, and the laptop permits Node.js connections on the
private network. The download uses the existing website; no separate APK server
is needed.

## Optional standalone receiver

`../Video-Live/Start-PhoneCamera.ps1` starts the older standalone receiver on port
`5055`. To use it, explicitly enter `LAPTOP_WIFI_IP:5055` and that receiver's
pairing code. Its camera feed is separate from the website's security nodes;
website codes belong to the website receiver on port `5000`.

## Implementation

- Kotlin, CameraX 1.5.3, minimum Android 6.0 (API 23), target API 35.
- Rear camera preview and analysis request about 640 x 480. Uploaded JPEG frames
  are upright, bounded to 960 pixels on the longest side, and encoded at quality
  75. The analyzer keeps the latest frame and sends at most about ten frames per
  second before inference and network delay.
- The microphone sends 16 kHz, mono, 16-bit PCM chunks to the laptop's audio
  model. Camera and microphone permissions are both required by this app.
- Pairing codes authenticate uploads. Session IDs prevent old requests from
  replacing or stopping a newer connection. Lost connections retry; a rejected
  code stops transmission with an explanatory message.
- An optional on-device gun detector uses
  `app/src/main/assets/gun_model.tflite`. If that asset is absent, its badge shows
  that phone inference is off; video still streams and the laptop performs gun
  detection. See `app/src/main/assets/README.md` for the expected tensor format.
- Stop, backgrounding and camera errors release capture. This app has no
  background camera service or saved recording. Upload acceptance alone does
  not mean the laptop has finished inference.

| Request | Purpose |
| --- | --- |
| `POST /api/camera/connect` | Pair with `X-Camera-Token`; returns a session ID |
| `POST /api/camera/frame` | Upload a JPEG with token and session headers |
| `POST /api/camera/audio` | Upload raw PCM; receive an audio classification |
| `POST /api/camera/detection` | Report optional on-device gun detections |
| `POST /api/camera/disconnect` | Close the matching camera session |

## Build and verification

Open this directory in Android Studio, or use the Gradle wrapper with Android
platform 35, build tools 35.0.0 and a compatible JDK. Configure the SDK in
`local.properties` or `ANDROID_HOME`.

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

Generated APK: `app/build/outputs/apk/debug/app-debug.apk`. To make this build
available through the existing website:

```powershell
New-Item -ItemType Directory -Force ../DSP-Website/public/downloads
Copy-Item app/build/outputs/apk/debug/app-debug.apk ../DSP-Website/public/downloads/camera.apk -Force
```

No website restart is required to replace the APK. Generated APK downloads are
excluded from Git. The standalone receiver can instead serve a copy at
`releases/CampusPanicCamera-debug.apk`.

Pinned tooling: Android Gradle plugin 8.9.2, Kotlin 2.1.10 and Gradle 8.11.1.
Address-validation tests cover private IPv4 addresses, the website's default
port, explicit standalone ports and rejection of public or ambiguous addresses.
A real-phone check is still needed after a build: download and install the APK,
pair with a disposable node, confirm live video and microphone classifications,
then stop the app and verify that the feed becomes inactive.


## Version 0.3.0 camera HUD

The camera preview now overlays actual battery/network status and short Smoke, Fire, Medical and Shooting alarm states from the paired node. The same status appears on the web CCTV feeds. Unknown or stale values are shown as unavailable. Android gun detections and laptop inference create web incidents; they do not control ESP32 LEDs. The ESP32 reports its physical buttons and MQ-2 smoke events to the website using the original pairing and alert API. Direct camera viewing also works while laptop inference is unavailable.

## Version 0.3.1 status freshness fix

The phone shows **Node status unavailable** when video uploads succeed but the
paired node's threat status is stale, missing, or incomplete. **No active alerts
reported** requires a current, complete status response. Fresh local video and
audio threats remain visible while the gateway status is unavailable.

The shared camera viewport and image cropping from 0.2.1 remain in place.
Pairing codes, connection endpoints, and session authentication are unchanged.
