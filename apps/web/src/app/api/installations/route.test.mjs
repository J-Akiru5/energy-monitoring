/**
 * Tests for web /api/installations — session auth, device ownership (IDOR),
 * and ADR-07 scoping pass-through (non-Super-Admin → customer-scoped;
 * Super Admin → unscoped).
 *
 * The real assertDeviceOwnership() helper runs against a mocked
 * lookupControllerByDevice(), so the ownership tests exercise actual logic.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/installations/route.test.mjs
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
const EMU_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EMU_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";

let currentUser = { id: "user-1" };
let currentAccess = null;
let denyAccess = false;
let stampByDevice = {};
const lookupCalls = [];
const historyCalls = [];

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    lookupControllerByDevice: async (deviceId) => {
      lookupCalls.push(deviceId);
      return stampByDevice[deviceId] ?? null;
    },
    getInstallationHistory: async (emuId, customerId) => {
      historyCalls.push([emuId, customerId]);
      return [
        {
          id: "inst-1",
          emu_id: emuId,
          customer_id: customerId ?? CUSTOMER_B,
          ended_at: null,
        },
      ];
    },
  },
});

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
const { GET } = await import("./route.ts");

function reset() {
  currentUser = { id: "user-1" };
  currentAccess = null;
  denyAccess = false;
  stampByDevice = {};
  lookupCalls.length = 0;
  historyCalls.length = 0;
}

function getReq(deviceId) {
  return new NextRequest(
    `http://localhost/api/installations?deviceId=${deviceId}`
  );
}

test("unauthenticated → 401, no history read", async () => {
  reset();
  currentUser = null;
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 401);
  assert.deepEqual(historyCalls, []);
});

test("missing deviceId → 400", async () => {
  reset();
  const res = await GET(new NextRequest("http://localhost/api/installations"));
  assert.equal(res.status, 400);
  assert.deepEqual(historyCalls, []);
});

test("non-Super-Admin own device → 200, history scoped to caller's customer", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A, emuId: EMU_A };

  const res = await GET(getReq(DEVICE_A));

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.installations.length, 1);
  assert.deepEqual(historyCalls, [[EMU_A, CUSTOMER_A]]);
});

test("non-Super-Admin other tenant's device → 403, history NEVER read", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B, emuId: EMU_B };

  const res = await GET(getReq(DEVICE_B));

  assert.equal(res.status, 403);
  assert.deepEqual(historyCalls, [], "cross-tenant history must not be queried");
});

test("Super Admin → 200, history unscoped (no customer filter)", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B, emuId: EMU_B };

  const res = await GET(getReq(DEVICE_B));

  assert.equal(res.status, 200);
  assert.deepEqual(historyCalls, [[EMU_B, undefined]]);
});

test("device with no controller bridge → 404, history not read", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };

  const res = await GET(getReq(DEVICE_A));

  assert.equal(res.status, 404);
  assert.deepEqual(historyCalls, []);
});

test("denied by resolveAccess → 403", async () => {
  reset();
  denyAccess = true;
  const res = await GET(getReq(DEVICE_A));
  assert.equal(res.status, 403);
  assert.deepEqual(historyCalls, []);
});
