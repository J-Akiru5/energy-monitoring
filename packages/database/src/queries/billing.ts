import { getSupabaseAdmin } from "../client";

/**
 * Get the current billing rate.
 */
export async function getBillingRate() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("billing_config")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .single();

  if (error) throw new Error(`Fetch billing rate failed: ${error.message}`);
  return data;
}

/**
 * Update the billing rate (Admin only).
 */
export async function updateBillingRate(ratePhpPerKwh: number) {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("billing_config")
    .insert({
      rate_php_per_kwh: ratePhpPerKwh,
      updated_at: new Date().toISOString(),
    });

  if (error) throw new Error(`Update billing rate failed: ${error.message}`);
}
