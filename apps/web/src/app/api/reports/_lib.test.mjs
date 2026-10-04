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

const { buildConsumptionSummary } = await import("./_lib.ts");

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
