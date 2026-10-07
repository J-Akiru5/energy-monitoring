#ifndef RELAY_H
#define RELAY_H

#include <cstdint>

// Poll the cloud relay state over HTTPS and apply any change locally.
// Called from the main loop every RELAY_POLL_INTERVAL_MS. The cloud row is
// the source of truth; local NVS state is retained on HTTP failure, and a
// failed request is never interpreted as a command.
// Exception: while a local safety trip is pending cloud acknowledgment, a
// cloud NORMAL is ignored — otherwise the 2s poll could undo a local cut
// before the backend has recorded it (observed as trip/reset flapping).
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

// ──── LOCAL TRIP ACKNOWLEDGMENT ───────────────────────────
// A local safety trip must be re-announced in telemetry until the backend
// confirms it (cloud relay_state.isTripped == true). Pending state and
// reason are persisted in NVS so a reboot mid-acknowledgment cannot
// silently restore power.
extern bool localTripPending;
extern char localTripPendingReason[40];

void setLocalTripPending(const char* reason);
void clearLocalTripPending();
bool loadLocalTripPending();

#endif
