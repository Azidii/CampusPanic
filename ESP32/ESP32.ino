#include <Arduino.h>
#include <assert.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <mbedtls/sha256.h>
#include <esp_system.h>
#include <atomic>
#include <Wire.h>
#include <string.h>
#include <stdio.h>

struct ManualEvent;
String makePacket(const ManualEvent &event);
void buildOledFrame();

constexpr uint8_t BUTTON_PINS[] = {27, 26, 25};
// Latest pasted sketch uses GPIO23 for MEDICAL. The supplied PCB routes it
// to GPIO33; change the middle value to 33 if you are using that PCB trace.
constexpr uint8_t LED_PINS[] = {32, 23, 14};
const char *const EMERGENCIES[] = {"FIRE", "MEDICAL", "SHOOTING"};
constexpr uint8_t SMOKE_ANALOG_PIN = 34;
constexpr uint8_t SMOKE_DIGITAL_PIN = 35;
constexpr uint8_t VOICE_RX_PIN = 16; // VR3 TXD through the schematic's divider.
constexpr uint8_t VOICE_TX_PIN = 17; // To VR3 RXD.
constexpr uint32_t VOICE_BAUD = 9600;
constexpr bool SMOKE_ACTIVE_LOW = true; // Confirm your module's D0 polarity.

// OLED mode: 1=SSD1306 128x64, 2=SH1106 128x64, 3=SSD1306 128x32.
// The photo suggests 128x64; exact controller still needs confirmation.
constexpr uint8_t DEFAULT_OLED_PROFILE = 2;
uint8_t oledProfile = DEFAULT_OLED_PROFILE;
uint8_t oledHeight = 64;
uint8_t oledAddress = 0;
bool oledReady = false;
bool oledDirty = true;
bool oledSending = false;
uint8_t oledPage = 0;
uint8_t oledColumn = 0;
uint32_t lastOledUpdate = 0;
uint8_t oledFrame[1024] = {};

bool oledCommands(const uint8_t *data, size_t length) {
  Wire.beginTransmission(oledAddress);
  Wire.write(uint8_t(0x00));
  Wire.write(data, length);
  return Wire.endTransmission() == 0;
}

// Built-in 5x7 font. No external display libraries.
const char OLED_CHARS[] = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/-";
const uint8_t OLED_FONT[][5] = {
  {0,0,0,0,0},
  {0x7E,0x11,0x11,0x11,0x7E}, // A
  {0x7F,0x49,0x49,0x49,0x36}, // B
  {0x3E,0x41,0x41,0x41,0x22}, // C
  {0x7F,0x41,0x41,0x22,0x1C}, // D
  {0x7F,0x49,0x49,0x49,0x41}, // E
  {0x7F,0x09,0x09,0x09,0x01}, // F
  {0x3E,0x41,0x49,0x49,0x7A}, // G
  {0x7F,0x08,0x08,0x08,0x7F}, // H
  {0x00,0x41,0x7F,0x41,0x00}, // I
  {0x20,0x40,0x41,0x3F,0x01}, // J
  {0x7F,0x08,0x14,0x22,0x41}, // K
  {0x7F,0x40,0x40,0x40,0x40}, // L
  {0x7F,0x02,0x0C,0x02,0x7F}, // M
  {0x7F,0x04,0x08,0x10,0x7F}, // N
  {0x3E,0x41,0x41,0x41,0x3E}, // O
  {0x7F,0x09,0x09,0x09,0x06}, // P
  {0x3E,0x41,0x51,0x21,0x5E}, // Q
  {0x7F,0x09,0x19,0x29,0x46}, // R
  {0x46,0x49,0x49,0x49,0x31}, // S
  {0x01,0x01,0x7F,0x01,0x01}, // T
  {0x3F,0x40,0x40,0x40,0x3F}, // U
  {0x1F,0x20,0x40,0x20,0x1F}, // V
  {0x3F,0x40,0x38,0x40,0x3F}, // W
  {0x63,0x14,0x08,0x14,0x63}, // X
  {0x07,0x08,0x70,0x08,0x07}, // Y
  {0x61,0x51,0x49,0x45,0x43}, // Z
  {0x3E,0x51,0x49,0x45,0x3E}, // 0
  {0x00,0x42,0x7F,0x40,0x00}, // 1
  {0x42,0x61,0x51,0x49,0x46}, // 2
  {0x21,0x41,0x45,0x4B,0x31}, // 3
  {0x18,0x14,0x12,0x7F,0x10}, // 4
  {0x27,0x45,0x45,0x45,0x39}, // 5
  {0x3C,0x4A,0x49,0x49,0x30}, // 6
  {0x01,0x71,0x09,0x05,0x03}, // 7
  {0x36,0x49,0x49,0x49,0x36}, // 8
  {0x06,0x49,0x49,0x29,0x1E}, // 9
  {0x00,0x36,0x36,0x00,0x00}, // :
  {0x20,0x10,0x08,0x04,0x02}, // /
  {0x08,0x08,0x08,0x08,0x08}  // -
};
static_assert(sizeof(OLED_FONT) / sizeof(OLED_FONT[0]) == sizeof(OLED_CHARS)-1,
              "OLED font mismatch");

