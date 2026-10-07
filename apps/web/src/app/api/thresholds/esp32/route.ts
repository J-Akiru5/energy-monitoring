import { NextRequest, NextResponse } from "next/server";
import {
  validateDeviceToken,
  getAlertThresholds,
  getRelayConfig,
} from "@energy/database";

export const dynamic = "force-dynamic";

/**
 * GET /api/thresholds/esp32?deviceId=<uuid>
 *
 * Returns thresholds for ESP32 local safety override.
 * Called by ESP32 on boot to fetch current threshold values.
 *
 * The ESP32 uses these values to perform LOCAL hardware protection
 * independent of the cloud - providing safety even when WiFi is disconnected.
 */
export async function GET(req: NextRequest) {
  try {
    // Authenticate device
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

    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    // SECURITY: identity comes from the token row, never the query string —
    // a valid token for device A must never read device B's config.
    if (device.id !== deviceId) {
      return NextResponse.json({ error: "Invalid device token" }, { status: 401 });
    }

    // Fetch global thresholds
    const thresholds = await getAlertThresholds();

    // Fetch device-specific relay config to check if auto-trip (local safety) is enabled
    const relayConfig = await getRelayConfig(deviceId);

    // Return thresholds for ESP32 local hardware override.
    // The per-condition trip flags mirror relay_config so the firmware's
    // local safety matrix matches the cloud auto-trip matrix exactly.
    return NextResponse.json({
      overvoltage: thresholds?.overvoltage ?? 250,
      undervoltage: thresholds?.undervoltage ?? 200,
      overcurrent: thresholds?.overcurrent ?? 80,
      // Local safety follows the autoTripEnabled setting
      localSafetyEnabled: relayConfig?.autoTripEnabled ?? true,
      tripOnOvervoltage: relayConfig?.tripOnOvervoltage ?? true,
      tripOnUndervoltage: relayConfig?.tripOnUndervoltage ?? true,
      tripOnOvercurrent: relayConfig?.tripOnOvercurrent ?? true,
    });
  } catch (err) {
    console.error("[/api/thresholds/esp32] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
