/**
 * Tests for the session middleware's device-API allowlist.
 *
 * Device-facing API routes authenticate with a per-device X-Device-Token and
 * must NOT be redirected to /login when there is no browser session. The
 * routes themselves return 401 JSON when the token is missing/invalid.
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/auth/src/middleware.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// packages/auth does not depend on next; resolve next/server from the web app.
const NEXT_SERVER = new URL(
  "../../../apps/web/node_modules/next/server.js",
  import.meta.url
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(NEXT_SERVER, context);
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

let currentUser = null;

mock.module("@supabase/ssr", {
  namedExports: {
    createServerClient: () => ({
      auth: { getUser: async () => ({ data: { user: currentUser } }) },
    }),
  },
});

const { updateSession } = await import("./middleware.ts");
const { NextRequest } = await import("next/server");

function req(path) {
  return new NextRequest("https://app.example.com" + path);
}

function assertNotRedirected(res, label) {
  assert.notEqual(res.status, 307, `${label}: must not redirect`);
  assert.equal(res.headers.get("location"), null, `${label}: no Location header`);
}

function assertRedirectedToLogin(res, label) {
  assert.equal(res.status, 307, `${label}: expected redirect`);
  const loc = res.headers.get("location") ?? "";
  assert.ok(loc.endsWith("/login"), `${label}: expected /login, got ${loc}`);
}

test("no session + /api/relay (device token path) is not redirected to /login", async () => {
  currentUser = null;
  assertNotRedirected(await updateSession(req("/api/relay?deviceId=abc")), "/api/relay");
});

test("no session + /api/relay with no query is not redirected", async () => {
  currentUser = null;
  assertNotRedirected(await updateSession(req("/api/relay")), "/api/relay bare");
});

test("no session + /api/ingest is still allowed (existing behavior preserved)", async () => {
  currentUser = null;
  assertNotRedirected(await updateSession(req("/api/ingest")), "/api/ingest");
});

test("no session + /api/thresholds/esp32 is still allowed (existing behavior preserved)", async () => {
  currentUser = null;
  assertNotRedirected(await updateSession(req("/api/thresholds/esp32?deviceId=abc")), "/api/thresholds/esp32");
});

test("no session + /dashboard still redirects to /login (browser behavior unchanged)", async () => {
  currentUser = null;
  const res = await updateSession(req("/dashboard"));
  assertRedirectedToLogin(res, "/dashboard");
});

test("no session + /login is not redirected", async () => {
  currentUser = null;
  assertNotRedirected(await updateSession(req("/login")), "/login");
});

test("logged-in user + /login redirects to /", async () => {
  currentUser = { id: "user-1" };
  const res = await updateSession(req("/login"));
  assert.equal(res.status, 307);
  const loc = res.headers.get("location") ?? "";
  assert.ok(loc.endsWith("/"), `expected / redirect, got ${loc}`);
});

test("logged-in user + /api/relay is not redirected", async () => {
  currentUser = { id: "user-1" };
  assertNotRedirected(await updateSession(req("/api/relay?deviceId=abc")), "session /api/relay");
});
