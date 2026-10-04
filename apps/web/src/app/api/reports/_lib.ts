import { getBillingRate, getSupabaseAdmin } from "@energy/database";
import {
  deltaWithinWindow,
  fetchAllPagesDescending,
  monotonicEnergyDelta,
} from "../../../lib/energy";
import {
  phDateKey,
  startOfPhDay,
  endOfPhDay,
  startOfPhMonth,
  phDayOfMonth,
} from "../../../lib/phTime";

type MonthHistoryItem = {
  period: string;
  totalKwh: number;
};

export type ConsumptionSummary = {
  generatedAt: string;
  deviceId: string;
  ratePhpPerKwh: number;
  filters: {
    preset: "today" | "7d" | "30d" | "current_month" | "custom";
    fromIso: string;
    toIso: string;
    phase: "a" | "b" | "c" | "total";
    metric: "kwh" | "cost" | "power";
    alertOnly: boolean;
    includeBlackout: boolean;
  };
  current: {
    dayKwh: number;
    weekKwh: number;
    monthKwh: number;
    monthLabel: string;
    dayEstimatedPhp: number;
    weekEstimatedPhp: number;
    monthEstimatedPhp: number;
  };
  averages: {
    dayKwh: number;
    weekKwh: number;
    monthKwh: number;
    dayEstimatedPhp: number;
    weekEstimatedPhp: number;
    monthEstimatedPhp: number;
  };
  powerStats: {
    dayAvgW: number;
    weekAvgW: number;
    monthAvgW: number;
    currentW: number;
  };
  monthlyHistory: MonthHistoryItem[];
  selectedSeries: Array<{
    period: string;
    value: number;
    unit: string;
  }>;
};

type ReportPreset = "today" | "7d" | "30d" | "current_month" | "custom";
type ReportPhase = "a" | "b" | "c" | "total";
type ReportMetric = "kwh" | "cost" | "power";

type ReportFilters = {
  preset: ReportPreset;
  fromIso: string;
  toIso: string;
  phase: ReportPhase;
  metric: ReportMetric;
  alertOnly: boolean;
  includeBlackout: boolean;
};

