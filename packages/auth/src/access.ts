import { getSupabaseAdmin } from "@energy/database";
import type { Permission } from "@energy/database";
import { ALL_PERMISSIONS } from "@energy/database";

/**
 * Thrown by resolveAccess() when a user has no membership granting the
 * required permission. Callers (API routes) should catch this and return
 * a 403 — it deliberately does not extend a framework-specific error type
 * so this package stays framework-agnostic.
 */
export class AccessDeniedError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export interface ResolvedAccess {
  /** The customer whose data this user is authorized to act on. */
  customerId: string;
  /** All granted permissions on that membership. */
  permissions: Permission[];
  /** True when access was granted via the super_admins bypass. */
  isSuperAdmin: boolean;
  /**
   * True when the super-admin bypass came from a temporary grant
   * (expires_at set — decision #9). Temporary grants are read-only
   * (RM-12, 2026-10-05): mutating routes must reject this flag.
   */
  isTemporarySuperAdmin: boolean;
  /**
   * Membership scope rows (RM-11, decision #4): when non-empty, the
   * membership is limited to those targets ('customer' | 'site' |
   * 'building' | 'emu'). Empty = customer-wide (roles.ts convention).
   * Super Admins are unscoped by design.
   */
  scopes: Array<{ type: string; id: string }>;
}

/** Sentinel customerId returned for Super Admins when no resourceId is specified. */
export const SUPER_ADMIN_CUSTOMER_ID = "*" as const;

/**
 * Resolve what a user is allowed to do, and for which customer.
 *
 * This is the ONE place membership/permission lookup happens — every
 * API route that reads or writes customer-scoped data calls this first,
 * then passes the returned customerId down into query functions. Query
 * functions themselves must never re-resolve access — see readings.ts.
 *
 * Looks up membership(s) + membership_permissions via the service-role
 * client. That lookup itself doesn't need RLS: it IS the auth layer
 * confirming who someone is, not the data layer RLS is meant to protect.
 *
 * @param userId              auth.users id of the caller (from a verified session)
 * @param requiredPermission  the permission the caller needs (e.g. "view_energy")
 * @param resourceId          optional customer_id to check membership against,
 *                            when the caller already knows which customer
 *                            they're asking about (e.g. from a scoped route).
 *                            When omitted, resolves to the first membership
 *                            that grants the required permission.
 * @throws AccessDeniedError  if no membership grants the required permission
 */
export async function resolveAccess(
  userId: string,
  requiredPermission: Permission,
  resourceId?: string
): Promise<ResolvedAccess> {
  const supabase = getSupabaseAdmin();

  // ── Super Admin bypass ──
  // Check super_admins first; if the user is an active (non-revoked,
  // non-expired) Super Admin, grant access immediately — no membership
  // required. The sentinel customerId ("*") signals to callers that this is
  // cross-customer access; callers that need customer-scoped data should
  // branch on isSuperAdmin.
  //
  // expires_at (migration 20260913000000, decision #9):
  //   NULL     → permanent grant (never expires)
  //   non-NULL → temporary/demo grant; fails closed once past
  // An expired grant is treated exactly like no grant at all: we fall
  // through to the standard membership resolution below.
  const { data: superAdmin, error: saError } = await supabase
    .from("super_admins")
    .select("user_id, expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();

  if (saError) {
    throw new Error(`resolveAccess: super_admins lookup failed: ${saError.message}`);
  }

  if (superAdmin) {
    const expiresAtMs = superAdmin.expires_at
      ? Date.parse(superAdmin.expires_at as string)
      : null;
    // Invalid date values fail closed too (cannot prove the grant is valid).
    const isExpired = expiresAtMs !== null && (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now());

    if (!isExpired) {
      // Audit trail (decision #9): log temporary-grant resolutions only.
      // Permanent grants are intentionally not logged. Audit failures must
      // never block authorization.
      if (expiresAtMs !== null) {
        const { error: logError } = await supabase
          .from("super_admin_access_log")
          .insert({ user_id: userId, was_temporary_grant: true });
        if (logError) {
          console.warn(
            `resolveAccess: super_admin_access_log insert failed: ${logError.message}`
          );
        }
      }

      return {
        customerId: resourceId ?? SUPER_ADMIN_CUSTOMER_ID,
        permissions: ALL_PERMISSIONS,
        isSuperAdmin: true,
        isTemporarySuperAdmin: expiresAtMs !== null,
        scopes: [],
      };
    }

    // Expired temporary grant: fall through to membership resolution.
  }

  // ── Standard membership check ──
  let query = supabase
    .from("memberships")
    .select(
      `
      id,
      customer_id,
      membership_permissions ( permission, granted, expires_at ),
      membership_scopes ( scope_type, scope_id )
    `
    )
    .eq("user_id", userId);

  if (resourceId) {
    query = query.eq("customer_id", resourceId);
  }

  const { data: memberships, error } = await query;

  if (error) {
    throw new Error(`resolveAccess: membership lookup failed: ${error.message}`);
  }

  if (!memberships || memberships.length === 0) {
    throw new AccessDeniedError(
      resourceId
        ? `User ${userId} has no membership for customer ${resourceId}`
        : `User ${userId} has no membership on any customer`
    );
  }

  for (const membership of memberships) {
    const grants = (membership.membership_permissions ?? []) as Array<{
      permission: Permission;
      granted: boolean;
      expires_at: string | null;
    }>;
    const nowMs = Date.now();
    const granted = grants
      .filter((g) => {
        if (!g.granted) return false;
        // RM-11 / decision #4: a grant with expires_at fails closed once
        // past. Invalid dates are treated as expired, not as eternal.
        if (g.expires_at == null) return true;
        const expiresMs = Date.parse(g.expires_at);
        return Number.isFinite(expiresMs) && expiresMs > nowMs;
      })
      .map((g) => g.permission);

    if (granted.includes(requiredPermission)) {
      const scopes = (
        (membership.membership_scopes ?? []) as Array<{
          scope_type: string;
          scope_id: string;
        }>
      ).map((s) => ({ type: s.scope_type, id: s.scope_id }));

      return {
        customerId: membership.customer_id as string,
        permissions: granted,
        isSuperAdmin: false,
        isTemporarySuperAdmin: false,
        scopes,
      };
    }
  }

  throw new AccessDeniedError(
    `User ${userId} lacks required permission "${requiredPermission}"` +
      (resourceId ? ` for customer ${resourceId}` : "")
  );
}
