/**
 * Tests for buildConsumptionSummary() row completeness.
 *
 * Pre-fix the readings query ends with `.order(recorded_at asc).limit(5000)`,
 * so a window with more than 5000 rows returns the OLDEST 5000 and silently
 * drops the newest — the totals, the "current point" power, and the averages
 * all miss recent data. These tests assert the desired behavior (all rows,
 * newest included) and fail against the pre-fix code.
 *
 * @energy/database is mocked with an in-memory PostgREST-semantics fake:
 * filters, multi-key ordering, limit, and range are honored; an unbounded
 * query is capped at 1000 rows (Supabase's default max-rows).
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/reports/_lib.test.mjs
 */
import { test, mock } from "node:test";
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

// ── In-memory PostgREST-semantics fake ─────────────────────────────────
function makeFakeDatabase(tables) {
  const calls = [];

  function from(table) {
    const state = { table, filters: [], orders: [], limit: null, range: null };
    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        state.filters.push([col, "eq", val]);
        return builder;
      },
      gte(col, val) {
        state.filters.push([col, "gte", val]);
        return builder;
      },
      lte(col, val) {
        state.filters.push([col, "lte", val]);
        return builder;
      },
      lt(col, val) {
        state.filters.push([col, "lt", val]);
        return builder;
      },
      order(col, opts) {
        state.orders.push([col, opts?.ascending ?? true]);
        return builder;
      },
      limit(n) {
        state.limit = n;
        return builder;
      },
      range(fromIdx, toIdx) {
        state.range = [fromIdx, toIdx];
        return builder;
      },
      then(resolve) {
        calls.push(state);
        resolve(execute(state));
      },
    };
    return builder;
  }

  function execute(state) {
    let rows = [...(tables[state.table] ?? [])];
    for (const [col, op, val] of state.filters) {
      rows = rows.filter((r) => {
        const v = r[col];
        if (op === "eq") return v === val;
        if (op === "gte") return v >= val;
        if (op === "lte") return v <= val;
        if (op === "lt") return v < val;
        return true;
      });
    }
    rows.sort((a, b) => {
      for (const [col, asc] of state.orders) {
        if (a[col] < b[col]) return asc ? -1 : 1;
        if (a[col] > b[col]) return asc ? 1 : -1;
      }
      return 0;
    });
    if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
    else if (state.limit != null) rows = rows.slice(0, state.limit);
    else rows = rows.slice(0, 1000); // Supabase default max-rows
    return { data: rows, error: null };
  }

  return { client: { from }, calls };
}

let fake = makeFakeDatabase({ power_readings: [] });

mock.module("@energy/database", {
  namedExports: {
    getSupabaseAdmin: () => fake.client,
    getBillingRate: async () => ({ rate_php_per_kwh: 10 }),
  },
});

const { buildConsumptionSummary, parseReportFilters } = await import("./_lib.ts");

const FROM = "2026-10-01T00:00:00.000Z";
const TO = "2026-10-01T10:00:00.000Z";

const filters = {
  preset: "custom",
  fromIso: FROM,
  toIso: TO,
  phase: "total",
  metric: "kwh",
  alertOnly: false,
  includeBlackout: true,
};

function makeRow(i, energy) {
  const ts = new Date(Date.parse(FROM) + i * 6000).toISOString();
  return {
    id: i + 1,
    device_id: "dev-1",
    customer_id: "cust-1",
    recorded_at: ts,
    voltage: 220,
    power_w: 200 + (i % 50),
    energy_kwh: energy,
    total_power: 200 + (i % 50),
    total_energy: energy,
    voltage_a: null,
    voltage_b: null,
    voltage_c: null,
    current_amp: 1,
    current_a: null,
    current_b: null,
    current_c: null,
    power_a: null,
    power_b: null,
    power_c: null,
    energy_a: null,
    energy_b: null,
    energy_c: null,
    frequency: 60,
    frequency_a: null,
    frequency_b: null,
    frequency_c: null,
    power_factor: 1,
    power_factor_a: null,
    power_factor_b: null,
    power_factor_c: null,
  };
}

