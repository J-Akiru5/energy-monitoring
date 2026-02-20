/**
 * ═══════════════════════════════════════════════════════════════
 * MOCK SENSOR — ESP32 Simulator for Development
 * Generates realistic single-phase power readings and
 * POSTs them to the local or cloud API at a configurable interval.
 * ═══════════════════════════════════════════════════════════════
 *
 * Usage:
 *   pnpm --filter @energy/mock-sensor dev
 *
 * Environment Variables (.env):
 *   MOCK_API_URL=http://localhost:3000
 *   MOCK_DEVICE_TOKEN=dev-test-token
 *   MOCK_DEVICE_ID=some-uuid
 *   MOCK_INTERVAL_MS=2000
 */

import "dotenv/config";
import type { TelemetryPayload } from "@energy/types";

// ──── CONFIG ────────────────────────────────────────────────
const API_URL = process.env.MOCK_API_URL || "http://localhost:3000";
const DEVICE_TOKEN = process.env.MOCK_DEVICE_TOKEN || "dev-test-token";
const DEVICE_ID = process.env.MOCK_DEVICE_ID || "00000000-0000-0000-0000-000000000001";
const INTERVAL = parseInt(process.env.MOCK_INTERVAL_MS || "2000", 10);

// ──── STATE ─────────────────────────────────────────────────
let cumulativeKwh = 0;
let cycleCount = 0;

// ──── HELPERS ───────────────────────────────────────────────

/** Returns a random number between min and max. */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Rounds a number to n decimal places. */
function round(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Simulates a realistic building load pattern.
 * - Base load: ~10-15A (always-on appliances)
 * - Peak hours (8-12, 18-22): higher loads up to 35A
 * - Night (23-6): lower loads
 */
function getLoadMultiplier(): number {
  const hour = new Date().getHours();
  if (hour >= 8 && hour <= 12) return rand(1.2, 1.8);   // Morning peak
  if (hour >= 18 && hour <= 22) return rand(1.5, 2.0);   // Evening peak
  if (hour >= 23 || hour <= 6) return rand(0.4, 0.7);    // Night valley
  return rand(0.8, 1.2);                                  // Normal
}

// ──── GENERATE READING ──────────────────────────────────────

function generateReading(): TelemetryPayload {
  const loadMultiplier = getLoadMultiplier();

  const voltage = round(rand(215, 225), 1);
  const current = round(rand(8, 20) * loadMultiplier, 3);
  const powerFactor = round(rand(0.85, 0.98), 3);
  const power = round(voltage * current * powerFactor, 2);
  const frequency = round(rand(59.9, 60.1), 2);

  // Accumulate energy (kWh = W * hours)
  const hoursElapsed = INTERVAL / 1000 / 3600;
  cumulativeKwh += (power * hoursElapsed) / 1000;

  return {
    deviceId: DEVICE_ID,
    reading: {
      voltage,
      current,
      power,
      energy: round(cumulativeKwh, 4),
      frequency,
      powerFactor,
    },
    timestamp: new Date().toISOString(),
  };
}

// ──── SEND TO API ───────────────────────────────────────────

async function sendReading(payload: TelemetryPayload): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Token": DEVICE_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log(
        `[✓] #${cycleCount} | ${payload.reading.power}W | ` +
        `${payload.reading.voltage}V | ${payload.reading.current}A | ` +
        `${payload.reading.energy} kWh`
      );
    } else {
      const text = await res.text();
      console.error(`[✗] HTTP ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error(`[✗] Network error: ${(err as Error).message}`);
  }
}

// ──── MAIN LOOP ─────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════");
  console.log(" Mock Sensor — ESP32 Simulator");
  console.log("═══════════════════════════════════════");
  console.log(`  API:      ${API_URL}/api/ingest`);
  console.log(`  Device:   ${DEVICE_ID}`);
  console.log(`  Interval: ${INTERVAL}ms`);
  console.log("═══════════════════════════════════════\n");

  // Continuous loop
  setInterval(async () => {
    cycleCount++;
    const reading = generateReading();
    await sendReading(reading);
  }, INTERVAL);
}

main();
