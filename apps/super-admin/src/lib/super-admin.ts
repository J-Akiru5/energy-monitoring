import {
  getActiveSuperAdminGrant,
  recordSuperAdminAccess,
} from "@energy/database";
import type { SuperAdminGrant } from "@energy/database";

/**
 * Read-only grant lookup for display (no audit logging — that only happens
 * in isSuperAdmin). Fails closed to null on lookup errors.
 */
export async function getSuperAdminGrant(
  userId: string
): Promise<SuperAdminGrant | null> {
  try {
    return await getActiveSuperAdminGrant(userId);
  } catch (err) {
    console.error("super_admins lookup failed:", (err as Error).message);
    return null;
  }
}

/**
 * Server-side check: is this auth user an active Super Admin?
 *
 * Fails closed in all directions, matching the original posture:
 * - lookup errors resolve to false,
 * - revoked grants resolve to null,
 * - temporary grants (expires_at set) resolve to null once expired.
 *
 * Temporary-grant access is recorded to super_admin_access_log (decision #9);
 * permanent grants are not logged, to avoid noise on ongoing legitimate use.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  let grant: SuperAdminGrant | null;
  try {
    grant = await getActiveSuperAdminGrant(userId);
  } catch (err) {
    console.error("super_admins lookup failed:", (err as Error).message);
    return false;
  }

  if (!grant) return false;

  if (grant.isTemporary) {
    try {
      await recordSuperAdminAccess(userId, true);
    } catch (err) {
      // The grant itself was verified; an audit-write failure must not
      // revoke it. Surface loudly instead of silently swallowing.
      console.error(
        "super_admin_access_log insert failed:",
        (err as Error).message
      );
    }
  }

  return true;
}
