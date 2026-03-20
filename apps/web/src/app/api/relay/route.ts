import { NextRequest, NextResponse } from "next/server";
import {
  getRelayState,
  updateRelayState,
  getRelayConfig,
  logRelayAction,
} from "@energy/database";
import { RelayCommandSchema } from "@energy/types";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS,PATCH,DELETE,POST,PUT",
      "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Device-Token, Authorization",
    },
  });
}

/**
 * GET /api/relay?deviceId=<uuid>
 * Returns current relay state
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const state = await getRelayState(deviceId);
    return NextResponse.json({ state });
  } catch (err) {
    console.error("[/api/relay] GET Error:", err);
    return NextResponse.json({ error: "Failed to get relay state" }, { status: 500 });
  }
}

/**
 * POST /api/relay
 * Body: RelayCommand
 * Controls relay (manual trip/reset or system-initiated)
 *
 * This endpoint can be called by:
 * 1. Admin dashboard (manual control)
 * 2. Internal system (automatic trip on alerts)
 * 3. ESP32 (status updates - via WebSocket subscriptions)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RelayCommandSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid command", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const command = parsed.data;

    // Check relay config
    const config = await getRelayConfig(command.deviceId);
    if (!config || !config.relayEnabled) {
      return NextResponse.json(
        { error: "Relay not enabled for this device" },
        { status: 403 }
      );
    }

    // Handle different actions
    let success = false;
    switch (command.action) {
      case "TRIP":
      case "MANUAL_TRIP":
        success = await updateRelayState(
          command.deviceId,
          true,
          command.trigger || "MANUAL",
          undefined
        );
        await logRelayAction(
          command.deviceId,
          command.action,
          command.trigger,
          undefined,
          undefined,
          undefined,
          command.initiatedBy,
          command.notes
        );
        break;

      case "RESET":
      case "MANUAL_RESET":
        success = await updateRelayState(command.deviceId, false);
        await logRelayAction(
          command.deviceId,
          command.action,
          undefined,
          undefined,
          undefined,
          undefined,
          command.initiatedBy,
          command.notes
        );
        break;

      case "STATUS_CHECK":
        const state = await getRelayState(command.deviceId);
        return NextResponse.json({ state });

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    if (!success) {
      return NextResponse.json({ error: "Failed to execute command" }, { status: 500 });
    }

    // Get updated state
    const newState = await getRelayState(command.deviceId);
    return NextResponse.json({ status: "ok", state: newState });
  } catch (err) {
    console.error("[/api/relay] POST Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
