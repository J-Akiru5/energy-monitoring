/**
 * One-off bootstrap script: creates the first Super Admin auth user
 * and seeds the super_admins table.
 *
 * Usage:  npx tsx scripts/bootstrap-super-admin.ts
 * Run from repo root. Requires .env with SUPABASE_SERVICE_ROLE_KEY.
 *
 * This is a one-time tool, not a reusable admin-creation feature.
 * Credentials are printed to stdout only — never written to any file.
 */

import process from "node:process";

// Load .env from repo root (Node 20.6+)
process.loadEnvFile();

import { getSupabaseAdmin, createAuthUser, deleteAuthUser } from "@energy/database";

const EMAIL = "admin@gmail.com";

async function main() {
  const supabase = getSupabaseAdmin();

  // 1. Create auth user (pre-confirmed, no email verification flow exists)
  let credentials;
  try {
    credentials = await createAuthUser(supabase, EMAIL);
  } catch (err) {
    console.error("Failed to create auth user:", (err as Error).message);
    process.exit(1);
  }

  const { userId, password } = credentials;

  // 2. Seed super_admins (self-granted bootstrap)
  const { error: insertError } = await supabase
    .from("super_admins")
    .upsert(
      {
        user_id: userId,
        granted_by: userId,
        granted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (insertError) {
    // Roll back the auth user if super_admins insert fails
    await deleteAuthUser(supabase, userId);
    console.error("Failed to seed super_admins:", insertError.message);
    process.exit(1);
  }

  console.log("\n── Bootstrap complete ──");
  console.log("Email:    ", EMAIL);
  console.log("Password: ", password);
  console.log("User ID:  ", userId);
  console.log("\nCredentials shown here only. Do NOT commit or log them.\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
