/**
 * Tests for tenant stamping on the four telemetry write paths that
 * previously left customer_id/emu_id NULL: createAlert, logRelayAction,
 * startBlackoutEvent, startAlertIncident.
 *
 * The stamp is resolved via lookupControllerByDevice(); when the device has
 * no controller bridge the stamp stays NULL (fail-closed, matching ingest's
 * graceful degradation).
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/database/src/queries/stamping.test.mjs
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

const ops = [];

function fakeSupabase() {
  return {
    from(table) {
      const builder = {
        insert(payload) {
          ops.push({ table, op: "insert", payload });
          return builder;
        },
        upsert(payload, opts) {
          ops.push({ table, op: "upsert", payload, opts });
          return builder;
        },
        select() {
          return builder;
        },
        single() {
          return Promise.resolve({ data: { id: `${table}-id` }, error: null });
        },
        then(resolve) {
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

let stampResult = null;

mock.module("../client.ts", {
  namedExports: { getSupabaseAdmin: fakeSupabase },
});

mock.module("./tenant.ts", {
  namedExports: {
    lookupControllerByDevice: async () => stampResult,
  },
});

const { createAlert } = await import("./alerts.ts");
const { logRelayAction } = await import("./relay.ts");
const { startBlackoutEvent } = await import("./blackouts.ts");
const { startAlertIncident } = await import("./alertState.ts");

const STAMP = {
  customerId: "cust-1",
  emuId: "emu-1",
  installationId: "inst-1",
  controllerId: "ctrl-1",
  phaseConfig: "SINGLE_PHASE",
};

function reset() {
  ops.length = 0;
  stampResult = STAMP;
}

test("createAlert stamps customer_id and emu_id", async () => {
  reset();
  await createAlert({
    deviceId: "dev-1",
    type: "OVERVOLTAGE",
    value: 250,
    threshold: 250,
    message: "test",
  });
  const insert = ops.find((o) => o.table === "alerts" && o.op === "insert");
  assert.equal(insert.payload.customer_id, "cust-1");
  assert.equal(insert.payload.emu_id, "emu-1");
});

test("logRelayAction stamps customer_id and emu_id", async () => {
  reset();
  await logRelayAction("dev-1", "STATUS_CHECK", undefined, undefined, undefined, undefined, "TEST");
  const insert = ops.find((o) => o.table === "relay_logs" && o.op === "insert");
  assert.equal(insert.payload.customer_id, "cust-1");
  assert.equal(insert.payload.emu_id, "emu-1");
});

test("startBlackoutEvent stamps customer_id and emu_id", async () => {
  reset();
  await startBlackoutEvent("dev-1", "alert-1");
  const insert = ops.find((o) => o.table === "blackout_events" && o.op === "insert");
  assert.equal(insert.payload.customer_id, "cust-1");
  assert.equal(insert.payload.emu_id, "emu-1");
});

test("startAlertIncident stamps customer_id and emu_id on the upsert", async () => {
  reset();
  await startAlertIncident("dev-1", "OVERVOLTAGE", "", "alert-1");
  const upsert = ops.find((o) => o.table === "device_alert_state" && o.op === "upsert");
  assert.equal(upsert.payload.customer_id, "cust-1");
  assert.equal(upsert.payload.emu_id, "emu-1");
});

test("all four writers fall back to NULL stamps when no controller bridge exists", async () => {
  reset();
  stampResult = null;

  await createAlert({
    deviceId: "dev-orphan",
    type: "OVERVOLTAGE",
    value: 250,
    threshold: 250,
    message: "test",
  });
  await logRelayAction("dev-orphan", "STATUS_CHECK");
  await startBlackoutEvent("dev-orphan");
  await startAlertIncident("dev-orphan", "OVERVOLTAGE", "", "alert-1");

  const stampedTables = ["alerts", "relay_logs", "blackout_events", "device_alert_state"];
  const writes = ops.filter(
    (o) => (o.op === "insert" || o.op === "upsert") && stampedTables.includes(o.table)
  );
  assert.equal(writes.length, 4);
  for (const w of writes) {
    assert.equal(w.payload.customer_id, null, `${w.table} customer_id must be null`);
    assert.equal(w.payload.emu_id, null, `${w.table} emu_id must be null`);
  }
});
