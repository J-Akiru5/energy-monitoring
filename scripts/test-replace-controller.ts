/**
 * Live verification for RM-02 replace_controller().
 *
 * Proves, against a real database:
 *   1. Success — old controller → REPLACED + retired_at, new controller
 *      ACTIVE, exactly one ACTIVE per EMU, device token rotated, the new
 *      token authenticates, the old token is rejected.
 *   2. Atomicity — an induced mid-function failure (UNIQUE collision on the
 *      new token hash) rolls the whole transaction back: the old controller
 *      stays ACTIVE and the device token is unchanged. Never two ACTIVE,
 *      never zero.
 *   3. Preconditions — an unknown device errors without side effects.
 *
 * Targets the TEST fixture EMU/device (safe to delete) created by
 * scripts/negative-test-rls-all-policies.ts --execute. This script MUTATES
 * that fixture (that is the point; fixtures are disposable).
 *
 * Run (from repo root, after the migration is applied):
 *   node scripts/test-replace-controller.ts
 */

import process from "node:process";
import crypto from "node:crypto";
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

const { getSupabaseAdmin, replaceController, validateDeviceToken } = await import(
  "@energy/database"
);

const DEVICE_B_NAME = "TEST-B Device — RLS Negative Test (safe to delete)";
const EMU_A_LABEL = "EMU-TEST-RLS-001";
const GHOST_DEVICE_ID = "00000000-0000-4000-8000-000000000000";

const sha256hex = (input: string): string =>
  crypto.createHash("sha256").update(input).digest("hex");

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

