import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listDevices } from "@energy/database";
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

/**
 * GET /api/devices
 * Returns the list of registered, active devices scoped to the caller's customer.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() resolves which customer the caller is authorized for —
 * that customerId is then passed down into listDevices(), which walks the
 * controllers bridge (devices ← controllers.legacy_device_id →
 * controllers.emu_id → emus.owner_customer_id) to scope the results.
 */
export async function GET() {
  try {
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
    let customerId: string;
    try {
      const access = await resolveAccess(user.id, "view_energy");
      customerId = access.customerId;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    const devices = await listDevices(customerId);
    return noStoreJson({ devices });
  } catch (err) {
    console.error("[/api/devices] Error:", err);
    return noStoreJson({ error: "Failed to fetch devices" }, 500);
  }
}