test("includes rows beyond 5000 (newest data not dropped)", async () => {
  // 6000 rows over 10h. First 5000 add 0.001 kWh each (+5), the newest
  // 1000 add 0.01 kWh each (+10). True total = 15 kWh.
  const rows = [];
  let energy = 100;
  for (let i = 0; i < 6000; i++) {
    energy = Number((energy + (i < 5000 ? 0.001 : 0.01)).toFixed(6));
    rows.push(makeRow(i, energy));
  }
  fake = makeFakeDatabase({ power_readings: rows });

  const summary = await buildConsumptionSummary("dev-1", "cust-1", filters);

  assert.ok(
    Math.abs(summary.current.monthKwh - 15) < 0.01,
    `month total should include all 6000 rows (expected ~15 kWh, got ${summary.current.monthKwh})`
  );
  assert.equal(
    summary.powerStats.currentW,
    rows[rows.length - 1].power_w,
    "current point power must come from the newest row"
  );
});

function makeRowAt(ts, energy, id) {
  return { ...makeRow(0, energy), id, recorded_at: ts };
}

test("invariant: averages are ordered day <= week <= month (kWh and cost)", async () => {
  const rows = [
    makeRowAt("2026-09-30T16:00:00.000Z", 100, 1), // PH Oct 1 00:00
    makeRowAt("2026-09-30T22:00:00.000Z", 102, 2), // PH Oct 1 06:00
    makeRowAt("2026-10-01T16:00:00.000Z", 105, 3), // PH Oct 2 00:00
    makeRowAt("2026-10-02T04:00:00.000Z", 107, 4), // PH Oct 2 12:00
    makeRowAt("2026-10-02T16:00:00.000Z", 110, 5), // PH Oct 3 00:00
  ];
  fake = makeFakeDatabase({ power_readings: rows });

  const summary = await buildConsumptionSummary("dev-1", "cust-1", {
    ...filters,
    fromIso: "2026-09-30T16:00:00.000Z",
    toIso: "2026-10-03T16:00:00.000Z",
  });

  assert.ok(
    summary.averages.dayKwh <= summary.averages.weekKwh &&
      summary.averages.weekKwh <= summary.averages.monthKwh,
    `kWh ordering broken: ${summary.averages.dayKwh}/${summary.averages.weekKwh}/${summary.averages.monthKwh}`
  );
  assert.ok(
    summary.averages.dayEstimatedPhp <= summary.averages.weekEstimatedPhp &&
      summary.averages.weekEstimatedPhp <= summary.averages.monthEstimatedPhp,
    `cost ordering broken: ${summary.averages.dayEstimatedPhp}/${summary.averages.weekEstimatedPhp}/${summary.averages.monthEstimatedPhp}`
  );
});

test("invariant: month total equals the sum of its PH days", async () => {
  // Per-day deltas (with boundary carry): 2 + 5 + 3 = 10.
  const rows = [
    makeRowAt("2026-09-30T16:00:00.000Z", 100, 1),
    makeRowAt("2026-09-30T22:00:00.000Z", 102, 2),
    makeRowAt("2026-10-01T16:00:00.000Z", 105, 3),
    makeRowAt("2026-10-02T04:00:00.000Z", 107, 4),
    makeRowAt("2026-10-02T16:00:00.000Z", 110, 5),
  ];
  fake = makeFakeDatabase({ power_readings: rows });

  const summary = await buildConsumptionSummary("dev-1", "cust-1", {
    ...filters,
    fromIso: "2026-09-30T16:00:00.000Z",
    toIso: "2026-10-03T16:00:00.000Z",
  });

  assert.ok(
    Math.abs(summary.current.monthKwh - 10) < 0.001,
    `month total should be 10 kWh, got ${summary.current.monthKwh}`
  );
  // day 1: 2, day 2: 105→107 = 2 plus carry 105-102 = 3 → 5, day 3: 110-107 = 3
  assert.ok(Math.abs(summary.averages.dayKwh - 10 / 3) < 0.001);
});

