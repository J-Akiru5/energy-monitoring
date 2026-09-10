// ──── Role Defaults ────
// Canonical role → permission mapping for the Energy Monitoring system.
// Used by onboarding scripts and membership-creation logic.

export type Permission =
  | "view_energy"
  | "control_relay"
  | "manage_devices"
  | "provision_device"
  | "replace_device"
  | "reassign_emu"
  | "manage_billing"
  | "view_reports";

export type Role = "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER";

/**
 * Default permissions for each role.
 *
 * OWNER  = primary Customer Admin (all 8 permissions)
 * ADMIN  = delegated Customer Admin (all except reassign_emu)
 * OPERATOR = merged Engineer+Technician (device + relay + energy)
 * VIEWER = read-only energy access
 *
 * Absence of scope rows (membership_scopes) = customer-wide access.
 */
export const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  OWNER: [
    "view_energy",
    "control_relay",
    "manage_devices",
    "provision_device",
    "replace_device",
    "reassign_emu",
    "manage_billing",
    "view_reports",
  ],
  ADMIN: [
    "view_energy",
    "control_relay",
    "manage_devices",
    "provision_device",
    "replace_device",
    "manage_billing",
    "view_reports",
  ],
  OPERATOR: [
    "view_energy",
    "control_relay",
    "manage_devices",
    "provision_device",
    "replace_device",
  ],
  VIEWER: ["view_energy"],
};

/** All 8 permission values (useful for validation). */
export const ALL_PERMISSIONS: Permission[] = [
  "view_energy",
  "control_relay",
  "manage_devices",
  "provision_device",
  "replace_device",
  "reassign_emu",
  "manage_billing",
  "view_reports",
];
