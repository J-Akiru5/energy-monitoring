"use client";

import Link from "next/link";
import { usePolling } from "@/hooks/usePolling";
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ──── Types ────────────────────────────────────────────────
interface Reading {
  id: number;
  voltage: number;
  current_amp: number;
  power_w: number;
  energy_kwh: number;
  frequency: number;
  power_factor: number;
  recorded_at: string;
  // 3-Phase columns
  voltage_a?: number | null;
  voltage_b?: number | null;
  voltage_c?: number | null;
  current_a?: number | null;
  current_b?: number | null;
  current_c?: number | null;
  power_a?: number | null;
  power_b?: number | null;
  power_c?: number | null;
  energy_a?: number | null;
  energy_b?: number | null;
  energy_c?: number | null;
  frequency_a?: number | null;
  frequency_b?: number | null;
  frequency_c?: number | null;
  power_factor_a?: number | null;
  power_factor_b?: number | null;
  power_factor_c?: number | null;
  total_power?: number | null;
  total_energy?: number | null;
}

// ── Helpers ──────────────────────────────────────────────────
function parseDBDate(iso: string): Date {
  const hasTimezone = iso.endsWith("Z") || /([+-][0-9]{2}:[0-9]{2})$/.test(iso);
  const dateString = hasTimezone ? iso : `${iso}Z`;
  return new Date(dateString);
}

const PHASE_COLORS = {
  A: "#fb7185",
  B: "#F59E0B",
  C: "#06B6D4",
};

// ════════════════════════════════════════════════════════════
// PHASE DETAILS PAGE
// ════════════════════════════════════════════════════════════

