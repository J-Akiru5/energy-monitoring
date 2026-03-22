/**
 * ═══════════════════════════════════════════════════════════════
 * MOCK SENSOR — ESP32 Simulator for Development
 * Generates realistic power readings and POSTs them to the API.
 * Supports both single-phase (legacy) and 3-phase modes.
 * ═══════════════════════════════════════════════════════════════
 *
 * Usage:
 *   pnpm --filter @energy/mock-sensor dev              # Single-phase (default)
 *   pnpm --filter @energy/mock-sensor dev -- --3phase  # 3-phase mode
 *
 * Environment Variables (.env):
 *   MOCK_API_URL=http://localhost:3000
 *   MOCK_DEVICE_TOKEN=dev-test-token
 *   MOCK_DEVICE_ID=some-uuid
 *   MOCK_INTERVAL_MS=2000
 *   MOCK_THREE_PHASE=true  # Alternative to --3phase flag
 */

import "dotenv/config";
import type { TelemetryPayload, ThreePhaseReading, PhaseReading } from "@energy/types";

// ──── CONFIG ────────────────────────────────────────────────
const API_URL = process.env.MOCK_API_URL || "http://localhost:3000";
const DEVICE_TOKEN = process.env.MOCK_DEVICE_TOKEN || "dev-test-token";
const DEVICE_ID =
  process.env.MOCK_DEVICE_ID || "00000000-0000-0000-0000-000000000001";
const INTERVAL = parseInt(process.env.MOCK_INTERVAL_MS || "2000", 10);

// Check for 3-phase mode via env var or CLI arg
const IS_THREE_PHASE =
  process.env.MOCK_THREE_PHASE === "true" || process.argv.includes("--3phase");

// ──── STATE ─────────────────────────────────────────────────
// Cumulative energy per phase (for 3-phase) or total (for single-phase)
let cumulativeKwhA = 0;
let cumulativeKwhB = 0;
let cumulativeKwhC = 0;
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
  if (hour >= 8 && hour <= 12) return rand(1.2, 1.8); // Morning peak
  if (hour >= 18 && hour <= 22) return rand(1.5, 2.0); // Evening peak
  if (hour >= 23 || hour <= 6) return rand(0.4, 0.7); // Night valley
  return rand(0.8, 1.2); // Normal
}

// ──── GENERATE SINGLE-PHASE READING ─────────────────────────

function generateSinglePhaseReading(): TelemetryPayload {
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

// ──── GENERATE 3-PHASE READING ──────────────────────────────

function generatePhaseReading(
  phaseName: "A" | "B" | "C",
  loadMultiplier: number
): PhaseReading {
  // Each phase has slightly different characteristics
  const voltageOffsets = { A: 0, B: -0.3, C: 0.5 };
  const currentVariance = { A: 1.0, B: 0.85, C: 1.15 };

  const voltage = round(rand(218, 224) + voltageOffsets[phaseName], 1);
  const current = round(
    rand(5, 15) * loadMultiplier * currentVariance[phaseName],
    3
  );
  const powerFactor = round(rand(0.88, 0.98), 3);
  const power = round(voltage * current * powerFactor, 2);
  const frequency = round(rand(59.95, 60.05), 2);

  return {
    voltage,
    current,
    power,
    energy: 0, // Will be set after accumulation
    frequency,
    powerFactor,
  };
}

function generateThreePhaseReading(): TelemetryPayload {
  const loadMultiplier = getLoadMultiplier();

  const phaseA = generatePhaseReading("A", loadMultiplier);
  const phaseB = generatePhaseReading("B", loadMultiplier);
  const phaseC = generatePhaseReading("C", loadMultiplier);

  // Accumulate energy per phase
  const hoursElapsed = INTERVAL / 1000 / 3600;
  cumulativeKwhA += (phaseA.power * hoursElapsed) / 1000;
  cumulativeKwhB += (phaseB.power * hoursElapsed) / 1000;
  cumulativeKwhC += (phaseC.power * hoursElapsed) / 1000;

  // Set accumulated energy
  phaseA.energy = round(cumulativeKwhA, 4);
  phaseB.energy = round(cumulativeKwhB, 4);
  phaseC.energy = round(cumulativeKwhC, 4);

  const threePhase: ThreePhaseReading = {
    phase_a: phaseA,
    phase_b: phaseB,
    phase_c: phaseC,
  };

  return {
    deviceId: DEVICE_ID,
    threePhase,
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
      if (payload.threePhase) {
        const { phase_a, phase_b, phase_c } = payload.threePhase;
        const totalPower = phase_a.power + phase_b.power + phase_c.power;
        const totalEnergy = phase_a.energy + phase_b.energy + phase_c.energy;
        console.log(
          `[✓] #${cycleCount} | 3-PHASE | Total: ${round(totalPower, 1)}W | ${round(totalEnergy, 4)} kWh`
        );
        console.log(
          `    Phase A: ${phase_a.voltage}V ${phase_a.current}A ${phase_a.power}W`
        );
        console.log(
          `    Phase B: ${phase_b.voltage}V ${phase_b.current}A ${phase_b.power}W`
        );
        console.log(
          `    Phase C: ${phase_c.voltage}V ${phase_c.current}A ${phase_c.power}W`
        );
      } else if (payload.reading) {
        console.log(
          `[✓] #${cycleCount} | ${payload.reading.power}W | ` +
          `${payload.reading.voltage}V | ${payload.reading.current}A | ` +
          `${payload.reading.energy} kWh`
        );
      }
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
  console.log(`  Mode:     ${IS_THREE_PHASE ? "3-PHASE" : "SINGLE-PHASE"}`);
  console.log("═══════════════════════════════════════\n");

  // Continuous loop
  setInterval(async () => {
    cycleCount++;
    const reading = IS_THREE_PHASE
      ? generateThreePhaseReading()
      : generateSinglePhaseReading();
    await sendReading(reading);
  }, INTERVAL);
}

main();
