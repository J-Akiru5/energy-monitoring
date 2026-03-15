import { getBillingRate, getLatestReading, getMonthlyEnergy, getSupabaseAdmin } from "@energy/database";

type MonthHistoryItem = {
  period: string;
  totalKwh: number;
};

export type ConsumptionSummary = {
  generatedAt: string;
  deviceId: string;
  ratePhpPerKwh: number;
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
  monthlyHistory: MonthHistoryItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function monthLabel(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function startOfIsoWeekUtc(date: Date): Date {
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - daysSinceMonday,
      0,
      0,
      0,
      0
    )
  );
}

async function getWindowDelta(
  deviceId: string,
  latestEnergyKwh: number,
  latestAt: Date,
  sinceIso: string
): Promise<{ deltaKwh: number; spanDays: number }> {
  const supabase = getSupabaseAdmin();

  const { data: startRow, error } = await supabase
    .from("power_readings")
    .select("id, energy_kwh, recorded_at")
    .eq("device_id", deviceId)
    .gte("recorded_at", sinceIso)
    .order("recorded_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !startRow) {
    return { deltaKwh: 0, spanDays: 0 };
  }

  const startEnergyKwh = Number(startRow.energy_kwh ?? 0);
  const startAtMs = new Date(startRow.recorded_at).getTime();
  const latestAtMs = latestAt.getTime();
  const spanDays = Math.max(0, (latestAtMs - startAtMs) / DAY_MS);
  const deltaKwh = Math.max(0, latestEnergyKwh - startEnergyKwh);

  return { deltaKwh, spanDays };
}

async function getRangeDelta(
  deviceId: string,
  startIso: string,
  endIso: string
): Promise<{ deltaKwh: number; hasData: boolean }> {
  const supabase = getSupabaseAdmin();

  const [firstResult, lastResult] = await Promise.all([
    supabase
      .from("power_readings")
      .select("id, energy_kwh")
      .eq("device_id", deviceId)
      .gte("recorded_at", startIso)
      .lt("recorded_at", endIso)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("power_readings")
      .select("id, energy_kwh")
      .eq("device_id", deviceId)
      .gte("recorded_at", startIso)
      .lt("recorded_at", endIso)
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (firstResult.error || lastResult.error || !firstResult.data || !lastResult.data) {
    return { deltaKwh: 0, hasData: false };
  }

  if (firstResult.data.id === lastResult.data.id) {
    return { deltaKwh: 0, hasData: false };
  }

  const firstEnergy = Number(firstResult.data.energy_kwh ?? 0);
  const lastEnergy = Number(lastResult.data.energy_kwh ?? 0);
  return {
    deltaKwh: Math.max(0, lastEnergy - firstEnergy),
    hasData: true,
  };
}

export async function buildConsumptionSummary(deviceId: string): Promise<ConsumptionSummary> {
  const now = new Date();
  const latest = await getLatestReading(deviceId);
  const rateConfig = await getBillingRate();

  const ratePhpPerKwh = Number(rateConfig?.rate_php_per_kwh ?? 10);

  if (!latest) {
    const monthKey = monthLabel(now);
    return {
      generatedAt: now.toISOString(),
      deviceId,
      ratePhpPerKwh,
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
      monthlyHistory: [],
    };
  }

  const latestEnergyKwh = Number(latest.energy_kwh ?? 0);
  const latestAt = new Date(latest.recorded_at);

  const oneDayAgo = new Date(latestAt.getTime() - DAY_MS).toISOString();
  const currentWeekStart = startOfIsoWeekUtc(latestAt);
  const currentWeekStartIso = currentWeekStart.toISOString();
  const thirtyDaysAgo = new Date(latestAt.getTime() - 30 * DAY_MS).toISOString();

  const currentMonthDate = new Date(
    Date.UTC(latestAt.getUTCFullYear(), latestAt.getUTCMonth(), 1)
  );

  const [
    dayWindow,
    weekWindow,
    avgDayWindow,
    weeklyAverageWindows,
    currentMonthKwhRaw,
    historicalMonths,
  ] = await Promise.all([
    getWindowDelta(deviceId, latestEnergyKwh, latestAt, oneDayAgo),
    getWindowDelta(deviceId, latestEnergyKwh, latestAt, currentWeekStartIso),
    getWindowDelta(deviceId, latestEnergyKwh, latestAt, thirtyDaysAgo),
    Promise.all(
      Array.from({ length: 8 }, (_, idx) => {
        const weekEndMs = currentWeekStart.getTime() - idx * WEEK_MS;
        const weekStartMs = weekEndMs - WEEK_MS;
        return getRangeDelta(
          deviceId,
          new Date(weekStartMs).toISOString(),
          new Date(weekEndMs).toISOString()
        );
      })
    ),
    getMonthlyEnergy(deviceId, currentMonthDate.getUTCFullYear(), currentMonthDate.getUTCMonth() + 1),
    Promise.all(
      [6, 5, 4, 3, 2, 1].map(async (offset) => {
        const d = new Date(
          Date.UTC(currentMonthDate.getUTCFullYear(), currentMonthDate.getUTCMonth() - offset, 1)
        );
        const value = await getMonthlyEnergy(deviceId, d.getUTCFullYear(), d.getUTCMonth() + 1);
        return {
          period: monthLabel(d),
          totalKwh: Math.max(0, Number(value ?? 0)),
        };
      })
    ),
  ]);

  const currentDayKwh = round(dayWindow.deltaKwh, 4);
  const currentWeekKwh = round(weekWindow.deltaKwh, 4);
  const currentMonthKwh = round(Math.max(0, Number(currentMonthKwhRaw ?? 0)), 4);

  const avgDayDivisor = Math.max(1 / 24, avgDayWindow.spanDays);

  const averageDayKwh = round(avgDayWindow.deltaKwh / avgDayDivisor, 4);
  const weekDeltas = weeklyAverageWindows
    .filter((window) => window.hasData)
    .map((window) => window.deltaKwh);
  const averageWeekKwh =
    weekDeltas.length > 0
      ? round(weekDeltas.reduce((sum, value) => sum + value, 0) / weekDeltas.length, 4)
      : 0;

  const historicalAverageMonthKwh =
    historicalMonths.length > 0
      ? historicalMonths.reduce((sum, m) => sum + m.totalKwh, 0) / historicalMonths.length
      : currentMonthKwh;
  const averageMonthKwh = round(historicalAverageMonthKwh, 4);

  return {
    generatedAt: now.toISOString(),
    deviceId,
    ratePhpPerKwh,
    current: {
      dayKwh: currentDayKwh,
      weekKwh: currentWeekKwh,
      monthKwh: currentMonthKwh,
      monthLabel: monthLabel(currentMonthDate),
      dayEstimatedPhp: round(currentDayKwh * ratePhpPerKwh, 2),
      weekEstimatedPhp: round(currentWeekKwh * ratePhpPerKwh, 2),
      monthEstimatedPhp: round(currentMonthKwh * ratePhpPerKwh, 2),
    },
    averages: {
      dayKwh: averageDayKwh,
      weekKwh: averageWeekKwh,
      monthKwh: averageMonthKwh,
      dayEstimatedPhp: round(averageDayKwh * ratePhpPerKwh, 2),
      weekEstimatedPhp: round(averageWeekKwh * ratePhpPerKwh, 2),
      monthEstimatedPhp: round(averageMonthKwh * ratePhpPerKwh, 2),
    },
    monthlyHistory: historicalMonths,
  };
}
