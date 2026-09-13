// ════════════════════════════════════════════════════════════
// RELAY GPIO25 ACTUATION DIAGNOSTIC — NETWORK-FREE
// ════════════════════════════════════════════════════════════
// Temporary diagnostic build (env: relaydiag). Purpose: prove whether
// GPIO25 and the relay hardware actuate reliably with NO Supabase, HTTP,
// polling, WebSocket, dashboard, or Wi-Fi dependency at all.
//
// It reuses the production relay functions from relay.cpp — tripRelay()
// and resetRelay() — so the exact GPIO/polarity path under test is the
// production path:
//   TRIP  -> digitalWrite(RELAY_PIN, LOW)   (GPIO25 low)
//   RESET -> digitalWrite(RELAY_PIN, HIGH)  (GPIO25 high)
//
// No network code is compiled into this environment (build_src_filter
// selects only relay.cpp and this file); the single stub below exists
// only to satisfy the linker for relay.cpp's pollRelayState(), which is
// never called here.
// ════════════════════════════════════════════════════════════

#include <Arduino.h>

#include "config.h"
#include "relay.h"

// relay.cpp's pollRelayState() references this; never called in the
// diagnostic, but the symbol must exist at link time. Keeps the build
// free of network.cpp / Wi-Fi / HTTP code.
int8_t fetchRelayStateForPolling() { return -1; }

// Global relay state shared with relay.cpp (extern there).
bool relayState = false;

static constexpr uint32_t SAFETY_DELAY_MS = 3000;
static constexpr uint32_t HOLD_MS         = 5000;
static constexpr uint8_t  TEST_CYCLES     = 30;

static void printPinState(const char* tag) {
  int readback = digitalRead(RELAY_PIN);
  Serial.printf("[RELAY-TEST] %s gpio25 driven=%s (%d) readback=%s (%d) t=%lu ms\n",
                tag,
                relayState ? "LOW" : "HIGH", relayState ? LOW : HIGH,
                readback ? "HIGH" : "LOW", readback,
                (unsigned long)millis());
}

void setup() {
  // Same UART0 debug console pins as production (GPIO3 RX / GPIO1 TX).
  Serial.begin(115200, SERIAL_8N1, 3, 1);
  delay(200);

  Serial.println();
  Serial.println("======================================================");
  Serial.println(" RELAY GPIO25 DIAGNOSTIC (no Wi-Fi / no network / no cloud)");
  Serial.println(" Reuses production tripRelay()/resetRelay() + polarity");
  Serial.println("======================================================");

  // Same relay initialization sequence as production setup().
  pinMode(RELAY_PIN, OUTPUT);
  relayState = false;
  digitalWrite(RELAY_PIN, HIGH);
  printPinState("INIT NORMAL");

  Serial.printf("[RELAY-TEST] Safety delay %lu ms before first TRIP...\n",
                (unsigned long)SAFETY_DELAY_MS);
  delay(SAFETY_DELAY_MS);

  for (uint8_t i = 1; i <= TEST_CYCLES; i++) {
    Serial.printf("[RELAY-TEST] ---- cycle %u/%u ----\n", i, TEST_CYCLES);

    Serial.printf("[RELAY-TEST] TRIP \xE2\x80\x94 GPIO25 LOW  t=%lu ms\n", (unsigned long)millis());
    tripRelay("GPIO25 diagnostic");
    printPinState("TRIP");
    delay(HOLD_MS);

    Serial.printf("[RELAY-TEST] RESET \xE2\x80\x94 GPIO25 HIGH t=%lu ms\n", (unsigned long)millis());
    resetRelay();
    printPinState("RESET");
    delay(HOLD_MS);
  }

  Serial.println("======================================================");
  Serial.printf("[RELAY-TEST] COMPLETE %u/%u cycles, final state NORMAL (gpio25=HIGH)\n",
                TEST_CYCLES, TEST_CYCLES);
  Serial.println("[RELAY-TEST] No network was initialized at any point.");
  Serial.println("======================================================");
}

void loop() {
  delay(1000);
}
