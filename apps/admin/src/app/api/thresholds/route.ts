export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAlertThresholds, getSupabaseAdmin } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
      await resolveAccess(user.id, "manage_devices");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const thresholds = await getAlertThresholds();
    return NextResponse.json({ thresholds });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch thresholds" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
      await resolveAccess(user.id, "manage_devices");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const updates = await req.json();

    const client = getSupabaseAdmin();

    const { data: existing, error: fetchError } = await client
      .from("alert_thresholds")
      .select("id")
      .limit(1)
      .single();

    if (fetchError) throw fetchError;

    const { error } = await client
      .from("alert_thresholds")
      .update({
        overvoltage: updates.overvoltage,
        undervoltage: updates.undervoltage,
        overcurrent: updates.overcurrent,
        high_power: updates.high_power,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) throw error;

    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to update thresholds" },
      { status: 500 }
    );
  }
}
