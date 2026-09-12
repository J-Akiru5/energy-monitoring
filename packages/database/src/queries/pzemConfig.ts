import { getSupabaseAdmin } from "../client";

// ──── Types ─────────────────────────────────────────────────────────────

export interface PzemConfig {
  deviceId: string;
  mode: "auto" | "manual";
  manualSource: "A" | "B" | "C" | null;
  updatedAt: string;
}

// ──── Read ───────────────────────────────────────────────────────────────

/**
 * Get PZEM source-mode configuration for a device.
 * Returns null if no config exists (caller should default to AUTO).
 *
 * Storage proposal: new `pzem_config` table, 1:1 with devices,
 * following the identical shape as relay_config (device_id PK,
 * typed columns, updated_at). Awaiting Jeff's confirmation before
 * writing migration — the route's external behavior is already fixed
 * regardless of internal storage.
 */
export async function getPzemConfig(
  deviceId: string
): Promise<PzemConfig | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pzem_config")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    console.error("[getPzemConfig] Error:", error);
    return null;
  }

  if (!data) return null;

  return {
    deviceId: data.device_id,
    mode: data.mode,
    manualSource: data.manual_source,
    updatedAt: data.updated_at,
  };
}

// ──── Write ──────────────────────────────────────────────────────────────

/**
 * Upsert PZEM source-mode configuration for a device.
 * Creates the row if it doesn't exist; updates mode + manualSource if it does.
 */
export async function updatePzemConfig(
  deviceId: string,
  mode: "auto" | "manual",
  manualSource: "A" | "B" | "C" | null
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase.from("pzem_config").upsert(
    {
      device_id: deviceId,
      mode,
      manual_source: manualSource,
      updated_at: now,
    },
    { onConflict: "device_id" }
  );

  if (error) {
    console.error("[updatePzemConfig] Error:", error);
    return false;
  }

  return true;
}
