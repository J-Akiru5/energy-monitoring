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

PhaseReading readPhase(PZEM004Tv30& meter);
void readAndUpload();

#endif
