import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBillingRate, getSupabaseAdmin } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";
import {
  fetchAllPagesDescending,
  monotonicEnergyDelta,
  resolveReading,
  type PhaseReadingFields,
  type ResolvedReading,
} from "../../../lib/energy";

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

type ReadingRow = PhaseReadingFields & {
  id: number;
  energy_kwh: number | string | null;
  recorded_at: string;
};

const READING_COLUMNS =
  "id, voltage, current_amp, power_w, energy_kwh, total_power, voltage_a, voltage_b, voltage_c, current_a, current_b, current_c, recorded_at";

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

type ChartPoint = {
  label: string;
  value: number;
  recordedAt: string;
  secondaryValue: number;
};

function toMetricValue(row: ReadingRow, resolved: ResolvedReading, metric: HistoryMetric) {
  if (metric === "power_w") return resolved.power;
  if (metric === "current_amp") return resolved.current;
  if (metric === "voltage") return resolved.voltage;
  return toNumber(row.energy_kwh);
}

function computeSummary(readings: ReadingRow[], ratePhpPerKwh: number) {
  // Shared energy-delta method (Reports/PDF/History): positive deltas with
  // counter resets ignored — not last − first, which a reset zeroes out.
  const totalKwh = monotonicEnergyDelta(
    readings.map((row) => toNumber(row.energy_kwh))
  );

  // Averages and min/max use only samples where the circuit was energised.
  // Offline / blackout / NULL samples carry no measurement; counting them as 0
  // dragged every average toward zero (e.g. a 29 V "average" on a 230 V supply).
  const live = readings.map(resolveReading).filter((reading) => reading.live);
  const mean = (pick: (reading: ResolvedReading) => number) =>
    live.length > 0 ? live.reduce((sum, reading) => sum + pick(reading), 0) / live.length : 0;

  // reduce, not Math.min(...spread): month windows can exceed the argument limit
  const minVoltage = live.length > 0
    ? live.reduce((min, reading) => Math.min(min, reading.voltage), Infinity)
    : 0;
  const maxVoltage = live.reduce((max, reading) => Math.max(max, reading.voltage), 0);
  const peakPower = live.reduce((max, reading) => Math.max(max, reading.power), 0);

  return {
    totalKwh: round(totalKwh, 4),
    estimatedCostPhp: round(totalKwh * ratePhpPerKwh, 2),
    averageVoltage: round(mean((reading) => reading.voltage), 2),
    averageCurrent: round(mean((reading) => reading.current), 3),
    averagePower: round(mean((reading) => reading.power), 2),
    peakPower: round(peakPower, 2),
    minVoltage: round(minVoltage, 2),
    maxVoltage: round(maxVoltage, 2),
    liveSampleCount: live.length,
  };
}

function buildDayChart(readings: ReadingRow[], metric: HistoryMetric) {
  const points: ChartPoint[] = [];

  for (const row of readings) {
    const resolved = resolveReading(row);
    // Power / voltage / current plot only recorded (live) samples instead of
    // flat-lining offline rows at 0. The energy meter reading is always plotted.
    if (metric !== "energy_kwh" && !resolved.live) continue;

    points.push({
      label: phTimeLabel(new Date(row.recorded_at)),
      value: roundForMetric(toMetricValue(row, resolved, metric), metric),
      recordedAt: row.recorded_at,
      secondaryValue: round(resolved.power, 2),
    });
  }

  return points;
}

function buildBucketedChart(readings: ReadingRow[], metric: HistoryMetric) {
  const buckets = new Map<
    string,
    {
      energies: number[];
      latestAt: string;
      liveCount: number;
      sumPower: number;
      sumCurrent: number;
      sumVoltage: number;
    }
  >();

  for (const row of readings) {
    const key = phDateKey(new Date(row.recorded_at));
    const resolved = resolveReading(row);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        energies: [],
        latestAt: row.recorded_at,
        liveCount: 0,
        sumPower: 0,
        sumCurrent: 0,
        sumVoltage: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.energies.push(toNumber(row.energy_kwh));
    bucket.latestAt = row.recorded_at;
    if (resolved.live) {
      bucket.liveCount += 1;
      bucket.sumPower += resolved.power;
      bucket.sumCurrent += resolved.current;
      bucket.sumVoltage += resolved.voltage;
    }
  }

  // Buckets are day boundaries; each day's energy delta must include the
  // increment between the previous day's last reading and this day's first
  // (the boundary jump), otherwise the daily values don't sum back to the
  // window total.
  let carryEnergy: number | null = null;
  const points: ChartPoint[] = [];
  const orderedBuckets = Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [label, bucket] of orderedBuckets) {
    const series =
      carryEnergy === null ? bucket.energies : [carryEnergy, ...bucket.energies];
    carryEnergy = bucket.energies[bucket.energies.length - 1] ?? carryEnergy;

    // Days with no live samples have nothing to average for power / voltage /
    // current — leave them off the chart rather than plotting a false 0.
    if (metric !== "energy_kwh" && bucket.liveCount === 0) continue;

    const dailyAverage = (sum: number) => sum / Math.max(1, bucket.liveCount);
    points.push({
      // week/month timelines are bucketed by day for readability
      label,
      value: metric === "energy_kwh"
        ? round(monotonicEnergyDelta(series), 4)
        : metric === "power_w"
          ? roundForMetric(dailyAverage(bucket.sumPower), metric)
          : metric === "current_amp"
            ? roundForMetric(dailyAverage(bucket.sumCurrent), metric)
            : roundForMetric(dailyAverage(bucket.sumVoltage), metric),
      recordedAt: bucket.latestAt,
      secondaryValue: round(bucket.energies[bucket.energies.length - 1] ?? 0, 4),
    });
  }

  return points;
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

    // Paginated, newest-first: the unbounded query was silently capped at
    // Supabase's default max-rows (1000), oldest-first, truncating week and
    // month windows. The page cap, if ever hit, drops the oldest data.
    const [readings, alertsResult, billingRate] = await Promise.all([
      fetchAllPagesDescending<ReadingRow>(
        async (from, to) => {
          const { data, error } = await serviceSupabase
            .from("power_readings")
            .select(READING_COLUMNS)
            .eq("device_id", deviceId)
            .eq("customer_id", customerId)
            .gte("recorded_at", start.toISOString())
            .lt("recorded_at", end.toISOString())
            .order("recorded_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to);
          return { data: data as ReadingRow[] | null, error };
        },
        { context: "History readings query failed" }
      ),
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

    if (alertsResult.error) {
      throw new Error(`History alerts query failed: ${alertsResult.error.message}`);
    }

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