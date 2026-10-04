import { createHash } from "node:crypto";
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

const { getSupabaseAdmin } = await import("@energy/database");

const sha256hex = (input) => createHash("sha256").update(input).digest("hex");

async function main() {
  const supabase = getSupabaseAdmin();

  const { data: devices, error: dErr } = await supabase
    .from("devices")
    .select("id, name, is_active, api_key_hash");
  if (dErr) throw new Error(`devices read failed: ${dErr.message}`);

  const { data: controllers, error: cErr } = await supabase
    .from("controllers")
    .select("id, legacy_device_id, status, token_hash");
  if (cErr) throw new Error(`controllers read failed: ${cErr.message}`);

  const bridge = new Map();
  for (const c of controllers ?? []) {
    if (c.legacy_device_id) bridge.set(c.legacy_device_id, c);
  }

  const active = (devices ?? []).filter((d) => d.is_active);
  const missing = active.filter((d) => !bridge.has(d.id));
  const nonActive = active.filter((d) => {
    const c = bridge.get(d.id);
    return c && c.status !== "ACTIVE";
  });
  const stale = active.filter((d) => {
    const c = bridge.get(d.id);
    return c && c.status === "ACTIVE" && c.token_hash !== sha256hex(d.api_key_hash);
  });

  console.log(
    JSON.stringify(
      {
        project: process.env.NEXT_PUBLIC_SUPABASE_URL,
        totalDevices: (devices ?? []).length,
        activeDevices: active.length,
        totalControllers: (controllers ?? []).length,
        missingController: missing.map((d) => ({ id: d.id, name: d.name })),
        nonActiveController: nonActive.map((d) => ({
          id: d.id,
          name: d.name,
          status: bridge.get(d.id).status,
        })),
        staleHash: stale.map((d) => ({ id: d.id, name: d.name })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("precheck failed:", err.message);
  process.exit(1);
});
