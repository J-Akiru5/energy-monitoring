/**
 * Live verification for RM-07 decommission_emu() / redeploy_emu().
 *
 * Proves, against a real database (after the migration is applied):
 *   1. redeploy is rejected while the EMU is ACTIVE
 *   2. decommission ends the open installation and sets DECOMMISSIONED
 *   3. decommission is rejected when already decommissioned
 *   4. cross-customer redeploy targets are rejected (RM-09 territory)
 *   5. a building outside the target site is rejected
 *   6. a valid redeploy creates a new installation and reactivates the EMU
 *
 * Targets the TEST fixture EMU/device (safe to delete). Ends with the EMU
 * ACTIVE on a fresh installation, so the fixtures stay usable afterwards.
 *
 * Run (from repo root, after the migration is applied):
 *   node scripts/test-emu-lifecycle.ts
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

const { getSupabaseAdmin, decommissionEmu, redeployEmu } = await import(
  "@energy/database"
);

const DEVICE_B_NAME = "TEST-B Device — RLS Negative Test (safe to delete)";
const SITE_B_NAME = "TEST-B Site — RLS Negative Test";
const BUILDING_B_NAME = "TEST-B Building — RLS Negative Test";
const SITE_A_NAME = "TEST Site — RLS Verification";
const BUILDING_A_NAME = "TEST Building — RLS Verification";

interface Result {
  test: string;
  passed: boolean;
  detail: string;
}

const results: Result[] = [];

function check(test: string, passed: boolean, detail: string) {
  results.push({ test, passed, detail });
  console.log(`  ${passed ? "✅" : "❌"} ${test}: ${detail}`);
}

async function expectThrow(
  test: string,
  fn: () => Promise<unknown>,
  pattern: RegExp
) {
  try {
    await fn();
    check(test, false, "no error thrown");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(test, pattern.test(message), message.slice(0, 140));
  }
}

async function openInstallations(supabase: ReturnType<typeof getSupabaseAdmin>, emuId: string) {
  const { data } = await supabase
    .from("emu_installations")
    .select("id, customer_id")
    .eq("emu_id", emuId)
    .is("ended_at", null);
  return data ?? [];
}

async function emuStatus(supabase: ReturnType<typeof getSupabaseAdmin>, emuId: string) {
  const { data } = await supabase.from("emus").select("status").eq("id", emuId).single();
  return data?.status as string | undefined;
}

async function main() {
  const supabase = getSupabaseAdmin();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" RM-07 live test — decommission / redeploy lifecycle");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const { data: device } = await supabase
    .from("devices")
    .select("id")
    .eq("name", DEVICE_B_NAME)
    .maybeSingle();
  if (!device) {
    console.error(`Fixture device not found. Run the RLS fixture script first.`);
    process.exit(1);
  }

  const { data: controller } = await supabase
    .from("controllers")
    .select("emu_id")
    .eq("legacy_device_id", device.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!controller) {
    console.error("No ACTIVE controller for the fixture device.");
    process.exit(1);
  }
  const emuId = controller.emu_id as string;

  const { data: emu0 } = await supabase
    .from("emus")
    .select("status, owner_customer_id")
    .eq("id", emuId)
    .single();
  const customerB = emu0?.owner_customer_id as string;

  const { data: siteB } = await supabase
    .from("sites")
    .select("id")
    .eq("customer_id", customerB)
    .eq("name", SITE_B_NAME)
    .limit(1)
    .maybeSingle();
  const { data: buildingB } = await supabase
    .from("buildings")
    .select("id")
    .eq("site_id", siteB?.id)
    .eq("name", BUILDING_B_NAME)
    .limit(1)
    .maybeSingle();
  const { data: siteA } = await supabase
    .from("sites")
    .select("id")
    .eq("name", SITE_A_NAME)
    .limit(1)
    .maybeSingle();
  const { data: buildingA } = await supabase
    .from("buildings")
    .select("id")
    .eq("name", BUILDING_A_NAME)
    .limit(1)
    .maybeSingle();

  if (!siteB || !buildingB || !siteA || !buildingA) {
    console.error("Fixture sites/buildings not found.");
    process.exit(1);
  }

  console.log(`Fixture device: ${device.id}`);
  console.log(`EMU: ${emuId}\n`);

  // ── Baseline ──
  console.log("Baseline...");
  check("baseline: EMU is ACTIVE", emu0?.status === "ACTIVE", `status=${emu0?.status}`);
  const open0 = await openInstallations(supabase, emuId);
  check("baseline: exactly one open installation", open0.length === 1, `count=${open0.length}`);
  const oldInstallationId = open0[0]?.id;
  console.log("");

  // ── 1. Redeploy while ACTIVE must fail ──
  console.log("Rejected transitions...");
  await expectThrow(
    "redeploy while ACTIVE is rejected",
    () => redeployEmu(device.id, siteB.id, buildingB.id),
    /not decommissioned/
  );

  // ── 2. Decommission ──
  await decommissionEmu(device.id);
  check(
    "decommission: EMU is DECOMMISSIONED",
    (await emuStatus(supabase, emuId)) === "DECOMMISSIONED",
    `status=${await emuStatus(supabase, emuId)}`
  );
  const open1 = await openInstallations(supabase, emuId);
  check("decommission: no open installation", open1.length === 0, `count=${open1.length}`);
  const { data: oldRow } = await supabase
    .from("emu_installations")
    .select("ended_at")
    .eq("id", oldInstallationId)
    .single();
  check(
    "decommission: previous installation was ended",
    oldRow?.ended_at !== null,
    `ended_at=${oldRow?.ended_at ?? "null"}`
  );

  // ── 3. Double decommission must fail ──
  await expectThrow(
    "decommission twice is rejected",
    () => decommissionEmu(device.id),
    /already decommissioned/
  );

  // ── 4. Cross-customer redeploy must fail ──
  await expectThrow(
    "cross-customer redeploy target is rejected",
    () => redeployEmu(device.id, siteA.id, buildingA.id),
    /different customer/
  );
  check(
    "rejected redeploy left the EMU decommissioned",
    (await emuStatus(supabase, emuId)) === "DECOMMISSIONED",
    `status=${await emuStatus(supabase, emuId)}`
  );

  // ── 5. Building outside the target site must fail ──
  await expectThrow(
    "building outside the target site is rejected",
    () => redeployEmu(device.id, siteB.id, buildingA.id),
    /does not belong/
  );
  console.log("");

  // ── 6. Valid redeploy ──
  console.log("Valid redeploy...");
  const redeployed = await redeployEmu(device.id, siteB.id, buildingB.id);
  check(
    "redeploy: EMU is ACTIVE again",
    (await emuStatus(supabase, emuId)) === "ACTIVE",
    `status=${await emuStatus(supabase, emuId)}`
  );
  const open3 = await openInstallations(supabase, emuId);
  check("redeploy: exactly one open installation", open3.length === 1, `count=${open3.length}`);
  check(
    "redeploy: new installation differs from the old one",
    open3[0]?.id !== oldInstallationId,
    `new=${open3[0]?.id}`
  );
  check(
    "redeploy: returned installation matches the open row",
    redeployed.installationId === open3[0]?.id,
    `returned=${redeployed.installationId}`
  );
  check(
    "redeploy: installation belongs to the EMU's customer",
    open3[0]?.customer_id === customerB,
    `customer=${open3[0]?.customer_id}`
  );

  // ── Summary ──
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(` Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (failed > 0) {
    console.log("\nFailed checks:");
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`  ❌ ${r.test}: ${r.detail}`);
    }
    process.exit(1);
  }

  console.log(
    "\n✅ decommission/redeploy is transactional and fail-closed. " +
      "Fixture EMU left ACTIVE on a fresh installation (safe to delete)."
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
