import { NextRequest, NextResponse } from "next/server";
import { getRelayLogs } from "@energy/database";

export const dynamic = "force-dynamic";

function getRelayConfigError() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return "Missing NEXT_PUBLIC_SUPABASE_URL";
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return "Missing SUPABASE_SERVICE_ROLE_KEY";
  }

  return null;
}

/**
 * GET /api/relay/logs?deviceId=<uuid>&limit=50
 * Returns relay action logs for a device
 */
export async function GET(req: NextRequest) {
  const configError = getRelayConfigError();
  if (configError) {
    return NextResponse.json(
      { error: `Relay backend not configured: ${configError}` },
      { status: 503 }
    );
  }

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
