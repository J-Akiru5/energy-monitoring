import { z } from "zod";

// ──── Relay Actions ────

export const RelayActionEnum = z.enum([
  "TRIP",
  "RESET",
  "MANUAL_TRIP",
  "MANUAL_RESET",
  "AUTO_RESET",
  "STATUS_CHECK",
]);

export type RelayAction = z.infer<typeof RelayActionEnum>;

// ──── Relay Trigger Types ────

export const RelayTriggerEnum = z.enum([
  "OVERVOLTAGE",
  "UNDERVOLTAGE",
  "OVERCURRENT",
  "BLACKOUT",
  "MANUAL",
  "AUTO_RESET",
  "LOCAL_OVERVOLTAGE",   // ESP32 local safety override
  "LOCAL_UNDERVOLTAGE",  // ESP32 local safety override
]);

export type RelayTrigger = z.infer<typeof RelayTriggerEnum>;

// ──── Relay Configuration ────

export const RelayConfigSchema = z.object({
  id: z.number().optional(),
  deviceId: z.string().uuid(),
  relayEnabled: z.boolean().default(false),
  autoTripEnabled: z.boolean().default(false),
  autoResetEnabled: z.boolean().default(false),
  autoResetDelaySeconds: z.number().default(300),
  tripOnOvervoltage: z.boolean().default(true),
  tripOnUndervoltage: z.boolean().default(true),
  tripOnOvercurrent: z.boolean().default(true),
  tripOnBlackout: z.boolean().default(false),
  manualControlAllowed: z.boolean().default(true),
  updatedAt: z.string().optional(),
});

export type RelayConfig = z.infer<typeof RelayConfigSchema>;

// ──── Relay State ────

export const RelayStateSchema = z.object({
  id: z.number().optional(),
  deviceId: z.string().uuid(),
  isTripped: z.boolean(),
  lastTripAt: z.string().optional(),
  lastResetAt: z.string().optional(),
  tripReason: z.string().optional(),
  tripAlertId: z.string().uuid().optional(),
  updatedAt: z.string().optional(),
});

export type RelayState = z.infer<typeof RelayStateSchema>;

// ──── Relay Command (ESP32 -> Backend or Backend -> ESP32) ────

export const RelayCommandSchema = z.object({
  deviceId: z.string().uuid(),
  action: RelayActionEnum,
  trigger: RelayTriggerEnum.optional(),
  initiatedBy: z.string().default("SYSTEM"),
  notes: z.string().optional(),
});

export type RelayCommand = z.infer<typeof RelayCommandSchema>;

// ──── Relay Log Entry ────

export const RelayLogSchema = z.object({
  id: z.number().optional(),
  deviceId: z.string().uuid(),
  action: z.string(),
  triggerType: z.string().optional(),
  triggerValue: z.number().optional(),
  thresholdValue: z.number().optional(),
  alertId: z.string().uuid().optional(),
  initiatedBy: z.string(),
  notes: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type RelayLog = z.infer<typeof RelayLogSchema>;
