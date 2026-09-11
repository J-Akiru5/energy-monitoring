#ifndef NETWORK_H
#define NETWORK_H

#include <Arduino.h>
#include <cstdint>

void connectWiFi();
void syncNTP();
void sendToCloud(const String& payload);
void fetchThresholdsFromCloud();
int8_t fetchRelayStateFromCloud();
bool testBackendReachable();

#endif