void oledText(uint8_t row, const char *message) {
  if (row >= oledHeight / 8) return;
  uint8_t x = 0;
  while (*message && x <= 122) {
    const char *found = strchr(OLED_CHARS, *message++);
    const size_t index = found ? size_t(found - OLED_CHARS) : 0;
    for (uint8_t col = 0; col < 5; ++col) {
      oledFrame[uint16_t(row) * 128 + x + col] = OLED_FONT[index][col];
    }
    x += 6;
  }
}

void updateOled() { oledDirty = true; }

void beginOled() {
  oledReady = false;
  oledSending = false;
  oledAddress = 0;
  oledHeight = oledProfile == 3 ? 32 : 64;
  if (!Wire.begin(21, 22, 100000)) {
    Serial.println("OLED: I2C startup failed.");
    return;
  }
  Wire.setTimeOut(50);
  delay(100);
  // Only probe OLED addresses, keeping retries short.
  const uint8_t addresses[] = {0x3C, 0x3D};
  for (uint8_t address : addresses) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      oledAddress = address;
      break;
    }
  }
  if (!oledAddress) {
    Serial.println("OLED: no response at 0x3C/0x3D; check SDA21/SCL22, 3.3V/GND. Send o to retry.");
    return;
  }
  const bool sh1106 = oledProfile == 2;
  const uint8_t init[] = {
    0xAE, 0xD5, 0x80, 0xA8, uint8_t(oledHeight-1),
    0xD3, 0x00, 0x40, 0xA1, 0xC8,
    0xDA, uint8_t(oledHeight == 32 ? 0x02 : 0x12),
    0x81, 0x8F, 0xD9, uint8_t(sh1106 ? 0x1F : 0xF1),
    0xDB, 0x40, 0xA4, 0xA6
  };
  bool ok = oledCommands(init, sizeof(init));
  if (sh1106) {
    const uint8_t power[] = {0xAD, 0x8B, 0x33};
    ok = ok && oledCommands(power, sizeof(power));
  } else {
    const uint8_t power[] = {0x8D, 0x14, 0x20, 0x02, 0x2E};
    ok = ok && oledCommands(power, sizeof(power));
  }
  if (ok) {
    delay(100);
    const uint8_t on[] = {0xAF};
    ok = oledCommands(on, sizeof(on));
  }
  oledReady = ok;
  oledDirty = true;
  Serial.printf("OLED profile %u: %s 128x%u at 0x%02X; commands %s.\n",
    unsigned(oledProfile), sh1106 ? "SH1106" : "SSD1306",
    unsigned(oledHeight), unsigned(oledAddress), ok ? "acknowledged" : "FAILED");
}

void serviceOled() {
  if (!oledReady) return;
  if (!oledSending) {
    if (!oledDirty && uint32_t(millis()-lastOledUpdate) < 500) return;
    oledDirty = false;
    buildOledFrame();
    oledPage = 0;
    oledColumn = 0;
    oledSending = true;
  }
  // Send only 16 data bytes per loop so smoke/buttons stay responsive.
  bool ok = true;
  if (oledColumn == 0) {
    const uint8_t column = oledProfile == 2 ? 2 : 0;
    const uint8_t position[] = {
      uint8_t(0xB0 | oledPage), uint8_t(column & 0x0F),
      uint8_t(0x10 | (column >> 4))
    };
    ok = oledCommands(position, sizeof(position));
  }
  if (ok) {
    Wire.beginTransmission(oledAddress);
    Wire.write(uint8_t(0x40));
    Wire.write(oledFrame + uint16_t(oledPage)*128 + oledColumn, 16);
    ok = Wire.endTransmission() == 0;
  }
  if (!ok) {
    oledReady = false;
    oledSending = false;
    Serial.println("OLED: transfer failed; physical inputs still run. Send o to retry.");
    return;
  }
  oledColumn += 16;
  if (oledColumn == 128) {
    oledColumn = 0;
    if (++oledPage >= oledHeight / 8) {
      oledSending = false;
      lastOledUpdate = millis();
    }
  }
}

