// ──── @energy/database ────
// Supabase client and database queries for the Energy Monitoring ecosystem.

export { getSupabaseAdmin, getSupabaseBrowser } from "./client";

// Auth helpers (one-off account creation scripts)
export {
  generatePassword,
  createAuthUser,
  deleteAuthUser,
} from "./auth";
export type { CreateAuthUserResult } from "./auth";

// Role defaults (OWNER/ADMIN/OPERATOR/VIEWER → permissions)
export { ROLE_DEFAULTS, ALL_PERMISSIONS } from "./roles";
export type { Permission, Role } from "./roles";

// Reading queries
export {
  insertReading,
  getLast24hReadings,
  getLatestReading,
  getMonthlyEnergy,
} from "./queries/readings";

// Tenant bridging (Phase 3a)
export { lookupControllerByDevice } from "./queries/tenant";
export type { TenantStamp } from "./queries/tenant";

// Super admin grants (temporary demo access — decision #9)
export {
  getActiveSuperAdminGrant,
  recordSuperAdminAccess,
  grantTemporarySuperAdmin,
} from "./queries/superAdmin";
export type { SuperAdminGrant } from "./queries/superAdmin";

// Alert queries
export {
  createAlert,
  promoteAlertToIncident,
  getUnreadAlerts,
  markAlertRead,
  getAlertThresholds,
} from "./queries/alerts";

// Alert incident state machine (migration 002)
export {
  getAlertState,
  getAllActiveAlertStates,
  startAlertIncident,
  setAlertRecovery,
  cancelAlertRecovery,
  endAlertIncident,
} from "./queries/alertState";
export type { AlertState } from "./queries/alertState";

// Billing queries
export { getBillingRate, updateBillingRate } from "./queries/billing";

// Device queries
export {
  registerDevice,
  validateDeviceToken,
  listDevices,
  deactivateDevice,
} from "./queries/devices";

// Relay queries
export {
  getRelayConfig,
  updateRelayConfig,
  getRelayState,
  updateRelayState,
  logRelayAction,
  getRelayLogs,
} from "./queries/relay";

// PZEM config queries
export {
  getPzemConfig,
  updatePzemConfig,
} from "./queries/pzemConfig";
export type { PzemConfig } from "./queries/pzemConfig";

// Blackout queries
export {
  getDeviceBlackoutState,
  startBlackoutEvent,
  endBlackoutEvent,
  getBlackoutEvents,
  getBlackoutStats,
} from "./queries/blackouts";
