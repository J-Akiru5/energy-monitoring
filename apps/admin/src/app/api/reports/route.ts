import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@energy/database";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const client = getSupabaseAdmin();

    let query = client
      .from("power_readings")
      .select("voltage, current_amp, power_w, energy_kwh, frequency, power_factor, recorded_at")
      .order("recorded_at", { ascending: true });

    if (deviceId) {
      query = query.eq("device_id", deviceId);
    }

    if (from) {
      query = query.gte("recorded_at", from);
    }

    if (to) {
      query = query.lte("recorded_at", to);
    }

    // Limit to 2000 rows max to prevent overload
    query = query.limit(2000);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ readings: data });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
