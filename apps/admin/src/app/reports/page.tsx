"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Reading {
  voltage: number;
  current_amp: number;
  power_w: number;
  energy_kwh: number;
  frequency: number;
  power_factor: number;
  recorded_at: string;
}

export default function ReportsPage() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 16);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [activeChart, setActiveChart] = useState<"power" | "voltage" | "current">("power");

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: new Date(dateFrom).toISOString(),
        to: new Date(dateTo).toISOString(),
      });
      const res = await fetch(`/api/reports?${params}`);
      const data = await res.json();
      setReadings(data.readings || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCSV = () => {
    if (readings.length === 0) return;

    const headers = "Timestamp,Voltage (V),Current (A),Power (W),Energy (kWh),Frequency (Hz),Power Factor\n";
    const rows = readings
      .map(
        (r) =>
          `${r.recorded_at},${r.voltage},${r.current_amp},${r.power_w},${r.energy_kwh},${r.frequency},${r.power_factor}`
      )
      .join("\n");

    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `energy_report_${dateFrom}_${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Summary stats
  const avgPower = readings.length
    ? (readings.reduce((s, r) => s + r.power_w, 0) / readings.length).toFixed(1)
    : "—";
  const maxPower = readings.length
    ? Math.max(...readings.map((r) => r.power_w)).toFixed(1)
    : "—";
  const avgVoltage = readings.length
    ? (readings.reduce((s, r) => s + r.voltage, 0) / readings.length).toFixed(1)
    : "—";

  const CHART_CONFIG = {
    power: { key: "power_w", label: "Power (W)", color: "#06B6D4" },
    voltage: { key: "voltage", label: "Voltage (V)", color: "#3B82F6" },
    current: { key: "current_amp", label: "Current (A)", color: "#F59E0B" },
  };

  const cfg = CHART_CONFIG[activeChart];

  return (
    <>
      <div className="page-header">
        <h2>Historical Reports</h2>
        <p>Query and export historical energy data.</p>
      </div>

      <div className="page-body">
        {/* ── Date Range Filter ── */}
        <div className="panel">
          <div className="panel-body" style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>From</label>
              <input
                className="form-input"
                type="datetime-local"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ maxWidth: 220 }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>To</label>
              <input
                className="form-input"
                type="datetime-local"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ maxWidth: 220 }}
              />
            </div>
            <button className="btn btn-primary" onClick={fetchData} disabled={loading}>
              {loading ? "Fetching..." : "Query"}
            </button>
            <button className="btn" onClick={downloadCSV} disabled={readings.length === 0}>
              📥 Export CSV
            </button>
          </div>
        </div>

        {/* ── Summary Stats ── */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Data Points</div>
            <div className="stat-value" style={{ color: "var(--accent-cyan)" }}>
              {readings.length.toLocaleString()}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Power</div>
            <div className="stat-value">{avgPower}<span style={{ fontSize: 14, color: "var(--text-muted)" }}> W</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Peak Power</div>
            <div className="stat-value" style={{ color: "var(--accent-rose)" }}>{maxPower}<span style={{ fontSize: 14, color: "var(--text-muted)" }}> W</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Voltage</div>
            <div className="stat-value">{avgVoltage}<span style={{ fontSize: 14, color: "var(--text-muted)" }}> V</span></div>
          </div>
        </div>

        {/* ── Chart ── */}
        <div className="panel">
          <div className="panel-header">
            <h3>Chart</h3>
            <div style={{ display: "flex", gap: 4 }}>
              {(Object.keys(CHART_CONFIG) as Array<keyof typeof CHART_CONFIG>).map((key) => (
                <button
                  key={key}
                  className={`btn ${activeChart === key ? "btn-primary" : ""}`}
                  style={{ padding: "4px 12px", fontSize: 12 }}
                  onClick={() => setActiveChart(key)}
                >
                  {CHART_CONFIG[key].label}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-body">
            {readings.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px 0" }}>
                {loading ? "Loading..." : "No data in the selected range. Adjust dates and query again."}
              </div>
            ) : (
              <div style={{ height: 340 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={readings}>
                    <defs>
                      <linearGradient id="reportGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={cfg.color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={cfg.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="recorded_at"
                      tickFormatter={(t: string) =>
                        new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      }
                      stroke="#64748B"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis stroke="#64748B" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#1E293B",
                        border: "1px solid #475569",
                        borderRadius: 2,
                        fontSize: 12,
                      }}
                      labelFormatter={(t: string) => new Date(t).toLocaleString()}
                    />
                    <Area
                      type="monotone"
                      dataKey={cfg.key}
                      stroke={cfg.color}
                      strokeWidth={2}
                      fill="url(#reportGrad)"
                      dot={false}
                      animationDuration={300}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