type ReadingRow = {
  id: number;
  recorded_at: string;
  voltage: number | null;
  power_w: number | null;
  energy_kwh: number | null;
  total_power: number | null;
  total_energy: number | null;
  voltage_a: number | null;
  voltage_b: number | null;
  voltage_c: number | null;
  current_amp: number | null;
  current_a: number | null;
  current_b: number | null;
  current_c: number | null;
  power_a: number | null;
  power_b: number | null;
  power_c: number | null;
  energy_a: number | null;
  energy_b: number | null;
  energy_c: number | null;
  frequency: number | null;
  frequency_a: number | null;
  frequency_b: number | null;
  frequency_c: number | null;
  power_factor: number | null;
  power_factor_a: number | null;
  power_factor_b: number | null;
  power_factor_c: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function isValidDate(value: string | null): value is string {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function boolParam(value: string | null, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
}

/**
 * Parse the reports query string. Every preset date is a PH (UTC+8)
 * calendar date: "today" is the PH day, "current_month" starts at 00:00 PH
 * on the 1st, and custom ranges carry explicit +08:00 bounds from the page.
 *
 * @param now  Injectable clock for tests; defaults to the real time.
 */
export function parseReportFilters(
  searchParams: URLSearchParams,
  now: Date = new Date()
): ReportFilters {
  const presetRaw = (searchParams.get("preset") ?? "current_month").toLowerCase();
  const preset: ReportPreset =
    presetRaw === "today" ||
      presetRaw === "7d" ||
      presetRaw === "30d" ||
      presetRaw === "custom" ||
      presetRaw === "current_month"
      ? presetRaw
      : "current_month";

  const phaseRaw = (searchParams.get("phase") ?? "total").toLowerCase();
  const phase: ReportPhase =
    phaseRaw === "a" || phaseRaw === "b" || phaseRaw === "c" || phaseRaw === "total" ? phaseRaw : "total";

  const metricRaw = (searchParams.get("metric") ?? "kwh").toLowerCase();
  const metric: ReportMetric =
    metricRaw === "kwh" || metricRaw === "cost" || metricRaw === "power" ? metricRaw : "kwh";

  let fromDate: Date;
  let toDate: Date;

  if (preset === "custom" && isValidDate(searchParams.get("from")) && isValidDate(searchParams.get("to"))) {
    fromDate = new Date(searchParams.get("from") as string);
    toDate = new Date(searchParams.get("to") as string);
  } else if (preset === "today") {
    fromDate = startOfPhDay(phDateKey(now));
    toDate = endOfPhDay(phDateKey(now));
  } else if (preset === "7d") {
    toDate = now;
    fromDate = new Date(now.getTime() - 7 * DAY_MS);
  } else if (preset === "30d") {
    toDate = now;
    fromDate = new Date(now.getTime() - 30 * DAY_MS);
  } else {
    // current_month default: the PH calendar month containing "now".
    fromDate = startOfPhMonth(now);
    toDate = now;
  }

  if (fromDate.getTime() > toDate.getTime()) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  return {
    preset,
    fromIso: fromDate.toISOString(),
    toIso: toDate.toISOString(),
    phase,
    metric,
    alertOnly: boolParam(searchParams.get("alertOnly"), false),
    includeBlackout: boolParam(searchParams.get("includeBlackout"), true),
  };
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** PH calendar month key (YYYY-MM) for an instant. */
function phMonthLabel(ts: number): string {
  return phDateKey(ts).slice(0, 7);
}

function rowEnergyByPhase(row: ReadingRow, phase: ReportPhase): number {
  if (phase === "a") return Number(row.energy_a ?? row.energy_kwh ?? 0);
  if (phase === "b") return Number(row.energy_b ?? 0);
  if (phase === "c") return Number(row.energy_c ?? 0);
  return Number(row.total_energy ?? row.energy_kwh ?? 0);
}

function rowPowerByPhase(row: ReadingRow, phase: ReportPhase): number {
  if (phase === "a") return Number(row.power_a ?? row.power_w ?? 0);
  if (phase === "b") return Number(row.power_b ?? 0);
  if (phase === "c") return Number(row.power_c ?? 0);
  return Number(row.total_power ?? row.power_w ?? 0);
}

function rowVoltageByPhase(row: ReadingRow, phase: ReportPhase): number {
  if (phase === "a") return Number(row.voltage_a ?? row.voltage ?? 0);
  if (phase === "b") return Number(row.voltage_b ?? 0);
  if (phase === "c") return Number(row.voltage_c ?? 0);
  const va = Number(row.voltage_a ?? 0);
  const vb = Number(row.voltage_b ?? 0);
  const vc = Number(row.voltage_c ?? 0);
  if (va !== 0 || vb !== 0 || vc !== 0) {
    return Math.max(va, vb, vc);
  }
  return Number(row.voltage ?? 0);
}

function isBlackoutReading(row: ReadingRow, phase: ReportPhase): boolean {
  if (phase === "total") {
    const va = Number(row.voltage_a ?? 0);
    const vb = Number(row.voltage_b ?? 0);
    const vc = Number(row.voltage_c ?? 0);
    if (row.voltage_a != null || row.voltage_b != null || row.voltage_c != null) {
      return va <= 0 && vb <= 0 && vc <= 0;
    }
    return Number(row.voltage ?? 0) <= 0;
  }
  return rowVoltageByPhase(row, phase) <= 0;
}

function averagePowerSince(rows: Array<{ ts: number; power: number }>, sinceTs: number): number {
  const sample = rows.filter((row) => row.ts >= sinceTs);
  if (sample.length === 0) return 0;
  return sample.reduce((sum, row) => sum + row.power, 0) / sample.length;
}

/**
 * Build a full consumption summary for the reports view.
 *
 * @param customerId  The caller's authorized customer, resolved via
 *                     resolveAccess() at the API-route layer and passed in —
 *                     never re-resolved here. getSupabaseAdmin() is a
 *                     service-role client and bypasses RLS entirely, so this
 *                     explicit filter is the actual isolation boundary for
 *                     this query, not just defense in depth.
 */
export async function buildConsumptionSummary(
  deviceId: string,
  customerId: string,
  filters: ReportFilters
): Promise<ConsumptionSummary> {
  const now = new Date();
  const rateConfig = await getBillingRate();

  const ratePhpPerKwh = Number(rateConfig?.rate_php_per_kwh ?? 10);

  const supabase = getSupabaseAdmin();

  // Paginated, newest-first: a plain `.limit(5000)` ascending silently
  // dropped the newest rows once a window exceeded 5000 readings. Pages are
  // fetched descending so the page cap, if ever hit, drops the oldest data.
  const rawReadings = await fetchAllPagesDescending<ReadingRow>(
    async (from, to) => {
      const { data, error } = await supabase
        .from("power_readings")
        .select(
          "id, recorded_at, voltage, power_w, energy_kwh, total_power, total_energy, voltage_a, voltage_b, voltage_c, current_amp, current_a, current_b, current_c, power_a, power_b, power_c, energy_a, energy_b, energy_c, frequency, frequency_a, frequency_b, frequency_c, power_factor, power_factor_a, power_factor_b, power_factor_c"
        )
        .eq("device_id", deviceId)
        .eq("customer_id", customerId)
        .gte("recorded_at", filters.fromIso)
        .lte("recorded_at", filters.toIso)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      return { data: data as ReadingRow[] | null, error };
    },
    { context: "Fetch filtered readings failed" }
  );

  let alertRanges: Array<{ start: number; end: number }> = [];
  if (filters.alertOnly) {
    const { data: alerts, error: alertsError } = await supabase
      .from("alerts")
      .select("created_at, ended_at")
      .eq("device_id", deviceId)
      .eq("customer_id", customerId)
      .lte("created_at", filters.toIso)
      .or(`ended_at.gte.${filters.fromIso},ended_at.is.null`)
      .order("created_at", { ascending: true });

    if (alertsError) {
      throw new Error(`Fetch alert windows failed: ${alertsError.message}`);
    }

    alertRanges = (alerts ?? []).map((alert) => ({
      start: new Date(alert.created_at).getTime(),
      end: new Date(alert.ended_at ?? filters.toIso).getTime(),
    }));
  }

  const filteredReadings = rawReadings.filter((typedRow) => {
    if (!filters.includeBlackout && isBlackoutReading(typedRow, filters.phase)) {
      return false;
    }

    if (filters.alertOnly) {
      const ts = new Date(typedRow.recorded_at).getTime();
      return alertRanges.some((range) => ts >= range.start && ts <= range.end);
    }

    return true;
  });

  const reduced = filteredReadings.map((row) => ({
    ts: new Date(row.recorded_at).getTime(),
    at: row.recorded_at,
    energy: rowEnergyByPhase(row, filters.phase),
    power: rowPowerByPhase(row, filters.phase),
  }));

  const latest = reduced.length > 0 ? reduced[reduced.length - 1] : null;

  if (!latest) {
    const monthKey = phMonthLabel(now.getTime());
    return {
      generatedAt: now.toISOString(),
      deviceId,
      ratePhpPerKwh,
      filters,
      current: {
        dayKwh: 0,
        weekKwh: 0,
        monthKwh: 0,
        monthLabel: monthKey,
        dayEstimatedPhp: 0,
        weekEstimatedPhp: 0,
        monthEstimatedPhp: 0,
      },
      averages: {
        dayKwh: 0,
        weekKwh: 0,
        monthKwh: 0,
        dayEstimatedPhp: 0,
        weekEstimatedPhp: 0,
        monthEstimatedPhp: 0,
      },
      powerStats: {
        dayAvgW: 0,
        weekAvgW: 0,
        monthAvgW: 0,
        currentW: 0,
      },
      monthlyHistory: [],
      selectedSeries: [],
    };
  }

  const oneDayStart = latest.ts - DAY_MS;
  const oneWeekStart = latest.ts - WEEK_MS;
  const monthStartTs = startOfPhMonth(latest.ts).getTime();

  const currentDayKwh = round(deltaWithinWindow(reduced, oneDayStart, latest.ts), 4);
  const currentWeekKwh = round(deltaWithinWindow(reduced, oneWeekStart, latest.ts), 4);
  const currentMonthKwh = round(deltaWithinWindow(reduced, monthStartTs, latest.ts), 4);

  // Approved averages definition (Option B): all three are the current rate,
  // scaled. avg/day = month-to-date within the selected range ÷ PH calendar
  // days from max(range start, month start) to the latest reading, inclusive
  // (min 1); week = day × 7; month = day × 30. Historical monthly totals stay
  // in the Monthly History list, so the ordering day ≤ week ≤ month holds by
  // construction.
  const rangeStartTs = new Date(filters.fromIso).getTime();
  const effectiveMonthStartTs = Math.max(monthStartTs, rangeStartTs);
  const elapsedDays = Math.max(
    1,
    phDayOfMonth(latest.ts) - phDayOfMonth(effectiveMonthStartTs) + 1
  );
  const averageDayKwh = round(currentMonthKwh / elapsedDays, 4);
  const averageWeekKwh = round(averageDayKwh * 7, 4);
  const averageMonthKwh = round(averageDayKwh * 30, 4);

  const powerDayAvg = round(averagePowerSince(reduced, oneDayStart), 2);
  const powerWeekAvg = round(averagePowerSince(reduced, oneWeekStart), 2);
  const powerMonthAvg = round(averagePowerSince(reduced, monthStartTs), 2);
  const currentPower = round(latest.power, 2);

  const byMonth = new Map<string, { powerSum: number; powerCount: number }>();

  for (const row of reduced) {
    const key = phMonthLabel(row.ts);
    const existing = byMonth.get(key);
    if (!existing) {
      byMonth.set(key, {
        powerSum: row.power,
        powerCount: 1,
      });
      continue;
    }

    existing.powerSum += row.power;
    existing.powerCount += 1;
  }

  const monthlyHistory = Array.from(byMonth.entries())
    .map(([period, value]) => {
      const monthRows = reduced
        .filter((row) => phMonthLabel(row.ts) === period)
        .map((row) => row.energy);

      return {
        period,
        totalKwh: round(monotonicEnergyDelta(monthRows), 4),
        avgPower: value.powerCount > 0 ? value.powerSum / value.powerCount : 0,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  const selectedSeries = monthlyHistory.map((item) => {
    if (filters.metric === "cost") {
      return { period: item.period, value: round(item.totalKwh * ratePhpPerKwh, 2), unit: "PHP" };
    }
    if (filters.metric === "power") {
      return { period: item.period, value: round(item.avgPower, 2), unit: "W" };
    }
    return { period: item.period, value: round(item.totalKwh, 4), unit: "kWh" };
  });

  return {
    generatedAt: now.toISOString(),
    deviceId,
    ratePhpPerKwh,
    filters,
    current: {
      dayKwh: currentDayKwh,
      weekKwh: currentWeekKwh,
      monthKwh: currentMonthKwh,
      monthLabel: phMonthLabel(latest.ts),
      dayEstimatedPhp: round(currentDayKwh * ratePhpPerKwh, 2),
      weekEstimatedPhp: round(currentWeekKwh * ratePhpPerKwh, 2),
      monthEstimatedPhp: round(currentMonthKwh * ratePhpPerKwh, 2),
    },
    powerStats: {
      dayAvgW: powerDayAvg,
      weekAvgW: powerWeekAvg,
      monthAvgW: powerMonthAvg,
      currentW: currentPower,
    },
    averages: {
      dayKwh: averageDayKwh,
      weekKwh: averageWeekKwh,
      monthKwh: averageMonthKwh,
      dayEstimatedPhp: round(averageDayKwh * ratePhpPerKwh, 2),
      weekEstimatedPhp: round(averageWeekKwh * ratePhpPerKwh, 2),
      monthEstimatedPhp: round(averageMonthKwh * ratePhpPerKwh, 2),
    },
    monthlyHistory: monthlyHistory.map((item) => ({
      period: item.period,
      totalKwh: item.totalKwh,
    })),
    selectedSeries,
  };
}
