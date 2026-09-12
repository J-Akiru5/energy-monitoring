/**
 * Regression test for the sensorOffline shortcut's phase-flag synthesis.
 *
 * Bug: the shortcut synthesized { A:true, B:false, C:false } whenever the
 * payload had no `threePhase` key — which is always, in both 3-phase total
 * loss and 1-phase AUTO exhaustion. Confirmed against firmware's
 * monitor.cpp, which sends only { sensorOffline: true, phaseMode }.
 * Every real total-loss event was reported as "Phase A offline" only.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/ingest/route.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// next/* has no package.json "exports" map, so raw Node ESM cannot resolve
// the extensionless "next/server" specifier the route uses. Map it to the
// real CJS file; named exports are detected by cjs-module-lexer.
//
// Workspace packages are consumed from tsc output (packages/*/dist) whose
// relative imports are extensionless — valid for bundlers, not raw Node ESM.
// Fall back to ".js" for those relative specifiers.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier, context);
      } catch {
        return nextResolve(`${specifier}.js`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const createdAlerts = [];

// The route imports @energy/database directly; mock it so no live DB is
// touched and createAlert calls can be observed.
mock.module("@energy/database", {
  namedExports: {
    validateDeviceToken: async () => ({ id: "dev-test-1" }),
    lookupControllerByDevice: async () => null,
    getAllActiveAlertStates: async () => new Map(),
    createAlert: async (opts) => {
      createdAlerts.push({ type: opts.type, phase: opts.phase, message: opts.message });
      return { id: `alert-${createdAlerts.length}` };
    },
    getAlertState: async () => null,
    promoteAlertToIncident: async () => {},
    startAlertIncident: async () => {},
    setAlertRecovery: async () => {},
    cancelAlertRecovery: async () => {},
    endAlertIncident: async () => {},
    insertReading: async () => {},
    getAlertThresholds: async () => null,
    getRelayConfig: async () => null,
    updateRelayState: async () => {},
    logRelayAction: async () => {},
    getDeviceBlackoutState: async () => ({ inBlackout: false }),
    startBlackoutEvent: async () => {},
    endBlackoutEvent: async () => {},
  },
});

const { POST } = await import("./route.ts");

test("bare { sensorOffline: true, phaseMode: 1 } fires PZEM_OFFLINE alerts for all three phases", async () => {
  const res = await POST(
    new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-token": "test-token",
      },
      body: JSON.stringify({
        deviceId: "dev-test-1",
        timestamp: new Date().toISOString(),
        sensorOffline: true,
        phaseMode: 1,
      }),
    })
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.sensorOffline, true);

  const pzemOffline = createdAlerts.filter((a) => a.type === "PZEM_OFFLINE");
  assert.equal(
    pzemOffline.length,
    3,
    `expected 3 PZEM_OFFLINE alerts (A, B, C), got ${pzemOffline.length}: ` +
      JSON.stringify(pzemOffline.map((a) => a.phase))
  );

  assert.deepEqual(
    pzemOffline.map((a) => a.phase).sort(),
    ["A", "B", "C"],
    "all three phases must be reported, not just Phase A"
  );
});
