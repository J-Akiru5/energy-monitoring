/**
 * One-off account consolidation script:
 *   1. Creates mhunmonares123@gmail.com as a WVSU VIEWER
 *      (view_energy only) — skips creation if the account exists.
 *   2. Resets the password for admin@gmail.com (and verifies its
 *      super_admins row is byte-identical before/after).
 *   3. Moves ronlexusplaton@gmail.com's WVSU membership OWNER → OPERATOR,
 *      replacing the materialized permission set with OPERATOR's exact 5.
 *   4. Resets the password for ronlexusplaton@gmail.com.
 *
 * Usage:  npx tsx scripts/reset-account-credentials.ts
 * Run from repo root. Requires .env with SUPABASE_SERVICE_ROLE_KEY.
 *
 * Idempotent: re-running skips auth-user creation for accounts that
 * already exist and converges memberships/permissions to the target state.
 *
 * Generated passwords are printed to stdout only — never written to any
 * file, commit message, docs report, or log.
 */

import process from "node:process";

process.loadEnvFile();

import {
  getSupabaseAdmin,
  generatePassword,
  createAuthUser,
  deleteAuthUser,
  ROLE_DEFAULTS,
} from "@energy/database";
import type { Permission } from "@energy/database";

const WVSU_CUSTOMER_ID = "333fad51-50b2-4cdb-82e6-1c493f499a5c";
const WEB_USER_EMAIL = "mhunmonares123@gmail.com";
const ADMIN_EMAIL = "admin@gmail.com";
const OWNER_EMAIL = "ronlexusplaton@gmail.com";

async function findAuthUserByEmail(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  email: string
): Promise<string | null> {
  const { data: users } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  return users?.users.find((u) => u.email === email)?.id ?? null;
}

/**
 * Ensure a membership exists on the given customer with the given role.
 * Creates it when missing; normalizes the role when it differs.
 */
async function ensureMembership(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  customerId: string,
  role: string
): Promise<{ membershipId: string; created: boolean }> {
  const { data: existing, error } = await supabase
    .from("memberships")
    .select("id, role")
    .eq("user_id", userId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Membership lookup failed: ${error.message}`);
  }

  if (existing) {
    if (existing.role !== role) {
      const { error: updateError } = await supabase
        .from("memberships")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (updateError) {
        throw new Error(`Membership role update failed: ${updateError.message}`);
      }
    }
    return { membershipId: existing.id as string, created: false };
  }

  const { data: membership, error: insertError } = await supabase
    .from("memberships")
    .insert({ user_id: userId, customer_id: customerId, role })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Membership creation failed: ${insertError.message}`);
  }

  return { membershipId: membership.id as string, created: true };
}

/**
 * Replace a membership's materialized permissions with exactly the given
 * set. Extras are deleted, missing rows inserted, and any granted=false
 * row is flipped to granted=true. Throws if the final state doesn't match.
 */
async function replacePermissions(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  membershipId: string,
  permissions: Permission[]
): Promise<Permission[]> {
  const { data: existing, error } = await supabase
    .from("membership_permissions")
    .select("permission, granted")
    .eq("membership_id", membershipId);

  if (error) {
    throw new Error(`Permission lookup failed: ${error.message}`);
  }

  const desired = new Set<string>(permissions);
  const existingGranted = new Map(
    (existing ?? []).map((row) => [row.permission as string, row.granted as boolean])
  );

  const toDelete = (existing ?? [])
    .filter((row) => !desired.has(row.permission as string))
    .map((row) => row.permission as string);

  const toUpsert = permissions
    .filter((permission) => existingGranted.get(permission) !== true)
    .map((permission) => ({
      membership_id: membershipId,
      permission,
      granted: true,
    }));

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("membership_permissions")
      .delete()
      .eq("membership_id", membershipId)
      .in("permission", toDelete);
    if (deleteError) {
      throw new Error(`Permission removal failed: ${deleteError.message}`);
    }
  }

  if (toUpsert.length > 0) {
    const { error: upsertError } = await supabase
      .from("membership_permissions")
      .upsert(toUpsert, { onConflict: "membership_id,permission" });
    if (upsertError) {
      throw new Error(`Permission upsert failed: ${upsertError.message}`);
    }
  }

  const { data: verify, error: verifyError } = await supabase
    .from("membership_permissions")
    .select("permission, granted")
    .eq("membership_id", membershipId);

  if (verifyError) {
    throw new Error(`Permission verification failed: ${verifyError.message}`);
  }

  const finalSet = (verify ?? [])
    .filter((row) => row.granted)
    .map((row) => row.permission as Permission);

  const expectedSorted = [...permissions].sort().join(",");
  const actualSorted = [...finalSet].sort().join(",");
  if (expectedSorted !== actualSorted) {
    throw new Error(
      `Permission set mismatch after update: expected [${expectedSorted}] got [${actualSorted}]`
    );
  }

  return finalSet;
}

async function resetPassword(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string
): Promise<string> {
  const password = generatePassword();
  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) {
    throw new Error(`Password reset failed: ${error.message}`);
  }
  return password;
}