export default function PhaseDetailsPage() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { latestReading } = usePolling(deviceId);
  const [chartData, setChartData] = useState<Reading[]>([]);
  const [is3Phase, setIs3Phase] = useState(false);

  // Discover device ID
  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d) => {
        const firstDevice = d.devices?.[0];
        if (firstDevice?.id) setDeviceId(firstDevice.id);
      })
      .catch(console.error);
  }, []);

  // Load historical data
  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;
    const controller = new AbortController();

    const loadData = async () => {
      try {
        const res = await fetch(`/api/readings?deviceId=${deviceId}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) return;

        const json = await res.json();
        if (!isMounted) return;

        const readings: Reading[] = json.readings ?? [];
        setChartData(readings);

        // Check if 3-phase
        if (readings.length > 0) {
          const latest = readings[readings.length - 1];
          setIs3Phase(
            latest.voltage_a !== null &&
              latest.voltage_a !== undefined &&
              latest.voltage_b !== null &&
              latest.voltage_b !== undefined
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[phases] Failed to load data:", err);
      }
    };

    loadData();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [deviceId]);

  // Update latest reading
  useEffect(() => {
    if (!latestReading) return;

    const reading: Reading = { ...latestReading };
    setChartData((prev) => {
      const filtered = prev.filter((r) => r.id !== reading.id);
      return [...filtered, reading].slice(-1000);
    });

    setIs3Phase(
      latestReading.voltage_a !== null &&
        latestReading.voltage_a !== undefined &&
        latestReading.voltage_b !== null &&
        latestReading.voltage_b !== undefined
    );
  }, [latestReading]);

  if (!is3Phase) {
    return (
      <div className="page-shell">
        <section className="page-header">
          <div>
            <div className="page-eyebrow">Phase Details</div>
            <h1 className="page-title">Single Phase Device</h1>
            <p className="page-copy">
              This device is operating in single-phase mode. Phase details are only
              available for 3-phase systems.
            </p>
          </div>
        </section>
        <div className="page-empty">
          <p>Connect a 3-phase sensor to view per-phase details.</p>
          <Link href="/dashboard" className="primary-btn" style={{ marginTop: 16, display: "inline-block" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <section className="page-header page-header-split">
        <div>
          <div className="page-eyebrow">3-Phase System</div>
          <h1 className="page-title">Phase Details</h1>
          <p className="page-copy">
            Detailed per-phase metrics including frequency and power factor.
          </p>
        </div>
        <Link href="/dashboard" className="ghost-btn">
          Back to Dashboard
        </Link>
      </section>

      {/* ── Phase Cards ── */}
      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <PhaseDetailCard
          phase="A"
          color={PHASE_COLORS.A}
          voltage={latestReading?.voltage_a ?? 0}
          current={latestReading?.current_a ?? 0}
          power={latestReading?.power_a ?? 0}
          energy={latestReading?.energy_a ?? 0}
          frequency={latestReading?.frequency_a ?? latestReading?.frequency ?? 60}
          powerFactor={latestReading?.power_factor_a ?? latestReading?.power_factor ?? 1}
        />
        <PhaseDetailCard
          phase="B"
          color={PHASE_COLORS.B}
          voltage={latestReading?.voltage_b ?? 0}
          current={latestReading?.current_b ?? 0}
          power={latestReading?.power_b ?? 0}
          energy={latestReading?.energy_b ?? 0}
          frequency={latestReading?.frequency_b ?? latestReading?.frequency ?? 60}
          powerFactor={latestReading?.power_factor_b ?? latestReading?.power_factor ?? 1}
        />
        <PhaseDetailCard
          phase="C"
          color={PHASE_COLORS.C}
          voltage={latestReading?.voltage_c ?? 0}
          current={latestReading?.current_c ?? 0}
          power={latestReading?.power_c ?? 0}
          energy={latestReading?.energy_c ?? 0}
          frequency={latestReading?.frequency_c ?? latestReading?.frequency ?? 60}
          powerFactor={latestReading?.power_factor_c ?? latestReading?.power_factor ?? 1}
        />
      </div>

      {/* ── Totals Row ── */}
      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 16 }}>
        <div className="summary-card">
          <div className="summary-label">Total Power</div>
          <div className="summary-value accent-cyan">
            {(latestReading?.total_power ?? latestReading?.power_w ?? 0).toFixed(1)} W
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Total Energy</div>
          <div className="summary-value">
            {(latestReading?.total_energy ?? latestReading?.energy_kwh ?? 0).toFixed(4)} kWh
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Avg Frequency</div>
          <div className="summary-value">
            {(latestReading?.frequency ?? 60).toFixed(2)} Hz
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Avg Power Factor</div>
          <div className="summary-value">
            {(latestReading?.power_factor ?? 1).toFixed(3)}
          </div>
        </div>
      </div>

      {/* ── Voltage Chart ── */}
      <div className="history-panel" style={{ marginTop: 24 }}>
        <div className="tile-label">Voltage by Phase (24h)</div>
        <div style={{ height: 300, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="recorded_at"
                tickFormatter={(t: string) =>
                  parseDBDate(t).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                stroke="#64748B"
                tick={{ fontSize: 11 }}
              />
              <YAxis stroke="#64748B" tick={{ fontSize: 11 }} unit="V" domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "#1E293B",
                  border: "1px solid #475569",
                  borderRadius: 2,
                  fontSize: 12,
                }}
                labelFormatter={(t: string) => parseDBDate(t).toLocaleString()}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="voltage_a"
                name="Phase A"
                stroke={PHASE_COLORS.A}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="voltage_b"
                name="Phase B"
                stroke={PHASE_COLORS.B}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="voltage_c"
                name="Phase C"
                stroke={PHASE_COLORS.C}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Power Chart ── */}
      <div className="history-panel" style={{ marginTop: 24 }}>
        <div className="tile-label">Power by Phase (24h)</div>
        <div style={{ height: 300, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="recorded_at"
                tickFormatter={(t: string) =>
                  parseDBDate(t).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                stroke="#64748B"
                tick={{ fontSize: 11 }}
              />
              <YAxis stroke="#64748B" tick={{ fontSize: 11 }} unit="W" />
              <Tooltip
                contentStyle={{
                  background: "#1E293B",
                  border: "1px solid #475569",
                  borderRadius: 2,
                  fontSize: 12,
                }}
                labelFormatter={(t: string) => parseDBDate(t).toLocaleString()}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="power_a"
                name="Phase A"
                stroke={PHASE_COLORS.A}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="power_b"
                name="Phase B"
                stroke={PHASE_COLORS.B}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="power_c"
                name="Phase C"
                stroke={PHASE_COLORS.C}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Current Chart ── */}
      <div className="history-panel" style={{ marginTop: 24, marginBottom: 24 }}>
        <div className="tile-label">Current by Phase (24h)</div>
        <div style={{ height: 300, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="recorded_at"
                tickFormatter={(t: string) =>
                  parseDBDate(t).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                stroke="#64748B"
                tick={{ fontSize: 11 }}
              />
              <YAxis stroke="#64748B" tick={{ fontSize: 11 }} unit="A" />
              <Tooltip
                contentStyle={{
                  background: "#1E293B",
                  border: "1px solid #475569",
                  borderRadius: 2,
                  fontSize: 12,
                }}
                labelFormatter={(t: string) => parseDBDate(t).toLocaleString()}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="current_a"
                name="Phase A"
                stroke={PHASE_COLORS.A}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="current_b"
                name="Phase B"
                stroke={PHASE_COLORS.B}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="current_c"
                name="Phase C"
                stroke={PHASE_COLORS.C}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function PhaseDetailCard({
  phase,
  color,
  voltage,
  current,
  power,
  energy,
  frequency,
  powerFactor,
}: {
  phase: string;
  color: string;
  voltage: number;
  current: number;
  power: number;
  energy: number;
  frequency: number;
  powerFactor: number;
}) {
  return (
    <div className="summary-card" style={{ borderColor: `${color}40`, borderWidth: 2 }}>
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color,
          marginBottom: 14,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Phase {phase}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MetricRow label="Voltage" value={`${voltage.toFixed(1)} V`} />
        <MetricRow label="Current" value={`${current.toFixed(3)} A`} />
        <MetricRow label="Power" value={`${power.toFixed(1)} W`} color={color} />
        <MetricRow label="Energy" value={`${energy.toFixed(4)} kWh`} />
        <MetricRow label="Frequency" value={`${frequency.toFixed(2)} Hz`} />
        <MetricRow label="Power Factor" value={powerFactor.toFixed(3)} />
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: color ?? "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}