struct DebouncedInput {
  bool candidate = false;
  bool stable = false;
  uint32_t changedAt = 0;

  bool rose(bool active, uint32_t now, uint32_t debounceMs) {
    if (active != candidate) {
      candidate = active;
      changedAt = now;
    }
    if (candidate != stable && uint32_t(now - changedAt) >= debounceMs) {
      stable = candidate;
      return stable;
    }
    return false;
  }
};

HardwareSerial voice(2);
DebouncedInput buttons[3];
DebouncedInput smoke;
bool latched[3] = {false, false, false}; // Actual combined LED states.
bool manualAlerts[3] = {false, false, false}; // Toggled by physical buttons.
bool smokeArmed = false; // Arm with a only after MQ-2 warm-up/calibration.
bool smokeAlarm = false; // Separate from the manual fire button/LED test.
bool voiceDiagnostics = false;

const char *const WEBSITE_TYPES[] = {"fire", "medical", "gunshot"};
struct ManualEvent {
  uint8_t index;
  uint32_t sequence;
  bool smoke;
  char nodeId[65];
};
QueueHandle_t websiteQueue = nullptr;
Preferences preferences;
uint32_t sequenceNumber = 0;
bool websiteReady = false;
bool preferencesReady = false;
String WIFI_SSID, WIFI_PASSWORD, SERVER_URL;
String deviceId, deviceToken, pairingPin;
uint32_t pinCreatedAt = 0;
std::atomic<bool> audioMuted{false};
std::atomic<bool> devicePaired{false};
std::atomic<bool> refreshPinRequested{false};
portMUX_TYPE pairingMux = portMUX_INITIALIZER_UNLOCKED;
char pairedNodeId[65] = {};
bool LED_ACTIVE_HIGH = true;
bool provisioning = false;
String provisionLine;
bool provisionOverflow = false;
String provisionValues[4];
bool provisionSeen[4] = {};
const char *const CONFIG_NAMES[] = {"WIFI_SSID", "WIFI_PASSWORD", "SERVER_URL", "LED_ACTIVE_HIGH"};
const char *const CONFIG_STORAGE[] = {"ssid", "password", "url", "led-high"};

bool validConfigField(uint8_t index, const String &value) {
  const size_t limits[] = {32, 63, 512, 5};
  if (index >= 4 || value.length() > limits[index]) return false;
  if (index != 1 && !value.length()) return false;
  for (size_t i = 0; i < value.length(); ++i) {
    if (uint8_t(value[i]) < 0x20 || uint8_t(value[i]) == 0x7f) return false;
  }
  if (index == 2 && (!value.startsWith("http://") || value.indexOf(' ', 0) >= 0)) return false;
  if (index == 3 && value != "true" && value != "false") return false;
  return true;
}

void newPairingPin() {
  uint32_t random;
  do { esp_fill_random(&random, sizeof(random)); } while (random >= 4200000000UL);
  char text[9];
  snprintf(text, sizeof(text), "%08lu", (unsigned long)(random % 100000000));
  pairingPin = text;
  pinCreatedAt = millis();
  Serial.printf("\nESP32: %s\nPairing PIN: %s (5 minutes; enter in this node's Audio setup)\n", deviceId.c_str(), text);
  // Future OLED: display.clearDisplay(); display.setCursor(0, 0);
  // display.println("Pairing PIN"); display.println(pairingPin); display.display();
}

void loadIdentity() {
  char id[17];
  snprintf(id, sizeof(id), "ESP-%012llX", (unsigned long long)(ESP.getEfuseMac() & 0xffffffffffffULL));
  deviceId = id;
  deviceToken = preferences.getString("device-token");
  if (deviceToken.length() != 64) {
    uint8_t random[32];
    esp_fill_random(random, sizeof(random));
    char encoded[65];
    for (size_t i = 0; i < sizeof(random); ++i) snprintf(encoded + i * 2, 3, "%02x", random[i]);
    deviceToken = encoded;
    if (preferences.putString("device-token", deviceToken) != 64) deviceToken = "";
  }
  newPairingPin();
}

