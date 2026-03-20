import { getSupabaseAdmin } from "../client";
import type { RelayConfig, RelayState, RelayLog } from "@energy/types";

// ──── Get Relay Configuration ────
export async function getRelayConfig(deviceId: string): Promise<RelayConfig | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("relay_config")
    .select("*")
    .eq("device_id", deviceId)
    .single();

  if (error) {
    console.error("[getRelayConfig] Error:", error);
    return null;
  }

  if (!data) return null;

  // Map snake_case to camelCase
  return {
    id: data.id,
    deviceId: data.device_id,
    relayEnabled: data.relay_enabled,
    autoTripEnabled: data.auto_trip_enabled,
    autoResetEnabled: data.auto_reset_enabled,
    autoResetDelaySeconds: data.auto_reset_delay_seconds,
    tripOnOvervoltage: data.trip_on_overvoltage,
    tripOnUndervoltage: data.trip_on_undervoltage,
    tripOnOvercurrent: data.trip_on_overcurrent,
    tripOnBlackout: data.trip_on_blackout,
    manualControlAllowed: data.manual_control_allowed,
    updatedAt: data.updated_at,
  } as RelayConfig;
}

// ──── Update Relay Configuration ────
export async function updateRelayConfig(config: RelayConfig): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("relay_config")
    .upsert({
      device_id: config.deviceId,
      relay_enabled: config.relayEnabled,
      auto_trip_enabled: config.autoTripEnabled,
      auto_reset_enabled: config.autoResetEnabled,
      auto_reset_delay_seconds: config.autoResetDelaySeconds,
      trip_on_overvoltage: config.tripOnOvervoltage,
      trip_on_undervoltage: config.tripOnUndervoltage,
      trip_on_overcurrent: config.tripOnOvercurrent,
      trip_on_blackout: config.tripOnBlackout,
      manual_control_allowed: config.manualControlAllowed,
      updated_at: new Date().toISOString(),
    })
    .eq("device_id", config.deviceId);

  if (error) {
    console.error("[updateRelayConfig] Error:", error);
    return false;
  }

  return true;
}

// ──── Get Relay State ────
export async function getRelayState(deviceId: string): Promise<RelayState | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("relay_state")
    .select("*")
    .eq("device_id", deviceId)
    .single();

  if (error) {
    console.error("[getRelayState] Error:", error);
    return null;
  }

  if (!data) return null;

  // Map snake_case to camelCase
  return {
    id: data.id,
    deviceId: data.device_id,
    isTripped: data.is_tripped,
    lastTripAt: data.last_trip_at,
    lastResetAt: data.last_reset_at,
    tripReason: data.trip_reason,
    tripAlertId: data.trip_alert_id,
    updatedAt: data.updated_at,
  } as RelayState;
}

// ──── Update Relay State (Trip/Reset) ────
export async function updateRelayState(
  deviceId: string,
  isTripped: boolean,
  reason?: string,
  alertId?: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const updateData: any = {
    device_id: deviceId,
    is_tripped: isTripped,
    updated_at: now,
  };

  if (isTripped) {
    updateData.last_trip_at = now;
    updateData.trip_reason = reason;
    updateData.trip_alert_id = alertId;
  } else {
    updateData.last_reset_at = now;
  }

  const { error } = await supabase
    .from("relay_state")
    .upsert(updateData)
    .eq("device_id", deviceId);

  if (error) {
    console.error("[updateRelayState] Error:", error);
    return false;
  }

  return true;
}

// ──── Log Relay Action ────
export async function logRelayAction(
  deviceId: string,
  action: string,
  triggerType?: string,
  triggerValue?: number,
  thresholdValue?: number,
  alertId?: string,
  initiatedBy: string = "SYSTEM",
  notes?: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("relay_logs").insert({
    device_id: deviceId,
    action,
    trigger_type: triggerType,
    trigger_value: triggerValue,
    threshold_value: thresholdValue,
    alert_id: alertId,
    initiated_by: initiatedBy,
    notes,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[logRelayAction] Error:", error);
    return false;
  }

  return true;
}

// ──── Get Relay Logs ────
export async function getRelayLogs(
  deviceId: string,
  limit: number = 50
): Promise<RelayLog[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("relay_logs")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[getRelayLogs] Error:", error);
    return [];
  }

  if (!data) return [];

  // Map snake_case to camelCase
  return data.map((log: any) => ({
    id: log.id,
    deviceId: log.device_id,
    action: log.action,
    triggerType: log.trigger_type,
    triggerValue: log.trigger_value,
    thresholdValue: log.threshold_value,
    alertId: log.alert_id,
    initiatedBy: log.initiated_by,
    notes: log.notes,
    createdAt: log.created_at,
  })) as RelayLog[];
}
