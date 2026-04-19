import { NextRequest, NextResponse } from "next/server";
import { buildConsumptionSummary, parseReportFilters } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/summary?deviceId=<id>
 * Returns day/week/month consumption summary and averages.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");

    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const filters = parseReportFilters(req.nextUrl.searchParams);
    const summary = await buildConsumptionSummary(deviceId, filters);

    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/reports/summary] Error:", err);
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
  }
}
