import { getSupabaseAdmin } from "../client";

export interface BlackoutEvent {
  id: string;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  alertId: string | null;
  createdAt: string;
}

export interface DeviceBlackoutState {
  deviceId: string;
  inBlackout: boolean;
  currentBlackoutId: string | null;
  blackoutStartedAt: string | null;
  updatedAt: string;
}

/**
 * Get current blackout state for a device
 */
export async function getDeviceBlackoutState(
  deviceId: string
): Promise<DeviceBlackoutState | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("device_blackout_state")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    console.error("[getDeviceBlackoutState] Error:", error);
    return null;
  }

  if (!data) return null;

  return {
    deviceId: data.device_id,
    inBlackout: data.in_blackout,
    currentBlackoutId: data.current_blackout_id,
    blackoutStartedAt: data.blackout_started_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Start a new blackout event
 * Returns the created blackout event ID
 */
export async function startBlackoutEvent(
  deviceId: string,
  alertId?: string
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // 1. Create new blackout event
  const { data: event, error: eventError } = await supabase
    .from("blackout_events")
    .insert({
      device_id: deviceId,
      started_at: now,
      alert_id: alertId,
    })
    .select()
    .single();

  if (eventError) {
    console.error("[startBlackoutEvent] Insert error:", eventError);
    return null;
  }

  // 2. Update device blackout state
  const { error: stateError } = await supabase
    .from("device_blackout_state")
    .upsert({
      device_id: deviceId,
      in_blackout: true,
      current_blackout_id: event.id,
      blackout_started_at: now,
      updated_at: now,
    });

  if (stateError) {
    console.error("[startBlackoutEvent] State update error:", stateError);
  }

  return event.id;
}

/**
 * End an ongoing blackout event
 * Calculates duration and updates the event
 */
export async function endBlackoutEvent(deviceId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // 1. Get current blackout state
  const state = await getDeviceBlackoutState(deviceId);
  if (!state || !state.inBlackout || !state.currentBlackoutId) {
    return false; // No active blackout to end
  }

  // 2. Calculate duration
  const startedAt = new Date(state.blackoutStartedAt!);
  const endedAt = new Date(now);
  const durationSeconds = Math.floor(
    (endedAt.getTime() - startedAt.getTime()) / 1000
  );

  // 3. Update blackout event
  const { error: eventError } = await supabase
    .from("blackout_events")
    .update({
      ended_at: now,
      duration_seconds: durationSeconds,
    })
    .eq("id", state.currentBlackoutId);

  if (eventError) {
    console.error("[endBlackoutEvent] Event update error:", eventError);
    return false;
  }

  // 4. Clear device blackout state
  const { error: stateError } = await supabase
    .from("device_blackout_state")
    .update({
      in_blackout: false,
      current_blackout_id: null,
      blackout_started_at: null,
      updated_at: now,
    })
    .eq("device_id", deviceId);

  if (stateError) {
    console.error("[endBlackoutEvent] State clear error:", stateError);
  }

  return true;
}

/**
 * Get blackout events for a device within a time range
 */
export async function getBlackoutEvents(
  deviceId: string,
  startDate: string,
  endDate: string
): Promise<BlackoutEvent[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("blackout_events")
    .select("*")
    .eq("device_id", deviceId)
    .gte("started_at", startDate)
    .lt("started_at", endDate)
    .order("started_at", { ascending: false });

  if (error) {
    console.error("[getBlackoutEvents] Query error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    deviceId: row.device_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    alertId: row.alert_id,
    createdAt: row.created_at,
  }));
}

/**
 * Get blackout statistics for a time period
 */
export async function getBlackoutStats(
  deviceId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalEvents: number;
  completedEvents: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  longestDurationSeconds: number;
  shortestDurationSeconds: number;
}> {
  const events = await getBlackoutEvents(deviceId, startDate, endDate);

  const completedEvents = events.filter((e) => e.endedAt !== null);
  const durations = completedEvents
    .map((e) => e.durationSeconds ?? 0)
    .filter((d) => d > 0);

  const totalDurationSeconds = durations.reduce((sum, d) => sum + d, 0);
  const averageDurationSeconds =
    durations.length > 0
      ? Math.round(totalDurationSeconds / durations.length)
      : 0;
  const longestDurationSeconds =
    durations.length > 0 ? Math.max(...durations) : 0;
  const shortestDurationSeconds =
    durations.length > 0 ? Math.min(...durations) : 0;

  return {
    totalEvents: events.length,
    completedEvents: completedEvents.length,
    totalDurationSeconds,
    averageDurationSeconds,
    longestDurationSeconds,
    shortestDurationSeconds,
  };
}
