import { z } from "zod";

// ──── Alert Types ────

export const AlertTypeEnum = z.enum([
  "OVERVOLTAGE",
  "UNDERVOLTAGE",
  "OVERCURRENT",
  "HIGH_POWER",
  "DEVICE_OFFLINE",
  "BLACKOUT",
  "PZEM_OFFLINE",    // Sensor communication failure (ESP32 alive but can't talk to PZEM)
]);

export type AlertType = z.infer<typeof AlertTypeEnum>;

// ──── Alert Record ────

export const AlertSchema = z.object({
  id:         z.string().uuid(),
  deviceId:   z.string(),
  type:       AlertTypeEnum,
  value:      z.number(),
  threshold:  z.number(),
  message:    z.string(),
  isRead:     z.boolean().default(false),
  createdAt:  z.string().datetime(),

  // ── Incident time-range fields (migration 002) ──────────────────────
  /** 'A' | 'B' | 'C' for per-phase alerts. null for single-phase or totals. */
  phase:           z.string().nullable().optional(),
  /** false = transient spike (<60s). true = promoted sustained incident (≥60s). */
  isIncident:      z.boolean().default(false),
  /** null = incident is ONGOING. Set when the 30s recovery debounce completes. */
  endedAt:         z.string().datetime().nullable().optional(),
  /** Seconds from alert created_at to ended_at. null while ongoing. */
  durationSeconds: z.number().nullable().optional(),
});

export type Alert = z.infer<typeof AlertSchema>;

// ──── Alert Threshold Config (set by Admin) ────

export const AlertThresholdSchema = z.object({
  overvoltage:          z.number().default(250),
  undervoltage:         z.number().default(200),
  overcurrent:          z.number().default(80),
  highPower:            z.number().default(20000),
  deviceOfflineSeconds: z.number().default(60),
});

export type AlertThreshold = z.infer<typeof AlertThresholdSchema>;
