"use client";

import { useEffect, useState } from "react";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";

type ReportSummary = {
  current: {
    monthKwh: number;
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
  powerStats: {
    dayAvgW: number;
    weekAvgW: number;
    monthAvgW: number;
    currentW: number;
  };
  monthlyHistory: Array<{
    period: string;
    totalKwh: number;
  }>;
  selectedSeries: Array<{
    period: string;
    value: number;
    unit: string;
  }>;
};

type Preset = "today" | "7d" | "30d" | "current_month" | "custom";
type Phase = "a" | "b" | "c" | "total";
type Metric = "kwh" | "cost" | "power";

function toDateInputUtc(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = toDateInputUtc(now);

  if (preset === "today") {
    return { from: to, to };
  }

  if (preset === "7d") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: toDateInputUtc(start), to };
  }

  if (preset === "30d") {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: toDateInputUtc(start), to };
  }

  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: toDateInputUtc(firstOfMonth), to };
}

function formatMetric(value: number, metric: Metric): string {
  if (metric === "cost") {
    return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (metric === "power") {
    return `${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} W`;
  }
  return `${value.toLocaleString("en-PH", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kWh`;
}

function toIsoRange(fromDate: string, toDate: string): { fromIso: string; toIso: string } {
  const fromIso = `${fromDate}T00:00:00.000Z`;
  const toIso = `${toDate}T23:59:59.999Z`;
  return { fromIso, toIso };
}

export default function ReportsPage() {
  const { deviceId } = usePrimaryDevice();
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [preset, setPreset] = useState<Preset>("current_month");
  const [phase, setPhase] = useState<Phase>("total");
  const [metric, setMetric] = useState<Metric>("kwh");
  const [alertOnly, setAlertOnly] = useState(false);
  const [includeBlackout, setIncludeBlackout] = useState(true);
  const initialRange = getPresetRange("current_month");
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;
    const { fromIso, toIso } = toIsoRange(fromDate, toDate);

    const loadSummary = async () => {
      try {
        const params = new URLSearchParams({
          deviceId,
          preset,
          from: fromIso,
          to: toIso,
          phase,
          metric,
          alertOnly: String(alertOnly),
          includeBlackout: String(includeBlackout),
        });

        const res = await fetch(`/api/reports/summary?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        setSummary(data);
      } catch (err) {
        console.error("[reports] Failed to load summary:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadSummary();

    return () => {
      isMounted = false;
    };
  }, [deviceId, preset, fromDate, toDate, phase, metric, alertOnly, includeBlackout]);

  useEffect(() => {
    if (preset === "custom") return;
    const range = getPresetRange(preset);
    setFromDate(range.from);
    setToDate(range.to);
  }, [preset]);

  const downloadPdf = async () => {
    if (!deviceId || isDownloading) return;

    setIsDownloading(true);
    try {
      const { fromIso, toIso } = toIsoRange(fromDate, toDate);
      const params = new URLSearchParams({
        deviceId,
        preset,
        from: fromIso,
        to: toIso,
        phase,
        metric,
        alertOnly: String(alertOnly),
        includeBlackout: String(includeBlackout),
      });

      const res = await fetch(`/api/reports/pdf?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "consumption-summary.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[reports] Failed to download PDF:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const metricCards = summary
    ? metric === "cost"
      ? {
        day: summary.averages.dayEstimatedPhp,
        week: summary.averages.weekEstimatedPhp,
        month: summary.averages.monthEstimatedPhp,
        current: summary.current.monthEstimatedPhp,
      }
      : metric === "power"
        ? {
          day: summary.powerStats.dayAvgW,
          week: summary.powerStats.weekAvgW,
          month: summary.powerStats.monthAvgW,
          current: summary.powerStats.currentW,
        }
        : {
          day: summary.averages.dayKwh,
          week: summary.averages.weekKwh,
          month: summary.averages.monthKwh,
          current: summary.current.monthKwh,
        }
    : null;

  return (
    <div className="page-shell">
      <section className="page-header page-header-split">
        <div>
          <div className="page-eyebrow">Analytics</div>
          <h1 className="page-title">Consumption Reports</h1>
          <p className="page-copy">Filter, inspect, and export reports with the exact scope you need.</p>
        </div>
        <button type="button" className="primary-btn" onClick={downloadPdf} disabled={!deviceId || isDownloading}>
          {isDownloading ? "Generating PDF..." : "Generate PDF"}
        </button>
      </section>

      <section className="summary-card reports-filter-card">
        <div className="reports-filter-row">
          <div className="field-group">
            <label className="field-label">Preset</label>
            <select
              className="field-input"
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

          <div className="field-group">
            <label className="field-label">From</label>
            <input
              className="field-input"
              type="date"
              title="From date"
              value={fromDate}
              onChange={(e) => {
                setPreset("custom");
                setFromDate(e.target.value);
              }}
            />
          </div>

          <div className="field-group">
            <label className="field-label">To</label>
            <input
              className="field-input"
              type="date"
              title="To date"
              value={toDate}
              onChange={(e) => {
                setPreset("custom");
                setToDate(e.target.value);
              }}
            />
          </div>

          <div className="field-group">
            <label className="field-label">Phase</label>
            <select
              className="field-input"
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

          <div className="field-group">
            <label className="field-label">Metric</label>
            <select
              className="field-input"
              title="Report metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              <option value="kwh">kWh</option>
              <option value="cost">Cost (PHP)</option>
              <option value="power">Power (W)</option>
            </select>
          </div>

          <label className="field-group reports-checkbox-field">
            <span className="field-label">Alert-only periods</span>
            <input type="checkbox" checked={alertOnly} onChange={(e) => setAlertOnly(e.target.checked)} />
          </label>

          <label className="field-group reports-checkbox-field">
            <span className="field-label">Include blackout events</span>
            <input type="checkbox" checked={includeBlackout} onChange={(e) => setIncludeBlackout(e.target.checked)} />
          </label>
        </div>
      </section>

      {isLoading && !summary ? (
        <div className="page-empty">Loading reports...</div>
      ) : summary && metricCards ? (
        <>
          <section className="summary-grid compact-grid">
            <article className="summary-card">
              <div className="summary-label">Average / Day</div>
                <div className="summary-value">{formatMetric(metricCards.day, metric)}</div>
                <div className="summary-note">Auto-updates with filter changes</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average / Week</div>
                <div className="summary-value">{formatMetric(metricCards.week, metric)}</div>
                <div className="summary-note">Phase: {phase.toUpperCase()}</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average / Month</div>
                <div className="summary-value">{formatMetric(metricCards.month, metric)}</div>
                <div className="summary-note">Preset: {preset.replace("_", " ")}</div>
            </article>
            <article className="summary-card">
                <div className="summary-label">Current Point</div>
                <div className="summary-value accent-cyan">{formatMetric(metricCards.current, metric)}</div>
                <div className="summary-note">Window ends at selected To date</div>
            </article>
          </section>

          <section className="stack-list">
              {summary.selectedSeries.map((item) => (
              <article className="stack-card" key={item.period}>
                <div className="stack-card-head">
                  <div className="summary-label">{item.period}</div>
                  <div className="summary-value">{formatMetric(item.value, metric)}</div>
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}