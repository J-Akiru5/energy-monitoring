import { getSupabaseAdmin } from "../client";
import type { DeviceCreate } from "@energy/types";
import { randomUUID } from "crypto";

/**
 * Register a new ESP32 device. Returns the raw API key (show once!).
 *
 * NOTE: devices has no customer_id column — it is the legacy pre-Phase-3a
 * root entity. Device-to-customer scoping is established when a controller
 * is linked to a device (via controllers.legacy_device_id), and that
 * controller's EMU has an owner_customer_id. This function does NOT set
 * customer_id because registration is a system-level operation that happens
 * before any controller/EMU linkage exists.
 */
export async function registerDevice(input: DeviceCreate) {
  const supabase = getSupabaseAdmin();
  const rawApiKey = `em_${randomUUID().replace(/-/g, "")}`;

  // In production, hash the API key before storing.
  // For MVP we store a simple hash placeholder.
  const { data, error } = await supabase
    .from("devices")
    .insert({
      name: input.name,
      location: input.location ?? null,
      api_key_hash: rawApiKey, // TODO: bcrypt hash in production
    })
    .select()
    .single();

  if (error) throw new Error(`Register device failed: ${error.message}`);

  return { device: data, apiKey: rawApiKey };
}

/**
 * Validate a device API key. Returns the device if valid.
 *
 * NOTE: This is called by the ESP32 heartbeat/ingest path (device-auth,
 * not user-auth). No customer scoping needed here — the device is
 * authenticating itself, not a user accessing customer data.
 */
export async function validateDeviceToken(token: string) {
  const supabase = getSupabaseAdmin();

  // TODO: In production, hash the incoming token and compare
  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .eq("api_key_hash", token)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * List devices, optionally scoped to a customer.
 *
 * devices has no customer_id column (legacy pre-Phase-3a table). Scoping
 * walks the controllers bridge:
 *   devices ← controllers.legacy_device_id → controllers.emu_id →
 *   emus.owner_customer_id
 * This is the same path tenant.ts uses for stamping power_readings.
 *
 * @param customerId  Optional. The caller's authorized customer, resolved via
 *                     resolveAccess() at the API-route layer and passed in —
 *                     never re-resolved here. getSupabaseAdmin() is a
 *                     service-role client and bypasses RLS entirely, so this
 *                     explicit filter is the actual isolation boundary for
 *                     this query, not just defense in depth.
 *                     When omitted, returns ALL active devices (used by
 *                     system-internal callers like the heartbeat cron route
 *                     that iterates all devices with no user session).
 */
export async function listDevices(customerId?: string) {
  const supabase = getSupabaseAdmin();

  if (customerId) {
    // Scoped path: find devices belonging to this customer via the
    // controllers → emus bridge
    const { data: scopedControllers, error } = await supabase
      .from("controllers")
      .select("legacy_device_id, emus!inner(owner_customer_id)")
      .not("legacy_device_id", "is", null)
      .eq("emus.owner_customer_id", customerId);

    if (error) throw new Error(`List devices (controllers lookup) failed: ${error.message}`);

    const deviceIds = (scopedControllers ?? [])
      .map((c) => c.legacy_device_id)
      .filter((id): id is string => id !== null);

    if (deviceIds.length === 0) return [];

    const { data, error: devErr } = await supabase
      .from("devices")
      .select("*")
      .in("id", deviceIds)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (devErr) throw new Error(`List devices failed: ${devErr.message}`);
    return data ?? [];
  }

  // Unscoped path: system-internal caller (heartbeat cron, etc.)
  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`List devices failed: ${error.message}`);
  return data ?? [];
}

/**
 * Deactivate a device (soft delete).
 *
 * NOTE: No customer scoping here — deactivation is an admin operation
 * that operates on a specific device ID already resolved by the caller.
 */
export async function deactivateDevice(deviceId: string) {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("devices")
    .update({ is_active: false })
    .eq("id", deviceId);

  if (error) throw new Error(`Deactivate device failed: ${error.message}`);
}
