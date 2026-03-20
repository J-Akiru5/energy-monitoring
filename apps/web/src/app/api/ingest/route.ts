import { NextRequest, NextResponse } from "next/server";
import { TelemetryPayloadSchema } from "@energy/types";
import {
  insertReading,
  validateDeviceToken,
  createAlert,
  getAlertThresholds,
  getRelayConfig,
  updateRelayState,
  logRelayAction,
  getDeviceBlackoutState,
  startBlackoutEvent,
  endBlackoutEvent,
} from "@energy/database";

// ──── Rate limiting (in-memory, per device) ────────────────
const lastPostTime = new Map<string, number>();

/**
 * POST /api/ingest
 *
 * Receives telemetry from ESP32 (or mock sensor).
 * 1. Validates X-Device-Token header
 * 2. Validates body with Zod schema
 * 3. Rate-limits to 1 req/sec per device
 * 4. Writes to power_readings
 * 5. Checks alert thresholds
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

    // ── 4a. Handle Sensor Offline ──
    if (payload.sensorOffline) {
      await createAlert({
        deviceId: payload.deviceId,
        type: "PZEM_OFFLINE",
        value: 0,
        threshold: 0,
        message: "PZEM sensor offline: ESP32 cannot communicate with power meter. Check wiring and sensor connection.",
      });

      // Don't insert a reading (no valid data), just acknowledge
      return NextResponse.json({ status: "ok", sensorOffline: true }, { status: 200 });
    }

    // ── 4b. Write Reading to Database ──
    // Validate that reading exists before proceeding
    if (!payload.reading) {
      return NextResponse.json(
        { error: "Missing reading data" },
        { status: 422 }
      );
    }

    // IMPORTANT: We override the timestamp with the server's UTC time.
    // The ESP32's RTC stores UTC but incorrectly labels it as +08:00,
    // causing all recorded_at values to be stored 8 hours behind reality.
    // Using server time here ensures reliable staleness detection and ordering.
    const serverPayload = {
      ...payload,
      timestamp: new Date().toISOString(), // authoritative server UTC time
    };
    await insertReading(serverPayload);

    // ── 5. Smart Blackout Detection & Event Tracking ──
    const blackoutState = await getDeviceBlackoutState(payload.deviceId);
    const wasInBlackout = blackoutState?.inBlackout ?? false;
    const isBlackout = payload.blackout === true;

    if (isBlackout && !wasInBlackout) {
      // BLACKOUT START: First 0V reading after normal operation
      const alert = await createAlert({
        deviceId: payload.deviceId,
        type: "BLACKOUT",
        value: 0,
        threshold: 0,
        message: "BLACKOUT STARTED: Mains power outage detected (0V AC).",
      });

      await startBlackoutEvent(payload.deviceId, alert?.id);
      console.log(`[Blackout] Started tracking blackout for device ${payload.deviceId}`);

    } else if (!isBlackout && wasInBlackout) {
      // BLACKOUT END: First non-0V reading after blackout
      const ended = await endBlackoutEvent(payload.deviceId);

      if (ended) {
        await createAlert({
          deviceId: payload.deviceId,
          type: "BLACKOUT",
          value: payload.reading.voltage,
          threshold: 0,
          message: `BLACKOUT ENDED: Power restored at ${payload.reading.voltage}V.`,
        });
        console.log(`[Blackout] Ended blackout for device ${payload.deviceId}`);
      }

      // Continue with normal threshold checks
      await checkThresholds(payload.deviceId, payload.reading);

    } else if (isBlackout && wasInBlackout) {
      // ONGOING BLACKOUT: Don't create duplicate alerts
      console.log(`[Blackout] Ongoing blackout for device ${payload.deviceId} (no new alert)`);

    } else {
      // NORMAL OPERATION: Check thresholds as usual
      await checkThresholds(payload.deviceId, payload.reading);
    }

    // ── 6. Handle Local Safety Trips from ESP32 ──
    if (payload.localTrip && payload.localTripReason && payload.reading) {
      await handleLocalTrip({
        deviceId: payload.deviceId,
        localTripReason: payload.localTripReason,
        reading: payload.reading,
      });
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    console.error("[/api/ingest] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Check reading against alert thresholds and create alerts if needed.
 * Also triggers relay auto-trip if configured.
 */
