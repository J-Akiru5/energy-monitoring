"use client";

import Link from "next/link";
import { usePolling } from "@/hooks/usePolling";
import { useEffect, useState, useRef, startTransition } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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

interface AlertItem {
  id: string;
  type: string;
  message: string;
  value: number;
  created_at: string;
  is_read: boolean;
}

interface ReportSummary {
  generatedAt: string;
  ratePhpPerKwh: number;
  current: {
    dayKwh: number;
    weekKwh: number;
    monthKwh: number;
    monthLabel: string;
    dayEstimatedPhp: number;
    weekEstimatedPhp: number;
    monthEstimatedPhp: number;
  };
  averages: {
    dayKwh: number;
    weekKwh: number;
    monthKwh: number;
    dayEstimatedPhp: number;
    weekEstimatedPhp: number;
    monthEstimatedPhp: number;
  };
  monthlyHistory: Array<{
    period: string;
    totalKwh: number;
  }>;
}

type PhaseSelection = "A" | "B" | "C" | "ALL";

// ── Helpers ──────────────────────────────────────────────────
function parseDBDate(iso: string): Date {
  const hasTimezone = iso.endsWith("Z") || /([+-][0-9]{2}:[0-9]{2})$/.test(iso);
  const dateString = hasTimezone ? iso : `${iso}Z`;
  return new Date(dateString);
}

const MAX_CHART_POINTS = 100000;

function mergeReadings(
  base: Reading[],
  incoming: Reading[],
  maxPoints = MAX_CHART_POINTS
): Reading[] {
  const byId = new Map<number, Reading>();
  for (const reading of base) byId.set(reading.id, reading);
  for (const reading of incoming) byId.set(reading.id, reading);

  const merged = Array.from(byId.values()).sort((a, b) => {
    const byTime = parseDBDate(a.recorded_at).getTime() - parseDBDate(b.recorded_at).getTime();
    if (byTime !== 0) return byTime;
    return a.id - b.id;
  });

  return merged.length > maxPoints ? merged.slice(-maxPoints) : merged;
}

/** Check if a reading has 3-phase data */
function isThreePhase(reading: Reading | null): boolean {
  if (!reading) return false;
  return (
    reading.voltage_a !== null &&
    reading.voltage_a !== undefined &&
    reading.voltage_b !== null &&
    reading.voltage_b !== undefined &&
    reading.voltage_c !== null &&
    reading.voltage_c !== undefined
  );
}

// ════════════════════════════════════════════════════════════
// DASHBOARD PAGE
// ════════════════════════════════════════════════════════════

