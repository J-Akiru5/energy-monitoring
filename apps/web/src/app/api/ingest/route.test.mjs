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
const relayEvents = [];

let currentDeviceId = "dev-test-1";
let thresholdsResult = null;
let relayConfigResult = null;
let relayStateResult = { isTripped: false };

// The route imports @energy/database directly; mock it so no live DB is
// touched and createAlert / relay mutations can be observed.
mock.module("@energy/database", {
  namedExports: {
    validateDeviceToken: async () => ({ id: currentDeviceId }),
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
    getAlertThresholds: async () => thresholdsResult,
    getRelayConfig: async () => relayConfigResult,
    getRelayState: async () => relayStateResult,
    updateRelayState: async (deviceId, isTripped, reason, alertId) => {
      relayEvents.push({ kind: "state", deviceId, isTripped, reason, alertId });
    },
    logRelayAction: async (...args) => {
      relayEvents.push({ kind: "log", args });
    },
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

test("malformed JSON body → 400 (not 500)", async () => {
  const res = await POST(
    new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-token": "test-token",
      },
      body: "{not-json",
    })
  );
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, "Invalid JSON body");
});

// ── Auto-trip / local-trip coverage ──────────────────────────────────────

const THRESHOLDS = { overvoltage: 250, undervoltage: 200, overcurrent: 80, high_power: 5000 };
const FULL_AUTO_TRIP = {
  relayEnabled: true,
  autoTripEnabled: true,
  tripOnOvervoltage: true,
  tripOnUndervoltage: true,
  tripOnOvercurrent: true,
};

function singlePhasePayload(readingOverrides = {}) {
  return {
    deviceId: currentDeviceId,
    timestamp: new Date().toISOString(),
    reading: {
      voltage: 220,
      current: 1,
      power: 220,
      energy: 0.1,
      frequency: 60,
      powerFactor: 0.95,
      ...readingOverrides,
    },
  };
}

function postReading(payload) {
  return POST(
    new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-token": "test-token",
      },
      body: JSON.stringify(payload),
    })
  );
}

function tripStateEvents() {
  return relayEvents.filter((e) => e.kind === "state" && e.isTripped);
}

test("overvoltage onset with auto-trip enabled trips the relay", async () => {
  currentDeviceId = "dev-ov-1";
  createdAlerts.length = 0;
  relayEvents.length = 0;
  thresholdsResult = THRESHOLDS;
  relayConfigResult = FULL_AUTO_TRIP;
  relayStateResult = { isTripped: false };

  const res = await postReading(singlePhasePayload({ voltage: 265 }));
  assert.equal(res.status, 200);

  const trips = tripStateEvents();
  assert.equal(trips.length, 1, "exactly one trip must be issued for the onset reading");
  assert.equal(trips[0].reason, "OVERVOLTAGE");
  assert.equal(
    createdAlerts.filter((a) => a.type === "OVERVOLTAGE").length,
    1,
    "the threshold alert is still created alongside the trip"
  );
});

test("master switch relayEnabled=false suppresses auto-trip but not the alert", async () => {
  currentDeviceId = "dev-ov-2";
  createdAlerts.length = 0;
  relayEvents.length = 0;
  thresholdsResult = THRESHOLDS;
  relayConfigResult = { ...FULL_AUTO_TRIP, relayEnabled: false };
  relayStateResult = { isTripped: false };

  const res = await postReading(singlePhasePayload({ voltage: 265 }));
  assert.equal(res.status, 200);

  assert.equal(tripStateEvents().length, 0, "relay master switch must gate auto-trip");
  assert.equal(createdAlerts.filter((a) => a.type === "OVERVOLTAGE").length, 1);
});

test("per-condition flag off suppresses auto-trip", async () => {
  currentDeviceId = "dev-ov-3";
  createdAlerts.length = 0;
  relayEvents.length = 0;
  thresholdsResult = THRESHOLDS;
  relayConfigResult = { ...FULL_AUTO_TRIP, tripOnOvervoltage: false };
  relayStateResult = { isTripped: false };

  const res = await postReading(singlePhasePayload({ voltage: 265 }));
  assert.equal(res.status, 200);
  assert.equal(tripStateEvents().length, 0);
});

