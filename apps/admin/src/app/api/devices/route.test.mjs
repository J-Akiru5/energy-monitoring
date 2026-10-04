/**
 * Tests for admin /api/devices PATCH — action routing and permission
 * mapping, with focus on the RM-07 lifecycle actions (decommission_emu,
 * redeploy_emu) and the RM-02 replace_controller action.
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

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE_A = "33333333-3333-4333-8333-333333333333";
const BUILDING_A = "44444444-4444-4444-8444-444444444444";

let currentUser = { id: "user-1" };
let currentAccess = null;
let denyAccess = false;
let stampByDevice = {};
let decommissionError = null;
let redeployError = null;

const resolveCalls = [];
const lookupCalls = [];
const decommissionCalls = [];
const redeployCalls = [];

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    listDevices: async () => [],
    deactivateDevice: async () => {},
    lookupControllerByDevice: async (deviceId) => {
      lookupCalls.push(deviceId);
      return stampByDevice[deviceId] ?? null;
    },
    replaceController: async (deviceId) => ({
      controllerId: "ctrl-new",
      deviceId,
      deviceToken: "em_new",
    }),
    decommissionEmu: async (deviceId) => {
      decommissionCalls.push(deviceId);
      if (decommissionError) {
        throw new Error(`Decommission EMU failed: ${decommissionError}`);
      }
    },
    redeployEmu: async (deviceId, siteId, buildingId) => {
      redeployCalls.push([deviceId, siteId, buildingId]);
      if (redeployError) {
        throw new Error(`Redeploy EMU failed: ${redeployError}`);
      }
      return { installationId: "inst-new", emuId: "emu-1", customerId: CUSTOMER_A };
    },
  },
});

mock.module("@energy/auth", {
  namedExports: {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: currentUser } }) },
    }),
    resolveAccess: async (_userId, permission) => {
      resolveCalls.push(permission);
      if (denyAccess) throw new AccessDeniedError("denied");
      return currentAccess;
    },
    AccessDeniedError,
  },
});

const { NextRequest } = await import("next/server");
const { PATCH } = await import("./route.ts");

function reset() {
  currentUser = { id: "user-1" };
  currentAccess = null;
  denyAccess = false;
  stampByDevice = {};
  decommissionError = null;
  redeployError = null;
  resolveCalls.length = 0;
  lookupCalls.length = 0;
  decommissionCalls.length = 0;
  redeployCalls.length = 0;
}

function patchReq(body) {
  return new NextRequest("http://localhost/api/devices", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("permission mapping: replace_controller resolves replace_device; lifecycle actions use manage_devices", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };

  await PATCH(patchReq({ deviceId: DEVICE_A, action: "replace_controller" }));
  assert.deepEqual(resolveCalls, ["replace_device"]);

  resolveCalls.length = 0;
  await PATCH(patchReq({ deviceId: DEVICE_A, action: "decommission_emu" }));
  assert.deepEqual(resolveCalls, ["manage_devices"]);

  resolveCalls.length = 0;
  await PATCH(
    patchReq({
      deviceId: DEVICE_A,
      action: "redeploy_emu",
      siteId: SITE_A,
      buildingId: BUILDING_A,
    })
  );
  assert.deepEqual(resolveCalls, ["manage_devices"]);
});

test("decommission_emu: own device → 200, RPC called", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A };

  const res = await PATCH(patchReq({ deviceId: DEVICE_A, action: "decommission_emu" }));

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, "decommissioned");
  assert.deepEqual(decommissionCalls, [DEVICE_A]);
});

test("decommission_emu: cross-tenant device → 403, RPC never called", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B };

  const res = await PATCH(patchReq({ deviceId: DEVICE_B, action: "decommission_emu" }));

  assert.equal(res.status, 403);
  assert.deepEqual(decommissionCalls, []);
});

test("decommission_emu: state conflict → 409", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  decommissionError = "EMU is already decommissioned";

  const res = await PATCH(patchReq({ deviceId: DEVICE_A, action: "decommission_emu" }));

  assert.equal(res.status, 409);
  const json = await res.json();
  assert.match(json.error, /current state/);
});

test("redeploy_emu: missing target ids → 400, RPC never called", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };

  const res = await PATCH(patchReq({ deviceId: DEVICE_A, action: "redeploy_emu" }));

  assert.equal(res.status, 400);
  assert.deepEqual(redeployCalls, []);
});

test("redeploy_emu: own device + valid target → 200, RPC called with all ids", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A };

  const res = await PATCH(
    patchReq({
      deviceId: DEVICE_A,
      action: "redeploy_emu",
      siteId: SITE_A,
      buildingId: BUILDING_A,
    })
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, "redeployed");
  assert.equal(json.installationId, "inst-new");
  assert.deepEqual(redeployCalls, [[DEVICE_A, SITE_A, BUILDING_A]]);
});

test("redeploy_emu: cross-tenant device → 403, RPC never called", async () => {
  reset();
  currentAccess = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_B };

  const res = await PATCH(
    patchReq({
      deviceId: DEVICE_B,
      action: "redeploy_emu",
      siteId: SITE_A,
      buildingId: BUILDING_A,
    })
  );

  assert.equal(res.status, 403);
  assert.deepEqual(redeployCalls, []);
});

test("redeploy_emu: invalid target → 400", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  redeployError = "target site belongs to a different customer";

  const res = await PATCH(
    patchReq({
      deviceId: DEVICE_A,
      action: "redeploy_emu",
      siteId: SITE_A,
      buildingId: BUILDING_A,
    })
  );

  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /Invalid redeploy target/);
});

test("redeploy_emu: state conflict → 409", async () => {
  reset();
  currentAccess = { isSuperAdmin: true, customerId: "*", permissions: [] };
  redeployError = "EMU is not decommissioned (status ACTIVE)";

  const res = await PATCH(
    patchReq({
      deviceId: DEVICE_A,
      action: "redeploy_emu",
      siteId: SITE_A,
      buildingId: BUILDING_A,
    })
  );

  assert.equal(res.status, 409);
});
