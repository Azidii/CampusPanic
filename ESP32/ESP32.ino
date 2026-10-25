#include <Arduino.h>
#include <assert.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <mbedtls/sha256.h>
#include <esp_system.h>
#include <atomic>

constexpr uint8_t BUTTON_PINS[] = {27, 26, 25};
constexpr uint8_t LED_PINS[] = {32, 23, 14};
const char *const EMERGENCIES[] = {"FIRE", "MEDICAL", "ACTIVE SHOOTER"};
constexpr uint8_t SMOKE_ANALOG_PIN = 34;
constexpr uint8_t SMOKE_DIGITAL_PIN = 35;
constexpr uint8_t VOICE_RX_PIN = 16; // VR3 TXD through the schematic's divider.
constexpr uint8_t VOICE_TX_PIN = 17; // To VR3 RXD.
constexpr uint32_t VOICE_BAUD = 9600;
constexpr bool SMOKE_ACTIVE_LOW = true; // Confirm your module's D0 polarity.

// OLED example only: confirm the actual controller, dimensions and address first.
// #include <Wire.h>
// #include <Adafruit_GFX.h>
// #include <Adafruit_SSD1306.h>
// Adafruit_SSD1306 display(128, 64, &Wire, -1);
// In setup(): Wire.begin(21, 22); display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
// To display: display.clearDisplay(); display.setTextSize(1);
// display.setTextColor(SSD1306_WHITE); display.setCursor(0, 0);
// display.println("Campus Panic"); display.display();

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
bool latched[3] = {false, false, false};
bool smokeArmed = false;
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

void selfCheck() {
  DebouncedInput input;
  assert(!input.rose(true, 0, 35));
  assert(!input.rose(false, 10, 35)); // Contact bounce must not trigger.
  assert(!input.rose(true, 20, 35));
  assert(input.rose(true, 55, 35));
  assert(!input.rose(true, 100, 35)); // Holding must not repeat.
  assert(!input.rose(false, 110, 35));
  assert(input.stable); // Release bounce keeps the LED on.
  assert(!input.rose(false, 145, 35));
  assert(!input.stable); // Debounced release turns the LED off.
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

void alert(uint8_t index, const char *source) {
  setLed(index, true);
  Serial.printf("\n*** %s ALERT ***\nSource: %s\nLED %u GPIO%u: commanded ON (%s)\n",
                EMERGENCIES[index], source, unsigned(index + 1),
                unsigned(LED_PINS[index]), LED_ACTIVE_HIGH ? "HIGH" : "LOW");
}

void printStatus() {
  Serial.println("\n-------- CAMPUS PANIC --------");
  Serial.printf("Fire: %s | Medical: %s | Active shooter: %s\n",
                latched[0] ? "ALERT" : "idle", latched[1] ? "ALERT" : "idle",
                latched[2] ? "ALERT" : "idle");
  Serial.printf("Smoke input: %s | Detection: %s\n",
                smokeActive() ? "threshold active" : "threshold inactive",
                smokeArmed ? "armed" : "disarmed - warm up/calibrate, then send a");
  Serial.println("Voice module: UART enabled | CNN audio: unavailable with VR3");
  Serial.printf("Website: %s | ESP32: %s | Audio: %s\n",
                websiteReady ? (WiFi.status() == WL_CONNECTED ? "Wi-Fi connected" : "waiting for Wi-Fi") : "not configured/available",
                devicePaired ? "PAIRED" : "not paired; use the printed PIN", audioMuted ? "MUTED" : "unmuted (VR3 raw audio unavailable)");
  Serial.println("------------------------------");
}

void printHelp() {
  Serial.println("Campus Panic | Serial Monitor: 115200 baud");
  Serial.println("BTN1=fire/LED1; BTN2=medical/LED2; BTN3=active_shooter/LED3");
  Serial.println("Commands: h=help, s=status, c=clear LEDs, a=arm/disarm smoke, v=query VR3");
  Serial.println("LED wiring test: send 1, 2, or 3 to turn that LED ON; c turns LEDs OFF.");
  Serial.println("Smoke starts DISARMED: warm up/condition and calibrate the MQ-2 first.");
  Serial.println("Display updates on alerts/smoke changes; send s to refresh status.");
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
      case 's': printStatus(); break;
      case '1':
      case '2':
      case '3': {
        const uint8_t index = uint8_t(command - '1');
        setLed(index, true);
        Serial.printf("LED%u GPIO%u commanded ON (output %s); no website alert for this wiring test.\n",
                      unsigned(index + 1), unsigned(LED_PINS[index]), LED_ACTIVE_HIGH ? "HIGH" : "LOW");
        break;
      }
      case 'c':
        for (uint8_t i = 0; i < 3; ++i) {
          setLed(i, false);
        }
        Serial.println("LEDs cleared. An active, armed smoke input will re-trigger.");
        printStatus();
        break;
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
  if (preferencesReady && preferences.getBool("setup-next", false)) beginProvisioning();
  else startWebsite();
  printHelp();
  printStatus();
}

void loop() {
  readTerminal();
  const uint32_t now = millis();
  for (uint8_t i = 0; i < 3; ++i) {
    const bool wasPressed = buttons[i].stable;
    if (buttons[i].rose(digitalRead(BUTTON_PINS[i]) == LOW, now, 35)) {
      alert(i, "manual button");
      queuePhysicalAlert(i, false);
    }
    if (wasPressed && !buttons[i].stable) setLed(i, false);
  }
  // D0 is a smoke/gas threshold signal, not confirmation of a fire.
  const bool previousSmoke = smoke.stable;
  smoke.rose(smokeActive(), now, 500);
  if (smokeArmed && smoke.stable && !latched[0]) {
    alert(0, "smoke sensor (suspected fire)");
    queuePhysicalAlert(0, true);
  }
  if (previousSmoke != smoke.stable) printStatus();
  readVoice();
  delay(1);
}