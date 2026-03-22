import { getSupabaseAdmin } from "../client";
import type { TelemetryPayload } from "@energy/types";
import { isThreePhasePayload } from "@energy/types";

/**
 * Insert a power reading (supports both single-phase and 3-phase).
 * - Single-phase: uses legacy columns (voltage, current_amp, power_w, energy_kwh)
 * - 3-phase: populates all phase columns + totals, also fills legacy columns for backward compat
 */
export async function insertReading(payload: TelemetryPayload) {
  const supabase = getSupabaseAdmin();

  // Handle 3-phase readings
  if (isThreePhasePayload(payload)) {
    const { phase_a, phase_b, phase_c } = payload.threePhase;

    // Calculate totals
    const totalPower = phase_a.power + phase_b.power + phase_c.power;
    const totalEnergy = phase_a.energy + phase_b.energy + phase_c.energy;

    // Average frequency and power factor (use available values)
    const frequencies = [phase_a.frequency, phase_b.frequency, phase_c.frequency].filter(
      (f): f is number => f !== undefined
    );
    const avgFrequency =
      frequencies.length > 0
        ? frequencies.reduce((a, b) => a + b, 0) / frequencies.length
        : 60;

    const powerFactors = [phase_a.powerFactor, phase_b.powerFactor, phase_c.powerFactor].filter(
      (pf): pf is number => pf !== undefined
    );
    const avgPowerFactor =
      powerFactors.length > 0
        ? powerFactors.reduce((a, b) => a + b, 0) / powerFactors.length
        : 1;

    const { error } = await supabase.from("power_readings").insert({
      device_id: payload.deviceId,
      // Legacy columns (Phase A values + totals for backward compatibility)
      voltage: phase_a.voltage,
      current_amp: phase_a.current,
      power_w: totalPower,
      energy_kwh: totalEnergy,
      frequency: avgFrequency,
      power_factor: avgPowerFactor,
      recorded_at: payload.timestamp,
      // 3-Phase: Per-phase voltage
      voltage_a: phase_a.voltage,
      voltage_b: phase_b.voltage,
      voltage_c: phase_c.voltage,
      // 3-Phase: Per-phase current
      current_a: phase_a.current,
      current_b: phase_b.current,
      current_c: phase_c.current,
      // 3-Phase: Per-phase power
      power_a: phase_a.power,
      power_b: phase_b.power,
      power_c: phase_c.power,
      // 3-Phase: Per-phase energy
      energy_a: phase_a.energy,
      energy_b: phase_b.energy,
      energy_c: phase_c.energy,
      // 3-Phase: Per-phase frequency
      frequency_a: phase_a.frequency ?? null,
      frequency_b: phase_b.frequency ?? null,
      frequency_c: phase_c.frequency ?? null,
      // 3-Phase: Per-phase power factor
      power_factor_a: phase_a.powerFactor ?? null,
      power_factor_b: phase_b.powerFactor ?? null,
      power_factor_c: phase_c.powerFactor ?? null,
      // 3-Phase: Totals
      total_power: totalPower,
      total_energy: totalEnergy,
    });

    if (error) throw new Error(`Insert 3-phase reading failed: ${error.message}`);
    return;
  }

  // Handle single-phase readings (legacy)
  const { reading } = payload;

  if (!reading) {
    throw new Error("Cannot insert reading: reading data is missing");
  }

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
 * Returns all columns including 3-phase data if available.
 */
export async function getLast24hReadings(deviceId: string) {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("power_readings")
    .select("*")
    .eq("device_id", deviceId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(`Fetch 24h readings failed: ${error.message}`);
  return data;
}

/**
 * Get the latest reading for the live metric tiles.
 * Returns all columns including 3-phase data if available.
 */
export async function getLatestReading(deviceId: string) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("power_readings")
    .select("*")
    .eq("device_id", deviceId)
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false }) // tie-breaker: use DB insert order
    .limit(1)
    .single();

  // PGRST116 = "no rows returned" — not a real error, just means no data yet
  if (error && error.code !== "PGRST116") {
    throw new Error(`Fetch latest reading failed: ${error.message}`);
  }
  return data ?? null;
}

/**
 * Get total energy consumption for a given month (for billing).
 * For 3-phase: uses total_energy column
 * For single-phase: uses energy_kwh column
 */
export async function getMonthlyEnergy(deviceId: string, year: number, month: number) {
  const supabase = getSupabaseAdmin();

  const startDate = new Date(year, month - 1, 1).toISOString();
  const endDate = new Date(year, month, 1).toISOString();

  // Try RPC first (in case it gets added later)
  const { data, error } = await supabase.rpc("get_monthly_energy", {
    p_device_id: deviceId,
    p_start: startDate,
    p_end: endDate,
  });

  if (!error && data !== null) {
    return data;
  }

  // Fallback: calculate from readings by getting the very first and very last reading of the month.
  // Using two separate queries completely bypasses Supabase's default 1000 row limit.

  // 1. Get the FIRST reading of the month
  const { data: firstReading, error: firstErr } = await supabase
    .from("power_readings")
    .select("energy_kwh, total_energy")
    .eq("device_id", deviceId)
    .gte("recorded_at", startDate)
    .lt("recorded_at", endDate)
    .order("recorded_at", { ascending: true })
    .limit(1)
    .single();

  if (firstErr || !firstReading) return 0;

  // 2. Get the LAST reading of the month
  const { data: lastReading, error: lastErr } = await supabase
    .from("power_readings")
    .select("energy_kwh, total_energy")
    .eq("device_id", deviceId)
    .gte("recorded_at", startDate)
    .lt("recorded_at", endDate)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single();

  if (lastErr || !lastReading) return 0;

  // Prefer total_energy (3-phase) if available, fallback to energy_kwh (single-phase)
  const firstEnergy = firstReading.total_energy ?? firstReading.energy_kwh ?? 0;
  const lastEnergy = lastReading.total_energy ?? lastReading.energy_kwh ?? 0;

  return Math.max(0, Number(lastEnergy) - Number(firstEnergy));
}
