#include "monitor.h"
#include "config.h"
#include "secrets.h"
#include "rtc.h"
#include "network.h"
#include <PZEM004Tv30.h>
#include <ArduinoJson.h>

extern PZEM004Tv30 pzemA;
extern PZEM004Tv30 pzemB;
extern PZEM004Tv30 pzemC;
extern bool relayState;
extern float localOvervoltageThreshold;
extern float localUndervoltageThreshold;
extern bool localSafetyEnabled;

// ──── READ PHASE ──────────────────────────────────────────
// Centralized reading for any PZEM module. Reads all six
// parameters, replaces NaN with 0 (safe default for offline
// sensors), and returns a populated struct.
PhaseReading readPhase(PZEM004Tv30& meter) {
    PhaseReading r;
    r.voltage     = meter.voltage();
    r.current     = meter.current();
    r.power       = meter.power();
    r.energy      = meter.energy();
    r.frequency   = meter.frequency();
    r.powerFactor = meter.pf();

    // Detect offline: if all core telemetry fields are NaN,
    // the PZEM module is not responding.
    r.offline = isnan(r.voltage) && isnan(r.current) &&
                isnan(r.power)   && isnan(r.energy);

    // Replace NaN with 0 — avoids corrupting the JSON payload
    // and allows partial readings (e.g. 0V blackout) to pass through.
    if (isnan(r.voltage))     r.voltage     = 0;
    if (isnan(r.current))     r.current     = 0;
    if (isnan(r.power))       r.power       = 0;
    if (isnan(r.energy))      r.energy      = 0;
    if (isnan(r.frequency))   r.frequency   = 0;
    if (isnan(r.powerFactor)) r.powerFactor = 0;

    return r;
}

// ──── HELPER: Round to N decimal places ───────────────────
static float roundTo(float val, int decimals) {
    float multiplier = 1.0;
    for (int i = 0; i < decimals; i++) multiplier *= 10.0;
    return round(val * multiplier) / multiplier;
}

// ──── HELPER: Add phase JSON to payload ───────────────────
static void addPhaseJson(JsonObject& parent, const char* key, const PhaseReading& r) {
    JsonObject phase = parent[key].to<JsonObject>();
    phase["voltage"]     = roundTo(r.voltage, 2);
    phase["current"]     = roundTo(r.current, 3);
    phase["power"]       = roundTo(r.power, 2);
    phase["energy"]      = roundTo(r.energy, 4);
    phase["frequency"]   = roundTo(r.frequency, 2);
    phase["powerFactor"] = roundTo(r.powerFactor, 3);
}

// ──── MAIN: READ 3-PHASE + SEND TO CLOUD ──────────────────
// Reads all three PZEM modules, validates readings, checks
// local safety thresholds, builds the JSON payload, and
// uploads to the cloud. One failing phase does not block
// the others.
void readAndSend3Phase() {
  // Read all three phases through the centralized reader
  PhaseReading phaseA = readPhase(pzemA);
  PhaseReading phaseB = readPhase(pzemB);
  PhaseReading phaseC = readPhase(pzemC);

  // If ALL sensors are offline, the ESP32 is online but cannot
  // communicate with any PZEM. Upload a minimal alert payload.
  if (phaseA.offline && phaseB.offline && phaseC.offline) {
    Serial.println("[PZEM] All sensors offline (NaN readings)!");
    Serial.println("[PZEM]   -> Check wiring for all 3 phases");
    Serial.println("[PZEM]   -> Sending sensorOffline notification to cloud...");

    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["timestamp"] = getTimestamp();
    doc["sensorOffline"] = true;

    String payload;
    serializeJson(doc, payload);
    sendToCloud(payload);
    return;
  }

  // Log individual offline phases
  if (phaseA.offline) Serial.println("[PZEM] Phase A offline — sensor comm failed");
  if (phaseB.offline) Serial.println("[PZEM] Phase B offline — sensor comm failed");
  if (phaseC.offline) Serial.println("[PZEM] Phase C offline — sensor comm failed");

  // Print to Serial Monitor
  Serial.println("--- 3-PHASE PZEM Reading -------------------");
  Serial.printf("  Phase A: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f\n",
                phaseA.voltage, phaseA.current, phaseA.power, phaseA.energy, phaseA.powerFactor);
  Serial.printf("  Phase B: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f\n",
                phaseB.voltage, phaseB.current, phaseB.power, phaseB.energy, phaseB.powerFactor);
  Serial.printf("  Phase C: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f\n",
                phaseC.voltage, phaseC.current, phaseC.power, phaseC.energy, phaseC.powerFactor);

  float totalPower = phaseA.power + phaseB.power + phaseC.power;
  float totalEnergy = phaseA.energy + phaseB.energy + phaseC.energy;
  Serial.printf("  TOTAL:   %.1fW  %.4fkWh\n", totalPower, totalEnergy);
  Serial.printf("  Timestamp: %s\n", getTimestamp().c_str());
  Serial.println("--------------------------------------------");

  // ── LOCAL HARDWARE SAFETY OVERRIDE ──
  // Trip on overvoltage to protect connected equipment.
  // Undervoltage/brownout detection disabled to allow
  // single-phase testing.
  bool localTrip = false;
  const char* localTripReason = nullptr;
  float tripVoltage = 0;

  if (localSafetyEnabled && !relayState) {
    if (!phaseA.offline && phaseA.voltage > localOvervoltageThreshold) {
      localTrip = true;
      localTripReason = "LOCAL_OVERVOLTAGE_PHASE_A";
      tripVoltage = phaseA.voltage;
    } else if (!phaseB.offline && phaseB.voltage > localOvervoltageThreshold) {
      localTrip = true;
      localTripReason = "LOCAL_OVERVOLTAGE_PHASE_B";
      tripVoltage = phaseB.voltage;
    } else if (!phaseC.offline && phaseC.voltage > localOvervoltageThreshold) {
      localTrip = true;
      localTripReason = "LOCAL_OVERVOLTAGE_PHASE_C";
      tripVoltage = phaseC.voltage;
    }

    if (localTrip) {
      Serial.println("==================================================");
      Serial.println("[ALERT] LOCAL HARDWARE OVERRIDE: DANGEROUS VOLTAGE! Killing Power...");
      Serial.printf("[ALERT]   Reason: %s  Voltage: %.2fV\n", localTripReason, tripVoltage);
      Serial.println("==================================================");

      relayState = true;
      digitalWrite(RELAY_PIN, LOW);
      Serial.println("[RELAY] LOCAL TRIP EXECUTED — Power disconnected.");
    }
  }

  // ── BUILD JSON PAYLOAD ──
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;

  JsonObject threePhase = doc["threePhase"].to<JsonObject>();
  addPhaseJson(threePhase, "phase_a", phaseA);
  addPhaseJson(threePhase, "phase_b", phaseB);
  addPhaseJson(threePhase, "phase_c", phaseC);

  doc["timestamp"] = getTimestamp();

  if (localTrip && localTripReason) {
    doc["localTrip"] = true;
    doc["localTripReason"] = localTripReason;
  }

  // All phases at 0V (but not NaN) means mains AC power is cut
  if (phaseA.voltage == 0.0 && phaseB.voltage == 0.0 && phaseC.voltage == 0.0) {
    doc["blackout"] = true;
    Serial.println("[ALERT] Mains blackout detected (0V on all phases). Flagging payload.");
  }

  String payload;
  serializeJson(doc, payload);

  sendToCloud(payload);
}
