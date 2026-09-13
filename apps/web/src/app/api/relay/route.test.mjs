/**
 * Tests for web /api/relay — device-ownership (IDOR) guard.
 *
 * The real assertDeviceOwnership() helper runs against a mocked
 * lookupControllerByDevice(), so these tests exercise the actual
 * ownership logic integrated into the route.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/relay/route.test.mjs
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

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let currentUser = { id: "user-1" };
let currentAccess = null;
let denyAccess = false;
let stampByDevice = {};

const lookupCalls = [];
const relayStateCalls = [];
const relayConfigCalls = [];
const updateCalls = [];
const logCalls = [];

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    getRelayState: async (deviceId) => {
      relayStateCalls.push(deviceId);
      return { isTripped: false };
    },
    updateRelayState: async (deviceId, tripped) => {
      updateCalls.push([deviceId, tripped]);
      return true;
    },
    getRelayConfig: async (deviceId) => {
      relayConfigCalls.push(deviceId);
      return { relayEnabled: true };
    },
    logRelayAction: async (...args) => {
      logCalls.push(args);
    },
    lookupControllerByDevice: async (deviceId) => {
      lookupCalls.push(deviceId);
      return stampByDevice[deviceId] ?? null;
    },
  },
});

// Real ownership helper under test, wired into the mocked auth package so
// the route's assertDeviceOwnership() calls exercise actual logic.
const realOwnership = await import(
  "../../../../../../packages/auth/src/deviceOwnership.ts"
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
const { GET, POST } = await import("./route.ts");

function reset() {
  currentUser = { id: "user-1" };
  currentAccess = null;
  denyAccess = false;
  stampByDevice = {};
  lookupCalls.length = 0;
  relayStateCalls.length = 0;
  relayConfigCalls.length = 0;
  updateCalls.length = 0;
  logCalls.length = 0;
}

function getReq(deviceId) {
  return new NextRequest(`http://localhost/api/relay?deviceId=${deviceId}`);
}

function postReq(body) {
  return new NextRequest("http://localhost/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const command = (deviceId, action = "RESET") => ({
  deviceId,
  action,
  initiatedBy: "TEST",
});

// ──── GET ────────────────────────────────────────────────────────────────

test("GET same-customer device → 200, state read fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A };
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, [DEVICE_A]);
  assert.deepEqual(relayStateCalls, [DEVICE_A]);
});

test("GET cross-customer deviceId substitution → 403, state read NEVER fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B };
  const res = await GET(getReq(DEVICE_B));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, "Device not found or access denied");
  assert.deepEqual(relayStateCalls, [], "getRelayState must not run for other tenants");
});

test("GET unknown deviceId → 403, state read never fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  const res = await GET(getReq(DEVICE_B));
  assert.equal(res.status, 403);
  assert.deepEqual(relayStateCalls, []);
});

test("GET super admin → 200, ownership lookup skipped", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await GET(getReq(DEVICE_B));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(relayStateCalls, [DEVICE_B]);
});

test("GET unauthenticated → 401", async () => {
  reset();
  currentUser = null;
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 401);
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(relayStateCalls, []);
});

test("GET denied by resolveAccess → 403 (no regression)", async () => {
  reset();
  denyAccess = true;
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 403);
  assert.deepEqual(relayStateCalls, []);
});

// ──── POST (session path) ───────────────────────────────────────────────

test("POST same-customer RESET → 200, relay update fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A };
  const res = await POST(postReq(command(DEVICE_A)));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, [DEVICE_A]);
  assert.deepEqual(relayConfigCalls, [DEVICE_A]);
  assert.deepEqual(updateCalls, [[DEVICE_A, false]]);
});

test("POST cross-customer deviceId substitution → 403, NO relay action fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B };
  const res = await POST(postReq(command(DEVICE_B, "MANUAL_TRIP")));
  assert.equal(res.status, 403);
  assert.deepEqual(relayConfigCalls, [], "getRelayConfig must not run");
  assert.deepEqual(updateCalls, [], "updateRelayState must not run");
  assert.deepEqual(logCalls, [], "logRelayAction must not run");
});

test("POST super admin → 200, ownership lookup skipped, action allowed", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await POST(postReq(command(DEVICE_B)));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(updateCalls, [[DEVICE_B, false]]);
});

test("POST unauthenticated → 401, no relay action", async () => {
  reset();
  currentUser = null;
  const res = await POST(postReq(command(DEVICE_A)));
  assert.equal(res.status, 401);
  assert.deepEqual(updateCalls, []);
});

test("POST invalid command (missing deviceId) → 422, ownership check not reached", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  const res = await POST(postReq({ action: "RESET" }));
  assert.equal(res.status, 422);
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(updateCalls, []);
});
