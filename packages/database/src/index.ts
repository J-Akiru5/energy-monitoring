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
  getUnreadAlerts,
  markAlertRead,
  getAlertThresholds,
} from "./queries/alerts";

// Billing queries
export { getBillingRate, updateBillingRate } from "./queries/billing";

// Device queries
export {
  registerDevice,
  validateDeviceToken,
  listDevices,
  deactivateDevice,
} from "./queries/devices";
