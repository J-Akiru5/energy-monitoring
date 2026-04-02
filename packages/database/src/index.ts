// ──── @energy/database ────
// Supabase client and database queries for the Energy Monitoring ecosystem.

export { getSupabaseAdmin, getSupabaseBrowser } from "./client";

// Reading queries
export {
  insertReading,
  getLast24hReadings,
  getLatestReading,
  getMonthlyEnergy,
} from "./queries/readings";

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

// Blackout queries
export {
  getDeviceBlackoutState,
  startBlackoutEvent,
  endBlackoutEvent,
  getBlackoutEvents,
  getBlackoutStats,
} from "./queries/blackouts";
