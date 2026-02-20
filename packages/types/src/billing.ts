import { z } from "zod";

// ──── Billing Config ────

export const BillingConfigSchema = z.object({
  id: z.number(),
  ratePhpPerKwh: z.number().positive(),
  updatedAt: z.string().datetime(),
});

export type BillingConfig = z.infer<typeof BillingConfigSchema>;

// ──── Billing Snapshot (calculated per request) ────

export const BillingSnapshotSchema = z.object({
  totalKwh: z.number(),
  ratePhpPerKwh: z.number(),
  estimatedCostPhp: z.number(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

export type BillingSnapshot = z.infer<typeof BillingSnapshotSchema>;
