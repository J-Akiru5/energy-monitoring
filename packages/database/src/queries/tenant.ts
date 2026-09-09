import { getSupabaseAdmin } from "../client";

/**
 * Tenant stamp to embed in telemetry rows during ingestion.
 * All fields are nullable — if any lookup fails, the ingest
 * proceeds without tenant stamping (graceful degradation).
 */
export interface TenantStamp {
  customerId:     string | null;
  emuId:          string | null;
  installationId: string | null;
  controllerId:   string | null;
  phaseConfig:    string | null;
}

/**
 * Look up the controllers row for a given legacy device ID,
 * and return the full tenant stamp needed for power_readings.
 *
 * Returns null if no matching controller exists (pre-backfill
 * or orphaned device). The caller MUST handle null gracefully —
 * telemetry ingestion must never fail because of this lookup.
 */
export async function lookupControllerByDevice(
  deviceId: string
): Promise<TenantStamp | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("controllers")
    .select(`
      id,
      emu_id,
      emu_installations (
        id
      ),
      emus (
        owner_customer_id,
        emu_configurations (
          phase_mode,
          ended_at
        )
      )
    `)
    .eq("legacy_device_id", deviceId)
    .eq("status", "ACTIVE")
    .single();

  if (error || !data) return null;

  // Extract the current installation (ended_at IS NULL)
  const installations = data.emu_installations as unknown as Array<{ id: string }> | null;
  const currentInstallation = installations?.find(() => true) ?? null;

  // Extract the current configuration (ended_at IS NULL)
  const emus = data.emus as unknown as {
    owner_customer_id: string;
    emu_configurations: Array<{ phase_mode: string; ended_at: string | null }> | null;
  } | null;

  const currentConfig = emus?.emu_configurations?.find(
    (c) => c.ended_at === null
  ) ?? null;

  return {
    customerId:     emus?.owner_customer_id ?? null,
    emuId:          data.emu_id ?? null,
    installationId: currentInstallation?.id ?? null,
    controllerId:   data.id ?? null,
    phaseConfig:    currentConfig?.phase_mode ?? null,
  };
}
