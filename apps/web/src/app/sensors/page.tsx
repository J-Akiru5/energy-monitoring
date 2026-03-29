"use client";

import Link from "next/link";
import { usePolling } from "@/hooks/usePolling";
import { useEffect, useState, useRef, startTransition, useLayoutEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
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
  return new Date(hasTimezone ? iso : `${iso}Z`);
}

function mergeReadings(base: Reading[], incoming: Reading[]): Reading[] {
  const byId = new Map<number, Reading>();
  for (const r of base) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r);
  return Array.from(byId.values())
    .sort((a, b) => parseDBDate(a.recorded_at).getTime() - parseDBDate(b.recorded_at).getTime())
    .slice(-500);
}

function isThreePhase(r: Reading | null): boolean {
  return !!(r && r.voltage_a != null && r.voltage_b != null && r.voltage_c != null);
}

const PHASE_COLORS = { A: "#fb7185", B: "#F59E0B", C: "#06B6D4" } as const;

// ════════════════════════════════════════════════════════════
// SENSORS PAGE
// ════════════════════════════════════════════════════════════

export default function SensorsPage() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { latestReading, isConnected } = usePolling(deviceId);
  const [chartData, setChartData] = useState<Reading[]>([]);
  const [activeChart, setActiveChart] = useState<"voltage" | "power" | "current">("power");
  const prevRef = useRef<Record<string, number>>({});
  const [flashKeys, setFlashKeys] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d) => {
        const dev = d.devices?.[0];
        if (dev?.id) setDeviceId(dev.id);
      })
      .catch(console.error);
  }, []);

  // Load 24h history
  useEffect(() => {
    if (!deviceId) return;
    let mounted = true;
    fetch(`/api/readings?deviceId=${deviceId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (mounted) setChartData(d.readings ?? []);
      })
      .catch(console.error);
    return () => { mounted = false; };
  }, [deviceId]);

  // Append live readings + compute flash
  useEffect(() => {
    if (!latestReading) return;
    const r = latestReading as Reading;

    startTransition(() => {
      setChartData((prev) => mergeReadings(prev, [r]));
    });

    const keys = ["voltage_a", "voltage_b", "voltage_c", "power_a", "power_b", "power_c", "current_a", "current_b", "current_c"] as const;
    type FlashKey = typeof keys[number];
    const newFlashes: Record<string, number> = {};
    for (const k of keys) {
      const val = r[k as FlashKey] ?? 0;
      if (prevRef.current[k] !== val) {
        newFlashes[k] = Date.now();
      }
      prevRef.current[k] = val ?? 0;
    }
    if (Object.keys(newFlashes).length > 0) {
      startTransition(() => setFlashKeys((f) => ({ ...f, ...newFlashes })));
    }
  }, [latestReading]);

  const r = latestReading as Reading | null;
  const is3Phase = isThreePhase(r);

  const phaseStatus = (v: number | null | undefined): "online" | "offline" | "zero" => {
    if (v == null) return "offline";
    if (v === 0) return "zero";
    return "online";
  };

  if (!r) {
    return (
      <div className="page-shell">
        <section className="page-header">
          <div className="page-eyebrow">PZEM Sensors</div>
          <h1 className="page-title">Sensor Monitor</h1>
          <p className="page-copy">Waiting for sensor data…</p>
        </section>
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0", color: "var(--text-muted)", fontSize: 14 }}>
          No readings available yet. Ensure the ESP32 is powered and connected.
        </div>
      </div>
    );
  }

  const phases = [
    {
      id: "A",
      label: "PZEM Sensor A",
      desc: "Hardware Serial2 · GPIO17/16",
      color: PHASE_COLORS.A,
      voltage: r.voltage_a ?? r.voltage,
      current: r.current_a ?? r.current_amp,
      power: r.power_a ?? 0,
      energy: r.energy_a ?? 0,
      frequency: r.frequency_a ?? r.frequency,
      pf: r.power_factor_a ?? r.power_factor,
      flashV: flashKeys["voltage_a"],
      flashP: flashKeys["power_a"],
      flashA: flashKeys["current_a"],
      status: is3Phase ? phaseStatus(r.voltage_a) : (r.voltage > 0 ? "online" : "zero"),
    },
    {
      id: "B",
      label: "PZEM Sensor B",
      desc: "Hardware Serial1 · GPIO5/4",
      color: PHASE_COLORS.B,
      voltage: r.voltage_b ?? 0,
      current: r.current_b ?? 0,
      power: r.power_b ?? 0,
      energy: r.energy_b ?? 0,
      frequency: r.frequency_b ?? r.frequency,
      pf: r.power_factor_b ?? r.power_factor,
      flashV: flashKeys["voltage_b"],
      flashP: flashKeys["power_b"],
      flashA: flashKeys["current_b"],
      status: is3Phase ? phaseStatus(r.voltage_b) : "offline",
    },
    {
      id: "C",
      label: "PZEM Sensor C",
      desc: "Hardware Serial · GPIO19/18",
      color: PHASE_COLORS.C,
      voltage: r.voltage_c ?? 0,
      current: r.current_c ?? 0,
      power: r.power_c ?? 0,
      energy: r.energy_c ?? 0,
      frequency: r.frequency_c ?? r.frequency,
      pf: r.power_factor_c ?? r.power_factor,
      flashV: flashKeys["voltage_c"],
      flashP: flashKeys["power_c"],
      flashA: flashKeys["current_c"],
      status: is3Phase ? phaseStatus(r.voltage_c) : "offline",
    },
  ];

  const totalPower = r.total_power ?? (phases.reduce((s, p) => s + p.power, 0));
  const totalEnergy = r.total_energy ?? (phases.reduce((s, p) => s + p.energy, 0));

  const chartKeys = {
    voltage: [
      { key: "voltage_a", name: "Sensor A (V)", color: PHASE_COLORS.A },
      { key: "voltage_b", name: "Sensor B (V)", color: PHASE_COLORS.B },
      { key: "voltage_c", name: "Sensor C (V)", color: PHASE_COLORS.C },
    ],
    power: [
      { key: "power_a", name: "Sensor A (W)", color: PHASE_COLORS.A },
      { key: "power_b", name: "Sensor B (W)", color: PHASE_COLORS.B },
      { key: "power_c", name: "Sensor C (W)", color: PHASE_COLORS.C },
    ],
    current: [
      { key: "current_a", name: "Sensor A (A)", color: PHASE_COLORS.A },
      { key: "current_b", name: "Sensor B (A)", color: PHASE_COLORS.B },
      { key: "current_c", name: "Sensor C (A)", color: PHASE_COLORS.C },
    ],
  };

  const chartUnit = activeChart === "voltage" ? "V" : activeChart === "power" ? "W" : "A";

  return (
    <div className="page-shell">
      {/* ── Header ── */}
      <section className="page-header page-header-split">
        <div>
          <div className="page-eyebrow">Live Telemetry</div>
          <h1 className="page-title">PZEM Sensor Monitor</h1>
          <p className="page-copy">
            {is3Phase
              ? "3-phase system — all 3 PZEM-004T sensors reporting."
              : "Single-phase mode — only Sensor A active."}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: isConnected ? "#22c55e" : "var(--text-muted)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isConnected ? "#22c55e" : "#64748b",
                boxShadow: isConnected ? "0 0 8px #22c55e" : "none",
                display: "inline-block",
              }}
            />
            {isConnected ? "Live" : "Offline"}
          </span>
          <Link href="/dashboard" className="ghost-btn">← Dashboard</Link>
        </div>
      </section>

      {/* ── System Totals ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <TotalCard label="Total Power" value={totalPower.toFixed(1)} unit="W" accent="var(--accent-cyan)" />
        <TotalCard label="Total Energy" value={totalEnergy.toFixed(4)} unit="kWh" />
        <TotalCard label="Avg Frequency" value={r.frequency.toFixed(1)} unit="Hz" />
        <TotalCard label="Online Sensors" value={phases.filter((p) => p.status === "online").length.toString()} unit={`/ ${phases.length}`} accent={phases.filter((p) => p.status === "online").length === phases.length ? "#22c55e" : "#F59E0B"} />
      </div>

      {/* ── 3 Sensor Cards ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {phases.map((phase) => (
          <SensorCard key={phase.id} phase={phase} flashKeys={flashKeys} />
        ))}
      </div>

      {/* ── Chart Section ── */}
      <div className="bento-tile" style={{ marginBottom: 24 }}>
        {/* Chart tab switcher */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div className="tile-label" style={{ marginBottom: 0 }}>24-Hour Sensor History</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["power", "voltage", "current"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveChart(tab)}
                style={{
                  padding: "5px 14px",
                  borderRadius: 20,
                  border: `1px solid ${activeChart === tab ? "var(--accent-cyan)" : "var(--border-subtle)"}`,
                  background: activeChart === tab ? "rgba(6,182,212,0.12)" : "transparent",
                  color: activeChart === tab ? "var(--accent-cyan)" : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  textTransform: "capitalize",
                  transition: "all 0.15s",
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            {activeChart === "power" ? (
              <AreaChart data={chartData}>
                <defs>
                  {chartKeys.power.map((s) => (
                    <linearGradient key={s.key} id={`grad_${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="recorded_at"
                  tickFormatter={(t) => parseDBDate(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  stroke="#64748B"
                  tick={{ fontSize: 11 }}
                />
                <YAxis stroke="#64748B" tick={{ fontSize: 11 }} unit="W" />
                <Tooltip
                  contentStyle={{ background: "#1E293B", border: "1px solid #475569", borderRadius: 4, fontSize: 12 }}
                  labelFormatter={(t) => parseDBDate(t as string).toLocaleString()}
                />
                <Legend />
                {chartKeys.power.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    fill={`url(#grad_${s.key})`}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="recorded_at"
                  tickFormatter={(t) => parseDBDate(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  stroke="#64748B"
                  tick={{ fontSize: 11 }}
                />
                <YAxis stroke="#64748B" tick={{ fontSize: 11 }} unit={chartUnit} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "#1E293B", border: "1px solid #475569", borderRadius: 4, fontSize: 12 }}
                  labelFormatter={(t) => parseDBDate(t as string).toLocaleString()}
                />
                <Legend />
                {chartKeys[activeChart].map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Per-Sensor Energy Accumulators ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {phases.map((phase) => (
          <div
            key={phase.id}
            className="bento-tile"
            style={{ borderColor: `${phase.color}30` }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: phase.color,
                marginBottom: 8,
              }}
            >
              Sensor {phase.id} — Energy
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 28,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: 4,
              }}
            >
              {phase.energy.toFixed(4)}
              <span style={{ fontSize: 14, color: "var(--text-muted)", marginLeft: 4 }}>kWh</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Cumulative device counter</div>
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--border-subtle)",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <MiniStat label="PF" value={phase.pf.toFixed(3)} />
              <MiniStat label="Freq" value={`${phase.frequency.toFixed(1)} Hz`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function TotalCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: string;
}) {
  return (
    <div className="bento-tile" style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 22,
          fontWeight: 700,
          color: accent ?? "var(--text-primary)",
        }}
      >
        {value}
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  );
}

function SensorCard({
  phase,
  flashKeys,
}: {
  phase: {
    id: string;
    label: string;
    desc: string;
    color: string;
    voltage: number;
    current: number;
    power: number;
    energy: number;
    frequency: number;
    pf: number;
    status: "online" | "offline" | "zero";
    flashV?: number;
    flashP?: number;
    flashA?: number;
  };
  flashKeys: Record<string, number>;
}) {
  const statusColors = {
    online: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", label: "Online" },
    zero: { bg: "rgba(245,158,11,0.1)", text: "#F59E0B", label: "Blackout / 0V" },
    offline: { bg: "rgba(100,116,139,0.1)", text: "#64748b", label: "No Data" },
  };
  const sc = statusColors[phase.status];

  // Use flash key for each card metric
  const flashVKey = `voltage_${phase.id.toLowerCase()}`;
  const flashPKey = `power_${phase.id.toLowerCase()}`;
  const flashAKey = `current_${phase.id.toLowerCase()}`;

  return (
    <div
      className="bento-tile"
      style={{
        borderColor: `${phase.color}40`,
        borderWidth: 1.5,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle accent bar at top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, ${phase.color}, transparent)`,
        }}
      />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, paddingTop: 6 }}>
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: phase.color,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {phase.label}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{phase.desc}</div>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 20,
            background: sc.bg,
            color: sc.text,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: sc.text,
              boxShadow: phase.status === "online" ? `0 0 6px ${sc.text}` : "none",
            }}
          />
          {sc.label}
        </span>
      </div>

      {/* Big power readout */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Active Power</div>
        <LiveValue
          value={phase.power.toFixed(1)}
          unit="W"
          accent={phase.color}
          size={32}
          flashKey={flashKeys[flashPKey]}
        />
      </div>

      {/* Grid of metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MetricCell
          label="Voltage"
          value={phase.voltage.toFixed(1)}
          unit="V"
          flashKey={flashKeys[flashVKey]}
        />
        <MetricCell
          label="Current"
          value={phase.current.toFixed(3)}
          unit="A"
          flashKey={flashKeys[flashAKey]}
        />
        <MetricCell label="Power Factor" value={phase.pf.toFixed(3)} unit="" />
        <MetricCell label="Frequency" value={phase.frequency.toFixed(1)} unit="Hz" />
      </div>
    </div>
  );
}

function LiveValue({
  value,
  unit,
  accent,
  size,
  flashKey,
}: {
  value: string;
  unit: string;
  accent?: string;
  size?: number;
  flashKey?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!flashKey || !ref.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    ref.current.style.color = "#06B6D4";
    timerRef.current = setTimeout(() => {
      if (ref.current) ref.current.style.color = accent ?? "var(--text-primary)";
    }, 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [flashKey, accent]);

  return (
    <div
      ref={ref}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size ?? 20,
        fontWeight: 700,
        color: accent ?? "var(--text-primary)",
        transition: "color 0.3s ease",
      }}
    >
      {value}
      <span style={{ fontSize: (size ?? 20) * 0.45, color: "var(--text-muted)", marginLeft: 3 }}>{unit}</span>
    </div>
  );
}

function MetricCell({
  label,
  value,
  unit,
  flashKey,
}: {
  label: string;
  value: string;
  unit: string;
  flashKey?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!flashKey || !ref.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    ref.current.style.color = "#06B6D4";
    timerRef.current = setTimeout(() => {
      if (ref.current) ref.current.style.color = "var(--text-primary)";
    }, 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [flashKey]);

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>
        {label}
      </div>
      <div
        ref={ref}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text-primary)",
          transition: "color 0.3s ease",
        }}
      >
        {value}
        {unit && <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{value}</div>
    </div>
  );
}