export default function DashboardPage() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { latestReading } = usePolling(deviceId);
  const [chartData, setChartData] = useState<Reading[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [billing, setBilling] = useState<{ totalKwh: number; estimatedCostPhp: number } | null>(null);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [isReportDownloading, setIsReportDownloading] = useState(false);
  const prevValuesRef = useRef<{ v: number; a: number; w: number; pf: number }>({
    v: 0, a: 0, w: 0, pf: 0,
  });
  const [flashKeys, setFlashKeys] = useState({ v: 0, a: 0, w: 0, pf: 0 });
  const [currentDate, setCurrentDate] = useState("");

  // Phase selector state
  const [selectedPhase, setSelectedPhase] = useState<PhaseSelection>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("selectedPhase") as PhaseSelection) || "ALL";
    }
    return "ALL";
  });

  // Persist phase selection
  useEffect(() => {
    localStorage.setItem("selectedPhase", selectedPhase);
  }, [selectedPhase]);

  // ── Step 1: Discover the active device ID from the DB ──
  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d) => {
        const firstDevice = d.devices?.[0];
        if (firstDevice?.id) setDeviceId(firstDevice.id);
      })
      .catch(console.error);
  }, []);

  // ── Step 2: Load historical data once deviceId is known ──
  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;
    const controller = new AbortController();

    const loadInitialData = async () => {
      try {
        const [readingsRes, alertsRes] = await Promise.all([
          fetch(`/api/readings?deviceId=${deviceId}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/alerts?deviceId=${deviceId}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        if (!readingsRes.ok || !alertsRes.ok) return;

        const [readingsJson, alertsJson] = await Promise.all([
          readingsRes.json(),
          alertsRes.json(),
        ]);

        if (!isMounted) return;

        const historical: Reading[] = readingsJson.readings ?? [];
        setChartData((prev) => mergeReadings(prev, historical));
        setAlerts(alertsJson.alerts ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[dashboard] Failed to load initial dashboard data:", err);
      }
    };

    loadInitialData();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [deviceId]);

  // Refresh report summary
  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const refreshSummary = async () => {
      if (isMounted) setIsReportLoading(true);
      try {
        const res = await fetch(`/api/reports/summary?deviceId=${deviceId}`, {
          cache: "no-store",
        });

        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        setReportSummary(data);
      } catch (err) {
        console.error("[dashboard] Failed to refresh report summary:", err);
      } finally {
        if (isMounted) setIsReportLoading(false);
      }
    };

    refreshSummary();
    const interval = setInterval(refreshSummary, 60_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [deviceId]);

  // Keep billing estimate in sync
  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const refreshBilling = async () => {
      try {
        const res = await fetch(`/api/billing?deviceId=${deviceId}`, {
          cache: "no-store",
        });

        if (!res.ok) return;

        const d = await res.json();
        if (!isMounted) return;

        setBilling({
          totalKwh: Number(d.totalKwh ?? 0),
          estimatedCostPhp: Number(d.estimatedCostPhp ?? 0),
        });
      } catch (err) {
        console.error("[dashboard] Failed to refresh billing:", err);
      }
    };

    refreshBilling();
    const interval = setInterval(refreshBilling, 6_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [deviceId]);

  // ── Append new readings to chart + flash values ──
  useEffect(() => {
    if (!latestReading) return;

    const reading: Reading = {
      id: latestReading.id,
      voltage: latestReading.voltage,
      current_amp: latestReading.current_amp,
      power_w: latestReading.power_w,
      energy_kwh: latestReading.energy_kwh,
      frequency: latestReading.frequency,
      power_factor: latestReading.power_factor,
      recorded_at: latestReading.recorded_at,
      // 3-phase columns
      voltage_a: latestReading.voltage_a,
      voltage_b: latestReading.voltage_b,
      voltage_c: latestReading.voltage_c,
      current_a: latestReading.current_a,
      current_b: latestReading.current_b,
      current_c: latestReading.current_c,
      power_a: latestReading.power_a,
      power_b: latestReading.power_b,
      power_c: latestReading.power_c,
      energy_a: latestReading.energy_a,
      energy_b: latestReading.energy_b,
      energy_c: latestReading.energy_c,
      frequency_a: latestReading.frequency_a,
      frequency_b: latestReading.frequency_b,
      frequency_c: latestReading.frequency_c,
      power_factor_a: latestReading.power_factor_a,
      power_factor_b: latestReading.power_factor_b,
      power_factor_c: latestReading.power_factor_c,
      total_power: latestReading.total_power,
      total_energy: latestReading.total_energy,
    };

    // Compute flash keys
    const prev = prevValuesRef.current;
    const flashes: Partial<typeof flashKeys> = {};
    if (prev.v !== reading.voltage) flashes.v = Date.now();
    if (prev.a !== reading.current_amp) flashes.a = Date.now();
    if (prev.w !== reading.power_w) flashes.w = Date.now();
    if (prev.pf !== reading.power_factor) flashes.pf = Date.now();
    prevValuesRef.current = {
      v: reading.voltage,
      a: reading.current_amp,
      w: reading.power_w,
      pf: reading.power_factor,
    };

    startTransition(() => {
      setChartData((prev) => mergeReadings(prev, [reading]));
      if (Object.keys(flashes).length > 0) {
        setFlashKeys((f) => ({ ...f, ...flashes }));
      }
    });
  }, [latestReading]);

  // ── Update date display at midnight ──
  useEffect(() => {
    const updateDate = () => {
      const formatted = new Intl.DateTimeFormat("en-PH", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "Asia/Manila",
      }).format(new Date());
      setCurrentDate(formatted);
    };

    updateDate();
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    const timeout = setTimeout(() => {
      updateDate();
      const interval = setInterval(updateDate, 24 * 60 * 60 * 1000);
      return () => clearInterval(interval);
    }, msUntilMidnight);

    return () => clearTimeout(timeout);
  }, []);

  // ── Computed values based on phase selection ──
  const is3Phase = isThreePhase(latestReading as Reading | null);

  const getPhaseValues = () => {
    if (!latestReading) return null;

    if (!is3Phase) {
      // Single-phase device
      return {
        voltage: latestReading.voltage,
        current: latestReading.current_amp,
        power: latestReading.power_w,
        energy: latestReading.energy_kwh,
        frequency: latestReading.frequency,
        pf: latestReading.power_factor,
      };
    }

    // 3-phase device
    switch (selectedPhase) {
      case "A":
        return {
          voltage: latestReading.voltage_a ?? 0,
          current: latestReading.current_a ?? 0,
          power: latestReading.power_a ?? 0,
          energy: latestReading.energy_a ?? 0,
          frequency: latestReading.frequency_a ?? latestReading.frequency,
          pf: latestReading.power_factor_a ?? latestReading.power_factor,
        };
      case "B":
        return {
          voltage: latestReading.voltage_b ?? 0,
          current: latestReading.current_b ?? 0,
          power: latestReading.power_b ?? 0,
          energy: latestReading.energy_b ?? 0,
          frequency: latestReading.frequency_b ?? latestReading.frequency,
          pf: latestReading.power_factor_b ?? latestReading.power_factor,
        };
      case "C":
        return {
          voltage: latestReading.voltage_c ?? 0,
          current: latestReading.current_c ?? 0,
          power: latestReading.power_c ?? 0,
          energy: latestReading.energy_c ?? 0,
          frequency: latestReading.frequency_c ?? latestReading.frequency,
          pf: latestReading.power_factor_c ?? latestReading.power_factor,
        };
      case "ALL":
      default:
        // Show average voltage, total current, total power, total energy
        const avgVoltage =
          ((latestReading.voltage_a ?? 0) +
            (latestReading.voltage_b ?? 0) +
            (latestReading.voltage_c ?? 0)) /
          3;
        const totalCurrent =
          (latestReading.current_a ?? 0) +
          (latestReading.current_b ?? 0) +
          (latestReading.current_c ?? 0);
        return {
          voltage: avgVoltage,
          current: totalCurrent,
          power: latestReading.total_power ?? latestReading.power_w,
          energy: latestReading.total_energy ?? latestReading.energy_kwh,
          frequency: latestReading.frequency,
          pf: latestReading.power_factor,
        };
    }
  };

  const current = getPhaseValues();

  const downloadReportPdf = async () => {
    if (!deviceId || isReportDownloading) return;

    setIsReportDownloading(true);
    try {
      const res = await fetch(`/api/reports/pdf?deviceId=${deviceId}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("[dashboard] Failed to download PDF report");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);

      a.href = url;
      a.download = match?.[1] ?? "consumption-summary.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[dashboard] PDF download error:", err);
    } finally {
      setIsReportDownloading(false);
    }
  };

  // Get chart power value based on 3-phase or single-phase
  const getChartPower = (r: Reading) => {
    if (isThreePhase(r)) {
      return r.total_power ?? r.power_w;
    }
    return r.power_w;
  };

  return (
    <div className="page-shell">
      <section className="page-header page-header-split">
        <div>
          <div className="page-eyebrow">Live Monitoring</div>
          <h1 className="page-title">Realtime Dashboard</h1>
          {currentDate && (
            <div
              style={{
                fontSize: 14,
                color: "var(--text-muted)",
                marginTop: 4,
                marginBottom: 8,
              }}
            >
              {currentDate}
            </div>
          )}
          <p className="page-copy">
            {is3Phase
              ? "3-Phase monitoring active. Select a phase or view combined totals."
              : "Live telemetry from single-phase sensor."}
          </p>
        </div>
        <Link href="/history" className="primary-btn">
          Open History
        </Link>
      </section>

      {/* ── Bento Grid ── */}
      <div className="bento-grid bento-grid-page">
        {/* ──── HERO: 24h Energy Chart ──── */}
        <div
          className="bento-tile"
          style={{ gridColumn: "span 8", gridRow: "span 2" }}
        >
          <div className="tile-label">24-Hour Energy Consumption</div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="powerGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                  formatter={(value: number) => [
                    `${value.toFixed(1)} W`,
                    is3Phase ? "Total Power" : "Power",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey={getChartPower}
                  stroke="#06B6D4"
                  strokeWidth={2}
                  fill="url(#powerGrad)"
                  dot={false}
                  animationDuration={300}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ──── ALERTS PANEL ──── */}
        <div
          className="bento-tile"
          style={{
            gridColumn: "span 4",
            gridRow: "span 2",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}
        >
          <Link
            href="/alerts"
            className="tile-label"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}
          >
            Alerts
            {alerts.length > 0 && (
              <span className="alert-badge" style={{ marginLeft: 2 }}>
                {alerts.length}
              </span>
            )}
          </Link>
          {alerts.length === 0 ? (
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: 13,
                marginTop: 16,
              }}
            >
              No active alerts. System nominal.
            </div>
          ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 8,
                  overflowY: "auto",
                  flex: 1,
                  minHeight: 0
                }}
              >
              {alerts.slice(0, 3).map((alert) => (
                <Link
                  key={alert.id}
                  href="/alerts"
                  style={{
                    background: "rgba(225, 29, 72, 0.2)",
                    border: "1px solid rgba(225, 29, 72, 0.6)",
                    borderRadius: 14,
                    padding: "10px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                    display: "block",
                    boxShadow: "0 0 12px rgba(225, 29, 72, 0.2)",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      color: "#FF5C7C",
                      marginBottom: 4,
                    }}
                  >
                    {alert.type.replace("_", " ")}
                  </div>
                  <div style={{ color: "#E2E8F0" }}>{alert.message}</div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: "#94A3B8",
                      textDecoration: "underline",
                    }}
                  >
                    Open Alerts
                  </div>
                </Link>
              ))}
              {alerts.length > 3 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "12px",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    borderTop: "1px solid rgba(148, 163, 184, 0.1)",
                  }}
                >
                  + {alerts.length - 3} more alerts.{" "}
                  <Link href="/alerts" style={{ color: "var(--accent-cyan)", textDecoration: "underline" }}>
                    View all
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ──── PHASE SELECTOR (only for 3-phase) ──── */}
        {is3Phase && (
          <div
            className="bento-tile phase-selector-tile"
            style={{ gridColumn: "span 12", padding: "12px 20px" }}
          >
            <div className="phase-selector-row">
              <div className="phase-indicator">
                <span className="phase-dot" />
                3-Phase System Active
              </div>
              <div className="phase-selector">
                {(["A", "B", "C", "ALL"] as PhaseSelection[]).map((phase) => (
                  <button
                    key={phase}
                    className={`phase-btn ${selectedPhase === phase ? "active" : ""} phase-${phase.toLowerCase()}`}
                    onClick={() => setSelectedPhase(phase)}
                  >
                    {phase === "ALL" ? "All Phases" : `Phase ${phase}`}
                  </button>
                ))}
              </div>
              <Link href="/dashboard/phases" className="phase-details-link">
                View Phase Details
              </Link>
            </div>
          </div>
        )}

        {/* ──── VOLTAGE TILE ──── */}
        <MetricTile
          label={is3Phase && selectedPhase !== "ALL" ? `Voltage (Phase ${selectedPhase})` : is3Phase ? "Avg Voltage" : "Voltage"}
          value={current?.voltage ?? 0}
          unit="V"
          decimals={1}
          flashKey={flashKeys.v}
          span={3}
        />

        {/* ──── CURRENT TILE ──── */}
        <MetricTile
          label={is3Phase && selectedPhase !== "ALL" ? `Current (Phase ${selectedPhase})` : is3Phase ? "Total Current" : "Current"}
          value={current?.current ?? 0}
          unit="A"
          decimals={3}
          flashKey={flashKeys.a}
          span={3}
        />

        {/* ──── POWER TILE ──── */}
        <MetricTile
          label={is3Phase && selectedPhase !== "ALL" ? `Power (Phase ${selectedPhase})` : is3Phase ? "Total Power" : "Power"}
          value={current?.power ?? 0}
          unit="W"
          decimals={1}
          flashKey={flashKeys.w}
          accentColor="var(--accent-cyan)"
          span={3}
        />

        {/* ──── POWER FACTOR TILE ──── */}
        <MetricTile
          label={is3Phase && selectedPhase !== "ALL" ? `PF (Phase ${selectedPhase})` : "Power Factor"}
          value={current?.pf ?? 0}
          unit=""
          decimals={2}
          flashKey={flashKeys.pf}
          span={3}
        />

        {/* ──── BILL ESTIMATE ──── */}
        <div className="bento-tile" style={{ gridColumn: "span 4" }}>
          <div className="tile-label">Estimated Bill (This Month)</div>
          <div className="tile-value" style={{ color: "var(--accent-amber)" }}>
            ₱
            {billing?.estimatedCostPhp?.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
            }) ?? "---"}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
            {billing?.totalKwh?.toFixed(4) ?? "0.0000"} kWh consumed
          </div>
        </div>

        {/* ──── ENERGY (kWh) TILE ──── */}
        <div className="bento-tile" style={{ gridColumn: "span 4" }}>
          <div className="tile-label">
            {is3Phase && selectedPhase !== "ALL"
              ? `Energy (Phase ${selectedPhase})`
              : "Total Energy"}
          </div>
          <div className="tile-value">
            {current?.energy?.toFixed(4) ?? "0.0000"}
            <span className="tile-unit">kWh</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
            Cumulative (device counter)
          </div>
        </div>

        {/* ──── FREQUENCY TILE ──── */}
        <div className="bento-tile" style={{ gridColumn: "span 4" }}>
          <div className="tile-label">Frequency</div>
          <div className="tile-value">
            {current?.frequency?.toFixed(1) ?? "60.0"}
            <span className="tile-unit">Hz</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
            Grid frequency
          </div>
        </div>

        {/* ──── 3-PHASE QUICK VIEW (only when ALL selected) ──── */}
        {is3Phase && selectedPhase === "ALL" && latestReading && (
          <div className="bento-tile" style={{ gridColumn: "span 12" }}>
            <div className="tile-label">Phase Overview</div>
            <div className="phase-overview-grid">
              <PhaseQuickCard
                phase="A"
                voltage={latestReading.voltage_a ?? 0}
                current={latestReading.current_a ?? 0}
                power={latestReading.power_a ?? 0}
                color="#fb7185"
              />
              <PhaseQuickCard
                phase="B"
                voltage={latestReading.voltage_b ?? 0}
                current={latestReading.current_b ?? 0}
                power={latestReading.power_b ?? 0}
                color="#F59E0B"
              />
              <PhaseQuickCard
                phase="C"
                voltage={latestReading.voltage_c ?? 0}
                current={latestReading.current_c ?? 0}
                power={latestReading.power_c ?? 0}
                color="#06B6D4"
              />
            </div>
          </div>
        )}

        {/* ──── REPORT SUMMARY TILE ──── */}
        <div className="bento-tile report-tile" style={{ gridColumn: "span 12" }}>
          <div className="report-header">
            <div>
              <div className="tile-label">Consumption Summary Report</div>
              <div className="report-subtitle">
                Averages: day (last 30d), week (last 8 full calendar weeks), month
                (last 6 complete months)
              </div>
            </div>
            <button
              className="report-download-btn"
              onClick={downloadReportPdf}
              disabled={!deviceId || isReportDownloading}
            >
              {isReportDownloading ? "Generating PDF..." : "Generate PDF"}
            </button>
          </div>

          {isReportLoading && !reportSummary ? (
            <div className="report-muted">Loading consumption summary...</div>
          ) : (
            <>
              <div className="report-grid">
                <ReportMetric
                  label="Average / Day"
                  kwh={reportSummary?.averages.dayKwh ?? 0}
                  cost={reportSummary?.averages.dayEstimatedPhp ?? 0}
                />
                <ReportMetric
                  label="Average / Week"
                  kwh={reportSummary?.averages.weekKwh ?? 0}
                  cost={reportSummary?.averages.weekEstimatedPhp ?? 0}
                />
                <ReportMetric
                  label="Average / Month"
                  kwh={reportSummary?.averages.monthKwh ?? 0}
                  cost={reportSummary?.averages.monthEstimatedPhp ?? 0}
                />
                <ReportMetric
                  label="Current Month"
                  kwh={reportSummary?.current.monthKwh ?? 0}
                  cost={reportSummary?.current.monthEstimatedPhp ?? 0}
                />
              </div>

              <div className="report-history">
                <div className="report-history-title">Monthly History</div>
                {reportSummary?.monthlyHistory?.length ? (
                  <div className="report-history-list">
                    {reportSummary.monthlyHistory.map((item) => (
                      <span key={item.period} className="report-history-item">
                        {item.period}: {item.totalKwh.toFixed(2)} kWh
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="report-muted">Not enough historical data yet.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PhaseQuickCard({
  phase,
  voltage,
  current,
  power,
  color,
}: {
  phase: string;
  voltage: number;
  current: number;
  power: number;
  color: string;
}) {
  return (
    <div className="phase-quick-card" style={{ borderColor: `${color}40` }}>
      <div className="phase-quick-label" style={{ color }}>
        Phase {phase}
      </div>
      <div className="phase-quick-metrics">
        <div className="phase-quick-row">
          <span className="phase-quick-name">Voltage</span>
          <span className="phase-quick-value">{voltage.toFixed(1)} V</span>
        </div>
        <div className="phase-quick-row">
          <span className="phase-quick-name">Current</span>
          <span className="phase-quick-value">{current.toFixed(3)} A</span>
        </div>
        <div className="phase-quick-row">
          <span className="phase-quick-name">Power</span>
          <span className="phase-quick-value" style={{ color }}>{power.toFixed(1)} W</span>
        </div>
      </div>
    </div>
  );
}

function ReportMetric({
  label,
  kwh,
  cost,
}: {
  label: string;
  kwh: number;
  cost: number;
}) {
  return (
    <div className="report-metric">
      <div className="report-metric-label">{label}</div>
      <div className="report-metric-kwh">{kwh.toFixed(3)} kWh</div>
      <div className="report-metric-cost">
        ~ ₱
        {cost.toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// METRIC TILE COMPONENT (with flash animation)
// ════════════════════════════════════════════════════════════

function MetricTile({
  label,
  value,
  unit,
  decimals = 1,
  flashKey = 0,
  accentColor,
  span = 3,
}: {
  label: string;
  value: number;
  unit: string;
  decimals?: number;
  flashKey?: number;
  accentColor?: string;
  span?: number;
}) {
  const valueRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flashKey === 0 || !valueRef.current) return;
    const el = valueRef.current;
    el.classList.remove("value-flash");
    void el.offsetWidth;
    el.classList.add("value-flash");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => el.classList.remove("value-flash"), 600);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flashKey]);

  return (
    <div className="bento-tile" style={{ gridColumn: `span ${span}` }}>
      <div className="tile-label">{label}</div>
      <div
        ref={valueRef}
        className="tile-value"
        style={accentColor ? { color: accentColor } : {}}
      >
        {value.toFixed(decimals)}
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
    </div>
  );
}
