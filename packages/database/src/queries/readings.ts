import { getSupabaseAdmin } from "../client";
import type { TelemetryPayload } from "@energy/types";

/**
 * Insert a single-phase power reading (append-only).
 */
export async function insertReading(payload: TelemetryPayload) {
  const supabase = getSupabaseAdmin();
  const { reading } = payload;

  const { error } = await supabase.from("power_readings").insert({
    device_id: payload.deviceId,
    voltage: reading.voltage,
    current_amp: reading.current,
    power_w: reading.power,
    energy_kwh: reading.energy,
    frequency: reading.frequency,
    power_factor: reading.powerFactor,
    recorded_at: payload.timestamp,
  });

  if (error) throw new Error(`Insert reading failed: ${error.message}`);
}

/**
 * Get last 24 hours of readings for the hero chart.
 */
export async function getLast24hReadings(deviceId: string) {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("power_readings")
    .select("*")
    .eq("device_id", deviceId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true });

  if (error) throw new Error(`Fetch 24h readings failed: ${error.message}`);
  return data;
}

/**
 * Get the latest reading for the live metric tiles.
 */
export async function getLatestReading(deviceId: string) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("power_readings")
    .select("*")
    .eq("device_id", deviceId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single();

  if (error) throw new Error(`Fetch latest reading failed: ${error.message}`);
  return data;
}

/**
 * Get total energy consumption for a given month (for billing).
 * Uses the difference between max and min energy_kwh readings.
 */
export async function getMonthlyEnergy(deviceId: string, year: number, month: number) {
  const supabase = getSupabaseAdmin();

  const startDate = new Date(year, month - 1, 1).toISOString();
  const endDate = new Date(year, month, 1).toISOString();

  const { data, error } = await supabase
    .rpc("get_monthly_energy", {
      p_device_id: deviceId,
      p_start: startDate,
      p_end: endDate,
    });

  if (error) {
    // Fallback: calculate from readings
    const { data: readings, error: readErr } = await supabase
      .from("power_readings")
      .select("energy_kwh")
      .eq("device_id", deviceId)
      .gte("recorded_at", startDate)
      .lt("recorded_at", endDate)
      .order("recorded_at", { ascending: true });

    if (readErr || !readings || readings.length < 2) return 0;

    const first = readings[0].energy_kwh;
    const last = readings[readings.length - 1].energy_kwh;
    return last - first;
  }

  return data;
}
