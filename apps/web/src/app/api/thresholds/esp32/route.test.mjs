/**
 * Tests for web /api/thresholds/esp32 — device-token identity binding:
 * the query-string deviceId must match the token's own device.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test apps/web/src/app/api/thresholds/esp32/route.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
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

const relayConfigCalls = [];

mock.module("@energy/database", {
  namedExports: {
    validateDeviceToken: async (token) =>
      token === "token-a" ? { id: DEVICE_A, is_active: true } : null,
    getAlertThresholds: async () => ({
      overvoltage: 250,
      undervoltage: 200,
      overcurrent: 80,
    }),
    getRelayConfig: async (deviceId) => {
      relayConfigCalls.push(deviceId);
      return { autoTripEnabled: true };
    },
  },
});

const { NextRequest } = await import("next/server");
const { GET } = await import("./route.ts");

function makeReq(url, headers = {}) {
  return new NextRequest(url, { headers });
}

test("valid token + matching deviceId → 200 with thresholds", async () => {
  relayConfigCalls.length = 0;
  const res = await GET(
    makeReq(`http://localhost/api/thresholds/esp32?deviceId=${DEVICE_A}`, {
      "x-device-token": "token-a",
    })
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.overvoltage, 250);
  assert.equal(json.localSafetyEnabled, true);
  assert.deepEqual(relayConfigCalls, [DEVICE_A]);
});

test("valid token A + deviceId B → 401, config never read (spoofing blocked)", async () => {
  relayConfigCalls.length = 0;
  const res = await GET(
    makeReq(`http://localhost/api/thresholds/esp32?deviceId=${DEVICE_B}`, {
      "x-device-token": "token-a",
    })
  );
  assert.equal(res.status, 401);
  assert.deepEqual(
    relayConfigCalls,
    [],
    "getRelayConfig must not run for another device"
  );
});

test("invalid token → 401, config never read", async () => {
  relayConfigCalls.length = 0;
  const res = await GET(
    makeReq(`http://localhost/api/thresholds/esp32?deviceId=${DEVICE_A}`, {
      "x-device-token": "bogus",
    })
  );
  assert.equal(res.status, 401);
  assert.deepEqual(relayConfigCalls, []);
});

test("missing token → 401", async () => {
  const res = await GET(
    makeReq(`http://localhost/api/thresholds/esp32?deviceId=${DEVICE_A}`)
  );
  assert.equal(res.status, 401);
});

test("valid token but missing deviceId → 400", async () => {
  const res = await GET(
    makeReq("http://localhost/api/thresholds/esp32", {
      "x-device-token": "token-a",
    })
  );
  assert.equal(res.status, 400);
});
