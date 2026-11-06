# CampusPanic security console

The main website uses Express, EJS and MongoDB. Run one website command; it starts
the private Python video/model service automatically. Socket.IO and the browser
webcam broadcaster have been removed. Live frames use authenticated HTTP JPEG
requests; alert and node information refreshes every two seconds.

## Set up on each laptop

1. Install Node.js 22 or newer and Python 3.12 (64 bit). Install MongoDB Community
   locally, or configure a private MongoDB Atlas database.
2. In `DSP-Website`, run `npm install`.
3. Use your existing `DSP-Website/.env`. Keep your existing database connection,
   administrator credentials, JWT secret and device ingest key. No replacement
   environment file is needed. Add optional video settings to that same file
   only when the defaults below do not match your machine.
4. For an independent household, use
   `MONGODB_URI=mongodb://127.0.0.1:27017/mainDB` and start local MongoDB.
   Atlas remains supported through `MONGODB_URI`; it requires internet and the
   laptop's IP must be allowed in Atlas. Database failure stops startup rather
   than silently replacing saved nodes with a temporary database.
5. Run `../Video-Live/Setup-Video.ps1` and `../Audio-Live/Setup-Audio.ps1` once
   to create separate Python environments for video and audio. The audio model
   and classes are included in `Audio-CNN/Audio CNN/Models`. The website uses
   the audio environment automatically; `AUDIO_PYTHON` can select another one.
6. Supply the approved `gun_model.tflite` locally. Either put it at
   `../models/gun_model.tflite` or set `VIDEO_MODEL_PATH` in `.env` to its full path.
   Set `VIDEO_PYTHON` only if using a different Python environment. The existing
   `~/Desktop/CampusPanic_plan/TFlite/gun_model.tflite` is accepted as a compatibility
   fallback on the original laptop. No model download, training or copying occurs.
7. Run `npm run db:check`, then `npm start`. From the repository root, `npm start`
   also starts this website.

If Atlas fails with `querySrv ECONNREFUSED`, Node.js cannot resolve the cluster's
DNS records. Add `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` to the existing `.env` when
those DNS services are reachable on your network, then run `npm run db:check`.
This setting applies only to the application's Node.js process and leaves Windows
network settings unchanged. Leave it unset when your normal resolver works.
The diagnostic uses the same connection settings as startup and does not seed or
delete data. It also works from the repository root. Its success output names the
selected database: an Atlas URI with no database path defaults to `test`; keep the
database that contains your saved nodes when editing the URI.

Open `http://localhost:5000` on the laptop. Initial administrator provisioning
only happens when no administrator exists; changing `.env` does not reset an
existing account. Quick Demo Login and browser credential autofill are removed.

## Optional settings in your existing .env

The original laptop works with the defaults; no additions are required. To make
these settings explicit or use a different laptop, add or update the following
keys in the same existing `.env` (do not duplicate a key that is already present):

- `VIDEO_MODEL_PATH`: full path to the approved model, if outside the supported
  default locations.
- `VIDEO_PYTHON`: full path to the video environment's Python executable, if not
  using `../Video-Live/venv`.
- `VIDEO_WORKER_PORT=5056`: private laptop-only worker port.
- `VIDEO_CONFIDENCE=0.5`: model display threshold.
- `VIDEO_MAX_NODES=8`: maximum simultaneous camera sessions; frame rate depends
  on laptop capacity.

Restart the website after changing environment settings. Your existing `.env`
must explicitly select `/mainDB` after a verified migration. Preserve all unrelated keys.

## Create and connect a security node

1. Sign in as an administrator and open **Security Nodes** (`/security-nodes`).
   Existing `/streamer` bookmarks redirect there.
2. Enter a unique node name, choose **RSY** or **RG Birrey**, and enter the room/location. Map latitude and longitude are
   optional; provide both if placing the node on a map. Click **Create Node & Get
   Pairing Code**.
3. Creation automatically opens **All Cams (CCTV)** and the new node's enlarged
   view, with its generated eight-digit code and the laptop's local IPv4 addresses. Select the actual Wi-Fi address; virtual adapters may
   also appear. Phone and laptop must be on the same local network.
4. In the existing **Campus Panic Camera** Android app, enter
   `LAPTOP_WIFI_IP:5000` (include `:5000`, as the standalone app defaults to 5055),
   enter the code and tap **Start camera**. The existing APK protocol is supported.
   Keep the app open: backgrounding stops its camera.
5. Open **All Cams (CCTV)** (`/cameras`) to watch all registered nodes. Live feeds
   show actual model annotations. Each card has a muted/audio-not-configured
   indicator. Select a feed for its enlarged video, resolution, model output,
   inference time, frame age and connection status.

