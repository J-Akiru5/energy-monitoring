/**
 * One-off onboarding script: creates WVSU's first Customer Admin.
 *
 * Usage:  npx tsx scripts/onboard-wvsu-admin.ts
 * Run from repo root. Requires .env with SUPABASE_SERVICE_ROLE_KEY.
 *
 * Idempotent — handles both cases:
 *   A) Auth user doesn't exist yet → creates user + membership + permissions
 *   B) Auth user already exists → creates membership + permissions only
 *
 * Credentials are printed to stdout only — never written to any file.
 */

import process from "node:process";

process.loadEnvFile();

import {
  getSupabaseAdmin,
  createAuthUser,
  ROLE_DEFAULTS,
} from "@energy/database";

const EMAIL = "ronlexusplaton@gmail.com";
const CUSTOMER_NAME = "Western Visayas State University";
const ROLE = "OWNER";

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

async function main() {
  const supabase = getSupabaseAdmin();

  // ── 1. Look up WVSU's customer ID ──────────────────────────
  const { data: customer, error: lookupError } = await supabase
    .from("customers")
    .select("id, name")
    .eq("name", CUSTOMER_NAME)
    .single();

  if (lookupError || !customer) {
    console.error("Failed to find customer:", lookupError?.message ?? "not found");
    process.exit(1);
  }

  console.log(`Found customer: ${customer.name} (${customer.id})`);

  // ── 2. Find or create auth user ────────────────────────────
  let userId = await findAuthUserByEmail(supabase, EMAIL);
  let password: string | null = null;

  if (userId) {
    console.log(`Auth user already exists: ${userId}`);
  } else {
    console.log("Creating auth user...");
    const credentials = await createAuthUser(supabase, EMAIL);
    userId = credentials.userId;
    password = credentials.password;
    console.log(`Created auth user: ${userId}`);
  }

  // ── 3. Check / create membership ───────────────────────────
  const { data: existingMembership } = await supabase
    .from("memberships")
    .select("id, role")
    .eq("user_id", userId)
    .eq("customer_id", customer.id)
    .single();

  let membershipId: string;

  if (existingMembership) {
    console.log(`Membership exists (id: ${existingMembership.id}, role: ${existingMembership.role})`);
    membershipId = existingMembership.id;

    if (existingMembership.role !== ROLE) {
      await supabase
        .from("memberships")
        .update({ role: ROLE, updated_at: new Date().toISOString() })
        .eq("id", membershipId);
      console.log(`Updated role to ${ROLE}`);
    }
  } else {
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .insert({
        user_id: userId,
        customer_id: customer.id,
        role: ROLE,
      })
      .select("id")
      .single();

    if (membershipError) {
      console.error("Failed to create membership:", membershipError.message);
      process.exit(1);
    }

    membershipId = membership.id;
    console.log(`Created membership: ${membershipId}`);
  }

  // ── 4. Materialize membership_permissions ──────────────────
  const { data: existingPerms } = await supabase
    .from("membership_permissions")
    .select("permission")
    .eq("membership_id", membershipId);

  const existingPermSet = new Set(existingPerms?.map((p) => p.permission) ?? []);
  const requiredPerms = ROLE_DEFAULTS[ROLE];
  const missingPerms = requiredPerms.filter((p) => !existingPermSet.has(p));

  if (missingPerms.length === 0) {
    console.log("All 8 permissions already exist");
  } else {
    const { error: permError } = await supabase
      .from("membership_permissions")
      .insert(
        missingPerms.map((permission) => ({
          membership_id: membershipId,
          permission,
          granted: true,
        }))
      );

    if (permError) {
      console.error("Failed to create permissions:", permError.message);
      process.exit(1);
    }

    console.log(`Created ${missingPerms.length} permission rows`);
  }

  // ── 5. Verify ─────────────────────────────────────────────
  const { data: verifyPerms } = await supabase
    .from("membership_permissions")
    .select("permission, granted")
    .eq("membership_id", membershipId);

  console.log(`\nVerified ${verifyPerms?.length ?? 0} permission rows:`);
  for (const p of verifyPerms ?? []) {
    console.log(`  ${p.permission}: granted=${p.granted}`);
  }

  // ── 6. Print credentials ──────────────────────────────────
  console.log("\n── Onboarding complete ──");
  console.log("Customer: ", customer.name);
  console.log("Role:     ", ROLE);
  console.log("Email:    ", EMAIL);
  console.log("User ID:  ", userId);

  if (password) {
    console.log("Password: ", password);
    console.log("\nCredentials shown here only. Do NOT commit or log them.");
  } else {
    console.log("\nAuth user already existed — no new password generated.");
    console.log("If a password reset is needed, use the Supabase dashboard.");
  }
  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
