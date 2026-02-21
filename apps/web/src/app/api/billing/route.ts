import { NextRequest, NextResponse } from "next/server";
import { getMonthlyEnergy, getBillingRate } from "@energy/database";

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

    const rate = rateConfig?.rate_php_per_kwh ?? 10;
    const estimatedCost = (totalKwh as number) * rate;

    return NextResponse.json({
      totalKwh,
      ratePhpPerKwh: rate,
      estimatedCostPhp: Math.round(estimatedCost * 100) / 100,
      period: `${year}-${String(month).padStart(2, "0")}`,
    });
  } catch (err) {
    console.error("[/api/billing] Error:", err);
    return NextResponse.json({ error: "Failed to calculate billing" }, { status: 500 });
  }
}