test("invariant: a 1.38h burst must NOT yield ~322 kWh/day", async () => {
  const rows = [];
  let energy = 100;
  const n = 828; // 828 * 6s = 1.38h
  const inc = 18.557 / n;
  for (let i = 0; i < n; i++) {
    energy = Number((energy + inc).toFixed(6));
    rows.push(makeRowAt(new Date(Date.parse("2026-09-30T16:00:00.000Z") + i * 6000).toISOString(), energy, i + 1));
  }
  fake = makeFakeDatabase({ power_readings: rows });

  const summary = await buildConsumptionSummary("dev-1", "cust-1", {
    ...filters,
    fromIso: "2026-09-30T16:00:00.000Z",
    toIso: "2026-10-01T16:00:00.000Z",
  });

  assert.ok(
    summary.averages.dayKwh < 100,
    `burst must not inflate the daily average (got ${summary.averages.dayKwh})`
  );
  // Latest is PH Oct 1 → exactly one elapsed day, so day = month-to-date.
  assert.ok(Math.abs(summary.averages.dayKwh - summary.current.monthKwh) < 0.01);
  assert.ok(Math.abs(summary.averages.weekKwh - summary.averages.dayKwh * 7) < 0.01);
  assert.ok(Math.abs(summary.averages.monthKwh - summary.averages.dayKwh * 30) < 0.01);
});

test("end-to-end: real summary -> real lines -> a real PDF", async () => {
  const rows = [];
  let energy = 100;
  for (let i = 0; i < 600; i++) {
    energy = Number((energy + 0.01).toFixed(6));
    rows.push(makeRow(i, energy));
  }
  fake = makeFakeDatabase({ power_readings: rows });

  const summary = await buildConsumptionSummary("dev-1", "cust-1", filters);
  const { buildReportLines } = await import("./pdf/_lines.ts");
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  for (const line of buildReportLines(summary)) {
    y -= line.spaceBefore ?? 0;
    page.drawText(line.text, {
      x: 50,
      y,
      size: line.size,
      font: line.bold ? fontBold : font,
      color: rgb(...line.color),
    });
    y -= 20;
  }
  const bytes = await pdf.save();
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString("latin1"), "%PDF");
});

test("month total equals the sum of positive deltas across a counter reset", async () => {
  const rows = [];
  const energies = [100, 110, 0, 5, 12];
  for (let i = 0; i < energies.length; i++) {
    rows.push(makeRow(i, energies[i]));
  }
  fake = makeFakeDatabase({ power_readings: rows });

  const summary = await buildConsumptionSummary("dev-1", "cust-1", filters);

  // +10 (100→110), reset ignored (110→0), +5 (0→5), +7 (5→12) = 22
  assert.ok(
    Math.abs(summary.current.monthKwh - 22) < 0.001,
    `expected 22 kWh across the reset, got ${summary.current.monthKwh}`
  );
});

// ── PH (UTC+8) report windows ──────────────────────────────────────────
//
// Reports dates are PH calendar dates. Before the fix, "current_month"
// started at Date.UTC(y, m, 1) — 08:00 PH on the 1st — so every reading
// from 00:00 to 08:00 PH on the first day was silently excluded.

const PH_NOW = new Date("2026-10-04T09:00:00.000Z"); // PH Oct 4, 17:00

test("PH preset: current_month starts at the PH month start (Oct 2026)", () => {
  const f = parseReportFilters(new URLSearchParams({ preset: "current_month" }), PH_NOW);
  assert.equal(f.fromIso, "2026-09-30T16:00:00.000Z");
  assert.equal(f.toIso, PH_NOW.toISOString());
});

test("PH preset: today covers the PH calendar day, not the UTC day", () => {
  const f = parseReportFilters(new URLSearchParams({ preset: "today" }), PH_NOW);
  assert.equal(f.fromIso, "2026-10-03T16:00:00.000Z");
  assert.equal(f.toIso, "2026-10-04T15:59:59.999Z");
});

test("PH preset: custom +08:00 date inputs parse to the PH instants", () => {
  const f = parseReportFilters(
    new URLSearchParams({
      preset: "custom",
      from: "2026-10-01T00:00:00.000+08:00",
      to: "2026-10-01T23:59:59.999+08:00",
    }),
    PH_NOW
  );
  assert.equal(f.fromIso, "2026-09-30T16:00:00.000Z");
  assert.equal(f.toIso, "2026-10-01T15:59:59.999Z");
});

/**
 * Fixture: a monotonic counter from PH Oct 1 00:00 to PH Oct 4 17:00.
 * The first 8 PH hours (00:00-08:00 on the 1st) add 6.186 kWh; the rest
 * adds 40.496 kWh. True month-to-date = 46.682 kWh. Pre-fix, the UTC
 * month start (Oct 1 08:00 PH) drops the 6.186.
 */
