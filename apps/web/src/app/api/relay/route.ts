import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getRelayState,
  updateRelayState,
  getRelayConfig,
  logRelayAction,
  validateDeviceToken,
} from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError, assertDeviceOwnership, DeviceAccessDeniedError } from "@energy/auth";
import { RelayCommandSchema } from "@energy/types";
import type { RelayCommand } from "@energy/types";

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
 * DUAL AUTH — accepts EITHER:
 *   Path A: Valid X-Device-Token header (device boot / firmware).
 *           The device identity is resolved FROM THE TOKEN via
 *           validateDeviceToken() — the deviceId query param is ignored
 *           on this path so a token for device A can never read device B.
 *   Path B: Logged-in session with "view_energy" on some customer.
 *           resolveAccess() resolves the caller's customer, then
 *           assertDeviceOwnership() verifies the requested device belongs
 *           to that customer (IDOR guard).
 *
 * relay_config and relay_state have no customer_id column (1:1 with devices),
 * so scoping is enforced at the auth layer, not at the query layer.
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
    // ── Path A: X-Device-Token (device boot / firmware) ────────
    const deviceToken = req.headers.get("x-device-token");
    if (deviceToken) {
      const device = await validateDeviceToken(deviceToken);
      if (!device) {
        return noStoreJson({ error: "Invalid or inactive device token" }, 401);
      }

      // SECURITY: identity comes from the token row, never the query string.
      // A mismatched param is ignored (logged for audit), not trusted — a
      // valid token for device A must never read device B's relay state.
      const queriedDeviceId = req.nextUrl.searchParams.get("deviceId");
      if (queriedDeviceId && queriedDeviceId !== device.id) {
        console.warn(
          `[/api/relay] Device token for ${device.id} requested deviceId=${queriedDeviceId} — ignoring query param.`
        );
      }

      const state = await getRelayState(device.id);
      return noStoreJson({ state });
    }

    // ── Path B: Session (dashboard/user) ────────────────────────
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
    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, "view_energy");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    // ── Verify the device belongs to that customer (IDOR guard) ──
    try {
      await assertDeviceOwnership(access, deviceId);
    } catch (err) {
      if (err instanceof DeviceAccessDeniedError) {
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
 * Path A is the mechanism from fix/relay-auth-gate: the admin app's
 * same-origin proxy attaches RELAY_ADMIN_SECRET server-side so it never
 * reaches the browser. The ESP32 can also use this path for status checks.
 *
 * Path B is the permission-based mechanism from feature/phase3b3-rls-slice-one:
 * resolveAccess() checks that the user has a membership with control_relay
 * granted, then assertDeviceOwnership() verifies command.deviceId belongs to
 * that membership's customer before any relay action is executed.
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
    const parsed = await parseRelayCommand(req);
    if (!parsed.ok) return parsed.response;
    return executeRelayCommand(parsed.command);
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
    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, "control_relay");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    // Parse the command once, then verify device ownership BEFORE any relay
    // action is taken (IDOR guard).
    const parsed = await parseRelayCommand(req);
    if (!parsed.ok) return parsed.response;

    try {
      await assertDeviceOwnership(access, parsed.command.deviceId);
    } catch (err) {
      if (err instanceof DeviceAccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    return executeRelayCommand(parsed.command);
  } catch (err) {
    console.error("[/api/relay] POST Error:", err);
    return noStoreJson({ error: "Internal server error" }, 500);
  }
}

type ParseRelayCommandResult =
  | { ok: true; command: RelayCommand }
  | { ok: false; response: NextResponse };

/**
 * Parse + validate a RelayCommand body.
 *
 * Split out of the executor so the session path (Path B) can inspect
 * command.deviceId and verify device ownership BEFORE any relay action,
 * without reading the request body twice.
 */
async function parseRelayCommand(req: NextRequest): Promise<ParseRelayCommandResult> {
  try {
    const body = await req.json();
    const parsed = RelayCommandSchema.safeParse(body);

    if (!parsed.success) {
      return {
        ok: false,
        response: noStoreJson(
          { error: "Invalid command", details: parsed.error.flatten() },
          422
        ),
      };
    }

    return { ok: true, command: parsed.data };
  } catch (err) {
    console.error("[/api/relay] Command parse error:", err);
    return {
      ok: false,
      response: noStoreJson({ error: "Internal server error" }, 500),
    };
  }
}

/**
 * Shared relay command executor — called after authentication succeeds
 * via either Path A (secret) or Path B (session + ownership check).
 *
 * Does NOT perform any auth checks itself.
 */
async function executeRelayCommand(command: RelayCommand) {
  try {
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
    console.error("[/api/relay] executeRelayCommand Error:", err);
    return noStoreJson({ error: "Internal server error" }, 500);
  }
}
