// Campus Panic - ESP32 node firmware.
// Three emergency buttons/LEDs, MQ-2 smoke input, VR3 UART, I2C OLED and a
// website link (pairing heartbeat + alert delivery). See README.md.
#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <Wire.h>
#include <assert.h>
#include <atomic>
#include <esp_system.h>
#include <mbedtls/sha256.h>
#include <string.h>

// ---------------------------------------------------------------- hardware
constexpr uint8_t BUTTON_PINS[] = {27, 26, 25};
// LED2 is GPIO33 on the supplied PCB (older sketches used GPIO23).
constexpr uint8_t LED_PINS[] = {32, 33, 14};
// Schematic wiring is GPIO -> LED -> 330 ohm -> GND, so HIGH = ON.
// Set to false only for confirmed active-low (common-anode) LED wiring.
constexpr bool LED_ACTIVE_HIGH = true;

constexpr uint8_t SMOKE_ANALOG_PIN = 34;
constexpr uint8_t SMOKE_DIGITAL_PIN = 35;
constexpr bool SMOKE_ACTIVE_LOW = true;  // Confirm your module's D0 polarity.

constexpr uint8_t VOICE_RX_PIN = 16;  // VR3 TXD through the voltage divider.
constexpr uint8_t VOICE_TX_PIN = 17;  // To VR3 RXD.
constexpr uint32_t VOICE_BAUD = 9600;

const char *const EMERGENCIES[] = {"FIRE", "MEDICAL", "SHOOTING"};
const char *const WEBSITE_TYPES[] = {"fire", "medical", "gunshot"};

constexpr uint32_t HEARTBEAT_MS = 5000;
constexpr uint32_t PIN_LIFETIME_MS = 300000;

// ------------------------------------------------------------------- state
struct DebouncedInput {
  bool candidate = false;
  bool stable = false;
  uint32_t changedAt = 0;

