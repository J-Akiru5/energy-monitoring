import { lookupControllerByDevice } from "@energy/database";
import type { ResolvedAccess } from "./access";

/**
 * Thrown when a non-super-admin caller attempts to act on a device that
 * does not belong to their authorized customer. Callers should map this
 * to an HTTP 403.
 */
export class DeviceAccessDeniedError extends Error {
  readonly status = 403;

  constructor(message = "Device not found or access denied") {
    super(message);
    this.name = "DeviceAccessDeniedError";
  }
}

/**
 * Verify that the caller may act on `deviceId`.
 *
 * resolveAccess() answers "which customer is this caller authorized for?".
 * This helper answers the second, equally required question: "does the
 * device they are asking about belong to that customer?" — without it, an
 * authenticated member of tenant A can pass tenant B's deviceId and the
 * route will happily act on it (IDOR).
 *
 * Semantics (matching the admin devices route from PR #17):
 *   - Super Admins act cross-customer by design → check is skipped.
 *   - Everyone else → the controllers→emus ownership bridge must resolve
 *     the device AND its customer must equal access.customerId, otherwise
 *     DeviceAccessDeniedError is thrown before the caller does anything.
 */
export async function assertDeviceOwnership(
  access: ResolvedAccess,
  deviceId: string
): Promise<void> {
  if (access.isSuperAdmin) return;

  const stamp = await lookupControllerByDevice(deviceId);
  if (!stamp || stamp.customerId !== access.customerId) {
    throw new DeviceAccessDeniedError();
  }
}

/**
 * Boolean form of the RM-11 scope check: true when the caller's membership
 * scopes allow acting on / seeing `deviceId`. Super Admins and memberships
 * without scope rows are customer-wide (always true).
 */
export async function isDeviceInScopes(
  access: ResolvedAccess,
  deviceId: string
): Promise<boolean> {
  if (access.isSuperAdmin) return true;
  if (!access.scopes || access.scopes.length === 0) return true; // customer-wide

  const stamp = await lookupControllerByDevice(deviceId);
  if (!stamp) return false;

  return access.scopes.some((scope) => {
    if (scope.type === "customer") return scope.id === stamp.customerId;
    if (scope.type === "emu") return scope.id === stamp.emuId;
    if (scope.type === "site") return stamp.siteId != null && scope.id === stamp.siteId;
    if (scope.type === "building") {
      return stamp.buildingId != null && scope.id === stamp.buildingId;
    }
    return false;
  });
}

/**
 * Verify that the caller's membership scopes allow acting on `deviceId`
 * (RM-11, decision #4 — external-delegate safeguards).
 *
 * Scope semantics (matching roles.ts): a membership with scope rows is
 * limited to those targets; no scope rows = customer-wide access. This is
 * enforced on control_relay routes (relay commands + relay config) — the
 * delegate use case the decision covers. General read-path scoping is a
 * separate work item.
 */
export async function assertDeviceInScopes(
  access: ResolvedAccess,
  deviceId: string
): Promise<void> {
  if (!(await isDeviceInScopes(access, deviceId))) {
    throw new DeviceAccessDeniedError();
  }
}

/**
 * Filter a device list down to the caller's scopes (RM-11). Returns the
 * list unchanged for Super Admins and customer-wide memberships; scoped
 * memberships see only in-scope devices (fail-closed on unknown devices).
 */
export async function filterDevicesByScopes<T extends { id: string }>(
  access: ResolvedAccess,
  devices: T[]
): Promise<T[]> {
  if (access.isSuperAdmin) return devices;
  if (!access.scopes || access.scopes.length === 0) return devices;

  const checks = await Promise.all(
    devices.map(async (device) => ({
      device,
      inScope: await isDeviceInScopes(access, device.id),
    }))
  );
  return checks.filter((c) => c.inScope).map((c) => c.device);
}