void loadConfiguration() {
  preferencesReady = preferences.begin("campus-alert", false);
  if (!preferencesReady) return;
  sequenceNumber = preferences.getUInt("sequence", 0);
  // Enable the RF entropy source before generating device secrets/PINs.
  if (!WiFi.mode(WIFI_STA)) { Serial.println("Wi-Fi initialization failed; device pairing disabled."); return; }
  loadIdentity();
  preferences.remove("api-key"); preferences.remove("node");
  preferences.remove("building"); preferences.remove("room");
  if (!preferences.getBool("configured", false)) return;
  WIFI_SSID = preferences.getString("ssid");
  WIFI_PASSWORD = preferences.getString("password");
  SERVER_URL = preferences.getString("url");
  // Existing USB settings can migrate from the previous ingest URL.
  const String oldPath = "/api/alerts/ingest";
  if (SERVER_URL.endsWith(oldPath)) SERVER_URL.remove(SERVER_URL.length() - oldPath.length());
  while (SERVER_URL.endsWith("/")) SERVER_URL.remove(SERVER_URL.length() - 1);
  LED_ACTIVE_HIGH = preferences.getString("led-high", "true") == "true";
}

void beginProvisioning() {
  if (!preferencesReady) { Serial.println("CONFIG ERROR storage unavailable"); return; }
  if (websiteReady) {
    if (!preferences.putBool("setup-next", true)) { Serial.println("CONFIG ERROR storage unavailable"); return; }
    Serial.println("Restarting for USB configuration; pending alerts will be lost.");
    delay(100);
    ESP.restart();
    return;
  }
  provisioning = true;
  provisionLine = "";
  provisionOverflow = false;
  for (uint8_t i = 0; i < 4; ++i) { provisionValues[i] = ""; provisionSeen[i] = false; }
  Serial.println("CONFIG READY");
}

void receiveProvisioning(char c) {
  if (c == '\r') return;
  if (c != '\n') {
    if (provisionLine.length() < 800 && !provisionOverflow) provisionLine += c;
    else provisionOverflow = true;
    return;
  }
  if (provisionOverflow) {
    provisionLine = ""; provisionOverflow = false;
    Serial.println("CONFIG ERROR line too long");
    return;
  }
  if (provisionLine == "COMMIT") {
    provisionLine = "";
    for (uint8_t i = 0; i < 4; ++i) {
      if (!provisionSeen[i] || !validConfigField(i, provisionValues[i])) {
        Serial.println("CONFIG ERROR missing or invalid fields"); return;
      }
    }
    if (!preferences.putBool("configured", false)) { Serial.println("CONFIG ERROR save failed"); return; }
    for (uint8_t i = 0; i < 4; ++i) {
      // Empty passwords represent open networks; store and verify them as well.
      preferences.putString(CONFIG_STORAGE[i], provisionValues[i]);
      if (preferences.getString(CONFIG_STORAGE[i], "\x01") != provisionValues[i]) {
        Serial.println("CONFIG ERROR save failed"); return;
      }
    }
    if (!preferences.putBool("setup-next", false) || !preferences.putBool("configured", true)) {
      Serial.println("CONFIG ERROR save failed"); return;
    }
    Serial.println("CONFIG SAVED");
    delay(150);
    ESP.restart();
    return;
  }
  const int separator = provisionLine.indexOf('=');
  if (separator > 0) {
    const String name = provisionLine.substring(0, separator);
    const String value = provisionLine.substring(separator + 1);
    provisionLine = "";
    for (uint8_t i = 0; i < 4; ++i) {
      if (name == CONFIG_NAMES[i] && validConfigField(i, value)) {
        provisionValues[i] = value;
        provisionSeen[i] = true;
        Serial.printf("CONFIG OK %s\n", CONFIG_NAMES[i]);
        return;
      }
    }
  }
  provisionLine = "";
  Serial.println("CONFIG ERROR invalid field");
}

String jsonQuote(const String &value) {
  String quoted = "\"";
  for (size_t i = 0; i < value.length(); ++i) {
    const uint8_t c = value[i];
    if (c == '"' || c == '\\') quoted += '\\';
    if (c < 0x20) {
      char escaped[7];
      snprintf(escaped, sizeof(escaped), "\\u%04x", unsigned(c));
      quoted += escaped;
    } else {
      quoted += char(c);
    }
  }
  return quoted + '"';
}

String checksum(const String &canonical) {
  uint8_t digest[32];
  if (mbedtls_sha256(reinterpret_cast<const uint8_t *>(canonical.c_str()),
                     canonical.length(), digest, 0) != 0) return "";
  char hex[65];
  for (size_t i = 0; i < sizeof(digest); ++i) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  return String(hex);
}

