import { z } from "zod";

// ──── Alert Types ────

export const AlertTypeEnum = z.enum([
  "OVERVOLTAGE",
  "UNDERVOLTAGE",
  "OVERCURRENT",
  "HIGH_POWER",
  "DEVICE_OFFLINE",
]);

export type AlertType = z.infer<typeof AlertTypeEnum>;

// ──── Alert Record ────

export const AlertSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string(),
  type: AlertTypeEnum,
  value: z.number(),
  threshold: z.number(),
  message: z.string(),
  isRead: z.boolean().default(false),
  createdAt: z.string().datetime(),
});

export type Alert = z.infer<typeof AlertSchema>;

// ──── Alert Threshold Config (set by Admin) ────

export const AlertThresholdSchema = z.object({
  overvoltage: z.number().default(250),
  undervoltage: z.number().default(200),
  overcurrent: z.number().default(80),
  highPower: z.number().default(20000),
  deviceOfflineSeconds: z.number().default(60),
});

export type AlertThreshold = z.infer<typeof AlertThresholdSchema>;
