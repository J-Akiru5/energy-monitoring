#ifndef MONITOR_H
#define MONITOR_H

#include <PZEM004Tv30.h>
#include "config.h"

struct PhaseReading {
    float voltage;
    float current;
    float power;
    float energy;
    float frequency;
    float powerFactor;
    bool offline;
};

// Per-phase health state for the offline/healthy state machine.
// Each phase (A, B, C) has its own consecutive-fail/good counters
// and a HEALTHY/OFFLINE boolean state.
struct PhaseHealth {
    bool healthy;                  // true=HEALTHY, false=OFFLINE
    int consecutiveFails;          // incremented on NaN reads, reset on good
    int consecutiveGoods;          // incremented on good reads, reset on fail
};

// PZEM source selection state for 1-phase mode.
struct PzemSourceState {
    PzemSourceMode mode;           // AUTO or MANUAL
    uint8_t activeSource;          // PZEM_SOURCE_A / _B / _C (which source feeds the single-phase payload)
    uint8_t manualSource;          // configured manual source (only meaningful when mode == MANUAL)
};

PhaseReading readPhase(PZEM004Tv30& meter);
void readAndUpload();
void initPzemHealth();
void fetchPzemConfigFromCloud();

#endif
