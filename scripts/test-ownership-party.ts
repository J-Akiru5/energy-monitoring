/**
 * Live verification for RM-08 ownership_party (after the migration is applied).
 *
 * Proves, against a real database:
 *   1. emus.ownership_party is readable through the service-role client
 *      (fails before the migration with a column-not-found error)
 *   2. every existing EMU row is backfilled to 'CUSTOMER' (no NULLs)
 *   3. no row carries a value outside {CUSTOMER, PROVIDER}
 *
 * Read-only — makes no mutations.
 *
 * Run (from repo root, after the migration is applied):
 *   node scripts/test-ownership-party.ts
 */

import process from "node:process";
import path from "node:path";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
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

const supabase = getSupabaseAdmin();

// ── 1. Column readable ────────────────────────────────────────
const { data: rows, error } = await supabase
  .from("emus")
  .select("id, label, owner_type, ownership_party");

check(
  "ownership_party column exists and is readable",
  !error,
  error ? error.message : `read ${rows?.length ?? 0} EMU row(s)`
);

if (error) {
  console.log("\nMigration not applied (or failed). Aborting further checks.");
  process.exit(1);
}

// ── 2. Backfill: no NULLs ─────────────────────────────────────
const nulls = (rows ?? []).filter((r) => r.ownership_party == null);
check(
  "every EMU is backfilled (no NULL ownership_party)",
  nulls.length === 0,
  `${nulls.length} row(s) with NULL ownership_party`
);

// ── 3. Value domain ───────────────────────────────────────────
const invalid = (rows ?? []).filter(
  (r) => !["CUSTOMER", "PROVIDER"].includes(r.ownership_party as string)
);
check(
  "ownership_party values are within {CUSTOMER, PROVIDER}",
  invalid.length === 0,
  invalid.length === 0
    ? `all ${rows?.length ?? 0} row(s) valid`
    : `${invalid.length} invalid value(s): ${invalid.map((r) => r.ownership_party).join(", ")}`
);

// ── Summary ───────────────────────────────────────────────────
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("RM-08 verification FAILED");
  process.exit(1);
}
console.log("RM-08 verification passed");