String makePacket(const ManualEvent &event) {
  return "{\"deviceId\":" + jsonQuote(deviceId) + ",\"nodeId\":" + jsonQuote(event.nodeId) +
         ",\"emergencyType\":" + jsonQuote(WEBSITE_TYPES[event.index]) +
         ",\"sequenceNumber\":" + String(event.sequence) + ",\"source\":" +
         jsonQuote(event.smoke ? "smoke_sensor" : "manual_button") + '}';
}

void websiteTask(void *) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(WIFI_SSID.c_str(), WIFI_PASSWORD.c_str());
  bool wasConnected = false;
  uint32_t lastConnect = millis();
  uint32_t lastAnnounce = millis() - 5000;
  String currentNode;
  for (;;) {
    const bool connected = WiFi.status() == WL_CONNECTED;
    if (connected != wasConnected) {
      Serial.println(connected ? "Website: Wi-Fi connected." : "Website: Wi-Fi lost; alerts waiting.");
      wasConnected = connected;
    }
    if (!connected) {
      if (uint32_t(millis() - lastConnect) >= 15000) {
        WiFi.reconnect();
        lastConnect = millis();
        Serial.println("Website: waiting for Wi-Fi; check network settings.");
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    if (!devicePaired && (refreshPinRequested.exchange(false) || uint32_t(millis() - pinCreatedAt) >= 300000)) newPairingPin();
    if (uint32_t(millis() - lastAnnounce) >= 5000) {
      lastAnnounce = millis();
      WiFiClient announceClient;
      HTTPClient announce;
      announce.setConnectTimeout(2000); announce.setTimeout(3000);
      const char *headers[] = {"X-Node-ID", "X-Audio-Muted"};
      announce.collectHeaders(headers, 2);
      if (announce.begin(announceClient, SERVER_URL + "/api/esp32/register")) {
        announce.addHeader("Content-Type", "application/json");
        announce.addHeader("X-ESP32-Token", deviceToken);
        const int code = announce.POST("{\"deviceId\":" + jsonQuote(deviceId) + ",\"pinHash\":" + jsonQuote(checksum(pairingPin)) + '}');
        if (code == 200) {
          const String node = announce.header("X-Node-ID");
          const bool muted = announce.header("X-Audio-Muted") == "true";
          if (node != currentNode) {
            Serial.printf("ESP32 pairing: %s\n", node.length() ? node.c_str() : "not paired");
            if (!node.length() && currentNode.length()) newPairingPin();
            currentNode = node;
            portENTER_CRITICAL(&pairingMux);
            strlcpy(pairedNodeId, node.c_str(), sizeof(pairedNodeId));
            portEXIT_CRITICAL(&pairingMux);
            devicePaired = node.length() > 0;
          }
          if (muted != audioMuted) Serial.println(muted ? "Audio: MUTED. Manual buttons and smoke detection remain active." : "Audio: UNMUTED. VR3 raw CNN audio is unavailable.");
          audioMuted = muted;
        } else Serial.printf("ESP32 discovery failed (%d); check the website address.\n", code);
        announce.end();
      }
    }
    ManualEvent event;
    if (xQueuePeek(websiteQueue, &event, pdMS_TO_TICKS(100)) != pdTRUE) continue;
    if (currentNode != event.nodeId) {
      xQueueReceive(websiteQueue, &event, 0);
      Serial.println("Website: old alert discarded because node pairing changed.");
      continue;
    }
    WiFiClient client;
    HTTPClient http;
    http.setConnectTimeout(2000);
    http.setTimeout(3000);
    int status = -1;
    if (http.begin(client, SERVER_URL + "/api/esp32/alert")) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-ESP32-Token", deviceToken);
      status = http.POST(makePacket(event));
      http.end();
    }
    // The existing ingest API returns 200/201 only after acknowledging storage/duplicates.
    if (status == 200 || status == 201) {
      xQueueReceive(websiteQueue, &event, 0);
      Serial.printf("Website: %s manual alert acknowledged (sequence %lu).\n",
                    EMERGENCIES[event.index], (unsigned long)event.sequence);
    } else {
      Serial.printf("Website: send failed (%d); alert kept for retry.\n", status);
      vTaskDelay(pdMS_TO_TICKS(5000));
    }
  }
}

