/**
 * Tests for web /api/devices — RM-11 scoped reads.
 *
 * Covers:
 *   - view_energy member without scopes → the whole customer's devices
 *   - view_energy member WITH scopes → filtered to in-scope devices
 *   - scoped control_relay delegate (no view_energy) → in-scope only
 *   - control_relay-only unscoped member → customer-wide list
 *   - neither permission → 403
 *
 * The real filterDevicesByScopes() helper runs against a mocked
 * lookupControllerByDevice(), so the filtering logic under test is real.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/devices/route.test.mjs
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
const EMU_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EMU_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";

let currentUser = { id: "user-1" };
let currentAccess = null;
let denyPermissions = [];
let stampByDevice = {};

class AccessDeniedError extends Error {}

mock.module("@energy/database", {
  namedExports: {
    listDevices: async () => [
      { id: DEVICE_A, name: "Device A", is_active: true },
      { id: DEVICE_B, name: "Device B", is_active: true },
    ],
    lookupControllerByDevice: async (deviceId) => stampByDevice[deviceId] ?? null,
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
    resolveAccess: async (_userId, permission) => {
      if (denyPermissions.includes(permission)) {
        throw new AccessDeniedError(`denied ${permission}`);
      }
      return currentAccess;
    },
    AccessDeniedError,
    filterDevicesByScopes: realOwnership.filterDevicesByScopes,
  },
});

const { GET } = await import("./route.ts");

function reset() {
  currentUser = { id: "user-1" };
  currentAccess = null;
  denyPermissions = [];
  stampByDevice = {};
}

const baseAccess = (overrides = {}) => ({
  isSuperAdmin: false,
  isTemporarySuperAdmin: false,
  customerId: CUSTOMER_A,
  permissions: [],
  scopes: [],
  ...overrides,
});

test("view_energy member without scopes → full customer device list", async () => {
  reset();
  currentAccess = baseAccess({ permissions: ["view_energy"] });
  const res = await GET();
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.devices.map((d) => d.id), [DEVICE_A, DEVICE_B]);
});

test("view_energy member WITH scopes → filtered to in-scope devices", async () => {
  reset();
  currentAccess = baseAccess({
    permissions: ["view_energy"],
    scopes: [{ type: "emu", id: EMU_A }],
  });
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A, emuId: EMU_A };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_A, emuId: EMU_B };
  const res = await GET();
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.devices.map((d) => d.id), [DEVICE_A]);
});

test("scoped control_relay delegate (no view_energy) → in-scope devices only", async () => {
  reset();
  denyPermissions = ["view_energy"];
  currentAccess = baseAccess({
    permissions: ["control_relay"],
    scopes: [{ type: "emu", id: EMU_B }],
  });
  stampByDevice[DEVICE_A] = { customerId: CUSTOMER_A, emuId: EMU_A };
  stampByDevice[DEVICE_B] = { customerId: CUSTOMER_A, emuId: EMU_B };
  const res = await GET();
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.devices.map((d) => d.id), [DEVICE_B]);
});

test("control_relay-only unscoped member → customer-wide list", async () => {
  reset();
  denyPermissions = ["view_energy"];
  currentAccess = baseAccess({ permissions: ["control_relay"] });
  const res = await GET();
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.devices.map((d) => d.id), [DEVICE_A, DEVICE_B]);
});

test("neither view_energy nor control_relay → 403", async () => {
  reset();
  denyPermissions = ["view_energy", "control_relay"];
  const res = await GET();
  assert.equal(res.status, 403);
});
