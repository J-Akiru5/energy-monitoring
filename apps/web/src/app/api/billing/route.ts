import { NextRequest, NextResponse } from "next/server";
import { getMonthlyEnergy, getBillingRate } from "@energy/database";

// Billing should always reflect latest readings and latest admin-configured rate.
export const dynamic = "force-dynamic";

/**
 * GET /api/billing?deviceId=<id>&month=2026-02
 * Calculates estimated PHP cost for the given month.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const monthParam = req.nextUrl.searchParams.get("month");

    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    // Default to current month
    const now = new Date();
    const [year, month] = monthParam
      ? monthParam.split("-").map(Number)
      : [now.getFullYear(), now.getMonth() + 1];

    const [totalKwh, rateConfig] = await Promise.all([
      getMonthlyEnergy(deviceId, year, month),
      getBillingRate(),
    ]);

    const totalKwhValue = Number(totalKwh ?? 0);
    const rate = Number(rateConfig?.rate_php_per_kwh ?? 10);
    const estimatedCost = totalKwhValue * rate;

    return NextResponse.json({
      totalKwh: Number(totalKwhValue.toFixed(4)),
      ratePhpPerKwh: rate,
      estimatedCostPhp: Math.round(estimatedCost * 100) / 100,
      period: `${year}-${String(month).padStart(2, "0")}`,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/billing] Error:", err);
    return NextResponse.json({ error: "Failed to calculate billing" }, { status: 500 });
  }
}
