import { NextResponse } from "next/server";
import { listDevices } from "@energy/database";

/**
 * GET /api/devices
 * Returns the list of registered, active devices.
 * The dashboard uses the first device's ID to bootstrap the SSE stream.
 */
export async function GET() {
  try {
    const devices = await listDevices();
    return NextResponse.json({ devices });
  } catch (err) {
    console.error("[/api/devices] Error:", err);
    return NextResponse.json({ error: "Failed to fetch devices" }, { status: 500 });
  }
}
