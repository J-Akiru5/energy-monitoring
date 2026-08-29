#ifndef NETWORK_H
#define NETWORK_H

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

#endif
