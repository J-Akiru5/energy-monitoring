/**
 * Philippine-time (UTC+8) calendar-date helpers.
 *
 * Reports and History treat every user-facing date as a PH calendar date.
 * The database stores UTC instants; these helpers convert between the two
 * without relying on the server's local timezone, so a report window always
 * covers exactly the PH day/month the user picked.
 */

export const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export type ReportPreset = "today" | "7d" | "30d" | "current_month" | "custom";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toMs(instant: Date | number): number {
  return instant instanceof Date ? instant.getTime() : instant;
}

/** Shift an instant into PH wall-clock terms (read via the getUTC* methods). */
function shifted(instant: Date | number): Date {
  return new Date(toMs(instant) + PH_OFFSET_MS);
}

/** PH calendar date key ("YYYY-MM-DD") for an instant. */
export function phDateKey(instant: Date | number): string {
  const local = shifted(instant);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** UTC instant of 00:00:00.000 PH on a "YYYY-MM-DD" PH calendar date. */
export function startOfPhDay(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - PH_OFFSET_MS);
}

/** UTC instant of 23:59:59.999 PH on a "YYYY-MM-DD" PH calendar date. */
export function endOfPhDay(dateKey: string): Date {
  return new Date(startOfPhDay(dateKey).getTime() + DAY_MS - 1);
}

/** UTC instant of 00:00 PH on the first day of the PH month containing an instant. */
export function startOfPhMonth(instant: Date | number): Date {
  const local = shifted(instant);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - PH_OFFSET_MS);
}

/** PH calendar day-of-month (1-31) for an instant. */
export function phDayOfMonth(instant: Date | number): number {
  return shifted(instant).getUTCDate();
}

/**
 * Inclusive ISO bounds for a PH calendar-date range, expressed with an
 * explicit +08:00 offset so they round-trip through the API unambiguously.
 */
export function phDateRangeIso(fromKey: string, toKey: string): { fromIso: string; toIso: string } {
  return {
    fromIso: `${fromKey}T00:00:00.000+08:00`,
    toIso: `${toKey}T23:59:59.999+08:00`,
  };
}

/**
 * Date-input values ("YYYY-MM-DD", PH) for a report preset.
 * "custom" is not a computable range — callers keep the user's own dates.
 */
export function getPresetRange(
  preset: Exclude<ReportPreset, "custom">,
  now: Date = new Date()
): { from: string; to: string } {
  const today = phDateKey(now);

  if (preset === "today") {
    return { from: today, to: today };
  }

  if (preset === "7d") {
    return { from: phDateKey(now.getTime() - 7 * DAY_MS), to: today };
  }

  if (preset === "30d") {
    return { from: phDateKey(now.getTime() - 30 * DAY_MS), to: today };
  }

  return { from: phDateKey(startOfPhMonth(now)), to: today };
}

/**
 * Human label for a PH window given as [rangeStart, rangeEndExclusive)
 * instants, e.g. "Mon Sep 28 – Sun Oct 4, 2026". The exclusive end is
 * adjusted back by 1 ms so the last PH day is included.
 */
export function formatPhWindowLabel(
  rangeStartIso: string,
  rangeEndExclusiveIso: string
): string {
  const start = shifted(new Date(rangeStartIso));
  const end = shifted(new Date(new Date(rangeEndExclusiveIso).getTime() - 1));

  const startPart = `${WEEKDAYS[start.getUTCDay()]} ${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const endPart = `${WEEKDAYS[end.getUTCDay()]} ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;

  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${startPart} – ${endPart}, ${end.getUTCFullYear()}`;
  }
  return `${startPart}, ${start.getUTCFullYear()} – ${endPart}, ${end.getUTCFullYear()}`;
}

/** True when [rangeStart, rangeEndExclusive) covers days in two PH months. */
export function phWindowSpansMonths(
  rangeStartIso: string,
  rangeEndExclusiveIso: string
): boolean {
  const start = shifted(new Date(rangeStartIso));
  const end = shifted(new Date(new Date(rangeEndExclusiveIso).getTime() - 1));
  return (
    start.getUTCFullYear() !== end.getUTCFullYear() ||
    start.getUTCMonth() !== end.getUTCMonth()
  );
}

/** Full PH month name ("September") for an instant. */
export function phMonthFullName(instantIso: string): string {
  return FULL_MONTHS[shifted(new Date(instantIso)).getUTCMonth()];
}
