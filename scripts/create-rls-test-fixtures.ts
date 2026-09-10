/**
 * One-off script: creates the RLS-verification test fixtures for
 * Phase 3b.3 slice one (power_readings).
 *
 * Creates a clearly-labeled test customer + site + building + device +
 * EMU + controller + installation + configuration + auth user +
 * membership (VIEWER) + permission (view_energy). Nothing here is real
 * customer data — every row is named "TEST — RLS Verification ...".
 *
 * Idempotent: safe to re-run, skips creation of anything that already
 * exists by name/lookup.
 *
 * Usage:  npx tsx scripts/create-rls-test-fixtures.ts
 * Run from repo root. Requires apps/web/.env with SUPABASE_SERVICE_ROLE_KEY.
 *
 * Deliberately NOT torn down at the end — Jeff removes it once he's
 * confirmed the negative-test results himself (per task constraints).
 */

import process from "node:process";
import crypto from "node:crypto";
import path from "node:path";

// Load apps/web/.env explicitly (repo root .env may point at a different
// pooler host — apps/web/.env is the one confirmed working this session).
process.loadEnvFile(path.resolve(__dirname, "../apps/web/.env"));

import { getSupabaseAdmin, createAuthUser, generatePassword } from "@energy/database";

const CUSTOMER_NAME = "TEST — RLS Verification (safe to delete)";
const SITE_NAME = "TEST Site — RLS Verification";
const BUILDING_NAME = "TEST Building — RLS Verification";
const EMU_LABEL = "EMU-TEST-RLS-001";
const DEVICE_NAME = "TEST Device — RLS Verification (safe to delete)";
const TEST_USER_EMAIL = "test-rls-verification@example.invalid";

