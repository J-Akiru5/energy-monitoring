/**
 * Live verification for RM-11 external-delegate control_relay safeguards.
 *
 * Proves, against a real database (after the migration is applied):
 *   1. a control_relay grant with expires_at in the future resolves, and
 *      resolveAccess returns the membership's scope rows
 *   2. an in-scope EMU passes assertDeviceInScopes; an out-of-scope EMU
 *      is denied
 *   3. an expired grant fails closed — resolveAccess throws AccessDenied
 *   4. no scope rows = customer-wide (roles.ts convention)
 *   5. a site scope passes for a device installed at that site and denies
 *      a device at another site
 *
 * Uses the fixture user's TEST membership; adds a temporary control_relay
 * grant + scope rows, and removes them at the end (restores original state).
 *
 * Run (from repo root, after the migration is applied):
 *   node scripts/test-delegate-relay-access.ts
 */

import process from "node:process";
import path from "node:path";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // @energy/auth's dist imports next/server + next/headers; plain Node
    // needs the .js mapping / a stub (same pattern as the route tests).
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "next/headers") {
      return {
        url: "data:text/javascript,export%20async%20function%20cookies()%20%7B%20return%20%7B%7D%3B%20%7D",
        shortCircuit: true,
      };
    }
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

try {
  process.loadEnvFile(path.resolve(process.cwd(), "apps/web/.env"));
} catch {
  // Environment may already be provided by the shell.
}

const { getSupabaseAdmin } = await import("@energy/database");
const { resolveAccess, AccessDeniedError, assertDeviceInScopes, DeviceAccessDeniedError } =
  await import("@energy/auth");

const FIXTURE_USER_ID = "39dfe8f1-7cb8-4811-a54c-fd2dbc2455c6"; // test-rls-verification
const DEVICE_A_NAME = "TEST Device — RLS Verification (safe to delete)";
const DEVICE_B_NAME = "TEST-B Device — RLS Negative Test (safe to delete)";

interface Result {
  test: string;
  passed: boolean;
  detail: string;
}

const results: Result[] = [];

