/**
 * Unit tests for validateDeviceToken() — RM-05 cutover to
 * controllers.token_hash (SHA-256 hex), no plaintext fallback.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/database/src/queries/devices.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";

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

const sha256hex = (input) => createHash("sha256").update(input).digest("hex");

let tables = {};
const queryCalls = [];

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column, value) {
          filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          queryCalls.push({ table, filters: filters.map((f) => [...f]) });
          const row = (tables[table] ?? []).find((r) =>
            filters.every(([column, value]) => r[column] === value)
          );
          return { data: row ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

mock.module("../client.ts", {
  namedExports: { getSupabaseAdmin: fakeSupabase },
});

const { validateDeviceToken } = await import("./devices.ts");

function reset() {
  tables = { controllers: [], devices: [] };
  queryCalls.length = 0;
}

const deviceCalls = () => queryCalls.filter((c) => c.table === "devices");

test("valid token: SHA-256 hash matched on ACTIVE controller returns the bridged device", async () => {
  reset();
  tables.controllers.push({
    id: "ctrl-1",
    token_hash: sha256hex("tok-a"),
    legacy_device_id: "dev-1",
    status: "ACTIVE",
  });
  tables.devices.push({ id: "dev-1", name: "EMU-001", is_active: true });

  const device = await validateDeviceToken("tok-a");

  assert.equal(device?.id, "dev-1");
  assert.deepEqual(queryCalls, [
    {
      table: "controllers",
      filters: [
        ["token_hash", sha256hex("tok-a")],
        ["status", "ACTIVE"],
      ],
    },
    {
      table: "devices",
      filters: [
        ["id", "dev-1"],
        ["is_active", true],
      ],
    },
  ]);
});

test("no plaintext fallback: a raw token stored in token_hash never matches", async () => {
  reset();
  tables.controllers.push({
    id: "ctrl-1",
    token_hash: "tok-a",
    legacy_device_id: "dev-1",
    status: "ACTIVE",
  });
  tables.devices.push({ id: "dev-1", is_active: true });

  assert.equal(await validateDeviceToken("tok-a"), null);
  assert.equal(deviceCalls().length, 0);
});

test("unknown token → null, devices never queried", async () => {
  reset();
  assert.equal(await validateDeviceToken("nope"), null);
  assert.equal(deviceCalls().length, 0);
});

test("REVOKED controller fails closed", async () => {
  reset();
  tables.controllers.push({
    id: "ctrl-1",
    token_hash: sha256hex("tok-a"),
    legacy_device_id: "dev-1",
    status: "REVOKED",
  });
  tables.devices.push({ id: "dev-1", is_active: true });

  assert.equal(await validateDeviceToken("tok-a"), null);
  assert.equal(deviceCalls().length, 0);
});

test("REPLACED controller fails closed", async () => {
  reset();
  tables.controllers.push({
    id: "ctrl-1",
    token_hash: sha256hex("tok-a"),
    legacy_device_id: "dev-1",
    status: "REPLACED",
  });
  tables.devices.push({ id: "dev-1", is_active: true });

  assert.equal(await validateDeviceToken("tok-a"), null);
  assert.equal(deviceCalls().length, 0);
});

test("inactive bridged device → null", async () => {
  reset();
  tables.controllers.push({
    id: "ctrl-1",
    token_hash: sha256hex("tok-a"),
    legacy_device_id: "dev-1",
    status: "ACTIVE",
  });
  tables.devices.push({ id: "dev-1", is_active: false });

  assert.equal(await validateDeviceToken("tok-a"), null);
});

test("controller without a legacy device bridge → null, devices never queried", async () => {
  reset();
  tables.controllers.push({
    id: "ctrl-1",
    token_hash: sha256hex("tok-a"),
    legacy_device_id: null,
    status: "ACTIVE",
  });

  assert.equal(await validateDeviceToken("tok-a"), null);
  assert.equal(deviceCalls().length, 0);
});

test("hash matches but the bridged device row is missing → null", async () => {
  reset();
  tables.controllers.push({
    id: "ctrl-1",
    token_hash: sha256hex("tok-a"),
    legacy_device_id: "dev-1",
    status: "ACTIVE",
  });

  assert.equal(await validateDeviceToken("tok-a"), null);
});
