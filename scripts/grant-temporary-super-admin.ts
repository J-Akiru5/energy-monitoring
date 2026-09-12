/**
 * Time-limited Super Admin grant (decision #9) — Jeff's tool for demo access.
 *
 * Usage:  npx tsx scripts/grant-temporary-super-admin.ts <email> <duration>
 * Example: npx tsx scripts/grant-temporary-super-admin.ts demo1@wvsu.edu.ph 72h
 *
 * Duration units: m = minutes, h = hours, d = days (e.g. 30m, 72h, 7d).
 *
 * Inserts or updates the super_admins row with a computed expires_at.
 * NULL expires_at means a permanent grant; this script always sets one.
 *
 * To revoke early, set revoked_at on the row (existing manual path) —
 * revocation is unchanged by this script. Access while a temporary grant
 * is active is recorded in super_admin_access_log.
 *
 * Run from repo root. Requires .env with SUPABASE_SERVICE_ROLE_KEY.
 */

import process from "node:process";

process.loadEnvFile();

import { getSupabaseAdmin, grantTemporarySuperAdmin } from "@energy/database";

const DURATION_PATTERN = /^(\d+)([mhd])$/;
const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};
const UNIT_LABEL: Record<string, string> = {
  m: "minute(s)",
  h: "hour(s)",
  d: "day(s)",
};

function parseDuration(input: string): number {
  const match = DURATION_PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${input}" — use forms like 30m, 72h, or 7d.`
    );
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  if (value <= 0) {
    throw new Error(`Duration must be greater than zero (got "${input}").`);
  }

  return value * UNIT_MS[unit];
}

function describeDuration(input: string): string {
  const match = DURATION_PATTERN.exec(input.trim())!;
  return `${match[1]} ${UNIT_LABEL[match[2]]}`;
}

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
  const [, , email, duration] = process.argv;

  if (!email || !duration) {
    console.error(
      "Usage: npx tsx scripts/grant-temporary-super-admin.ts <email> <duration>"
    );
    console.error(
      "Example: npx tsx scripts/grant-temporary-super-admin.ts demo1@wvsu.edu.ph 72h"
    );
    process.exit(1);
  }

  const durationMs = parseDuration(duration);
  const expiresAt = new Date(Date.now() + durationMs).toISOString();

  const supabase = getSupabaseAdmin();

  const userId = await findAuthUserByEmail(supabase, email);
  if (!userId) {
    console.error(`No auth user found for ${email}.`);
    process.exit(1);
  }

  console.log(`Auth user: ${email} (${userId})`);
  console.log(
    `Granting temporary Super Admin for ${describeDuration(duration)}...`
  );

  await grantTemporarySuperAdmin(userId, expiresAt);

  // ── Verify against live data ───────────────────────────────
  const { data: row, error } = await supabase
    .from("super_admins")
    .select("user_id, expires_at, revoked_at, granted_at")
    .eq("user_id", userId)
    .single();

  if (error || !row) {
    console.error("Grant written but verification read failed:", error?.message);
    process.exit(1);
  }

  console.log("\n── Temporary Super Admin grant ──");
  console.log("Email:     ", email);
  console.log("User ID:   ", row.user_id);
  console.log("Expires:   ", row.expires_at, "(PHT:", new Date(row.expires_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }), ")");
  console.log("Revoked:   ", row.revoked_at ?? "no");
  console.log("\nAccess while temporary is recorded in super_admin_access_log.");
  console.log("To revoke early: set revoked_at on this row (existing manual path).");
  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", (err as Error).message);
  process.exit(1);
});
