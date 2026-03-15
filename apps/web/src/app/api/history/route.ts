import { NextRequest, NextResponse } from "next/server";
import { getBillingRate, getSupabaseAdmin } from "@energy/database";

export const dynamic = "force-dynamic";

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type HistoryPeriod = "day" | "week" | "month";

type ReadingRow = {
  id: number;
  voltage: number | string | null;
  current_amp: number | string | null;
  power_w: number | string | null;
  energy_kwh: number | string | null;
  recorded_at: string;
};

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function phDateKey(date: Date) {
  const shifted = new Date(date.getTime() + PH_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function phTimeLabel(date: Date) {
  const shifted = new Date(date.getTime() + PH_OFFSET_MS);
  const hour = shifted.getUTCHours();
  const minute = pad(shifted.getUTCMinutes());
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${meridiem}`;
}

function startOfPhDay(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - PH_OFFSET_MS);
}

function startOfPhWeek(dateString: string) {
  const dayStartUtc = startOfPhDay(dateString);
  const localEquivalent = new Date(dayStartUtc.getTime() + PH_OFFSET_MS);
  const dayOfWeek = localEquivalent.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return new Date(dayStartUtc.getTime() - daysSinceMonday * DAY_MS);
}

function startOfPhMonth(dateString: string) {
  const [year, month] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1) - PH_OFFSET_MS);
}

function getRangeBounds(period: HistoryPeriod, dateString: string) {
  if (period === "week") {
    const start = startOfPhWeek(dateString);
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
  }

  if (period === "month") {
    const start = startOfPhMonth(dateString);
    const shifted = new Date(start.getTime() + PH_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const end = new Date(Date.UTC(year, month + 1, 1) - PH_OFFSET_MS);
    return { start, end };
  }

  const start = startOfPhDay(dateString);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function computeSummary(readings: ReadingRow[], ratePhpPerKwh: number) {
  const first = readings[0];
  const last = readings[readings.length - 1];

  const totalKwh = first && last
    ? Math.max(0, toNumber(last.energy_kwh) - toNumber(first.energy_kwh))
    : 0;

  const divisor = Math.max(1, readings.length);
  const averageVoltage = readings.reduce((sum, row) => sum + toNumber(row.voltage), 0) / divisor;
  const averageCurrent = readings.reduce((sum, row) => sum + toNumber(row.current_amp), 0) / divisor;
  const averagePower = readings.reduce((sum, row) => sum + toNumber(row.power_w), 0) / divisor;
  const peakPower = readings.reduce((max, row) => Math.max(max, toNumber(row.power_w)), 0);
  const voltageValues = readings.map((row) => toNumber(row.voltage));
  const minVoltage = voltageValues.length > 0 ? Math.min(...voltageValues) : 0;
  const maxVoltage = voltageValues.length > 0 ? Math.max(...voltageValues) : 0;

  return {
    totalKwh: round(totalKwh, 4),
    estimatedCostPhp: round(totalKwh * ratePhpPerKwh, 2),
    averageVoltage: round(averageVoltage, 2),
    averageCurrent: round(averageCurrent, 3),
    averagePower: round(averagePower, 2),
    peakPower: round(peakPower, 2),
    minVoltage: round(minVoltage, 2),
    maxVoltage: round(maxVoltage, 2),
  };
}

function buildDayChart(readings: ReadingRow[]) {
  return readings.map((row) => ({
    label: phTimeLabel(new Date(row.recorded_at)),
    value: round(toNumber(row.energy_kwh), 4),
    recordedAt: row.recorded_at,
    secondaryValue: round(toNumber(row.power_w), 2),
  }));
}

function buildBucketedChart(readings: ReadingRow[]) {
  const buckets = new Map<string, { firstEnergy: number; lastEnergy: number; latestAt: string }>();

  for (const row of readings) {
    const key = phDateKey(new Date(row.recorded_at));
    const energy = toNumber(row.energy_kwh);
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        firstEnergy: energy,
        lastEnergy: energy,
        latestAt: row.recorded_at,
      });
      continue;
    }

    existing.lastEnergy = energy;
    existing.latestAt = row.recorded_at;
  }

  return Array.from(buckets.entries()).map(([label, bucket]) => ({
    label,
    value: round(Math.max(0, bucket.lastEnergy - bucket.firstEnergy), 4),
    recordedAt: bucket.latestAt,
    secondaryValue: round(bucket.lastEnergy, 4),
  }));
}

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const periodParam = req.nextUrl.searchParams.get("period") ?? "day";
    const dateParam = req.nextUrl.searchParams.get("date") ?? phDateKey(new Date());

    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    if (!["day", "week", "month"].includes(periodParam)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const period = periodParam as HistoryPeriod;
    const { start, end } = getRangeBounds(period, dateParam);
    const supabase = getSupabaseAdmin();

    const [readingsResult, alertsResult, billingRate] = await Promise.all([
      supabase
        .from("power_readings")
        .select("id, voltage, current_amp, power_w, energy_kwh, recorded_at")
        .eq("device_id", deviceId)
        .gte("recorded_at", start.toISOString())
        .lt("recorded_at", end.toISOString())
        .order("recorded_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("alerts")
        .select("id, type, message, value, threshold, created_at, is_read")
        .eq("device_id", deviceId)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),
      getBillingRate(),
    ]);

    if (readingsResult.error) {
      throw new Error(`History readings query failed: ${readingsResult.error.message}`);
    }

    if (alertsResult.error) {
      throw new Error(`History alerts query failed: ${alertsResult.error.message}`);
    }

    const readings = (readingsResult.data ?? []) as ReadingRow[];
    const alerts = alertsResult.data ?? [];
    const ratePhpPerKwh = Number(billingRate?.rate_php_per_kwh ?? 10);
    const summary = computeSummary(readings, ratePhpPerKwh);
    const chartPoints = period === "day"
      ? buildDayChart(readings)
      : buildBucketedChart(readings);

    return NextResponse.json({
      period,
      date: dateParam,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      ratePhpPerKwh,
      chartMetric: period === "day" ? "energy_kwh" : "daily_kwh",
      chartPoints,
      summary,
      alerts,
      sampleCount: readings.length,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/history] Error:", err);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}