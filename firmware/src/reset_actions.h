#ifndef RESET_ACTIONS_H
#define RESET_ACTIONS_H

// NVS-only reset operations for the emu_config namespace.
// Deliberately free of Arduino/WiFi dependencies so the key-selection
// behavior can be host-tested with a Preferences mock.
//
//   clearWifiCredentials() — removes only wifi_ssid + wifi_pass
//                            (preserves prov, dev_id, dev_tok, api_ep,
//                             sb_host, sb_key, phase)
//   clearAllEmuConfig()    — clears the entire emu_config namespace
//                            (Wi-Fi credentials + EMU identity + overrides)

void clearWifiCredentials();
void clearAllEmuConfig();

#endif
