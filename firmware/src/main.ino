/*
 * ═══════════════════════════════════════════════════════════════
 * SMART ENERGY MONITORING SYSTEM — ESP32 + PZEM-004T v3.0
 * Production EMU Firmware
 * ═══════════════════════════════════════════════════════════════
 *
 * HIGH-VOLTAGE WARNING
 * The PZEM-004T sensors are connected to mains AC power.
 * All physical installation MUST be performed by a licensed
 * electrician. Never work on live wires.
 *
 * Boot States:
 *   UNPROVISIONED       — No config in NVS, enter AP setup mode
 *   CONFIGURED_OFFLINE  — Has config but WiFi not connected
 *   CONFIGURED_ONLINE   — Connected to WiFi, checking backend
 *   BACKEND_UNAVAILABLE — WiFi OK but backend unreachable
 *   NORMAL_OPERATION    — All systems nominal
 *   PROTECTIVE_TRIP     — Relay tripped for safety
 *
 * Board: ESP32 Dev Module (ESP32-WROOM-32U recommended)
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <Wire.h>
#include <PZEM004Tv30.h>
#include <RTClib.h>
#include <WebSocketsClient.h>
#include <SoftwareSerial.h>

#include "config.h"
#include "provisioning.h"
#include "rtc.h"
#include "network.h"
#include "monitor.h"
#include "relay.h"
#include "reset_buttons.h"

// ════════════════════════════════════════════════════════════
// GLOBAL STATE
// ════════════════════════════════════════════════════════════

// ── PZEM Sensors (up to 3 phases) ──
// Constructed in initPzemSensors() during setup() — NEVER during static
// initialization. The PZEM constructors call port.begin() immediately, and
// a global pzemC(Serial, 18, 19) used to hijack UART0 (the debug console)
// before setup() ever ran.
//   PZEM-A → UART2 (GPIO16/17)
//   PZEM-B → UART1 (GPIO5/4)
//   PZEM-C → dedicated software serial on GPIO18/19 (all 3 hardware UARTs
//             are accounted for: UART0=debug, UART1=B, UART2=A)
static SoftwareSerial* pzemCSerial = nullptr;
PZEM004Tv30* pzemA = nullptr;
PZEM004Tv30* pzemB = nullptr;
PZEM004Tv30* pzemC = nullptr;

static void initPzemSensors() {
  pzemA = new PZEM004Tv30(Serial2, PZEM_A_RX, PZEM_A_TX);
  pzemB = new PZEM004Tv30(Serial1, PZEM_B_RX, PZEM_B_TX);
  // PERMANENT FIX: RX/TX swapped — the C-side harness is hard-soldered with
  // crossed wires at the module connector. Verified online 11/11 cycles with
  // real voltage readings (221.5-221.7V). Do not revert unless the harness
  // is physically rewired.
  pzemCSerial = new SoftwareSerial(PZEM_C_TX, PZEM_C_RX);
  pzemC = new PZEM004Tv30(*pzemCSerial);
}

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

// ── Backend reachability ──
bool backendReachable = false;

// ── WebSocket (Supabase Realtime) ──
WebSocketsClient webSocket;
bool wsConnected = false;
unsigned long lastReconnectAttempt = 0;
unsigned long wsDisconnectTime = 0;
bool wsInitialized = false;
unsigned long wsReconnectIntervalMs = WS_RECONNECT_INTERVAL_MS;

// ════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════

void setup() {
  // UART0 debug console — pins stated explicitly so nothing can move it.
  Serial.begin(115200, SERIAL_8N1, 3, 1);
  delay(100);
  Serial.println("\n=====================================");
  Serial.println(" EMU Firmware v4.0 — Production");
  Serial.println("=====================================\n");

  // Initialize PZEM serial interfaces now that the debug console is up.
  // (Never during static init — the PZEM constructors call begin() at once.)
  Serial.println("[PZEM] Initializing serial interfaces...");
  initPzemSensors();
  Serial.println("[PZEM]   Phase A: UART2 (RX:16 TX:17)");
  Serial.println("[PZEM]   Phase B: UART1 (RX:5  TX:4)");
  Serial.println("[PZEM]   Phase C: SoftwareSerial (RX:18 TX:19)");

  // Physical reset buttons (GPIO32/33, active-low) — see reset_buttons.cpp
  initResetButtons();

  // 0. Check for serial commands during first 2 seconds
  unsigned long startupWindow = millis();
  Serial.println("[BOOT] Type 'help' for serial commands (2s window)...");
  while (millis() - startupWindow < 2000) {
    handleSerialCommands();
    delay(10);
  }

  // 1. Initialize provisioning (load config from NVS)
  bool provisioned = provisioningInit();

  if (!provisioned) {
    setBootState(BOOT_UNPROVISIONED);
    Serial.println("[BOOT] State: UNPROVISIONED");
    Serial.println("[BOOT] No configuration found.");
    enterProvisioningMode(); // blocks until config received, then reboots
  }

  Serial.printf("[BOOT] Device ID:   %s\n", getConfigDeviceId().c_str());
  Serial.printf("[BOOT] Phase Mode:  %s\n", getConfigPhaseMode() == 3 ? "3-phase" : "1-phase");
  Serial.printf("[BOOT] API:         %s\n", getConfigApiEndpoint().c_str());
  Serial.printf("[BOOT] Supabase:    %s\n", getConfigSupabaseHost().c_str());

  // 2. Initialize RTC
  setupRTC();

  // 3. Connect to WiFi
  connectWiFi();

  // 4. Determine online/offline state
  if (WiFi.status() == WL_CONNECTED) {
    setBootState(BOOT_CONFIGURED_ONLINE);
    Serial.println("[BOOT] State: CONFIGURED_ONLINE");

    // 5. Sync NTP
    syncNTP();

  // 6. Fetch safety thresholds from cloud
  fetchThresholdsFromCloud();

  // 7. Fetch PZEM source configuration from cloud (AUTO/MANUAL, source selection)
  initPzemHealth();
  fetchPzemConfigFromCloud();

  // 8. Test backend reachability
    backendReachable = testBackendReachable();
    if (backendReachable) {
      Serial.println("[BOOT] Backend: REACHABLE");
    } else {
      Serial.println("[BOOT] Backend: UNREACHABLE");
      setBootState(BOOT_BACKEND_UNAVAILABLE);
    }
  } else {
    setBootState(BOOT_CONFIGURED_OFFLINE);
    Serial.println("[BOOT] State: CONFIGURED_OFFLINE");
    Serial.println("[BOOT] WiFi not connected. Will retry in loop.");
  }

  // 8. Initialize Relay with boot-state reconciliation
  pinMode(RELAY_PIN, OUTPUT);

  bool bootTripped = false;
  bool stateResolved = false;

  // 8a. Try cloud first (most authoritative)
  if (WiFi.status() == WL_CONNECTED) {
    int8_t cloudState = fetchRelayStateFromCloud();
    if (cloudState >= 0) {
      bootTripped = (cloudState == 1);
      stateResolved = true;
      Serial.printf("[RELAY-BOOT] Using cloud state: %s\n", bootTripped ? "TRIPPED" : "NORMAL");
    }
  }

  // 8b. Fall back to NVS if cloud was unreachable
  if (!stateResolved) {
    bool nvsTripped = false;
    if (loadRelayStateFromNVS(nvsTripped)) {
      bootTripped = nvsTripped;
      stateResolved = true;
      Serial.printf("[RELAY-BOOT] Using NVS state: %s\n", bootTripped ? "TRIPPED" : "NORMAL");
    }
  }

  // 8c. First boot — no cloud record, no NVS record
  if (!stateResolved) {
    Serial.println("[RELAY-BOOT] No cloud or NVS state (first boot). Defaulting to power-ON.");
  }

  relayState = bootTripped;
  digitalWrite(RELAY_PIN, bootTripped ? LOW : HIGH);
  if (bootTripped) setBootState(BOOT_PROTECTIVE_TRIP);
  Serial.printf("[RELAY] Relay: %s\n", relayState ? "TRIPPED (power OFF)" : "NORMAL (power ON)");

  // 9. Initialize Supabase Realtime WebSocket for relay control
  initSupabaseRealtime();
  wsInitialized = (WiFi.status() == WL_CONNECTED);

  // 10. Final state
  if (!relayState && getBootState() != BOOT_PROTECTIVE_TRIP) {
    if (WiFi.status() == WL_CONNECTED && backendReachable) {
      setBootState(BOOT_NORMAL_OPERATION);
    }
  }

  Serial.printf("\n[BOOT] ====== FINAL STATE: %s ======\n", getBootStateName(getBootState()));
  Serial.println("[BOOT] System ready. Starting measurement loop.\n");
}

// ════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════

void loop() {
  unsigned long now = millis();

  // Handle serial commands
  handleSerialCommands();

  // Physical reset buttons (long-press detection, non-blocking)
  handleResetButtons();

  // Maintain WebSocket connection
  webSocket.loop();

  // Send the Phoenix application-level heartbeat (~25s) while connected.
  // Transport-level enableHeartbeat() alone does not keep Realtime alive;
  // without this, Supabase closes the socket ~65s after each subscribe.
  maintainRealtimeHeartbeat();

  // WebSocket: begin() exactly once; library retries on its own.
  // Repeated initSupabaseRealtime()/beginSSL() leaks the WiFiClientSecure
  // allocated by the library retry (WebSocketsClient.cpp:59-64 orphaning),
  // exhausting heap in ~40-70s (2026-09-12 crash-loop root cause).
  if (!wsInitialized && WiFi.status() == WL_CONNECTED) {
    wsInitialized = true;
    initSupabaseRealtime();
  }
  if (!wsConnected && (now - lastReconnectAttempt > wsReconnectIntervalMs)) {
    lastReconnectAttempt = now;
    if (wsReconnectIntervalMs < WS_RECONNECT_MAX_MS) {
      wsReconnectIntervalMs = min(wsReconnectIntervalMs * 2, (unsigned long)WS_RECONNECT_MAX_MS);
      webSocket.setReconnectInterval(wsReconnectIntervalMs);
    }
    Serial.printf("[WS] Disconnected — library retry interval now %lus\n", wsReconnectIntervalMs / 1000);
  }
  if (wsConnected && wsReconnectIntervalMs != WS_RECONNECT_INTERVAL_MS) {
    wsReconnectIntervalMs = WS_RECONNECT_INTERVAL_MS;
    webSocket.setReconnectInterval(WS_RECONNECT_INTERVAL_MS);
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
    if (getBootState() != BOOT_UNPROVISIONED) {
      Serial.println("[WiFi] Connection lost. Reconnecting...");
      connectWiFi();

      if (WiFi.status() == WL_CONNECTED) {
        setBootState(BOOT_CONFIGURED_ONLINE);
      } else {
        setBootState(BOOT_CONFIGURED_OFFLINE);
      }
    }
  }

  // Sync NTP: on startup (if RTC lost power) OR periodically
  bool syncNeeded = rtcNeedSync || (now - lastNtpSyncTime >= NTP_RESYNC_INTERVAL_MS);
  if (syncNeeded && WiFi.status() == WL_CONNECTED) {
    syncNTP();
  }

  // Read sensors and upload at the configured interval
  if (now - lastReadTime >= SENSOR_INTERVAL_MS) {
    lastReadTime = now;
    readAndUpload();
  }
}
