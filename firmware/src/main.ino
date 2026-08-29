/*
 * ═══════════════════════════════════════════════════════════════
 * SMART ENERGY MONITORING SYSTEM — ESP32 + PZEM-004T v3.0
 * 3-Phase Monitoring | Wi-Fi → Cloud API (Vercel)
 * ═══════════════════════════════════════════════════════════════
 *
 * HIGH-VOLTAGE WARNING
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
 *   PZEM Phase A  → Hardware Serial2: RX=GPIO16 (from PZEM TX), TX=GPIO17 (to PZEM RX)
 *   PZEM Phase B  → Hardware Serial1: RX=GPIO5,  TX=GPIO4
 *   PZEM Phase C  → Hardware Serial0: RX=GPIO18, TX=GPIO19
 *   RELAY         → GPIO25 (Normally Open: HIGH=Power ON, LOW=Power OFF)
 *
 * Board: ESP32 Dev Module (ESP32-WROOM-32U recommended)
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <Wire.h>
#include <PZEM004Tv30.h>
#include <RTClib.h>
#include <WebSocketsClient.h>

#include "config.h"
#include "secrets.h"
#include "rtc.h"
#include "network.h"
#include "monitor.h"
#include "relay.h"

// ════════════════════════════════════════════════════════════
// GLOBAL STATE
// ════════════════════════════════════════════════════════════

// ── PZEM Sensors (one per phase) ──
PZEM004Tv30 pzemA(Serial2, PZEM_A_RX, PZEM_A_TX);
PZEM004Tv30 pzemB(Serial1, PZEM_B_RX, PZEM_B_TX);
PZEM004Tv30 pzemC(Serial,  PZEM_C_RX, PZEM_C_TX);

// ── RTC ──
RTC_DS3231 rtc;
bool rtcAvailable = false;
bool rtcNeedSync = false;

// ── Timing ──
unsigned long lastReadTime = 0;
unsigned long lastNtpSyncTime = 0;

// ── WiFi ──
int wifiRetryCount = 0;

// ── Relay ──
bool relayState = false;

// ── Local safety thresholds (overwritten from cloud on boot) ──
float localOvervoltageThreshold  = DEFAULT_OVERVOLTAGE_THRESHOLD;
float localUndervoltageThreshold = DEFAULT_UNDERVOLTAGE_THRESHOLD;
bool localSafetyEnabled = true;

// ── WebSocket (Supabase Realtime) ──
WebSocketsClient webSocket;
bool wsConnected = false;
unsigned long lastReconnectAttempt = 0;
unsigned long wsDisconnectTime = 0;

// ════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  Serial.println("\n=====================================");
  Serial.println(" Energy Monitor v3.0 — 3-PHASE");
  Serial.println("=====================================\n");

  // 1. Initialize RTC
  setupRTC();

  // 2. Connect to WiFi
  connectWiFi();

  // 3. Sync NTP — also writes to RTC if RTC lost power
  syncNTP();

  // 4. Fetch safety thresholds from cloud for local hardware override
  fetchThresholdsFromCloud();

  // 5. Log PZEM sensor configuration
  Serial.println("[PZEM] Initializing 3-Phase PZEM-004T sensors...");
  Serial.println("[PZEM]   Phase A: Hardware Serial2 (GPIO16/17)");
  Serial.println("[PZEM]   Phase B: Hardware Serial1 (GPIO5/4)");
  Serial.println("[PZEM]   Phase C: Hardware Serial  (GPIO18/19)");
  Serial.println("[PZEM] All 3 PZEM sensors initialized on hardware UARTs.");
  Serial.println("[PZEM] NOTE: Serial debugging will stop after boot (reassigned to Phase C)");
  delay(1000);

  // 6. Initialize Relay (default: normal operation, power flowing)
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);  // HIGH = Power ON
  Serial.println("[RELAY] Relay initialized (normal state - power flowing).");

  // 7. Initialize Supabase Realtime WebSocket for relay control
  initSupabaseRealtime();

  Serial.println("[BOOT] System ready. Starting 3-phase measurement loop.\n");
}

// ════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════

void loop() {
  unsigned long now = millis();

  // Maintain WebSocket connection
  webSocket.loop();

  // Reconnect WebSocket if disconnected
  if (!wsConnected && (now - lastReconnectAttempt > WS_RECONNECT_INTERVAL_MS)) {
    lastReconnectAttempt = now;
    Serial.println("[WS] Reconnecting to Supabase Realtime...");
    initSupabaseRealtime();
  }

  // Track WebSocket disconnect duration and warn periodically
  if (!wsConnected) {
    if (wsDisconnectTime == 0) wsDisconnectTime = now;
    if (now - wsDisconnectTime > WS_DISCONNECT_WARN_MS) {
      static unsigned long lastWarnTime = 0;
      if (now - lastWarnTime > WS_DISCONNECT_WARN_INTERVAL_MS) {
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

  // Sync NTP: on startup (if RTC lost power) OR periodically
  bool syncNeeded = rtcNeedSync || (now - lastNtpSyncTime >= NTP_RESYNC_INTERVAL_MS);
  if (syncNeeded && WiFi.status() == WL_CONNECTED) {
    syncNTP();
  }

  // Read sensors and upload at the configured interval
  if (now - lastReadTime >= SENSOR_INTERVAL_MS) {
    lastReadTime = now;
    readAndSend3Phase();
  }
}