`localhost` on a phone means the phone itself. Use the laptop's private Wi-Fi
address on the phone. Each household can run its own independent installation;
this setup does not connect different households over the internet. The website
listens on `HOST=0.0.0.0` for LAN access by default. The model worker binds only to
`127.0.0.1:5056`, with a private random service key generated at startup. Windows
may require allowing Node.js on private networks; school Wi-Fi isolation can
prevent phone-to-laptop traffic. No firewall rules or public tunnels are created.

## Edit, reconnect, disconnect and delete

- Click a node in either the CCTV room or Security Nodes. Administrators can edit
  its name, location and optional map position while video continues.
- **Reconnect / Pair Again** ends the previous session and produces a new code.
  Enter the new code in the phone app and start the camera. It cannot remotely
  switch on a stopped phone camera. Only a code's hash is saved, so reopening a
  dialog does not reveal the old code; generate a fresh one when needed.
- Codes permit new connections for ten minutes. Established sessions keep
  working after this expiry; brief interruptions can reconnect while the code is
  valid. After expiry, generate a new code for a new connection.
- **Disconnect** revokes the session and expires its pairing code. **Delete Node**
  asks for confirmation, revokes its session, and deletes its node/camera records.
  Previously recorded incidents remain available under their original node IDs.
- Non-administrator users can view feeds and details but cannot manage nodes or
  pairing. Existing unauthenticated camera-upload endpoints are retired.

## Video behavior and limitations

Each node has its own latest-frame slot, session and detection result. One model
interpreter processes waiting nodes in round-robin order, dropping superseded
frames instead of building latency. `VIDEO_MAX_NODES` defaults to 8 simultaneous
sessions; it is a capacity limit, **not a measured performance guarantee**.
Per-node frame rates depend on the laptop, number of phones and network.

Old video/detections are hidden after three seconds without fresh output. Viewer
requests also check freshness, and the UI clears frames on connection errors.
Continuous frames stay in memory; this feature does not record video. Last-seen
metadata is periodically saved to MongoDB. Saved nodes survive website restarts;
active streams reconnect. Camera connectivity is separate from incident status
(`active` still means an emergency in the existing alert workflow).

In each node's **Audio � ESP32** section, administrators can discover recently
announced ESP32 devices, select a hardware ID and enter the random 8-digit PIN
shown by that device in Serial Monitor (or its future OLED). PINs expire in five
minutes; five failed attempts require a refreshed PIN. Devices must first join
the configured Wi-Fi and announce themselves; this is not a browser LAN scan.

The node owns building/room metadata. Paired physical alerts read the current
location from the database and require a device-specific credential; the ESP32
does not need the website's shared ingest key. Camera pairing remains separate.
**Mute audio** persists per node and shows a microphone-slash icon plus muted
text in node previews and the detail dialog. Manual buttons, armed smoke events,
video and the operator's Audio Siren remain active. Guards can see the state;
administrators can change it. Offline ESP32s are marked stale after 20 seconds.

The Elechouse V3 currently fitted supplies command data, not raw CNN audio. The
UI therefore reports **Raw audio unavailable**, including when paired/unmuted.
There is no live audio capture, audio playback or CNN audio inference in this
pairing feature. Gun detection never claims audio verification.

See `../ESP32/README.md` for `.env`/USB setup. Run
`node --test tests/esp32-pairing.test.mjs` for the isolated pairing/mute/device
isolation tests. The prototype still uses local HTTP and unencrypted board
runtime storage; use a trusted network. No credential or PIN is returned in
discovery or node-list responses.

## Verification

`npm test` uses an **isolated temporary test database**, separate from `.env` and
your actual database. It checks authentication, page rendering, node persistence,
pairing, two synthetic phone inputs through the real model, JPEG viewing,
permissions, safe metadata edits, reconnect, expiry, stale video and deletion
with incident retention. The model and Python environment are required; use
`VIDEO_MODEL_PATH` and `VIDEO_PYTHON` to select them on another machine.

In `Video-Live`, run `./venv/Scripts/python.exe -m unittest discover -v` on Windows.
Thirteen checks cover standalone and multi-node decoding, connection isolation,
capacity, validation, stale output and replacement during inference.

Synthetic checks are not a real-phone latency or accuracy benchmark. Complete a
live check with two phones: connect both to different nodes, confirm current
motion/model annotations in the CCTV room and enlarged view, stop one phone and
verify only that feed clears, reconnect it, edit a node, and delete a disposable
node. Keep this step separate from automated synthetic verification.

The `seed` command deletes existing users, nodes, cameras and alerts. It is only
for disposable demonstrations and is unnecessary for normal node setup.
