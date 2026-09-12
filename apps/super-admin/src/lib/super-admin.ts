import { getSupabaseAdmin } from "@energy/database";

/**
 * Server-side check: is this auth user an active (non-revoked) Super Admin?
 * Uses the service-role client because super_admins is not readable by
 * regular authenticated users. Fails closed on lookup errors.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    console.error("super_admins lookup failed:", error.message);
    return false;
  }

  return Boolean(data);
}
