import { NextRequest, NextResponse } from "next/server";
import { getUnreadAlerts, markAlertRead } from "@energy/database";

/**
 * GET /api/alerts?deviceId=<optional>
 * Returns unread alerts.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId") || undefined;
    const alerts = await getUnreadAlerts(deviceId);
    return NextResponse.json({ alerts });
  } catch (err) {
    console.error("[/api/alerts] Error:", err);
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}

/**
 * PATCH /api/alerts
 * Body: { alertId: string }
 * Marks an alert as read.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { alertId } = await req.json();
    if (!alertId) {
      return NextResponse.json({ error: "Missing alertId" }, { status: 400 });
    }
    await markAlertRead(alertId);
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("[/api/alerts] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to mark alert" }, { status: 500 });
  }
}
