#ifndef CONFIG_H
#define CONFIG_H

#include <cstdint>

// ──── PIN DEFINITIONS ─────────────────────────────────────
// PZEM Phase A: Hardware Serial2
constexpr uint8_t PZEM_A_RX = 16;
constexpr uint8_t PZEM_A_TX = 17;

// PZEM Phase B: Hardware Serial1
constexpr uint8_t PZEM_B_RX = 5;
constexpr uint8_t PZEM_B_TX = 4;

// PZEM Phase C: Hardware Serial (reassigned — no debug after boot)
constexpr uint8_t PZEM_C_RX = 18;
constexpr uint8_t PZEM_C_TX = 19;

// Relay
constexpr uint8_t RELAY_PIN = 25;

// ──── TIMING CONSTANTS ────────────────────────────────────
// Sensor read interval — must be > 1000ms due to API rate limit
constexpr uint32_t SENSOR_INTERVAL_MS = 5000;

// Cloud upload interval (same as sensor — every read is uploaded)
constexpr uint32_t FIREBASE_INTERVAL_MS = 5000;

// WiFi retry backoff cap
constexpr uint32_t WIFI_RETRY_MAX_BACKOFF_MS = 60000;

// NTP resync interval
constexpr uint32_t NTP_RESYNC_INTERVAL_MS = 6UL * 60 * 60 * 1000; // 6 hours

// WebSocket reconnection interval
constexpr uint32_t WS_RECONNECT_INTERVAL_MS = 5000;

// WebSocket disconnect warning thresholds
constexpr uint32_t WS_DISCONNECT_WARN_MS = 60000;
constexpr uint32_t WS_DISCONNECT_WARN_INTERVAL_MS = 30000;

// HTTP request timeout (allows for Vercel cold starts)
constexpr uint32_t HTTP_TIMEOUT_MS = 8000;

// ──── RETRY CONFIG ────────────────────────────────────────
constexpr int MAX_RETRIES = 3;
constexpr int BASE_DELAY_MS = 1000;

// ──── NTP / TIMEZONE ──────────────────────────────────────
constexpr long GMT_OFFSET_SEC = 8 * 3600; // UTC+8 Philippines
constexpr int DAYLIGHT_OFFSET_SEC = 0;
const char* const NTP_SERVER = "pool.ntp.org";
const char* const TZ_OFFSET_STR = "+08:00";

// ──── SAFETY THRESHOLDS (defaults — overwritten from cloud on boot) ──
constexpr float DEFAULT_OVERVOLTAGE_THRESHOLD = 250.0;
constexpr float DEFAULT_UNDERVOLTAGE_THRESHOLD = 200.0;

#endif