test("manual reset under a persistent fault is re-tripped on the next reading", async () => {
  currentDeviceId = "dev-ov-4";
  createdAlerts.length = 0;
  relayEvents.length = 0;
  thresholdsResult = THRESHOLDS;
  relayConfigResult = FULL_AUTO_TRIP;
  relayStateResult = { isTripped: false };

  const first = await postReading(singlePhasePayload({ voltage: 265 }));
  assert.equal(first.status, 200);
  assert.equal(tripStateEvents().length, 1);

  // Admin reset the relay while the overvoltage is still present.
  relayEvents.length = 0;
  relayStateResult = { isTripped: false };
  const alertsBefore = createdAlerts.length;

  // Respect the 1 request/second per-device rate limit.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = await postReading(singlePhasePayload({ voltage: 265 }));
  assert.equal(second.status, 200);

  assert.equal(
    tripStateEvents().length,
    1,
    "a reset must not leave the relay closed while the fault persists"
  );
  assert.equal(
    createdAlerts.length,
    alertsBefore,
    "re-trip is not accompanied by a duplicate alert"
  );
});

// Widen the cloud thresholds so the *local* trip path is the only one that
// classifies the reading in these two tests.
const LOOSE_THRESHOLDS = { overvoltage: 300, undervoltage: 100, overcurrent: 200, high_power: 99999 };

test("local OV trip with phase suffix is classified as OVERVOLTAGE, not UNDERVOLTAGE", async () => {
  currentDeviceId = "dev-local-1";
  createdAlerts.length = 0;
  relayEvents.length = 0;
  thresholdsResult = LOOSE_THRESHOLDS;
  relayConfigResult = null;
  relayStateResult = { isTripped: false };

  const res = await postReading({
    ...singlePhasePayload({ voltage: 268 }),
    localTrip: true,
    localTripReason: "LOCAL_OVERVOLTAGE_PHASE_B",
  });
  assert.equal(res.status, 200);

  const localAlerts = createdAlerts.filter((a) => a.type === "OVERVOLTAGE");
  assert.equal(localAlerts.length, 1, "phase-suffixed local OV must classify as OVERVOLTAGE");
  assert.match(localAlerts[0].message, /LOCAL SAFETY TRIP/);
  assert.equal(
    createdAlerts.filter((a) => a.type === "UNDERVOLTAGE").length,
    0,
    "phase-suffixed local OV must not be misclassified as UNDERVOLTAGE"
  );
  const trip = tripStateEvents()[0];
  assert.equal(trip.reason, "LOCAL_OVERVOLTAGE_PHASE_B");
});

test("local OC trip with phase suffix is classified as OVERCURRENT", async () => {
  currentDeviceId = "dev-local-2";
  createdAlerts.length = 0;
  relayEvents.length = 0;
  thresholdsResult = LOOSE_THRESHOLDS;
  relayConfigResult = null;
  relayStateResult = { isTripped: false };

  const res = await postReading({
    ...singlePhasePayload({ current: 95 }),
    localTrip: true,
    localTripReason: "LOCAL_OVERCURRENT_PHASE_A",
  });
  assert.equal(res.status, 200);

  assert.equal(createdAlerts.filter((a) => a.type === "OVERCURRENT").length, 1);
  assert.equal(tripStateEvents()[0].reason, "LOCAL_OVERCURRENT_PHASE_A");
});

test("payload deviceId that does not match the token's device → 401", async () => {
  const res = await POST(
    new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-token": "test-token",
      },
      body: JSON.stringify({
        deviceId: "some-other-device",
        timestamp: new Date().toISOString(),
        reading: {
          voltage: 220,
          current: 1,
          power: 220,
          energy: 0.1,
          frequency: 60,
          powerFactor: 0.95,
        },
      }),
    })
  );
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.match(json.error, /does not match/);
});
