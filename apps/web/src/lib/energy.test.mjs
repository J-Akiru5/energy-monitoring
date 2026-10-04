/**
 * Unit tests for the shared energy math and paginated fetch helpers.
 *
 * Run (from repo root):
 *   node --test apps/web/src/lib/energy.test.mjs
 */
import { test } from "node:test";
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

const {
  monotonicEnergyDelta,
  deltaWithinWindow,
  fetchAllPagesDescending,
} = await import("./energy.ts");

test("monotonicEnergyDelta sums positive deltas and ignores counter resets", () => {
  assert.equal(monotonicEnergyDelta([100, 110, 0, 5, 12]), 22);
  assert.equal(monotonicEnergyDelta([1, 2, 3, 4]), 3);
  assert.equal(monotonicEnergyDelta([5, 5, 5]), 0);
});

test("monotonicEnergyDelta returns 0 for fewer than two readings", () => {
  assert.equal(monotonicEnergyDelta([]), 0);
  assert.equal(monotonicEnergyDelta([42]), 0);
});

test("deltaWithinWindow only counts readings inside the window", () => {
  const rows = [
    { ts: 0, energy: 100 },
    { ts: 10, energy: 110 },
    { ts: 20, energy: 130 },
  ];
  assert.equal(deltaWithinWindow(rows, 0, 20), 30);
  assert.equal(deltaWithinWindow(rows, 10, 20), 20);
  assert.equal(deltaWithinWindow(rows, 30, 40), 0);
});

test("fetchAllPagesDescending merges pages into ascending order", async () => {
  const asc = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const desc = [...asc].reverse(); // newest-first source

  const rows = await fetchAllPagesDescending(
    async (from, to) => ({ data: desc.slice(from, to + 1), error: null }),
    { pageSize: 1000 }
  );

  assert.equal(rows.length, 2500);
  assert.deepEqual(
    rows.map((r) => r.id),
    asc.map((r) => r.id)
  );
});

test("fetchAllPagesDescending drops the OLDEST rows when the page cap is hit", async () => {
  const asc = Array.from({ length: 3000 }, (_, i) => ({ id: i }));
  const desc = [...asc].reverse();

  const rows = await fetchAllPagesDescending(
    async (from, to) => ({ data: desc.slice(from, to + 1), error: null }),
    { pageSize: 1000, maxPages: 2 }
  );

  assert.equal(rows.length, 2000);
  assert.equal(rows[0].id, 1000, "oldest 1000 rows are the ones dropped");
  assert.equal(rows[rows.length - 1].id, 2999, "newest row always survives");
});

test("fetchAllPagesDescending throws with context on a page error", async () => {
  await assert.rejects(
    () =>
      fetchAllPagesDescending(
        async () => ({ data: null, error: { message: "boom" } }),
        { context: "Fetch filtered readings failed" }
      ),
    /Fetch filtered readings failed: boom/
  );
});

test("fetchAllPagesDescending returns an empty array when there are no rows", async () => {
  const rows = await fetchAllPagesDescending(
    async () => ({ data: [], error: null }),
    { pageSize: 1000 }
  );
  assert.deepEqual(rows, []);
});
