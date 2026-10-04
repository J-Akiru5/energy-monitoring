import type { ConsumptionSummary } from "../_lib";

export interface ReportLine {
  text: string;
  size: number;
  bold: boolean;
  color: [number, number, number];
  /** Extra vertical space before this line (section gaps). */
  spaceBefore?: number;
}

const BODY: [number, number, number] = [0.15, 0.18, 0.23];
const TITLE: [number, number, number] = [0.04, 0.32, 0.52];
const GREEN: [number, number, number] = [0.08, 0.42, 0.26];
const AMBER: [number, number, number] = [0.55, 0.32, 0.02];
const SLATE: [number, number, number] = [0.2, 0.24, 0.32];

/**
 * pdf-lib's standard Helvetica uses WinAnsi encoding, which cannot encode
 * arbitrary Unicode (a single U+2192 "→" made every PDF request 500).
 * Map the characters that realistically reach these reports, then replace
 * anything else outside WinAnsi with "?" rather than throwing.
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u2192/g, "->"],
  [/\u2190/g, "<-"],
  [/\u2194/g, "<->"],
  [/\u2013|\u2014|\u2015/g, "-"],
  [/\u2018|\u2019|\u201A|\u201B/g, "'"],
  [/\u201C|\u201D|\u201E|\u201F/g, '"'],
  [/\u2022/g, "*"],
  [/\u2026/g, "..."],
  [/\u20B1/g, "PHP "],
  [/\u20AC/g, "EUR "],
  [/\u2265/g, ">="],
  [/\u2264/g, "<="],
  [/\u00D7/g, "x"],
  [/\u00F7/g, "/"],
  [/\u00A0/g, " "],
];

export function sanitizeWinAnsi(input: string): string {
  let out = input;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/[\r\n\t]+/g, " ");

  let sanitized = "";
  for (const char of out) {
    const code = char.codePointAt(0) ?? 0;
    const isPrintableAscii = code >= 32 && code <= 126;
    const isWinAnsiHigh = code >= 160 && code <= 255;
    sanitized += isPrintableAscii || isWinAnsiHigh ? char : "?";
  }
  return sanitized;
}

function peso(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function kwh(value: number): string {
  return `${value.toLocaleString("en-PH", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })} kWh`;
}

function watts(value: number): string {
  return `${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} W`;
}

export function buildReportLines(summary: ConsumptionSummary): ReportLine[] {
  const lines: ReportLine[] = [];
  const push = (
    text: string,
    size: number,
    bold: boolean,
    color: [number, number, number],
    spaceBefore = 0
  ) => {
    lines.push({ text: sanitizeWinAnsi(text), size, bold, color, spaceBefore });
  };

  push("Energy Monitoring - Filtered Consumption Summary", 20, true, TITLE);
  push(`Device ID: ${summary.deviceId}`, 11, false, BODY);
  push(`Generated: ${new Date(summary.generatedAt).toLocaleString("en-PH")}`, 11, false, BODY);
  push(
    `Window: ${new Date(summary.filters.fromIso).toLocaleString("en-PH")} -> ${new Date(summary.filters.toIso).toLocaleString("en-PH")}`,
    11,
    false,
    BODY
  );
  push(
    `Filters: phase=${summary.filters.phase.toUpperCase()} metric=${summary.filters.metric.toUpperCase()} alertOnly=${summary.filters.alertOnly ? "yes" : "no"} includeBlackout=${summary.filters.includeBlackout ? "yes" : "no"}`,
    11,
    false,
    BODY
  );
  push(`Billing Rate: ${peso(summary.ratePhpPerKwh)} per kWh`, 11, false, BODY);

  push("Current Consumption", 14, true, GREEN, 8);
  if (summary.filters.metric === "power") {
    push(`Day average power: ${watts(summary.powerStats.dayAvgW)}`, 11, false, BODY);
    push(`Week average power: ${watts(summary.powerStats.weekAvgW)}`, 11, false, BODY);
    push(`Current point: ${watts(summary.powerStats.currentW)}`, 11, false, BODY);
  } else if (summary.filters.metric === "cost") {
    push(`Day cost estimate: ${peso(summary.current.dayEstimatedPhp)}`, 11, false, BODY);
    push(`Week cost estimate: ${peso(summary.current.weekEstimatedPhp)}`, 11, false, BODY);
    push(`Month cost estimate (${summary.current.monthLabel}): ${peso(summary.current.monthEstimatedPhp)}`, 11, false, BODY);
    push(`Current point: ${peso(summary.current.monthEstimatedPhp)}`, 11, false, BODY);
  } else {
    push(`Day (last 24h): ${kwh(summary.current.dayKwh)}  |  ${peso(summary.current.dayEstimatedPhp)}`, 11, false, BODY);
    push(`Week (calendar week): ${kwh(summary.current.weekKwh)}  |  ${peso(summary.current.weekEstimatedPhp)}`, 11, false, BODY);
    push(
      `Month (${summary.current.monthLabel}): ${kwh(summary.current.monthKwh)}  |  ${peso(summary.current.monthEstimatedPhp)}`,
      11,
      false,
      BODY
    );
    push(
      `Current point: ${kwh(summary.current.monthKwh)}  |  ${peso(summary.current.monthEstimatedPhp)}`,
      11,
      false,
      BODY
    );
  }

  push("Average Consumption", 14, true, AMBER, 8);
  if (summary.filters.metric === "power") {
    push(`Average per day: ${watts(summary.powerStats.dayAvgW)}`, 11, false, BODY);
    push(`Average per week: ${watts(summary.powerStats.weekAvgW)}`, 11, false, BODY);
    push(`Average per month: ${watts(summary.powerStats.monthAvgW)}`, 11, false, BODY);
  } else if (summary.filters.metric === "cost") {
    push(`Average per day (current rate): ${peso(summary.averages.dayEstimatedPhp)}`, 11, false, BODY);
    push(`Average per week (day x 7): ${peso(summary.averages.weekEstimatedPhp)}`, 11, false, BODY);
    push(`Average per month (day x 30): ${peso(summary.averages.monthEstimatedPhp)}`, 11, false, BODY);
  } else {
    push(`Average per day (current rate): ${kwh(summary.averages.dayKwh)}  |  ${peso(summary.averages.dayEstimatedPhp)}`, 11, false, BODY);
    push(
      `Average per week (day x 7): ${kwh(summary.averages.weekKwh)}  |  ${peso(summary.averages.weekEstimatedPhp)}`,
      11,
      false,
      BODY
    );
    push(`Average per month (day x 30): ${kwh(summary.averages.monthKwh)}  |  ${peso(summary.averages.monthEstimatedPhp)}`, 11, false, BODY);
  }

  push("Monthly History (filtered window)", 14, true, SLATE, 8);
  if (summary.selectedSeries.length === 0) {
    push("No monthly data available for the selected filters.", 11, false, BODY);
  } else {
    for (const month of summary.selectedSeries) {
      if (summary.filters.metric === "cost") {
        push(`${month.period}: ${peso(month.value)}`, 11, false, BODY);
      } else if (summary.filters.metric === "power") {
        push(`${month.period}: ${month.value.toFixed(2)} W`, 11, false, BODY);
      } else {
        push(`${month.period}: ${kwh(month.value)}`, 11, false, BODY);
      }
    }
  }

  return lines;
}
