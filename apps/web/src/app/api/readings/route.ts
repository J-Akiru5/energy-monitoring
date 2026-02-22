import { NextRequest, NextResponse } from "next/server";
import { getLast24hReadings, getLatestReading } from "@energy/database";

/**
 * GET /api/readings?deviceId=<id>
 * GET /api/readings?deviceId=<id>&limit=1   ← used by the polling hook
 *
 * Returns historical readings for the dashboard chart.
 * When limit=1 is specified, returns only the latest reading
 * (much faster — avoids fetching 24h of rows for live tiles).
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const limit = req.nextUrl.searchParams.get("limit");

    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    // Fast path: polling hook requests only the latest row
    if (limit === "1") {
      const latest = await getLatestReading(deviceId);
      return NextResponse.json({ readings: latest ? [latest] : [] });
    }

    const readings = await getLast24hReadings(deviceId);
    return NextResponse.json({ readings });
  } catch (err) {
    console.error("[/api/readings] Error:", err);
    return NextResponse.json({ error: "Failed to fetch readings" }, { status: 500 });
  }
}
