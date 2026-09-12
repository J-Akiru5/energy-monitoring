#include "reset_actions.h"
#include "config.h"
#include <Preferences.h>

void clearWifiCredentials() {
  Preferences nvs;
  nvs.begin(EmuCfg::NVS_NAMESPACE, false);
  nvs.remove(EmuCfg::KEY_WIFI_SSID);
  nvs.remove(EmuCfg::KEY_WIFI_PASS);
  nvs.end();
}

void clearAllEmuConfig() {
  Preferences nvs;
  nvs.begin(EmuCfg::NVS_NAMESPACE, false);
  nvs.clear();
  nvs.end();
}
