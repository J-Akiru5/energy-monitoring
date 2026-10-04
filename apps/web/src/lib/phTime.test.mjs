/**
 * Unit tests for the PH (UTC+8) calendar-date helpers used by Reports and
 * History. These lock in the conversion rules: every report date is a
 * Philippine calendar date, and instants render back to PH labels.
 *
 * Run (from repo root):
 *   node --test apps/web/src/lib/phTime.test.mjs
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

const {
  phDateKey,
  startOfPhDay,
  endOfPhDay,
  startOfPhMonth,
  phDayOfMonth,
  phDateRangeIso,
  getPresetRange,
  formatPhWindowLabel,
  phWindowSpansMonths,
  phMonthFullName,
} = await import("./phTime.ts");

test("phDateKey maps an instant to its PH calendar date", () => {
  // 2026-09-30T16:00Z is already Oct 1 in PH.
  assert.equal(phDateKey(new Date("2026-09-30T16:00:00.000Z")), "2026-10-01");
  assert.equal(phDateKey(new Date("2026-09-30T15:59:59.999Z")), "2026-09-30");
  assert.equal(phDateKey(new Date("2026-10-04T09:00:00.000Z")), "2026-10-04");
});

test("startOfPhDay/endOfPhDay return PH midnight boundaries as UTC instants", () => {
  assert.equal(startOfPhDay("2026-10-01").toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(endOfPhDay("2026-10-01").toISOString(), "2026-10-01T15:59:59.999Z");
});

test("startOfPhMonth returns the PH month start (October 2026)", () => {
  assert.equal(
    startOfPhMonth(new Date("2026-10-04T09:00:00.000Z")).toISOString(),
    "2026-09-30T16:00:00.000Z"
  );
  // Just before PH midnight on the 1st is still the previous PH month.
  assert.equal(
    startOfPhMonth(new Date("2026-09-30T15:59:59.999Z")).toISOString(),
    "2026-08-31T16:00:00.000Z"
  );
});

test("phDayOfMonth uses the PH calendar day", () => {
  assert.equal(phDayOfMonth(new Date("2026-09-30T16:00:00.000Z")), 1);
  assert.equal(phDayOfMonth(new Date("2026-10-04T09:00:00.000Z")), 4);
});

test("phDateRangeIso builds inclusive +08:00 bounds for a PH date", () => {
  assert.deepEqual(phDateRangeIso("2026-10-01", "2026-10-01"), {
    fromIso: "2026-10-01T00:00:00.000+08:00",
    toIso: "2026-10-01T23:59:59.999+08:00",
  });
  assert.deepEqual(phDateRangeIso("2026-10-01", "2026-10-04"), {
    fromIso: "2026-10-01T00:00:00.000+08:00",
    toIso: "2026-10-04T23:59:59.999+08:00",
  });
});

test("getPresetRange uses PH calendar dates for the date inputs", () => {
  // 02:30 AM PH on Oct 4 — the UTC date is still Oct 3.
  const now = new Date("2026-10-03T18:30:00.000Z");
  assert.deepEqual(getPresetRange("today", now), { from: "2026-10-04", to: "2026-10-04" });
  assert.deepEqual(getPresetRange("current_month", now), { from: "2026-10-01", to: "2026-10-04" });
  assert.deepEqual(getPresetRange("7d", now), { from: "2026-09-27", to: "2026-10-04" });
});

test("formatPhWindowLabel renders the PH week window inclusively", () => {
  // History's Mon-start week for Oct 4, 2026: [Sep 28 00:00 PH, Oct 5 00:00 PH)
  assert.equal(
    formatPhWindowLabel("2026-09-27T16:00:00.000Z", "2026-10-04T16:00:00.000Z"),
    "Mon Sep 28 – Sun Oct 4, 2026"
  );
  // Same-year month window.
  assert.equal(
    formatPhWindowLabel("2026-09-30T16:00:00.000Z", "2026-10-31T16:00:00.000Z"),
    "Thu Oct 1 – Sat Oct 31, 2026"
  );
});

test("phWindowSpansMonths detects windows crossing a PH month boundary", () => {
  assert.equal(
    phWindowSpansMonths("2026-09-27T16:00:00.000Z", "2026-10-04T16:00:00.000Z"),
    true
  );
  assert.equal(
    phWindowSpansMonths("2026-09-30T16:00:00.000Z", "2026-10-31T16:00:00.000Z"),
    false
  );
});

test("phMonthFullName names the PH month of an instant", () => {
  assert.equal(phMonthFullName("2026-09-27T16:00:00.000Z"), "September");
  assert.equal(phMonthFullName("2026-10-04T09:00:00.000Z"), "October");
});
