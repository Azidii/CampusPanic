# CampusPanic - Device Ingest Protocol Specification

This document specifies the communication contract between ESP32 room nodes / Python laptop verification gateways and the CampusPanic central security station server.

---

## 1. Overview & Architecture

Each room node consists of:
- **Microcontroller**: ESP32 with fixed `nodeId`, `building`, and `room`.
- **Acoustic Sensor**: MAX9814 microphone running an on-device TinyML CNN model for acoustic gunshot classification.
- **Manual Input**: 3-button panel (`medical`, `fire`, `panic`).
- **Vision Verification Gateway**: When an acoustic trigger or button event occurs, a laptop/gateway webcam is triggered. A computer vision firearm classifier evaluates the frame before dispatching the alert packet to the central security station.

---

## 2. Ingest Endpoint

- **Method**: `POST`
- **URL**: `http://<SERVER_HOST>:<PORT>/api/alerts/ingest`
- **Security Header**: `x-device-api-key: <DEVICE_API_KEY>`
- **Content-Type**: `application/json` (or `multipart/form-data` if attaching a raw image file named `image`)

---

## 3. Data Contract (Packet Fields)

| Field | Type | Mandatory? | Description / Values |
|---|---|---|---|
| `nodeId` | String | **Yes** | Unique room node identifier (e.g., `"SC-101"`, `"ENG-205"`). |
| `sequenceNumber`| Integer | **Yes** | Incrementing integer per node for packet tracking and deduplication. |
| `emergencyType` | String | **Yes** | `"gunshot"` \| `"medical"` \| `"fire"` \| `"panic"` |
| `threatStatus` | String | **Yes** | `"verified_threat"` \| `"unverified_audio_trigger"` \| `"manual_alert"` |
| `checksum` | String | **Yes** | Cryptographic hash over canonical packet string (see section 4). |
| `building` | String | Optional | Campus building name (auto-resolved from node record if omitted). |
| `room` | String | Optional | Room/location name (auto-resolved if omitted). |
| `audioConfidence` | Float | Optional | Confidence score from MAX9814 TinyML audio CNN (0.0 to 1.0). |
| `firearmConfidence`| Float | Optional | Confidence score from laptop vision firearm detector (0.0 to 1.0). |
| `image` | String (base64) | Optional | Base64-encoded JPEG/PNG frame captured during trigger. |
| `timestamp` | ISO String | Optional | Packet generation timestamp (defaults to server `Date.now()`). |

---

## 4. Checksum Calculation

To prevent transmission corruption and spoofing, the node or gateway computes a hash over the canonical string:

```
canonicalString = `${nodeId}|${sequenceNumber}|${emergencyType}|${building}|${room}`
```

### Supported Hash Algorithms
1. **SHA-256 Hex** (Full 64 hex characters or 8-character prefix)
2. **MD5 Hex** (Supported natively on ESP32 microcontrollers via mbedTLS / MD5 libraries)
3. **Simple Digest**: `sha256(`${nodeId}:${sequenceNumber}:${emergencyType}`)`

#### ESP32 C++ (Arduino) Example:
```cpp
#include <MD5Builder.h>

String canonical = nodeId + "|" + String(sequenceNumber) + "|" + emergencyType + "|" + building + "|" + room;
MD5Builder md5;
md5.begin();
md5.add(canonical);
md5.calculate();
String checksum = md5.toString();
```

#### Python Gateway Example:
```python
import hashlib

canonical = f"{node_id}|{sequence_number}|{emergency_type}|{building}|{room}"
checksum = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
```

---

## 5. Delivery & Deduplication Behavior

1. **Checksum Validation**:
   - If invalid: Server immediately returns HTTP `400 Bad Request` with:
     ```json
     { "ack": false, "error": "Checksum verification failed" }
     ```

2. **Deduplication (`nodeId` + `sequenceNumber`)**:
   - If packet was already received and stored: Duplicate is ignored in the database, but an affirmative ACK is returned to prevent infinite retries:
     ```json
     { "ack": true, "sequenceNumber": 101, "duplicate": true }
     ```

3. **Success Delivery**:
   - Alert is stored, priority is determined, real-time Socket.IO alert is broadcasted to the security dashboard, and HTTP `201 Created` is returned:
     ```json
     { "ack": true, "sequenceNumber": 101, "alertId": "65e0..." }
     ```

---

## 6. Priority Mapping Rules

- `verified_threat` (Gunshot audio + Firearm vision verified) $\rightarrow$ **Priority 1 (Critical)**
- `manual_alert` (Physical medical, fire, or panic button pressed) $\rightarrow$ **Priority 2 (High)**
- `unverified_audio_trigger` (Suspected audio, firearm negative) $\rightarrow$ **Priority 3 (Warning)**

> **Privacy Notice**: Per the Data Privacy Act compliance implemented on this station, captured images are stored solely during alert activation and purged after the configured retention period (`IMAGE_RETENTION_HOURS`). Real-time live camera streams do not continuously record to disk.
