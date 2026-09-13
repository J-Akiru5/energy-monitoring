#ifndef RELAY_H
#define RELAY_H

#include <cstdint>

// Initialize Supabase Realtime WebSocket for relay control.
void initSupabaseRealtime();

// Send the Phoenix application-level heartbeat while the Realtime socket is
// connected (millis()-scheduled, non-blocking). Call every main-loop pass.
void maintainRealtimeHeartbeat();

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
