import { getSupabaseAdmin } from "../client";
import type { AlertType } from "@energy/types";

// ──── Types ─────────────────────────────────────────────────────────────

export interface AlertState {
  id: string;
  deviceId: string;
  alertType: string;
  /** '' for non-phase alerts (single-phase, PZEM_OFFLINE, HIGH_POWER). 'A'|'B'|'C' for 3-phase. */
  phase: string;
  isActive: boolean;
  /** true = fault cleared, in 30s debounce window before closing */
  inRecovery: boolean;
  currentAlertId: string | null;
  startedAt: string | null;
  recoveryStartedAt: string | null;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): AlertState {
  return {
    id:                 row.id as string,
    deviceId:           row.device_id as string,
    alertType:          row.alert_type as string,
    phase:              row.phase as string,
    isActive:           row.is_active as boolean,
    inRecovery:         row.in_recovery as boolean,
    currentAlertId:     row.current_alert_id as string | null,
    startedAt:          row.started_at as string | null,
    recoveryStartedAt:  row.recovery_started_at as string | null,
    updatedAt:          row.updated_at as string,
  };
}

// ──── Read ───────────────────────────────────────────────────────────────

/**
 * Get the current incident state for a specific (device, alertType, phase) key.
 * Use phase = '' (default) for non-phase-specific alert types.
 */
export async function getAlertState(
  deviceId: string,
  alertType: AlertType,
  phase = ""
): Promise<AlertState | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("device_alert_state")
    .select("*")
    .eq("device_id", deviceId)
    .eq("alert_type", alertType)
    .eq("phase", phase)
    .maybeSingle();

  if (error) {
    console.error("[getAlertState] Error:", error);
    return null;
  }

  return data ? mapRow(data) : null;
}

/**
 * Get ALL currently-active incident states for a device in one query.
 * Returns a Map keyed by `${alertType}:${phase}` for O(1) lookups inside
 * bulk threshold checks.
 */
export async function getAllActiveAlertStates(
  deviceId: string
): Promise<Map<string, AlertState>> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("device_alert_state")
    .select("*")
    .eq("device_id", deviceId)
    .eq("is_active", true);

  if (error) {
    console.error("[getAllActiveAlertStates] Error:", error);
    return new Map();
  }

  const map = new Map<string, AlertState>();
  for (const row of data ?? []) {
    map.set(`${row.alert_type}:${row.phase}`, mapRow(row));
  }
  return map;
}

// ──── Write ──────────────────────────────────────────────────────────────

/**
 * Activate a new incident in the state table, linked to the alert row
 * that was created at the start of the fault (at the 60s promotion point).
 */
export async function startAlertIncident(
  deviceId: string,
  alertType: AlertType,
  phase = "",
  alertId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("device_alert_state")
    .upsert(
      {
        device_id:           deviceId,
        alert_type:          alertType,
        phase,
        is_active:           true,
        in_recovery:         false,
        current_alert_id:    alertId,
        started_at:          now,
        recovery_started_at: null,
        updated_at:          now,
      },
      { onConflict: "device_id,alert_type,phase" }
    );

  if (error) {
    throw new Error(`[startAlertIncident] ${error.message}`);
  }

  console.log(
    `[AlertState] Incident started: ${alertType}${phase ? `/Phase${phase}` : ""} → device ${deviceId}`
  );
}

/**
 * Mark an active incident as entering recovery mode.
 * Called on the first good reading after a sustained fault.
 * The 30s debounce is enforced in-memory (pendingRecovery Map in ingest route).
 */
export async function setAlertRecovery(
  deviceId: string,
  alertType: AlertType,
  phase = ""
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("device_alert_state")
    .update({ in_recovery: true, recovery_started_at: now, updated_at: now })
    .eq("device_id", deviceId)
    .eq("alert_type", alertType)
    .eq("phase", phase)
    .eq("is_active", true);

  if (error) {
    console.error("[setAlertRecovery] Error:", error);
  }
}

/**
 * Cancel recovery mode — fault reoccurred during the 30s debounce window.
 */
export async function cancelAlertRecovery(
  deviceId: string,
  alertType: AlertType,
  phase = ""
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("device_alert_state")
    .update({ in_recovery: false, recovery_started_at: null, updated_at: now })
    .eq("device_id", deviceId)
    .eq("alert_type", alertType)
    .eq("phase", phase)
    .eq("is_active", true);

  if (error) {
    console.error("[cancelAlertRecovery] Error:", error);
  }
}

/**
 * Close an active incident:
 *  1. Stamps ended_at + duration_seconds on the linked alert row.
 *  2. Deactivates the device_alert_state tracker row.
 */
export async function endAlertIncident(
  deviceId: string,
  alertType: AlertType,
  phase = ""
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const state = await getAlertState(deviceId, alertType, phase);
  if (!state?.isActive || !state.currentAlertId || !state.startedAt) {
    console.warn(
      `[endAlertIncident] No active incident for ${deviceId}:${alertType}:${phase}`
    );
    return;
  }

  const durationSeconds = Math.floor(
    (new Date(now).getTime() - new Date(state.startedAt).getTime()) / 1000
  );

  // Stamp the alert row
  const { error: alertErr } = await supabase
    .from("alerts")
    .update({ ended_at: now, duration_seconds: durationSeconds })
    .eq("id", state.currentAlertId);

  if (alertErr) {
    throw new Error(`[endAlertIncident] alert update failed: ${alertErr.message}`);
  }

  // Deactivate state tracker
  const { error: stateErr } = await supabase
    .from("device_alert_state")
    .update({
      is_active:           false,
      in_recovery:         false,
      current_alert_id:    null,
      recovery_started_at: null,
      updated_at:          now,
    })
    .eq("device_id", deviceId)
    .eq("alert_type", alertType)
    .eq("phase", phase);

  if (stateErr) {
    throw new Error(`[endAlertIncident] state update failed: ${stateErr.message}`);
  }

  console.log(
    `[AlertState] Incident closed: ${alertType}${phase ? `/Phase${phase}` : ""} — ${durationSeconds}s`
  );
}
