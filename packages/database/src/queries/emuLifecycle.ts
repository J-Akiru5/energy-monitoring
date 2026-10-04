import { getSupabaseAdmin } from "../client";

/**
 * Decommission an EMU, transactionally.
 *
 * Ends the EMU's open installation and sets its status to 'DECOMMISSIONED'
 * in one database transaction (supabase/migrations/20261004000001_emu_lifecycle.sql),
 * so a mid-failure cannot leave a decommissioned EMU with an open
 * installation. The controller is deliberately untouched: the hardware
 * credential stays valid so a physically redeployed unit can resume
 * telemetry after redeployEmu().
 */
export async function decommissionEmu(deviceId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.rpc("decommission_emu", {
    p_device_id: deviceId,
  });

  if (error) throw new Error(`Decommission EMU failed: ${error.message}`);
}

/**
 * Redeploy a DECOMMISSIONED EMU, transactionally.
 *
 * Creates a new installation at the target site/building and reactivates
 * the EMU in one database transaction. The target must belong to the EMU's
 * owning customer — cross-customer redeployment is a reassignment (RM-09,
 * blocked on OD-1) and the database function rejects it.
 */
export async function redeployEmu(
  deviceId: string,
  siteId: string,
  buildingId: string
) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("redeploy_emu", {
    p_device_id: deviceId,
    p_site_id: siteId,
    p_building_id: buildingId,
  });

  if (error) throw new Error(`Redeploy EMU failed: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { installation_id: string; emu_id: string; customer_id: string }
    | undefined;
  if (!row) throw new Error("Redeploy EMU failed: empty response");

  return {
    installationId: row.installation_id,
    emuId: row.emu_id,
    customerId: row.customer_id,
  };
}
