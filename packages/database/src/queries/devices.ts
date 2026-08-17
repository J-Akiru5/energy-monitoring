import { getSupabaseAdmin } from "../client";
import type { DeviceCreate } from "@energy/types";
import { randomUUID, createHash } from "crypto";

/**
 * SHA-256 hex digest of a device API key.
 *
 * Device tokens are high-entropy generated secrets (`em_<uuid>`), not user
 * passwords, so a plain SHA-256 digest is sufficient — no bcrypt/argon2.
 *
 * NOTE: existing rows in `devices.api_key_hash` still hold the RAW token.
 * Run `packages/database/src/migrations/003_hash_device_tokens.sql` against
 * every environment BEFORE deploying this code, or every device gets 401s.
 */
function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Register a new ESP32 device. Returns the raw API key (show once!).
 */
export async function registerDevice(input: DeviceCreate) {
  const supabase = getSupabaseAdmin();
  const rawApiKey = `em_${randomUUID().replace(/-/g, "")}`;

  const { data, error } = await supabase
    .from("devices")
    .insert({
      name: input.name,
      location: input.location ?? null,
      api_key_hash: hashDeviceToken(rawApiKey),
    })
    .select()
    .single();

  if (error) throw new Error(`Register device failed: ${error.message}`);

  return { device: data, apiKey: rawApiKey };
}

/**
 * Validate a device API key. Returns the device if valid.
 */
export async function validateDeviceToken(token: string) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .eq("api_key_hash", hashDeviceToken(token))
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * List all registered devices.
 */
export async function listDevices() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .eq("is_active", true)        // Only return devices that are registered & active
    .order("created_at", { ascending: false });

  if (error) throw new Error(`List devices failed: ${error.message}`);
  return data ?? [];
}

/**
 * Deactivate a device (soft delete).
 */
export async function deactivateDevice(deviceId: string) {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("devices")
    .update({ is_active: false })
    .eq("id", deviceId);

  if (error) throw new Error(`Deactivate device failed: ${error.message}`);
}
