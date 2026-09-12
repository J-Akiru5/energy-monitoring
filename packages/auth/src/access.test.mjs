/**
 * Unit tests for resolveAccess() — super-admin grant lifecycle.
 *
 * Verifies the decision #9 semantics from
 * supabase/migrations/20260913000000_super_admin_temporary_grants.sql:
 *   expires_at NULL     → permanent grant, works
 *   expires_at future   → temporary grant, works (and is audit-logged)
 *   expires_at past     → fails closed, falls back to membership resolution
 *   revoked_at set      → treated as no grant (filtered by the query)
 *
 * Run (from repo root):
 *   node --experimental-test-module-mocks --test packages/auth/src/access.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const ALL_PERMISSIONS = [
  "view_energy",
  "control_relay",
  "manage_devices",
  "provision_device",
  "replace_device",
  "reassign_emu",
  "manage_billing",
  "manage_users",
  "view_reports",
];

const WVSU = "333fad51-50b2-4cdb-82e6-1c493f499a5c";
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const ownerMembership = {
  id: "m1",
  customer_id: WVSU,
  membership_permissions: ALL_PERMISSIONS.map((permission) => ({ permission, granted: true })),
};
const viewerMembership = {
  id: "m2",
  customer_id: OTHER,
  membership_permissions: [{ permission: "view_energy", granted: true }],
};

// Mutable scenario the mocked getSupabaseAdmin() closure reads.
let current = null;

function makeClient({ superAdmin, memberships, auditSink }) {
  return {
    from(table) {
      if (table === "super_admins") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({ data: superAdmin ?? null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "memberships") {
        const chain = {
          eq: () => chain,
          then: (resolve, reject) =>
            Promise.resolve({ data: memberships ?? [], error: null }).then(resolve, reject),
        };
        return { select: () => chain };
      }
      if (table === "super_admin_access_log") {
        return {
          insert: async (row) => {
            auditSink.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function scenario({ superAdmin = null, memberships = [] } = {}) {
  const audit = [];
  current = {
    audit,
    client: makeClient({ superAdmin, memberships, auditSink: audit }),
  };
  return current;
}

mock.module("@energy/database", {
  namedExports: {
    getSupabaseAdmin: () => current.client,
    ALL_PERMISSIONS,
  },
});

const { resolveAccess, AccessDeniedError } = await import("./access.ts");

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

test("permanent grant (expires_at NULL) → isSuperAdmin true, not audit-logged", async () => {
  const s = scenario({ superAdmin: { user_id: "u1", expires_at: null }, memberships: [] });
  const access = await resolveAccess("u1", "view_energy");
  assert.equal(access.isSuperAdmin, true);
  assert.equal(access.customerId, "*");
  assert.equal(s.audit.length, 0, "permanent grants must not be logged");
});

test("active temporary grant → isSuperAdmin true and audit-logged once", async () => {
  const s = scenario({ superAdmin: { user_id: "u1", expires_at: future }, memberships: [] });
  const access = await resolveAccess("u1", "manage_devices");
  assert.equal(access.isSuperAdmin, true);
  assert.equal(access.customerId, "*");
  assert.equal(s.audit.length, 1);
  assert.deepEqual(s.audit[0], { user_id: "u1", was_temporary_grant: true });
});

test("expired temporary grant (demo1-style) → falls back to OWNER membership", async () => {
  const s = scenario({ superAdmin: { user_id: "u1", expires_at: past }, memberships: [ownerMembership] });
  const access = await resolveAccess("u1", "manage_devices");
  assert.equal(access.isSuperAdmin, false);
  assert.equal(access.customerId, WVSU);
  assert.ok(access.permissions.includes("manage_devices"));
  assert.equal(s.audit.length, 0, "expired grants are not logged as access");
});

test("revoked grant (query returns null) → normal membership applies", async () => {
  scenario({ superAdmin: null, memberships: [ownerMembership] });
  const access = await resolveAccess("u1", "view_energy");
  assert.equal(access.isSuperAdmin, false);
  assert.equal(access.customerId, WVSU);
});

test("expired grant with no membership → AccessDeniedError (fail closed)", async () => {
  scenario({ superAdmin: { user_id: "u1", expires_at: past }, memberships: [] });
  await assert.rejects(() => resolveAccess("u1", "view_energy"), AccessDeniedError);
});

test("membership lacking the required permission → AccessDeniedError (no regression)", async () => {
  scenario({ superAdmin: { user_id: "u1", expires_at: past }, memberships: [viewerMembership] });
  await assert.rejects(() => resolveAccess("u1", "manage_devices"), AccessDeniedError);
  // ...but the granted permission still resolves normally.
  const access = await resolveAccess("u1", "view_energy");
  assert.equal(access.customerId, OTHER);
});

test("expired grant + resourceId → membership resolved for that customer", async () => {
  scenario({ superAdmin: { user_id: "u1", expires_at: past }, memberships: [ownerMembership] });
  const access = await resolveAccess("u1", "view_energy", WVSU);
  assert.equal(access.isSuperAdmin, false);
  assert.equal(access.customerId, WVSU);
});

test("invalid expires_at value fails closed", async () => {
  scenario({ superAdmin: { user_id: "u1", expires_at: "not-a-date" }, memberships: [ownerMembership] });
  const access = await resolveAccess("u1", "view_energy");
  assert.equal(access.isSuperAdmin, false);
  assert.equal(access.customerId, WVSU);
});
