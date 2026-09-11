import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin, getUnreadAlerts } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let customerId: string;
    let isSuperAdmin = false;
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

    const client = getSupabaseAdmin();

    // Parallel fetch: device count, recent alerts, total readings
    // Super Admins see cross-customer data; normal users are scoped to their customer.
    const alertsQuery = isSuperAdmin
      ? client.from("alerts").select("*").eq("is_read", false).order("created_at", { ascending: false }).limit(50)
      : null;

    const [
      { count: deviceCount },
      { count: readingCount },
      scopedAlerts,
      superAlerts,
    ] = await Promise.all([
      client.from("devices").select("*", { count: "exact", head: true }).eq("is_active", true),
      client.from("power_readings").select("*", { count: "exact", head: true }),
      isSuperAdmin ? Promise.resolve(null) : getUnreadAlerts(customerId),
      isSuperAdmin ? alertsQuery! : Promise.resolve(null),
    ]);

    const alertRows = isSuperAdmin ? superAlerts?.data : scopedAlerts;

    return NextResponse.json({
      activeDevices: deviceCount ?? 0,
      totalReadings: readingCount ?? 0,
      unreadAlerts: alertRows?.length ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
