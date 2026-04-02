import { getSupabaseAdmin } from "../client";
import type { AlertType } from "@energy/types";

/**
 * Create a new alert (transient spike or initial incident marker).
 * Returns the created alert row including the new incident time-range fields.
 */
export async function createAlert(data: {
  deviceId: string;
  type: AlertType;
  value: number;
  threshold: number;
  message: string;
  /** 'A' | 'B' | 'C' for per-phase alerts, null/undefined for single-phase or totals. */
  phase?: string | null;
  /** Set to true when the alert is getting promoted to a sustained incident. */
  isIncident?: boolean;
}) {
  const supabase = getSupabaseAdmin();

  const { data: alert, error } = await supabase
    .from("alerts")
    .insert({
      device_id:   data.deviceId,
      type:        data.type,
      value:       data.value,
      threshold:   data.threshold,
      message:     data.message,
      phase:       data.phase ?? null,
      is_incident: data.isIncident ?? false,
    })
    .select()
    .single();

  if (error) throw new Error(`Create alert failed: ${error.message}`);
  return alert;
}

/**
 * Promote an existing transient-spike alert to a sustained incident.
 * Called when a fault persists past the 60-second promotion window.
 */
export async function promoteAlertToIncident(alertId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("alerts")
    .update({ is_incident: true })
    .eq("id", alertId);

  if (error) {
    throw new Error(`promoteAlertToIncident failed: ${error.message}`);
  }
}

/**
 * Get unread alerts for a device (or all devices).
 * select("*") includes all incident time-range fields added in migration 002:
 * phase, is_incident, ended_at, duration_seconds.
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
 * Mark a single alert as read (dismissed by user).
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
