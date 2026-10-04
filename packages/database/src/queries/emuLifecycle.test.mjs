/**
 * Unit tests for decommissionEmu() / redeployEmu() — RPC wiring, argument
 * shape, response mapping, error handling. The transaction itself lives in
 * the DB functions and is covered by scripts/test-emu-lifecycle.ts against
 * a real database.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/database/src/queries/emuLifecycle.test.mjs
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

const { decommissionEmu, redeployEmu } = await import("./emuLifecycle.ts");

test("decommissionEmu calls the RPC with the device id", async () => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };

  await decommissionEmu("dev-1");

  assert.deepEqual(rpcCalls, [
    { fn: "decommission_emu", args: { p_device_id: "dev-1" } },
  ]);
});

test("decommissionEmu throws with the DB error message", async () => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: { message: "EMU is already decommissioned" } };

  await assert.rejects(
    () => decommissionEmu("dev-1"),
    /Decommission EMU failed: EMU is already decommissioned/
  );
});

test("redeployEmu passes all args and maps the response", async () => {
  rpcCalls.length = 0;
  rpcResult = {
    data: [{ installation_id: "inst-new", emu_id: "emu-1", customer_id: "cust-1" }],
    error: null,
  };

  const result = await redeployEmu("dev-1", "site-1", "bldg-1");

  assert.deepEqual(result, {
    installationId: "inst-new",
    emuId: "emu-1",
    customerId: "cust-1",
  });
  assert.deepEqual(rpcCalls, [
    {
      fn: "redeploy_emu",
      args: { p_device_id: "dev-1", p_site_id: "site-1", p_building_id: "bldg-1" },
    },
  ]);
});

test("redeployEmu throws on empty response", async () => {
  rpcCalls.length = 0;
  rpcResult = { data: [], error: null };

  await assert.rejects(
    () => redeployEmu("dev-1", "site-1", "bldg-1"),
    /empty response/
  );
});

test("redeployEmu throws with the DB error message", async () => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: { message: "EMU is not decommissioned" } };

  await assert.rejects(
    () => redeployEmu("dev-1", "site-1", "bldg-1"),
    /Redeploy EMU failed: EMU is not decommissioned/
  );
});
