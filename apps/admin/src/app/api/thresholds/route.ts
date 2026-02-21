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
    // updates: { type: string, min_value?: number, max_value?: number }[]

    const client = getSupabaseAdmin();

    for (const threshold of updates) {
      const { error } = await client
        .from("alert_thresholds")
        .update({
          min_value: threshold.min_value,
          max_value: threshold.max_value,
        })
        .eq("metric", threshold.metric);

      if (error) throw error;
    }

    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
