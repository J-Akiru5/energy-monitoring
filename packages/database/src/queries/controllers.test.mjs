/**
 * Unit tests for replaceController() — RPC wiring, show-once token shape,
 * error handling. The transaction itself lives in the DB function and is
 * covered by scripts/test-replace-controller.ts against a real database.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/database/src/queries/controllers.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier, context);
      } catch {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

let rpcResult = { data: null, error: null };
const rpcCalls = [];

function fakeSupabase() {
  return {
    rpc(fn, args) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  };
}

mock.module("../client.ts", {
  namedExports: { getSupabaseAdmin: fakeSupabase },
});

const { replaceController } = await import("./controllers.ts");

test("calls replace_controller with the device id and a show-once token", async () => {
  rpcCalls.length = 0;
  rpcResult = {
    data: [{ controller_id: "ctrl-new", device_id: "dev-1" }],
    error: null,
  };

  const result = await replaceController("dev-1");

  assert.deepEqual(result, {
    controllerId: "ctrl-new",
    deviceId: "dev-1",
    deviceToken: result.deviceToken,
  });
  assert.match(result.deviceToken, /^em_[0-9a-f]{32}$/);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, "replace_controller");
  assert.equal(rpcCalls[0].args.p_device_id, "dev-1");
  assert.equal(rpcCalls[0].args.p_new_token, result.deviceToken);
});

test("accepts a single-object response as well as an array", async () => {
  rpcCalls.length = 0;
  rpcResult = {
    data: { controller_id: "ctrl-new", device_id: "dev-1" },
    error: null,
  };

  const result = await replaceController("dev-1");
  assert.equal(result.controllerId, "ctrl-new");
});

test("throws with the DB error message on failure", async () => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: { message: "no ACTIVE controller for device x" } };

  await assert.rejects(
    () => replaceController("dev-1"),
    /Replace controller failed: no ACTIVE controller for device x/
  );
});

test("throws on an empty response", async () => {
  rpcCalls.length = 0;
  rpcResult = { data: [], error: null };

  await assert.rejects(() => replaceController("dev-1"), /empty response/);
});
