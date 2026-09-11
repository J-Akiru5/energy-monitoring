import { getSupabaseAdmin } from "@energy/database";
import type { Permission } from "@energy/database";

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
}

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

  let query = supabase
    .from("memberships")
    .select(
      `
      id,
      customer_id,
      membership_permissions ( permission, granted )
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
    }>;
    const granted = grants.filter((g) => g.granted).map((g) => g.permission);

    if (granted.includes(requiredPermission)) {
      return { customerId: membership.customer_id as string, permissions: granted };
    }
  }

  throw new AccessDeniedError(
    `User ${userId} lacks required permission "${requiredPermission}"` +
      (resourceId ? ` for customer ${resourceId}` : "")
  );
}
