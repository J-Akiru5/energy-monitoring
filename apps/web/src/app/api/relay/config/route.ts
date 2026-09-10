import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRelayConfig } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

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
      "Access-Control-Allow-Methods": "GET,OPTIONS,PATCH,DELETE,POST,PUT",
      "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Device-Token, Authorization",
    },
  });
}

/**
 * GET /api/relay/config?deviceId=<uuid>
 * Returns relay configuration for the consumer web app.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() validates the caller is authorized for the device's customer.
 * relay_config has no customer_id column (1:1 with devices), so scoping is
 * enforced at the auth layer (device must belong to caller's customer).
 *
 * This is used by the consumer relay control page to determine:
 * - Whether relay control is enabled for this device
 * - Whether manual control is allowed
 * - Whether automatic (local safety) mode is enabled
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

    const config = await getRelayConfig(deviceId);
    return noStoreJson({ config });
  } catch (err) {
    console.error("[/api/relay/config] GET Error:", err);
    return noStoreJson(
      { error: "Failed to get relay config" },
      500
    );
  }
}
