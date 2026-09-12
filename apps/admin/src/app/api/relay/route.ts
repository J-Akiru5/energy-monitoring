import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getRelayState,
  updateRelayState,
  getRelayConfig,
  logRelayAction,
  lookupControllerByDevice,
} from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError, SUPER_ADMIN_CUSTOMER_ID } from "@energy/auth";
import { RelayCommandSchema } from "@energy/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * Verify that a deviceId belongs to the resolved customerId.
 * Returns true if the device resolves to the given customer, or if
 * the caller is a Super Admin (customerId === "*").
 * Returns false and sends a 403 response if the device does not belong
 * to the customer.
 */
async function verifyDeviceOwnership(
  deviceId: string,
  customerId: string,
): Promise<boolean> {
  if (customerId === SUPER_ADMIN_CUSTOMER_ID) return true;

  const stamp = await lookupControllerByDevice(deviceId);
  if (!stamp || stamp.customerId !== customerId) {
    return false;
  }
  return true;
}

/**
 * Shared auth+ownership gate for GET and POST.
 * Returns { user, customerId } on success, or sends an error response and returns null.
 */
async function authenticateAndScope(
  req: NextRequest,
  permission: "view_energy" | "control_relay",
): Promise<{ customerId: string } | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    noStoreJson({ error: "Not authenticated" }, 401);
    return null;
  }

  let customerId: string;
  try {
    const access = await resolveAccess(user.id, permission);
    customerId = access.customerId;
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      noStoreJson({ error: err.message }, 403);
      return null;
    }
    throw err;
  }

  return { customerId };
}

/**
 * GET /api/relay?deviceId=<uuid>
 * Returns current relay state.
 *
 * Auth: session + resolveAccess("control_relay") -> customerId.
 * Verifies the device belongs to that customer via lookupControllerByDevice.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return noStoreJson({ error: "Missing deviceId" }, 400);
    }

    const auth = await authenticateAndScope(req, "control_relay");
    if (!auth) return new NextResponse(null, { status: 401 });

    if (!(await verifyDeviceOwnership(deviceId, auth.customerId))) {
      return noStoreJson({ error: "Device not found or access denied" }, 403);
    }

    const state = await getRelayState(deviceId);
    return noStoreJson({ state });
  } catch (err) {
    console.error("[admin /api/relay] GET Error:", err);
    return noStoreJson({ error: "Failed to get relay state" }, 500);
  }
}

/**
 * POST /api/relay
 * Body: RelayCommand
 * Controls relay (manual trip/reset or status check).
 *
 * Auth: session + resolveAccess("control_relay") -> customerId.
 * Verifies the device belongs to that customer via lookupControllerByDevice.
 * No longer proxies to apps/web — calls @energy/database directly.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAndScope(req, "control_relay");
    if (!auth) return new NextResponse(null, { status: 401 });

    const body = await req.json();
    const parsed = RelayCommandSchema.safeParse(body);

    if (!parsed.success) {
      return noStoreJson(
        { error: "Invalid command", details: parsed.error.flatten() },
        422
      );
    }

    const command = parsed.data;

    if (!(await verifyDeviceOwnership(command.deviceId, auth.customerId))) {
      return noStoreJson({ error: "Device not found or access denied" }, 403);
    }

    const config = await getRelayConfig(command.deviceId);
    if (!config || !config.relayEnabled) {
      return noStoreJson(
        { error: "Relay not enabled for this device" },
        403
      );
    }

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

      case "STATUS_CHECK": {
        const state = await getRelayState(command.deviceId);
        return noStoreJson({ state });
      }

      default:
        return noStoreJson({ error: "Unknown action" }, 400);
    }

    if (!success) {
      return noStoreJson({ error: "Failed to execute command" }, 500);
    }

    const newState = await getRelayState(command.deviceId);
    return noStoreJson({ status: "ok", state: newState });
  } catch (err) {
    console.error("[admin /api/relay] POST Error:", err);
    return noStoreJson({ error: "Internal server error" }, 500);
  }
}
