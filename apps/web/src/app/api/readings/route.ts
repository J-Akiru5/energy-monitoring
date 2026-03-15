import { NextRequest, NextResponse } from "next/server";
import { getLast24hReadings, getLatestReading } from "@energy/database";

// Force Next.js to never cache this route — it serves live sensor data.
export const dynamic = "force-dynamic";

/**
 * GET /api/readings?deviceId=<id>
 * GET /api/readings?deviceId=<id>&limit=1   ← used by the polling hook
 *
 * Returns historical readings for the dashboard chart.
 * When limit=1, also returns `age_ms` — the server-computed milliseconds
 * since the last reading. The client uses this for staleness detection
 * instead of doing its own Date.now() math against the device timestamp
 * (which can be wrong if the ESP32 clock has a timezone offset bug).
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
      // Compute age on the server — immune to device clock drift
      const age_ms = latest
        ? Date.now() - new Date(latest.recorded_at).getTime()
        : null;
      return NextResponse.json({ readings: latest ? [latest] : [], age_ms });
    }

    const readings = await getLast24hReadings(deviceId);
    return NextResponse.json({ readings });
  } catch (err) {
    console.error("[/api/readings] Error:", err);
    return NextResponse.json({ error: "Failed to fetch readings" }, { status: 500 });
  }
}

