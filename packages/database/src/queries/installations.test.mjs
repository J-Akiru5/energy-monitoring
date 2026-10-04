/**
 * Unit tests for getInstallationHistory() — ADR-07 scoping: non-Super-Admin
 * callers must get an explicit customer_id filter; Super Admin callers
 * (no customerId) must not.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/database/src/queries/installations.test.mjs
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

let result = { data: [], error: null };
const queryCalls = [];

function fakeSupabase() {
  return {
    from(table) {
      const call = { table, select: null, eqs: [], order: null };
      const builder = {
        select(cols) {
          call.select = cols;
          return builder;
        },
        eq(col, val) {
          call.eqs.push([col, val]);
          return builder;
        },
        order(col, opts) {
          call.order = [col, opts];
          return builder;
        },
        then(resolve) {
          queryCalls.push(call);
          resolve(result);
        },
      };
      return builder;
    },
  };
}

mock.module("../client.ts", {
  namedExports: { getSupabaseAdmin: fakeSupabase },
});

const { getInstallationHistory } = await import("./installations.ts");

test("scopes to emu_id and customer_id for non-Super-Admin callers", async () => {
  queryCalls.length = 0;
  result = { data: [{ id: "inst-1" }], error: null };

  const rows = await getInstallationHistory("emu-1", "cust-1");

  assert.deepEqual(rows, [{ id: "inst-1" }]);
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0].table, "emu_installations");
  assert.match(queryCalls[0].select, /site:sites\(name\)/);
  assert.match(queryCalls[0].select, /building:buildings\(name\)/);
  assert.deepEqual(queryCalls[0].eqs, [
    ["emu_id", "emu-1"],
    ["customer_id", "cust-1"],
  ]);
  assert.deepEqual(queryCalls[0].order, ["started_at", { ascending: false }]);
});

test("omits the customer filter for Super Admin callers (unscoped)", async () => {
  queryCalls.length = 0;
  result = { data: [], error: null };

  await getInstallationHistory("emu-1");

  assert.deepEqual(queryCalls[0].eqs, [["emu_id", "emu-1"]]);
});

test("throws on database error", async () => {
  queryCalls.length = 0;
  result = { data: null, error: { message: "boom" } };

  await assert.rejects(
    () => getInstallationHistory("emu-1", "cust-1"),
    /Get installation history failed: boom/
  );
});
