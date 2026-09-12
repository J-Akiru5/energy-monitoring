#include "reset_buttons.h"
#include "config.h"
#include "provisioning.h"
#include "reset_actions.h"
#include <Arduino.h>

// ──── PHYSICAL RESET BUTTONS ──────────────────────────────
// Active-low momentary buttons wired GPIO → button → GND with the ESP32
// internal pull-up enabled (idle HIGH, pressed LOW).
//
// Safety properties:
//   * Buttons are only "armed" after both have read HIGH following boot
//     (plus a startup grace period). A button held/stuck through power-up
//     can never trigger a reset until it has been released once.
//   * Contact bounce is debounced; a 10s continuous (stable) press is
//     required. Any release restarts the countdown.
//   * If both buttons are held, FACTORY (the stronger wipe) wins when both
//     reach threshold in the same iteration; otherwise the first button to
//     reach its threshold triggers.
//   * No network/DB access anywhere in this path — NVS + reboot only.

static const uint32_t DEBOUNCE_MS = 50;

struct ButtonState {
  bool stableDown = false;
  uint32_t lastChangeMs = 0;
  uint32_t pressStartMs = 0;
};

static ButtonState wifiBtn;
static ButtonState factoryBtn;
static bool resetButtonsArmed = false;

// Returns true when the pin has been stably LOW (pressed) for DEBOUNCE_MS.
static bool readButtonDebounced(uint8_t pin, ButtonState& st, uint32_t now) {
  bool raw = (digitalRead(pin) == LOW);

  if (raw != st.stableDown && (now - st.lastChangeMs) >= DEBOUNCE_MS) {
    st.stableDown = raw;
    st.lastChangeMs = now;
    if (raw) {
      st.pressStartMs = now;
    }
  }
  return st.stableDown;
}

void initResetButtons() {
  pinMode(WIFI_RESET_BUTTON_PIN, INPUT_PULLUP);
  pinMode(FACTORY_RESET_BUTTON_PIN, INPUT_PULLUP);

  Serial.printf("[RESET] Buttons ready — WiFi reset: GPIO%d, Factory reset: GPIO%d (hold %lus)\n",
                WIFI_RESET_BUTTON_PIN, FACTORY_RESET_BUTTON_PIN,
                (unsigned long)(RESET_BUTTON_HOLD_MS / 1000));
}

void handleResetButtons() {
  uint32_t now = millis();

  // Wait for a clean idle state after boot before accepting any press.
  if (!resetButtonsArmed) {
    if (now >= RESET_BUTTON_STARTUP_GRACE_MS &&
        digitalRead(WIFI_RESET_BUTTON_PIN) == HIGH &&
        digitalRead(FACTORY_RESET_BUTTON_PIN) == HIGH) {
      resetButtonsArmed = true;
      wifiBtn.lastChangeMs = now;
      factoryBtn.lastChangeMs = now;
    }
    return;
  }

  // Factory first: if both are held to threshold together, the stronger
  // wipe takes precedence. (factoryReset() never returns.)
  bool factoryDown = readButtonDebounced(FACTORY_RESET_BUTTON_PIN, factoryBtn, now);
  if (factoryDown && (now - factoryBtn.pressStartMs) >= RESET_BUTTON_HOLD_MS) {
    Serial.println("[RESET] Factory reset button detected");
    factoryReset();
    return;
  }

  bool wifiDown = readButtonDebounced(WIFI_RESET_BUTTON_PIN, wifiBtn, now);
  if (wifiDown && (now - wifiBtn.pressStartMs) >= RESET_BUTTON_HOLD_MS) {
    Serial.println("[RESET] WiFi reset button detected");
    Serial.println("[RESET] Clearing WiFi credentials...");
    clearWifiStackCredentials();
    clearWifiCredentials();
    Serial.println("[RESET] Restarting...");
    delay(500);
    ESP.restart();
  }
}
