# ESP32 hardware bring-up

Open `ESP32.ino` in Arduino IDE. Select **ESP32 Dev Module** (the schematic is an
ESP32 DevKit V1), choose the actual COM port, upload, and open Serial Monitor at
**115200 baud**. Uses the ESP32 board package only; no extra Arduino libraries.

## Wiring from your schematic

| Function | ESP32 GPIO | Behavior |
| --- | --- | --- |
| Button 1 / LED 1 | 27 / 32 | Manual fire |
| Button 2 / LED 2 | 26 / 33 | Manual medical |
| Button 3 / LED 3 | 25 / 14 | Manual active shooter |
| MQ-2 A0 / D0 | 34 / 35 | Analog telemetry / digital smoke threshold |
| VR3 TXD -> ESP32 RX2 | 16 | Through the schematic's voltage divider |
| ESP32 TX2 -> VR3 RXD | 17 | Module UART, default 9600 baud |
| Future OLED SDA / SCL | 21 / 22 | Example code is entirely commented out |

Buttons connect to ground and use internal pull-ups. LEDs use the schematic's
330-ohm series resistors. LED colors were not specified; assign colors physically.
No battery-management code is required for the shown charger/boost arrangement.
SD storage is unused in this bring-up.

## Test on the board

Serial Monitor substitutes for the missing OLED: readable status at startup,
alerts when a button or armed smoke input triggers, and status on smoke changes.
There is no repeating JSON output. Send `s` to refresh the display. Buttons and
LEDs work independently of Serial Monitor; no Python or website is required.

1. Press each button: its LED turns on and a readable alert prints. Holding the
   button should not repeat. Release turns its LED off after 35 ms of debounce; press again to create another event.
2. Send `c` to clear LEDs, `s` for status, or `h` for help.
   Send `c` first, then `1`, `2`, or `3` to force the corresponding LED ON.
   If this lights the LED, check button wiring. If it does not, check the LED's
   GPIO connection, polarity, series resistor and common GND. The status reports
   commanded state only; it cannot confirm the physical LED is illuminated.
   For a four-leg tactile switch, verify the switched contacts rather
   than connecting two legs that are permanently joined internally.
   If the serial alert prints but the LED stays dark, the button was detected.
   Check the physical LED path and measure GPIO-to-GND voltage: the schematic
   expects about 3.3 V while commanded ON. For a common-anode LED module wired
   to a 3.3 V rail, set `LED_ACTIVE_HIGH=false` in .env and provision again only after
   confirming that wiring; the schematic's individual LEDs use `true`.
3. Smoke detection starts **disarmed** while A0/D0 remain visible. Condition,
   warm up and calibrate your MQ-2 according to its actual module documentation;
   then send `a` to arm. Send `a` again to disarm. D0 must stay active for 500 ms
   to trigger LED1. Confirm `SMOKE_ACTIVE_LOW` against your actual module.
4. Send `v` to enable UART diagnostics and query VR3 settings. Its reply is
   printed as hex chunks; reset the board to hide diagnostics again. No reply:
   check power, crossed TX/RX wiring, divider, and the module's configured baud.
   This sketch does not train, overwrite or map voice records to emergencies.

Smoke/gas detection is a suspected condition, not confirmation of fire. GPIO34/35
cannot use internal pull-ups. Check that both divided MQ-2 signals stay within
the ESP32 input voltage limits; the shown 10k/20k divider puts nominal 5 V near
3.33 V, so verify the actual maximum rather than relying on attenuation settings.
Use this as a demonstration prototype, not a certified life-safety system.

## Audio model: hardware limitation

Elechouse Voice Recognition V3 reports trained command matches over UART. Its
documented protocol does not expose raw microphone recordings to feed your CNN.
Training it on a word or sound does not run the project's TFLite model.

Live CNN audio therefore needs a separate raw-audio microphone. Once its exact
model and wiring are known, add raw audio capture and transfer to the laptop.
The current model pipeline uses 16 kHz mono, one-second clips and the repository's
log-mel preprocessing. Keep inference on the laptop.

To test the actual model with a WAV now, from your Audio-CNN Python environment:

```powershell
python .\test_model.py 'C:\path\to\recording.wav'
```

This reuses `../Audio-CNN/Audio CNN/TFLite/predict_tflite.py` with the FP32 model,
its training preprocessing and `Models/classes.json` (Gunshot, Non-Scream,
Scream). It needs that predictor's existing TensorFlow, NumPy, pandas and SciPy
dependencies. It does not use VR3 input or claim to test microphone hardware.

