import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";
import { buildConsumptionSummary, parseReportFilters } from "../_lib";

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
 * GET /api/reports/summary?deviceId=<id>
 * Returns day/week/month consumption summary and averages.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() resolves which customer the caller is authorized for —
 * that customerId is then passed down into buildConsumptionSummary(), which
 * explicitly filters power_readings and alerts by it.
 */
export async function GET(req: NextRequest) {
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

    const filters = parseReportFilters(req.nextUrl.searchParams);
    const summary = await buildConsumptionSummary(deviceId, customerId, filters);

    return noStoreJson(summary);
  } catch (err) {
    console.error("[/api/reports/summary] Error:", err);
    return noStoreJson({ error: "Failed to generate summary" }, 500);
  }
}
