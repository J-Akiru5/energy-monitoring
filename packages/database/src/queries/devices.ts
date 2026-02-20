import { getSupabaseAdmin } from "../client";
import type { DeviceCreate } from "@energy/types";
import { randomUUID } from "crypto";

/**
 * Register a new ESP32 device. Returns the raw API key (show once!).
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
 * List all registered devices.
 */
export async function listDevices() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`List devices failed: ${error.message}`);
  return data;
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
