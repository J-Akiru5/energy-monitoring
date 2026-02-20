/**
 * Spike Injector — Sends an out-of-range reading to trigger alerts.
 *
 * Usage:
 *   pnpm --filter @energy/mock-sensor spike
 */

import "dotenv/config";
import type { TelemetryPayload } from "@energy/types";

const API_URL = process.env.MOCK_API_URL || "http://localhost:3000";
const DEVICE_TOKEN = process.env.MOCK_DEVICE_TOKEN || "dev-test-token";
const DEVICE_ID = process.env.MOCK_DEVICE_ID || "00000000-0000-0000-0000-000000000001";

async function injectSpike() {
  const spikeType = process.argv[2] || "overvoltage";

  let payload: TelemetryPayload;

  switch (spikeType) {
    case "overvoltage":
      payload = makePayload({ voltage: 265, current: 15, power: 3975 });
      console.log("⚡ Injecting OVERVOLTAGE spike (265V)...");
      break;
    case "overcurrent":
      payload = makePayload({ voltage: 220, current: 95, power: 20900 });
      console.log("⚡ Injecting OVERCURRENT spike (95A)...");
      break;
    case "highpower":
      payload = makePayload({ voltage: 220, current: 50, power: 22000 });
      console.log("⚡ Injecting HIGH POWER spike (22kW)...");
      break;
    default:
      console.log(`Unknown spike type: ${spikeType}`);
      console.log("Usage: pnpm spike [overvoltage|overcurrent|highpower]");
      return;
  }

  const res = await fetch(`${API_URL}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Token": DEVICE_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    console.log("✓ Spike sent successfully. Check dashboard for alert.");
  } else {
    console.error(`✗ HTTP ${res.status}: ${await res.text()}`);
  }
}

function makePayload(overrides: Partial<TelemetryPayload["reading"]>): TelemetryPayload {
  return {
    deviceId: DEVICE_ID,
    reading: {
      voltage: 220,
      current: 15,
      power: 3300,
      energy: 100,
      frequency: 60,
      powerFactor: 0.95,
      ...overrides,
    },
    timestamp: new Date().toISOString(),
  };
}

injectSpike();
