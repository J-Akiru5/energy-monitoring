#include "monitor.h"
#include "config.h"
#include "provisioning.h"
#include "rtc.h"
#include "network.h"
#include "relay.h"
#include <PZEM004Tv30.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

extern PZEM004Tv30* pzemA;
extern PZEM004Tv30* pzemB;
extern PZEM004Tv30* pzemC;
extern bool relayState;
extern float localOvervoltageThreshold;
extern float localUndervoltageThreshold;
extern bool localSafetyEnabled;

// ──── PER-PHASE HEALTH STATE ──────────────────────────────
// Each phase has its own offline/healthy state machine.
// On boot, all phases start as HEALTHY with zero counters.
static PhaseHealth healthA = {true, 0, 0};
static PhaseHealth healthB = {true, 0, 0};
static PhaseHealth healthC = {true, 0, 0};

// ──── 1-PHASE SOURCE SELECTION STATE ──────────────────────
static PzemSourceState sourceState = {
    PZEM_SOURCE_AUTO,   // mode: AUTO by default
    PZEM_SOURCE_A,      // activeSource: start at A
    PZEM_SOURCE_A       // manualSource: A by default
};

// ──── BOOT-TIME RAW READINGS (for source selection logic) ─
// These hold the raw readings from each PZEM, regardless of
// whether they're included in the JSON payload.
static PhaseReading rawA = {0,0,0,0,0,0,true};
static PhaseReading rawB = {0,0,0,0,0,0,true};
static PhaseReading rawC = {0,0,0,0,0,0,true};

// ──── INIT PZEM HEALTH (call once from setup) ─────────────
void initPzemHealth() {
    healthA = {true, 0, 0};
    healthB = {true, 0, 0};
    healthC = {true, 0, 0};
    sourceState.mode = PZEM_SOURCE_AUTO;
    sourceState.activeSource = PZEM_SOURCE_A;
    sourceState.manualSource = PZEM_SOURCE_A;
    Serial.println("[PZEM-HEALTH] Initialized: all phases HEALTHY, AUTO mode, source A");
}

// ──── READ PHASE ──────────────────────────────────────────
PhaseReading readPhase(PZEM004Tv30& meter) {
    PhaseReading r;
    r.voltage     = meter.voltage();
    r.current     = meter.current();
    r.power       = meter.power();
    r.energy      = meter.energy();
    r.frequency   = meter.frequency();
    r.powerFactor = meter.pf();

    r.offline = isnan(r.voltage) && isnan(r.current) &&
                isnan(r.power)   && isnan(r.energy);

    if (isnan(r.voltage))     r.voltage     = 0;
    if (isnan(r.current))     r.current     = 0;
    if (isnan(r.power))       r.power       = 0;
    if (isnan(r.energy))      r.energy      = 0;
    if (isnan(r.frequency))   r.frequency   = 0;
    if (isnan(r.powerFactor)) r.powerFactor = 0;

    return r;
}

// ──── UPDATE HEALTH STATE MACHINE ─────────────────────────
// Mirrors the backend's 60s promote / 30s recovery windows
// at the firmware's 5s tick rate:
//   12 consecutive fails → OFFLINE  (12 × 5s = 60s)
//    6 consecutive goods → HEALTHY  ( 6 × 5s = 30s)
static void updatePhaseHealth(PhaseHealth& health, bool isOffline, const char* phaseName) {
    if (isOffline) {
        health.consecutiveGoods = 0;
        health.consecutiveFails++;
        if (health.healthy && health.consecutiveFails >= PZEM_COMM_FAIL_THRESHOLD) {
            health.healthy = false;
            Serial.printf("[PZEM-HEALTH] %s → OFFLINE after %d consecutive failures\n",
                          phaseName, health.consecutiveFails);
        }
    } else {
        health.consecutiveFails = 0;
        health.consecutiveGoods++;
        if (!health.healthy && health.consecutiveGoods >= PZEM_RECOVER_THRESHOLD) {
            health.healthy = true;
            Serial.printf("[PZEM-HEALTH] %s → HEALTHY after %d consecutive good reads\n",
                          phaseName, health.consecutiveGoods);
        }
    }
}

