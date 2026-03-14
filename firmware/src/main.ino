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
 *   - WiFi              (built-in ESP32)
 *   - HTTPClient        (built-in ESP32)
 *   - WiFiClientSecure  (built-in ESP32)
 *
 * Wiring:
 *   RTC DS3231  → SDA=GPIO21, SCL=GPIO22 (I2C default)
 *   PZEM-004T   → RX2=GPIO16 (from PZEM TX), TX2=GPIO17 (to PZEM RX)
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
int wifiRetryCount = 0;

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

  // 4. Initialize PZEM
  Serial.println("[PZEM] Initializing PZEM-004T on UART2 (GPIO16/17)...");
  delay(1000);

  Serial.println("[BOOT] System ready. Starting measurement loop.\n");
}

// ════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════

void loop() {
  unsigned long now = millis();

  // Reconnect WiFi if lost
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection lost. Reconnecting...");
    connectWiFi();
    syncNTP(); // Re-sync NTP after WiFi recovery
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
    Serial.println("[RTC] ⚠ RTC lost power — clock is not set. NTP will calibrate it.");
    // Temporary compile-time stamp; NTP will overwrite after WiFi connects
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  } else {
    DateTime now = rtc.now();
    Serial.printf("[RTC] ✓ Clock OK → %04d-%02d-%02dT%02d:%02d:%02d\n",
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

    // Write NTP time back into RTC for persistent accuracy
    if (rtcAvailable) {
      // mktime uses local time; NTP already gave us local (UTC+8)
      time_t ntpEpoch = mktime(&timeinfo);
      rtc.adjust(DateTime((uint32_t)ntpEpoch));
      Serial.println("[RTC] ✓ RTC calibrated from NTP.");
    }
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
    DateTime now = rtc.now();
    char buf[30];
    sprintf(buf, "%04d-%02d-%02dT%02d:%02d:%02d+08:00",
      now.year(), now.month(), now.day(),
      now.hour(), now.minute(), now.second());
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