## Pair an ESP32 to a website node

The website owns the node ID, building and room. Do not put those fields or the
website's shared API key in the ESP32 environment file. `LED_ACTIVE_HIGH=true`
means GPIO HIGH turns the schematic's LED on; false is for confirmed active-low
3.3 V LED wiring. It is a hardware setting, not a website mute control.

1. Fill `ESP32/.env` using `.env.example`: Wi-Fi name/password, `SERVER_URL`
   (for example `http://192.168.254.105:5000`, with no API path), and LED polarity.
   `.env` and its variants stay ignored by Git. No credential header is generated.
2. Upload `ESP32.ino`. Close Serial Monitor and run from the ESP32 folder:

   ```powershell
   powershell -NoProfile -File .\provision.ps1 -Port COM7
   ```

   This reads this device's `.env` over USB and saves runtime settings on the
   board. `-ValidateOnly` checks the file without opening a port. Reconfiguration
   restarts the board and loses pending RAM alerts; do it before use.
3. Start the website/database and open Serial Monitor at **115200 baud**. The
   ESP32 displays its hardware ID and a random **8-digit PIN**. It announces
   itself to the configured website every five seconds. Discovery lists devices
   that announced within 20 seconds; it is not a browser scan of the Wi-Fi subnet.
4. Create/open a security node. Camera pairing stays in Connection Setup. In
   **Audio � ESP32**, scan, select the hardware ID, enter the PIN shown on the
   board, and pair. The PIN expires in five minutes. Send `r` to refresh an
   unpaired PIN. After five wrong attempts, refresh it before trying again.
5. Physical buttons now light their LEDs and send manual alerts to the paired
   node. Armed smoke detection sends a fire-threshold event too. Building/room
   are read from the website database for each event, so node edits apply
   immediately. The third button is a manual active-shooter report stored under
   `gunshot`; it is not AI-confirmed gunshot detection.

## Mute and connection state

An administrator can **Mute audio / Unmute audio** in the Audio section. A
microphone-slash icon and visible **Audio muted** text appear in the dialog and
on node previews. The setting is saved on the node and reaches the board on its
next heartbeat (normally within five seconds). It persists through reconnects.
Manual buttons, LEDs and smoke detection continue while muted. Camera pairing,
video and the separate website alarm sound are unaffected.

With the currently fitted Elechouse V3, the UI says **Raw audio unavailable**
even when the ESP32 is paired and unmuted. This feature pairs the physical
controller and applies the audio-mute setting; it does not invent PCM audio or
CNN predictions. VR3 diagnostic UART output is suppressed while audio is muted.
A separate raw-audio microphone remains necessary for live CNN audio input.

Only administrators can pair, disconnect or change shared monitoring settings;
guards can see connectivity and mute state. Each node can have one ESP32, and
each ESP32 can belong to one node. Disconnect before replacing it. Deleting a
node unbinds its ESP32 while preserving incidents. A new PIN is needed to pair
again. If the device stops checking in for 20 seconds, the UI reports offline.

## Delivery and credential limits

The board generates its own random device credential and stores it in runtime
Preferences; only its hash is stored on the website. It is not a shared website
key, a source-code constant, or an entry printed to Serial. PIN hashes are
stored server-side; discovery responses never expose PINs or credentials.

Wi-Fi and delivery run in a separate task. The pending queue holds up to 16
physical events in RAM, uses persisted sequence numbers to avoid duplicates,
and reports failures in Serial. Pending alerts are lost on reset/power loss;
alerts for a previous node binding are discarded instead of being assigned to
another location. Do not erase flash or reuse identities without considering
sequence history. Unpaired devices still operate LEDs/buttons locally but
cannot send an event to a website node until paired.

This remains a trusted-LAN prototype: HTTP and device flash are not encrypted.
`.env`/Git ignore prevent accidental source commits, not physical credential
extraction or network interception. Live audio capture and transport, HTTPS,
flash encryption and physical wiring still require separate verification.

## Checks

- `powershell -NoProfile -File .\tests\provision-env.test.ps1`
- `node --test .\tests\manual-alert.test.mjs` (legacy ingest compatibility)
- From DSP-Website: `node --test tests/esp32-pairing.test.mjs tests/config-env.test.mjs`

The API tests use a temporary database and synthetic devices, not real incidents.
Firmware self-checks cover debounce, field validation, JSON escaping and hashing.
