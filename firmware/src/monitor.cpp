#include "monitor.h"
#include "config.h"
#include "provisioning.h"
#include "rtc.h"
#include "network.h"
#include "relay.h"
#include <PZEM004Tv30.h>
#include <ArduinoJson.h>

extern PZEM004Tv30* pzemA;
extern PZEM004Tv30* pzemB;
extern PZEM004Tv30* pzemC;
extern bool relayState;
extern float localOvervoltageThreshold;
extern float localUndervoltageThreshold;
extern bool localSafetyEnabled;

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

// ──── MAIN: READ PHASES + SEND TO CLOUD ──────────────────
void readAndUpload() {
  int phaseMode = getConfigPhaseMode();
  const String& deviceId = getConfigDeviceId();

  PhaseReading phaseA = {0,0,0,0,0,0,true};
  PhaseReading phaseB = {0,0,0,0,0,0,true};
  PhaseReading phaseC = {0,0,0,0,0,0,true};

  if (phaseMode >= 1 && pzemA) phaseA = readPhase(*pzemA);
  if (phaseMode >= 2 && pzemB) phaseB = readPhase(*pzemB);
  if (phaseMode >= 3 && pzemC) phaseC = readPhase(*pzemC);

  // Count offline phases
  int offlineCount = 0;
  if (phaseA.offline) offlineCount++;
  if (phaseB.offline) offlineCount++;
  if (phaseC.offline) offlineCount++;

  int activePhases = 3 - offlineCount;

  // All sensors offline
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
  if (phaseMode >= 1 && phaseA.offline) Serial.println("[PZEM] Phase A offline — sensor comm failed");
  if (phaseMode >= 2 && phaseB.offline) Serial.println("[PZEM] Phase B offline — sensor comm failed");
  if (phaseMode >= 3 && phaseC.offline) Serial.println("[PZEM] Phase C offline — sensor comm failed");

  // Print to Serial
  Serial.printf("--- %d-PHASE PZEM Reading -------------------\n", phaseMode);
  if (phaseMode >= 1)
    Serial.printf("  Phase A: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f  %s\n",
                  phaseA.voltage, phaseA.current, phaseA.power, phaseA.energy, phaseA.powerFactor,
                  phaseA.offline ? "[OFFLINE]" : "");
  if (phaseMode >= 2)
    Serial.printf("  Phase B: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f  %s\n",
                  phaseB.voltage, phaseB.current, phaseB.power, phaseB.energy, phaseB.powerFactor,
                  phaseB.offline ? "[OFFLINE]" : "");
  if (phaseMode >= 3)
    Serial.printf("  Phase C: %.1fV  %.3fA  %.1fW  %.4fkWh  PF:%.2f  %s\n",
                  phaseC.voltage, phaseC.current, phaseC.power, phaseC.energy, phaseC.powerFactor,
                  phaseC.offline ? "[OFFLINE]" : "");

  float totalPower = 0;
  float totalEnergy = 0;
  if (phaseMode >= 1) { totalPower += phaseA.power; totalEnergy += phaseA.energy; }
  if (phaseMode >= 2) { totalPower += phaseB.power; totalEnergy += phaseB.energy; }
  if (phaseMode >= 3) { totalPower += phaseC.power; totalEnergy += phaseC.energy; }

  Serial.printf("  TOTAL:   %.1fW  %.4fkWh  (active phases: %d)\n", totalPower, totalEnergy, activePhases);
  Serial.printf("  Timestamp: %s\n", getTimestamp().c_str());
  Serial.println("--------------------------------------------");

  // ── LOCAL HARDWARE SAFETY OVERRIDE ──
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
    } else if (!phaseA.offline && phaseA.voltage < localUndervoltageThreshold && phaseA.voltage > 0) {
      localTrip = true;
      localTripReason = "LOCAL_UNDERVOLTAGE_PHASE_A";
      tripVoltage = phaseA.voltage;
    } else if (!phaseB.offline && phaseB.voltage < localUndervoltageThreshold && phaseB.voltage > 0) {
      localTrip = true;
      localTripReason = "LOCAL_UNDERVOLTAGE_PHASE_B";
      tripVoltage = phaseB.voltage;
    } else if (!phaseC.offline && phaseC.voltage < localUndervoltageThreshold && phaseC.voltage > 0) {
      localTrip = true;
      localTripReason = "LOCAL_UNDERVOLTAGE_PHASE_C";
      tripVoltage = phaseC.voltage;
    }

    if (localTrip) {
      Serial.println("==================================================");
      Serial.println("[ALERT] LOCAL HARDWARE OVERRIDE: DANGEROUS VOLTAGE! Killing Power...");
      Serial.printf("[ALERT]   Reason: %s  Voltage: %.2fV\n", localTripReason, tripVoltage);
      Serial.println("==================================================");

      relayState = true;
      digitalWrite(RELAY_PIN, LOW);
      saveRelayStateToNVS(true);
      Serial.println("[RELAY] LOCAL TRIP EXECUTED — Power disconnected.");
    }
  }

  // ── BUILD JSON PAYLOAD ──
  JsonDocument doc;
  doc["deviceId"] = deviceId;
  doc["phaseMode"] = phaseMode;

  JsonObject threePhase = doc["threePhase"].to<JsonObject>();
  if (phaseMode >= 1) addPhaseJson(threePhase, "phase_a", phaseA);
  if (phaseMode >= 2) addPhaseJson(threePhase, "phase_b", phaseB);
  if (phaseMode >= 3) addPhaseJson(threePhase, "phase_c", phaseC);

  doc["timestamp"] = getTimestamp();

  if (localTrip && localTripReason) {
    doc["localTrip"] = true;
    doc["localTripReason"] = localTripReason;
  }

  // All phases at 0V means mains AC power is cut
  bool allZero = true;
  if (phaseMode >= 1 && phaseA.voltage != 0.0) allZero = false;
  if (phaseMode >= 2 && phaseB.voltage != 0.0) allZero = false;
  if (phaseMode >= 3 && phaseC.voltage != 0.0) allZero = false;

  if (allZero && activePhases > 0) {
    doc["blackout"] = true;
    Serial.println("[ALERT] Mains blackout detected (0V on all active phases). Flagging payload.");
  }

  String payload;
  serializeJson(doc, payload);

  sendToCloud(payload);
}
