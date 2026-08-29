#ifndef RELAY_H
#define RELAY_H

// Initialize Supabase Realtime WebSocket for relay control.
void initSupabaseRealtime();

// Manually trip the relay (disconnect power).
void tripRelay(const char* reason);

// Manually reset the relay (restore power).
void resetRelay();

// Check if the relay is currently tripped.
bool isRelayTripped();

#endif
