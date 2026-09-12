import { getSupabaseAdmin } from "../client";

export interface PzemConfig {
  deviceId: string;
  mode: "auto" | "manual";
  manualSource: "A" | "B" | "C" | null;
  updatedAt: string;
}

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
