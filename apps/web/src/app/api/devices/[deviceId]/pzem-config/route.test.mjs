/**
 * Tests for web /api/devices/[deviceId]/pzem-config — device-ownership (IDOR)
 * guard on the session paths (GET + PUT); the device-token path is unchanged
 * and covered for regression.
 *
 * Run (file path contains brackets — invoke as an entry point):
 *   node --experimental-test-module-mocks "apps/web/src/app/api/devices/[deviceId]/pzem-config/route.test.mjs"
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

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let currentUser = { id: "user-1" };
let currentAccess = null;
let denyAccess = false;
let stampByDevice = {};
let tokenDevice = null;

const lookupCalls = [];
const getConfigCalls = [];
const updateConfigCalls = [];
const alertStateCalls = [];

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    getPzemConfig: async (deviceId) => {
      getConfigCalls.push(deviceId);
      return { mode: "auto", manualSource: null };
    },
    updatePzemConfig: async (deviceId, mode, manualSource) => {
      updateConfigCalls.push([deviceId, mode, manualSource]);
      return true;
    },
    getAlertState: async (...args) => {
      alertStateCalls.push(args);
      return null;
    },
    validateDeviceToken: async () => tokenDevice,
    lookupControllerByDevice: async (deviceId) => {
      lookupCalls.push(deviceId);
      return stampByDevice[deviceId] ?? null;
    },
  },
});

// Real ownership helper under test, wired into the mocked auth package.
const realOwnership = await import(
  "../../../../../../../../packages/auth/src/deviceOwnership.ts"
);

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
    assertDeviceOwnership: realOwnership.assertDeviceOwnership,
    DeviceAccessDeniedError: realOwnership.DeviceAccessDeniedError,
  },
});

const { NextRequest } = await import("next/server");
const { GET, PUT } = await import("./route.ts");

function reset() {
  currentUser = { id: "user-1" };
  currentAccess = null;
  denyAccess = false;
  stampByDevice = {};
  tokenDevice = null;
  lookupCalls.length = 0;
  getConfigCalls.length = 0;
  updateConfigCalls.length = 0;
  alertStateCalls.length = 0;
}

const ctx = (deviceId) => ({ params: Promise.resolve({ deviceId }) });
const url = (deviceId) => `http://localhost/api/devices/${deviceId}/pzem-config`;

// ──── GET (session path) ────────────────────────────────────────────────

test("GET session, same-customer device → 200, config read fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A };
  const res = await GET(new NextRequest(url(DEVICE_A)), ctx(DEVICE_A));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, [DEVICE_A]);
  assert.deepEqual(getConfigCalls, [DEVICE_A]);
});

test("GET session, cross-customer URL substitution → 403, config read NEVER fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B };
  const res = await GET(new NextRequest(url(DEVICE_B)), ctx(DEVICE_B));
  assert.equal(res.status, 403);
  assert.deepEqual(getConfigCalls, [], "getPzemConfig must not run for other tenants");
});

test("GET session, unknown deviceId → 403", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  const res = await GET(new NextRequest(url(DEVICE_B)), ctx(DEVICE_B));
  assert.equal(res.status, 403);
  assert.deepEqual(getConfigCalls, []);
});

test("GET session, super admin → 200, ownership lookup skipped", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await GET(new NextRequest(url(DEVICE_B)), ctx(DEVICE_B));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(getConfigCalls, [DEVICE_B]);
});

test("GET session, unauthenticated → 401", async () => {
  reset();
  currentUser = null;
  const res = await GET(new NextRequest(url(DEVICE_A)), ctx(DEVICE_A));
  assert.equal(res.status, 401);
  assert.deepEqual(getConfigCalls, []);
});

// ──── GET (device-token path — unchanged) ───────────────────────────────

test("GET device-token path, token matches device → 200, no session ownership lookup", async () => {
  reset();
  tokenDevice = { id: DEVICE_A };
  const req = new NextRequest(url(DEVICE_A), {
    headers: { "x-device-token": "token-a" },
  });
  const res = await GET(req, ctx(DEVICE_A));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, [], "device-token path is scoped by the token itself");
  assert.deepEqual(getConfigCalls, [DEVICE_A]);
});

test("GET device-token path, token belongs to another device → 401", async () => {
  reset();
  tokenDevice = { id: DEVICE_A };
  const req = new NextRequest(url(DEVICE_B), {
    headers: { "x-device-token": "token-a" },
  });
  const res = await GET(req, ctx(DEVICE_B));
  assert.equal(res.status, 401);
  assert.deepEqual(getConfigCalls, []);
});

// ──── PUT (session path) ────────────────────────────────────────────────

function putReq(deviceId, body) {
  return new NextRequest(url(deviceId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PUT same-customer device → 200, config write fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A };
  const res = await PUT(putReq(DEVICE_A, { mode: "auto" }), ctx(DEVICE_A));
  assert.equal(res.status, 200);
  assert.deepEqual(updateConfigCalls, [[DEVICE_A, "auto", null]]);
});

test("PUT cross-customer URL substitution → 403, config write NEVER fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B };
  const res = await PUT(
    putReq(DEVICE_B, { mode: "manual", manualSource: "B" }),
    ctx(DEVICE_B)
  );
  assert.equal(res.status, 403);
  assert.deepEqual(updateConfigCalls, [], "updatePzemConfig must not run");
  assert.deepEqual(alertStateCalls, [], "offline-phase check must not run");
});

test("PUT super admin → 200, ownership lookup skipped", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await PUT(putReq(DEVICE_B, { mode: "auto" }), ctx(DEVICE_B));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(updateConfigCalls, [[DEVICE_B, "auto", null]]);
});

test("PUT unauthenticated → 401, no config write", async () => {
  reset();
  currentUser = null;
  const res = await PUT(putReq(DEVICE_A, { mode: "auto" }), ctx(DEVICE_A));
  assert.equal(res.status, 401);
  assert.deepEqual(updateConfigCalls, []);
});
