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
} from "@energy/database";

// ──── Rate limiting (in-memory, per device) ────────────────────────────
const lastPostTime = new Map<string, number>();

// ──── Alert Incident Deduplication (in-memory, per server process) ─────
//
// Key format: `${deviceId}:${alertType}:${phase}`
//   phase is '' for non-phase-specific alerts (single-phase, HIGH_POWER, PZEM_OFFLINE)
//   phase is 'A' | 'B' | 'C' for 3-phase per-phase alerts
//
// pendingFaults: tracks the timestamp when a fault was first detected + the
//   alert ID that was immediately created. After INCIDENT_PROMOTE_MS elapses
//   without recovery, the alert is promoted to a full incident.
//
// pendingRecovery: tracks the timestamp when recovery (good readings) started.
//   The incident is only CLOSED after RECOVERY_DEBOUNCE_MS of clean readings.

interface PendingFault {
  firstSeenAt: number;
  alertId:     string;
}

const pendingFaults    = new Map<string, PendingFault>();
const pendingRecovery  = new Map<string, { recoveryStartedAt: number }>();

const INCIDENT_PROMOTE_MS  = 60_000; // 60s → promote spike to incident
const RECOVERY_DEBOUNCE_MS = 30_000; // 30s of clean readings → close incident

/**
 * POST /api/ingest
 *
 * Receives telemetry from ESP32 (or mock sensor).
 * Supports both single-phase and 3-phase payloads.
 *
 * 1. Validates X-Device-Token header
 * 2. Validates body with Zod schema
 * 3. Rate-limits to 1 req/sec per device
 * 4. Writes to power_readings
 * 5. Smart blackout detection (unchanged)
 * 6. Deduplicating threshold checks (NEW: dual-track incident model)
 */