async function main() {
  const supabase = getSupabaseAdmin();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" RM-02 live test — replace_controller() transaction");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Fixture lookup ──
  const { data: device } = await supabase
    .from("devices")
    .select("id, name, api_key_hash")
    .eq("name", DEVICE_B_NAME)
    .maybeSingle();
  if (!device) {
    console.error(
      `Fixture device not found ("${DEVICE_B_NAME}"). Run ` +
        `scripts/negative-test-rls-all-policies.ts --execute first.`
    );
    process.exit(1);
  }

  const { data: active } = await supabase
    .from("controllers")
    .select("id, emu_id, token_hash, legacy_device_id, status")
    .eq("legacy_device_id", device.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!active) {
    console.error("No ACTIVE controller for the fixture device — cannot test replacement.");
    process.exit(1);
  }

  const { data: emuA } = await supabase
    .from("emus")
    .select("id")
    .eq("label", EMU_A_LABEL)
    .maybeSingle();
  if (!emuA) {
    console.error(`Fixture EMU not found ("${EMU_A_LABEL}").`);
    process.exit(1);
  }

  const oldToken = device.api_key_hash as string;
  console.log(`Fixture device: ${device.id}`);
  console.log(`Active controller: ${active.id}\n`);

  // ── 1. Atomicity: induced failure must roll everything back ──
  console.log("Atomicity test (induced UNIQUE collision on the new hash)...");
  const collisionToken = `em_collision_${crypto.randomUUID().replace(/-/g, "")}`;
  const { data: dummy, error: dummyErr } = await supabase
    .from("controllers")
    .insert({
      emu_id: emuA.id,
      token_hash: sha256hex(collisionToken),
      legacy_device_id: null,
      status: "REVOKED",
    })
    .select("id")
    .single();
  if (dummyErr || !dummy) {
    throw new Error(`Could not stage collision row: ${dummyErr?.message}`);
  }

  const { error: collisionErr } = await supabase.rpc("replace_controller", {
    p_device_id: device.id,
    p_new_token: collisionToken,
  });
  check(
    "induced collision fails the call",
    collisionErr !== null,
    collisionErr ? collisionErr.message.slice(0, 120) : "no error returned"
  );

  const { data: activeAfterFail } = await supabase
    .from("controllers")
    .select("id, status")
    .eq("legacy_device_id", device.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  check(
    "old controller still ACTIVE after failure (rollback)",
    activeAfterFail?.id === active.id,
    `active=${activeAfterFail?.id ?? "none"}`
  );

  const { data: deviceAfterFail } = await supabase
    .from("devices")
    .select("api_key_hash")
    .eq("id", device.id)
    .single();
  check(
    "device token unchanged after failure (rollback)",
    deviceAfterFail?.api_key_hash === oldToken,
    "token identical"
  );

  const { data: orphanNew } = await supabase
    .from("controllers")
    .select("id")
    .eq("emu_id", active.emu_id)
    .eq("token_hash", sha256hex(collisionToken))
    .maybeSingle();
  check(
    "no partially-inserted controller for the EMU",
    orphanNew === null,
    orphanNew ? `found ${orphanNew.id}` : "none"
  );

  await supabase.from("controllers").delete().eq("id", dummy.id);
  console.log("");

  // ── 2. Success path ──
  console.log("Success path...");
  const replacement = await replaceController(device.id);

  const { data: actives } = await supabase
    .from("controllers")
    .select("id, token_hash, legacy_device_id")
    .eq("emu_id", active.emu_id)
    .eq("status", "ACTIVE");
  check(
    "exactly one ACTIVE controller for the EMU",
    (actives ?? []).length === 1,
    `count=${(actives ?? []).length}`
  );
  check(
    "ACTIVE is the new controller",
    actives?.[0]?.id === replacement.controllerId,
    `active=${actives?.[0]?.id ?? "none"} new=${replacement.controllerId}`
  );
  check(
    "new token_hash = sha256(returned token)",
    actives?.[0]?.token_hash === sha256hex(replacement.deviceToken),
    "hash matches"
  );
  check(
    "legacy device bridge preserved",
    actives?.[0]?.legacy_device_id === device.id,
    `bridge=${actives?.[0]?.legacy_device_id}`
  );

  const { data: oldRow } = await supabase
    .from("controllers")
    .select("status, retired_at")
    .eq("id", active.id)
    .single();
  check(
    "old controller → REPLACED with retired_at",
    oldRow?.status === "REPLACED" && oldRow?.retired_at !== null,
    `status=${oldRow?.status} retired_at=${oldRow?.retired_at ?? "null"}`
  );

  const { data: deviceAfter } = await supabase
    .from("devices")
    .select("api_key_hash")
    .eq("id", device.id)
    .single();
  check(
    "device token rotated to the new token",
    deviceAfter?.api_key_hash === replacement.deviceToken,
    "rotated"
  );

  const newAuth = await validateDeviceToken(replacement.deviceToken);
  check(
    "new token authenticates",
    newAuth?.id === device.id,
    `device=${newAuth?.id ?? "none"}`
  );
  const oldAuth = await validateDeviceToken(oldToken);
  check("old token rejected", oldAuth === null, oldAuth ? `resolved ${oldAuth.id}` : "null");
  console.log("");

  // ── 3. Repeatability: replace the replacement ──
  console.log("Repeatability (second replacement)...");
  const replacement2 = await replaceController(device.id);
  const { data: actives2 } = await supabase
    .from("controllers")
    .select("id")
    .eq("emu_id", active.emu_id)
    .eq("status", "ACTIVE");
  check(
    "still exactly one ACTIVE after second replacement",
    (actives2 ?? []).length === 1 && actives2?.[0]?.id === replacement2.controllerId,
    `count=${(actives2 ?? []).length}`
  );
  const prevAuth = await validateDeviceToken(replacement.deviceToken);
  const newAuth2 = await validateDeviceToken(replacement2.deviceToken);
  check(
    "previous token rejected, newest token accepted",
    prevAuth === null && newAuth2?.id === device.id,
    `prev=${prevAuth ? "accepted!" : "null"} new=${newAuth2?.id ?? "none"}`
  );
  console.log("");

  // ── 4. Precondition: unknown device ──
  console.log("Precondition (unknown device)...");
  let threw = false;
  try {
    await replaceController(GHOST_DEVICE_ID);
  } catch {
    threw = true;
  }
  check("unknown device errors without side effects", threw, threw ? "threw" : "no error");
  const { data: ghostRows } = await supabase
    .from("controllers")
    .select("id")
    .eq("legacy_device_id", GHOST_DEVICE_ID);
  check(
    "no controllers created for the unknown device",
    (ghostRows ?? []).length === 0,
    `count=${(ghostRows ?? []).length}`
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
    "\n✅ replace_controller() is transactional and fail-closed. " +
      "Fixture EMU/device left with the newest controller (safe to delete)."
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