async function checkThresholds(
  deviceId: string,
  reading: { voltage: number; current: number; power: number }
) {
  try {
    const thresholds = await getAlertThresholds();
    if (!thresholds) return;

    // Get relay config to see if auto-trip is enabled
    const relayConfig = await getRelayConfig(deviceId);
    const shouldAutoTrip = relayConfig?.autoTripEnabled ?? false;

    // Check overvoltage
    if (reading.voltage > thresholds.overvoltage) {
      const alert = await createAlert({
        deviceId,
        type: "OVERVOLTAGE",
        value: reading.voltage,
        threshold: thresholds.overvoltage,
        message: `High voltage detected: ${reading.voltage}V (threshold: ${thresholds.overvoltage}V)`,
      });

      // Auto-trip relay if configured
      if (shouldAutoTrip && relayConfig?.tripOnOvervoltage && alert) {
        await triggerRelayTrip(
          deviceId,
          "OVERVOLTAGE",
          reading.voltage,
          thresholds.overvoltage,
          alert.id
        );
      }
    }

    // Check undervoltage
    if (reading.voltage < thresholds.undervoltage) {
      const alert = await createAlert({
        deviceId,
        type: "UNDERVOLTAGE",
        value: reading.voltage,
        threshold: thresholds.undervoltage,
        message: `Low voltage detected: ${reading.voltage}V (threshold: ${thresholds.undervoltage}V)`,
      });

      // Auto-trip relay if configured
      if (shouldAutoTrip && relayConfig?.tripOnUndervoltage && alert) {
        await triggerRelayTrip(
          deviceId,
          "UNDERVOLTAGE",
          reading.voltage,
          thresholds.undervoltage,
          alert.id
        );
      }
    }

    // Check overcurrent
    if (reading.current > thresholds.overcurrent) {
      const alert = await createAlert({
        deviceId,
        type: "OVERCURRENT",
        value: reading.current,
        threshold: thresholds.overcurrent,
        message: `High current detected: ${reading.current}A (threshold: ${thresholds.overcurrent}A)`,
      });

      // Auto-trip relay if configured
      if (shouldAutoTrip && relayConfig?.tripOnOvercurrent && alert) {
        await triggerRelayTrip(
          deviceId,
          "OVERCURRENT",
          reading.current,
          thresholds.overcurrent,
          alert.id
        );
      }
    }

    if (reading.power > thresholds.high_power) {
      await createAlert({
        deviceId,
        type: "HIGH_POWER",
        value: reading.power,
        threshold: thresholds.high_power,
        message: `High power draw detected: ${reading.power}W (threshold: ${thresholds.high_power}W)`,
      });
      // Note: HIGH_POWER doesn't trip relay (not in tripOnOvervoltage/undervoltage/overcurrent)
    }
  } catch (err) {
    console.error("[Alert Engine] Error:", err);
    // Don't fail the ingest if alert check fails
  }
}

/**
 * Helper function to trigger relay trip on dangerous conditions
 */
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
      deviceId,
      "TRIP",
      trigger,
      value,
      threshold,
      alertId,
      "SYSTEM",
      "Auto-trip triggered by alert"
    );
    console.log(`[Relay] Auto-tripped relay for device ${deviceId} due to ${trigger}`);
  } catch (err) {
    console.error("[Relay] Failed to trip relay:", err);
  }
}

/**
 * Handle local safety trips from ESP32 hardware override.
 * The ESP32 tripped the relay locally and is informing the cloud.
 */
async function handleLocalTrip(payload: {
  deviceId: string;
  localTripReason: string;
  reading: { voltage: number; current: number; power: number };
}) {
  try {
    const thresholds = await getAlertThresholds();
    const isOvervoltage = payload.localTripReason === "LOCAL_OVERVOLTAGE";
    const alertType = isOvervoltage ? "OVERVOLTAGE" : "UNDERVOLTAGE";
    const thresholdValue = isOvervoltage
      ? thresholds?.overvoltage ?? 250
      : thresholds?.undervoltage ?? 200;

    // Log the local trip to relay_logs
    await logRelayAction(
      payload.deviceId,
      "LOCAL_TRIP",
      payload.localTripReason,
      payload.reading.voltage,
      thresholdValue,
      undefined,
      "ESP32_LOCAL",
      "Automatic local hardware safety override by ESP32"
    );

    // Update relay state in database to reflect the local trip
    await updateRelayState(
      payload.deviceId,
      true,
      payload.localTripReason,
      undefined
    );

    // Create alert for the local trip
    await createAlert({
      deviceId: payload.deviceId,
      type: alertType,
      value: payload.reading.voltage,
      threshold: thresholdValue,
      message: `ESP32 LOCAL SAFETY TRIP: ${
        isOvervoltage ? "Overvoltage" : "Undervoltage"
      } detected (${payload.reading.voltage}V). Power cut locally by hardware override.`,
    });

    console.log(
      `[Ingest] Local safety trip logged for device ${payload.deviceId}: ${payload.localTripReason}`
    );
  } catch (err) {
    console.error("[Ingest] Failed to handle local trip:", err);
    // Don't fail the ingest if local trip logging fails
  }
}
