export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@energy/database";

const DAY_MS = 24 * 60 * 60 * 1000;

type Phase = "a" | "b" | "c" | "total";

function boolParam(value: string | null, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function getWindow(searchParams: URLSearchParams): { fromIso: string; toIso: string } {
  const preset = (searchParams.get("preset") ?? "current_month").toLowerCase();
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (from && to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to))) {
    return { fromIso: new Date(from).toISOString(), toIso: new Date(to).toISOString() };
  }

  const now = new Date();
  if (preset === "today") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }

  if (preset === "7d") {
    return { fromIso: new Date(now.getTime() - 7 * DAY_MS).toISOString(), toIso: now.toISOString() };
  }

  if (preset === "30d") {
    return { fromIso: new Date(now.getTime() - 30 * DAY_MS).toISOString(), toIso: now.toISOString() };
  }

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return { fromIso: monthStart.toISOString(), toIso: now.toISOString() };
}

function getPhase(searchParams: URLSearchParams): Phase {
  const raw = (searchParams.get("phase") ?? "total").toLowerCase();
  if (raw === "a" || raw === "b" || raw === "c" || raw === "total") return raw;
  return "total";
}

function getPhaseValues(row: Record<string, unknown>, phase: Phase) {
  const voltageA = Number(row.voltage_a ?? 0);
  const voltageB = Number(row.voltage_b ?? 0);
  const voltageC = Number(row.voltage_c ?? 0);
  const currentA = Number(row.current_a ?? row.current_amp ?? 0);
  const currentB = Number(row.current_b ?? 0);
  const currentC = Number(row.current_c ?? 0);
  const powerA = Number(row.power_a ?? row.power_w ?? 0);
  const powerB = Number(row.power_b ?? 0);
  const powerC = Number(row.power_c ?? 0);
  const energyA = Number(row.energy_a ?? row.energy_kwh ?? 0);
  const energyB = Number(row.energy_b ?? 0);
  const energyC = Number(row.energy_c ?? 0);
  const freqA = Number(row.frequency_a ?? row.frequency ?? 0);
  const freqB = Number(row.frequency_b ?? row.frequency ?? 0);
  const freqC = Number(row.frequency_c ?? row.frequency ?? 0);
  const pfA = Number(row.power_factor_a ?? row.power_factor ?? 0);
  const pfB = Number(row.power_factor_b ?? row.power_factor ?? 0);
  const pfC = Number(row.power_factor_c ?? row.power_factor ?? 0);

  if (phase === "a") {
    return {
      voltage: voltageA || Number(row.voltage ?? 0),
      current: currentA,
      power: powerA,
      energy: energyA,
      frequency: freqA,
      powerFactor: pfA,
    };
  }

  if (phase === "b") {
    return {
      voltage: voltageB,
      current: currentB,
      power: powerB,
      energy: energyB,
      frequency: freqB,
      powerFactor: pfB,
    };
  }

  if (phase === "c") {
    return {
      voltage: voltageC,
      current: currentC,
      power: powerC,
      energy: energyC,
      frequency: freqC,
      powerFactor: pfC,
    };
  }

  const has3P = row.voltage_a != null || row.voltage_b != null || row.voltage_c != null;
  const totalVoltage = has3P
    ? ([voltageA, voltageB, voltageC].filter((v) => v > 0).reduce((s, v) => s + v, 0) /
      Math.max(1, [voltageA, voltageB, voltageC].filter((v) => v > 0).length))
    : Number(row.voltage ?? 0);

  return {
    voltage: Number.isFinite(totalVoltage) ? totalVoltage : 0,
    current: currentA + currentB + currentC || Number(row.current_amp ?? 0),
    power: Number(row.total_power ?? row.power_w ?? 0),
    energy: Number(row.total_energy ?? row.energy_kwh ?? 0),
    frequency: (freqA + freqB + freqC) / 3 || Number(row.frequency ?? 0),
    powerFactor: (pfA + pfB + pfC) / 3 || Number(row.power_factor ?? 0),
  };
}

function isBlackoutRow(row: Record<string, unknown>, phase: Phase): boolean {
  const va = Number(row.voltage_a ?? 0);
  const vb = Number(row.voltage_b ?? 0);
  const vc = Number(row.voltage_c ?? 0);
  const has3P = row.voltage_a != null || row.voltage_b != null || row.voltage_c != null;

  if (phase === "total") {
    if (has3P) return va <= 0 && vb <= 0 && vc <= 0;
    return Number(row.voltage ?? 0) <= 0;
  }
  if (phase === "a") return (has3P ? va : Number(row.voltage ?? 0)) <= 0;
  if (phase === "b") return vb <= 0;
  return vc <= 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");
    const phase = getPhase(searchParams);
    const includeBlackout = boolParam(searchParams.get("includeBlackout"), true);
    const alertOnly = boolParam(searchParams.get("alertOnly"), false);
    const { fromIso, toIso } = getWindow(searchParams);

    const client = getSupabaseAdmin();

    let query = client
      .from("power_readings")
      .select(
        "id, recorded_at, voltage, current_amp, power_w, energy_kwh, frequency, power_factor, voltage_a, voltage_b, voltage_c, current_a, current_b, current_c, power_a, power_b, power_c, energy_a, energy_b, energy_c, frequency_a, frequency_b, frequency_c, power_factor_a, power_factor_b, power_factor_c, total_power, total_energy"
      )
      .order("recorded_at", { ascending: true });

    if (deviceId) {
      query = query.eq("device_id", deviceId);
    }

    query = query.gte("recorded_at", fromIso).lte("recorded_at", toIso);

    // Limit to 2000 rows max to prevent overload
    query = query.limit(2000);

    const { data, error } = await query;
    if (error) throw error;

    let alertWindows: Array<{ start: number; end: number }> = [];
    if (alertOnly) {
      let alertsQuery = client
        .from("alerts")
        .select("created_at, ended_at")
        .lte("created_at", toIso)
        .or(`ended_at.gte.${fromIso},ended_at.is.null`)
        .order("created_at", { ascending: true });

      if (deviceId) {
        alertsQuery = alertsQuery.eq("device_id", deviceId);
      }

      const { data: alerts, error: alertError } = await alertsQuery;
      if (alertError) throw alertError;

      alertWindows = (alerts ?? []).map((item) => ({
        start: new Date(item.created_at).getTime(),
        end: new Date(item.ended_at ?? toIso).getTime(),
      }));
    }

    const readings = (data ?? [])
      .filter((row) => {
        if (!includeBlackout && isBlackoutRow(row as Record<string, unknown>, phase)) {
          return false;
        }

        if (alertOnly) {
          const ts = new Date(String(row.recorded_at)).getTime();
          return alertWindows.some((range) => ts >= range.start && ts <= range.end);
        }

        return true;
      })
      .map((row) => {
        const values = getPhaseValues(row as Record<string, unknown>, phase);
        return {
          voltage: values.voltage,
          current_amp: values.current,
          power_w: values.power,
          energy_kwh: values.energy,
          frequency: values.frequency,
          power_factor: values.powerFactor,
          recorded_at: row.recorded_at,
        };
      });

    return NextResponse.json({
      readings,
      meta: {
        from: fromIso,
        to: toIso,
        phase,
        includeBlackout,
        alertOnly,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
