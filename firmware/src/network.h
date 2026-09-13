#ifndef NETWORK_H
#define NETWORK_H

#include <Arduino.h>
#include <cstdint>

void connectWiFi();
void syncNTP();
void sendToCloud(const String& payload);
void fetchThresholdsFromCloud();
int8_t fetchRelayStateFromCloud();
// Silent variant used by the 2s relay-state poll (caller logs [RELAY-POLL]).
int8_t fetchRelayStateForPolling();
bool testBackendReachable();

#endif
