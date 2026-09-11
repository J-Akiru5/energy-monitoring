import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUnreadAlerts, markAlertRead } from "@energy/database";
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
 * GET /api/alerts?deviceId=<optional>
 * Returns unread alerts scoped to the caller's customer.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId") || undefined;

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

    const alerts = await getUnreadAlerts(customerId, deviceId);
    return noStoreJson({ alerts });
  } catch (err) {
    console.error("[/api/alerts] Error:", err);
    return noStoreJson({ error: "Failed to fetch alerts" }, 500);
  }
}

/**
 * PATCH /api/alerts
 * Body: { alertId: string }
 * Marks an alert as read.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { alertId } = await req.json();
    if (!alertId) {
      return noStoreJson({ error: "Missing alertId" }, 400);
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

    await markAlertRead(alertId);
    return noStoreJson({ status: "ok" });
  } catch (err) {
    console.error("[/api/alerts] PATCH Error:", err);
    return noStoreJson({ error: "Failed to mark alert" }, 500);
  }
}
