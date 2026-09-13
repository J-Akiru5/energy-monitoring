#ifndef CONFIG_H
#define CONFIG_H

#include <cstdint>

// Backend defaults (API endpoint / Supabase host / anon key) come from the
// gitignored secrets.h — copy secrets.example.h to secrets.h and fill it in.
// Included here so every translation unit sees the real values instead of
// the fallback placeholders at the bottom of this file.
#include "secrets.h"

// ──── PIN DEFINITIONS ─────────────────────────────────────
// PZEM Phase A: Hardware Serial2
constexpr uint8_t PZEM_A_RX = 16;
constexpr uint8_t PZEM_A_TX = 17;

// PZEM Phase B: Hardware Serial1
constexpr uint8_t PZEM_B_RX = 5;
constexpr uint8_t PZEM_B_TX = 4;

// PZEM Phase C: dedicated software serial (GPIO18/19).
// UART0 (GPIO1/3, 115200) is reserved for the debug console — PZEM-C must
// NOT use Serial/UART0. ESP32 has only 3 hardware UARTs (UART0=debug,
// UART1=PZEM-B, UART2=PZEM-A), so PZEM-C uses EspSoftwareSerial instead.
constexpr uint8_t PZEM_C_RX = 18;
constexpr uint8_t PZEM_C_TX = 19;

// Relay
constexpr uint8_t RELAY_PIN = 25;

// Physical reset buttons (active-low momentary to GND, internal pull-ups).
// GPIO32/33 are ordinary pins: not strapping, not flash/PSRAM, not
// input-only, and unused by UART0/PZEM-A/PZEM-B/PZEM-C/RTC/relay.
constexpr uint8_t WIFI_RESET_BUTTON_PIN    = 32;
constexpr uint8_t FACTORY_RESET_BUTTON_PIN = 33;
static_assert(WIFI_RESET_BUTTON_PIN != FACTORY_RESET_BUTTON_PIN,
              "Reset buttons must use distinct GPIOs");

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

// WebSocket reconnect backoff cap — while disconnected, the library retry
// interval doubles from WS_RECONNECT_INTERVAL_MS up to this, then resets
// on recovery.
constexpr uint32_t WS_RECONNECT_MAX_MS = 60000;

// WebSocket disconnect warning thresholds
constexpr uint32_t WS_DISCONNECT_WARN_MS = 60000;
constexpr uint32_t WS_DISCONNECT_WARN_INTERVAL_MS = 30000;

// HTTP request timeout (allows for Vercel cold starts)
constexpr uint32_t HTTP_TIMEOUT_MS = 8000;

// ──── PHYSICAL RESET BUTTONS ──────────────────────────────
// Hold duration before a reset triggers (deliberate long-press), and a
// minimum uptime before the buttons are accepted at all.
constexpr uint32_t RESET_BUTTON_HOLD_MS          = 10000;
constexpr uint32_t RESET_BUTTON_STARTUP_GRACE_MS = 5000;

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

// ──── PZEM HEALTH STATE MACHINE ──────────────────────────
// These thresholds mirror the backend's dual-track incident engine:
//   INCIDENT_PROMOTE_MS  = 60s → 12 reads × 5s = PZEM_COMM_FAIL_THRESHOLD
//   RECOVERY_DEBOUNCE_MS = 30s →  6 reads × 5s = PZEM_RECOVER_THRESHOLD
// If a PZEM returns NaN (all fields) for PZEM_COMM_FAIL_THRESHOLD
// consecutive reads, it is marked OFFLINE. After PZEM_RECOVER_THRESHOLD
// consecutive good reads, it returns to HEALTHY.
constexpr int PZEM_COMM_FAIL_THRESHOLD = 12;
constexpr int PZEM_RECOVER_THRESHOLD   = 6;

// ──── PZEM SOURCE SELECTION (1-phase mode) ───────────────
// AUTO: priority A → B → C, STICKY failover (once failed over to
//   a lower-priority source, stay on it until IT fails — do not
//   switch back just because a higher-priority source recovers).
// MANUAL: use whatever source is configured; if that source goes
//   OFFLINE, report NO_VALID_SOURCE rather than falling back.
enum PzemSourceMode : uint8_t { PZEM_SOURCE_AUTO = 0, PZEM_SOURCE_MANUAL = 1 };
constexpr uint8_t PZEM_SOURCE_A = 0;
constexpr uint8_t PZEM_SOURCE_B = 1;
constexpr uint8_t PZEM_SOURCE_C = 2;

// ──── NVS CONFIGURATION KEYS ─────────────────────────────
namespace EmuCfg {
  constexpr const char* NVS_NAMESPACE   = "emu_config";
  constexpr const char* KEY_PROVISIONED = "prov";
  constexpr const char* KEY_WIFI_SSID   = "wifi_ssid";
  constexpr const char* KEY_WIFI_PASS   = "wifi_pass";
  constexpr const char* KEY_DEVICE_ID   = "dev_id";
  constexpr const char* KEY_DEVICE_TOKEN= "dev_tok";
  constexpr const char* KEY_API_ENDPOINT= "api_ep";
  constexpr const char* KEY_SUPABASE_HOST="sb_host";
  constexpr const char* KEY_SUPABASE_KEY= "sb_key";
  constexpr const char* KEY_PHASE_MODE  = "phase";
}

// ──── BACKEND DEFAULTS (compile-time — NVS overrides at runtime) ──
#ifndef API_ENDPOINT_DEFAULT
#define API_ENDPOINT_DEFAULT "https://your-deployment.vercel.app/api/ingest"
#endif

#ifndef SUPABASE_HOST_DEFAULT
#define SUPABASE_HOST_DEFAULT "your-project.supabase.co"
#endif

#ifndef SUPABASE_KEY_DEFAULT
#define SUPABASE_KEY_DEFAULT "your-anon-key-here"
#endif

#endif
