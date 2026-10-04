import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../client";

/**
 * Replace the ACTIVE controller bridging a legacy device, transactionally.
 *
 * The database function (supabase/migrations/20261004000000_controller_replacement.sql)
 * runs the whole revoke-then-issue in one transaction: old controller(s) →
 * 'REPLACED' with retired_at set, devices.api_key_hash rotated, new controller
 * inserted ACTIVE for the same EMU/device. A mid-failure rolls everything
 * back — the EMU can never end up with two ACTIVE controllers or zero.
 *
 * The raw token is generated here and returned exactly once (same show-once
 * contract as registerDevice). Only its SHA-256 is stored.
 *
 * NOTE: device auth accepts only ACTIVE controllers, so the old token stops
 * working the moment this commits. There is no grace period.
 */
export async function replaceController(deviceId: string) {
  const supabase = getSupabaseAdmin();
  const rawToken = `em_${randomUUID().replace(/-/g, "")}`;

  const { data, error } = await supabase.rpc("replace_controller", {
    p_device_id: deviceId,
    p_new_token: rawToken,
  });

  if (error) throw new Error(`Replace controller failed: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { controller_id: string; device_id: string }
    | undefined;
  if (!row) throw new Error("Replace controller failed: empty response");

  return {
    controllerId: row.controller_id,
    deviceId: row.device_id,
    deviceToken: rawToken,
  };
}