async function main() {
  const supabase = getSupabaseAdmin();

  // ── 1. Web App User: mhunmonares123@gmail.com ───────────────
  console.log("── Step 1: Web App User (mhunmonares123@gmail.com) ──");
  let webUserPassword: string | null = null;
  let webUserId = await findAuthUserByEmail(supabase, WEB_USER_EMAIL);

  if (webUserId) {
    console.log(`Auth user already exists: ${webUserId} — skipping creation.`);
  } else {
    const credentials = await createAuthUser(supabase, WEB_USER_EMAIL);
    webUserId = credentials.userId;
    webUserPassword = credentials.password;
    console.log(`Created auth user: ${webUserId}`);
  }

  try {
    const { membershipId, created } = await ensureMembership(
      supabase,
      webUserId,
      WVSU_CUSTOMER_ID,
      "VIEWER"
    );
    console.log(
      created
        ? `Created WVSU membership: ${membershipId} (role: VIEWER)`
        : `WVSU membership exists: ${membershipId} (role: VIEWER)`
    );

    const finalPerms = await replacePermissions(
      supabase,
      membershipId,
      ROLE_DEFAULTS.VIEWER
    );
    console.log(`Materialized permissions: ${finalPerms.join(", ")}`);
  } catch (err) {
    if (webUserPassword) {
      console.error("Rolling back newly created auth user...");
      await deleteAuthUser(supabase, webUserId);
    }
    throw err;
  }

  // ── 2. admin@gmail.com: password reset only ────────────────
  console.log("\n── Step 2: admin@gmail.com password reset ──");
  const adminUserId = await findAuthUserByEmail(supabase, ADMIN_EMAIL);
  if (!adminUserId) {
    throw new Error(`No auth user found for ${ADMIN_EMAIL}.`);
  }

  const { data: superAdminBefore, error: beforeError } = await supabase
    .from("super_admins")
    .select("user_id, granted_by, granted_at, revoked_at, expires_at")
    .eq("user_id", adminUserId)
    .maybeSingle();

  if (beforeError) {
    throw new Error(`super_admins pre-reset read failed: ${beforeError.message}`);
  }
  if (!superAdminBefore) {
    throw new Error(
      `${ADMIN_EMAIL} has no super_admins row — refusing to proceed.`
    );
  }

  const adminPassword = await resetPassword(supabase, adminUserId);

  const { data: superAdminAfter, error: afterError } = await supabase
    .from("super_admins")
    .select("user_id, granted_by, granted_at, revoked_at, expires_at")
    .eq("user_id", adminUserId)
    .maybeSingle();

  if (afterError) {
    throw new Error(`super_admins post-reset read failed: ${afterError.message}`);
  }

  const beforeJson = JSON.stringify(superAdminBefore);
  const afterJson = JSON.stringify(superAdminAfter);
  if (beforeJson !== afterJson) {
    throw new Error(
      `super_admins row changed during password reset!\nbefore: ${beforeJson}\nafter:  ${afterJson}`
    );
  }
  console.log("super_admins row verified byte-identical before/after:");
  console.log(`  ${beforeJson}`);
  console.log("Password reset complete.");

  // ── 3. ronlexusplaton@gmail.com: OWNER → OPERATOR ──────────
  console.log("\n── Step 3: ronlexusplaton@gmail.com OWNER → OPERATOR ──");
  const ownerUserId = await findAuthUserByEmail(supabase, OWNER_EMAIL);
  if (!ownerUserId) {
    throw new Error(`No auth user found for ${OWNER_EMAIL}.`);
  }

  const { data: ownerMembership, error: ownerMembershipError } = await supabase
    .from("memberships")
    .select("id, role")
    .eq("user_id", ownerUserId)
    .eq("customer_id", WVSU_CUSTOMER_ID)
    .maybeSingle();

  if (ownerMembershipError) {
    throw new Error(`Membership lookup failed: ${ownerMembershipError.message}`);
  }
  if (!ownerMembership) {
    throw new Error(`${OWNER_EMAIL} has no WVSU membership — refusing to proceed.`);
  }
  console.log(
    `Existing membership: ${ownerMembership.id} (role: ${ownerMembership.role})`
  );

  const { error: roleUpdateError } = await supabase
    .from("memberships")
    .update({ role: "OPERATOR", updated_at: new Date().toISOString() })
    .eq("id", ownerMembership.id);
  if (roleUpdateError) {
    throw new Error(`Role update failed: ${roleUpdateError.message}`);
  }
  console.log("Role updated: OWNER → OPERATOR");

  const operatorPerms = await replacePermissions(
    supabase,
    ownerMembership.id as string,
    ROLE_DEFAULTS.OPERATOR
  );
  console.log(`Materialized permissions replaced with OPERATOR's ${operatorPerms.length}: ${operatorPerms.sort().join(", ")}`);

  // ── 4. ronlexusplaton@gmail.com: password reset ────────────
  console.log("\n── Step 4: ronlexusplaton@gmail.com password reset ──");
  const ownerPassword = await resetPassword(supabase, ownerUserId);
  console.log("Password reset complete.");

  // ── Credentials (stdout only — never persisted) ────────────
  console.log("\n── Generated credentials (this output only — not written to disk) ──");
  if (webUserPassword) {
    console.log(`${WEB_USER_EMAIL}: ${webUserPassword}`);
  } else {
    console.log(`${WEB_USER_EMAIL}: account already existed — password unchanged`);
  }
  console.log(`${ADMIN_EMAIL}: ${adminPassword}`);
  console.log(`${OWNER_EMAIL}: ${ownerPassword}`);
  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
