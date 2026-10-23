# Campus Panic: live Android video milestone

Status on October 23, 2026: native Kotlin camera app and laptop receiver are
implemented. Nine automated Python checks passed with synthetic inputs and the
supplied model; the APK compiled and its unit tests and lint checks passed.
The user has confirmed the real Android pipeline works. Full phone-to-screen
delay has not been benchmarked.
Website integration is the next milestone.
No website source files have been changed. Audio is out of scope for this phase.

## Preferred input: Campus Panic native Android app

A third-party camera app and phone stream URL are no longer required.
See `../Android-Camera/README.md` for the Kotlin app and installable APK.
The phone sends frames to the laptop's local address.

Start the laptop receiver from this directory:

```powershell
.\Start-PhoneCamera.ps1
```

It listens on local port 5055 and prints an eight-digit pairing code. On the
phone, open `http://LAPTOP_WIFI_IP:5055/download/camera.apk` and install the APK.
Enter `LAPTOP_WIFI_IP:5055` plus the code in **Campus Panic Camera**, then tap
**Start camera** and allow camera access. Open `http://localhost:5055` on the laptop
for annotated video. Keep the app open; backgrounding it stops the camera.

Find the laptop Wi-Fi address in its network settings; it can change.
The receiver requires the code and a current session ID, clears old output after
three seconds without new frames, and allows reconnection. Only one phone sends
at a time. The code changes when the receiver restarts. This mode binds to the
local network; it creates no public tunnel or deployment.

## Optional prior input: external Android MJPEG app

1. Install [IP Webcam](https://play.google.com/store/apps/details?id=com.pas.webcam).
2. Connect Android and the laptop to the same private Wi-Fi network.
3. Choose the rear camera, about 640 x 480, and initially 10–15 FPS if available.
4. Disable audio if the app offers it. Leave cloud broadcasting disabled.
5. Tap **Start server** and note the address on the camera screen.
6. Open that address on the laptop to check reachability. The runner accepts the
   base address and automatically appends `/video`, or accepts the full HTTP
   MJPEG URL. This phase supports HTTP MJPEG, not RTSP or browser camera capture.

## Laptop setup and startup

Open PowerShell in this `Video-Live` directory. Run once (requires internet for
dependency installation):

```powershell
.\Setup-Video.ps1
```

Then use the phone's actual address, replacing the example below:

```powershell
.\Start-Video.ps1 -StreamUrl 'http://PHONE_WIFI_IP:8080'
```

Open **http://localhost:5055** on the laptop. Stop with Ctrl+C in the terminal.
Use `-Confidence 0.4` to change the default 50% display threshold if needed.
This threshold is a configurable demonstration setting, not a measured optimum.

To make this standalone preview accessible on the local network:

```powershell
.\Start-Video.ps1 -StreamUrl 'http://PHONE_WIFI_IP:8080' -ShareOnLan
```

Then open `http://LAPTOP_WIFI_IP:5055` on another device. Find the laptop Wi-Fi address in network settings; it can change. Windows may require allowing
Python on private networks. No firewall rules have been changed by this work.
School Wi-Fi client isolation can block device-to-device connections.
There is no public deployment, tunnel, account, or cloud inference.

The setup script uses an available Python installation, or the bundled local
Codex Python runtime when available. Python 3.12 64 bit was tested. Dependencies
are isolated in `venv/`; the model is read from its original path:

`$HOME/Desktop/CampusPanic_plan/TFlite/gun_model.tflite`

The model is neither copied, modified, retrained, nor reconverted.

## What the runner does

- Reads MJPEG frames continuously into a one-frame mailbox; old frames are replaced.
- Loads the model once in one inference worker, shared across all viewers.
- Letterboxes to 640 x 640 with padding value 114, converts BGR to RGB, scales
  values to 0–1, and uses the inspected NCHW input `[1,3,640,640]`, float32.
- Decodes normalized xywh plus gun score from `[1,5,8400]`, float32, applies NMS
  (IoU 0.45), reverses letterbox coordinates, and draws `gun NN.N%` labels.
- Retries the camera connection after failures. Hides old detection output when
  disconnected or older than three seconds. The preview removes the old image.
- Records laptop arrival/prediction timestamps and inference duration. It cannot
  measure phone capture time or complete motion-to-screen latency by itself.
- Does not record video, capture audio, send emergency messages, or alter alerts.

The embedded metadata identifies YOLO11s, `names: {"0": "gun"}`, detection task,
and `end2end: false`. An unexpected model layout fails explicitly.
The user's prior model quality test is accepted; these checks concern runtime
compatibility and stream handling. Confidence is the model's score.

Local output endpoints, ready for the later Express/React integration:

| Endpoint | Output |
| --- | --- |
| `/` | Standalone laptop test screen |
| `/api/status` | Connection/freshness, boxes, scores, timestamps, processing time |
| `/frame.jpg` | Latest annotated JPEG, or HTTP 503 without fresh output |
| `/video.mjpg` | Annotated MJPEG; closes when output becomes stale/disconnected |

The external MJPEG mode defaults to loopback; native-app mode uses the LAN.
The latest website uses Express/EJS + MongoDB; it should consume these outputs through its existing backend,
keeping its design and same-origin access. That integration is pending the live
milestone and has not been implemented or claimed to work.

## Verification performed

```powershell
.\venv\Scripts\python.exe -m unittest discover -v
```

Nine checks passed with Python 3.12 and the pinned dependencies:

- Letterbox coordinate reversal, threshold filtering, duplicate box suppression.
- Portrait input box mapping.
- Empty and non-finite predictions.
- Local-network URL handling.
- Stale output hides prior detections and refuses to serve the old JPEG.
- Actual model execution on a synthetic blank MJPEG stream, annotated JPEG and
  MJPEG delivery, status output, disconnect detection, and reconnection.
- Native-app pairing, JPEG/body/session validation, old-session isolation, and
  actual model execution on synthetic uploaded JPEGs with expiry and reconnect.

An illustrative synthetic run reported about 83 ms inference time. This is
neither a phone benchmark nor an accuracy evaluation. No new claim about the
model's gun accuracy or real camera performance is made.

## Required live completion check

1. Start the laptop receiver, install the native app, and enter the laptop's
   Wi-Fi address and pairing code. An external phone MJPEG stream is optional.
2. Confirm the laptop preview shows current camera motion.
3. Use the same demonstration example accepted in the prior model test; confirm
   box placement and visible confidence percentages with the actual phone view.
4. Stop the phone camera; verify the preview shows disconnected and removes old
   results. Restart it and verify recovery.
5. Measure visible delay and record the observed throughput.
6. Only then integrate this output into the existing website on the feature branch.

Repository inspection found a clean worktree; `feature/live-video-detection` did
not exist and was created before changes. No commits, resets, stashes, merges,
public hosting, or edits under `sources/` were performed.

Runtime references: [LiteRT](https://developers.google.com/edge/litert/overview),
[Ultralytics TFLite output conventions](https://docs.ultralytics.com/reference/nn/backends/tensorflow).

The GitHub branch contains source code only. Models, APKs, local addresses,
pairing codes, recordings, environments, and keys are excluded. Supply the
approved model locally before starting inference.
