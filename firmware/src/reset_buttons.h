#ifndef RESET_BUTTONS_H
#define RESET_BUTTONS_H

// Physical reset buttons (active-low to GND, internal pull-ups).
//   WIFI_RESET_BUTTON_PIN    — hold >= RESET_BUTTON_HOLD_MS → wifi-only reset
//   FACTORY_RESET_BUTTON_PIN — hold >= RESET_BUTTON_HOLD_MS → full reset
// Both call the existing NVS reset architecture (reset_actions /
// provisioning.factoryReset) and reboot into the provisioning AP.

void initResetButtons();
void handleResetButtons();

#endif