// ──── UPDATE 1-PHASE SOURCE SELECTION (AUTO mode) ─────────
// STICKY failover: once failed over to a lower-priority source,
// stay on it until THAT source fails. Only re-evaluate priority
// from scratch (A → B → C) when the currently active source
// itself goes OFFLINE.
static void updateAutoSource() {
    // If current source is healthy, stay on it (STICKY)
    PhaseHealth* current = nullptr;
    switch (sourceState.activeSource) {
        case PZEM_SOURCE_A: current = &healthA; break;
        case PZEM_SOURCE_B: current = &healthB; break;
        case PZEM_SOURCE_C: current = &healthC; break;
    }

    if (current && current->healthy) {
        return; // STICKY — stay on current source
    }

    // Current source went OFFLINE — re-evaluate priority from scratch
    if (healthA.healthy) {
        sourceState.activeSource = PZEM_SOURCE_A;
        Serial.println("[PZEM-SOURCE] AUTO: switched to A (priority re-evaluation)");
    } else if (healthB.healthy) {
        sourceState.activeSource = PZEM_SOURCE_B;
        Serial.println("[PZEM-SOURCE] AUTO: switched to B (priority re-evaluation)");
    } else if (healthC.healthy) {
        sourceState.activeSource = PZEM_SOURCE_C;
        Serial.println("[PZEM-SOURCE] AUTO: switched to C (priority re-evaluation)");
    } else {
        // All sources OFFLINE — no valid source available
        Serial.println("[PZEM-SOURCE] AUTO: all sources OFFLINE — no valid source");
    }
}

// ──── HELPER: Round to N decimal places ───────────────────
static float roundTo(float val, int decimals) {
    float multiplier = 1.0;
    for (int i = 0; i < decimals; i++) multiplier *= 10.0;
    return round(val * multiplier) / multiplier;
}

// ──── HELPER: Add phase JSON to payload ───────────────────
// Now includes the `offline` field as required by the spec.
static void addPhaseJson(JsonObject& parent, const char* key, const PhaseReading& r) {
    JsonObject phase = parent[key].to<JsonObject>();
    phase["voltage"]     = roundTo(r.voltage, 2);
    phase["current"]     = roundTo(r.current, 3);
    phase["power"]       = roundTo(r.power, 2);
    phase["energy"]      = roundTo(r.energy, 4);
    phase["frequency"]   = roundTo(r.frequency, 2);
    phase["powerFactor"] = roundTo(r.powerFactor, 3);
    phase["offline"]     = r.offline;
}

// ──── HELPER: Check if phase has valid reading ────────────
static bool hasValidReading(const PhaseReading& r) {
    return !r.offline && (r.voltage > 0 || r.current > 0);
}

