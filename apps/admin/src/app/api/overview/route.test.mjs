/**
 * Tests for /api/overview (admin) — metric scoping consistency with /api/devices.
 *
 * Covers:
 *   - Super Admin → global device list + unfiltered readings count + global alerts
 *   - Normal user (demo1-style expired-grant fallback) → customer-scoped
 *     devices, readings count filtered by customer_id, scoped alerts
 *   - Unauthenticated / denied preserved
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/admin/src/app/api/overview/route.test.mjs
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
        return nextResolve(`${specifier}.js`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const WVSU = "333fad51-50b2-4cdb-82e6-1c493f499a5c";

let currentUser = { id: "user-1" };
let currentAccess = null;
let denyAccess = false;

const listCalls = [];
const unreadCalls = [];
const readingsFilters = [];
let globalAlertsQueryUsed = false;

const READING_COUNT = 92987;
const GLOBAL_ALERT_ROWS = Array.from({ length: 50 }, (_, i) => ({ id: i }));
const SCOPED_ALERT_ROWS = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
const DEVICES = [
  { id: "d566ef3b", name: "ESP32-CICT-001" },
  { id: "test-1", name: "TEST Device" },
];

function makeClient() {
  return {
    from(table) {
      if (table === "power_readings") {
        const chain = {
          eq: (col, val) => {
            readingsFilters.push([col, val]);
            return chain;
          },
          then: (resolve, reject) =>
            Promise.resolve({ count: READING_COUNT, error: null }).then(resolve, reject),
        };
        return { select: () => chain };
      }
      if (table === "alerts") {
        globalAlertsQueryUsed = true;
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (resolve, reject) =>
            Promise.resolve({ data: GLOBAL_ALERT_ROWS, error: null }).then(resolve, reject),
        };
        return { select: () => chain };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    getSupabaseAdmin: () => makeClient(),
    getUnreadAlerts: async (customerId) => {
      unreadCalls.push(customerId);
      return SCOPED_ALERT_ROWS;
    },
    listDevices: async (...args) => {
      listCalls.push(args);
      return DEVICES;
    },
  },
});

mock.module("@energy/auth", {
  namedExports: {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: currentUser } }) },
    }),
    resolveAccess: async () => {
      if (denyAccess) throw new AccessDeniedError("denied");
      return currentAccess;
    },
    AccessDeniedError,
  },
});

const { GET } = await import("./route.ts");

function reset() {
  currentUser = { id: "user-1" };
  currentAccess = null;
  denyAccess = false;
  listCalls.length = 0;
  unreadCalls.length = 0;
  readingsFilters.length = 0;
  globalAlertsQueryUsed = false;
}

test("Super Admin → global devices, unfiltered readings, global alerts", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls, [[]], "super admin device list must be unscoped");
  assert.deepEqual(readingsFilters, [], "super admin readings count must be unfiltered");
  assert.equal(globalAlertsQueryUsed, true);
  assert.deepEqual(unreadCalls, [], "super admin must not use the scoped alerts helper");
  const json = await res.json();
  assert.equal(json.activeDevices, DEVICES.length);
  assert.equal(json.totalReadings, READING_COUNT);
  assert.equal(json.unreadAlerts, GLOBAL_ALERT_ROWS.length);
});

test("normal customer user → scoped devices, readings, and alerts", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: WVSU, permissions: ["view_energy"] };
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls, [[WVSU]], "devices must be scoped to the customer");
  assert.deepEqual(readingsFilters, [["customer_id", WVSU]], "readings count must be customer-filtered");
  assert.deepEqual(unreadCalls, [WVSU]);
  assert.equal(globalAlertsQueryUsed, false);
  const json = await res.json();
  assert.equal(json.activeDevices, DEVICES.length);
  assert.equal(json.totalReadings, READING_COUNT);
  assert.equal(json.unreadAlerts, SCOPED_ALERT_ROWS.length);
});

test("unauthenticated → 401", async () => {
  reset();
  currentUser = null;
  const res = await GET();
  assert.equal(res.status, 401);
  assert.deepEqual(listCalls, []);
});

test("AccessDeniedError → 403 (no regression)", async () => {
  reset();
  denyAccess = true;
  const res = await GET();
  assert.equal(res.status, 403);
  assert.deepEqual(listCalls, []);
});
