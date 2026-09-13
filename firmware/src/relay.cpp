#include "relay.h"
#include "config.h"
#include "network.h"
#include <Arduino.h>
#include <Preferences.h>

extern bool relayState;

// ──── CLOUD RELAY-STATE POLLING (HTTPS) ───────────────────
// Relay commands travel over the intended device-authenticated API path:
// GET /api/relay?deviceId=<own id> with X-Device-Token. The web route
// validates the token and returns only this device's state; the device
// never carries database credentials and never touches Supabase REST
// directly. The Supabase Realtime WebSocket was removed: it could not be
// kept reliably connected on this ESP32, making relay-command latency
// unacceptable. The cloud row is the source of truth; the local NVS state
// is retained whenever the cloud is unreachable, and a failed or malformed
// response is never interpreted as a command.
void pollRelayState() {
  int8_t cloudState = fetchRelayStateForPolling();

  if (cloudState < 0) {
    Serial.println("[RELAY-POLL] HTTP ERROR — retaining local relay state");
    return;
  }

  bool cloudTripped = (cloudState == 1);

  if (cloudTripped != relayState) {
    Serial.printf("[RELAY-POLL] Cloud state: %s | Local state: %s\n",
                  cloudTripped ? "TRIPPED" : "NORMAL",
                  relayState ? "TRIPPED" : "NORMAL");
    Serial.printf("[RELAY-POLL] State mismatch — applying %s\n",
                  cloudTripped ? "TRIP" : "RESET");

    relayState = cloudTripped;
    digitalWrite(RELAY_PIN, relayState ? LOW : HIGH);
    saveRelayStateToNVS(relayState);

    Serial.println("========================================");
    if (relayState) {
      Serial.println("[RELAY] CIRCUIT TRIPPED!");
      Serial.println("[RELAY] Power disconnected to protect equipment.");
    } else {
      Serial.println("[RELAY] CIRCUIT RESET.");
      Serial.println("[RELAY] Power restored.");
    }
    Serial.printf("[RELAY] State: %s\n", relayState ? "TRIPPED" : "NORMAL");
    Serial.println("========================================");
  } else {
    // Stay quiet while synchronized; print a concise status roughly every
    // 30s (15 polls at 2s) so the monitor still shows polling is alive.
    static uint8_t syncPolls = 0;
    if (++syncPolls >= 15) {
      syncPolls = 0;
      Serial.printf("[RELAY-POLL] HTTP 200 — state synchronized (%s)\n",
                    relayState ? "TRIPPED" : "NORMAL");
    }
  }
}

// ──── MANUAL RELAY CONTROL ────────────────────────────────

void tripRelay(const char* reason) {
  if (!relayState) {
    relayState = true;
    digitalWrite(RELAY_PIN, LOW);
    saveRelayStateToNVS(true);
    Serial.println("========================================");
    Serial.printf("[RELAY] MANUALLY TRIPPED! Reason: %s\n", reason);
    Serial.println("[RELAY] Power disconnected.");
    Serial.println("========================================");
  }
}

void resetRelay() {
  if (relayState) {
    relayState = false;
    digitalWrite(RELAY_PIN, HIGH);
    saveRelayStateToNVS(false);
    Serial.println("========================================");
    Serial.println("[RELAY] MANUALLY RESET. Power restored.");
    Serial.println("========================================");
  }
}

bool isRelayTripped() {
  return relayState;
}

// ──── NVS PERSISTENCE ─────────────────────────────────────

static Preferences nvsPrefs;

void saveRelayStateToNVS(bool tripped) {
  nvsPrefs.begin("relay", false);
  nvsPrefs.putBool("tripped", tripped);
  nvsPrefs.end();
  Serial.printf("[NVS] Relay state saved: %s\n", tripped ? "TRIPPED" : "NORMAL");
}

bool loadRelayStateFromNVS(bool& tripped) {
  nvsPrefs.begin("relay", true);
  bool hasKey = nvsPrefs.isKey("tripped");
  if (hasKey) {
    tripped = nvsPrefs.getBool("tripped", false);
  }
  nvsPrefs.end();

  if (hasKey) {
    Serial.printf("[NVS] Relay state loaded: %s\n", tripped ? "TRIPPED" : "NORMAL");
  } else {
    Serial.println("[NVS] No relay state record found.");
  }
  return hasKey;
}
