/**
 * Tests for web /api/reports/pdf — the PDF must generate for every
 * metric x phase combination. Pre-fix these fail with HTTP 500 because
 * the "Window:" line contains U+2192 (→), which pdf-lib's WinAnsi
 * Helvetica cannot encode.
 *
 * ../_lib is mocked so no database is touched; the real line builder and
 * sanitizer under ./_lines are exercised.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/reports/pdf/route.test.mjs
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

let currentUser = { id: "user-1" };
let denyAccess = false;

class AccessDeniedError extends Error {}

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

function makeSummary(deviceId, filters) {
  return {
    generatedAt: "2026-10-04T07:00:00.000Z",
    deviceId,
    ratePhpPerKwh: 10,
    filters,
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

mock.module("../_lib.ts", {
  namedExports: {
    parseReportFilters: (searchParams) => ({
      preset: "current_month",
      fromIso: "2026-10-01T00:00:00.000Z",
      toIso: "2026-10-04T07:00:00.000Z",
      phase: searchParams.get("phase") ?? "total",
      metric: searchParams.get("metric") ?? "kwh",
      alertOnly: false,
      includeBlackout: true,
    }),
    buildConsumptionSummary: async (deviceId, _customerId, filters) =>
      makeSummary(deviceId, filters),
  },
});

const { NextRequest } = await import("next/server");
const { GET } = await import("./route.ts");

const METRICS = ["kwh", "cost", "power"];
const PHASES = ["a", "b", "c", "total"];

for (const metric of METRICS) {
  for (const phase of PHASES) {
    test(`generates a PDF for metric=${metric} phase=${phase}`, async () => {
      currentUser = { id: "user-1" };
      denyAccess = false;
      const res = await GET(
        new NextRequest(
          `http://localhost/api/reports/pdf?deviceId=dev-1&metric=${metric}&phase=${phase}`
        )
      );
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
      assert.equal(res.headers.get("content-type"), "application/pdf");
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF");
      assert.ok(buf.length > 500, "PDF should have real content");
    });
  }
}

test("unauthenticated → 401", async () => {
  currentUser = null;
  const res = await GET(
    new NextRequest("http://localhost/api/reports/pdf?deviceId=dev-1")
  );
  assert.equal(res.status, 401);
});
