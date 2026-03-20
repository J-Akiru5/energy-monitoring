import { NextRequest, NextResponse } from "next/server";
import { getRelayConfig } from "@energy/database";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS,PATCH,DELETE,POST,PUT",
      "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Device-Token, Authorization",
    },
  });
}

/**
 * GET /api/relay/config?deviceId=<uuid>
 * Returns relay configuration for the consumer web app.
 *
 * This is used by the consumer relay control page to determine:
 * - Whether relay control is enabled for this device
 * - Whether manual control is allowed
 * - Whether automatic (local safety) mode is enabled
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const config = await getRelayConfig(deviceId);
    return NextResponse.json({ config });
  } catch (err) {
    console.error("[/api/relay/config] GET Error:", err);
    return NextResponse.json(
      { error: "Failed to get relay config" },
      { status: 500 }
    );
  }
}
