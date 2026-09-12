import { NextRequest, NextResponse } from "next/server";
import { getPzemConfig, updatePzemConfig, getAlertState } from "@energy/database";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/pzem-config?deviceId=<uuid>
 * Returns PZEM source-mode configuration.
 * Follows the same pattern as /api/relay/config.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const config = await getPzemConfig(deviceId);

    return NextResponse.json({
      mode: config?.mode ?? "auto",
      manualSource: config?.manualSource ?? null,
    });
  } catch (err) {
    console.error("[/api/devices/pzem-config] GET Error:", err);
    return NextResponse.json({ error: "Failed to get config" }, { status: 500 });
  }
}

/**
 * PUT /api/devices/pzem-config?deviceId=<uuid>
 * Body: { mode: "auto" | "manual", manualSource?: "A" | "B" | "C" | null }
 * Rejects MANUAL selection of an offline phase with 409.
 */
export async function PUT(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const body = await req.json();
    const { mode, manualSource } = body as {
      mode?: string;
      manualSource?: string;
    };

    if (mode !== "auto" && mode !== "manual") {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    if (
      mode === "manual" &&
      manualSource !== null &&
      manualSource !== "A" &&
      manualSource !== "B" &&
      manualSource !== "C"
    ) {
      return NextResponse.json({ error: "Invalid manualSource" }, { status: 400 });
    }

    if (mode === "manual" && manualSource) {
      const alertState = await getAlertState(deviceId, "PZEM_OFFLINE", manualSource);
      if (alertState?.isActive) {
        return NextResponse.json(
          {
            status: "error",
            error: `PZEM-${manualSource} is currently unavailable because communication with the sensor has failed.`,
          },
          { status: 409 }
        );
      }
    }

    const resolvedMode: "auto" | "manual" = mode;
    const resolvedSource: "A" | "B" | "C" | null =
      mode === "manual" ? (manualSource as "A" | "B" | "C" | null) : null;

    const success = await updatePzemConfig(deviceId, resolvedMode, resolvedSource);
    if (!success) {
      return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
    }

    return NextResponse.json({ status: "ok", mode: resolvedMode, manualSource: resolvedSource });
  } catch (err) {
    console.error("[/api/devices/pzem-config] PUT Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
