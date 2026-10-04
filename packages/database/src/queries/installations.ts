import { getSupabaseAdmin } from "../client";

/**
 * One row of an EMU's installation history, with the site/building/customer
 * names the view needs. `ended_at = null` marks the current installation.
 */
export interface InstallationHistoryRow {
  id: string;
  emu_id: string;
  customer_id: string;
  site_id: string;
  building_id: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  site: { name: string } | null;
  building: { name: string } | null;
  customer: { name: string } | null;
}

/**
 * Installation history for an EMU, scoped per ADR-07.
 *
 * ADR-07: non-Super-Admin callers see only installation rows belonging to
 * their own customer (their tenancy period); Super Admin callers pass no
 * customerId and see every period for the EMU. getSupabaseAdmin() bypasses
 * RLS, so the explicit customer_id filter below is the actual isolation
 * boundary for this query, not just defense in depth.
 *
 * @param emuId       The EMU whose history is requested.
 * @param customerId  The caller's authorized customer. Omit ONLY for Super
 *                    Admin callers — the API route enforces that split.
 */
export async function getInstallationHistory(
  emuId: string,
  customerId?: string
): Promise<InstallationHistoryRow[]> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("emu_installations")
    .select(
      "id, emu_id, customer_id, site_id, building_id, started_at, ended_at, created_at, site:sites(name), building:buildings(name), customer:customers(name)"
    )
    .eq("emu_id", emuId)
    .order("started_at", { ascending: false });

  if (customerId) {
    query = query.eq("customer_id", customerId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Get installation history failed: ${error.message}`);

  return (data ?? []) as unknown as InstallationHistoryRow[];
}
