import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin, getRelayLogs } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

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

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let customerId: string;
    let isSuperAdmin: boolean;
    try {
      const access = await resolveAccess(user.id, "view_energy");
      customerId = access.customerId;
      isSuperAdmin = access.isSuperAdmin;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    // Super Admins see all relay logs for the device; normal users are scoped to their customer.
    const logs = isSuperAdmin
      ? (await getSupabaseAdmin().from("relay_logs").select("*").eq("device_id", deviceId).order("created_at", { ascending: false }).limit(limit)).data
      : await getRelayLogs(deviceId, customerId, limit);
    return NextResponse.json({ logs });
  } catch (err) {
    console.error("[/api/relay/logs] GET Error:", err);
    return NextResponse.json({ error: "Failed to get logs" }, { status: 500 });
  }
}
