# Camera HUD and manual ESP32 alerts

The web camera overlay and Android preview show real phone battery percentage, network status, and short Smoke, Fire, Medical and Shooting alarm states. Missing or stale battery/network telemetry is shown as unavailable. Smoke is shown unavailable until a smoke event is reported; the system does not infer clean air from a missing report.

## ESP32 role and LEDs

The ESP32 is an outbound event source for the three physical buttons and the MQ-2 smoke detector. It does not receive camera/dashboard commands. Camera or audio detections cannot turn its LEDs on or off.

All three LEDs initialize OFF. A debounced button press latches the assigned local LED ON and submits the original manual alert to the paired website node:

| Alert | Button GPIO | LED GPIO |
| --- | --- | --- |
| Fire | 27 | 32 |
| Medical | 26 | 23 |
| Shooting | 25 | 14 |

The latest pasted sketch uses GPIO23 for MEDICAL. The earlier PCB routes that LED to GPIO33; change the middle LED_PINS value to 33 when using that trace.

After MQ-2 conditioning/calibration, send `a` at 115200 baud to arm it. An active smoke threshold for 500 ms latches the FIRE LED ON and sends a smoke-source fire alert to the website. Releasing or pressing the fire button cannot clear that smoke latch. Use `c` to clear local latches once the armed smoke input is inactive. GPIO34/35 require the PCB voltage dividers; never connect a 5 V sensor output directly to an ESP32 input.

The dashboard and HUD show an incident as On while it is unresolved. Clearing a local LED with `c` does not resolve an existing website incident. Resolving a website incident does not send a command to the ESP32. This distinction keeps the hardware manual, as requested.

## Pairing is unchanged

These files remain byte-for-byte unchanged:

- `routes/espRoutes.js`
- `services/espDevices.js`
- `services/nodePairing.js`
- `models/EspDevice.js`

ESP32 discovery, PIN generation/expiry, pairing, mute, unpairing and physical alert ingestion retain their original behavior. Firmware identity, NVS settings, provisioning and registration code are retained. Security Nodes still owns Add Node and both camera/ESP32 pairing workflows.

## Cameras and threat map

Android frames retain the existing paired camera session and appear directly in CCTV, Cam View and enlarged node views. If laptop inference is unavailable, authenticated raw frames remain viewable and the UI explicitly marks inference unavailable. Expired raw frames are released and are never served without operator authentication.

Gun detections from the Android model or laptop model create deduplicated website incidents. Gunshot audio also creates incidents, with confidence kept on the schema's 0–1 scale. These automatic detections appear on the dashboard and Active Threats Map; they do not command ESP32 hardware. MQ-2 smoke events and physical button events appear on the same map/dashboard through the original ESP32 alert endpoint.

Unresolved incidents remain on the map even when older than the latest 100 feed entries. Nodes without map coordinates appear in the list with a request to configure their location. Sidebar categories follow Main Items, CAMPUS GEOMETRY, GATEWAY TOOLS, SYSTEM & ACCOUNT, and ADMINISTRATION. User Management keeps its existing admin-only access.

## Install

1. Restart the Express application after replacing its source.
2. Install `public/downloads/camera.apk`: version 0.3.0, versionCode 3. The phone/laptop pairing flow is unchanged.
3. Upload `ESP32/ESP32.ino` without erasing flash/NVS. Existing Wi-Fi settings, device token/identity and server-side pairing remain intact.
4. Existing ESP32 pairings do not need to be recreated. After installing/restarting the phone app, enter a current camera pairing code using the original Security Nodes workflow.
5. Select the working OLED profile: Serial `4` = SSD1306 128x64, `5` = SH1106 128x64, `6` = SSD1306 128x32. Set DEFAULT_OLED_PROFILE to retain it after reset. The default SH1106 profile is provisional until checked on the actual display.

## Verification

Tests use isolated MongoDB databases and synthetic sessions. They cover the original pairing behavior, all three manual button event types, smoke reporting, node isolation, camera streaming with/without inference, stale telemetry, automatic detection incidents, deduplication/resolution, navigation and absence of an incoming ESP32 command route. Android compilation, unit tests, lint and APK signing are checked separately. Physical phone/ESP32/MQ-2 acceptance testing is still required; this is a project prototype, not a certified life-safety alarm.
