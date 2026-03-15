"use client";

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
  id: number; // DB primary key — used for dedup, always unique
  voltage: number;
  current_amp: number;
  power_w: number;
  energy_kwh: number;
  frequency: number;
  power_factor: number;
  recorded_at: string;
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

// ── Default device ID for development (matches mock-sensor default) ──
// ── Device ID is loaded dynamically from /api/devices on mount ──
// This eliminates UUID drift between the DB, Arduino firmware, and this file.

// ── Helpers ──────────────────────────────────────────────────
function parseDBDate(iso: string): Date {
  const hasTimezone = iso.endsWith("Z") || /([+-][0-9]{2}:[0-9]{2})$/.test(iso);
  const dateString = hasTimezone ? iso : `${iso}Z`;
  return new Date(dateString);
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - parseDBDate(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ════════════════════════════════════════════════════════════
// DASHBOARD PAGE
// ════════════════════════════════════════════════════════════

export default function DashboardPage() {
  // Dynamically resolved from /api/devices — avoids UUID hardcoding
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { latestReading, isConnected } = usePolling(deviceId);
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

    fetch(`/api/readings?deviceId=${deviceId}`)
      .then((r) => r.json())
      .then((d) => setChartData(d.readings || []))
      .catch(console.error);

    fetch(`/api/alerts?deviceId=${deviceId}`)
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts || []))
      .catch(console.error);
  }, [deviceId]);

  // Refresh report summary at a slower cadence (analytics, not live telemetry).
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

  // Keep billing estimate in sync with incoming readings.
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

  // ── Append new SSE readings to chart + flash values ──
  // startTransition defers state updates out of the synchronous effect tick,
  // satisfying React 19's react-hooks/set-state-in-effect rule.
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
    };

    // Compute flash keys before the transition (uses ref, safe)
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
      setChartData((prev) => {
        // Dedup by DB row id — safe even if two readings share the same
        // recorded_at second (which the timestamp string check missed).
        if (prev.length > 0 && prev[prev.length - 1].id === reading.id) {
          return prev;
        }
        const updated = [...prev, reading];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });
      if (Object.keys(flashes).length > 0) {
        setFlashKeys((f) => ({ ...f, ...flashes }));
      }
    });
  }, [latestReading]);

  // ── Current values (from latest reading or SSE) ──
  const current = latestReading
    ? {
        voltage: latestReading.voltage,
        current: latestReading.current_amp,
        power: latestReading.power_w,
        energy: latestReading.energy_kwh,
        frequency: latestReading.frequency,
        pf: latestReading.power_factor,
      }
    : null;

  // ── Mark alert as read ──
  const dismissAlert = async (alertId: string) => {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    });
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

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

  return (
    <>
      {/* ── Navbar ── */}
      <nav className="navbar">
        <div className="navbar-title">
          ⚡ Energy Monitor
        </div>
        <div className="navbar-status">
          <span className={`status-dot ${isConnected ? "online" : "offline"}`} />
          {isConnected ? "Live" : "Offline"}
          {!isConnected && latestReading?.recorded_at && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
              · Last seen {formatTimeAgo(latestReading.recorded_at)}
            </span>
          )}
          {alerts.length > 0 && (
            <span className="alert-badge">{alerts.length}</span>
          )}
        </div>
      </nav>

      {/* ── Bento Grid ── */}
      <div className="bento-grid">
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
                />
                <Area
                  type="monotone"
                  dataKey="power_w"
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
          style={{ gridColumn: "span 4", gridRow: "span 2", overflowY: "auto" }}
        >
          <div className="tile-label">
            🔔 Alerts{" "}
            {alerts.length > 0 && (
              <span className="alert-badge" style={{ marginLeft: 6 }}>
                {alerts.length}
              </span>
            )}
          </div>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    background: "rgba(225, 29, 72, 0.1)",
                    border: "1px solid rgba(225, 29, 72, 0.3)",
                    borderRadius: 2,
                    padding: "10px 12px",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--accent-rose)", marginBottom: 4 }}>
                    {alert.type.replace("_", " ")}
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>{alert.message}</div>
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: "var(--text-muted)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ──── VOLTAGE TILE ──── */}
        <MetricTile
          label="Voltage"
          value={current?.voltage ?? 0}
          unit="V"
          decimals={1}
          flashKey={flashKeys.v}
          span={3}
        />

        {/* ──── CURRENT TILE ──── */}
        <MetricTile
          label="Current"
          value={current?.current ?? 0}
          unit="A"
          decimals={3}
          flashKey={flashKeys.a}
          span={3}
        />

        {/* ──── POWER TILE ──── */}
        <MetricTile
          label="Power"
          value={current?.power ?? 0}
          unit="W"
          decimals={1}
          flashKey={flashKeys.w}
          accentColor="var(--accent-cyan)"
          span={3}
        />

        {/* ──── POWER FACTOR TILE ──── */}
        <MetricTile
          label="Power Factor"
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
            ₱{billing?.estimatedCostPhp?.toLocaleString("en-PH", { minimumFractionDigits: 2 }) ?? "---"}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
            {billing?.totalKwh?.toFixed(2) ?? "0"} kWh consumed
          </div>
        </div>

        {/* ──── ENERGY (kWh) TILE ──── */}
        <div className="bento-tile" style={{ gridColumn: "span 4" }}>
          <div className="tile-label">Total Energy</div>
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

        {/* ──── REPORT SUMMARY TILE ──── */}
        <div className="bento-tile report-tile" style={{ gridColumn: "span 12" }}>
          <div className="report-header">
            <div>
              <div className="tile-label">Consumption Summary Report</div>
              <div className="report-subtitle">
                Averages: day (last 30d), week (last 8w), month (last 6 complete months)
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
    </>
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
        ~ ₱{cost.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// METRIC TILE COMPONENT (with flash animation)
// DOM ref approach: toggle CSS class directly to avoid setState-in-effect
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
    // Force reflow to restart animation if already flashing
    el.classList.remove("value-flash");
    void el.offsetWidth;
    el.classList.add("value-flash");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => el.classList.remove("value-flash"), 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [flashKey]);

  return (
    <div className="bento-tile" style={{ gridColumn: `span ${span}` }}>
      <div className="tile-label">{label}</div>
      <div ref={valueRef} className="tile-value" style={accentColor ? { color: accentColor } : {}}>
        {value.toFixed(decimals)}
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
    </div>
  );
}
