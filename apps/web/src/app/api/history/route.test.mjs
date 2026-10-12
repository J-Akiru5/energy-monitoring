/**
 * Tests for web /api/history — row completeness and the shared energy-delta
 * method.
 *
 * Pre-fix the readings query has no limit/range, so PostgREST's default
 * max-rows (1000) silently truncates week/month windows (oldest-first), and
 * computeSummary uses last-first energy, which a counter reset zeroes out.
 * These tests assert the desired behavior and fail against the pre-fix code.
 *
 * @energy/database and @energy/auth are mocked; the readings fake honors
 * filters, ordering, limit, and range, and caps unbounded queries at 1000
 * rows (Supabase's default max-rows).
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/history/route.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "next/headers") {
      return {
        url: "data:text/javascript,export%20async%20function%20cookies()%20%7B%20return%20%7B%7D%3B%20%7D",
        shortCircuit: true,
      };
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier, context);
      } catch {
        try {
          return nextResolve(`${specifier}.ts`, context);
        } catch {
          return nextResolve(`${specifier}.js`, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

function makeFakeDatabase(tables) {
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

  return { client: { from } };
}

let fake = makeFakeDatabase({ power_readings: [], alerts: [] });
let currentUser = { id: "user-1" };
let denyAccess = false;

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    getSupabaseAdmin: () => fake.client,
    getBillingRate: async () => ({ rate_php_per_kwh: 10 }),
  },
});

mock.module("@energy/auth", {
  namedExports: {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: currentUser } }) },
    }),
    resolveAccess: async () => {
      if (denyAccess) throw new AccessDeniedError("denied");
      return { customerId: "cust-1", permissions: [], isSuperAdmin: false };
    },
    AccessDeniedError,
  },
});

const { NextRequest } = await import("next/server");
const { GET } = await import("./route.ts");

function makeRow(i, energy, baseIso = "2026-10-01T00:00:00.000Z") {
  const ts = new Date(Date.parse(baseIso) + i * 10 * 60 * 1000).toISOString();
  return {
    id: i + 1,
    device_id: "dev-1",
    customer_id: "cust-1",
    recorded_at: ts,
    voltage: 220,
    current_amp: 1,
    power_w: 200,
    energy_kwh: energy,
  };
}

function historyReq() {
  return new NextRequest(
    "http://localhost/api/history?deviceId=dev-1&period=month&date=2026-10-15&metric=energy_kwh"
  );
}

test("month window is fully paginated (no 1000-row cap)", async () => {
  // 1500 rows: first 1000 add 0.001 kWh each (+1), last 500 add 0.01 (+5).
  // True total = 6 kWh; the pre-fix 1000-row cap yields only 1 kWh.
  const rows = [];
  let energy = 50;
  for (let i = 0; i < 1500; i++) {
    energy = Number((energy + (i < 1000 ? 0.001 : 0.01)).toFixed(6));
    rows.push(makeRow(i, energy));
  }
  fake = makeFakeDatabase({ power_readings: rows, alerts: [] });

  const res = await GET(historyReq());
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.sampleCount, 1500, "all 1500 rows must be read");
  assert.ok(
    Math.abs(json.summary.totalKwh - 6) < 0.01,
    `expected ~6 kWh from the full window, got ${json.summary.totalKwh}`
  );
  // Month charts are bucketed by day; the per-day deltas must sum back to
  // the window total for a monotonic counter.
  const bucketSum = json.chartPoints.reduce((sum, point) => sum + point.value, 0);
  assert.ok(
    Math.abs(bucketSum - 6) < 0.01,
    `day-bucket deltas should sum to the window total, got ${bucketSum}`
  );
});

test("total uses the shared monotonic delta across a counter reset", async () => {
  const energies = [100, 110, 0, 5, 12];
  const rows = energies.map((e, i) => makeRow(i, e));
  fake = makeFakeDatabase({ power_readings: rows, alerts: [] });

  const res = await GET(historyReq());
  assert.equal(res.status, 200);
  const json = await res.json();

  // +10, reset ignored, +5, +7 = 22 kWh (last-first would give 0)
  assert.ok(
    Math.abs(json.summary.totalKwh - 22) < 0.001,
    `expected 22 kWh across the reset, got ${json.summary.totalKwh}`
  );
});

// ── Live-sample statistics and voltage/current charts ──────────────────────

function dayReq(metric, date = "2026-10-08") {
  return new NextRequest(
    `http://localhost/api/history?deviceId=dev-1&period=day&date=${date}&metric=${metric}`
  );
}

function sampleRow(i, overrides = {}) {
  return {
    id: i + 1,
    device_id: "dev-1",
    customer_id: "cust-1",
    // 2026-10-08 PH day = 2026-10-07T16:00Z .. 2026-10-08T16:00Z
    recorded_at: new Date(Date.parse("2026-10-07T17:00:00.000Z") + i * 60 * 1000).toISOString(),
    voltage: null,
    current_amp: null,
    power_w: null,
    energy_kwh: 50 + i * 0.01,
    ...overrides,
  };
}

test("averages ignore offline/zero samples and fall back to the energised phase", async () => {
  const rows = [
    // Legacy (phase A) tap energised
    sampleRow(0, { voltage: 230, current_amp: 2, power_w: 400 }),
    // Legacy tap reads 0 but phase B carries the load — must still count
    sampleRow(1, { voltage: 0, current_amp: 0, power_w: 500, voltage_b: 240, current_b: 3 }),
    // Offline samples: zeros and NULLs carry no measurement
    sampleRow(2, { voltage: 0, current_amp: 0, power_w: 0 }),
    sampleRow(3, { voltage: null, current_amp: null, power_w: null }),
    sampleRow(4, { voltage: 0, current_amp: 0, power_w: 0, voltage_a: 0, voltage_b: 0, voltage_c: 0 }),
  ];
  fake = makeFakeDatabase({ power_readings: rows, alerts: [] });

  const res = await GET(dayReq("energy_kwh"));
  assert.equal(res.status, 200);
  const { summary, sampleCount } = await res.json();

  assert.equal(sampleCount, 5);
  assert.equal(summary.liveSampleCount, 2);
  assert.equal(summary.averageVoltage, 235); // (230 + 240) / 2, not 94
  assert.equal(summary.averageCurrent, 2.5); // (2 + 3) / 2, not 1
  assert.equal(summary.averagePower, 450); // (400 + 500) / 2
  assert.equal(summary.peakPower, 500);
  assert.equal(summary.minVoltage, 230, "min voltage must not report the 0 V offline samples");
  assert.equal(summary.maxVoltage, 240);
});

test("voltage and current charts plot recorded readings, not flat-zero offline rows", async () => {
  const rows = [
    sampleRow(0, { voltage: 230, current_amp: 2, power_w: 400 }),
    sampleRow(1, { voltage: 0, current_amp: 0, power_w: 500, voltage_c: 238, current_c: 1.5 }),
    sampleRow(2, { voltage: 0, current_amp: 0, power_w: 0 }),
  ];
  fake = makeFakeDatabase({ power_readings: rows, alerts: [] });

  const voltage = await (await GET(dayReq("voltage"))).json();
  assert.deepEqual(
    voltage.chartPoints.map((p) => p.value),
    [230, 238]
  );

  const current = await (await GET(dayReq("current_amp"))).json();
  assert.deepEqual(
    current.chartPoints.map((p) => p.value),
    [2, 1.5]
  );

  // The energy meter reading still plots every row
  const energy = await (await GET(dayReq("energy_kwh"))).json();
  assert.equal(energy.chartPoints.length, 3);
});

test("a window with no live samples returns an empty voltage chart and zeroed stats", async () => {
  fake = makeFakeDatabase({
    power_readings: [sampleRow(0, { voltage: 0, current_amp: 0, power_w: 0 })],
    alerts: [],
  });

  const json = await (await GET(dayReq("voltage"))).json();
  assert.equal(json.chartPoints.length, 0);
  assert.equal(json.summary.liveSampleCount, 0);
  assert.equal(json.summary.minVoltage, 0);
  assert.equal(json.summary.averageVoltage, 0);
});

test("month voltage chart averages only live samples per day", async () => {
  const rows = [
    sampleRow(0, { voltage: 220, current_amp: 1 }),
    sampleRow(1, { voltage: 0, current_amp: 0 }),
    sampleRow(2, { voltage: 240, current_amp: 3 }),
  ];
  fake = makeFakeDatabase({ power_readings: rows, alerts: [] });

  const req = new NextRequest(
    "http://localhost/api/history?deviceId=dev-1&period=month&date=2026-10-15&metric=voltage"
  );
  const json = await (await GET(req)).json();
  assert.equal(json.chartPoints.length, 1);
  assert.equal(json.chartPoints[0].value, 230); // (220 + 240) / 2, offline row excluded
});
