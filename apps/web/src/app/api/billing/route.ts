import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getMonthlyEnergy, getBillingRate } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

// Billing should always reflect latest readings and latest admin-configured rate.
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
 * GET /api/billing?deviceId=<id>&month=2026-02
 * Calculates estimated PHP cost for the given month.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() resolves which customer the caller is authorized for —
 * that customerId is then passed down into getMonthlyEnergy(), which
 * explicitly filters power_readings by it. This is the actual isolation
 * boundary: the query function uses the service-role client (bypasses
 * RLS), so scoping happens here, not at the database layer.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const monthParam = req.nextUrl.searchParams.get("month");

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

    // Default to current month
    const now = new Date();
    const [year, month] = monthParam
      ? monthParam.split("-").map(Number)
      : [now.getFullYear(), now.getMonth() + 1];

    const [totalKwh, rateConfig] = await Promise.all([
      getMonthlyEnergy(deviceId, customerId, year, month),
      getBillingRate(),
    ]);

    const totalKwhValue = Number(totalKwh ?? 0);
    const rate = Number(rateConfig?.rate_php_per_kwh ?? 10);
    const estimatedCost = totalKwhValue * rate;

    return noStoreJson({
      totalKwh: Number(totalKwhValue.toFixed(4)),
      ratePhpPerKwh: rate,
      estimatedCostPhp: Math.round(estimatedCost * 100) / 100,
      period: `${year}-${String(month).padStart(2, "0")}`,
    });
  } catch (err) {
    console.error("[/api/billing] Error:", err);
    return noStoreJson({ error: "Failed to calculate billing" }, 500);
  }
}
