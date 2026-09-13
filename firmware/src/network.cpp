#include "network.h"
#include "config.h"
#include "provisioning.h"
#include "rtc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <RTClib.h>

extern RTC_DS3231 rtc;
extern bool rtcAvailable;
extern bool rtcNeedSync;
extern unsigned long lastNtpSyncTime;
extern int wifiRetryCount;
extern float localOvervoltageThreshold;
extern float localUndervoltageThreshold;
extern bool localSafetyEnabled;
extern bool backendReachable;

// ──── WiFi CONNECTION ─────────────────────────────────────
void connectWiFi() {
  const String& ssid = getConfigSsid();
  const String& password = getConfigPassword();

  if (ssid.length() == 0) {
    Serial.println("[WiFi] No SSID configured. Enter provisioning mode.");
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
  Serial.printf("[WiFi] Connecting to \"%s\"...\n", ssid.c_str());

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
    Serial.printf("[WiFi]   SSID tried: \"%s\"\n", ssid.c_str());
    Serial.println("[WiFi]   -> Double-check SSID and PASSWORD spelling (case-sensitive).");
    Serial.println("[WiFi]   -> Is the router 2.4GHz? ESP32 does not support 5GHz.");
    wifiRetryCount++;
    int backoff = min(BASE_DELAY_MS * (1 << wifiRetryCount), (int)WIFI_RETRY_MAX_BACKOFF_MS);
    Serial.printf("[WiFi]   Retrying in %d ms...\n", backoff);
    delay(backoff);
  }
}

// ──── NTP TIME SYNC ───────────────────────────────────────
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
void sendToCloud(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[API] Skipping POST — WiFi not connected.");
    return;
  }

  const String& apiEndpoint = getConfigApiEndpoint();
  const String& deviceToken = getConfigDeviceToken();

  Serial.printf("[API] Sending payload: %s\n", payload.c_str());

  for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient http;
    http.begin(client, apiEndpoint);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", deviceToken);
    http.setTimeout(HTTP_TIMEOUT_MS);

    int httpCode = http.POST(payload);

    if (httpCode == 200 || httpCode == 201) {
      Serial.printf("[API] Data sent (HTTP %d)\n\n", httpCode);
      http.end();
      backendReachable = true;
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

  backendReachable = false;
  Serial.println("[API] All retries exhausted. Will try next cycle.\n");
}

// ──── FETCH SAFETY THRESHOLDS FROM CLOUD ──────────────────
void fetchThresholdsFromCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[THRESHOLDS] WiFi not connected, using defaults.");
    Serial.printf("[THRESHOLDS]   Overvoltage:  %.1fV\n", localOvervoltageThreshold);
    Serial.printf("[THRESHOLDS]   Undervoltage: %.1fV\n", localUndervoltageThreshold);
    return;
  }

  const String& deviceId = getConfigDeviceId();
  const String& deviceToken = getConfigDeviceToken();

  Serial.println("[THRESHOLDS] Fetching safety thresholds from cloud...");

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String thresholdsUrl = String("https://") + getConfigSupabaseHost()
    + "/api/thresholds/esp32?deviceId=" + deviceId;
  http.begin(client, thresholdsUrl);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.addHeader("X-Device-Token", deviceToken);
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
      backendReachable = true;
    } else {
      Serial.printf("[THRESHOLDS] JSON parse error: %s\n", error.c_str());
      Serial.println("[THRESHOLDS]   Using default thresholds.");
    }
  } else {
    Serial.printf("[THRESHOLDS] HTTP %d — using defaults.\n", httpCode);
    Serial.printf("[THRESHOLDS]   Overvoltage:  %.1fV\n", localOvervoltageThreshold);
    Serial.printf("[THRESHOLDS]   Undervoltage: %.1fV\n", localUndervoltageThreshold);
    backendReachable = false;
  }

  http.end();
}

// ──── FETCH RELAY STATE FROM CLOUD (BOOT + POLLING) ───────
// Shared implementation for boot reconciliation ([RELAY-BOOT] logs) and the
// 2s HTTPS relay poll (quiet — pollRelayState() logs [RELAY-POLL] results).
static int8_t fetchRelayStateCore(bool quiet) {
  if (WiFi.status() != WL_CONNECTED) {
    if (!quiet) Serial.println("[RELAY-BOOT] WiFi not connected, cannot fetch cloud state.");
    return -1;
  }

  const String& deviceId = getConfigDeviceId();
  const String& deviceToken = getConfigDeviceToken();
  const String& apiEndpoint = getConfigApiEndpoint();

  if (!quiet) Serial.println("[RELAY-BOOT] Fetching current relay state from cloud...");

  String baseUrl = apiEndpoint;
  int apiPathIdx = baseUrl.indexOf("/api/ingest");
  if (apiPathIdx > 0) {
    baseUrl = baseUrl.substring(0, apiPathIdx);
  }
  String relayUrl = baseUrl + "/api/relay?deviceId=" + deviceId;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, relayUrl);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(5000);
  http.addHeader("X-Device-Token", deviceToken);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error && doc["state"].is<JsonObject>()) {
      bool tripped = doc["state"]["isTripped"] | false;
      if (!quiet) Serial.printf("[RELAY-BOOT] Cloud state: %s\n", tripped ? "TRIPPED" : "NORMAL");
      http.end();
      backendReachable = true;
      return tripped ? 1 : 0;
    }

    if (!quiet) Serial.println("[RELAY-BOOT] Failed to parse cloud response.");
  } else {
    if (!quiet) Serial.printf("[RELAY-BOOT] HTTP %d — cloud unreachable.\n", httpCode);
  }

  http.end();
  return -1;
}

int8_t fetchRelayStateFromCloud() {
  return fetchRelayStateCore(false);
}

int8_t fetchRelayStateForPolling() {
  return fetchRelayStateCore(true);
}

// ──── TEST BACKEND REACHABILITY ───────────────────────────
bool testBackendReachable() {
  if (WiFi.status() != WL_CONNECTED) return false;

  const String& apiEndpoint = getConfigApiEndpoint();

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, apiEndpoint);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(5000);
  int httpCode = http.GET();
  http.end();

  return (httpCode > 0 && httpCode < 500);
}