function sha256hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function main() {
  const supabase = getSupabaseAdmin();

  // ── 1. Customer ─────────────────────────────────────────────
  let { data: customer } = await supabase
    .from("customers")
    .select("id, name")
    .eq("name", CUSTOMER_NAME)
    .maybeSingle();

  if (!customer) {
    const { data, error } = await supabase
      .from("customers")
      .insert({ name: CUSTOMER_NAME, type: "ORGANIZATION", status: "ACTIVE" })
      .select("id, name")
      .single();
    if (error) throw new Error(`Create customer failed: ${error.message}`);
    customer = data;
    console.log(`Created customer: ${customer.name} (${customer.id})`);
  } else {
    console.log(`Customer already exists: ${customer.id}`);
  }
  const customerId = customer.id;

  // ── 2. Site ─────────────────────────────────────────────────
  let { data: site } = await supabase
    .from("sites")
    .select("id")
    .eq("customer_id", customerId)
    .eq("name", SITE_NAME)
    .maybeSingle();

  if (!site) {
    const { data, error } = await supabase
      .from("sites")
      .insert({ customer_id: customerId, name: SITE_NAME })
      .select("id")
      .single();
    if (error) throw new Error(`Create site failed: ${error.message}`);
    site = data;
    console.log(`Created site: ${site.id}`);
  } else {
    console.log(`Site already exists: ${site.id}`);
  }
  const siteId = site.id;

  // ── 3. Building ─────────────────────────────────────────────
  let { data: building } = await supabase
    .from("buildings")
    .select("id")
    .eq("site_id", siteId)
    .eq("name", BUILDING_NAME)
    .maybeSingle();

  if (!building) {
    const { data, error } = await supabase
      .from("buildings")
      .insert({ site_id: siteId, name: BUILDING_NAME })
      .select("id")
      .single();
    if (error) throw new Error(`Create building failed: ${error.message}`);
    building = data;
    console.log(`Created building: ${building.id}`);
  } else {
    console.log(`Building already exists: ${building.id}`);
  }
  const buildingId = building.id;

  // ── 4. Device (legacy bridge table) ────────────────────────
  let { data: device } = await supabase
    .from("devices")
    .select("id, api_key_hash")
    .eq("name", DEVICE_NAME)
    .maybeSingle();

  let rawDeviceToken: string;
  if (!device) {
    rawDeviceToken = `em_test_${crypto.randomUUID().replace(/-/g, "")}`;
    const { data, error } = await supabase
      .from("devices")
      .insert({ name: DEVICE_NAME, api_key_hash: rawDeviceToken, is_active: true })
      .select("id, api_key_hash")
      .single();
    if (error) throw new Error(`Create device failed: ${error.message}`);
    device = data;
    console.log(`Created device: ${device.id}`);
  } else {
    rawDeviceToken = device.api_key_hash; // stored in plaintext (see devices.ts TODO)
    console.log(`Device already exists: ${device.id}`);
  }
  const deviceId = device.id;

  // ── 5. EMU ──────────────────────────────────────────────────
  let { data: emu } = await supabase
    .from("emus")
    .select("id")
    .eq("label", EMU_LABEL)
    .maybeSingle();

  if (!emu) {
    const { data, error } = await supabase
      .from("emus")
      .insert({
        label: EMU_LABEL,
        owner_type: "CUSTOMER",
        owner_customer_id: customerId,
        status: "ACTIVE",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Create EMU failed: ${error.message}`);
    emu = data;
    console.log(`Created EMU: ${emu.id}`);
  } else {
    console.log(`EMU already exists: ${emu.id}`);
  }
  const emuId = emu.id;

  // ── 6. Controller ───────────────────────────────────────────
  let { data: controller } = await supabase
    .from("controllers")
    .select("id")
    .eq("legacy_device_id", deviceId)
    .maybeSingle();

  if (!controller) {
    const { data, error } = await supabase
      .from("controllers")
      .insert({
        emu_id: emuId,
        token_hash: sha256hex(rawDeviceToken),
        legacy_device_id: deviceId,
        status: "ACTIVE",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Create controller failed: ${error.message}`);
    controller = data;
    console.log(`Created controller: ${controller.id}`);
  } else {
    console.log(`Controller already exists: ${controller.id}`);
  }
  const controllerId = controller.id;

  // ── 7. EMU Installation ─────────────────────────────────────
  let { data: installation } = await supabase
    .from("emu_installations")
    .select("id")
    .eq("emu_id", emuId)
    .is("ended_at", null)
    .maybeSingle();

  if (!installation) {
    const { data, error } = await supabase
      .from("emu_installations")
      .insert({
        emu_id: emuId,
        customer_id: customerId,
        site_id: siteId,
        building_id: buildingId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Create installation failed: ${error.message}`);
    installation = data;
    console.log(`Created installation: ${installation.id}`);
  } else {
    console.log(`Installation already exists: ${installation.id}`);
  }

  // ── 8. EMU Configuration (single-phase, matches mock-sensor default) ──
  const { data: existingConfig } = await supabase
    .from("emu_configurations")
    .select("id")
    .eq("emu_id", emuId)
    .is("ended_at", null)
    .maybeSingle();

  if (!existingConfig) {
    const { error } = await supabase
      .from("emu_configurations")
      .insert({ emu_id: emuId, phase_mode: "SINGLE_PHASE" });
    if (error) throw new Error(`Create EMU configuration failed: ${error.message}`);
    console.log(`Created EMU configuration: SINGLE_PHASE`);
  } else {
    console.log(`EMU configuration already exists: ${existingConfig.id}`);
  }

  // ── 9. Test auth user ───────────────────────────────────────
  const { data: existingUsers } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  let userId = existingUsers?.users.find((u) => u.email === TEST_USER_EMAIL)?.id ?? null;
  let password: string | null = null;

  if (!userId) {
    const credentials = await createAuthUser(supabase, TEST_USER_EMAIL);
    userId = credentials.userId;
    password = credentials.password;
    console.log(`Created auth user: ${userId}`);
  } else {
    console.log(`Auth user already exists: ${userId}`);
    // Reset password so this run has a known, usable credential for the
    // negative test — this account is a disposable test fixture, not a
    // real person, so rotating its password has no external impact.
    password = generatePassword();
    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(`Password reset failed: ${error.message}`);
    console.log(`Reset password for existing test user`);
  }

  // ── 10. Membership (VIEWER) ─────────────────────────────────
  let { data: membership } = await supabase
    .from("memberships")
    .select("id, role")
    .eq("user_id", userId)
    .eq("customer_id", customerId)
    .maybeSingle();

  let membershipId: string;
  if (!membership) {
    const { data, error } = await supabase
      .from("memberships")
      .insert({ user_id: userId, customer_id: customerId, role: "VIEWER" })
      .select("id")
      .single();
    if (error) throw new Error(`Create membership failed: ${error.message}`);
    membershipId = data.id;
    console.log(`Created membership: ${membershipId}`);
  } else {
    membershipId = membership.id;
    console.log(`Membership already exists: ${membershipId} (role: ${membership.role})`);
  }

  // ── 11. Permission (view_energy — minimum needed for this test) ──
  const { data: existingPerm } = await supabase
    .from("membership_permissions")
    .select("permission")
    .eq("membership_id", membershipId)
    .eq("permission", "view_energy")
    .maybeSingle();

  if (!existingPerm) {
    const { error } = await supabase
      .from("membership_permissions")
      .insert({ membership_id: membershipId, permission: "view_energy", granted: true });
    if (error) throw new Error(`Create permission failed: ${error.message}`);
    console.log(`Granted view_energy permission`);
  } else {
    console.log(`Permission view_energy already granted`);
  }

  // ── Output (used by the negative-test script — not committed) ──
  console.log("\n── Fixture summary ──");
  console.log(JSON.stringify(
    {
      customerId,
      siteId,
      buildingId,
      deviceId,
      emuId,
      controllerId,
      deviceToken: rawDeviceToken,
      testUserEmail: TEST_USER_EMAIL,
      testUserId: userId,
      testUserPassword: password,
    },
    null,
    2
  ));
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
