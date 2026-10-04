/**
 * Live verification for RM-09 cross-customer reassignment.
 *
 * Proves, against a real database (after the migration is applied):
 *   1. reassign is rejected while the EMU is ACTIVE
 *   2. reassigning to the EMU's current customer is rejected
 *      (that's the operational path — redeploy_emu)
 *   3. a target site outside the target customer is rejected
 *   4. a valid cross-customer reassign moves the tenancy: new
 *      installation under the target customer, owner_customer_id
 *      updated, status ACTIVE
 *   5. ownership_party is carried unchanged across the reassignment
 *   6. the fixture EMU can be moved back and is left ACTIVE under its
 *      original customer (safe to delete)
 *
 * Targets the TEST-B fixture EMU/device and moves it to TEST-A and back.
 *
 * Run (from repo root, after the migration is applied):
 *   node scripts/test-reassign-emu.ts
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

const { getSupabaseAdmin, decommissionEmu, redeployEmu, reassignEmuCrossCustomer } =
  await import("@energy/database");

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
  console.log(`  ${passed ? "PASS" : "FAIL"} ${test}: ${detail}`);
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

async function main() {
  const supabase = getSupabaseAdmin();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" RM-09 live test — cross-customer reassignment");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Fixtures ─────────────────────────────────────────────────
  const { data: device } = await supabase
    .from("devices")
    .select("id")
    .eq("name", DEVICE_B_NAME)
    .maybeSingle();
  if (!device) {
    console.error("Fixture device not found. Run the RLS fixture script first.");
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
    .select("status, owner_customer_id, ownership_party")
    .eq("id", emuId)
    .single();
  const customerB = emu0?.owner_customer_id as string;
  const ownershipBefore = emu0?.ownership_party as string;

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
    .select("id, customer_id")
    .eq("name", SITE_A_NAME)
    .limit(1)
    .maybeSingle();
  const { data: buildingA } = await supabase
    .from("buildings")
    .select("id")
    .eq("name", BUILDING_A_NAME)
    .limit(1)
    .maybeSingle();

  if (!siteB || !buildingB || !siteA || !buildingA || !siteA.customer_id) {
    console.error("Fixture sites/buildings not found.");
    process.exit(1);
  }
  const customerA = siteA.customer_id as string;
  if (customerA === customerB) {
    console.error("Fixtures invalid: TEST-A and TEST-B share a customer.");
    process.exit(1);
  }

  console.log(`Fixture device: ${device.id}`);
  console.log(`EMU: ${emuId}`);
  console.log(`customer B (home): ${customerB}`);
  console.log(`customer A (target): ${customerA}\n`);

  // ── Baseline / self-heal ─────────────────────────────────────
  console.log("Baseline...");
  let status = emu0?.status as string;
  let owner = customerB;
  if (status === "DECOMMISSIONED" && owner !== customerB) {
    console.log("  (self-heal: reassigning fixture EMU back to its home customer)");
    await reassignEmuCrossCustomer(device.id, customerB, siteB.id, buildingB.id);
    status = "ACTIVE";
  } else if (status === "ACTIVE" && owner !== customerB) {
    console.log("  (self-heal: decommission + reassign fixture EMU back to its home customer)");
    await decommissionEmu(device.id);
    await reassignEmuCrossCustomer(device.id, customerB, siteB.id, buildingB.id);
    status = "ACTIVE";
  } else if (status === "DECOMMISSIONED") {
    console.log("  (self-heal: redeploying fixture EMU left decommissioned by a prior run)");
    await redeployEmu(device.id, siteB.id, buildingB.id);
    status = "ACTIVE";
  }
  const { data: emuBase } = await supabase
    .from("emus")
    .select("status, owner_customer_id")
    .eq("id", emuId)
    .single();
  check(
    "baseline: EMU is ACTIVE under its home customer",
    emuBase?.status === "ACTIVE" && emuBase?.owner_customer_id === customerB,
    `status=${emuBase?.status} owner=${emuBase?.owner_customer_id}`
  );
  console.log("");

  // ── 1. Reassign while ACTIVE must fail ───────────────────────
  console.log("Rejected transitions...");
  await expectThrow(
    "reassign while ACTIVE is rejected",
    () => reassignEmuCrossCustomer(device.id, customerA, siteA.id, buildingA.id),
    /not decommissioned/
  );

  // ── 2. Decommission, then same-customer target must fail ─────
  await decommissionEmu(device.id);
  await expectThrow(
    "reassign to the current customer is rejected (use redeploy_emu)",
    () => reassignEmuCrossCustomer(device.id, customerB, siteB.id, buildingB.id),
    /current customer/
  );

  // ── 3. Site outside the target customer must fail ────────────
  await expectThrow(
    "target site outside the target customer is rejected",
    () => reassignEmuCrossCustomer(device.id, customerA, siteB.id, buildingB.id),
    /does not belong/
  );
  check(
    "rejected reassigns left the EMU decommissioned",
    ((await supabase.from("emus").select("status").eq("id", emuId).single()).data
      ?.status as string) === "DECOMMISSIONED",
    "status=DECOMMISSIONED"
  );
  console.log("");

  // ── 4. Valid cross-customer reassign ─────────────────────────
  console.log("Valid cross-customer reassign (B → A)...");
  const moved = await reassignEmuCrossCustomer(device.id, customerA, siteA.id, buildingA.id);
  const { data: emuA } = await supabase
    .from("emus")
    .select("status, owner_customer_id, ownership_party")
    .eq("id", emuId)
    .single();
  check(
    "reassign: EMU is ACTIVE under the target customer",
    emuA?.status === "ACTIVE" && emuA?.owner_customer_id === customerA,
    `status=${emuA?.status} owner=${emuA?.owner_customer_id}`
  );
  const { data: openA } = await supabase
    .from("emu_installations")
    .select("id, customer_id, site_id")
    .eq("emu_id", emuId)
    .is("ended_at", null);
  check("reassign: exactly one open installation", openA?.length === 1, `count=${openA?.length}`);
  check(
    "reassign: installation belongs to the target customer and site",
    openA?.[0]?.customer_id === customerA && openA?.[0]?.site_id === siteA.id,
    `customer=${openA?.[0]?.customer_id} site=${openA?.[0]?.site_id}`
  );
  check(
    "reassign: returned installation matches the open row",
    moved.installationId === openA?.[0]?.id,
    `returned=${moved.installationId}`
  );
  check(
    "reassign: ownership_party is carried unchanged",
    emuA?.ownership_party === ownershipBefore,
    `before=${ownershipBefore} after=${emuA?.ownership_party}`
  );
  console.log("");

  // ── 5. Move the fixture back home ────────────────────────────
  console.log("Restore fixture (A → B)...");
  await decommissionEmu(device.id);
  await reassignEmuCrossCustomer(device.id, customerB, siteB.id, buildingB.id);
  const { data: emuRestored } = await supabase
    .from("emus")
    .select("status, owner_customer_id")
    .eq("id", emuId)
    .single();
  const { data: openRestored } = await supabase
    .from("emu_installations")
    .select("customer_id")
    .eq("emu_id", emuId)
    .is("ended_at", null);
  check(
    "restore: EMU is ACTIVE back under its home customer",
    emuRestored?.status === "ACTIVE" && emuRestored?.owner_customer_id === customerB,
    `status=${emuRestored?.status} owner=${emuRestored?.owner_customer_id}`
  );
  check(
    "restore: open installation belongs to the home customer",
    openRestored?.[0]?.customer_id === customerB,
    `customer=${openRestored?.[0]?.customer_id}`
  );

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

  console.log(
    "\nRM-09 cross-customer reassignment is transactional and fail-closed. " +
      "Fixture EMU left ACTIVE under its home customer (safe to delete)."
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
