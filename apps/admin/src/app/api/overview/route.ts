import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUnreadAlerts } from "@energy/database";

export async function GET() {
  try {
    const client = getSupabaseAdmin();

    // Parallel fetch: device count, recent alerts, total readings
    const [
      { count: deviceCount },
      { count: readingCount },
      alerts,
    ] = await Promise.all([
      client.from("devices").select("*", { count: "exact", head: true }).eq("is_active", true),
      client.from("power_readings").select("*", { count: "exact", head: true }),
      getUnreadAlerts(),
    ]);

    return NextResponse.json({
      activeDevices: deviceCount ?? 0,
      totalReadings: readingCount ?? 0,
      unreadAlerts: alerts?.length ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
