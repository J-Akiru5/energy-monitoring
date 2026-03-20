import { NextRequest, NextResponse } from "next/server";
import { getRelayLogs } from "@energy/database";

export const dynamic = "force-dynamic";

/**
 * GET /api/relay/logs?deviceId=<uuid>&limit=50
 * Returns relay action logs for a device
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const logs = await getRelayLogs(deviceId, limit);
    return NextResponse.json({ logs });
  } catch (err) {
    console.error("[/api/relay/logs] GET Error:", err);
    return NextResponse.json({ error: "Failed to get logs" }, { status: 500 });
  }
}
