export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAlertThresholds, getSupabaseAdmin } from "@energy/database";

export async function GET() {
  try {
    const thresholds = await getAlertThresholds();
    return NextResponse.json({ thresholds });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const updates = await req.json();
    // updates: { overvoltage?: number, undervoltage?: number, overcurrent?: number, high_power?: number }

    const client = getSupabaseAdmin();

    // Fetch the ID of the first (and only) threshold row
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
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
