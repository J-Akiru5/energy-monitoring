#ifndef RELAY_H
#define RELAY_H

#include <cstdint>

// Poll the cloud relay state over HTTPS and apply any change locally.
// Called from the main loop every RELAY_POLL_INTERVAL_MS. The cloud row is
// the source of truth; local NVS state is retained on HTTP failure, and a
// failed request is never interpreted as a command.
void pollRelayState();

// Manually trip the relay (disconnect power).
void tripRelay(const char* reason);

// Manually reset the relay (restore power).
void resetRelay();

// Check if the relay is currently tripped.
bool isRelayTripped();

// Persist relay state to NVS flash so it survives reboots.
void saveRelayStateToNVS(bool tripped);

// Load last-known relay state from NVS flash.
// Returns true if a valid record was found, false otherwise.
bool loadRelayStateFromNVS(bool& tripped);

#endif