void startWebsite() {
  if (!WIFI_SSID.length() || !SERVER_URL.startsWith("http://") || deviceToken.length() != 64) {
    Serial.println("Website: NOT CONFIGURED. Provision over USB from .env; physical controls still work.");
    return;
  }
  if (!preferencesReady) {
    Serial.println("Website: sequence storage failed; delivery disabled.");
    return;
  }
  sequenceNumber = preferences.getUInt("sequence", 0);
  websiteQueue = xQueueCreate(16, sizeof(ManualEvent));
  websiteReady = websiteQueue && xTaskCreate(websiteTask, "website", 8192, nullptr, 1, nullptr) == pdPASS;
  if (!websiteReady) Serial.println("Website: worker could not start; delivery disabled.");
}

void queuePhysicalAlert(uint8_t index, bool fromSmoke) {
  if (!websiteReady) {
    Serial.println("Website: alert NOT SENT; network settings/worker unavailable.");
    return;
  }
  ManualEvent event{};
  portENTER_CRITICAL(&pairingMux);
  strlcpy(event.nodeId, pairedNodeId, sizeof(event.nodeId));
  portEXIT_CRITICAL(&pairingMux);
  if (!event.nodeId[0]) { Serial.println("Website: pair this ESP32 to a node before sending alerts."); return; }
  if (sequenceNumber == UINT32_MAX || !uxQueueSpacesAvailable(websiteQueue)) {
    Serial.println("Website: alert NOT QUEUED; sequence exhausted or queue full.");
    return;
  }
  const uint32_t next = sequenceNumber + 1;
  if (preferences.putUInt("sequence", next) != sizeof(next)) {
    Serial.println("Website: alert NOT QUEUED; could not save sequence number.");
    return;
  }
  sequenceNumber = next;
  event.index = index; event.sequence = next; event.smoke = fromSmoke;
  // shortcut: 16 pending events live in RAM; add a persistent outbox before unattended use.
  if (xQueueSend(websiteQueue, &event, 0) == pdTRUE) Serial.println("Website: physical alert queued.");
  else Serial.println("Website: alert NOT QUEUED; queue full.");
}

void setLed(uint8_t index, bool on) {
  latched[index] = on;
  digitalWrite(LED_PINS[index], (on == LED_ACTIVE_HIGH) ? HIGH : LOW);
}

void refreshLeds() {
  for (uint8_t i = 0; i < 3; ++i) {
    setLed(i, manualAlerts[i] || (i == 0 && smokeAlarm));
  }
  updateOled();
}

void selfCheck() {
  DebouncedInput input;
  assert(!input.rose(true, 0, 35));
  assert(!input.rose(false, 10, 35)); // Contact bounce must not trigger.
  assert(!input.rose(true, 20, 35));
  assert(input.rose(true, 55, 35));
  assert(!input.rose(true, 100, 35)); // Holding must not repeat.
  assert(!input.rose(false, 110, 35));
  assert(input.stable); // Release bounce must not create a new press edge.
  assert(!input.rose(false, 145, 35));
  assert(!input.stable); // Debounced release does not toggle the manual alert.
  assert(!input.rose(true, UINT32_MAX - 10, 35));
  assert(input.rose(true, 25, 35)); // millis() wraparound.
  assert(jsonQuote("A\"B\\C\n") == "\"A\\\"B\\\\C\\u000a\"");
  assert(checksum("ESP32-001|1|fire|Test Building|Room 1") ==
         "b518fef4b90f751d95fb015d247142ae45ef13642eaffb347f454a399d6d0c49");
  assert(String(WEBSITE_TYPES[2]) == "gunshot");
  assert(validConfigField(0, "test-wifi"));
  assert(!validConfigField(0, ""));
  assert(!validConfigField(2, "http://bad\nheader"));
  assert(validConfigField(1, ""));
  assert(!validConfigField(3, "yes"));
}

bool smokeActive() {
  return digitalRead(SMOKE_DIGITAL_PIN) == (SMOKE_ACTIVE_LOW ? LOW : HIGH);
}

