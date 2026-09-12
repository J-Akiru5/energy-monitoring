import { NextRequest, NextResponse } from "next/server";
import { TelemetryPayloadSchema, isThreePhasePayload } from "@energy/types";
import type { ThreePhaseReading, AlertType } from "@energy/types";
import {
  insertReading,
  validateDeviceToken,
  createAlert,
  promoteAlertToIncident,
  getAlertThresholds,
  getRelayConfig,
  updateRelayState,
  logRelayAction,
  getDeviceBlackoutState,
  startBlackoutEvent,
  endBlackoutEvent,
  getAllActiveAlertStates,
  startAlertIncident,
  setAlertRecovery,
  cancelAlertRecovery,
  endAlertIncident,
  lookupControllerByDevice,
} from "@energy/database";

// ──── Rate limiting (in-memory, per device) ────────────────────────────
const lastPostTime = new Map<string, number>();

// ──── PZEM Offline Alert Helper ────────────────────────────────────────
async function firePzemOfflineAlerts(
  deviceId: string,
  phaseFlags: { A: boolean; B: boolean; C: boolean },
  activeStates: Map<string, import("@energy/database").AlertState>
) {
  for (const [phase, isFault] of Object.entries(phaseFlags)) {
    await processFaultCondition({
      deviceId,
      type: "PZEM_OFFLINE",
      phase,
      isFault,
      faultValue: 0,
      threshold: 0,
      message: `Phase ${phase} communication failure — inspection required. Check wiring, connector, sensor power, or the communication path.`,
      activeStates,
    });
  }
}

// ──── Alert Incident Deduplication (in-memory, per server process) ─────
interface PendingFault {
  firstSeenAt: number;
  alertId:     string;
}

const pendingFaults    = new Map<string, PendingFault>();
const pendingRecovery  = new Map<string, { recoveryStartedAt: number }>();

const INCIDENT_PROMOTE_MS  = 60_000;
const RECOVERY_DEBOUNCE_MS = 30_000;

