/**
 * Tests for pollingSchedule.ts — the fix for the config/poll race where
 * fetchRelayData() used to overwrite the entire relay config every 5
 * seconds, silently reverting unsaved (or just-saved) edits.
 *
 * These are plain-function tests, no React rendering and no real timers —
 * each factory is called directly with a mocked `actions` object, and we
 * assert on which of loadConfig/fetchState actually got invoked.
 *
 * Run (from repo root):
 *   node --experimental-strip-types --test apps/admin/src/app/relay/pollingSchedule.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialLoad,
  createPollTick,
  createPostSaveReload,
} from "./pollingSchedule.ts";

function trackedActions() {
  const calls = { loadConfig: 0, fetchState: 0 };
  return {
    calls,
    actions: {
      loadConfig: async () => {
        calls.loadConfig += 1;
      },
      fetchState: async () => {
        calls.fetchState += 1;
      },
    },
  };
}

test("selecting a device loads its configuration: initial load calls loadConfig", async () => {
  const { calls, actions } = trackedActions();
  const initialLoad = createInitialLoad(actions);
  await initialLoad();
  assert.equal(calls.loadConfig, 1, "initial load must fetch config once");
});

test("selecting a device also loads state (existing behavior preserved)", async () => {
  const { calls, actions } = trackedActions();
  const initialLoad = createInitialLoad(actions);
  await initialLoad();
  assert.equal(calls.fetchState, 1, "initial load must fetch state once");
});

test("polling relay state does NOT overwrite edited configuration: poll tick never calls loadConfig", async () => {
  const { calls, actions } = trackedActions();
  const pollTick = createPollTick(actions);

  // Simulate several poll ticks, as the 5-second interval would.
  await pollTick();
  await pollTick();
  await pollTick();

  assert.equal(calls.loadConfig, 0, "poll tick must never touch config — this is the bug being fixed");
});

test("existing relay state/log polling continues working: poll tick calls fetchState every time", async () => {
  const { calls, actions } = trackedActions();
  const pollTick = createPollTick(actions);

  await pollTick();
  await pollTick();
  await pollTick();

  assert.equal(calls.fetchState, 3, "each poll tick must fetch state, unchanged from prior behavior");
});

test("successful save updates the displayed configuration: post-save reload calls loadConfig", async () => {
  const { calls, actions } = trackedActions();
  const postSaveReload = createPostSaveReload(actions);
  await postSaveReload();
  assert.equal(calls.loadConfig, 1, "a successful save must reload config from the server");
});

test("post-save reload never touches state/logs — it is config-only", async () => {
  const { calls, actions } = trackedActions();
  const postSaveReload = createPostSaveReload(actions);
  await postSaveReload();
  assert.equal(calls.fetchState, 0, "post-save reload is scoped to config only");
});

test("subsequent polling does not revert the saved configuration: save-reload then many poll ticks never call loadConfig again", async () => {
  const { calls, actions } = trackedActions();
  const postSaveReload = createPostSaveReload(actions);
  const pollTick = createPollTick(actions);

  await postSaveReload(); // simulates a successful save
  assert.equal(calls.loadConfig, 1);

  // Simulate the poll interval firing many times after the save — this is
  // exactly the scenario that used to revert the just-saved value.
  for (let i = 0; i < 10; i++) {
    await pollTick();
  }

  assert.equal(
    calls.loadConfig,
    1,
    "loadConfig must still have been called exactly once — no poll tick may call it again"
  );
  assert.equal(calls.fetchState, 10, "all 10 poll ticks must still have fetched state normally");
});