void buildOledFrame() {
  memset(oledFrame, 0, sizeof(oledFrame));
  if (oledHeight == 32) {
    char line[22];
    snprintf(line, sizeof(line), "FIRE:%s MED:%s", latched[0] ? "ON" : "OFF", latched[1] ? "ON" : "OFF");
    oledText(0, line);
    snprintf(line, sizeof(line), "SHOOT:%s %s", latched[2] ? "ON" : "OFF", smokeArmed ? "ARMED" : "DISARMED");
    oledText(1, line);
    oledText(2, smokeAlarm ? "SMOKE/GAS ALERT" : (smokeActive() ? "INPUT ACTIVE" : "INPUT INACTIVE"));
    snprintf(line, sizeof(line), "RAW:%d%s", analogRead(SMOKE_ANALOG_PIN), smokeArmed ? "" : " SEND A");
    oledText(3, line);
    return;
  }
  oledText(0, "SMOKE DETECTOR");
  oledText(1, smokeArmed ? "ARMED" : "DISARMED: SEND A");
  oledText(2, smokeAlarm ? "SMOKE/GAS ALERT" :
              (smokeActive() ? "INPUT ACTIVE" : "INPUT INACTIVE"));
  char raw[22];
  snprintf(raw, sizeof(raw), "RAW: %d", analogRead(SMOKE_ANALOG_PIN));
  oledText(3, raw);
  if (oledHeight == 64) {
    oledText(4, latched[0] ? "FIRE: ON" : "FIRE: OFF");
    oledText(5, latched[1] ? "MEDICAL: ON" : "MEDICAL: OFF");
    oledText(6, latched[2] ? "SHOOTING: ON" : "SHOOTING: OFF");
    oledText(7, !websiteReady ? "NET: NOT CONFIGURED" :
                (WiFi.status() != WL_CONNECTED ? "NET: OFFLINE" :
                 (devicePaired.load() ? "NET: PAIRED" : "NET: PAIR ON WEBSITE")));
  }
}

void alert(uint8_t index, const char *source) {
  setLed(index, true);
  Serial.printf("\n*** %s ALERT ***\nSource: %s\nLED %u GPIO%u: commanded ON (%s)\n",
                EMERGENCIES[index], source, unsigned(index + 1),
                unsigned(LED_PINS[index]), LED_ACTIVE_HIGH ? "HIGH" : "LOW");
}

void printStatus() {
  Serial.println("\n-------- CAMPUS PANIC --------");
  Serial.printf("Fire: %s | Medical: %s | Shooting: %s\n",
                latched[0] ? "ALERT" : "idle", latched[1] ? "ALERT" : "idle",
                latched[2] ? "ALERT" : "idle");
  Serial.printf("Smoke input: %s | Detection: %s\n",
                smokeActive() ? "threshold active" : "threshold inactive",
                smokeArmed ? "armed" : "disarmed - warm up/calibrate, then send a");
  Serial.printf("Smoke raw ADC: %d | Smoke alarm: %s\n", analogRead(SMOKE_ANALOG_PIN), smokeAlarm ? "LATCHED" : "idle");
  Serial.println("Voice module: UART enabled | CNN audio: unavailable with VR3");
  Serial.printf("Website: %s | ESP32: %s | Audio: %s\n",
                websiteReady ? (WiFi.status() == WL_CONNECTED ? "Wi-Fi connected" : "waiting for Wi-Fi") : "not configured/available",
                devicePaired ? "PAIRED" : "not paired; use the printed PIN", audioMuted ? "MUTED" : "unmuted (VR3 raw audio unavailable)");
  Serial.println("------------------------------");
  updateOled();
}

void printHelp() {
  Serial.println("Campus Panic | Serial Monitor: 115200 baud");
  Serial.printf("Buttons: FIRE GPIO%u/LED%u, MEDICAL GPIO%u/LED%u, SHOOTING GPIO%u/LED%u.\n",
    unsigned(BUTTON_PINS[0]), unsigned(LED_PINS[0]), unsigned(BUTTON_PINS[1]),
    unsigned(LED_PINS[1]), unsigned(BUTTON_PINS[2]), unsigned(LED_PINS[2]));
  Serial.println("Each button turns its assigned local alert ON. Use c to clear local alerts.");
  Serial.println("Buttons and smoke light the LEDs locally and send website events.");
  Serial.println("Commands: h=help, s=status, c=clear LEDs, a=arm/disarm smoke, v=query VR3");
  Serial.println("LED wiring test: 1/2/3 toggle that manual LED state; no website event. c clears local alerts when allowed.");
  Serial.println("Website events are sent on physical button ON only; local OFF does not resolve a website alert.");
  Serial.println("Smoke starts DISARMED: warm up/condition and calibrate the MQ-2 first.");
  Serial.println("OLED: o=retry; 4=SSD1306 128x64, 5=SH1106 128x64, 6=SSD1306 128x32.");
  Serial.println("OLED uses no external display libraries. Set DEFAULT_OLED_PROFILE to keep the working mode after reset.");
  Serial.println("Smoke: D0 GPIO35, active LOW by default. Adjust MQ-2 module threshold after warm-up.");
  Serial.println("Smoke alarm latches until c; it cannot clear while the armed input remains active.");
  Serial.println("USB setup: fill ESP32/.env and run provision.ps1 with Serial Monitor closed.");
  Serial.println("Pair from the node's Audio section using the ESP32 PIN. Send r to refresh an unpaired PIN.");
}