/**
 * POST /api/ingest
 *
 * Receives telemetry from ESP32 (or mock sensor).
 * Supports single-phase, 3-phase, and 1-phase redundant-tap payloads.
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("x-device-token");
    if (!token) {
      return NextResponse.json(
        { error: "Missing X-Device-Token header" },
        { status: 401 }
      );
    }

    const device = await validateDeviceToken(token);
    if (!device) {
      return NextResponse.json(
        { error: "Invalid or inactive device token" },
        { status: 401 }
      );
    }

    const tenantStamp = await lookupControllerByDevice(device.id);

    const body = await req.json();
    const parsed = TelemetryPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const payload = parsed.data;

    const now = Date.now();
    const lastTime = lastPostTime.get(payload.deviceId) || 0;
    if (now - lastTime < 1000) {
      return NextResponse.json(
        { error: "Rate limited. Max 1 request per second per device." },
        { status: 429 }
      );
    }
    lastPostTime.set(payload.deviceId, now);

    // ── 4a. Handle Sensor Offline (deduplicated, per-phase) ──
    if (payload.sensorOffline) {
      // This shortcut is only sent when ALL raw phases are unavailable — in
      // 3-phase mode when every PZEM is dead, and in 1-phase AUTO once A/B/C
      // have all failed over and none responds. The payload never carries
      // `threePhase` in either mode, so the flags are always all-true; any
      // narrower branch here would be unreachable and would misreport a
      // total-loss event as single-phase comm failure.
      const activeStates = await getAllActiveAlertStates(payload.deviceId);
      await firePzemOfflineAlerts(payload.deviceId, { A: true, B: true, C: true }, activeStates);
      return NextResponse.json({ status: "ok", sensorOffline: true }, { status: 200 });
    }

    const is3Phase = isThreePhasePayload(payload);
    if (!is3Phase && !payload.reading) {
      return NextResponse.json({ error: "Missing reading data" }, { status: 422 });
    }

    const serverPayload = {
      ...payload,
      timestamp: new Date().toISOString(),
    };
    await insertReading(serverPayload, tenantStamp);

    // ── 4d. Per-Phase PZEM Offline Alerts (3-phase only) ──
    if (is3Phase) {
      const offlineStates = await getAllActiveAlertStates(payload.deviceId);
      await firePzemOfflineAlerts(payload.deviceId, {
        A: payload.threePhase!.phase_a.offline,
        B: payload.threePhase!.phase_b.offline,
        C: payload.threePhase!.phase_c.offline,
      }, offlineStates);
    }

    // ── 5. Smart Blackout Detection ──
    const blackoutState = await getDeviceBlackoutState(payload.deviceId);
    const wasInBlackout = blackoutState?.inBlackout ?? false;
    const isBlackout    = payload.blackout === true;

    const currentVoltage = is3Phase
      ? (payload.pzemActiveSource === "B"
          ? payload.threePhase!.phase_b.voltage
          : payload.pzemActiveSource === "C"
            ? payload.threePhase!.phase_c.voltage
            : payload.threePhase!.phase_a.voltage)
      : payload.reading!.voltage;

    if (isBlackout && !wasInBlackout) {
      const alert = await createAlert({
        deviceId:  payload.deviceId,
        type:      "BLACKOUT",
        value:     0,
        threshold: 0,
        message:   "BLACKOUT STARTED: Mains power outage detected (0V AC).",
      });
      await startBlackoutEvent(payload.deviceId, alert?.id);
      console.log(`[Blackout] Started for device ${payload.deviceId}`);

    } else if (!isBlackout && wasInBlackout) {
      const ended = await endBlackoutEvent(payload.deviceId);
      if (ended) {
        await createAlert({
          deviceId:  payload.deviceId,
          type:      "BLACKOUT",
          value:     currentVoltage,
          threshold: 0,
          message:   `BLACKOUT ENDED: Power restored at ${currentVoltage}V.`,
        });
        console.log(`[Blackout] Ended for device ${payload.deviceId}`);
      }
      if (is3Phase) {
        await checkThreePhaseThresholds(payload.deviceId, payload.threePhase!, payload.pzemActiveSource);
      } else {
        await checkThresholds(payload.deviceId, payload.reading!);
      }

    } else if (isBlackout && wasInBlackout) {
      console.log(`[Blackout] Ongoing for device ${payload.deviceId} (silent)`);

    } else {
      if (is3Phase) {
        await checkThreePhaseThresholds(payload.deviceId, payload.threePhase!, payload.pzemActiveSource);
      } else {
        await checkThresholds(payload.deviceId, payload.reading!);
      }
    }

    // ── 6. Handle Local Safety Trips from ESP32 ──
    if (payload.localTrip && payload.localTripReason) {
      const reading = is3Phase
        ? {
            voltage: payload.pzemActiveSource === "B"
              ? payload.threePhase!.phase_b.voltage
              : payload.pzemActiveSource === "C"
                ? payload.threePhase!.phase_c.voltage
                : payload.threePhase!.phase_a.voltage,
            current: payload.pzemActiveSource === "B"
              ? payload.threePhase!.phase_b.current
              : payload.pzemActiveSource === "C"
                ? payload.threePhase!.phase_c.current
                : payload.threePhase!.phase_a.current,
            power: payload.pzemActiveSource
              ? (payload.pzemActiveSource === "B"
                  ? payload.threePhase!.phase_b.power
                  : payload.pzemActiveSource === "C"
                    ? payload.threePhase!.phase_c.power
                    : payload.threePhase!.phase_a.power)
              : payload.threePhase!.phase_a.power +
                payload.threePhase!.phase_b.power +
                payload.threePhase!.phase_c.power,
          }
        : payload.reading!;

      await handleLocalTrip({ deviceId: payload.deviceId, localTripReason: payload.localTripReason, reading });
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });

  } catch (err) {
    console.error("[/api/ingest] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// processFaultCondition — Dual-Track Alert / Incident Engine
// ══════════════════════════════════════════════════════════════════════════

async function processFaultCondition(opts: {
  deviceId:    string;
  type:        AlertType;
  phase:       string;
  isFault:     boolean;
  faultValue:  number;
  threshold:   number;
  message:     string;
  activeStates?: Map<string, import("@energy/database").AlertState>;
}): Promise<{ alert: Awaited<ReturnType<typeof createAlert>> | null }> {
  const { deviceId, type, phase, isFault, faultValue, threshold, message } = opts;
  const mapKey = `${deviceId}:${type}:${phase}`;
  const now    = Date.now();

  if (isFault) {
    if (pendingRecovery.has(mapKey)) {
      pendingRecovery.delete(mapKey);
      await cancelAlertRecovery(deviceId, type, phase);
    }

    const stateKey = `${type}:${phase}`;
    const activeIncident = opts.activeStates
      ? opts.activeStates.get(stateKey)
      : null;

    if (activeIncident?.isActive) {
      return { alert: null };
    }

    const pending = pendingFaults.get(mapKey);

    if (!pending) {
      const alert = await createAlert({ deviceId, type, value: faultValue, threshold, message, phase: phase || null });
      pendingFaults.set(mapKey, { firstSeenAt: now, alertId: alert.id });
      return { alert };
    }

    if (now - pending.firstSeenAt >= INCIDENT_PROMOTE_MS) {
      await promoteAlertToIncident(pending.alertId);
      await startAlertIncident(deviceId, type, phase, pending.alertId);
      pendingFaults.delete(mapKey);
      console.log(`[AlertEngine] Promoted to incident: ${type}${phase ? `/Phase${phase}` : ""} for ${deviceId}`);
      return { alert: null };
    }

    return { alert: null };
  }

  pendingFaults.delete(mapKey);

  const stateKey = `${type}:${phase}`;
  const activeIncident = opts.activeStates ? opts.activeStates.get(stateKey) : null;

  const hasActiveIncident =
    activeIncident?.isActive ??
    (await import("@energy/database").then((m) =>
      m.getAlertState(deviceId, type, phase).then((s) => s?.isActive ?? false)
    ));

  if (!hasActiveIncident) {
    return { alert: null };
  }

  if (!pendingRecovery.has(mapKey)) {
    pendingRecovery.set(mapKey, { recoveryStartedAt: now });
    await setAlertRecovery(deviceId, type, phase);
    return { alert: null };
  }

  const recovery = pendingRecovery.get(mapKey)!;
  if (now - recovery.recoveryStartedAt >= RECOVERY_DEBOUNCE_MS) {
    await endAlertIncident(deviceId, type, phase);
    pendingRecovery.delete(mapKey);
  }

  return { alert: null };
}

// ══════════════════════════════════════════════════════════════════════════
// 3-Phase Threshold Check
// ══════════════════════════════════════════════════════════════════════════

async function checkThreePhaseThresholds(
  deviceId: string,
  threePhase: ThreePhaseReading,
  pzemActiveSource?: "A" | "B" | "C"
) {
  try {
    const thresholds    = await getAlertThresholds();
    if (!thresholds) return;

    const relayConfig   = await getRelayConfig(deviceId);
    const shouldAutoTrip = relayConfig?.autoTripEnabled ?? false;

    const activeStates = await getAllActiveAlertStates(deviceId);

    const phases = [
      { name: "A", data: threePhase.phase_a },
      { name: "B", data: threePhase.phase_b },
      { name: "C", data: threePhase.phase_c },
    ];

    for (const phase of phases) {
      // Safety guard: skip threshold checks for offline phases
      if (phase.data.offline) {
        pendingFaults.delete(`${deviceId}:OVERVOLTAGE:${phase.name}`);
        pendingFaults.delete(`${deviceId}:UNDERVOLTAGE:${phase.name}`);
        pendingFaults.delete(`${deviceId}:OVERCURRENT:${phase.name}`);
        continue;
      }

      // 1-phase redundant-tap guard: skip OV/UV/OC on non-active taps
      if (pzemActiveSource && phase.name !== pzemActiveSource) {
        pendingFaults.delete(`${deviceId}:OVERVOLTAGE:${phase.name}`);
        pendingFaults.delete(`${deviceId}:UNDERVOLTAGE:${phase.name}`);
        pendingFaults.delete(`${deviceId}:OVERCURRENT:${phase.name}`);
        continue;
      }

      const ovRes = await processFaultCondition({
        deviceId,
        type:        "OVERVOLTAGE",
        phase:       phase.name,
        isFault:     phase.data.voltage > thresholds.overvoltage,
        faultValue:  phase.data.voltage,
        threshold:   thresholds.overvoltage,
        message:     `Phase ${phase.name} overvoltage: ${phase.data.voltage}V (threshold: ${thresholds.overvoltage}V)`,
        activeStates,
      });
      if (ovRes.alert && shouldAutoTrip && relayConfig?.tripOnOvervoltage) {
        await triggerRelayTrip(deviceId, `OVERVOLTAGE_PHASE_${phase.name}`, phase.data.voltage, thresholds.overvoltage, ovRes.alert.id);
      }

      const uvRes = await processFaultCondition({
        deviceId,
        type:        "UNDERVOLTAGE",
        phase:       phase.name,
        isFault:     phase.data.voltage < thresholds.undervoltage,
        faultValue:  phase.data.voltage,
        threshold:   thresholds.undervoltage,
        message:     `Phase ${phase.name} undervoltage: ${phase.data.voltage}V (threshold: ${thresholds.undervoltage}V)`,
        activeStates,
      });
      if (uvRes.alert && shouldAutoTrip && relayConfig?.tripOnUndervoltage) {
        await triggerRelayTrip(deviceId, `UNDERVOLTAGE_PHASE_${phase.name}`, phase.data.voltage, thresholds.undervoltage, uvRes.alert.id);
      }

      const ocRes = await processFaultCondition({
        deviceId,
        type:        "OVERCURRENT",
        phase:       phase.name,
        isFault:     phase.data.current > thresholds.overcurrent,
        faultValue:  phase.data.current,
        threshold:   thresholds.overcurrent,
        message:     `Phase ${phase.name} overcurrent: ${phase.data.current}A (threshold: ${thresholds.overcurrent}A)`,
        activeStates,
      });
      if (ocRes.alert && shouldAutoTrip && relayConfig?.tripOnOvercurrent) {
        await triggerRelayTrip(deviceId, `OVERCURRENT_PHASE_${phase.name}`, phase.data.current, thresholds.overcurrent, ocRes.alert.id);
      }
    }

    // Total Power — active source only in 1-phase mode
    const totalPower = pzemActiveSource
      ? (pzemActiveSource === "B"
          ? threePhase.phase_b.power
          : pzemActiveSource === "C"
            ? threePhase.phase_c.power
            : threePhase.phase_a.power)
      : threePhase.phase_a.power +
        threePhase.phase_b.power +
        threePhase.phase_c.power;

    await processFaultCondition({
      deviceId,
      type:        "HIGH_POWER",
      phase:       "",
      isFault:     totalPower > thresholds.high_power,
      faultValue:  totalPower,
      threshold:   thresholds.high_power,
      message:     `High total power draw: ${totalPower.toFixed(1)}W (threshold: ${thresholds.high_power}W)`,
      activeStates,
    });

  } catch (err) {
    console.error("[AlertEngine] 3-phase threshold check error:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Single-Phase Threshold Check
// ══════════════════════════════════════════════════════════════════════════

async function checkThresholds(
  deviceId: string,
  reading: { voltage: number; current: number; power: number }
) {
  try {
    const thresholds    = await getAlertThresholds();
    if (!thresholds) return;

    const relayConfig   = await getRelayConfig(deviceId);
    const shouldAutoTrip = relayConfig?.autoTripEnabled ?? false;

    const activeStates = await getAllActiveAlertStates(deviceId);

    const ovRes = await processFaultCondition({
      deviceId, type: "OVERVOLTAGE", phase: "",
      isFault: reading.voltage > thresholds.overvoltage,
      faultValue: reading.voltage, threshold: thresholds.overvoltage,
      message: `High voltage detected: ${reading.voltage}V (threshold: ${thresholds.overvoltage}V)`,
      activeStates,
    });
    if (ovRes.alert && shouldAutoTrip && relayConfig?.tripOnOvervoltage) {
      await triggerRelayTrip(deviceId, "OVERVOLTAGE", reading.voltage, thresholds.overvoltage, ovRes.alert.id);
    }

    const uvRes = await processFaultCondition({
      deviceId, type: "UNDERVOLTAGE", phase: "",
      isFault: reading.voltage < thresholds.undervoltage,
      faultValue: reading.voltage, threshold: thresholds.undervoltage,
      message: `Low voltage detected: ${reading.voltage}V (threshold: ${thresholds.undervoltage}V)`,
      activeStates,
    });
    if (uvRes.alert && shouldAutoTrip && relayConfig?.tripOnUndervoltage) {
      await triggerRelayTrip(deviceId, "UNDERVOLTAGE", reading.voltage, thresholds.undervoltage, uvRes.alert.id);
    }

    const ocRes = await processFaultCondition({
      deviceId, type: "OVERCURRENT", phase: "",
      isFault: reading.current > thresholds.overcurrent,
      faultValue: reading.current, threshold: thresholds.overcurrent,
      message: `High current detected: ${reading.current}A (threshold: ${thresholds.overcurrent}A)`,
      activeStates,
    });
    if (ocRes.alert && shouldAutoTrip && relayConfig?.tripOnOvercurrent) {
      await triggerRelayTrip(deviceId, "OVERCURRENT", reading.current, thresholds.overcurrent, ocRes.alert.id);
    }

    await processFaultCondition({
      deviceId, type: "HIGH_POWER", phase: "",
      isFault: reading.power > thresholds.high_power,
      faultValue: reading.power, threshold: thresholds.high_power,
      message: `High power draw detected: ${reading.power}W (threshold: ${thresholds.high_power}W)`,
      activeStates,
    });

  } catch (err) {
    console.error("[AlertEngine] Single-phase threshold check error:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Relay Helpers
// ══════════════════════════════════════════════════════════════════════════

async function triggerRelayTrip(
  deviceId: string, trigger: string, value: number, threshold: number, alertId?: string
) {
  try {
    await updateRelayState(deviceId, true, trigger, alertId);
    await logRelayAction(deviceId, "TRIP", trigger, value, threshold, alertId, "SYSTEM", "Auto-trip triggered by alert");
    console.log(`[Relay] Auto-tripped relay for device ${deviceId} due to ${trigger}`);
  } catch (err) {
    console.error("[Relay] Failed to trip relay:", err);
  }
}

async function handleLocalTrip(payload: {
  deviceId: string; localTripReason: string;
  reading: { voltage: number; current: number; power: number };
}) {
  try {
    const thresholds     = await getAlertThresholds();
    const isOvervoltage  = payload.localTripReason === "LOCAL_OVERVOLTAGE";
    const alertType      = isOvervoltage ? "OVERVOLTAGE" : "UNDERVOLTAGE";
    const thresholdValue = isOvervoltage
      ? thresholds?.overvoltage  ?? 250
      : thresholds?.undervoltage ?? 200;

    await logRelayAction(payload.deviceId, "LOCAL_TRIP", payload.localTripReason,
      payload.reading.voltage, thresholdValue, undefined, "ESP32_LOCAL",
      "Automatic local hardware safety override by ESP32");
    await updateRelayState(payload.deviceId, true, payload.localTripReason, undefined);
    await createAlert({
      deviceId: payload.deviceId, type: alertType as AlertType,
      value: payload.reading.voltage, threshold: thresholdValue,
      message: `ESP32 LOCAL SAFETY TRIP: ${isOvervoltage ? "Overvoltage" : "Undervoltage"} detected (${payload.reading.voltage}V). Power cut locally by hardware override.`,
    });

    console.log(`[Ingest] Local safety trip logged for device ${payload.deviceId}: ${payload.localTripReason}`);
  } catch (err) {
    console.error("[Ingest] Failed to handle local trip:", err);
  }
}
