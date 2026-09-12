#ifndef PROVISIONING_H
#define PROVISIONING_H

#include <Arduino.h>

enum BootState {
  BOOT_UNPROVISIONED,
  BOOT_CONFIGURED_OFFLINE,
  BOOT_CONFIGURED_ONLINE,
  BOOT_BACKEND_UNAVAILABLE,
  BOOT_NORMAL_OPERATION,
  BOOT_PROTECTIVE_TRIP
};

bool provisioningInit();
bool isProvisioned();
void enterProvisioningMode();

BootState getBootState();
void setBootState(BootState state);
const char* getBootStateName(BootState state);

const String& getConfigSsid();
const String& getConfigPassword();
const String& getConfigDeviceId();
const String& getConfigDeviceToken();
const String& getConfigApiEndpoint();
const String& getConfigSupabaseHost();
const String& getConfigSupabaseAnonKey();
int getConfigPhaseMode();

bool saveWifiConfig(const char* ssid, const char* password);
bool saveDeviceConfig(const char* deviceId, const char* deviceToken);
bool savePhaseMode(int mode);
void clearWifiStackCredentials();
void factoryReset();

void handleSerialCommands();

#endif
