#include "network.h"
#include "config.h"
#include "secrets.h"
#include "rtc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

extern bool rtcAvailable;
extern bool rtcNeedSync;
extern unsigned long lastNtpSyncTime;
extern int wifiRetryCount;
extern float localOvervoltageThreshold;
extern float localUndervoltageThreshold;
extern bool localSafetyEnabled;

// ──── WiFi CONNECTION ─────────────────────────────────────
// Uses exponential backoff. On success resets retry counter.
// On failure increments counter and delays before returning
// (caller decides whether to retry).
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
    Serial.println("[WiFi] Connected!");
    Serial.printf("[WiFi]   IP:   %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi]   RSSI: %d dBm\n", WiFi.RSSI());
    if (WiFi.RSSI() < -75) {
      Serial.println("[WiFi]   Weak signal! Consider moving the antenna closer.");
    }
    wifiRetryCount = 0;
  } else {
    Serial.println("[WiFi] FAILED to connect!");
    Serial.printf("[WiFi]   SSID tried: \"%s\"\n", WIFI_SSID);
    Serial.println("[WiFi]   -> Double-check SSID and PASSWORD spelling (case-sensitive).");
    Serial.println("[WiFi]   -> Is the router 2.4GHz? ESP32 does not support 5GHz.");
    wifiRetryCount++;
    int backoff = min(BASE_DELAY_MS * (1 << wifiRetryCount), (int)WIFI_RETRY_MAX_BACKOFF_MS);
    Serial.printf("[WiFi]   Retrying in %d ms...\n", backoff);
    delay(backoff);
  }
}

// ──── NTP TIME SYNC ───────────────────────────────────────
// Also calibrates the RTC clock from NTP time.
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
    Serial.printf(" OK -> %s%s\n", buf, TZ_OFFSET_STR);

    // Calibrate RTC from NTP if RTC is available
    if (rtcAvailable) {
      time_t localEpoch = mktime(&timeinfo);
      time_t utcEpoch   = localEpoch - GMT_OFFSET_SEC;
      rtc.adjust(DateTime((uint32_t)utcEpoch));
      Serial.println("[RTC] RTC calibrated from NTP (stored as UTC).");
    }

    lastNtpSyncTime = millis();
    rtcNeedSync = false;
  } else {
    Serial.println(" FAILED.");
    if (rtcAvailable) {
      Serial.println("[NTP] Falling back to RTC time.");
    } else {
      Serial.println("[NTP] No RTC and no NTP — timestamps will be incorrect.");
    }
  }
}

// ──── HTTP POST WITH RETRIES ──────────────────────────────
// Sends JSON payload to cloud API. Uses exponential backoff
// between retries. Does not block the next sensor cycle if
// all retries fail.
void sendToCloud(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[API] Skipping POST — WiFi not connected.");
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
    http.setTimeout(HTTP_TIMEOUT_MS);

    int httpCode = http.POST(payload);

    if (httpCode == 200 || httpCode == 201) {
      Serial.printf("[API] Data sent (HTTP %d)\n\n", httpCode);
      http.end();
      return;
    }

    String response = "(no response body)";
    if (httpCode > 0) {
      response = http.getString();
    }
    Serial.printf("[API] Attempt %d/%d — HTTP %d\n", attempt + 1, MAX_RETRIES, httpCode);
    Serial.printf("[API]   Server said: %s\n", response.c_str());

    if (httpCode == 401) Serial.println("[API]   -> Check DEVICE_TOKEN matches the Admin dashboard.");
    if (httpCode == 422) Serial.println("[API]   -> Payload schema mismatch. Check timestamp format.");
    if (httpCode == 429) Serial.println("[API]   -> Rate limited. SENSOR_INTERVAL_MS too low (must be >1000ms).");
    if (httpCode == -1)  Serial.println("[API]   -> Connection refused. Check API_ENDPOINT URL.");

    http.end();

    if (attempt < MAX_RETRIES - 1) {
      int backoff = BASE_DELAY_MS * (1 << attempt);
      Serial.printf("[API] Retrying in %d ms...\n", backoff);
      delay(backoff);
    }
  }

  Serial.println("[API] All retries exhausted. Will try next cycle.\n");
}

// ──── FETCH SAFETY THRESHOLDS FROM CLOUD ──────────────────
// Called once on boot. Provides the local hardware safety
// override with cloud-configured thresholds so protection
// works even if WiFi later disconnects.
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
  http.setTimeout(HTTP_TIMEOUT_MS);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      localOvervoltageThreshold = doc["overvoltage"] | DEFAULT_OVERVOLTAGE_THRESHOLD;
      localUndervoltageThreshold = doc["undervoltage"] | DEFAULT_UNDERVOLTAGE_THRESHOLD;
      localSafetyEnabled = doc["localSafetyEnabled"] | true;

      Serial.println("[THRESHOLDS] Thresholds fetched successfully:");
      Serial.printf("[THRESHOLDS]   Overvoltage:  %.1fV\n", localOvervoltageThreshold);
      Serial.printf("[THRESHOLDS]   Undervoltage: %.1fV\n", localUndervoltageThreshold);
      Serial.printf("[THRESHOLDS]   Local Safety: %s\n", localSafetyEnabled ? "ENABLED" : "DISABLED");
    } else {
      Serial.printf("[THRESHOLDS] JSON parse error: %s\n", error.c_str());
      Serial.println("[THRESHOLDS]   Using default thresholds.");
    }
  } else {
    Serial.printf("[THRESHOLDS] HTTP %d — using defaults.\n", httpCode);
    Serial.printf("[THRESHOLDS]   Overvoltage:  %.1fV\n", localOvervoltageThreshold);
    Serial.printf("[THRESHOLDS]   Undervoltage: %.1fV\n", localUndervoltageThreshold);
  }

  http.end();
}