export async function POST(req: NextRequest) {
  try {
    // ── 1. Device Authentication ──
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

    // ── 2. Parse & Validate Body ──
    const body = await req.json();
    const parsed = TelemetryPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const payload = parsed.data;

    // ── 3. Rate Limiting (1 req/sec per device) ──
    const now = Date.now();
    const lastTime = lastPostTime.get(payload.deviceId) || 0;
    if (now - lastTime < 1000) {
      return NextResponse.json(
        { error: "Rate limited. Max 1 request per second per device." },
        { status: 429 }
      );
    }
    lastPostTime.set(payload.deviceId, now);

    // ── 4a. Handle Sensor Offline (deduplicated) ──
    if (payload.sensorOffline) {
      await processFaultCondition({
        deviceId:   payload.deviceId,
        type:       "PZEM_OFFLINE",
        phase:      "",
        isFault:    true,
        faultValue: 0,
        threshold:  0,
        message:
          "PZEM sensor offline: ESP32 cannot communicate with power meter. Check wiring and sensor connection.",
      });
      return NextResponse.json({ status: "ok", sensorOffline: true }, { status: 200 });
    }

    // ── 4b. Validate that reading data exists ──
    const is3Phase = isThreePhasePayload(payload);
    if (!is3Phase && !payload.reading) {
      return NextResponse.json({ error: "Missing reading data" }, { status: 422 });
    }

    // ── 4c. Write Reading to Database ──
    const serverPayload = {
      ...payload,
      timestamp: new Date().toISOString(),
    };
    await insertReading(serverPayload);

    // ── 5. Smart Blackout Detection & Event Tracking (unchanged) ──
    const blackoutState = await getDeviceBlackoutState(payload.deviceId);
    const wasInBlackout = blackoutState?.inBlackout ?? false;
    const isBlackout    = payload.blackout === true;

    const currentVoltage = is3Phase
      ? payload.threePhase!.phase_a.voltage
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
      // Fall through to normal threshold checks
      if (is3Phase) {
        await checkThreePhaseThresholds(payload.deviceId, payload.threePhase!);
      } else {
        await checkThresholds(payload.deviceId, payload.reading!);
      }

    } else if (isBlackout && wasInBlackout) {
      // Ongoing blackout — no new alerts
      console.log(`[Blackout] Ongoing for device ${payload.deviceId} (silent)`);

    } else {
      // Normal operation — run deduplicating threshold checks
      if (is3Phase) {
        await checkThreePhaseThresholds(payload.deviceId, payload.threePhase!);
      } else {
        await checkThresholds(payload.deviceId, payload.reading!);
      }
    }

    // ── 6. Handle Local Safety Trips from ESP32 ──
    if (payload.localTrip && payload.localTripReason) {
      const reading = is3Phase
        ? {
            voltage: payload.threePhase!.phase_a.voltage,
            current: payload.threePhase!.phase_a.current,
            power:
              payload.threePhase!.phase_a.power +
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
//
// Called for every condition on every tick.  Returns the newly-created alert
// (if any) so callers can optionally auto-trip the relay on the initial alert.
//
// TRACK A — Fault detected:
//   First bad reading   → create ONE immediate alert + start 60s timer
//   Timer < 60s         → no-op (spike window still open)
//   Timer ≥ 60s, no active incident → PROMOTE: mark alert as incident,
//                                      write device_alert_state row
//   Active incident already exists  → silent no-op
//
// TRACK B — No fault (good reading):
//   No active incident  → clear any pending spike timer, no-op
//   Active incident     → start 30s recovery debounce
//   Recovery ≥ 30s      → close incident (stamp ended_at + duration_seconds)

async function processFaultCondition(opts: {
  deviceId:    string;
  type:        AlertType;
  /** '' for non-phase alerts, 'A'|'B'|'C' for 3-phase */
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

  // ── TRACK A: Fault detected ──────────────────────────────────────────
  if (isFault) {
    // Cancel any active recovery countdown (fault has returned)
    if (pendingRecovery.has(mapKey)) {
      pendingRecovery.delete(mapKey);
      await cancelAlertRecovery(deviceId, type, phase);
    }

    // Check active incident state (prefer caller-supplied batch map for perf)
    const stateKey = `${type}:${phase}`;
    const activeIncident = opts.activeStates
      ? opts.activeStates.get(stateKey)
      : null;

    if (activeIncident?.isActive) {
      // Already an active incident → silent no-op
      return { alert: null };
    }

    const pending = pendingFaults.get(mapKey);

    if (!pending) {
      // First observation of this fault → create ONE immediate alert
      const alert = await createAlert({ deviceId, type, value: faultValue, threshold, message, phase: phase || null });
      pendingFaults.set(mapKey, { firstSeenAt: now, alertId: alert.id });
      return { alert };
    }

    if (now - pending.firstSeenAt >= INCIDENT_PROMOTE_MS) {
      // 60s elapsed without recovery → promote to sustained incident
      await promoteAlertToIncident(pending.alertId);
      await startAlertIncident(deviceId, type, phase, pending.alertId);
      pendingFaults.delete(mapKey);
      console.log(`[AlertEngine] Promoted to incident: ${type}${phase ? `/Phase${phase}` : ""} for ${deviceId}`);
      return { alert: null }; // alert was already returned 60s ago; no relay re-trip
    }

    // Still within the 60s spike window → no-op
    return { alert: null };
  }

  // ── TRACK B: Good reading ────────────────────────────────────────────
  // Cancel any pending spike promotion (fault resolved before 60s)
  pendingFaults.delete(mapKey);

  // Check if there's a current active incident to close
  const stateKey = `${type}:${phase}`;
  const activeIncident = opts.activeStates ? opts.activeStates.get(stateKey) : null;

  // If we don't have it from the batch map, do a targeted DB check
  const hasActiveIncident =
    activeIncident?.isActive ??
    (await import("@energy/database").then((m) =>
      m.getAlertState(deviceId, type, phase).then((s) => s?.isActive ?? false)
    ));

  if (!hasActiveIncident) {
    return { alert: null };
  }

  // Active incident exists — run recovery debounce
  if (!pendingRecovery.has(mapKey)) {
    // First good reading after incident — start 30s recovery window
    pendingRecovery.set(mapKey, { recoveryStartedAt: now });
    await setAlertRecovery(deviceId, type, phase);
    return { alert: null };
  }

  const recovery = pendingRecovery.get(mapKey)!;
  if (now - recovery.recoveryStartedAt >= RECOVERY_DEBOUNCE_MS) {
    // 30s of clean readings → close the incident
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
  threePhase: ThreePhaseReading
) {
  try {
    const thresholds    = await getAlertThresholds();
    if (!thresholds) return;

    const relayConfig   = await getRelayConfig(deviceId);
    const shouldAutoTrip = relayConfig?.autoTripEnabled ?? false;

    // Pre-fetch all active incident states in ONE query (avoids N+1 per condition)
    const activeStates = await getAllActiveAlertStates(deviceId);

    const phases = [
      { name: "A", data: threePhase.phase_a },
      { name: "B", data: threePhase.phase_b },
      { name: "C", data: threePhase.phase_c },
    ];

    for (const phase of phases) {
      // ── Overvoltage ──
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

      // ── Undervoltage ──
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

      // ── Overcurrent ──
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

    // ── Total Power ──
    const totalPower =
      threePhase.phase_a.power +
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

    // ── Overvoltage ──
    const ovRes = await processFaultCondition({
      deviceId,
      type:        "OVERVOLTAGE",
      phase:       "",
      isFault:     reading.voltage > thresholds.overvoltage,
      faultValue:  reading.voltage,
      threshold:   thresholds.overvoltage,
      message:     `High voltage detected: ${reading.voltage}V (threshold: ${thresholds.overvoltage}V)`,
      activeStates,
    });
    if (ovRes.alert && shouldAutoTrip && relayConfig?.tripOnOvervoltage) {
      await triggerRelayTrip(deviceId, "OVERVOLTAGE", reading.voltage, thresholds.overvoltage, ovRes.alert.id);
    }

    // ── Undervoltage ──
    const uvRes = await processFaultCondition({
      deviceId,
      type:        "UNDERVOLTAGE",
      phase:       "",
      isFault:     reading.voltage < thresholds.undervoltage,
      faultValue:  reading.voltage,
      threshold:   thresholds.undervoltage,
      message:     `Low voltage detected: ${reading.voltage}V (threshold: ${thresholds.undervoltage}V)`,
      activeStates,
    });
    if (uvRes.alert && shouldAutoTrip && relayConfig?.tripOnUndervoltage) {
      await triggerRelayTrip(deviceId, "UNDERVOLTAGE", reading.voltage, thresholds.undervoltage, uvRes.alert.id);
    }

    // ── Overcurrent ──
    const ocRes = await processFaultCondition({
      deviceId,
      type:        "OVERCURRENT",
      phase:       "",
      isFault:     reading.current > thresholds.overcurrent,
      faultValue:  reading.current,
      threshold:   thresholds.overcurrent,
      message:     `High current detected: ${reading.current}A (threshold: ${thresholds.overcurrent}A)`,
      activeStates,
    });
    if (ocRes.alert && shouldAutoTrip && relayConfig?.tripOnOvercurrent) {
      await triggerRelayTrip(deviceId, "OVERCURRENT", reading.current, thresholds.overcurrent, ocRes.alert.id);
    }

    // ── High Power ──
    await processFaultCondition({
      deviceId,
      type:        "HIGH_POWER",
      phase:       "",
      isFault:     reading.power > thresholds.high_power,
      faultValue:  reading.power,
      threshold:   thresholds.high_power,
      message:     `High power draw detected: ${reading.power}W (threshold: ${thresholds.high_power}W)`,
      activeStates,
    });

  } catch (err) {
    console.error("[AlertEngine] Single-phase threshold check error:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Relay Helpers (unchanged)
// ══════════════════════════════════════════════════════════════════════════

async function triggerRelayTrip(
  deviceId: string,
  trigger: string,
  value: number,
  threshold: number,
  alertId?: string
) {
  try {
    await updateRelayState(deviceId, true, trigger, alertId);
    await logRelayAction(
      deviceId, "TRIP", trigger, value, threshold, alertId, "SYSTEM", "Auto-trip triggered by alert"
    );
    console.log(`[Relay] Auto-tripped relay for device ${deviceId} due to ${trigger}`);
  } catch (err) {
    console.error("[Relay] Failed to trip relay:", err);
  }
}

async function handleLocalTrip(payload: {
  deviceId:       string;
  localTripReason: string;
  reading:         { voltage: number; current: number; power: number };
}) {
  try {
    const thresholds      = await getAlertThresholds();
    const isOvervoltage   = payload.localTripReason === "LOCAL_OVERVOLTAGE";
    const alertType       = isOvervoltage ? "OVERVOLTAGE" : "UNDERVOLTAGE";
    const thresholdValue  = isOvervoltage
      ? thresholds?.overvoltage   ?? 250
      : thresholds?.undervoltage  ?? 200;

    await logRelayAction(
      payload.deviceId, "LOCAL_TRIP", payload.localTripReason,
      payload.reading.voltage, thresholdValue, undefined, "ESP32_LOCAL",
      "Automatic local hardware safety override by ESP32"
    );
    await updateRelayState(payload.deviceId, true, payload.localTripReason, undefined);
    await createAlert({
      deviceId:  payload.deviceId,
      type:      alertType as AlertType,
      value:     payload.reading.voltage,
      threshold: thresholdValue,
      message:   `ESP32 LOCAL SAFETY TRIP: ${isOvervoltage ? "Overvoltage" : "Undervoltage"} detected (${payload.reading.voltage}V). Power cut locally by hardware override.`,
    });

    console.log(`[Ingest] Local safety trip logged for device ${payload.deviceId}: ${payload.localTripReason}`);
  } catch (err) {
    console.error("[Ingest] Failed to handle local trip:", err);
  }
}
