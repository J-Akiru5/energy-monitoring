/**
 * Shared energy math + row fetching for the web app's report/history views.
 *
 * One energy-delta method (monotonic positive deltas) is used by Reports,
 * the PDF export, and History so the same window yields the same kWh
 * everywhere. Row fetching is paginated because PostgREST caps unbounded
 * queries at Supabase's default max-rows (1000) and silently truncates —
 * oldest-first, which hides the newest data.
 */

export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Hard cap on pages fetched per query (100k rows at the default page size).
 * When the cap is hit the OLDEST rows are dropped: pages are fetched
 * newest-first and reversed into ascending order, so recent data always
 * survives truncation.
 */
export const DEFAULT_MAX_PAGES = 100;

/**
 * Sum of positive consecutive deltas across a cumulative energy series.
 *
 * Counter resets / backward jumps are ignored rather than producing
 * negative usage. For a monotonic counter this equals last − first; across
 * a reset it keeps counting from zero, which is the honest total.
 */
export function monotonicEnergyDelta(energies: number[]): number {
  if (energies.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < energies.length; i += 1) {
    const diff = energies[i] - energies[i - 1];
    if (diff > 0) {
      total += diff;
    }
  }
  return total;
}

type NumericColumn = number | string | null | undefined;

/** Electrical columns of a power_readings row (legacy + per-phase + total). */
export type PhaseReadingFields = {
  voltage?: NumericColumn;
  current_amp?: NumericColumn;
  power_w?: NumericColumn;
  total_power?: NumericColumn;
  voltage_a?: NumericColumn;
  voltage_b?: NumericColumn;
  voltage_c?: NumericColumn;
  current_a?: NumericColumn;
  current_b?: NumericColumn;
  current_c?: NumericColumn;
};

export type ResolvedReading = {
  voltage: number;
  current: number;
  power: number;
  /** True when the circuit was energised (a phase reported voltage > 0). */
  live: boolean;
};

function columnNumber(value: NumericColumn): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve the voltage / current / power a row actually recorded.
 *
 * The legacy `voltage` / `current_amp` columns only mirror Phase A (or the
 * active source in 1-phase mode). When that tap reads 0/NULL while another
 * phase is energised, reading the legacy column alone yields flat-zero
 * voltage and current. So: use the legacy value when it is energised,
 * otherwise fall back to the highest-voltage energised phase. A row with no
 * energised phase is not `live` — it is an offline/blackout sample and must
 * not drag averages or min/max toward zero.
 */
export function resolveReading(row: PhaseReadingFields): ResolvedReading {
  const power = columnNumber(row.total_power) ?? columnNumber(row.power_w) ?? 0;

  const legacyVoltage = columnNumber(row.voltage);
  if (legacyVoltage !== null && legacyVoltage > 0) {
    return {
      voltage: legacyVoltage,
      current: columnNumber(row.current_amp) ?? 0,
      power,
      live: true,
    };
  }

  const phases: Array<[NumericColumn, NumericColumn]> = [
    [row.voltage_a, row.current_a],
    [row.voltage_b, row.current_b],
    [row.voltage_c, row.current_c],
  ];
  let best: { voltage: number; current: number } | null = null;
  for (const [voltageColumn, currentColumn] of phases) {
    const voltage = columnNumber(voltageColumn);
    if (voltage !== null && voltage > 0 && (best === null || voltage > best.voltage)) {
      best = { voltage, current: columnNumber(currentColumn) ?? 0 };
    }
  }

  if (best) return { ...best, power, live: true };
  return { voltage: 0, current: 0, power, live: false };
}

/**
 * Energy delta for readings inside [startTs, endTs], using the shared
 * monotonic method. Readings must be in ascending time order.
 */
export function deltaWithinWindow(
  readings: Array<{ ts: number; energy: number }>,
  startTs: number,
  endTs: number
): number {
  const inRange = readings.filter((row) => row.ts >= startTs && row.ts <= endTs);
  if (inRange.length < 2) return 0;
  return monotonicEnergyDelta(inRange.map((row) => row.energy));
}

/**
 * Fetch every row of a query through paginated `.range()` calls.
 *
 * `fetchPage(from, to)` must run the SAME query with the given range; it is
 * called with ascending offsets but the query itself must be ordered
 * NEWEST-FIRST (descending) so that hitting the page cap drops the oldest
 * rows. The returned array is reversed into ascending order for callers.
 */
export async function fetchAllPagesDescending<T>(
  fetchPage: (
    from: number,
    to: number
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  options: { context?: string; pageSize?: number; maxPages?: number } = {}
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const context = options.context ?? "Paginated fetch failed";

  const pages: T[][] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`${context}: ${error.message}`);
    const rows = data ?? [];
    pages.push(rows);
    if (rows.length < pageSize) break;
  }

  // Pages arrive newest-first, each internally descending. Global ascending
  // order = reverse the page order AND reverse the rows inside each page.
  return pages.reverse().flatMap((page) => [...page].reverse());
}