function check(test: string, passed: boolean, detail: string) {
  results.push({ test, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"} ${test}: ${detail}`);
}

async function expectThrow(
  test: string,
  fn: () => Promise<unknown>,
  errorClass: new (...args: never[]) => Error
) {
  try {
    await fn();
    check(test, false, "no error thrown");
  } catch (err) {
    check(test, err instanceof errorClass, `${err.constructor.name}: ${(err as Error).message.slice(0, 100)}`);
  }
}

async function main() {
  const supabase = getSupabaseAdmin();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" RM-11 live test — external-delegate control_relay safeguards");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Fixtures ─────────────────────────────────────────────────
  const { data: deviceA } = await supabase
    .from("devices").select("id").eq("name", DEVICE_A_NAME).maybeSingle();
  const { data: deviceB } = await supabase
    .from("devices").select("id").eq("name", DEVICE_B_NAME).maybeSingle();
  if (!deviceA || !deviceB) {
    console.error("Fixture devices not found. Run the RLS fixture script first.");
    process.exit(1);
  }

  const { data: controllerA } = await supabase
    .from("controllers").select("emu_id").eq("legacy_device_id", deviceA.id)
    .eq("status", "ACTIVE").maybeSingle();
  const { data: controllerB } = await supabase
    .from("controllers").select("emu_id").eq("legacy_device_id", deviceB.id)
    .eq("status", "ACTIVE").maybeSingle();
  if (!controllerA?.emu_id || !controllerB?.emu_id) {
    console.error("No ACTIVE controller for a fixture device.");
    process.exit(1);
  }
  const emuA = controllerA.emu_id as string;
  const emuB = controllerB.emu_id as string;

  const { data: emuARow } = await supabase
    .from("emus").select("owner_customer_id").eq("id", emuA).single();
  const customerA = emuARow?.owner_customer_id as string;

  const { data: installationA } = await supabase
    .from("emu_installations").select("site_id, building_id")
    .eq("emu_id", emuA).is("ended_at", null).maybeSingle();
  const siteA = installationA?.site_id as string | undefined;

  const { data: membership } = await supabase
    .from("memberships").select("id")
    .eq("user_id", FIXTURE_USER_ID).eq("customer_id", customerA).maybeSingle();
  if (!membership) {
    console.error("Fixture membership not found.");
    process.exit(1);
  }
  const membershipId = membership.id as string;

  console.log(`Fixture: membership ${membershipId} (customer ${customerA})`);
  console.log(`EMU A: ${emuA} (in scope) | EMU B: ${emuB} (out of scope)\n`);

  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const pastExpiry = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  try {
    // ── Setup: temporary control_relay grant + emu scope ────────
    const { error: grantError } = await supabase
      .from("membership_permissions")
      .upsert(
        { membership_id: membershipId, permission: "control_relay", granted: true, expires_at: futureExpiry },
        { onConflict: "membership_id,permission" }
      );
    if (grantError) throw new Error(`grant setup failed: ${grantError.message}`);

    const { error: scopeError } = await supabase
      .from("membership_scopes")
      .upsert(
        { membership_id: membershipId, scope_type: "emu", scope_id: emuA },
        { onConflict: "membership_id,scope_type,scope_id" }
      );
    if (scopeError) throw new Error(`scope setup failed: ${scopeError.message}`);

    // ── 1. Grant resolves + scopes returned ─────────────────────
    const access = await resolveAccess(FIXTURE_USER_ID, "control_relay");
    check(
      "future grant resolves and includes control_relay",
      access.permissions.includes("control_relay") && !access.isSuperAdmin,
      `permissions=[${access.permissions.join(",")}]`
    );
    check(
      "resolveAccess returns the emu scope row",
      access.scopes.some((s) => s.type === "emu" && s.id === emuA),
      JSON.stringify(access.scopes)
    );

    // ── 2. Scope enforcement ────────────────────────────────────
    try {
      await assertDeviceInScopes(access, deviceA.id);
      check("in-scope EMU passes scope check", true, `emu=${emuA}`);
    } catch (err) {
      check("in-scope EMU passes scope check", false, (err as Error).message);
    }
    await expectThrow(
      "out-of-scope EMU is denied",
      () => assertDeviceInScopes(access, deviceB.id),
      DeviceAccessDeniedError
    );

    // ── 3. Expired grant fails closed ───────────────────────────
    await supabase
      .from("membership_permissions")
      .update({ expires_at: pastExpiry })
      .eq("membership_id", membershipId)
      .eq("permission", "control_relay");
    await expectThrow(
      "expired grant fails closed (AccessDenied)",
      () => resolveAccess(FIXTURE_USER_ID, "control_relay"),
      AccessDeniedError
    );

    // ── 4. No scope rows = customer-wide ────────────────────────
    await supabase
      .from("membership_permissions")
      .update({ expires_at: futureExpiry })
      .eq("membership_id", membershipId)
      .eq("permission", "control_relay");
    await supabase
      .from("membership_scopes")
      .delete()
      .eq("membership_id", membershipId);
    const unscoped = await resolveAccess(FIXTURE_USER_ID, "control_relay");
    check(
      "no scope rows = customer-wide (empty scopes)",
      unscoped.scopes.length === 0,
      `scopes=${JSON.stringify(unscoped.scopes)}`
    );
    try {
      await assertDeviceInScopes(unscoped, deviceA.id);
      check("customer-wide member passes scope check", true, "unscoped");
    } catch (err) {
      check("customer-wide member passes scope check", false, (err as Error).message);
    }

    // ── 5. Site scope ───────────────────────────────────────────
    if (!siteA) {
      check("site scope: fixture installation has a site", false, "no active installation");
    } else {
      await supabase
        .from("membership_scopes")
        .insert({ membership_id: membershipId, scope_type: "site", scope_id: siteA });
      const siteAccess = await resolveAccess(FIXTURE_USER_ID, "control_relay");
      try {
        await assertDeviceInScopes(siteAccess, deviceA.id);
        check("site scope passes for a device at that site", true, `site=${siteA}`);
      } catch (err) {
        check("site scope passes for a device at that site", false, (err as Error).message);
      }
      await expectThrow(
        "site scope denies a device at another site",
        () => assertDeviceInScopes(siteAccess, deviceB.id),
        DeviceAccessDeniedError
      );
    }
  } finally {
    // ── Cleanup: restore the membership to its original state ───
    await supabase
      .from("membership_scopes")
      .delete()
      .eq("membership_id", membershipId);
    await supabase
      .from("membership_permissions")
      .delete()
      .eq("membership_id", membershipId)
      .eq("permission", "control_relay");
    console.log("\n(cleanup: temporary grant + scope rows removed)");
  }

  // ── Summary ──────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(` Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (failed > 0) {
    console.log("\nFailed checks:");
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`  FAIL ${r.test}: ${r.detail}`);
    }
    process.exit(1);
  }

  console.log("\nRM-11 delegate safeguards verified (fail-closed expiry + scope enforcement).");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
