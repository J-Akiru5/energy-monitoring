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

  // NOTE: emu_installations is embedded under `emus`, not directly under
  // `controllers` — there's no FK from controllers to emu_installations
  // (only controllers -> emus -> emu_installations, both via emu_id).
  // Embedding it directly under controllers fails with PGRST200 ("no
  // relationship found") and, because that error is swallowed below for
  // graceful degradation, silently produced an all-NULL tenant stamp on
  // every ingest — this bug predates this fix and was found while
  // generating Phase 3b.3 test data.
  const { data, error } = await supabase
    .from("controllers")
    .select(`
      id,
      emu_id,
      emus (
        owner_customer_id,
        emu_configurations (
          phase_mode,
          ended_at
        ),
        emu_installations (
          id,
          ended_at
        )
      )
    `)
    .eq("legacy_device_id", deviceId)
    .eq("status", "ACTIVE")
    .single();

  if (error || !data) return null;

  const emus = data.emus as unknown as {
    owner_customer_id: string;
    emu_configurations: Array<{ phase_mode: string; ended_at: string | null }> | null;
    emu_installations: Array<{ id: string; ended_at: string | null }> | null;
  } | null;

  // Extract the current installation (ended_at IS NULL)
  const currentInstallation =
    emus?.emu_installations?.find((i) => i.ended_at === null) ?? null;

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
