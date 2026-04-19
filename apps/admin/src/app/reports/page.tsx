"use client";

import { useEffect, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
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

type Preset = "today" | "7d" | "30d" | "current_month" | "custom";
type Phase = "a" | "b" | "c" | "total";
type Metric = "kwh" | "cost" | "power";

function toDateInputUtc(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = toDateInputUtc(now);

  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") {
    return { from: toDateInputUtc(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)), to: today };
  }
  if (preset === "30d") {
    return { from: toDateInputUtc(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)), to: today };
  }

  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: toDateInputUtc(first), to: today };
}

function toIsoRange(fromDate: string, toDate: string): { fromIso: string; toIso: string } {
  return {
    fromIso: `${fromDate}T00:00:00.000Z`,
    toIso: `${toDate}T23:59:59.999Z`,
  };
}

export default function ReportsPage() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<Preset>("current_month");
  const initialRange = getPresetRange("current_month");
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [phase, setPhase] = useState<Phase>("total");
  const [metric, setMetric] = useState<Metric>("power");
  const [alertOnly, setAlertOnly] = useState(false);
  const [includeBlackout, setIncludeBlackout] = useState(true);
  const [activeChart, setActiveChart] = useState<"energy" | "power" | "voltage" | "current">("power");

  const fetchData = async () => {
    setLoading(true);
    try {
      const { fromIso, toIso } = toIsoRange(dateFrom, dateTo);
      const params = new URLSearchParams({
        preset,
        from: fromIso,
        to: toIso,
        phase,
        metric,
        alertOnly: String(alertOnly),
        includeBlackout: String(includeBlackout),
      });
      const res = await fetch(`/api/reports?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setReadings(data.readings || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (preset === "custom") return;
    const range = getPresetRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  }, [preset]);

  useEffect(() => {
    if (metric === "kwh" || metric === "cost") {
      setActiveChart("energy");
      return;
    }
    setActiveChart("power");
  }, [metric]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, dateFrom, dateTo, phase, metric, alertOnly, includeBlackout]);

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
    link.download = `energy_report_${dateFrom}_${dateTo}_${phase}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = async () => {
    const element = document.getElementById("report-export-area");
    if (!element) return;

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: "#0F172A",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("landscape", "mm", "a4");

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`energy_report_${dateFrom}_${dateTo}_${phase}_${metric}.pdf`);
    } catch (error) {
      console.error("Failed to generate PDF", error);
    }
  };

  const avgPower = readings.length
    ? (readings.reduce((s, r) => s + r.power_w, 0) / readings.length).toFixed(1)
    : "-";
  const maxPower = readings.length
    ? Math.max(...readings.map((r) => r.power_w)).toFixed(1)
    : "-";
  const avgVoltage = readings.length
    ? (readings.reduce((s, r) => s + r.voltage, 0) / readings.length).toFixed(1)
    : "-";

  const CHART_CONFIG = {
    energy: { key: "energy_kwh", label: "Energy (kWh)", color: "#F59E0B", unit: "kWh", digits: 4 },
    power: { key: "power_w", label: "Power (W)", color: "#06B6D4", unit: "W", digits: 1 },
    voltage: { key: "voltage", label: "Voltage (V)", color: "#3B82F6", unit: "V", digits: 1 },
    current: { key: "current_amp", label: "Current (A)", color: "#22D3EE", unit: "A", digits: 3 },
  };

  const cfg = CHART_CONFIG[activeChart];

  return (
    <>
      <div className="page-header">
        <h2>Historical Reports</h2>
        <p>Auto-applying filters for report generation and exports.</p>
      </div>

      <div className="page-body">
        <div className="panel">
          <div className="panel-body reports-filter-row">
            <div className="form-group no-margin">
              <label>Preset</label>
              <select
                className="form-input"
                title="Report preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
              >
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="current_month">Current month</option>
                <option value="custom">Custom range</option>
              </select>
            </div>

            <div className="form-group no-margin">
              <label>From</label>
              <input
                className="form-input"
                type="date"
                title="From date"
                value={dateFrom}
                onChange={(e) => {
                  setPreset("custom");
                  setDateFrom(e.target.value);
                }}
              />
            </div>

            <div className="form-group no-margin">
              <label>To</label>
              <input
                className="form-input"
                type="date"
                title="To date"
                value={dateTo}
                onChange={(e) => {
                  setPreset("custom");
                  setDateTo(e.target.value);
                }}
              />
            </div>

            <div className="form-group no-margin">
              <label>Phase</label>
              <select
                className="form-input"
                title="Report phase"
                value={phase}
                onChange={(e) => setPhase(e.target.value as Phase)}
              >
                <option value="total">Total</option>
                <option value="a">Phase A</option>
                <option value="b">Phase B</option>
                <option value="c">Phase C</option>
              </select>
            </div>

            <div className="form-group no-margin">
              <label>Metric</label>
              <select
                className="form-input"
                title="Report metric"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                <option value="kwh">kWh</option>
                <option value="cost">Cost (PHP)</option>
                <option value="power">Power (W)</option>
              </select>
            </div>

            <label className="reports-toggle">
              <input type="checkbox" checked={alertOnly} onChange={(e) => setAlertOnly(e.target.checked)} /> Alert-only periods
            </label>

            <label className="reports-toggle">
              <input
                type="checkbox"
                checked={includeBlackout}
                onChange={(e) => setIncludeBlackout(e.target.checked)}
              />
              Include blackout events
            </label>

            <button className="btn" onClick={downloadCSV} disabled={readings.length === 0}>
              Export CSV
            </button>
            <button className="btn" onClick={downloadPDF} disabled={readings.length === 0}>
              Export PDF
            </button>
          </div>
        </div>

        <div id="report-export-area" className="report-export-area">
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Data Points</div>
              <div className="stat-value accent-cyan-text">
                {readings.length.toLocaleString()}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg Power</div>
              <div className="stat-value">
                {avgPower}
                <span className="unit-inline"> W</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Peak Power</div>
              <div className="stat-value accent-rose-text">
                {maxPower}
                <span className="unit-inline"> W</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg Voltage</div>
              <div className="stat-value">
                {avgVoltage}
                <span className="unit-inline"> V</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Chart</h3>
              <div className="chart-toggle-row">
                {(Object.keys(CHART_CONFIG) as Array<keyof typeof CHART_CONFIG>).map((key) => (
                  <button
                    key={key}
                    className={`btn chart-toggle-btn ${activeChart === key ? "btn-primary" : ""}`}
                    onClick={() => setActiveChart(key)}
                  >
                    {CHART_CONFIG[key].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-body">
              {readings.length === 0 ? (
                <div className="report-empty">
                  {loading ? "Loading..." : "No data for selected filters."}
                </div>
              ) : (
                <div className="report-chart-height">
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
                      <YAxis stroke="#64748B" tick={{ fontSize: 11 }} unit={cfg.unit ? ` ${cfg.unit}` : undefined} />
                      <Tooltip
                        contentStyle={{
                          background: "#1E293B",
                          border: "1px solid #475569",
                          borderRadius: 2,
                          fontSize: 12,
                        }}
                        labelFormatter={(t: string) => new Date(t).toLocaleString()}
                        formatter={(value: number) => [value.toFixed(cfg.digits ?? 2), cfg.label]}
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
      </div>
    </>
  );
}
