/**
 * Unit tests for the PDF line builder: WinAnsi sanitization (the U+2192
 * arrow made every PDF 500) and the "Current point" line students asked
 * for, present for every metric.
 *
 * Run (from repo root):
 *   node --test apps/web/src/app/api/reports/pdf/_lines.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier, context);
      } catch {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { sanitizeWinAnsi, buildReportLines } = await import("./_lines.ts");

function assertWinAnsiSafe(text) {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const ok =
      (code >= 32 && code <= 126) || (code >= 160 && code <= 255);
    assert.ok(ok, `non-WinAnsi character ${JSON.stringify(char)} in ${JSON.stringify(text)}`);
  }
}

test("sanitizeWinAnsi maps the arrow and other common non-WinAnsi characters", () => {
  assert.equal(sanitizeWinAnsi("Window: a → b"), "Window: a -> b");
  assert.equal(sanitizeWinAnsi("a – b — c"), "a - b - c");
  assert.equal(sanitizeWinAnsi("‘q’ “r”"), "'q' \"r\"");
  assert.equal(sanitizeWinAnsi("• item … done"), "* item ... done");
  assert.equal(sanitizeWinAnsi("₱10.00"), "PHP 10.00");
  assert.equal(sanitizeWinAnsi("line1\nline2\tend"), "line1 line2 end");
});

test("sanitizeWinAnsi replaces characters outside WinAnsi with '?'", () => {
  assert.equal(sanitizeWinAnsi("emoji 😀 here"), "emoji ? here");
  assertWinAnsiSafe(sanitizeWinAnsi("→←↔–—‘’“”•…😀₱≥≤×÷\u00A0"));
});

function makeSummary(metric) {
  return {
    generatedAt: "2026-10-04T07:00:00.000Z",
    deviceId: "dev-1",
    ratePhpPerKwh: 10,
    filters: {
      preset: "current_month",
      fromIso: "2026-10-01T00:00:00.000Z",
      toIso: "2026-10-04T07:00:00.000Z",
      phase: "total",
      metric,
      alertOnly: false,
      includeBlackout: true,
    },
    current: {
      dayKwh: 18.557,
      weekKwh: 40.226,
      monthKwh: 52.312,
      monthLabel: "2026-10",
      dayEstimatedPhp: 185.57,
      weekEstimatedPhp: 402.26,
      monthEstimatedPhp: 523.12,
    },
    averages: {
      dayKwh: 1.73,
      weekKwh: 12.11,
      monthKwh: 51.9,
      dayEstimatedPhp: 17.3,
      weekEstimatedPhp: 121.1,
      monthEstimatedPhp: 519,
    },
    powerStats: {
      dayAvgW: 220.5,
      weekAvgW: 210.2,
      monthAvgW: 205.1,
      currentW: 231.7,
    },
    monthlyHistory: [{ period: "2026-10", totalKwh: 52.312 }],
    selectedSeries: [{ period: "2026-10", value: 52.312, unit: "kWh" }],
  };
}

for (const metric of ["kwh", "cost", "power"]) {
  test(`buildReportLines includes a Current point line for metric=${metric}`, () => {
    const lines = buildReportLines(makeSummary(metric));
    assert.ok(
      lines.some((line) => line.text.startsWith("Current point:")),
      `${metric} report must include the current reading`
    );
    for (const line of lines) {
      assertWinAnsiSafe(line.text);
    }
  });
}

test("buildReportLines renders a window line without the U+2192 arrow", () => {
  const lines = buildReportLines(makeSummary("kwh"));
  const windowLine = lines.find((line) => line.text.startsWith("Window:"));
  assert.ok(windowLine);
  assert.ok(windowLine.text.includes("->"));
  assert.ok(!windowLine.text.includes("\u2192"));
});
