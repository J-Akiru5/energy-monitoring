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
 *   - PZEM004Tv30 by Jakub Mandula
 *   - ArduinoJson by Benoit Blanchon
 *   - WiFi (built-in ESP32)
 *   - HTTPClient (built-in ESP32)
 *
 * Board: ESP32 Dev Module (ESP32-WROOM-32U recommended)
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>

// ──── CONFIGURATION ─────────────────────────────────────────
// Wi-Fi Credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";

// Cloud API Endpoint (your Vercel deployment)
const char* API_ENDPOINT  = "https://your-app.vercel.app/api/ingest";

// Device Authentication Token (copy from Admin dashboard)
const char* DEVICE_TOKEN  = "em_YOUR_DEVICE_TOKEN_HERE";

// Device ID (copy from Admin dashboard after registration)
const char* DEVICE_ID     = "YOUR_DEVICE_UUID";

// Reading interval (milliseconds)
const unsigned long READ_INTERVAL = 2000; // 2 seconds

// ──── PZEM SETUP (UART2: GPIO16=RX, GPIO17=TX) ─────────────
// RX2=GPIO16 receives data FROM PZEM TX
// TX2=GPIO17 sends data TO PZEM RX
PZEM004Tv30 pzem(Serial2, 16, 17);

// ──── RETRY CONFIG ──────────────────────────────────────────
const int MAX_RETRIES = 3;
const int BASE_DELAY_MS = 1000;

// ──── GLOBALS ───────────────────────────────────────────────
unsigned long lastReadTime = 0;
int wifiRetryCount = 0;

// ════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  Serial.println("\n═══════════════════════════════════");
  Serial.println(" Energy Monitor v1.0 — Booting...");
  Serial.println("═══════════════════════════════════\n");

  connectWiFi();

  Serial.println("[PZEM] Initializing PZEM-004T on UART2 (GPIO16/17)...");
  // PZEM is ready after constructor; give it a moment
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
  }

  // Read and send at the configured interval
  if (now - lastReadTime >= READ_INTERVAL) {
    lastReadTime = now;
    readAndSend();
  }
}

// ════════════════════════════════════════════════════════════
// WiFi CONNECTION
// ════════════════════════════════════════════════════════════

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting to ");
  Serial.print(WIFI_SSID);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" Connected!");
    Serial.print("[WiFi] IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi] RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    wifiRetryCount = 0;
  } else {
    Serial.println(" FAILED!");
    wifiRetryCount++;
    // Exponential backoff for WiFi retries
    int backoff = min(BASE_DELAY_MS * (1 << wifiRetryCount), 60000);
    Serial.printf("[WiFi] Retrying in %d ms...\n", backoff);
    delay(backoff);
  }
}

// ════════════════════════════════════════════════════════════
// READ PZEM + SEND TO CLOUD
// ════════════════════════════════════════════════════════════

void readAndSend() {
  // Read all values from PZEM-004T
  float voltage     = pzem.voltage();
  float current     = pzem.current();
  float power       = pzem.power();
  float energy      = pzem.energy();
  float frequency   = pzem.frequency();
  float powerFactor = pzem.pf();

  // Check for read errors
  if (isnan(voltage) || isnan(current)) {
    Serial.println("[PZEM] ⚠ Error reading sensor. Check wiring.");
    return;
  }

  // Print to Serial Monitor
  Serial.println("─── PZEM Reading ───");
  Serial.printf("  Voltage:      %.1f V\n", voltage);
  Serial.printf("  Current:      %.3f A\n", current);
  Serial.printf("  Power:        %.1f W\n", power);
  Serial.printf("  Energy:       %.4f kWh\n", energy);
  Serial.printf("  Frequency:    %.1f Hz\n", frequency);
  Serial.printf("  Power Factor: %.2f\n", powerFactor);
  Serial.println("────────────────────");

  // Build JSON payload
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;

  JsonObject reading = doc["reading"].to<JsonObject>();
  reading["voltage"]     = round(voltage * 100) / 100.0;
  reading["current"]     = round(current * 1000) / 1000.0;
  reading["power"]       = round(power * 100) / 100.0;
  reading["energy"]      = round(energy * 10000) / 10000.0;
  reading["frequency"]   = round(frequency * 100) / 100.0;
  reading["powerFactor"] = round(powerFactor * 1000) / 1000.0;

  // ISO 8601 timestamp (approximate — ESP32 has no RTC by default)
  doc["timestamp"] = getTimestamp();

  String payload;
  serializeJson(doc, payload);

  // Send to cloud with retries
  sendToCloud(payload);
}

// ════════════════════════════════════════════════════════════
// HTTP POST WITH RETRIES
// ════════════════════════════════════════════════════════════

void sendToCloud(const String& payload) {
  for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
    HTTPClient http;
    http.begin(API_ENDPOINT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", DEVICE_TOKEN);
    http.setTimeout(5000);

    int httpCode = http.POST(payload);

    if (httpCode == 200 || httpCode == 201) {
      Serial.printf("[API] ✓ Data sent (HTTP %d)\n\n", httpCode);
      http.end();
      return;
    }

    Serial.printf("[API] ✗ Attempt %d failed (HTTP %d)\n", attempt + 1, httpCode);

    if (httpCode > 0) {
      String response = http.getString();
      Serial.printf("[API] Response: %s\n", response.c_str());
    }

    http.end();

    // Exponential backoff
    if (attempt < MAX_RETRIES - 1) {
      int backoff = BASE_DELAY_MS * (1 << attempt);
      Serial.printf("[API] Retrying in %d ms...\n", backoff);
      delay(backoff);
    }
  }

  Serial.println("[API] ✗ All retries exhausted. Will try next cycle.\n");
}

// ════════════════════════════════════════════════════════════
// TIMESTAMP HELPER
// ════════════════════════════════════════════════════════════

String getTimestamp() {
  // Simple uptime-based timestamp.
  // For accurate time, consider adding NTP sync:
  //   configTime(gmtOffset_sec, daylightOffset_sec, "pool.ntp.org");
  unsigned long ms = millis();
  unsigned long seconds = ms / 1000;
  unsigned long minutes = seconds / 60;
  unsigned long hours = minutes / 60;

  char buf[30];
  // Return a placeholder ISO format — NTP should replace this
  snprintf(buf, sizeof(buf), "2026-01-01T%02lu:%02lu:%02luZ",
           hours % 24, minutes % 60, seconds % 60);
  return String(buf);
}