// ──── MAIN: READ PHASES + SEND TO CLOUD ──────────────────
// PZEM polling is DECOUPLED from phaseMode:
//   - All 3 PZEMs are polled unconditionally every cycle
//   - phaseMode governs what's included in the JSON payload
//   - 1-phase mode uses source selection (AUTO/MANUAL)
void readAndUpload() {
  int phaseMode = getConfigPhaseMode();
  const String& deviceId = getConfigDeviceId();

  // ── STEP 1: Poll ALL PZEMs unconditionally ──
  // All three PZEMs are always read regardless of phaseMode.
  // PZEM-C has its own SoftwareSerial bus, so there is no conflict.
  if (pzemA) rawA = readPhase(*pzemA);
  if (pzemB) rawB = readPhase(*pzemB);
  if (pzemC) rawC = readPhase(*pzemC);

  // ── STEP 2: Update per-phase health state machines ──
  updatePhaseHealth(healthA, rawA.offline, "Phase-A");
  updatePhaseHealth(healthB, rawB.offline, "Phase-B");
  updatePhaseHealth(healthC, rawC.offline, "Phase-C");

  // ── STEP 3: Update 1-phase source selection ──
  if (phaseMode == 1) {
      if (sourceState.mode == PZEM_SOURCE_AUTO) {
          updateAutoSource();
      }
      // MANUAL: do not auto-switch; sourceState.activeSource stays as configured
  }

  // ── STEP 4: Count offline phases from raw readings ──
  // All three PZEMs are always polled; report all three honestly.
  // pzemActiveSource tells the backend which tap is authoritative.
  int offlineCount = 0;
  if (rawA.offline) offlineCount++;
  if (rawB.offline) offlineCount++;
  if (rawC.offline) offlineCount++;

  int activePhases = 3 - offlineCount;

  // All sensors offline -- covers both 3-phase total loss and
  // 1-phase AUTO exhausted A, B, and C (Case D).
  if (activePhases == 0) {
    Serial.println("[PZEM] All sensors offline (NaN readings)!");
    Serial.println("[PZEM]   -> Check wiring for all phases");

    JsonDocument doc;
    doc["deviceId"] = deviceId;
    doc["timestamp"] = getTimestamp();
    doc["sensorOffline"] = true;
    doc["phaseMode"] = phaseMode;

    String payload;
    serializeJson(doc, payload);
    sendToCloud(payload);
    return;
  }

  // Log individual offline phases
  if (rawA.offline) Serial.println("[PZEM] Phase A offline -- sensor comm failed");
  if (rawB.offline) Serial.println("[PZEM] Phase B offline -- sensor comm failed");
  if (rawC.offline) Serial.println("[PZEM] Phase C offline -- sensor comm failed");

  // ── STEP 5: Print to Serial ──
  Serial.printf("--- %d-PHASE PZEM Reading -------------------\n", phaseMode);
  if (phaseMode == 1) {
      const PhaseReading* src = nullptr;
      const char* srcName = "";
      switch (sourceState.activeSource) {
          case PZEM_SOURCE_A: src = &rawA; srcName = "A"; break;
          case PZEM_SOURCE_B: src = &rawB; srcName = "B"; break;
          case PZEM_SOURCE_C: src = &rawC; srcName = "C"; break;
      }
      if (src) {
          Serial.printf("  Source %s (%s): %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f  %s\n",
                        srcName,
                        sourceState.mode == PZEM_SOURCE_AUTO ? "AUTO" : "MANUAL",
                        src->voltage, src->current, src->power, src->energy, src->powerFactor,
                        src->offline ? "[OFFLINE]" : "");
      }
      const char* tapNames[] = {"A", "B", "C"};
      const PhaseReading* taps[] = {&rawA, &rawB, &rawC};
      for (int i = 0; i < 3; i++) {
          if (taps[i] != src) {
              Serial.printf("    Tap %s: %.1fV  %.3fA  %.1fW  %s\n",
                            tapNames[i], taps[i]->voltage, taps[i]->current, taps[i]->power,
                            taps[i]->offline ? "[OFFLINE]" : "");
          }
      }
  } else {
      if (rawA.offline || hasValidReading(rawA))
          Serial.printf("  Phase A: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f  %s\n",
                        rawA.voltage, rawA.current, rawA.power, rawA.energy, rawA.powerFactor,
                        rawA.offline ? "[OFFLINE]" : "");
      if (rawB.offline || hasValidReading(rawB))
          Serial.printf("  Phase B: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f  %s\n",
                        rawB.voltage, rawB.current, rawB.power, rawB.energy, rawB.powerFactor,
                        rawB.offline ? "[OFFLINE]" : "");
      if (rawC.offline || hasValidReading(rawC))
          Serial.printf("  Phase C: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f  %s\n",
                        rawC.voltage, rawC.current, rawC.power, rawC.energy, rawC.powerFactor,
                        rawC.offline ? "[OFFLINE]" : "");
  }

  float totalPower = 0;
  float totalEnergy = 0;
  if (phaseMode == 1) {
      switch (sourceState.activeSource) {
          case PZEM_SOURCE_A: if (!rawA.offline) { totalPower += rawA.power; totalEnergy += rawA.energy; } break;
          case PZEM_SOURCE_B: if (!rawB.offline) { totalPower += rawB.power; totalEnergy += rawB.energy; } break;
          case PZEM_SOURCE_C: if (!rawC.offline) { totalPower += rawC.power; totalEnergy += rawC.energy; } break;
      }
  } else {
      if (!rawA.offline) { totalPower += rawA.power; totalEnergy += rawA.energy; }
      if (!rawB.offline) { totalPower += rawB.power; totalEnergy += rawB.energy; }
      if (!rawC.offline) { totalPower += rawC.power; totalEnergy += rawC.energy; }
  }

  Serial.printf("  TOTAL:   %.1fW  %.4fkWh  (active phases: %d)\n", totalPower, totalEnergy, activePhases);
  Serial.printf("  Timestamp: %s\n", getTimestamp().c_str());
  Serial.println("--------------------------------------------");

  // ── LOCAL HARDWARE SAFETY OVERRIDE ──
  // In 1-phase mode, only check the active source.
  bool localTrip = false;
  const char* localTripReason = nullptr;
  float tripVoltage = 0;

  if (localSafetyEnabled && !relayState) {
    if (phaseMode == 1) {
        const PhaseReading* src = nullptr;
        const char* phaseLetter = nullptr;
        switch (sourceState.activeSource) {
            case PZEM_SOURCE_A: src = &rawA; phaseLetter = "A"; break;
            case PZEM_SOURCE_B: src = &rawB; phaseLetter = "B"; break;
            case PZEM_SOURCE_C: src = &rawC; phaseLetter = "C"; break;
        }
        if (src && !src->offline) {
            if (src->voltage > localOvervoltageThreshold) {
                localTrip = true;
                localTripReason = "LOCAL_OVERVOLTAGE_PHASE_X";
                tripVoltage = src->voltage;
            } else if (src->voltage < localUndervoltageThreshold && src->voltage > 0) {
                localTrip = true;
                localTripReason = "LOCAL_UNDERVOLTAGE_PHASE_X";
                tripVoltage = src->voltage;
            }
            if (localTrip && phaseLetter) {
                char* xPos = const_cast<char*>(strchr(localTripReason, 'X'));
                if (xPos) *xPos = phaseLetter[0];
            }
        }
    } else {
        if (!rawA.offline && rawA.voltage > localOvervoltageThreshold) {
            localTrip = true;
            localTripReason = "LOCAL_OVERVOLTAGE_PHASE_A";
            tripVoltage = rawA.voltage;
        } else if (!rawB.offline && rawB.voltage > localOvervoltageThreshold) {
            localTrip = true;
            localTripReason = "LOCAL_OVERVOLTAGE_PHASE_B";
            tripVoltage = rawB.voltage;
        } else if (!rawC.offline && rawC.voltage > localOvervoltageThreshold) {
            localTrip = true;
            localTripReason = "LOCAL_OVERVOLTAGE_PHASE_C";
            tripVoltage = rawC.voltage;
        } else if (!rawA.offline && rawA.voltage < localUndervoltageThreshold && rawA.voltage > 0) {
            localTrip = true;
            localTripReason = "LOCAL_UNDERVOLTAGE_PHASE_A";
            tripVoltage = rawA.voltage;
        } else if (!rawB.offline && rawB.voltage < localUndervoltageThreshold && rawB.voltage > 0) {
            localTrip = true;
            localTripReason = "LOCAL_UNDERVOLTAGE_PHASE_B";
            tripVoltage = rawB.voltage;
        } else if (!rawC.offline && rawC.voltage < localUndervoltageThreshold && rawC.voltage > 0) {
            localTrip = true;
            localTripReason = "LOCAL_UNDERVOLTAGE_PHASE_C";
            tripVoltage = rawC.voltage;
        }
    }

    if (localTrip) {
      Serial.println("==================================================");
      Serial.println("[ALERT] LOCAL HARDWARE OVERRIDE: DANGEROUS VOLTAGE! Killing Power...");
      Serial.printf("[ALERT]   Reason: %s  Voltage: %.2fV\n", localTripReason, tripVoltage);
      Serial.println("==================================================");

      relayState = true;
      digitalWrite(RELAY_PIN, LOW);
      saveRelayStateToNVS(true);
      Serial.println("[RELAY] LOCAL TRIP EXECUTED -- Power disconnected.");
    }
  }

  // ── BUILD JSON PAYLOAD ──
  // Always report all three phases using raw readings.
  JsonDocument doc;
  doc["deviceId"] = deviceId;
  doc["phaseMode"] = phaseMode;

  JsonObject threePhase = doc["threePhase"].to<JsonObject>();
  addPhaseJson(threePhase, "phase_a", rawA);
  addPhaseJson(threePhase, "phase_b", rawB);
  addPhaseJson(threePhase, "phase_c", rawC);

  doc["timestamp"] = getTimestamp();

  // Include source selection info for 1-phase mode
  if (phaseMode == 1) {
      doc["pzemSourceMode"] = (sourceState.mode == PZEM_SOURCE_AUTO) ? "AUTO" : "MANUAL";
      const char* sourceNames[] = {"A", "B", "C"};
      doc["pzemActiveSource"] = sourceNames[sourceState.activeSource];
  }

  if (localTrip && localTripReason) {
    doc["localTrip"] = true;
    doc["localTripReason"] = localTripReason;
  }

  // All phases at 0V means mains AC power is cut
  bool allZero = true;
  if (rawA.voltage != 0.0) allZero = false;
  if (rawB.voltage != 0.0) allZero = false;
  if (rawC.voltage != 0.0) allZero = false;

  if (allZero && activePhases > 0) {
    doc["blackout"] = true;
    Serial.println("[ALERT] Mains blackout detected (0V on all active phases). Flagging payload.");
  }

  String payload;
  serializeJson(doc, payload);

  sendToCloud(payload);
}

