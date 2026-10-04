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
