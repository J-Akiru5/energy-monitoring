import { NextRequest, NextResponse } from "next/server";
import { TelemetryPayloadSchema } from "@energy/types";
import { insertReading, validateDeviceToken, createAlert, getAlertThresholds } from "@energy/database";

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

    // ── 4. Write Reading to Database ──
    await insertReading(payload);

    // ── 5. Alert Engine — Check Thresholds ──
    await checkThresholds(payload.deviceId, payload.reading);

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
 */
async function checkThresholds(
  deviceId: string,
  reading: { voltage: number; current: number; power: number }
) {
  try {
    const thresholds = await getAlertThresholds();
    if (!thresholds) return;

    if (reading.voltage > thresholds.overvoltage) {
      await createAlert({
        deviceId,
        type: "OVERVOLTAGE",
        value: reading.voltage,
        threshold: thresholds.overvoltage,
        message: `High voltage detected: ${reading.voltage}V (threshold: ${thresholds.overvoltage}V)`,
      });
    }

    if (reading.voltage < thresholds.undervoltage) {
      await createAlert({
        deviceId,
        type: "UNDERVOLTAGE",
        value: reading.voltage,
        threshold: thresholds.undervoltage,
        message: `Low voltage detected: ${reading.voltage}V (threshold: ${thresholds.undervoltage}V)`,
      });
    }

    if (reading.current > thresholds.overcurrent) {
      await createAlert({
        deviceId,
        type: "OVERCURRENT",
        value: reading.current,
        threshold: thresholds.overcurrent,
        message: `High current detected: ${reading.current}A (threshold: ${thresholds.overcurrent}A)`,
      });
    }

    if (reading.power > thresholds.high_power) {
      await createAlert({
        deviceId,
        type: "HIGH_POWER",
        value: reading.power,
        threshold: thresholds.high_power,
        message: `High power draw detected: ${reading.power}W (threshold: ${thresholds.high_power}W)`,
      });
    }
  } catch (err) {
    console.error("[Alert Engine] Error:", err);
    // Don't fail the ingest if alert check fails
  }
}
