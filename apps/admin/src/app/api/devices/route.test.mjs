/**
 * Tests for /api/devices (admin) — super-admin vs customer scoping.
 *
 * Covers:
 *   - Super Admin GET → unscoped listDevices() call (no "*" sentinel leak)
 *   - Normal user GET → customer-scoped listDevices(customerId)
 *   - demo1-style expired-grant fallback → scoped WVSU query
 *   - Super Admin PATCH → no false 403 from the "*" sentinel
 *   - Normal user PATCH → ownership enforced
 *   - Unauthenticated / denied cases preserved
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/admin/src/app/api/devices/route.test.mjs
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
const lookupCalls = [];
const deactivateCalls = [];

let listResult = [{ id: "d566ef3b", name: "ESP32-CICT-001", is_active: true }];
let lookupResult = null;

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    listDevices: async (...args) => {
      listCalls.push(args);
      return listResult;
    },
    deactivateDevice: async (deviceId) => {
      deactivateCalls.push(deviceId);
    },
    lookupControllerByDevice: async (deviceId) => {
      lookupCalls.push(deviceId);
      return lookupResult;
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

const { GET, PATCH } = await import("./route.ts");

function reset() {
  currentUser = { id: "user-1" };
  currentAccess = null;
  denyAccess = false;
  listCalls.length = 0;
  lookupCalls.length = 0;
  deactivateCalls.length = 0;
  lookupResult = null;
  listResult = [{ id: "d566ef3b", name: "ESP32-CICT-001", is_active: true }];
}

function patchReq(deviceId, action = "deactivate") {
  return new Request("http://localhost/api/devices", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, action }),
  });
}

test("Super Admin GET → unscoped listDevices(), no sentinel leak", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls, [[]], "must call listDevices() with no customerId");
  const json = await res.json();
  assert.equal(json.devices.length, 1);
});

test("normal customer user GET → scoped listDevices(customerId)", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: WVSU, permissions: ["manage_devices"] };
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls, [[WVSU]]);
});

test("demo1-style expired-grant fallback → WVSU-scoped query shows the device", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: WVSU, permissions: ["manage_devices"] };
  const res = await GET();
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls, [[WVSU]]);
  assert.equal(json.devices[0].id, "d566ef3b");
});

test("Super Admin PATCH deactivate → allowed without ownership lookup", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await PATCH(patchReq("device-x"));
  assert.equal(res.status, 200);
  assert.deepEqual(deactivateCalls, ["device-x"]);
  assert.deepEqual(lookupCalls, [], "super admin must not need the ownership bridge");
});

test("normal user PATCH within own customer → allowed", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: WVSU, permissions: ["manage_devices"] };
  lookupResult = { customerId: WVSU };
  const res = await PATCH(patchReq("device-x"));
  assert.equal(res.status, 200);
  assert.deepEqual(deactivateCalls, ["device-x"]);
});

test("normal user PATCH outside own customer → 403, no deactivation", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: WVSU, permissions: ["manage_devices"] };
  lookupResult = { customerId: "some-other-customer" };
  const res = await PATCH(patchReq("device-x"));
  assert.equal(res.status, 403);
  assert.deepEqual(deactivateCalls, []);
});

test("normal user PATCH unknown device → 403, no deactivation", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: WVSU, permissions: ["manage_devices"] };
  lookupResult = null;
  const res = await PATCH(patchReq("device-x"));
  assert.equal(res.status, 403);
  assert.deepEqual(deactivateCalls, []);
});

test("unauthenticated GET → 401", async () => {
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
