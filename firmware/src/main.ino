/*
 * ═══════════════════════════════════════════════════════════════
 * SMART ENERGY MONITORING SYSTEM — ESP32 + PZEM-004T v3.0
 * 3-Phase Monitoring | Wi-Fi → Cloud API (Vercel)
 * ═══════════════════════════════════════════════════════════════
 *
 * ⚡ HIGH-VOLTAGE WARNING ⚡
 * The PZEM-004T sensors are connected to mains AC power.
 * All physical installation MUST be performed by a licensed
 * electrician. Never work on live wires.
 *
 * Required Libraries (install via Arduino IDE Library Manager):
 *   - PZEM004Tv30       by Jakub Mandula
 *   - ArduinoJson       by Benoit Blanchon
 *   - RTClib            by Adafruit
 *   - WebSocketsClient  by Links2004 (v2.4.0+)
 *   - EspSoftwareSerial by Dirk Kaar (for Software Serial on ESP32)
 *   - WiFi              (built-in ESP32)
 *   - HTTPClient        (built-in ESP32)
 *   - WiFiClientSecure  (built-in ESP32)
 *
 * Wiring (3-Phase Configuration):
 *   RTC DS3231    → SDA=GPIO21, SCL=GPIO22 (I2C default)
 *   PZEM Phase A  → Hardware Serial2: RX=GPIO16 (from PZEM TX), TX=GPIO17 (to
 * PZEM RX) PZEM Phase B  → Hardware Serial1: RX=GPIO5,  TX=GPIO4 PZEM Phase C
 * → Hardware Serial0: RX=GPIO18, TX=GPIO19 RELAY         → GPIO25 (Normally
 * Open: HIGH=Power ON, LOW=Power OFF)
 *
 * Board: ESP32 Dev Module (ESP32-WROOM-32U recommended)
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>
#include <Wire.h>
#include <RTClib.h>
#include <WebSocketsClient.h>

// ──── CONFIGURATION ─────────────────────────────────────────
// Wi-Fi Credentials
const char* WIFI_SSID     = "PLDTHOMEFIBRD2EsF";
const char* WIFI_PASSWORD = "PLDTWIFIH8xVh";

// Cloud API Endpoint (Vercel deployment)
const char* API_ENDPOINT  = "https://energy-monitoring-web.vercel.app/api/ingest";

// Device Authentication Token (matches DEVICE_API_KEY in .env / Admin dashboard)
const char* DEVICE_TOKEN  = "cict_monitor_8829_x92_secret";

// Device ID (UUID from Supabase devices table)
const char* DEVICE_ID     = "d566ef3b-3e6e-4ed2-acb7-9de59aaf4d6b";

// Reading interval (milliseconds) — must be > 1000ms due to API rate limit
const unsigned long READ_INTERVAL = 5000; // 5 seconds

// Timezone: Philippines (UTC+8) — applied to RTC local time
const char* TZ_OFFSET_STR = "+08:00";

// ──── 3-PHASE PZEM SETUP (Hardware UARTs Only) ──────────────
// Phase A: Hardware Serial 2 (keep current - working)
// RX = GPIO16 (from PZEM TX), TX = GPIO17 (to PZEM RX)
PZEM004Tv30 pzemA(Serial2, 16, 17);

// Phase B: Hardware Serial 1 with custom pins
// RX = GPIO5 (from PZEM TX), TX = GPIO4 (to PZEM RX)
PZEM004Tv30 pzemB(Serial1, 5, 4);

// Phase C: Hardware Serial 0 with reassigned pins
// RX = GPIO18 (from PZEM TX), TX = GPIO19 (to PZEM RX)
// NOTE: This reassigns Serial, losing debug output capability
PZEM004Tv30 pzemC(Serial, 18, 19);

// ──── RTC SETUP ─────────────────────────────────────────────
RTC_DS3231 rtc;
bool rtcAvailable = false;

// ──── NTP CONFIG (fallback + RTC calibration) ───────────────
const char* NTP_SERVER         = "pool.ntp.org";
const long  GMT_OFFSET_SEC     = 8 * 3600; // UTC+8 Philippines
const int   DAYLIGHT_OFFSET_SEC = 0;

// ──── RETRY CONFIG ──────────────────────────────────────────
const int MAX_RETRIES    = 3;
const int BASE_DELAY_MS  = 1000;

// ──── GLOBALS ───────────────────────────────────────────────
unsigned long lastReadTime = 0;
unsigned long lastNtpSyncTime = 0;
bool rtcNeedSync = false;                // true if RTC lost power and needs NTP
const unsigned long NTP_RESYNC_INTERVAL = 6UL * 60 * 60 * 1000; // 6 hours
int wifiRetryCount = 0;

// ──── RELAY CONTROL ─────────────────────────────────────────
const int RELAY_PIN = 25;                // GPIO25 for relay control (Normally Open)
bool relayState = false;                 // false = normal (power ON), true = tripped (power OFF)

// ──── LOCAL SAFETY THRESHOLDS ───────────────────────────────
// Fetched from cloud on boot, provides protection even if WiFi disconnects
float localOvervoltageThreshold = 250.0;   // Default: 250V (will be overwritten from cloud)
float localUndervoltageThreshold = 200.0;  // Default: 200V (will be overwritten from cloud)
bool localSafetyEnabled = true;            // Enable local hardware override by default

// ──── SUPABASE REALTIME (WebSocket) ─────────────────────────
// Replace these with your Supabase project credentials
const char* SUPABASE_HOST = "your-project.supabase.co";  // e.g., "xyzcompany.supabase.co"
const char* SUPABASE_ANON_KEY = "your-anon-key-here";    // Settings → API → anon/public key

WebSocketsClient webSocket;
bool wsConnected = false;
unsigned long lastReconnectAttempt = 0;
const unsigned long WS_RECONNECT_INTERVAL = 5000;   // 5s between reconnection attempts
unsigned long wsDisconnectTime = 0;                 // Track how long WS has been disconnected

// ════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  Serial.println("\n═══════════════════════════════════");
  Serial.println(" Energy Monitor v3.0 — 3-PHASE");
  Serial.println("═══════════════════════════════════\n");

  // 1. Initialize RTC
  setupRTC();

  // 2. Connect to WiFi
  connectWiFi();

  // 3. Sync NTP — also writes to RTC if RTC lost power
  syncNTP();

  // 3.5. Fetch safety thresholds from cloud for local hardware override
  fetchThresholdsFromCloud();

  // 4. Initialize PZEM sensors (3-phase)
  Serial.println("[PZEM] Initializing 3-Phase PZEM-004T sensors...");
  Serial.println("[PZEM]   Phase A: Hardware Serial2 (GPIO16/17)");
  Serial.println("[PZEM]   Phase B: Hardware Serial1 (GPIO5/4)");
  Serial.println("[PZEM]   Phase C: Hardware Serial  (GPIO18/19)");
  Serial.println("[PZEM] All 3 PZEM sensors initialized on hardware UARTs.");
  Serial.println("[PZEM] ⚠ NOTE: Serial debugging will stop after boot (reassigned to Phase C)");
  delay(1000);

  // 5. Initialize Relay (default: normal operation, power flowing)
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);  // HIGH = Power ON (normal operation, power flowing)
  Serial.println("[RELAY] Relay initialized (normal state - power flowing).");

  // 6. Initialize Supabase Realtime WebSocket for relay control
  initSupabaseRealtime();

  Serial.println("[BOOT] System ready. Starting 3-phase measurement loop.\n");
}

// ════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════

void loop() {
  unsigned long now = millis();

  // ── Maintain WebSocket connection ──
  webSocket.loop();

  // Auto-reconnect WebSocket if disconnected
  if (!wsConnected && (now - lastReconnectAttempt > WS_RECONNECT_INTERVAL)) {
    lastReconnectAttempt = now;
    Serial.println("[WS] Reconnecting to Supabase Realtime...");
    initSupabaseRealtime();
  }

  // Safety: Track WebSocket disconnect duration
  if (!wsConnected) {
    if (wsDisconnectTime == 0) wsDisconnectTime = now;
    // Warn every 30s if disconnected for >60s
    if (now - wsDisconnectTime > 60000) {
      static unsigned long lastWarnTime = 0;
      if (now - lastWarnTime > 30000) {
        Serial.println("[RELAY] WARNING: WebSocket disconnected >60s, maintaining last relay state.");
        lastWarnTime = now;
      }
    }
  } else {
    wsDisconnectTime = 0;
  }

  // Reconnect WiFi if lost
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection lost. Reconnecting...");
    connectWiFi();
  }

  // Sync NTP: on startup (if RTC lost power) OR every 6 hours
  bool syncNeeded = rtcNeedSync || (now - lastNtpSyncTime >= NTP_RESYNC_INTERVAL);
  if (syncNeeded && WiFi.status() == WL_CONNECTED) {
    syncNTP();
  }

  // Read and send at the configured interval
  if (now - lastReadTime >= READ_INTERVAL) {
    lastReadTime = now;
    readAndSend3Phase();
  }
}

// ════════════════════════════════════════════════════════════
// RTC INITIALIZATION
// ════════════════════════════════════════════════════════════

void setupRTC() {
  if (!rtc.begin()) {
    Serial.println("[RTC] ⚠ DS3231 not found! Check SDA(21) and SCL(22).");
    Serial.println("[RTC] Will fall back to NTP time only.");
    rtcAvailable = false;
    return;
  }

  rtcAvailable = true;

  if (rtc.lostPower()) {
    Serial.println("[RTC] ⚠ RTC lost power — will sync from NTP after WiFi connects.");
    rtcNeedSync = true;
  } else {
    DateTime now = rtc.now();
    Serial.printf("[RTC] ✓ Clock OK (UTC) → %04d-%02d-%02dT%02d:%02d:%02dZ\n",
      now.year(), now.month(), now.day(),
      now.hour(), now.minute(), now.second());
  }
}

// ════════════════════════════════════════════════════════════
// NTP TIME SYNC — also calibrates the RTC
// ════════════════════════════════════════════════════════════

void syncNTP() {
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  Serial.print("[NTP] Syncing time");

  struct tm timeinfo;
  int attempts = 0;
  while (!getLocalTime(&timeinfo) && attempts < 15) {
    Serial.print(".");
    delay(500);
    attempts++;
  }

  if (attempts < 15) {
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    Serial.printf(" OK → %s%s\n", buf, TZ_OFFSET_STR);

    if (rtcAvailable) {
      time_t localEpoch = mktime(&timeinfo);
      time_t utcEpoch   = localEpoch - GMT_OFFSET_SEC;
      rtc.adjust(DateTime((uint32_t)utcEpoch));
      Serial.println("[RTC] ✓ RTC calibrated from NTP (stored as UTC).");
    }

    lastNtpSyncTime = millis();
    rtcNeedSync = false;
  } else {
    Serial.println(" FAILED.");
    if (rtcAvailable) {
      Serial.println("[NTP] Falling back to RTC time.");
    } else {
      Serial.println("[NTP] ⚠ No RTC and no NTP — timestamps will be incorrect.");
    }
  }
}

// ════════════════════════════════════════════════════════════
// TIMESTAMP HELPER
// ════════════════════════════════════════════════════════════

String getTimestamp() {
  if (rtcAvailable) {
    DateTime utcNow = rtc.now();
    DateTime localNow(utcNow.unixtime() + GMT_OFFSET_SEC);
    char buf[30];
    sprintf(buf, "%04d-%02d-%02dT%02d:%02d:%02d+08:00",
            localNow.year(), localNow.month(), localNow.day(),
            localNow.hour(), localNow.minute(), localNow.second());
    return String(buf);
  }

  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    return String(buf) + "+08:00";
  }

  Serial.println("[TIME] ⚠ No time source available — using epoch.");
  return "1970-01-01T00:00:00+08:00";
}

// ════════════════════════════════════════════════════════════
// READ 3-PHASE PZEM + SEND TO CLOUD
// ════════════════════════════════════════════════════════════

void readAndSend3Phase() {
  // ── Read Phase A (Hardware Serial - fastest) ──
  float voltageA     = pzemA.voltage();
  float currentA     = pzemA.current();
  float powerA       = pzemA.power();
  float energyA      = pzemA.energy();
  float frequencyA   = pzemA.frequency();
  float powerFactorA = pzemA.pf();

  // ── Read Phase B (Software Serial) ──
  float voltageB     = pzemB.voltage();
  float currentB     = pzemB.current();
  float powerB       = pzemB.power();
  float energyB      = pzemB.energy();
  float frequencyB   = pzemB.frequency();
  float powerFactorB = pzemB.pf();

  // ── Read Phase C (Software Serial) ──
  float voltageC     = pzemC.voltage();
  float currentC     = pzemC.current();
  float powerC       = pzemC.power();
  float energyC      = pzemC.energy();
  float frequencyC   = pzemC.frequency();
  float powerFactorC = pzemC.pf();

  // ══════════════════════════════════════════════════════════
  // SENSOR OFFLINE DETECTION
  // If ALL phases return NaN, the ESP32 is online but cannot
  // communicate with any sensor. 0V readings indicate brownout/blackout.
  // ══════════════════════════════════════════════════════════
  bool phaseAOffline = isnan(voltageA) || isnan(currentA);
  bool phaseBOffline = isnan(voltageB) || isnan(currentB);
  bool phaseCOffline = isnan(voltageC) || isnan(currentC);

  if (phaseAOffline && phaseBOffline && phaseCOffline) {
    Serial.println("[PZEM] ⚠ All sensors offline (NaN readings)!");
    Serial.println("[PZEM]   → Check wiring for all 3 phases");
    Serial.println("[PZEM]   → Sending sensorOffline notification to cloud...");

    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["timestamp"] = getTimestamp();
    doc["sensorOffline"] = true;

    String payload;
    serializeJson(doc, payload);
    sendToCloud(payload);
    return;
  }

  // Handle individual phase offline (use 0 for offline phases)
  if (phaseAOffline) {
    Serial.println("[PZEM] ⚠ Phase A offline - NaN reading (sensor comm failed)");
    voltageA = currentA = powerA = energyA = frequencyA = powerFactorA = 0;
  }
  if (phaseBOffline) {
    Serial.println("[PZEM] ⚠ Phase B offline - NaN reading (sensor comm failed)");
    voltageB = currentB = powerB = energyB = frequencyB = powerFactorB = 0;
  }
  if (phaseCOffline) {
    Serial.println("[PZEM] ⚠ Phase C offline - NaN reading (sensor comm failed)");
    voltageC = currentC = powerC = energyC = frequencyC = powerFactorC = 0;
  }

  // Print to Serial Monitor
  Serial.println("─── 3-PHASE PZEM Reading ───────────────────");
  Serial.printf("  Phase A: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f\n",
                voltageA, currentA, powerA, energyA, powerFactorA);
  Serial.printf("  Phase B: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f\n",
                voltageB, currentB, powerB, energyB, powerFactorB);
  Serial.printf("  Phase C: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f\n",
                voltageC, currentC, powerC, energyC, powerFactorC);

  float totalPower = powerA + powerB + powerC;
  float totalEnergy = energyA + energyB + energyC;
  Serial.printf("  TOTAL:   %.1fW  %.4fkWh\n", totalPower, totalEnergy);
  Serial.printf("  Timestamp: %s\n", getTimestamp().c_str());
  Serial.println("────────────────────────────────────────────");

  // ══════════════════════════════════════════════════════════
  // LOCAL HARDWARE SAFETY OVERRIDE — Check ALL phases
  // Trip ONLY on overvoltage (>250V) for testing purposes
  // Undervoltage/brownout detection disabled to allow single-phase testing
  // ══════════════════════════════════════════════════════════
  bool localTrip = false;
  const char* localTripReason = nullptr;
  float tripVoltage = 0;

  if (localSafetyEnabled && !relayState) {
    // Check Phase A - OVERVOLTAGE ONLY
    if (!phaseAOffline && voltageA > 0) {
      if (voltageA > localOvervoltageThreshold) {
        localTrip = true;
        localTripReason = "LOCAL_OVERVOLTAGE_PHASE_A";
        tripVoltage = voltageA;
      }
    }

    // Check Phase B - OVERVOLTAGE ONLY
    if (!localTrip && !phaseBOffline && voltageB > 0) {
      if (voltageB > localOvervoltageThreshold) {
        localTrip = true;
        localTripReason = "LOCAL_OVERVOLTAGE_PHASE_B";
        tripVoltage = voltageB;
      }
    }

    // Check Phase C - OVERVOLTAGE ONLY
    if (!localTrip && !phaseCOffline && voltageC > 0) {
      if (voltageC > localOvervoltageThreshold) {
        localTrip = true;
        localTripReason = "LOCAL_OVERVOLTAGE_PHASE_C";
        tripVoltage = voltageC;
      }
    }

    if (localTrip) {
      Serial.println("════════════════════════════════════════════════════════");
      Serial.println("[ALERT] LOCAL HARDWARE OVERRIDE: DANGEROUS VOLTAGE! Killing Power...");
      Serial.printf("[ALERT]   Reason: %s  Voltage: %.2fV\n", localTripReason, tripVoltage);
      Serial.println("════════════════════════════════════════════════════════");

      relayState = true;
      digitalWrite(RELAY_PIN, LOW);   // LOW = Power OFF (tripped)
      Serial.println("[RELAY] ⚡ LOCAL TRIP EXECUTED — Power disconnected.");
    }
  }

  // Build 3-phase JSON payload using ArduinoJson
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;

  // 3-Phase reading structure
  JsonObject threePhase = doc["threePhase"].to<JsonObject>();

  // Phase A
  JsonObject phaseA = threePhase["phase_a"].to<JsonObject>();
  phaseA["voltage"]     = round(voltageA     * 100)   / 100.0;
  phaseA["current"]     = round(currentA     * 1000)  / 1000.0;
  phaseA["power"]       = round(powerA       * 100)   / 100.0;
  phaseA["energy"]      = round(energyA      * 10000) / 10000.0;
  phaseA["frequency"]   = round(frequencyA   * 100)   / 100.0;
  phaseA["powerFactor"] = round(powerFactorA * 1000)  / 1000.0;

  // Phase B
  JsonObject phaseB = threePhase["phase_b"].to<JsonObject>();
  phaseB["voltage"]     = round(voltageB     * 100)   / 100.0;
  phaseB["current"]     = round(currentB     * 1000)  / 1000.0;
  phaseB["power"]       = round(powerB       * 100)   / 100.0;
  phaseB["energy"]      = round(energyB      * 10000) / 10000.0;
  phaseB["frequency"]   = round(frequencyB   * 100)   / 100.0;
  phaseB["powerFactor"] = round(powerFactorB * 1000)  / 1000.0;

  // Phase C
  JsonObject phaseC_obj = threePhase["phase_c"].to<JsonObject>();
  phaseC_obj["voltage"]     = round(voltageC     * 100)   / 100.0;
  phaseC_obj["current"]     = round(currentC     * 1000)  / 1000.0;
  phaseC_obj["power"]       = round(powerC       * 100)   / 100.0;
  phaseC_obj["energy"]      = round(energyC      * 10000) / 10000.0;
  phaseC_obj["frequency"]   = round(frequencyC   * 100)   / 100.0;
  phaseC_obj["powerFactor"] = round(powerFactorC * 1000)  / 1000.0;

  doc["timestamp"] = getTimestamp();

  // Flag if this was a local safety trip
  if (localTrip && localTripReason) {
    doc["localTrip"] = true;
    doc["localTripReason"] = localTripReason;
  }

  // If ALL voltages are 0 (but not NaN), it means mains AC power is cut (Blackout)
  if (voltageA == 0.0 && voltageB == 0.0 && voltageC == 0.0) {
    doc["blackout"] = true;
    Serial.println("[ALERT] Mains blackout detected (0V on all phases). Flagging payload.");
  }

  String payload;
  serializeJson(doc, payload);

  sendToCloud(payload);
}

// ════════════════════════════════════════════════════════════
// HTTP POST WITH RETRIES + EXPONENTIAL BACKOFF
// ════════════════════════════════════════════════════════════

void sendToCloud(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[API] ✗ Skipping POST — WiFi not connected.");
    return;
  }

  Serial.printf("[API] Sending payload: %s\n", payload.c_str());

  for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
    WiFiClientSecure client;
    client.setInsecure(); // Skip TLS cert verification (acceptable for IoT)

    HTTPClient http;
    http.begin(client, API_ENDPOINT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", DEVICE_TOKEN);
    http.setTimeout(8000); // 8s — allows for Vercel cold starts

    int httpCode = http.POST(payload);

    if (httpCode == 200 || httpCode == 201) {
      Serial.printf("[API] ✓ Data sent (HTTP %d)\n\n", httpCode);
      http.end();
      return;
    }

    String response = "(no response body)";
    if (httpCode > 0) {
      response = http.getString();
    }
    Serial.printf("[API] ✗ Attempt %d/%d — HTTP %d\n", attempt + 1, MAX_RETRIES, httpCode);
    Serial.printf("[API]   Server said: %s\n", response.c_str());

    if (httpCode == 401) Serial.println("[API]   → Check DEVICE_TOKEN matches the Admin dashboard.");
    if (httpCode == 422) Serial.println("[API]   → Payload schema mismatch. Check timestamp format.");
    if (httpCode == 429) Serial.println("[API]   → Rate limited. READ_INTERVAL too low (must be >1000ms).");
    if (httpCode == -1)  Serial.println("[API]   → Connection refused. Check API_ENDPOINT URL.");

    http.end();

    if (attempt < MAX_RETRIES - 1) {
      int backoff = BASE_DELAY_MS * (1 << attempt);
      Serial.printf("[API] Retrying in %d ms...\n", backoff);
      delay(backoff);
    }
  }

  Serial.println("[API] ✗ All retries exhausted. Will try next cycle.\n");
}

// ════════════════════════════════════════════════════════════
// WiFi CONNECTION WITH TIMEOUT + EXPONENTIAL BACKOFF
// ════════════════════════════════════════════════════════════

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Connecting to \"%s\"...\n", WIFI_SSID);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] ✓ Connected!");
    Serial.printf("[WiFi]   IP:   %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi]   RSSI: %d dBm\n", WiFi.RSSI());
    if (WiFi.RSSI() < -75) {
      Serial.println("[WiFi]   ⚠ Weak signal! Consider moving the antenna closer.");
    }
    wifiRetryCount = 0;
  } else {
    Serial.println("[WiFi] ✗ FAILED to connect!");
    Serial.printf("[WiFi]   SSID tried: \"%s\"\n", WIFI_SSID);
    Serial.println("[WiFi]   → Double-check SSID and PASSWORD spelling (case-sensitive).");
    Serial.println("[WiFi]   → Is the router 2.4GHz? ESP32 does not support 5GHz.");
    wifiRetryCount++;
    int backoff = min(BASE_DELAY_MS * (1 << wifiRetryCount), 60000);
    Serial.printf("[WiFi]   Retrying in %d ms...\n", backoff);
    delay(backoff);
  }
}

// ════════════════════════════════════════════════════════════
// FETCH THRESHOLDS FROM CLOUD ON BOOT
// ════════════════════════════════════════════════════════════

void fetchThresholdsFromCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[THRESHOLDS] WiFi not connected, using defaults.");
    Serial.printf("[THRESHOLDS]   Overvoltage:  %.1fV\n", localOvervoltageThreshold);
    Serial.printf("[THRESHOLDS]   Undervoltage: %.1fV\n", localUndervoltageThreshold);
    return;
  }

  Serial.println("[THRESHOLDS] Fetching safety thresholds from cloud...");

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String thresholdsUrl = String("https://energy-monitoring-web.vercel.app/api/thresholds/esp32?deviceId=") + DEVICE_ID;
  http.begin(client, thresholdsUrl);
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  http.setTimeout(8000);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      localOvervoltageThreshold = doc["overvoltage"] | 250.0;
      localUndervoltageThreshold = doc["undervoltage"] | 200.0;
      localSafetyEnabled = doc["localSafetyEnabled"] | true;

      Serial.println("[THRESHOLDS] ✓ Thresholds fetched successfully:");
      Serial.printf("[THRESHOLDS]   Overvoltage:  %.1fV\n", localOvervoltageThreshold);
      Serial.printf("[THRESHOLDS]   Undervoltage: %.1fV\n", localUndervoltageThreshold);
      Serial.printf("[THRESHOLDS]   Local Safety: %s\n", localSafetyEnabled ? "ENABLED" : "DISABLED");
    } else {
      Serial.printf("[THRESHOLDS] ⚠ JSON parse error: %s\n", error.c_str());
      Serial.println("[THRESHOLDS]   Using default thresholds.");
    }
  } else {
    Serial.printf("[THRESHOLDS] ⚠ HTTP %d — using defaults.\n", httpCode);
    Serial.printf("[THRESHOLDS]   Overvoltage:  %.1fV\n", localOvervoltageThreshold);
    Serial.printf("[THRESHOLDS]   Undervoltage: %.1fV\n", localUndervoltageThreshold);
  }

  http.end();
}

// ════════════════════════════════════════════════════════════
// SUPABASE REALTIME — WebSocket Connection for Relay Control
// ════════════════════════════════════════════════════════════

void initSupabaseRealtime() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WS] WiFi not connected, skipping WebSocket init.");
    return;
  }

  Serial.println("[WS] Connecting to Supabase Realtime...");

  String wsPath = "/realtime/v1/websocket?apikey=";
  wsPath += SUPABASE_ANON_KEY;
  wsPath += "&vsn=1.0.0";

  webSocket.beginSSL(SUPABASE_HOST, 443, wsPath.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(30000, 3000, 2);

  Serial.println("[WS] WebSocket initialized.");
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] ✗ Disconnected from Supabase Realtime");
      wsConnected = false;
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] ✓ Connected to Supabase Realtime!");
      wsConnected = true;
      subscribeToRelayState();
      break;

    case WStype_TEXT:
      handleRealtimeMessage((char*)payload);
      break;

    case WStype_ERROR:
      Serial.println("[WS] ✗ WebSocket error occurred");
      wsConnected = false;
      break;

    case WStype_PING:
    case WStype_PONG:
      break;

    default:
      break;
  }
}

void subscribeToRelayState() {
  JsonDocument doc;
  doc["topic"] = String("realtime:public:relay_state:device_id=eq.") + DEVICE_ID;
  doc["event"] = "phx_join";
  doc["payload"]["config"]["postgres_changes"][0]["event"] = "*";
  doc["payload"]["config"]["postgres_changes"][0]["schema"] = "public";
  doc["payload"]["config"]["postgres_changes"][0]["table"] = "relay_state";
  doc["payload"]["config"]["postgres_changes"][0]["filter"] = String("device_id=eq.") + DEVICE_ID;
  doc["ref"] = "1";

  String message;
  serializeJson(doc, message);

  webSocket.sendTXT(message);
  Serial.println("[WS] Subscribed to relay_state changes for this device");
  Serial.printf("[WS]   Device ID: %s\n", DEVICE_ID);
}

void handleRealtimeMessage(char* payload) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    Serial.printf("[WS] JSON parse error: %s\n", error.c_str());
    return;
  }

  const char* event = doc["event"];

  if (strcmp(event, "phx_reply") == 0) {
    const char* status = doc["payload"]["status"];
    if (status && strcmp(status, "ok") == 0) {
      Serial.println("[WS] ✓ Subscription confirmed by Supabase");
    }
    return;
  }

  if (strcmp(event, "heartbeat") == 0 || strcmp(event, "phx_heartbeat") == 0) {
    const char* topic = doc["topic"] | "phoenix";
    const char* ref = doc["ref"];

    JsonDocument reply;
    reply["topic"] = topic;
    reply["event"] = "phx_reply";
    reply["ref"] = ref;
    reply["payload"]["status"] = "ok";
    reply["payload"]["response"] = JsonObject();

    String replyStr;
    serializeJson(reply, replyStr);
    webSocket.sendTXT(replyStr);
    Serial.println("[WS] ♥ Phoenix heartbeat acknowledged");
    return;
  }

  if (strcmp(event, "system") == 0 || strcmp(event, "presence_state") == 0) {
    return;
  }

  if (strcmp(event, "postgres_changes") == 0) {
    const char* changeType = doc["payload"]["data"]["type"];
    JsonObject record = doc["payload"]["data"]["record"];

    if (!record.isNull()) {
      const char* recordDeviceId = record["device_id"];
      if (recordDeviceId && strcmp(recordDeviceId, DEVICE_ID) == 0) {
        bool newTrippedState = record["is_tripped"] | false;
        const char* tripReason = record["trip_reason"] | "UNKNOWN";

        if (newTrippedState != relayState) {
          relayState = newTrippedState;
          digitalWrite(RELAY_PIN, relayState ? LOW : HIGH);

          Serial.println("════════════════════════════════════════");
          if (relayState) {
            Serial.printf("[RELAY] ⚡ CIRCUIT TRIPPED! Reason: %s\n", tripReason);
            Serial.println("[RELAY] ⚠ Power disconnected to protect equipment.");
          } else {
            Serial.println("[RELAY] ✓ Circuit RESET. Power restored.");
          }
          Serial.printf("[RELAY] State: %s\n", relayState ? "TRIPPED" : "NORMAL");
          Serial.println("════════════════════════════════════════");
        }
      }
    }
    return;
  }

  if (strcmp(event, "phx_reply") != 0) {
    Serial.printf("[WS] Received event: %s\n", event);
  }
}

// ════════════════════════════════════════════════════════════
// MANUAL RELAY CONTROL
// ════════════════════════════════════════════════════════════

void tripRelay(const char* reason) {
  if (!relayState) {
    relayState = true;
    digitalWrite(RELAY_PIN, LOW);
    Serial.println("════════════════════════════════════════");
    Serial.printf("[RELAY] ⚡ MANUALLY TRIPPED! Reason: %s\n", reason);
    Serial.println("[RELAY] ⚠ Power disconnected.");
    Serial.println("════════════════════════════════════════");
  }
}

void resetRelay() {
  if (relayState) {
    relayState = false;
    digitalWrite(RELAY_PIN, HIGH);
    Serial.println("════════════════════════════════════════");
    Serial.println("[RELAY] ✓ MANUALLY RESET. Power restored.");
    Serial.println("════════════════════════════════════════");
  }
}

bool isRelayTripped() {
  return relayState;
}
