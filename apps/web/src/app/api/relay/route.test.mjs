/**
 * Spoofing-scope test for GET /api/relay device-token auth.
 *
 * Requirement: with a valid X-Device-Token for device A, the response must
 * contain ONLY device A's relay state — regardless of what `deviceId` the
 * query string claims. The device identity must come from the token row.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/relay/route.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// next/* has no package.json "exports" map (raw Node ESM can't resolve the
// extensionless specifiers); workspace dist files keep extensionless
// relative imports. Same shims as the ingest route test — plus a stub for
// next/headers, whose real cookies() throws outside a Next request scope
// (the no-token test only needs the session path to be reached and to see
// no user, not to exercise Next's cookie plumbing).
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

// Dummy config so getRelayConfigError() doesn't 503. Not secrets.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const DEVICE_A = { id: "device-a", is_active: true, api_key_hash: "token-a" };
const DEVICE_B = { id: "device-b", is_active: true, api_key_hash: "token-b" };

const relayStateCalls = [];

mock.module("@energy/database", {
  namedExports: {
    validateDeviceToken: async (token) => {
      if (token === "token-a") return DEVICE_A;
      if (token === "token-b") return DEVICE_B;
      return null;
    },
    getRelayState: async (deviceId) => {
      relayStateCalls.push(deviceId);
      // Distinguishable per-device payload so leaks are visible in assertions.
      return { deviceId, isTripped: deviceId === "device-b" };
    },
    updateRelayState: async () => true,
    getRelayConfig: async () => ({ relayEnabled: true }),
    logRelayAction: async () => true,
  },
});

mock.module("@energy/auth", {
  namedExports: {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: null } }) },
    }),
    resolveAccess: async () => ({ customerId: "customer-1" }),
    AccessDeniedError: class AccessDeniedError extends Error {},
  },
});

const { NextRequest } = await import("next/server");
const { GET } = await import("./route.ts");

function makeReq(url, headers = {}) {
  return new NextRequest(url, { headers });
}

test("valid token A + deviceId=B returns only A's state (spoofing blocked)", async () => {
  relayStateCalls.length = 0;
  const res = await GET(
    makeReq("http://localhost/api/relay?deviceId=device-b", { "x-device-token": "token-a" })
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.state.deviceId, "device-a", "must return device A's state, never B's");
  assert.deepEqual(relayStateCalls, ["device-a"], "DB read must be scoped to the token's device");
});

test("valid token A + absent deviceId returns A's state", async () => {
  relayStateCalls.length = 0;
  const res = await GET(
    makeReq("http://localhost/api/relay", { "x-device-token": "token-a" })
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.state.deviceId, "device-a");
  assert.deepEqual(relayStateCalls, ["device-a"]);
});

test("valid token A + matching deviceId=A returns A's state", async () => {
  relayStateCalls.length = 0;
  const res = await GET(
    makeReq("http://localhost/api/relay?deviceId=device-a", { "x-device-token": "token-a" })
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.state.deviceId, "device-a");
  assert.deepEqual(relayStateCalls, ["device-a"]);
});

test("invalid/inactive token returns 401 and never reads relay state", async () => {
  relayStateCalls.length = 0;
  const res = await GET(
    makeReq("http://localhost/api/relay?deviceId=device-b", { "x-device-token": "bogus" })
  );

  assert.equal(res.status, 401);
  assert.deepEqual(relayStateCalls, [], "no state read may happen for an invalid token");
});

test("no token falls through to session path (unauthenticated -> 401)", async () => {
  relayStateCalls.length = 0;
  const res = await GET(makeReq("http://localhost/api/relay?deviceId=device-a"));

  assert.equal(res.status, 401);
  assert.deepEqual(relayStateCalls, [], "no state read without auth");
});
