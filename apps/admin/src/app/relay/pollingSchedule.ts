/**
 * Pure scheduling logic for the relay page's data loading.
 *
 * Extracted specifically so the one invariant that matters can be tested
 * directly, with no React rendering and no timers: the function that runs
 * on the 5-second poll interval must NEVER be the same function that loads
 * config. Config is a form the user edits in place; unconditionally
 * overwriting it from the server on a timer silently reverts unsaved (or
 * just-saved, via a race) edits. State and logs are never edited in place,
 * so overwriting them on every tick is exactly the live-update behavior
 * wanted.
 *
 * page.tsx wires these three factories to loadRelayConfig/fetchRelayState
 * and to its useEffect hooks / setInterval. Nothing here talks to the
 * network, React, or the DOM — that's the point.
 */

export interface RelayPageActions {
  loadConfig: () => Promise<void>;
  fetchState: () => Promise<void>;
}

/** Runs once when a device is selected: config once, state once. */
export function createInitialLoad(actions: RelayPageActions): () => Promise<void> {
  return async () => {
    await Promise.all([actions.loadConfig(), actions.fetchState()]);
  };
}

/**
 * Runs on the 5-second poll interval. Deliberately, provably only ever
 * calls fetchState — this is the function under test for the bug this
 * module exists to prevent from recurring.
 */
export function createPollTick(actions: RelayPageActions): () => Promise<void> {
  return actions.fetchState;
}

/** Runs once after a successful config save, to reflect the server's
 * canonical persisted value (rather than assuming the just-sent local
 * state is authoritative). Never invoked by the poll interval. */
export function createPostSaveReload(actions: RelayPageActions): () => Promise<void> {
  return actions.loadConfig;
}
