import { NextRequest, NextResponse } from "next/server";
import { getLast24hReadings } from "@energy/database";

/**
 * GET /api/readings?deviceId=<id>&range=24h
 * Returns historical readings for the dashboard chart.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const readings = await getLast24hReadings(deviceId);
    return NextResponse.json({ readings });
  } catch (err) {
    console.error("[/api/readings] Error:", err);
    return NextResponse.json({ error: "Failed to fetch readings" }, { status: 500 });
  }
}
