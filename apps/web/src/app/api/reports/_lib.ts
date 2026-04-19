import { getBillingRate, getSupabaseAdmin } from "@energy/database";

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

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

export function parseReportFilters(searchParams: URLSearchParams): ReportFilters {
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

  const now = new Date();
  let fromDate: Date;
  let toDate: Date;

  if (preset === "custom" && isValidDate(searchParams.get("from")) && isValidDate(searchParams.get("to"))) {
    fromDate = new Date(searchParams.get("from") as string);
    toDate = new Date(searchParams.get("to") as string);
  } else if (preset === "today") {
    fromDate = startOfUtcDay(now);
    toDate = endOfUtcDay(now);
  } else if (preset === "7d") {
    toDate = now;
    fromDate = new Date(now.getTime() - 7 * DAY_MS);
  } else if (preset === "30d") {
    toDate = now;
    fromDate = new Date(now.getTime() - 30 * DAY_MS);
  } else {
    // current_month default
    fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
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

function monthLabel(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
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

function monotonicDelta(energySeries: number[]): number {
  if (energySeries.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < energySeries.length; i += 1) {
    const diff = energySeries[i] - energySeries[i - 1];
    // Counter resets/noisy backward jumps are ignored instead of producing negative usage.
    if (diff > 0) {
      total += diff;
    }
  }
  return total;
}

function deltaWithinWindow(
  rows: Array<{ ts: number; energy: number }>,
  startTs: number,
  endTs: number
): number {
  const inRange = rows.filter((row) => row.ts >= startTs && row.ts <= endTs);
  if (inRange.length < 2) return 0;
  return monotonicDelta(inRange.map((row) => row.energy));
}

export async function buildConsumptionSummary(
  deviceId: string,
  filters: ReportFilters
): Promise<ConsumptionSummary> {
  const now = new Date();
  const rateConfig = await getBillingRate();

  const ratePhpPerKwh = Number(rateConfig?.rate_php_per_kwh ?? 10);

  const supabase = getSupabaseAdmin();

  const { data: rawReadings, error: readingsError } = await supabase
    .from("power_readings")
    .select(
      "id, recorded_at, voltage, power_w, energy_kwh, total_power, total_energy, voltage_a, voltage_b, voltage_c, current_amp, current_a, current_b, current_c, power_a, power_b, power_c, energy_a, energy_b, energy_c, frequency, frequency_a, frequency_b, frequency_c, power_factor, power_factor_a, power_factor_b, power_factor_c"
    )
    .eq("device_id", deviceId)
    .gte("recorded_at", filters.fromIso)
    .lte("recorded_at", filters.toIso)
    .order("recorded_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000);

  if (readingsError) {
    throw new Error(`Fetch filtered readings failed: ${readingsError.message}`);
  }

  let alertRanges: Array<{ start: number; end: number }> = [];
  if (filters.alertOnly) {
    const { data: alerts, error: alertsError } = await supabase
      .from("alerts")
      .select("created_at, ended_at")
      .eq("device_id", deviceId)
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

  const filteredReadings = (rawReadings ?? []).filter((row) => {
    const typedRow = row as unknown as ReadingRow;

    if (!filters.includeBlackout && isBlackoutReading(typedRow, filters.phase)) {
      return false;
    }

    if (filters.alertOnly) {
      const ts = new Date(typedRow.recorded_at).getTime();
      return alertRanges.some((range) => ts >= range.start && ts <= range.end);
    }

    return true;
  }) as ReadingRow[];

  const reduced = filteredReadings.map((row) => ({
    ts: new Date(row.recorded_at).getTime(),
    at: row.recorded_at,
    energy: rowEnergyByPhase(row, filters.phase),
    power: rowPowerByPhase(row, filters.phase),
  }));

  const latest = reduced.length > 0 ? reduced[reduced.length - 1] : null;

  if (!latest) {
    const monthKey = monthLabel(now);
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

  const latestAt = new Date(latest.at);
  const oneDayStart = latest.ts - DAY_MS;
  const oneWeekStart = latest.ts - WEEK_MS;
  const monthStartTs = Date.UTC(latestAt.getUTCFullYear(), latestAt.getUTCMonth(), 1, 0, 0, 0, 0);

  const currentDayKwh = round(deltaWithinWindow(reduced, oneDayStart, latest.ts), 4);
  const currentWeekKwh = round(deltaWithinWindow(reduced, oneWeekStart, latest.ts), 4);
  const currentMonthKwh = round(deltaWithinWindow(reduced, monthStartTs, latest.ts), 4);

  const totalDelta = deltaWithinWindow(reduced, reduced[0].ts, latest.ts);
  const spanDays = Math.max((latest.ts - reduced[0].ts) / DAY_MS, 1 / 24);
  const averageDayKwh = round(totalDelta / spanDays, 4);
  const averageWeekKwh = round(averageDayKwh * 7, 4);
  const averageMonthKwh = round(averageDayKwh * 30, 4);

  const powerDayAvg = round(averagePowerSince(reduced, oneDayStart), 2);
  const powerWeekAvg = round(averagePowerSince(reduced, oneWeekStart), 2);
  const powerMonthAvg = round(averagePowerSince(reduced, monthStartTs), 2);
  const currentPower = round(latest.power, 2);

  const byMonth = new Map<string, { powerSum: number; powerCount: number }>();

  for (const row of reduced) {
    const key = monthLabel(new Date(row.at));
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
        .filter((row) => monthLabel(new Date(row.at)) === period)
        .map((row) => row.energy);

      return {
        period,
        totalKwh: round(monotonicDelta(monthRows), 4),
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
      monthLabel: monthLabel(new Date(monthStartTs)),
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