void readTerminal() {
  while (Serial.available()) {
    const int command = Serial.read();
    if (provisioning) { receiveProvisioning(char(command)); continue; }
    switch (command) {
      case 'p': beginProvisioning(); break;
      case 'r':
        if (devicePaired) Serial.println("Disconnect this ESP32 in the website before requesting a new PIN.");
        else { refreshPinRequested = true; Serial.println("PIN refresh requested; it will be announced when Wi-Fi is available."); }
        break;
      case 'h': printHelp(); break;
      case 'o': beginOled(); break;
      case '4':
      case '5':
      case '6':
        oledProfile = uint8_t(command - '3');
        beginOled();
        break;
      case 's': printStatus(); break;
      case '1':
      case '2':
      case '3': {
        const uint8_t index = uint8_t(command - '1');
        manualAlerts[index] = !manualAlerts[index];
        refreshLeds();
        Serial.printf("LED%u GPIO%u: %s; serial wiring test only.\n",
          unsigned(index+1), unsigned(LED_PINS[index]), latched[index] ? "ON" : "OFF");
        break;
      }
      case 'c': {
        const bool keepSmoke = smokeArmed && (smokeActive() || smoke.stable);
        for (uint8_t i = 0; i < 3; ++i) manualAlerts[i] = false;
        if (!keepSmoke) smokeAlarm = false;
        refreshLeds();
        Serial.println(smokeAlarm ? "Smoke alarm retained: armed input is still active." : "Local alerts and LEDs cleared.");
        printStatus();
        break;
      }
      case 'a':
        smokeArmed = !smokeArmed;
        smoke = DebouncedInput();
        Serial.printf("Smoke detection %s.\n", smokeArmed ? "ARMED" : "DISARMED");
        printStatus();
        break;
      case 'v': {
        voiceDiagnostics = true;
        // Read-only VR3 settings query, per the manufacturer's UART protocol.
        const uint8_t query[] = {0xAA, 0x02, 0x00, 0x0A};
        voice.write(query, sizeof(query));
        Serial.println("VR3 settings query sent; expecting a reply on UART2.");
        break;
      }
    }
  }
}

void readVoice() {
  // Bounded reads keep buttons responsive even if UART traffic is continuous.
  uint8_t bytes[32];
  size_t count = 0;
  while (voice.available() && count < sizeof(bytes)) {
    bytes[count++] = uint8_t(voice.read());
  }
  if (!count || !voiceDiagnostics || audioMuted) return;
  Serial.print("VR3 RX (hex chunk, not necessarily one complete frame):");
  for (size_t i = 0; i < count; ++i) Serial.printf(" %02X", bytes[i]);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  selfCheck();
  loadConfiguration();
  for (uint8_t i = 0; i < 3; ++i) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
    pinMode(LED_PINS[i], OUTPUT);
    setLed(i, false);
  }
  // GPIO34/35 have no internal pull resistors; use the schematic's wiring.
  pinMode(SMOKE_ANALOG_PIN, INPUT);
  pinMode(SMOKE_DIGITAL_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(SMOKE_ANALOG_PIN, ADC_11db);
  voice.begin(VOICE_BAUD, SERIAL_8N1, VOICE_RX_PIN, VOICE_TX_PIN);
  beginOled();
  if (preferencesReady && preferences.getBool("setup-next", false)) beginProvisioning();
  else startWebsite();
  printHelp();
  printStatus();
}

void loop() {
  readTerminal();
  const uint32_t now = millis();
  for (uint8_t i = 0; i < 3; ++i) {
    if (buttons[i].rose(digitalRead(BUTTON_PINS[i]) == LOW, now, 35)) {
      manualAlerts[i] = true;
      refreshLeds();
      alert(i, "manual button ON");
      queuePhysicalAlert(i, false);
      printStatus();
    }
  }
  // D0 is a smoke/gas threshold signal, not confirmation of a fire.
  const bool previousSmoke = smoke.stable;
  smoke.rose(smokeActive(), now, 500);
  if (smokeArmed && smoke.stable && !smokeAlarm) {
    smokeAlarm = true;
    alert(0, "smoke sensor (suspected fire)");
    queuePhysicalAlert(0, true);
  }
  if (previousSmoke != smoke.stable) printStatus();
  readVoice();
  serviceOled();
  delay(1);
}

