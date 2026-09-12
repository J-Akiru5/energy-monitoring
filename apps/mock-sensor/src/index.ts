/**
 * ═══════════════════════════════════════════════════════════════
 * MOCK SENSOR — ESP32 Simulator for Development
 * Supports single-phase (legacy), 3-phase, and 1-phase redundant-tap modes.
 * ═══════════════════════════════════════════════════════════════
 *
 * Usage:
 *   pnpm --filter @energy/mock-sensor dev
 *   MOCK_1PHASE_SOURCE=B pnpm --filter @energy/mock-sensor dev
 *
 * Environment Variables:
 *   MOCK_THREE_PHASE=true
 *   MOCK_1PHASE_SOURCE=B        # 1-phase redundant-tap (A|B|C)
 *   MOCK_PHASE_A_OFFLINE=true   # Simulate Phase A comm failure
 *   MOCK_PHASE_B_OFFLINE=true
 *   MOCK_PHASE_C_OFFLINE=true
 */

import "dotenv/config";
import type { TelemetryPayload, ThreePhaseReading, PhaseReading } from "@energy/types";

const API_URL = process.env.MOCK_API_URL || "http://localhost:3000";
const DEVICE_TOKEN = process.env.MOCK_DEVICE_TOKEN || "dev-test-token";
const DEVICE_ID = process.env.MOCK_DEVICE_ID || "00000000-0000-0000-0000-000000000001";
const INTERVAL = parseInt(process.env.MOCK_INTERVAL_MS || "2000", 10);

const IS_THREE_PHASE = process.env.MOCK_THREE_PHASE === "true" || process.argv.includes("--3phase");
const MOCK_1PHASE_SOURCE = process.env.MOCK_1PHASE_SOURCE;
const IS_1PHASE_MODE = !!MOCK_1PHASE_SOURCE && !IS_THREE_PHASE;

const PHASE_OFFLINE = {
  A: process.env.MOCK_PHASE_A_OFFLINE === "true",
  B: process.env.MOCK_PHASE_B_OFFLINE === "true",
  C: process.env.MOCK_PHASE_C_OFFLINE === "true",
};

let cumulativeKwhA = 0, cumulativeKwhB = 0, cumulativeKwhC = 0, cumulativeKwh = 0;
let cycleCount = 0;

function rand(min: number, max: number): number { return min + Math.random() * (max - min); }
function round(val: number, decimals: number): number { return Math.round(val * Math.pow(10, decimals)) / Math.pow(10, decimals); }

function getLoadMultiplier(): number {
  const hour = new Date().getHours();
  if (hour >= 8 && hour <= 12) return rand(1.2, 1.8);
  if (hour >= 18 && hour <= 22) return rand(1.5, 2.0);
  if (hour >= 23 || hour <= 6) return rand(0.4, 0.7);
  return rand(0.8, 1.2);
}

function generateSinglePhaseReading(): TelemetryPayload {
  const load = getLoadMultiplier();
  const voltage = round(rand(215, 225), 1);
  const current = round(rand(8, 20) * load, 3);
  const pf = round(rand(0.85, 0.98), 3);
  const power = round(voltage * current * pf, 2);
  cumulativeKwh += (power * INTERVAL / 1000 / 3600) / 1000;
  return { deviceId: DEVICE_ID, reading: { voltage, current, power, energy: round(cumulativeKwh, 4), frequency: round(rand(59.9, 60.1), 2), powerFactor: pf }, timestamp: new Date().toISOString() };
}

function generatePhaseReading(phaseName: "A" | "B" | "C", load: number): PhaseReading {
  if (PHASE_OFFLINE[phaseName]) return { voltage: 0, current: 0, power: 0, energy: 0, frequency: 0, powerFactor: 0, offline: true };
  const vOff = { A: 0, B: -0.3, C: 0.5 }; const cVar = { A: 1.0, B: 0.85, C: 1.15 };
  const voltage = round(rand(218, 224) + vOff[phaseName], 1);
  const current = round(rand(5, 15) * load * cVar[phaseName], 3);
  const pf = round(rand(0.88, 0.98), 3);
  return { voltage, current, power: round(voltage * current * pf, 2), energy: 0, frequency: round(rand(59.95, 60.05), 2), powerFactor: pf, offline: false };
}

