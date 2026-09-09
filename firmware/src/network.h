#ifndef NETWORK_H
#define NETWORK_H

#include <cstdint>

// Connect to WiFi with timeout and exponential backoff.
// Blocks until connected or max retries exhausted.
void connectWiFi();

// Sync time via NTP and calibrate the RTC if available.
void syncNTP();

// Upload a JSON payload to the cloud API with retries.
void sendToCloud(const String& payload);

// Fetch safety thresholds from the cloud on boot.
// Updates global threshold variables if successful.
void fetchThresholdsFromCloud();

// Fetch current relay state from cloud on boot.
// Returns: 1 = tripped, 0 = normal, -1 = failed/unreachable.
int8_t fetchRelayStateFromCloud();

#endif