// ──── FETCH PZEM CONFIG FROM CLOUD (BOOT) ────────────────
// GET /api/devices/:deviceId/pzem-config
// Falls back to AUTO + A-priority on any non-200 or network failure.
void fetchPzemConfigFromCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[PZEM-CONFIG] WiFi not connected, using defaults (AUTO + A).");
    return;
  }

  const String& deviceId = getConfigDeviceId();
  const String& apiEndpoint = getConfigApiEndpoint();

  Serial.println("[PZEM-CONFIG] Fetching PZEM config from cloud...");

  // Derive base URL from API endpoint
  String baseUrl = apiEndpoint;
  int apiPathIdx = baseUrl.indexOf("/api/ingest");
  if (apiPathIdx > 0) {
    baseUrl = baseUrl.substring(0, apiPathIdx);
  }
  String configUrl = baseUrl + "/api/devices/" + deviceId + "/pzem-config";

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, configUrl);
  http.addHeader("X-Device-Token", getConfigDeviceToken());
  http.setTimeout(HTTP_TIMEOUT_MS);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      // Parse mode
      const char* modeStr = doc["mode"] | "AUTO";
      if (strcmp(modeStr, "MANUAL") == 0) {
        sourceState.mode = PZEM_SOURCE_MANUAL;
      } else {
        sourceState.mode = PZEM_SOURCE_AUTO;
      }

      // Parse manualSource (only used when mode == MANUAL)
      const char* srcStr = doc["manualSource"] | "A";
      if (strcmp(srcStr, "B") == 0) {
        sourceState.manualSource = PZEM_SOURCE_B;
      } else if (strcmp(srcStr, "C") == 0) {
        sourceState.manualSource = PZEM_SOURCE_C;
      } else {
        sourceState.manualSource = PZEM_SOURCE_A;
      }

      // Set active source based on mode
      if (sourceState.mode == PZEM_SOURCE_MANUAL) {
        sourceState.activeSource = sourceState.manualSource;
      }
      // AUTO mode: activeSource is managed by updateAutoSource()

      Serial.printf("[PZEM-CONFIG] Mode: %s, Manual Source: %s, Active: %s\n",
                    modeStr, srcStr,
                    sourceState.activeSource == PZEM_SOURCE_A ? "A" :
                    sourceState.activeSource == PZEM_SOURCE_B ? "B" : "C");
    } else {
      Serial.printf("[PZEM-CONFIG] JSON parse error: %s — using defaults\n", error.c_str());
    }
  } else {
    Serial.printf("[PZEM-CONFIG] HTTP %d — using defaults (AUTO + A)\n", httpCode);
  }

  http.end();
}
