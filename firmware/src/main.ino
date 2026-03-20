/*
 * ═══════════════════════════════════════════════════════════════
 * SMART ENERGY MONITORING SYSTEM — ESP32 + PZEM-004T v3.0
 * Single Phase | Wi-Fi → Cloud API (Vercel)
 * ═══════════════════════════════════════════════════════════════
 *
 * ⚡ HIGH-VOLTAGE WARNING ⚡
 * The PZEM-004T is connected to mains AC power.
 * All physical installation MUST be performed by a licensed
 * electrician. Never work on live wires.
 *
 * Required Libraries (install via Arduino IDE Library Manager):
 *   - PZEM004Tv30       by Jakub Mandula
 *   - ArduinoJson       by Benoit Blanchon
 *   - RTClib            by Adafruit
 *   - WebSocketsClient  by Links2004 (v2.4.0+)
 *   - WiFi              (built-in ESP32)
 *   - HTTPClient        (built-in ESP32)
 *   - WiFiClientSecure  (built-in ESP32)
 *
 * Wiring:
 *   RTC DS3231  → SDA=GPIO21, SCL=GPIO22 (I2C default)
 *   PZEM-004T   → RX2=GPIO16 (from PZEM TX), TX2=GPIO17 (to PZEM RX)
 *   RELAY       → GPIO25 (Normally Open: HIGH=Power ON, LOW=Power OFF)
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

// ──── PZEM SETUP (UART2: GPIO16=RX, GPIO17=TX) ─────────────
PZEM004Tv30 pzem(Serial2, 16, 17);

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
  Serial.println(" Energy Monitor v2.0 — Booting...");
  Serial.println("═══════════════════════════════════\n");

  // 1. Initialize RTC
  setupRTC();

  // 2. Connect to WiFi
  connectWiFi();

  // 3. Sync NTP — also writes to RTC if RTC lost power
  syncNTP();

  // 3.5. Fetch safety thresholds from cloud for local hardware override
  fetchThresholdsFromCloud();

  // 4. Initialize PZEM
  Serial.println("[PZEM] Initializing PZEM-004T on UART2 (GPIO16/17)...");
  delay(1000);

  // 5. Initialize Relay (default: normal operation, power flowing)
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);  // HIGH = Power ON (normal operation, power flowing)
  Serial.println("[RELAY] Relay initialized (normal state - power flowing).");

  // 6. Initialize Supabase Realtime WebSocket for relay control
  initSupabaseRealtime();

  Serial.println("[BOOT] System ready. Starting measurement loop.\n");
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
    readAndSend();
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
    // RTC coin cell died or first boot — do NOT use the stale compile-time
    // stamp. Set the flag so syncNTP() will write the correct time after WiFi.
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

    // Write NTP time back into RTC for persistent accuracy.
    // IMPORTANT: configTime() already applies GMT_OFFSET_SEC, so `timeinfo`
    // holds LOCAL time (UTC+8). The DS3231 should store pure UTC.
    // We subtract the offset to convert back to UTC before saving.
    if (rtcAvailable) {
      time_t localEpoch = mktime(&timeinfo);
      time_t utcEpoch   = localEpoch - GMT_OFFSET_SEC; // convert to UTC
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
// Returns ISO 8601 with correct UTC+8 offset: "2026-03-15T14:30:00+08:00"
// ════════════════════════════════════════════════════════════

String getTimestamp() {
  // Primary: RTC (no WiFi dependency, works offline)
  if (rtcAvailable) {
    DateTime utcNow = rtc.now();
    // DS3231 stores UTC. Convert to UTC+8 before appending +08:00.
    DateTime localNow(utcNow.unixtime() + GMT_OFFSET_SEC);
    char buf[30];
    sprintf(buf, "%04d-%02d-%02dT%02d:%02d:%02d+08:00",
            localNow.year(), localNow.month(), localNow.day(),
            localNow.hour(), localNow.minute(), localNow.second());
    return String(buf);
  }

  // Fallback: NTP system time
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    return String(buf) + "+08:00";
  }

  // Last resort: epoch placeholder (Zod will accept it, DB will show epoch)
  Serial.println("[TIME] ⚠ No time source available — using epoch.");
  return "1970-01-01T00:00:00+08:00";
}

// ════════════════════════════════════════════════════════════
// READ PZEM + SEND TO CLOUD
// ════════════════════════════════════════════════════════════

void readAndSend() {
  float voltage     = pzem.voltage();
  float current     = pzem.current();
  float power       = pzem.power();
  float energy      = pzem.energy();
  float frequency   = pzem.frequency();
  float powerFactor = pzem.pf();

  // Safety check: PZEM returns NaN when no AC is detected
  if (isnan(voltage) || isnan(current)) {
    Serial.println("[PZEM] ⚠ No AC reading (NaN). Is the PZEM connected to mains?");
    Serial.println("[PZEM]   → Voltage pin wired to Line/Neutral?");
    Serial.println("[PZEM]   → CT clamp secured around the live wire?");
    return;
  }

  // Print to Serial Monitor
  Serial.println("─── PZEM Reading ───────────────────");
  Serial.printf("  Voltage:      %.2f V\n",  voltage);
  Serial.printf("  Current:      %.3f A\n",  current);
  Serial.printf("  Power:        %.2f W\n",  power);
  Serial.printf("  Energy:       %.4f kWh\n", energy);
  Serial.printf("  Frequency:    %.1f Hz\n", frequency);
  Serial.printf("  Power Factor: %.2f\n",    powerFactor);
  Serial.printf("  Timestamp:    %s\n",      getTimestamp().c_str());
  Serial.println("────────────────────────────────────");

  // ══════════════════════════════════════════════════════════
  // LOCAL HARDWARE SAFETY OVERRIDE
  // This runs BEFORE sending to cloud, ensuring immediate protection
  // even if WiFi/WebSocket is disconnected.
  // ══════════════════════════════════════════════════════════
  bool localTrip = false;
  const char* localTripReason = nullptr;

  if (localSafetyEnabled && !relayState && voltage > 0) {
    // Only check if: local safety is enabled, relay not already tripped, and not a blackout
    if (voltage > localOvervoltageThreshold) {
      localTrip = true;
      localTripReason = "LOCAL_OVERVOLTAGE";
      Serial.println("════════════════════════════════════════════════════════");
      Serial.println("[ALERT] LOCAL HARDWARE OVERRIDE: DANGEROUS VOLTAGE! Killing Power...");
      Serial.printf("[ALERT]   Measured: %.2fV > Threshold: %.1fV\n", voltage, localOvervoltageThreshold);
      Serial.println("════════════════════════════════════════════════════════");
    } else if (voltage < localUndervoltageThreshold) {
      localTrip = true;
      localTripReason = "LOCAL_UNDERVOLTAGE";
      Serial.println("════════════════════════════════════════════════════════");
      Serial.println("[ALERT] LOCAL HARDWARE OVERRIDE: DANGEROUS VOLTAGE! Killing Power...");
      Serial.printf("[ALERT]   Measured: %.2fV < Threshold: %.1fV\n", voltage, localUndervoltageThreshold);
      Serial.println("════════════════════════════════════════════════════════");
    }

    if (localTrip) {
      relayState = true;
      digitalWrite(RELAY_PIN, LOW);   // LOW = Power OFF (tripped, relay de-energized)
      Serial.println("[RELAY] ⚡ LOCAL TRIP EXECUTED — Power disconnected.");
    }
  }

  // Build JSON payload using ArduinoJson (safe, no string concatenation bugs)
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;

  JsonObject reading = doc["reading"].to<JsonObject>();
  reading["voltage"]     = round(voltage     * 100)   / 100.0;
  reading["current"]     = round(current     * 1000)  / 1000.0;
  reading["power"]       = round(power       * 100)   / 100.0;
  reading["energy"]      = round(energy      * 10000) / 10000.0;
  reading["frequency"]   = round(frequency   * 10)    / 10.0;
  reading["powerFactor"] = round(powerFactor * 100)   / 100.0;

  doc["timestamp"] = getTimestamp();

  // Flag if this was a local safety trip
  if (localTrip && localTripReason) {
    doc["localTrip"] = true;
    doc["localTripReason"] = localTripReason;
  }

  // If voltage is exactly 0.00 (but not NaN), it means mains AC power is cut (Blackout)
  if (voltage == 0.0) {
    doc["blackout"] = true;
    Serial.println("[ALERT] Mains blackout detected (0V). Flagging payload.");
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

    // Print the full server response to help diagnose 401, 422, 429, etc.
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

    // Exponential backoff before next retry
    if (attempt < MAX_RETRIES - 1) {
      int backoff = BASE_DELAY_MS * (1 << attempt); // 1s, 2s, 4s
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
// ESP32 needs these values for local hardware override
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
// Provides <1 second latency for relay trip/reset commands
// ════════════════════════════════════════════════════════════

void initSupabaseRealtime() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WS] WiFi not connected, skipping WebSocket init.");
    return;
  }

  Serial.println("[WS] Connecting to Supabase Realtime...");

  // Build WebSocket path with API key
  String wsPath = "/realtime/v1/websocket?apikey=";
  wsPath += SUPABASE_ANON_KEY;
  wsPath += "&vsn=1.0.0";

  // Connect to Supabase Realtime endpoint (SSL on port 443)
  webSocket.beginSSL(SUPABASE_HOST, 443, wsPath.c_str());

  // Set event handler
  webSocket.onEvent(webSocketEvent);

  // Configure reconnection and heartbeat
  webSocket.setReconnectInterval(5000);           // 5s between reconnect attempts
  webSocket.enableHeartbeat(30000, 3000, 2);      // Ping every 30s, timeout 3s, 2 retries

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
      // Subscribe to relay_state table changes for this device
      subscribeToRelayState();
      break;

    case WStype_TEXT:
      // Handle incoming messages (relay state changes)
      handleRealtimeMessage((char*)payload);
      break;

    case WStype_ERROR:
      Serial.println("[WS] ✗ WebSocket error occurred");
      wsConnected = false;
      break;

    case WStype_PING:
      // Ping received, pong will be sent automatically
      break;

    case WStype_PONG:
      // Heartbeat acknowledged
      break;

    default:
      break;
  }
}

void subscribeToRelayState() {
  // Supabase Realtime uses Phoenix Channels protocol
  // Subscribe to changes on relay_state table filtered by device_id
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

  // Handle subscription confirmation
  if (strcmp(event, "phx_reply") == 0) {
    const char* status = doc["payload"]["status"];
    if (status && strcmp(status, "ok") == 0) {
      Serial.println("[WS] ✓ Subscription confirmed by Supabase");
    }
    return;
  }

  // Handle system messages (presence, heartbeat, etc.)
  if (strcmp(event, "system") == 0 || strcmp(event, "presence_state") == 0) {
    return; // Ignore system messages
  }

  // Handle database changes (INSERT, UPDATE, DELETE)
  if (strcmp(event, "postgres_changes") == 0) {
    const char* changeType = doc["payload"]["data"]["type"];
    JsonObject record = doc["payload"]["data"]["record"];

    if (!record.isNull()) {
      // Verify this update is for our device
      const char* recordDeviceId = record["device_id"];
      if (recordDeviceId && strcmp(recordDeviceId, DEVICE_ID) == 0) {
        bool newTrippedState = record["is_tripped"] | false;
        const char* tripReason = record["trip_reason"] | "UNKNOWN";

        // Only actuate relay if state actually changed
        if (newTrippedState != relayState) {
          relayState = newTrippedState;

          // Actuate relay: LOW = Power OFF (tripped), HIGH = Power ON (normal)
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

  // Log unknown events for debugging
  if (strcmp(event, "phx_reply") != 0) {
    Serial.printf("[WS] Received event: %s\n", event);
  }
}

// ════════════════════════════════════════════════════════════
// MANUAL RELAY CONTROL (for testing without WebSocket)
// Can be called from Serial commands or other triggers
// ════════════════════════════════════════════════════════════

void tripRelay(const char* reason) {
  if (!relayState) {
    relayState = true;
    digitalWrite(RELAY_PIN, LOW);   // LOW = Power OFF (tripped, relay de-energized)
    Serial.println("════════════════════════════════════════");
    Serial.printf("[RELAY] ⚡ MANUALLY TRIPPED! Reason: %s\n", reason);
    Serial.println("[RELAY] ⚠ Power disconnected.");
    Serial.println("════════════════════════════════════════");
  }
}

void resetRelay() {
  if (relayState) {
    relayState = false;
    digitalWrite(RELAY_PIN, HIGH);  // HIGH = Power ON (normal operation, power flowing)
    Serial.println("════════════════════════════════════════");
    Serial.println("[RELAY] ✓ MANUALLY RESET. Power restored.");
    Serial.println("════════════════════════════════════════");
  }
}

bool isRelayTripped() {
  return relayState;
}
