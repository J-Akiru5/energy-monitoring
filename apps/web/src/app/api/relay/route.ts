import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getRelayState,
  updateRelayState,
  getRelayConfig,
  logRelayAction,
} from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";
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

function getRelayConfigError() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return "Missing NEXT_PUBLIC_SUPABASE_URL";
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return "Missing SUPABASE_SERVICE_ROLE_KEY";
  }

  return null;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Relay-Secret",
    },
  });
}

/**
 * GET /api/relay?deviceId=<uuid>
 * Returns current relay state.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() validates the caller is authorized for the device's customer.
 * relay_config and relay_state have no customer_id column (1:1 with devices),
 * so scoping is enforced at the auth layer (device must belong to caller's customer),
 * not at the query layer.
 */
export async function GET(req: NextRequest) {
  const configError = getRelayConfigError();
  if (configError) {
    return noStoreJson(
      { error: `Relay backend not configured: ${configError}` },
      503
    );
  }

  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return noStoreJson({ error: "Missing deviceId" }, 400);
    }

    // ── Authenticate the caller ───────────────────────────────
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ error: "Not authenticated" }, 401);
    }

    // ── Resolve which customer this caller is authorized for ──
    try {
      await resolveAccess(user.id, "view_energy");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    const state = await getRelayState(deviceId);
    return noStoreJson({ state });
  } catch (err) {
    console.error("[/api/relay] GET Error:", err);
    return noStoreJson({ error: "Failed to get relay state" }, 500);
  }
}

/**
 * POST /api/relay
 * Body: RelayCommand
 * Controls relay (manual trip/reset or system-initiated)
 *
 * DUAL AUTH — accepts EITHER:
 *   Path A: Valid X-Relay-Secret header (machine-to-machine, e.g. admin proxy)
 *   Path B: Valid session with "control_relay" granted (user-initiated)
 *
 * Path A is the legacy mechanism from fix/relay-auth-gate: the admin app's
 * same-origin proxy attaches RELAY_ADMIN_SECRET server-side so it never
 * reaches the browser. The ESP32 can also use this path for status checks.
 *
 * Path B is the permission-based mechanism from feature/phase3b3-rls-slice-one:
 * resolveAccess() checks that the user has a membership with control_relay
 * granted, and resolves which customer the device belongs to.
 *
 * The two paths are deliberately not merged into a single check — they
 * serve different callers with different trust models. Path A trusts the
 * secret (infrastructure-level auth). Path B trusts the session
 * (user-level auth).
 */
export async function POST(req: NextRequest) {
  const configError = getRelayConfigError();
  if (configError) {
    return noStoreJson(
      { error: `Relay backend not configured: ${configError}` },
      503
    );
  }

  // ── Path A: X-Relay-Secret (machine-to-machine) ─────────────
  const relaySecret = process.env.RELAY_ADMIN_SECRET;
  const providedSecret = req.headers.get("x-relay-secret");

  if (relaySecret && providedSecret && providedSecret === relaySecret) {
    // Secret matches — bypass session auth entirely.
    // This is the admin proxy path (apps/admin/src/app/api/relay/route.ts).
    return handleRelayCommand(req);
  }

  // ── Path B: Session + resolveAccess (user-initiated) ────────
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ error: "Not authenticated" }, 401);
    }

    // ── Resolve which customer this caller is authorized for ──
    try {
      await resolveAccess(user.id, "control_relay");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    return handleRelayCommand(req);
  } catch (err) {
    console.error("[/api/relay] POST Error:", err);
    return noStoreJson({ error: "Internal server error" }, 500);
  }
}

/**
 * Shared relay command handler — called after authentication succeeds
 * via either Path A (secret) or Path B (session).
 *
 * Separated into its own function so the dual-auth gateway above
 * stays clean and readable.
 */
async function handleRelayCommand(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RelayCommandSchema.safeParse(body);

    if (!parsed.success) {
      return noStoreJson(
        { error: "Invalid command", details: parsed.error.flatten() },
        422
      );
    }

    const command = parsed.data;

    // Check relay config
    const config = await getRelayConfig(command.deviceId);
    if (!config || !config.relayEnabled) {
      return noStoreJson(
        { error: "Relay not enabled for this device" },
        403
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
        return noStoreJson({ state });

      default:
        return noStoreJson({ error: "Unknown action" }, 400);
    }

    if (!success) {
      return noStoreJson({ error: "Failed to execute command" }, 500);
    }

    // Get updated state
    const newState = await getRelayState(command.deviceId);
    return noStoreJson({ status: "ok", state: newState });
  } catch (err) {
    console.error("[/api/relay] handleRelayCommand Error:", err);
    return noStoreJson({ error: "Internal server error" }, 500);
  }
}
