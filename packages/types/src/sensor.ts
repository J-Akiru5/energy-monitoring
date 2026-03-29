import { z } from "zod";

// ──── Core Meter Reading from ESP32 + PZEM-004T (Single Phase) ────

export const MeterReadingSchema = z.object({
  voltage: z.number().min(0).max(280),
  current: z.number().min(0).max(100),
  power: z.number().min(0).max(25000),
  energy: z.number().min(0),
  frequency: z.number().min(0).max(65),
  powerFactor: z.number().min(0).max(1),
});

export type MeterReading = z.infer<typeof MeterReadingSchema>;

// ──── Per-Phase Reading (3-Phase System) ────

export const PhaseReadingSchema = z.object({
  voltage: z.number().min(0).max(280),
  current: z.number().min(0).max(100),
  power: z.number().min(0).max(25000),
  energy: z.number().min(0),
  frequency: z.number().min(0).max(65).optional(),
  powerFactor: z.number().min(0).max(1).optional(),
});

export type PhaseReading = z.infer<typeof PhaseReadingSchema>;

// ──── 3-Phase Reading Structure ────

export const ThreePhaseReadingSchema = z.object({
  phase_a: PhaseReadingSchema,
  phase_b: PhaseReadingSchema,
  phase_c: PhaseReadingSchema,
});

export type ThreePhaseReading = z.infer<typeof ThreePhaseReadingSchema>;

// ──── Telemetry Payload (what the ESP32 POSTs to /api/ingest) ────

export const TelemetryPayloadSchema = z
  .object({
    deviceId: z.string().min(1),
    reading: MeterReadingSchema.optional(), // Single-phase reading
    threePhase: ThreePhaseReadingSchema.optional(), // 3-phase reading
    timestamp: z.string().datetime({ offset: true }),
    blackout: z.boolean().optional(),
    localTrip: z.boolean().optional(), // ESP32 local safety override triggered
    localTripReason: z.string().optional(), // "LOCAL_OVERVOLTAGE" or "LOCAL_UNDERVOLTAGE"
    sensorOffline: z.boolean().optional(), // ESP32 alive but PZEM returns NaN
  })
  .refine(
    (data) =>
      data.reading ||
      data.threePhase ||
      data.sensorOffline ||
      data.blackout,
    {
      message:
        "Must provide either 'reading' (single-phase), 'threePhase', 'sensorOffline', or 'blackout'",
    }
  );

export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

// ──── Helper to detect 3-phase payload ────

export function isThreePhasePayload(
  payload: TelemetryPayload
): payload is TelemetryPayload & { threePhase: ThreePhaseReading } {
  return payload.threePhase !== undefined;
}
