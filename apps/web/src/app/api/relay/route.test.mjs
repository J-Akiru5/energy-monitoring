/**
 * Combined tests for web /api/relay — union of both feature branches:
 *   - PR #8 (main-only): X-Device-Token GET path (spoofing-scope tests)
 *   - PR #18 (develop): device-ownership (IDOR) guard on session paths
 *
 * The real assertDeviceOwnership() helper runs against a mocked
 * lookupControllerByDevice(), so the ownership tests exercise actual logic.
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

// Token-path identities (PR #8 tests use string ids; no UUID validation there)
const TOKEN_DEVICE_A = { id: "device-a", is_active: true, api_key_hash: "token-a" };
const TOKEN_DEVICE_B = { id: "device-b", is_active: true, api_key_hash: "token-b" };

// Session-path identities (PR #18 tests)
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
    validateDeviceToken: async (token) => {
      if (token === "token-a") return TOKEN_DEVICE_A;
      if (token === "token-b") return TOKEN_DEVICE_B;
      return null;
    },
    getRelayState: async (deviceId) => {
      relayStateCalls.push(deviceId);
      // Distinguishable per-device payload so leaks are visible in assertions.
      return { deviceId, isTripped: deviceId === "device-b" };
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
      return true;
    },
    lookupControllerByDevice: async (deviceId) => {
      lookupCalls.push(deviceId);
      return stampByDevice[deviceId] ?? null;
    },
  },
});

// Real ownership helper under test, wired into the mocked auth package.
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

function makeReq(url, headers = {}) {
  return new NextRequest(url, { headers });
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

// ──── GET — device-token path (PR #8) ───────────────────────────────────

test("token: valid token A + deviceId=B returns only A's state (spoofing blocked)", async () => {
  reset();
  const res = await GET(
    makeReq("http://localhost/api/relay?deviceId=device-b", { "x-device-token": "token-a" })
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.state.deviceId, "device-a", "must return device A's state, never B's");
  assert.deepEqual(relayStateCalls, ["device-a"], "DB read must be scoped to the token's device");
});

test("token: valid token A + absent deviceId returns A's state", async () => {
  reset();
  const res = await GET(makeReq("http://localhost/api/relay", { "x-device-token": "token-a" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.state.deviceId, "device-a");
  assert.deepEqual(relayStateCalls, ["device-a"]);
});

test("token: valid token A + matching deviceId=A returns A's state", async () => {
  reset();
  const res = await GET(
    makeReq("http://localhost/api/relay?deviceId=device-a", { "x-device-token": "token-a" })
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.state.deviceId, "device-a");
  assert.deepEqual(relayStateCalls, ["device-a"]);
});

test("token: invalid/inactive token returns 401 and never reads relay state", async () => {
  reset();
  const res = await GET(
    makeReq("http://localhost/api/relay?deviceId=device-b", { "x-device-token": "bogus" })
  );
  assert.equal(res.status, 401);
  assert.deepEqual(relayStateCalls, [], "no state read may happen for an invalid token");
});

// ──── GET — session path + ownership (PR #18) ───────────────────────────

test("session: no token, unauthenticated → 401 (token path falls through)", async () => {
  reset();
  currentUser = null;
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 401);
  assert.deepEqual(relayStateCalls, [], "no state read without auth");
});

test("session GET same-customer device → 200, state read fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A };
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, [DEVICE_A]);
  assert.deepEqual(relayStateCalls, [DEVICE_A]);
});

test("session GET cross-customer deviceId substitution → 403, state read NEVER fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B };
  const res = await GET(getReq(DEVICE_B));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, "Device not found or access denied");
  assert.deepEqual(relayStateCalls, [], "getRelayState must not run for other tenants");
});

test("session GET unknown deviceId → 403, state read never fires", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  const res = await GET(getReq(DEVICE_B));
  assert.equal(res.status, 403);
  assert.deepEqual(relayStateCalls, []);
});

test("session GET super admin → 200, ownership lookup skipped", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  const res = await GET(getReq(DEVICE_B));
  assert.equal(res.status, 200);
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(relayStateCalls, [DEVICE_B]);
});

test("session GET denied by resolveAccess → 403 (no regression)", async () => {
  reset();
  denyAccess = true;
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 403);
  assert.deepEqual(relayStateCalls, []);
});

// ──── POST — session path + ownership (PR #18) ──────────────────────────

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
