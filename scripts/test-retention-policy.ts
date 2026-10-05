/**
 * RM-10 retention-policy guard (read-only).
 *
 * Policy (OD-2, resolved 2026-10-05): telemetry is retained indefinitely
 * for now — customer deletion revokes access, not history (ADR-08).
 * Revisit before the first commercial customer.
 *
 * This guard keeps the invariant true as the codebase grows:
 *
 *   1. No source file may delete rows from a telemetry table
 *      (power_readings, alerts, blackout_events, relay_logs,
 *      device_alert_state), and no migration may DELETE FROM or TRUNCATE
 *      one — statically scanned across apps/, packages/, scripts/ and
 *      supabase/migrations/.
 *   2. Every FK on/into telemetry tables must be ON DELETE NO ACTION or
 *      RESTRICT (never CASCADE). Verified against live on 2026-10-05 via
 *      the SQL printed at the end of this run; re-run it in the Supabase
 *      SQL editor before changing any deletion behavior.
 *
 * This script is excluded from its own scan (it contains the patterns
 * by definition).
 *
 * Run (from repo root):
 *   node scripts/test-retention-policy.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const TELEMETRY_TABLES = [
  "power_readings",
  "alerts",
  "blackout_events",
  "relay_logs",
  "device_alert_state",
];

const ROOTS = ["apps", "packages", "scripts", "supabase/migrations"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", ".git"]);
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const SQL_EXT = /\.sql$/;
const SELF = path.resolve("scripts/test-retention-policy.ts");

interface Violation {
  file: string;
  detail: string;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

const violations: Violation[] = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (path.resolve(file) === SELF) continue;

    const isCode = CODE_EXT.test(file);
    const isSql = SQL_EXT.test(file);
    if (!isCode && !isSql) continue;

    scanned += 1;
    const text = readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);

    if (isCode) {
      // PostgREST delete chains: `.from("<telemetry>") ... .delete(`.
      let idx = text.indexOf(".delete(");
      while (idx !== -1) {
        const window = text.slice(Math.max(0, idx - 240), idx);
        for (const table of TELEMETRY_TABLES) {
          const fromPattern = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`);
          if (fromPattern.test(window)) {
            violations.push({
              file: rel,
              detail: `.delete() on ${table} at offset ${idx}`,
            });
          }
        }
        idx = text.indexOf(".delete(", idx + 1);
      }
    }

    if (isSql) {
      for (const table of TELEMETRY_TABLES) {
        const deleteRe = new RegExp(`DELETE\\s+FROM\\s+(public\\.)?${table}\\b`, "i");
        const truncateRe = new RegExp(`TRUNCATE\\s+(TABLE\\s+)?(public\\.)?${table}\\b`, "i");
        if (deleteRe.test(text)) {
          violations.push({ file: rel, detail: `DELETE FROM ${table}` });
        }
        if (truncateRe.test(text)) {
          violations.push({ file: rel, detail: `TRUNCATE ${table}` });
        }
      }
    }
  }
}

console.log("═══════════════════════════════════════════════════════════════");
console.log(" RM-10 retention-policy guard — static scan");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`Scanned ${scanned} file(s) across: ${ROOTS.join(", ")}`);
console.log("");

if (violations.length > 0) {
  console.log(`FAIL — ${violations.length} telemetry deletion path(s) found:`);
  for (const v of violations) {
    console.log(`  FAIL ${v.file}: ${v.detail}`);
  }
  console.log(
    "\nThe retain-indefinitely policy (OD-2, ADR-08) forbids deleting telemetry. " +
      "If a deliberate policy change is being made, update the policy first."
  );
  process.exit(1);
}

console.log("PASS — no telemetry deletion paths in code or migrations.");
console.log("");
console.log("Manual FK re-verification (run in the Supabase SQL editor):");
console.log(
  "  SELECT tc.table_name, kcu.column_name, ccu.table_name AS parent, rc.delete_rule\n" +
    "  FROM information_schema.table_constraints tc\n" +
    "  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name\n" +
    "  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name\n" +
    "  JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name\n" +
    "  WHERE tc.constraint_type = 'FOREIGN KEY'\n" +
    "    AND tc.table_name IN ('power_readings','alerts','blackout_events','relay_logs','device_alert_state');\n" +
    "  -- every delete_rule must be NO ACTION or RESTRICT"
);
console.log("");
console.log("RM-10 retention-policy guard passed.");
