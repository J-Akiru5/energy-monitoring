import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBillingRate, getSupabaseAdmin } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type HistoryPeriod = "day" | "week" | "month";
type HistoryMetric = "energy_kwh" | "power_w" | "current_amp" | "voltage";

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

function roundForMetric(value: number, metric: HistoryMetric) {
  if (metric === "energy_kwh") return round(value, 4);
  if (metric === "current_amp") return round(value, 3);
  return round(value, 2);
}

function toMetricValue(row: ReadingRow, metric: HistoryMetric) {
  if (metric === "power_w") return toNumber(row.power_w);
  if (metric === "current_amp") return toNumber(row.current_amp);
  if (metric === "voltage") return toNumber(row.voltage);
  return toNumber(row.energy_kwh);
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

function buildDayChart(readings: ReadingRow[], metric: HistoryMetric) {
  return readings.map((row) => ({
    label: phTimeLabel(new Date(row.recorded_at)),
    value: roundForMetric(toMetricValue(row, metric), metric),
    recordedAt: row.recorded_at,
    secondaryValue: round(toNumber(row.power_w), 2),
  }));
}

function buildBucketedChart(readings: ReadingRow[], metric: HistoryMetric) {
  const buckets = new Map<
    string,
    {
      firstEnergy: number;
      lastEnergy: number;
      latestAt: string;
      sampleCount: number;
      sumPower: number;
      sumCurrent: number;
      sumVoltage: number;
    }
  >();

  for (const row of readings) {
    const key = phDateKey(new Date(row.recorded_at));
    const energy = toNumber(row.energy_kwh);
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        firstEnergy: energy,
        lastEnergy: energy,
        latestAt: row.recorded_at,
        sampleCount: 1,
        sumPower: toNumber(row.power_w),
        sumCurrent: toNumber(row.current_amp),
        sumVoltage: toNumber(row.voltage),
      });
      continue;
    }

    existing.lastEnergy = energy;
    existing.latestAt = row.recorded_at;
    existing.sampleCount += 1;
    existing.sumPower += toNumber(row.power_w);
    existing.sumCurrent += toNumber(row.current_amp);
    existing.sumVoltage += toNumber(row.voltage);
  }

  return Array.from(buckets.entries()).map(([label, bucket]) => ({
    // week/month timelines are bucketed by day for readability
    label,
    value: metric === "energy_kwh"
      ? round(Math.max(0, bucket.lastEnergy - bucket.firstEnergy), 4)
      : metric === "power_w"
        ? roundForMetric(bucket.sumPower / Math.max(1, bucket.sampleCount), metric)
        : metric === "current_amp"
          ? roundForMetric(bucket.sumCurrent / Math.max(1, bucket.sampleCount), metric)
          : roundForMetric(bucket.sumVoltage / Math.max(1, bucket.sampleCount), metric),
    recordedAt: bucket.latestAt,
    secondaryValue: round(bucket.lastEnergy, 4),
  }));
}

/**
 * GET /api/history?deviceId=<id>&period=day&date=2026-09-10&metric=energy_kwh
 * Returns chart data + summary for the history view.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() resolves which customer the caller is authorized for —
 * that customerId is then passed down into the query functions, which
 * explicitly filter power_readings and alerts by it. This is the actual
 * isolation boundary: the queries use the service-role client (bypasses
 * RLS), so scoping happens here, not at the database layer.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const periodParam = req.nextUrl.searchParams.get("period") ?? "day";
    const dateParam = req.nextUrl.searchParams.get("date") ?? phDateKey(new Date());
    const metricParam = req.nextUrl.searchParams.get("metric") ?? "energy_kwh";

    if (!deviceId) {
      return noStoreJson({ error: "Missing deviceId" }, 400);
    }

    if (!["day", "week", "month"].includes(periodParam)) {
      return noStoreJson({ error: "Invalid period" }, 400);
    }

    if (!["energy_kwh", "power_w", "current_amp", "voltage"].includes(metricParam)) {
      return noStoreJson({ error: "Invalid metric" }, 400);
    }

    // ── Authenticate the caller ───────────────────────────────
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ error: "Not authenticated" }, 401);
    }

    // ── Resolve which customer this caller is authorized for ──
    let customerId: string;
    try {
      const access = await resolveAccess(user.id, "view_energy");
      customerId = access.customerId;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    const period = periodParam as HistoryPeriod;
    const metric = metricParam as HistoryMetric;
    const { start, end } = getRangeBounds(period, dateParam);
    const serviceSupabase = getSupabaseAdmin();

    const [readingsResult, alertsResult, billingRate] = await Promise.all([
      serviceSupabase
        .from("power_readings")
        .select("id, voltage, current_amp, power_w, energy_kwh, recorded_at")
        .eq("device_id", deviceId)
        .eq("customer_id", customerId)
        .gte("recorded_at", start.toISOString())
        .lt("recorded_at", end.toISOString())
        .order("recorded_at", { ascending: true })
        .order("id", { ascending: true }),
      serviceSupabase
        .from("alerts")
        .select("id, type, message, value, threshold, created_at, is_read")
        .eq("device_id", deviceId)
        .eq("customer_id", customerId)
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
      ? buildDayChart(readings, metric)
      : buildBucketedChart(readings, metric);

    return noStoreJson({
      period,
      date: dateParam,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      ratePhpPerKwh,
      chartMetric: metric,
      chartPoints,
      summary,
      alerts,
      sampleCount: readings.length,
    });
  } catch (err) {
    console.error("[/api/history] Error:", err);
    return noStoreJson({ error: "Failed to fetch history" }, 500);
  }
}