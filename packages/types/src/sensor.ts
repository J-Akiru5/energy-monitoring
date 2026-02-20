import { z } from "zod";

// ──── Core Meter Reading from ESP32 + PZEM-004T (Single Phase) ────

export const MeterReadingSchema = z.object({
  voltage: z.number().min(80).max(280),
  current: z.number().min(0).max(100),
  power: z.number().min(0).max(25000),
  energy: z.number().min(0),
  frequency: z.number().min(45).max(65),
  powerFactor: z.number().min(0).max(1),
});

export type MeterReading = z.infer<typeof MeterReadingSchema>;

// ──── Telemetry Payload (what the ESP32 POSTs to /api/ingest) ────

export const TelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1),
  reading: MeterReadingSchema,
  timestamp: z.string().datetime(),
});

export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
