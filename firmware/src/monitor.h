#ifndef MONITOR_H
#define MONITOR_H

#include <PZEM004Tv30.h>
#include "config.h"

// ──── DATA MODEL ──────────────────────────────────────────
struct PhaseReading {
    float voltage;
    float current;
    float power;
    float energy;
    float frequency;
    float powerFactor;
    bool offline;   // true when all core fields returned NaN
};

// ──── CORE FUNCTIONS ──────────────────────────────────────

// Read all parameters from a single PZEM module.
// Replaces NaN values with safe defaults (0) and returns a populated struct.
PhaseReading readPhase(PZEM004Tv30& meter);

// Read all 3 phases, validate, check safety, build JSON, and upload.
void readAndSend3Phase();

#endif
