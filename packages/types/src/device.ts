import { z } from "zod";

// ──── Registered ESP32 Device ────

export const DeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  location: z.string().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
});

export type Device = z.infer<typeof DeviceSchema>;

// ──── Device Registration Input ────

export const DeviceCreateSchema = z.object({
  name: z.string().min(1, "Device name is required"),
  location: z.string().optional(),
});

export type DeviceCreate = z.infer<typeof DeviceCreateSchema>;
