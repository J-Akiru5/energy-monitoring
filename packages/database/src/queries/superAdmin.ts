import { getSupabaseAdmin } from "../client";

/**
 * An active (non-revoked, non-expired) super admin grant.
 * `isTemporary` is true when expires_at is set — decision #9 demo grants.
 */
export interface SuperAdminGrant {
  userId: string;
  expiresAt: string | null;
  isTemporary: boolean;
}

/**
 * Resolve a user's active super admin grant, or null when there is none.
 *
 * Fails closed by construction: revoked rows and expired temporary grants
 * both resolve to null. Throws on lookup errors so callers (isSuperAdmin)
 * can deliberately fail closed rather than silently allowing access.
 */
export async function getActiveSuperAdminGrant(
  userId: string
): Promise<SuperAdminGrant | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("super_admins")
    .select("user_id, expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Super admin lookup failed: ${error.message}`);
  }

  if (!data) return null;

  const expiresAt = (data.expires_at as string | null) ?? null;

  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return {
    userId: data.user_id as string,
    expiresAt,
    isTemporary: expiresAt !== null,
  };
}

/**
 * Record one audit row for a temporary super admin grant access.
 * Called by isSuperAdmin() only when the resolved grant is temporary.
 */
export async function recordSuperAdminAccess(
  userId: string,
  wasTemporaryGrant: boolean
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("super_admin_access_log")
    .insert({ user_id: userId, was_temporary_grant: wasTemporaryGrant });

  if (error) {
    throw new Error(`Super admin access log insert failed: ${error.message}`);
  }
}

/**
 * Grant or update a temporary super admin grant with a computed expiry.
 * Used by scripts/grant-temporary-super-admin.ts — never by UI.
 *
 * Existing rows keep their original granted_by/granted_at; re-granting
 * clears revoked_at so a previously revoked row becomes active again.
 */
export async function grantTemporarySuperAdmin(
  userId: string,
  expiresAt: string
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: lookupError } = await supabase
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Super admin lookup failed: ${lookupError.message}`);
  }

  if (existing) {
    const { error } = await supabase
      .from("super_admins")
      .update({ expires_at: expiresAt, revoked_at: null })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Temporary super admin update failed: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase
    .from("super_admins")
    .insert({ user_id: userId, expires_at: expiresAt });

  if (error) {
    throw new Error(`Temporary super admin insert failed: ${error.message}`);
  }
}
