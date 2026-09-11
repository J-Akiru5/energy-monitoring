#include "relay.h"
#include "config.h"
#include "provisioning.h"
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <Preferences.h>

extern WebSocketsClient webSocket;
extern bool wsConnected;
extern unsigned long lastReconnectAttempt;
extern unsigned long wsDisconnectTime;
extern bool relayState;

static void webSocketEvent(WStype_t type, uint8_t* payload, size_t length);
static void subscribeToRelayState();
static void handleRealtimeMessage(char* payload);

// ──── WEBSOCKET INIT ──────────────────────────────────────
void initSupabaseRealtime() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WS] WiFi not connected, skipping WebSocket init.");
    return;
  }

  const String& supabaseHost = getConfigSupabaseHost();
  const String& supabaseKey = getConfigSupabaseAnonKey();

  Serial.println("[WS] Connecting to Supabase Realtime...");

  String wsPath = "/realtime/v1/websocket?apikey=";
  wsPath += supabaseKey;
  wsPath += "&vsn=1.0.0";

  webSocket.beginSSL(supabaseHost.c_str(), 443, wsPath.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(WS_RECONNECT_INTERVAL_MS);
  webSocket.enableHeartbeat(30000, 3000, 2);

  Serial.println("[WS] WebSocket initialized.");
}

// ──── WEBSOCKET EVENT HANDLER ─────────────────────────────
static void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected from Supabase Realtime");
      wsConnected = false;
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected to Supabase Realtime!");
      wsConnected = true;
      subscribeToRelayState();
      break;

    case WStype_TEXT:
      handleRealtimeMessage((char*)payload);
      break;

    case WStype_ERROR:
      Serial.println("[WS] WebSocket error occurred");
      wsConnected = false;
      break;

    case WStype_PING:
    case WStype_PONG:
      break;

    default:
      break;
  }
}

// ──── RELAY STATE SUBSCRIPTION ────────────────────────────
static void subscribeToRelayState() {
  const String& deviceId = getConfigDeviceId();

  JsonDocument doc;
  doc["topic"] = String("realtime:public:relay_state:device_id=eq.") + deviceId;
  doc["event"] = "phx_join";
  doc["payload"]["config"]["postgres_changes"][0]["event"] = "*";
  doc["payload"]["config"]["postgres_changes"][0]["schema"] = "public";
  doc["payload"]["config"]["postgres_changes"][0]["table"] = "relay_state";
  doc["payload"]["config"]["postgres_changes"][0]["filter"] = String("device_id=eq.") + deviceId;
  doc["ref"] = "1";

  String message;
  serializeJson(doc, message);

  webSocket.sendTXT(message);
  Serial.println("[WS] Subscribed to relay_state changes for this device");
  Serial.printf("[WS]   Device ID: %s\n", deviceId.c_str());
}

// ──── REALTIME MESSAGE HANDLER ────────────────────────────
static void handleRealtimeMessage(char* payload) {
  const String& deviceId = getConfigDeviceId();

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    Serial.printf("[WS] JSON parse error: %s\n", error.c_str());
    return;
  }

  const char* event = doc["event"];

  if (strcmp(event, "phx_reply") == 0) {
    const char* status = doc["payload"]["status"];
    if (status && strcmp(status, "ok") == 0) {
      Serial.println("[WS] Subscription confirmed by Supabase");
    }
    return;
  }

  if (strcmp(event, "heartbeat") == 0 || strcmp(event, "phx_heartbeat") == 0) {
    const char* topic = doc["topic"] | "phoenix";
    const char* ref = doc["ref"];

    JsonDocument reply;
    reply["topic"] = topic;
    reply["event"] = "phx_reply";
    reply["ref"] = ref;
    reply["payload"]["status"] = "ok";
    reply["payload"]["response"] = JsonObject();

    String replyStr;
    serializeJson(reply, replyStr);
    webSocket.sendTXT(replyStr);
    Serial.println("[WS] Phoenix heartbeat acknowledged");
    return;
  }

  if (strcmp(event, "system") == 0 || strcmp(event, "presence_state") == 0) {
    return;
  }

  // Handle relay state changes from the admin dashboard
  if (strcmp(event, "postgres_changes") == 0) {
    const char* changeType = doc["payload"]["data"]["type"];
    JsonObject record = doc["payload"]["data"]["record"];

    if (!record.isNull()) {
      const char* recordDeviceId = record["device_id"];
      if (recordDeviceId && strcmp(recordDeviceId, deviceId.c_str()) == 0) {
        bool newTrippedState = record["is_tripped"] | false;
        const char* tripReason = record["trip_reason"] | "UNKNOWN";

        if (newTrippedState != relayState) {
          relayState = newTrippedState;
          digitalWrite(RELAY_PIN, relayState ? LOW : HIGH);
          saveRelayStateToNVS(relayState);

          Serial.println("========================================");
          if (relayState) {
            Serial.printf("[RELAY] CIRCUIT TRIPPED! Reason: %s\n", tripReason);
            Serial.println("[RELAY] Power disconnected to protect equipment.");
          } else {
            Serial.println("[RELAY] Circuit RESET. Power restored.");
          }
          Serial.printf("[RELAY] State: %s\n", relayState ? "TRIPPED" : "NORMAL");
          Serial.println("========================================");
        }
      }
    }
    return;
  }

  if (strcmp(event, "phx_reply") != 0) {
    Serial.printf("[WS] Received event: %s\n", event);
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
