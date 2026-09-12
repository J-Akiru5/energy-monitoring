import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@energy/database";

export const dynamic = "force-dynamic";

interface PzemHealthEntry {
  phase: string;
  healthy: boolean;
  startedAt: string | null;
  inRecovery: boolean;
}

/**
 * GET /api/devices/pzem-health?deviceId=<uuid>
 *
 * Returns per-phase PZEM communication health for a device.
 * Sources from device_alert_state where alert_type = 'PZEM_OFFLINE'.
 * is_active = false → HEALTHY, is_active = true → OFFLINE.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("device_alert_state")
      .select("phase, is_active, in_recovery, started_at")
      .eq("device_id", deviceId)
      .eq("alert_type", "PZEM_OFFLINE")
      .in("phase", ["A", "B", "C"]);

    if (error) {
      console.error("[/api/devices/pzem-health] Error:", error);
      return NextResponse.json({ error: "Failed to query PZEM health" }, { status: 500 });
    }

    const stateMap = new Map<string, { is_active: boolean; in_recovery: boolean; started_at: string | null }>();
    for (const row of data ?? []) {
      stateMap.set(row.phase, {
        is_active: row.is_active,
        in_recovery: row.in_recovery,
        started_at: row.started_at,
      });
    }

    const phases: PzemHealthEntry[] = ["A", "B", "C"].map((phase) => {
      const state = stateMap.get(phase);
      return {
        phase,
        healthy: state ? !state.is_active : true,
        startedAt: state?.started_at ?? null,
        inRecovery: state?.in_recovery ?? false,
      };
    });

    return NextResponse.json({ phases });
  } catch (err) {
    console.error("[/api/devices/pzem-health] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