  // Returns true once, when the debounced input becomes active.
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

struct PhysicalEvent {
  uint8_t index;
  uint32_t sequence;
  bool smoke;
  char nodeId[65];
};

HardwareSerial voice(2);
DebouncedInput buttons[3];
DebouncedInput smoke;
bool ledState[3] = {};     // What the LEDs are commanded to show.
bool manualAlert[3] = {};  // Set by buttons / serial test.
bool smokeArmed = false;   // Arm with 'a' only after MQ-2 warm-up/calibration.
bool smokeAlarm = false;
bool voiceDiagnostics = false;

Preferences preferences;
bool preferencesReady = false;
bool websiteReady = false;
QueueHandle_t websiteQueue = nullptr;
uint32_t sequenceNumber = 0;
String wifiSsid, wifiPassword, serverUrl;
String deviceId, deviceToken;
char pairingPin[9] = {};
char pairedNodeId[65] = {};
uint32_t pinCreatedAt = 0;
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;  // Guards pin + node id.
std::atomic<bool> audioMuted{false};
std::atomic<bool> devicePaired{false};
std::atomic<bool> refreshPinRequested{false};
std::atomic<bool> websiteOnline{false};  // Last heartbeat reached the website.

// ------------------------------------------------------------------- utils
int ledLevel(bool on) { return on == LED_ACTIVE_HIGH ? HIGH : LOW; }

void setLed(uint8_t index, bool on) {
  ledState[index] = on;
  digitalWrite(LED_PINS[index], ledLevel(on));
}

void refreshLeds() {
  for (uint8_t i = 0; i < 3; ++i) setLed(i, manualAlert[i] || (i == 0 && smokeAlarm));
}

bool smokeActive() {
  return digitalRead(SMOKE_DIGITAL_PIN) == (SMOKE_ACTIVE_LOW ? LOW : HIGH);
}

String jsonQuote(const String &value) {
  String quoted = "\"";
  for (size_t i = 0; i < value.length(); ++i) {
    const uint8_t c = value[i];
    if (c == '"' || c == '\\') {
      quoted += '\\';
      quoted += char(c);
    } else if (c < 0x20) {
      char escaped[7];
      snprintf(escaped, sizeof(escaped), "\\u%04x", unsigned(c));
      quoted += escaped;
    } else {
      quoted += char(c);
    }
  }
  return quoted + '"';
}

String sha256Hex(const String &text) {
  uint8_t digest[32];
  // Return type differs between mbedTLS versions, so it is deliberately ignored.
  mbedtls_sha256(reinterpret_cast<const uint8_t *>(text.c_str()), text.length(), digest, 0);
  char hex[65];
  for (size_t i = 0; i < sizeof(digest); ++i) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  return String(hex);
}

// -------------------------------------------------------------------- OLED
// Built-in 5x7 font, no external display library. Unknown characters are blank.
const char OLED_CHARS[] = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/-%";
const uint8_t OLED_FONT[][5] = {
  {0,0,0,0,0},
  {0x7E,0x11,0x11,0x11,0x7E}, {0x7F,0x49,0x49,0x49,0x36}, {0x3E,0x41,0x41,0x41,0x22},  // A B C
  {0x7F,0x41,0x41,0x22,0x1C}, {0x7F,0x49,0x49,0x49,0x41}, {0x7F,0x09,0x09,0x09,0x01},  // D E F
  {0x3E,0x41,0x49,0x49,0x7A}, {0x7F,0x08,0x08,0x08,0x7F}, {0x00,0x41,0x7F,0x41,0x00},  // G H I
  {0x20,0x40,0x41,0x3F,0x01}, {0x7F,0x08,0x14,0x22,0x41}, {0x7F,0x40,0x40,0x40,0x40},  // J K L
  {0x7F,0x02,0x0C,0x02,0x7F}, {0x7F,0x04,0x08,0x10,0x7F}, {0x3E,0x41,0x41,0x41,0x3E},  // M N O
  {0x7F,0x09,0x09,0x09,0x06}, {0x3E,0x41,0x51,0x21,0x5E}, {0x7F,0x09,0x19,0x29,0x46},  // P Q R
  {0x46,0x49,0x49,0x49,0x31}, {0x01,0x01,0x7F,0x01,0x01}, {0x3F,0x40,0x40,0x40,0x3F},  // S T U
  {0x1F,0x20,0x40,0x20,0x1F}, {0x3F,0x40,0x38,0x40,0x3F}, {0x63,0x14,0x08,0x14,0x63},  // V W X
  {0x07,0x08,0x70,0x08,0x07}, {0x61,0x51,0x49,0x45,0x43},                              // Y Z
  {0x3E,0x51,0x49,0x45,0x3E}, {0x00,0x42,0x7F,0x40,0x00}, {0x42,0x61,0x51,0x49,0x46},  // 0 1 2
  {0x21,0x41,0x45,0x4B,0x31}, {0x18,0x14,0x12,0x7F,0x10}, {0x27,0x45,0x45,0x45,0x39},  // 3 4 5
  {0x3C,0x4A,0x49,0x49,0x30}, {0x01,0x71,0x09,0x05,0x03}, {0x36,0x49,0x49,0x49,0x36},  // 6 7 8
  {0x06,0x49,0x49,0x29,0x1E},                                                          // 9
  {0x00,0x36,0x36,0x00,0x00}, {0x20,0x10,0x08,0x04,0x02}, {0x08,0x08,0x08,0x08,0x08},  // : / -
  {0x23,0x13,0x08,0x64,0x62}                                                           // %
};
static_assert(sizeof(OLED_FONT) / sizeof(OLED_FONT[0]) == sizeof(OLED_CHARS) - 1,
              "OLED font mismatch");

constexpr uint8_t OLED_PAGES = 8;  // 128x64 panel.
bool oledSh1106 = true;            // 'o' retries; '4' = SSD1306, '5' = SH1106.
uint8_t oledAddress = 0;
bool oledReady = false;
bool oledSending = false;
uint8_t oledPage = 0;
uint8_t oledColumn = 0;
uint32_t lastOledUpdate = 0;
uint8_t oledFrame[128 * OLED_PAGES] = {};

bool oledCommands(const uint8_t *data, size_t length) {
  Wire.beginTransmission(oledAddress);
  Wire.write(uint8_t(0x00));
  Wire.write(data, length);
  return Wire.endTransmission() == 0;
}

void oledText(uint8_t row, const char *message) {
  if (row >= OLED_PAGES) return;
  for (uint8_t x = 0; *message && x <= 122; x += 6) {
    const char *found = strchr(OLED_CHARS, *message++);
    const size_t index = found ? size_t(found - OLED_CHARS) : 0;
    memcpy(&oledFrame[row * 128 + x], OLED_FONT[index], 5);
  }
}

void beginOled() {
  oledReady = false;
  oledSending = false;
  oledAddress = 0;
  if (!Wire.begin(21, 22, 100000)) {
    Serial.println("OLED: I2C startup failed.");
    return;
  }
  Wire.setTimeOut(50);
  for (uint8_t address : {0x3C, 0x3D}) {
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
  const uint8_t init[] = {
    0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0xA1, 0xC8,
    0xDA, 0x12, 0x81, 0x8F, 0xD9, uint8_t(oledSh1106 ? 0x1F : 0xF1),
    0xDB, 0x40, 0xA4, 0xA6
  };
  const uint8_t sh1106Power[] = {0xAD, 0x8B, 0x33};
  const uint8_t ssd1306Power[] = {0x8D, 0x14, 0x20, 0x02, 0x2E};
  bool ok = oledCommands(init, sizeof(init));
  ok = ok && (oledSh1106 ? oledCommands(sh1106Power, sizeof(sh1106Power))
                         : oledCommands(ssd1306Power, sizeof(ssd1306Power)));
  if (ok) {
    delay(100);
    const uint8_t on[] = {0xAF};
    ok = oledCommands(on, sizeof(on));
  }
  oledReady = ok;
  Serial.printf("OLED: %s 128x64 at 0x%02X; commands %s.\n", oledSh1106 ? "SH1106" : "SSD1306",
                unsigned(oledAddress), ok ? "acknowledged" : "FAILED");
}

// Screen layout, top to bottom: network, fire, medical, active shooter.
void buildOledFrame() {
  memset(oledFrame, 0, sizeof(oledFrame));
  char line[22];
  oledText(0, websiteOnline ? "NETWORK: ONLINE" : "NETWORK: OFFLINE");
  snprintf(line, sizeof(line), "FIRE: %s", ledState[0] ? "ON" : "OFF");
  oledText(1, line);
  snprintf(line, sizeof(line), "MEDICAL: %s", ledState[1] ? "ON" : "OFF");
  oledText(2, line);
  snprintf(line, sizeof(line), "ACTIVE SHOOTER: %s", ledState[2] ? "ON" : "OFF");
  oledText(3, line);
  if (websiteReady && !devicePaired) {  // Pairing PIN, only while unpaired.
    char pin[9];
    portENTER_CRITICAL(&stateMux);
    memcpy(pin, pairingPin, sizeof(pin));
    portEXIT_CRITICAL(&stateMux);
    oledText(6, "PAIRING PIN:");
    oledText(7, pin);
  }
}

// Sends one 16-byte chunk per call so buttons and smoke stay responsive.
void serviceOled() {
  if (!oledReady) return;
  if (!oledSending) {
    if (uint32_t(millis() - lastOledUpdate) < 500) return;
    buildOledFrame();
    oledPage = 0;
    oledColumn = 0;
    oledSending = true;
  }
  bool ok = true;
  if (oledColumn == 0) {
    const uint8_t column = oledSh1106 ? 2 : 0;  // SH1106 RAM is 132 wide.
    const uint8_t position[] = {uint8_t(0xB0 | oledPage), uint8_t(column & 0x0F),
                                uint8_t(0x10 | (column >> 4))};
    ok = oledCommands(position, sizeof(position));
  }
  if (ok) {
    Wire.beginTransmission(oledAddress);
    Wire.write(uint8_t(0x40));
    Wire.write(oledFrame + oledPage * 128 + oledColumn, 16);
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
    if (++oledPage >= OLED_PAGES) {
      oledSending = false;
      lastOledUpdate = millis();
    }
  }
}

// ---------------------------------------------------- stored configuration
constexpr uint8_t CONFIG_FIELDS = 3;
const char *const CONFIG_NAMES[] = {"WIFI_SSID", "WIFI_PASSWORD", "SERVER_URL"};
const char *const CONFIG_STORAGE[] = {"ssid", "password", "url"};
bool provisioning = false;
bool provisionOverflow = false;
String provisionLine;
String provisionValues[CONFIG_FIELDS];
bool provisionSeen[CONFIG_FIELDS] = {};

bool validConfigField(uint8_t index, const String &value) {
  const size_t limits[] = {32, 63, 512};
  if (index >= CONFIG_FIELDS || value.length() > limits[index]) return false;
  if (index != 1 && !value.length()) return false;  // Only the password may be empty.
  for (size_t i = 0; i < value.length(); ++i) {
    if (uint8_t(value[i]) < 0x20 || uint8_t(value[i]) == 0x7f) return false;
  }
  return index != 2 || (value.startsWith("http://") && value.indexOf(' ') < 0);
}

void newPairingPin() {
  uint32_t random;
  do { esp_fill_random(&random, sizeof(random)); } while (random >= 4200000000UL);  // No modulo bias.
  char pin[9];
  snprintf(pin, sizeof(pin), "%08lu", (unsigned long)(random % 100000000UL));
  portENTER_CRITICAL(&stateMux);
  memcpy(pairingPin, pin, sizeof(pin));
  portEXIT_CRITICAL(&stateMux);
  pinCreatedAt = millis();
  Serial.printf("\nESP32: %s\nPairing PIN: %s (5 minutes; enter in this node's Audio setup)\n",
                deviceId.c_str(), pin);
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
  // Wi-Fi must be on first: it feeds the hardware RNG used for the PIN and token.
  if (!WiFi.mode(WIFI_STA)) {
    Serial.println("Wi-Fi initialization failed; device pairing disabled.");
    return;
  }
  loadIdentity();
  for (const char *key : {"api-key", "node", "building", "room", "led-high"}) preferences.remove(key);
  if (!preferences.getBool("configured", false)) return;
  wifiSsid = preferences.getString("ssid");
  wifiPassword = preferences.getString("password");
  serverUrl = preferences.getString("url");
  const String legacyPath = "/api/alerts/ingest";
  if (serverUrl.endsWith(legacyPath)) serverUrl.remove(serverUrl.length() - legacyPath.length());
  while (serverUrl.endsWith("/")) serverUrl.remove(serverUrl.length() - 1);
}

void beginProvisioning() {
  if (!preferencesReady) {
    Serial.println("CONFIG ERROR storage unavailable");
    return;
  }
  if (websiteReady) {  // The Wi-Fi task is running: restart into setup mode.
    if (!preferences.putBool("setup-next", true)) {
      Serial.println("CONFIG ERROR storage unavailable");
      return;
    }
    Serial.println("Restarting for USB configuration; pending alerts will be lost.");
    delay(100);
    ESP.restart();
    return;
  }
  provisioning = true;
  provisionLine = "";
  provisionOverflow = false;
  for (uint8_t i = 0; i < CONFIG_FIELDS; ++i) {
    provisionValues[i] = "";
    provisionSeen[i] = false;
  }
  Serial.println("CONFIG READY");
}

bool commitProvisioning() {
  for (uint8_t i = 0; i < CONFIG_FIELDS; ++i) {
    if (!provisionSeen[i] || !validConfigField(i, provisionValues[i])) {
      Serial.println("CONFIG ERROR missing or invalid fields");
      return false;
    }
  }
  bool ok = preferences.putBool("configured", false);
  for (uint8_t i = 0; ok && i < CONFIG_FIELDS; ++i) {
    preferences.putString(CONFIG_STORAGE[i], provisionValues[i]);  // Empty = open network.
    ok = preferences.getString(CONFIG_STORAGE[i], "\x01") == provisionValues[i];
  }
  ok = ok && preferences.putBool("setup-next", false) && preferences.putBool("configured", true);
  if (!ok) {
    Serial.println("CONFIG ERROR save failed");
    return false;
  }
  Serial.println("CONFIG SAVED");
  delay(150);
  ESP.restart();
  return true;
}

void receiveProvisioning(char c) {
  if (c == '\r') return;
  if (c != '\n') {
    if (provisionLine.length() < 800 && !provisionOverflow) provisionLine += c;
    else provisionOverflow = true;
    return;
  }
  const String line = provisionLine;
  provisionLine = "";
  if (provisionOverflow) {
    provisionOverflow = false;
    Serial.println("CONFIG ERROR line too long");
    return;
  }
  if (line == "COMMIT") {
    commitProvisioning();
    return;
  }
  const int separator = line.indexOf('=');
  if (separator > 0) {
    const String name = line.substring(0, separator);
    const String value = line.substring(separator + 1);
    for (uint8_t i = 0; i < CONFIG_FIELDS; ++i) {
      if (name == CONFIG_NAMES[i] && validConfigField(i, value)) {
        provisionValues[i] = value;
        provisionSeen[i] = true;
        Serial.printf("CONFIG OK %s\n", CONFIG_NAMES[i]);
        return;
      }
    }
  }
  Serial.println("CONFIG ERROR invalid field");
}

// ----------------------------------------------------------------- website
String makePacket(const PhysicalEvent &event) {
  return "{\"deviceId\":" + jsonQuote(deviceId) + ",\"nodeId\":" + jsonQuote(event.nodeId) +
         ",\"emergencyType\":" + jsonQuote(WEBSITE_TYPES[event.index]) +
         ",\"sequenceNumber\":" + String(event.sequence) + ",\"source\":" +
         jsonQuote(event.smoke ? "smoke_sensor" : "manual_button") + '}';
}

// Announces this device (and its PIN hash) and learns the paired node / mute state.
bool sendHeartbeat(String &currentNode) {
  char pin[9];
  portENTER_CRITICAL(&stateMux);
  memcpy(pin, pairingPin, sizeof(pin));
  portEXIT_CRITICAL(&stateMux);

  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  if (!http.begin(client, serverUrl + "/api/esp32/register")) return false;
  const char *headers[] = {"X-Node-ID", "X-Audio-Muted"};
  http.collectHeaders(headers, 2);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-ESP32-Token", deviceToken);
  const int code = http.POST("{\"deviceId\":" + jsonQuote(deviceId) + ",\"pinHash\":" +
                             jsonQuote(sha256Hex(pin)) + "}");
  const String node = code == 200 ? http.header("X-Node-ID") : String();
  const bool muted = code == 200 && http.header("X-Audio-Muted") == "true";
  http.end();

  static int lastCode = 0;
  if (code != lastCode) {  // Log only changes so a down server does not flood Serial.
    lastCode = code;
    if (code == 200) Serial.println("Website: online.");
    else Serial.printf("Website: heartbeat failed (%d); check SERVER_URL, that the site is running, and the laptop firewall (port 5000).\n", code);
  }
  if (code != 200) return false;

  if (node != currentNode) {
    Serial.printf("ESP32 pairing: %s\n", node.length() ? node.c_str() : "not paired");
    if (!node.length() && currentNode.length()) newPairingPin();  // Unpaired: fresh PIN.
    currentNode = node;
    portENTER_CRITICAL(&stateMux);
    strlcpy(pairedNodeId, node.c_str(), sizeof(pairedNodeId));
    portEXIT_CRITICAL(&stateMux);
    devicePaired = node.length() > 0;
  }
  if (muted != audioMuted) {
    Serial.println(muted ? "Audio: MUTED. Manual buttons and smoke detection remain active."
                         : "Audio: UNMUTED. VR3 raw CNN audio is unavailable.");
    audioMuted = muted;
  }
  return true;
}

int sendAlert(const PhysicalEvent &event) {
  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  if (!http.begin(client, serverUrl + "/api/esp32/alert")) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-ESP32-Token", deviceToken);
  const int status = http.POST(makePacket(event));
  http.end();
  return status;
}

// Runs on its own task so Wi-Fi/HTTP never delays buttons, LEDs or smoke.
void websiteTask(void *) {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  String currentNode;
  bool wasConnected = false;
  bool retryWaiting = false;
  uint32_t lastWifiAttempt = millis();
  uint32_t lastHeartbeat = 0;
  uint32_t lastFailure = 0;

  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      websiteOnline = false;
      if (wasConnected) {
        Serial.println("Website: Wi-Fi lost; alerts waiting.");
        wasConnected = false;
      }
      if (uint32_t(millis() - lastWifiAttempt) >= 15000) {
        lastWifiAttempt = millis();
        Serial.println("Website: waiting for Wi-Fi; check WIFI_SSID / WIFI_PASSWORD (2.4 GHz only).");
        WiFi.reconnect();
      }
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }
    if (!wasConnected) {
      wasConnected = true;
      lastHeartbeat = millis() - HEARTBEAT_MS;  // Announce immediately.
      Serial.printf("Website: Wi-Fi connected, IP %s.\n", WiFi.localIP().toString().c_str());
    }

    if (!devicePaired && (refreshPinRequested.exchange(false) ||
                          uint32_t(millis() - pinCreatedAt) >= PIN_LIFETIME_MS)) {
      newPairingPin();
    }
    if (uint32_t(millis() - lastHeartbeat) >= HEARTBEAT_MS) {
      lastHeartbeat = millis();
      websiteOnline = sendHeartbeat(currentNode);
    }

    PhysicalEvent event;
    if (xQueuePeek(websiteQueue, &event, pdMS_TO_TICKS(100)) != pdTRUE) continue;
    if (currentNode != event.nodeId) {
      xQueueReceive(websiteQueue, &event, 0);
      Serial.println("Website: old alert discarded because node pairing changed.");
      continue;
    }
    if (retryWaiting && uint32_t(millis() - lastFailure) < 5000) {
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    const int status = sendAlert(event);
    if (status == 200 || status == 201) {
      xQueueReceive(websiteQueue, &event, 0);
      retryWaiting = false;
      Serial.printf("Website: %s alert acknowledged (sequence %lu).\n", EMERGENCIES[event.index],
                    (unsigned long)event.sequence);
    } else if (status == 400 || status == 422) {
      // The website rejected the packet itself; retrying would block every later alert.
      xQueueReceive(websiteQueue, &event, 0);
      retryWaiting = false;
      Serial.printf("Website: alert rejected (%d) and dropped.\n", status);
    } else {
      retryWaiting = true;
      lastFailure = millis();
      Serial.printf("Website: send failed (%d); alert kept for retry.\n", status);
    }
  }
}

void startWebsite() {
  if (!wifiSsid.length() || !serverUrl.startsWith("http://") || deviceToken.length() != 64) {
    Serial.println("Website: NOT CONFIGURED. Provision over USB from .env; physical controls still work.");
    return;
  }
  if (!preferencesReady) {
    Serial.println("Website: sequence storage failed; delivery disabled.");
    return;
  }
  websiteQueue = xQueueCreate(16, sizeof(PhysicalEvent));
  websiteReady = websiteQueue && xTaskCreate(websiteTask, "website", 8192, nullptr, 1, nullptr) == pdPASS;
  if (!websiteReady) Serial.println("Website: worker could not start; delivery disabled.");
}

void queuePhysicalAlert(uint8_t index, bool fromSmoke) {
  if (!websiteReady) {
    Serial.println("Website: alert NOT SENT; network settings/worker unavailable.");
    return;
  }
  PhysicalEvent event{};
  portENTER_CRITICAL(&stateMux);
  strlcpy(event.nodeId, pairedNodeId, sizeof(event.nodeId));
  portEXIT_CRITICAL(&stateMux);
  if (!event.nodeId[0]) {
    Serial.println("Website: pair this ESP32 to a node before sending alerts.");
    return;
  }
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
  event.index = index;
  event.sequence = next;
  event.smoke = fromSmoke;
  // shortcut: 16 pending events live in RAM; add a persistent outbox before unattended use.
  xQueueSend(websiteQueue, &event, 0);
  Serial.println("Website: physical alert queued.");
}

// ---------------------------------------------------------- serial console
void printAlert(uint8_t index, const char *source) {
  Serial.printf("\n*** %s ALERT ***\nSource: %s\nLED %u GPIO%u: commanded ON (%s)\n", EMERGENCIES[index],
                source, unsigned(index + 1), unsigned(LED_PINS[index]), LED_ACTIVE_HIGH ? "HIGH" : "LOW");
}

void printStatus() {
  Serial.println("\n-------- CAMPUS PANIC --------");
  Serial.printf("Fire: %s | Medical: %s | Shooting: %s\n", ledState[0] ? "ALERT" : "idle",
                ledState[1] ? "ALERT" : "idle", ledState[2] ? "ALERT" : "idle");
  Serial.printf("Smoke input: %s | Detection: %s | Raw ADC: %d | Alarm: %s\n",
                smokeActive() ? "threshold active" : "threshold inactive",
                smokeArmed ? "armed" : "disarmed (warm up/calibrate, then send a)", analogRead(SMOKE_ANALOG_PIN),
                smokeAlarm ? "LATCHED" : "idle");
  Serial.printf("Network: %s | Wi-Fi: %s | ESP32: %s | Audio: %s\n", websiteOnline ? "ONLINE" : "OFFLINE",
                websiteReady ? (WiFi.status() == WL_CONNECTED ? "connected" : "waiting") : "not configured",
                devicePaired ? "PAIRED" : "not paired; use the printed PIN",
                audioMuted ? "MUTED" : "unmuted (VR3 raw audio unavailable)");
  Serial.println("------------------------------");
}

void printHelp() {
  Serial.println("Campus Panic | Serial Monitor: 115200 baud");
  Serial.printf("Buttons/LEDs: FIRE GPIO%u/%u, MEDICAL GPIO%u/%u, SHOOTING GPIO%u/%u. Each button press toggles its alert ON/OFF.\n",
                unsigned(BUTTON_PINS[0]), unsigned(LED_PINS[0]), unsigned(BUTTON_PINS[1]), unsigned(LED_PINS[1]),
                unsigned(BUTTON_PINS[2]), unsigned(LED_PINS[2]));
  Serial.println("Commands: h help | s status | c clear alerts | 1/2/3 toggle LED (wiring test, no website event)");
  Serial.println("          a arm/disarm smoke (starts DISARMED) | v query VR3 | r new pairing PIN | p USB setup");
  Serial.println("          o retry OLED | 4 OLED = SSD1306 | 5 OLED = SH1106");
  Serial.println("Smoke alarm latches until c and cannot clear while the armed input stays active.");
  Serial.println("Website events are sent on button/smoke ON only; clearing locally does not resolve them.");
}

void readTerminal() {
  while (Serial.available()) {
    const int command = Serial.read();
    if (provisioning) {
      receiveProvisioning(char(command));
      continue;
    }
    switch (command) {
      case 'h': printHelp(); break;
      case 's': printStatus(); break;
      case 'p': beginProvisioning(); break;
      case 'o': beginOled(); break;
      case '4':
      case '5':
        oledSh1106 = command == '5';
        beginOled();
        break;
      case 'r':
        if (devicePaired) {
          Serial.println("Disconnect this ESP32 in the website before requesting a new PIN.");
        } else {
          refreshPinRequested = true;
          Serial.println("PIN refresh requested; it is created once Wi-Fi is available.");
        }
        break;
      case '1':
      case '2':
      case '3': {
        const uint8_t index = uint8_t(command - '1');
        manualAlert[index] = !manualAlert[index];
        refreshLeds();
        Serial.printf("LED%u GPIO%u: %s (wiring test only).\n", unsigned(index + 1),
                      unsigned(LED_PINS[index]), ledState[index] ? "ON" : "OFF");
        break;
      }
      case 'c': {
        const bool keepSmoke = smokeArmed && (smokeActive() || smoke.stable);
        for (bool &alert : manualAlert) alert = false;
        if (!keepSmoke) smokeAlarm = false;
        refreshLeds();
        Serial.println(smokeAlarm ? "Smoke alarm retained: armed input is still active."
                                  : "Local alerts and LEDs cleared.");
        break;
      }
      case 'a':
        smokeArmed = !smokeArmed;
        smoke = DebouncedInput();
        Serial.printf("Smoke detection %s.\n", smokeArmed ? "ARMED" : "DISARMED");
        break;
      case 'v': {
        voiceDiagnostics = true;
        const uint8_t query[] = {0xAA, 0x02, 0x00, 0x0A};  // Read-only VR3 settings query.
        voice.write(query, sizeof(query));
        Serial.println("VR3 settings query sent; expecting a reply on UART2.");
        break;
      }
    }
  }
}

void readVoice() {
  uint8_t bytes[32];  // Bounded read keeps the loop responsive.
  size_t count = 0;
  while (voice.available() && count < sizeof(bytes)) bytes[count++] = uint8_t(voice.read());
  if (!count || !voiceDiagnostics || audioMuted) return;
  Serial.print("VR3 RX (hex chunk):");
  for (size_t i = 0; i < count; ++i) Serial.printf(" %02X", bytes[i]);
  Serial.println();
}

// ------------------------------------------------------------ setup / loop
void selfCheck() {
  DebouncedInput input;
  assert(!input.rose(true, 0, 35));
  assert(!input.rose(false, 10, 35));  // Contact bounce must not trigger.
  assert(!input.rose(true, 20, 35));
  assert(input.rose(true, 55, 35));
  assert(!input.rose(true, 100, 35));  // Holding must not repeat.
  assert(!input.rose(false, 110, 35));
  assert(input.stable);                // Release bounce is not a new press.
  assert(!input.rose(false, 145, 35));
  assert(!input.stable);
  assert(!input.rose(true, UINT32_MAX - 10, 35));
  assert(input.rose(true, 25, 35));    // millis() wraparound.
  assert(jsonQuote("A\"B\\C\n") == "\"A\\\"B\\\\C\\u000a\"");
  assert(sha256Hex("ESP32-001|1|fire|Test Building|Room 1") ==
         "b518fef4b90f751d95fb015d247142ae45ef13642eaffb347f454a399d6d0c49");
  assert(String(WEBSITE_TYPES[2]) == "gunshot");
  assert(validConfigField(0, "test-wifi") && !validConfigField(0, ""));
  assert(validConfigField(1, "") && !validConfigField(2, "http://bad\nheader"));
  assert(!validConfigField(CONFIG_FIELDS, "x"));
}

void setup() {
  // Drive the LEDs OFF before anything slow runs, and write the level before
  // switching to OUTPUT so the pin never glitches ON.
  for (uint8_t i = 0; i < 3; ++i) {
    digitalWrite(LED_PINS[i], ledLevel(false));
    pinMode(LED_PINS[i], OUTPUT);
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }
  Serial.begin(115200);
  delay(500);
  selfCheck();
  loadConfiguration();
  pinMode(SMOKE_ANALOG_PIN, INPUT);  // GPIO34/35 have no internal pull resistors.
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
      manualAlert[i] = !manualAlert[i];  // Each press toggles the alert.
      refreshLeds();
      if (manualAlert[i]) {
        printAlert(i, "manual button ON");
        queuePhysicalAlert(i, false);  // Only turning ON notifies the website.
      } else {
        Serial.printf("\n%s alert cleared locally (button).\n", EMERGENCIES[i]);
      }
      printStatus();
    }
  }
  // D0 is a smoke/gas threshold signal, not confirmation of a fire.
  const bool previousSmoke = smoke.stable;
  smoke.rose(smokeActive(), now, 500);
  if (smokeArmed && smoke.stable && !smokeAlarm) {
    smokeAlarm = true;
    refreshLeds();
    printAlert(0, "smoke sensor (suspected fire)");
    queuePhysicalAlert(0, true);
  }
  if (previousSmoke != smoke.stable) printStatus();
  readVoice();
  serviceOled();
  delay(1);
}
