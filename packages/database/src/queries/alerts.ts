import { getSupabaseAdmin } from "../client";
import type { AlertType } from "@energy/types";

/**
 * Create a new alert (in-app notification).
 */
export async function createAlert(data: {
  deviceId: string;
  type: AlertType;
  value: number;
  threshold: number;
  message: string;
}) {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("alerts").insert({
    device_id: data.deviceId,
    type: data.type,
    value: data.value,
    threshold: data.threshold,
    message: data.message,
  });

  if (error) throw new Error(`Create alert failed: ${error.message}`);
}

/**
 * Get unread alerts for a device (or all devices).
 */
export async function getUnreadAlerts(deviceId?: string) {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("alerts")
    .select("*")
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(50);

  if (deviceId) {
    query = query.eq("device_id", deviceId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Fetch alerts failed: ${error.message}`);
  return data;
}

/**
 * Mark a single alert as read.
 */
export async function markAlertRead(alertId: string) {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("alerts")
    .update({ is_read: true })
    .eq("id", alertId);

  if (error) throw new Error(`Mark alert read failed: ${error.message}`);
}

/**
 * Get current alert thresholds.
 */
export async function getAlertThresholds() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("alert_thresholds")
    .select("*")
    .limit(1)
    .single();

  if (error) throw new Error(`Fetch thresholds failed: ${error.message}`);
  return data;
}
