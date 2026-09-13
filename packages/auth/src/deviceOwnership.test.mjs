/**
 * Unit tests for assertDeviceOwnership() — the reusable IDOR guard.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/auth/src/deviceOwnership.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const lookupCalls = [];
let lookupResult = null;

mock.module("@energy/database", {
  namedExports: {
    lookupControllerByDevice: async (deviceId) => {
      lookupCalls.push(deviceId);
      return lookupResult;
    },
  },
});

const { assertDeviceOwnership, DeviceAccessDeniedError } = await import("./deviceOwnership.ts");

function reset() {
  lookupCalls.length = 0;
  lookupResult = null;
}

test("super admin → allowed, ownership lookup skipped", async () => {
  reset();
  const access = { isSuperAdmin: true, customerId: "*", permissions: [] };
  await assertDeviceOwnership(access, DEVICE_A);
  assert.deepEqual(lookupCalls, [], "super admin must not hit the ownership bridge");
});

test("non-super-admin, matching customer → allowed", async () => {
  reset();
  lookupResult = { customerId: CUSTOMER_A };
  const access = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  await assertDeviceOwnership(access, DEVICE_A);
  assert.deepEqual(lookupCalls, [DEVICE_A]);
});

test("non-super-admin, cross-customer device → DeviceAccessDeniedError (403)", async () => {
  reset();
  lookupResult = { customerId: CUSTOMER_B };
  const access = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  const err = await assertDeviceOwnership(access, DEVICE_A).catch((e) => e);
  assert.ok(err instanceof DeviceAccessDeniedError);
  assert.equal(err.status, 403);
  assert.equal(err.message, "Device not found or access denied");
});

test("non-super-admin, unknown device (no controller bridge) → DeviceAccessDeniedError", async () => {
  reset();
  lookupResult = null;
  const access = { isSuperAdmin: false, customerId: CUSTOMER_A, permissions: [] };
  await assert.rejects(
    () => assertDeviceOwnership(access, DEVICE_A),
    DeviceAccessDeniedError
  );
});
