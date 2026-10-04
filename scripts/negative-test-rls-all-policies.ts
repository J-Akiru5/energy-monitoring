/**
 * Negative test: proves the membership-scoped RLS SELECT policies on all 12
 * tenant tables actually isolate data between customers — exercised with real
 * user-context clients (anon key + password sign-in), NOT the service role.
 *
 * Why this exists: the previous devices test (negative-test-devices-rls.ts)
 * ran entirely through getSupabaseAdmin() and only *simulated* the policy
 * logic, so it never actually exercised RLS. This suite queries PostgREST
 * as each signed-in user and asserts the database itself filters rows.
 *
 * Per table, all four checks must hold:
 *   A→A  user A sees A's fixture row          (policy not over-restrictive)
 *   A→B  user A does NOT see B's fixture row  (no cross-tenant leak)
 *   B→B  user B sees B's fixture row
 *   B→A  user B does NOT see A's fixture row
 * A service-role sanity check confirms B's row exists, so a negative can
 * never pass vacuously.
 *
 * Modes:
 *   node scripts/negative-test-rls-all-policies.ts              # DRY RUN:
 *       read-only fixture inventory; performs no writes
 *   node scripts/negative-test-rls-all-policies.ts --execute    # full run:
 *       creates missing TEST fixtures, rotates the two test-user
 *       passwords, signs in, and asserts — all on "TEST — safe to
 *       delete" fixture data only
 *
 * Prerequisites:
 *   - RLS migrations applied (20260910220000 core, 20260910230000 telemetry)
 *   - apps/web/.env with NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY
 *   - Run from repo root
 *
 * Fixture data is deliberately NOT torn down (matches existing scripts).
 * Test accounts: test-rls-verification@example.invalid (A),
 * test-rls-negative-b@example.invalid (B) — disposable, @example.invalid.
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

const { getSupabaseAdmin, createAuthUser, generatePassword } = await import(
  "@energy/database"
);

const EXECUTE = process.argv.includes("--execute");
const MARKER = "TEST - RLS negative-test fixture (safe to delete)";

const A = {
  label: "A",
  customer: "TEST — RLS Verification (safe to delete)",
  site: "TEST Site — RLS Verification",
  building: "TEST Building — RLS Verification",
  device: "TEST Device — RLS Verification (safe to delete)",
  emuLabel: "EMU-TEST-RLS-001",
  email: "test-rls-verification@example.invalid",
};

const B = {
  label: "B",
  customer: "TEST-B — RLS Negative Test (safe to delete)",
  site: "TEST-B Site — RLS Negative Test",
  building: "TEST-B Building — RLS Negative Test",
  device: "TEST-B Device — RLS Negative Test (safe to delete)",
  emuLabel: "EMU-TEST-B-RLS-002",
  email: "test-rls-negative-b@example.invalid",
};

const missing: string[] = [];

function sha256hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

interface Chain {
  customerId: string;
  siteId: string;
  buildingId: string;
  deviceId: string;
  emuId: string;
  controllerId: string;
  installationId: string;
  readingId: string;
  alertId: string;
  relayLogId: string;
  blackoutId: string;
  alertStateId: string;
  userId: string;
}

type Supabase = ReturnType<typeof getSupabaseAdmin>;

async function ensureChain(supabase: Supabase, spec: typeof A): Promise<Chain | null> {
  console.log(`\n── Fixtures for customer ${spec.label} ──`);

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("name", spec.customer)
    .maybeSingle();

  let customerId = customer?.id as string | undefined;
  if (!customerId) {
    missing.push(`${spec.label}:customer`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("customers")
      .insert({ name: spec.customer, type: "ORGANIZATION", status: "ACTIVE" })
      .select("id")
      .single();
    if (error) throw new Error(`create customer ${spec.label}: ${error.message}`);
    customerId = data.id;
    console.log(`  + customer ${customerId}`);
  } else {
    console.log(`  = customer ${customerId}`);
  }

  const { data: site } = await supabase
    .from("sites")
    .select("id")
    .eq("customer_id", customerId)
    .eq("name", spec.site)
    .maybeSingle();
  let siteId = site?.id as string | undefined;
  if (!siteId) {
    missing.push(`${spec.label}:site`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("sites")
      .insert({ customer_id: customerId, name: spec.site })
      .select("id")
      .single();
    if (error) throw new Error(`create site ${spec.label}: ${error.message}`);
    siteId = data.id;
    console.log(`  + site ${siteId}`);
  } else {
    console.log(`  = site ${siteId}`);
  }

  const { data: building } = await supabase
    .from("buildings")
    .select("id")
    .eq("site_id", siteId)
    .eq("name", spec.building)
    .limit(1)
    .maybeSingle();
  let buildingId = building?.id as string | undefined;
  if (!buildingId) {
    missing.push(`${spec.label}:building`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("buildings")
      .insert({ site_id: siteId, name: spec.building })
      .select("id")
      .single();
    if (error) throw new Error(`create building ${spec.label}: ${error.message}`);
    buildingId = data.id;
    console.log(`  + building ${buildingId}`);
  } else {
    console.log(`  = building ${buildingId}`);
  }

  const { data: device } = await supabase
    .from("devices")
    .select("id, api_key_hash")
    .eq("name", spec.device)
    .maybeSingle();
  let deviceId = device?.id as string | undefined;
  let deviceToken = device?.api_key_hash as string | undefined;
  if (!deviceId) {
    missing.push(`${spec.label}:device`);
    if (!EXECUTE) return null;
    deviceToken = `em_test_${spec.label.toLowerCase()}_${crypto.randomUUID().replace(/-/g, "")}`;
    const { data, error } = await supabase
      .from("devices")
      .insert({ name: spec.device, api_key_hash: deviceToken, is_active: true })
      .select("id")
      .single();
    if (error) throw new Error(`create device ${spec.label}: ${error.message}`);
    deviceId = data.id;
    console.log(`  + device ${deviceId}`);
  } else {
    console.log(`  = device ${deviceId}`);
  }

  const { data: emu } = await supabase
    .from("emus")
    .select("id")
    .eq("label", spec.emuLabel)
    .maybeSingle();
  let emuId = emu?.id as string | undefined;
  if (!emuId) {
    missing.push(`${spec.label}:emu`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("emus")
      .insert({
        label: spec.emuLabel,
        owner_type: "CUSTOMER",
        owner_customer_id: customerId,
        status: "ACTIVE",
      })
      .select("id")
      .single();
    if (error) throw new Error(`create emu ${spec.label}: ${error.message}`);
    emuId = data.id;
    console.log(`  + emu ${emuId}`);
  } else {
    console.log(`  = emu ${emuId}`);
  }

  const { data: controller } = await supabase
    .from("controllers")
    .select("id")
    .eq("legacy_device_id", deviceId)
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  let controllerId = controller?.id as string | undefined;
  if (!controllerId) {
    missing.push(`${spec.label}:controller`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("controllers")
      .insert({
        emu_id: emuId,
        token_hash: sha256hex(deviceToken!),
        legacy_device_id: deviceId,
        status: "ACTIVE",
      })
      .select("id")
      .single();
    if (error) throw new Error(`create controller ${spec.label}: ${error.message}`);
    controllerId = data.id;
    console.log(`  + controller ${controllerId}`);
  } else {
    console.log(`  = controller ${controllerId}`);
  }

  const { data: installation } = await supabase
    .from("emu_installations")
    .select("id")
    .eq("emu_id", emuId)
    .is("ended_at", null)
    .maybeSingle();
  let installationId = installation?.id as string | undefined;
  if (!installationId) {
    missing.push(`${spec.label}:installation`);
    if (!EXECUTE) return null;
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
    if (error) throw new Error(`create installation ${spec.label}: ${error.message}`);
    installationId = data.id;
    console.log(`  + installation ${installationId}`);
  } else {
    console.log(`  = installation ${installationId}`);
  }

  // ── One row per RLS-policy table, explicitly stamped with customer_id ──
  const now = new Date().toISOString();

  const { data: reading } = await supabase
    .from("power_readings")
    .select("id")
    .eq("device_id", deviceId)
    .eq("customer_id", customerId)
    .limit(1)
    .maybeSingle();
  let readingId = reading?.id as string | undefined;
  if (!readingId) {
    missing.push(`${spec.label}:power_readings`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("power_readings")
      .insert({
        device_id: deviceId,
        voltage: 230,
        current_amp: 1,
        power_w: 230,
        energy_kwh: 0.001,
        frequency: 60,
        power_factor: 1,
        recorded_at: now,
        customer_id: customerId,
        emu_id: emuId,
        installation_id: installationId,
        controller_id: controllerId,
        phase_config: "SINGLE_PHASE",
      })
      .select("id")
      .single();
    if (error) throw new Error(`create reading ${spec.label}: ${error.message}`);
    readingId = data.id;
    console.log(`  + power_readings ${readingId}`);
  } else {
    console.log(`  = power_readings ${readingId}`);
  }

  const { data: alert } = await supabase
    .from("alerts")
    .select("id")
    .eq("device_id", deviceId)
    .eq("message", MARKER)
    .limit(1)
    .maybeSingle();
  let alertId = alert?.id as string | undefined;
  if (!alertId) {
    missing.push(`${spec.label}:alerts`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("alerts")
      .insert({
        device_id: deviceId,
        type: "OVERVOLTAGE",
        value: 230,
        threshold: 250,
        message: MARKER,
        phase: null,
        is_incident: false,
        customer_id: customerId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`create alert ${spec.label}: ${error.message}`);
    alertId = data.id;
    console.log(`  + alerts ${alertId}`);
  } else {
    console.log(`  = alerts ${alertId}`);
  }

  const { data: relayLog } = await supabase
    .from("relay_logs")
    .select("id")
    .eq("device_id", deviceId)
    .eq("notes", MARKER)
    .limit(1)
    .maybeSingle();
  let relayLogId = relayLog?.id as string | undefined;
  if (!relayLogId) {
    missing.push(`${spec.label}:relay_logs`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("relay_logs")
      .insert({
        device_id: deviceId,
        action: "STATUS_CHECK",
        initiated_by: "TEST",
        notes: MARKER,
        created_at: now,
        customer_id: customerId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`create relay log ${spec.label}: ${error.message}`);
    relayLogId = data.id;
    console.log(`  + relay_logs ${relayLogId}`);
  } else {
    console.log(`  = relay_logs ${relayLogId}`);
  }

  const { data: blackout } = await supabase
    .from("blackout_events")
    .select("id")
    .eq("device_id", deviceId)
    .eq("customer_id", customerId)
    .limit(1)
    .maybeSingle();
  let blackoutId = blackout?.id as string | undefined;
  if (!blackoutId) {
    missing.push(`${spec.label}:blackout_events`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("blackout_events")
      .insert({
        device_id: deviceId,
        started_at: now,
        customer_id: customerId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`create blackout ${spec.label}: ${error.message}`);
    blackoutId = data.id;
    console.log(`  + blackout_events ${blackoutId}`);
  } else {
    console.log(`  = blackout_events ${blackoutId}`);
  }

  const { data: alertState } = await supabase
    .from("device_alert_state")
    .select("id")
    .eq("device_id", deviceId)
    .eq("alert_type", "OVERVOLTAGE")
    .eq("phase", "")
    .maybeSingle();
  let alertStateId = alertState?.id as string | undefined;
  if (!alertStateId) {
    missing.push(`${spec.label}:device_alert_state`);
    if (!EXECUTE) return null;
    const { data, error } = await supabase
      .from("device_alert_state")
      .upsert(
        {
          device_id: deviceId,
          alert_type: "OVERVOLTAGE",
          phase: "",
          is_active: false,
          in_recovery: false,
          current_alert_id: null,
          started_at: now,
          recovery_started_at: null,
          updated_at: now,
          customer_id: customerId,
        },
        { onConflict: "device_id,alert_type,phase" }
      )
      .select("id")
      .single();
    if (error) throw new Error(`create alert state ${spec.label}: ${error.message}`);
    alertStateId = data.id;
    console.log(`  + device_alert_state ${alertStateId}`);
  } else {
    console.log(`  = device_alert_state ${alertStateId}`);
  }

  // ── Test user + membership ──
  const { data: users } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = users?.users.find((u) => u.email === spec.email);
  let userId = existing?.id as string | undefined;
  if (!userId) {
    missing.push(`${spec.label}:user`);
    if (!EXECUTE) return null;
    const created = await createAuthUser(supabase, spec.email);
    userId = created.userId;
    console.log(`  + user ${userId}`);
  } else {
    console.log(`  = user ${userId}`);
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!membership) {
    missing.push(`${spec.label}:membership`);
    if (!EXECUTE) return null;
    const { error } = await supabase
      .from("memberships")
      .insert({ user_id: userId, customer_id: customerId, role: "VIEWER" });
    if (error) throw new Error(`create membership ${spec.label}: ${error.message}`);
    console.log(`  + membership (VIEWER)`);
  } else {
    console.log(`  = membership`);
  }

  return {
    customerId,
    siteId,
    buildingId,
    deviceId,
    emuId,
    controllerId,
    installationId,
    readingId,
    alertId,
    relayLogId,
    blackoutId,
    alertStateId,
    userId,
  };
}

async function signIn(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`sign-in failed for ${email}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function userSelect(
  jwt: string,
  table: string,
  id: string
): Promise<{ status: number; rows: Array<{ id: string }> | null; body?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(
    `${url}/rest/v1/${table}?select=id&id=eq.${encodeURIComponent(id)}`,
    { headers: { apikey: anon, Authorization: `Bearer ${jwt}` } }
  );
  if (res.status !== 200) {
    return { status: res.status, rows: null, body: (await res.text()).slice(0, 200) };
  }
  return { status: 200, rows: (await res.json()) as Array<{ id: string }> };
}

interface RowResult {
  table: string;
  aToA: boolean;
  aToB: boolean;
  bToB: boolean;
  bToA: boolean;
  detail: string;
}

function check(rows: Array<{ id: string }> | null, id: string, want: boolean): boolean {
  const present = (rows ?? []).some((r) => r.id === id);
  return present === want;
}

async function main() {
  const supabase = getSupabaseAdmin();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(` RLS negative test — all 12 tenant tables${EXECUTE ? "" : " (DRY RUN)"}`);
  console.log(` project: ${url}`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (!url || !anon) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const chainA = await ensureChain(supabase, A);
  const chainB = await ensureChain(supabase, B);

  if (!EXECUTE) {
    console.log("\n── DRY RUN summary ──");
    if (missing.length === 0) {
      console.log("All fixtures present. Re-run with --execute to run the assertions.");
    } else {
      console.log("Missing fixtures (--execute would create these):");
      for (const m of missing) console.log(`  - ${m}`);
    }
    console.log("\nNo writes performed.");
    return;
  }

  if (!chainA || !chainB) {
    throw new Error("Fixture creation incomplete — re-run to converge.");
  }

  // ── Fresh credentials for both disposable test users, then sign in ──
  console.log("\n── Signing in as each test user ──");
  const passwordA = generatePassword();
  const passwordB = generatePassword();
  const { error: pwErrA } = await supabase.auth.admin.updateUserById(chainA.userId, {
    password: passwordA,
  });
  if (pwErrA) throw new Error(`password reset A: ${pwErrA.message}`);
  const { error: pwErrB } = await supabase.auth.admin.updateUserById(chainB.userId, {
    password: passwordB,
  });
  if (pwErrB) throw new Error(`password reset B: ${pwErrB.message}`);
  const jwtA = await signIn(A.email, passwordA);
  const jwtB = await signIn(B.email, passwordB);
  console.log("  both sessions established");

  // ── Per-table assertions ──
  const pairs: Array<{ table: string; a: string; b: string }> = [
    { table: "customers", a: chainA.customerId, b: chainB.customerId },
    { table: "sites", a: chainA.siteId, b: chainB.siteId },
    { table: "buildings", a: chainA.buildingId, b: chainB.buildingId },
    { table: "emus", a: chainA.emuId, b: chainB.emuId },
    { table: "controllers", a: chainA.controllerId, b: chainB.controllerId },
    { table: "emu_installations", a: chainA.installationId, b: chainB.installationId },
    { table: "power_readings", a: chainA.readingId, b: chainB.readingId },
    { table: "alerts", a: chainA.alertId, b: chainB.alertId },
    { table: "relay_logs", a: chainA.relayLogId, b: chainB.relayLogId },
    { table: "blackout_events", a: chainA.blackoutId, b: chainB.blackoutId },
    { table: "device_alert_state", a: chainA.alertStateId, b: chainB.alertStateId },
    { table: "devices", a: chainA.deviceId, b: chainB.deviceId },
  ];

  const results: RowResult[] = [];

  console.log("\n── Assertions (user-context queries, RLS applied) ──");
  for (const p of pairs) {
    // Sanity: both fixture rows exist for the service role.
    const { data: sanityB } = await supabase
      .from(p.table)
      .select("id")
      .eq("id", p.b)
      .maybeSingle();
    const { data: sanityA } = await supabase
      .from(p.table)
      .select("id")
      .eq("id", p.a)
      .maybeSingle();

    const aSeesA = await userSelect(jwtA, p.table, p.a);
    const aSeesB = await userSelect(jwtA, p.table, p.b);
    const bSeesB = await userSelect(jwtB, p.table, p.b);
    const bSeesA = await userSelect(jwtB, p.table, p.a);

    const ok =
      sanityA !== null &&
      sanityB !== null &&
      aSeesA.status === 200 &&
      aSeesB.status === 200 &&
      bSeesB.status === 200 &&
      bSeesA.status === 200 &&
      check(aSeesA.rows, p.a, true) &&
      check(aSeesB.rows, p.b, false) &&
      check(bSeesB.rows, p.b, true) &&
      check(bSeesA.rows, p.a, false);

    const detail = [
      `sanity(a=${sanityA ? "ok" : "MISSING"},b=${sanityB ? "ok" : "MISSING"})`,
      `A→A=${aSeesA.status}/${aSeesA.rows?.length ?? "!"}`,
      `A→B=${aSeesB.status}/${aSeesB.rows?.length ?? "!"}`,
      `B→B=${bSeesB.status}/${bSeesB.rows?.length ?? "!"}`,
      `B→A=${bSeesA.status}/${bSeesA.rows?.length ?? "!"}`,
    ].join(" ");

    results.push({
      table: p.table,
      aToA: check(aSeesA.rows, p.a, true),
      aToB: check(aSeesB.rows, p.b, false),
      bToB: check(bSeesB.rows, p.b, true),
      bToA: check(bSeesA.rows, p.a, false),
      detail,
    });

    console.log(`  ${ok ? "PASS" : "FAIL"}  ${p.table.padEnd(20)} ${detail}`);
  }

  // ── Matrix + summary ──
  console.log("\n── Per-table matrix ──");
  console.log(
    "  TABLE                A sees A  A sees B  B sees B  B sees A  RESULT"
  );
  for (const r of results) {
    const pass = r.aToA && r.aToB && r.bToB && r.bToA;
    console.log(
      `  ${r.table.padEnd(20)} ${(r.aToA ? "yes" : "NO ").padEnd(9)} ${(r.aToB ? "0" : "LEAK").padEnd(9)} ${(r.bToB ? "yes" : "NO ").padEnd(9)} ${(r.bToA ? "0" : "LEAK").padEnd(9)} ${pass ? "PASS" : "FAIL"}`
    );
  }

  const failed = results.filter(
    (r) => !(r.aToA && r.aToB && r.bToB && r.bToA)
  );
  console.log(
    `\n══ ${results.length - failed.length}/${results.length} policies isolate in both directions ══`
  );
  if (failed.length > 0) {
    console.log("Failed tables:");
    for (const r of failed) console.log(`  - ${r.table}: ${r.detail}`);
    process.exit(1);
  }

  console.log("\nFixture data (not torn down — Jeff's call):");
  console.log(
    JSON.stringify(
      {
        customerA: chainA.customerId,
        customerB: chainB.customerId,
        userA: A.email,
        userB: B.email,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