function buildThreePhase(load: number): ThreePhaseReading {
  const a = generatePhaseReading("A", load), b = generatePhaseReading("B", load), c = generatePhaseReading("C", load);
  const h = INTERVAL / 1000 / 3600;
  cumulativeKwhA += (a.power * h) / 1000; cumulativeKwhB += (b.power * h) / 1000; cumulativeKwhC += (c.power * h) / 1000;
  a.energy = round(cumulativeKwhA, 4); b.energy = round(cumulativeKwhB, 4); c.energy = round(cumulativeKwhC, 4);
  return { phase_a: a, phase_b: b, phase_c: c };
}

function generateThreePhaseReading(): TelemetryPayload {
  return { deviceId: DEVICE_ID, threePhase: buildThreePhase(getLoadMultiplier()), timestamp: new Date().toISOString() };
}

function generateOnePhaseReading(): TelemetryPayload {
  return { deviceId: DEVICE_ID, threePhase: buildThreePhase(getLoadMultiplier()), pzemSourceMode: "MANUAL", pzemActiveSource: MOCK_1PHASE_SOURCE as "A" | "B" | "C", timestamp: new Date().toISOString() };
}

async function sendReading(payload: TelemetryPayload): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/ingest`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Token": DEVICE_TOKEN }, body: JSON.stringify(payload) });
    if (res.ok) {
      if (payload.threePhase) {
        const { phase_a: a, phase_b: b, phase_c: c } = payload.threePhase;
        const isOnePhase = !!payload.pzemActiveSource;
        const label = isOnePhase ? `1-PHASE (${payload.pzemActiveSource})` : "3-PHASE";
        const ap = isOnePhase ? (payload.pzemActiveSource === "B" ? b.power : payload.pzemActiveSource === "C" ? c.power : a.power) : a.power + b.power + c.power;
        const ae = isOnePhase ? (payload.pzemActiveSource === "B" ? b.energy : payload.pzemActiveSource === "C" ? c.energy : a.energy) : a.energy + b.energy + c.energy;
        console.log(`[✓] #${cycleCount} | ${label} | Active: ${round(ap, 1)}W | ${round(ae, 4)} kWh`);
        console.log(`    Phase A: ${a.voltage}V ${a.current}A ${a.power}W${a.offline ? " [OFFLINE]" : ""}`);
        console.log(`    Phase B: ${b.voltage}V ${b.current}A ${b.power}W${b.offline ? " [OFFLINE]" : ""}`);
        console.log(`    Phase C: ${c.voltage}V ${c.current}A ${c.power}W${c.offline ? " [OFFLINE]" : ""}`);
      } else if (payload.reading) {
        console.log(`[✓] #${cycleCount} | ${payload.reading.power}W | ${payload.reading.voltage}V | ${payload.reading.current}A | ${payload.reading.energy} kWh`);
      }
    } else { console.error(`[✗] HTTP ${res.status}: ${await res.text()}`); }
  } catch (err) { console.error(`[✗] Network error: ${(err as Error).message}`); }
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log(" Mock Sensor — ESP32 Simulator");
  console.log("═══════════════════════════════════════");
  console.log(`  API:      ${API_URL}/api/ingest`);
  console.log(`  Device:   ${DEVICE_ID}`);
  console.log(`  Interval: ${INTERVAL}ms`);
  if (IS_1PHASE_MODE) {
    console.log(`  Mode:     1-PHASE (redundant-tap, active=${MOCK_1PHASE_SOURCE})`);
    const off = Object.entries(PHASE_OFFLINE).filter(([, v]) => v).map(([k]) => k);
    if (off.length > 0) console.log(`  Offline:  Phase ${off.join(", ")} (simulated)`);
  } else if (IS_THREE_PHASE) {
    console.log(`  Mode:     3-PHASE`);
    const off = Object.entries(PHASE_OFFLINE).filter(([, v]) => v).map(([k]) => k);
    if (off.length > 0) console.log(`  Offline:  Phase ${off.join(", ")} (simulated)`);
  } else { console.log(`  Mode:     SINGLE-PHASE`); }
  console.log("═══════════════════════════════════════\n");

  setInterval(async () => {
    cycleCount++;
    const reading = IS_1PHASE_MODE ? generateOnePhaseReading() : IS_THREE_PHASE ? generateThreePhaseReading() : generateSinglePhaseReading();
    await sendReading(reading);
  }, INTERVAL);
}

main();