function makePhOctoberFixture() {
  const rows = [];
  const startMs = Date.parse("2026-09-30T16:00:00.000Z"); // PH Oct 1 00:00
  const splitMs = Date.parse("2026-10-01T00:00:00.000Z"); // PH Oct 1 08:00
  const endMs = Date.parse("2026-10-04T09:00:00.000Z"); // PH Oct 4 17:00
  const stepMs = 30 * 60 * 1000;

  let id = 1;
  // Segment 1: 100 → 106.186 (16 steps of 30 min = 8h).
  const seg1Steps = (splitMs - startMs) / stepMs;
  for (let i = 0; i <= seg1Steps; i++) {
    const energy = Number((100 + (6.186 * i) / seg1Steps).toFixed(6));
    rows.push(makeRowAt(new Date(startMs + i * stepMs).toISOString(), energy, id++));
  }
  // Segment 2: 106.186 → 146.682 (40.496 over the remaining 81h).
  const seg2Steps = (endMs - splitMs) / stepMs;
  for (let i = 1; i <= seg2Steps; i++) {
    const energy = Number((106.186 + (40.496 * i) / seg2Steps).toFixed(6));
    rows.push(makeRowAt(new Date(splitMs + i * stepMs).toISOString(), energy, id++));
  }
  return rows;
}

test("PH window keeps the 00:00-08:00 PH readings on the 1st (46.682 fixture)", async () => {
  const rows = makePhOctoberFixture();
  fake = makeFakeDatabase({ power_readings: rows });

  const f = parseReportFilters(new URLSearchParams({ preset: "current_month" }), PH_NOW);
  const summary = await buildConsumptionSummary("dev-1", "cust-1", f);

  assert.ok(
    Math.abs(summary.current.monthKwh - 46.682) < 0.001,
    `PH month-to-date should be 46.682 kWh (40.496 without the first 8 PH hours), got ${summary.current.monthKwh}`
  );
});

test("default range: week total never exceeds the month total", async () => {
  // 20 PH days of readings at hourly cadence, +1 kWh/day.
  const rows = [];
  const startMs = Date.parse("2026-09-30T16:00:00.000Z");
  let energy = 100;
  for (let i = 0; i <= 20 * 24; i++) {
    rows.push(makeRowAt(new Date(startMs + i * 3600e3).toISOString(), Number(energy.toFixed(6)), i + 1));
    energy += 1 / 24;
  }
  fake = makeFakeDatabase({ power_readings: rows });

  const f = parseReportFilters(
    new URLSearchParams({ preset: "current_month" }),
    new Date("2026-10-20T09:00:00.000Z")
  );
  const summary = await buildConsumptionSummary("dev-1", "cust-1", f);

  assert.ok(
    summary.current.weekKwh <= summary.current.monthKwh + 1e-9,
    `week (${summary.current.weekKwh}) must not exceed month (${summary.current.monthKwh}) on the default range`
  );
});

test("Option B: avg/day divides by PH days from the range start, not the full day-of-month", async () => {
  const rows = [
    makeRowAt("2026-09-30T16:00:00.000Z", 100, 1), // PH Oct 1
    makeRowAt("2026-10-01T16:00:00.000Z", 110, 2), // PH Oct 2
    makeRowAt("2026-10-02T16:00:00.000Z", 180, 3), // PH Oct 3
    makeRowAt("2026-10-10T04:00:00.000Z", 222.4, 4), // PH Oct 10 12:00
  ];
  fake = makeFakeDatabase({ power_readings: rows });

  const f = parseReportFilters(
    new URLSearchParams({
      preset: "custom",
      from: "2026-10-03T00:00:00.000+08:00",
      to: "2026-10-10T23:59:59.999+08:00",
    }),
    new Date("2026-10-10T04:00:00.000Z")
  );
  const summary = await buildConsumptionSummary("dev-1", "cust-1", f);

  // 42.4 kWh over 8 PH calendar days (Oct 3-10 inclusive), not 10
  // (the full day-of-month — the pre-fix divisor gave 4.24).
  assert.ok(
    Math.abs(summary.averages.dayKwh - 5.3) < 0.001,
    `avg/day should be 5.3 (42.4 / 8 days), got ${summary.averages.dayKwh}`
  );
  assert.ok(Math.abs(summary.averages.weekKwh - 37.1) < 0.001);
  assert.ok(Math.abs(summary.averages.monthKwh - 159) < 0.001);
});
