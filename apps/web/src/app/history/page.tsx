"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";

type HistoryPeriod = "day" | "week" | "month";

type HistoryResponse = {
  period: HistoryPeriod;
  date: string;
  chartMetric: "energy_kwh" | "daily_kwh";
  chartPoints: Array<{
    label: string;
    value: number;
    recordedAt: string;
    secondaryValue: number;
  }>;
  summary: {
    totalKwh: number;
    estimatedCostPhp: number;
    averageVoltage: number;
    averageCurrent: number;
    averagePower: number;
    peakPower: number;
    minVoltage: number;
    maxVoltage: number;
  };
  alerts: Array<{
    id: string;
    type: string;
    message: string;
    created_at: string;
    is_read: boolean;
  }>;
  sampleCount: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getPhTodayKey() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export default function HistoryPage() {
  const { deviceId, isLoading: isDeviceLoading } = usePrimaryDevice();
  const [period, setPeriod] = useState<HistoryPeriod>("day");
  const [selectedDate, setSelectedDate] = useState(getPhTodayKey);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          deviceId,
          period,
          date: selectedDate,
        });
        const res = await fetch(`/api/history?${params.toString()}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error("Unable to load history");
        }

        const data = await res.json();
        if (!isMounted) return;
        setHistory(data);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Unable to load history");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [deviceId, period, selectedDate]);

  const chartWidth = Math.max(860, (history?.chartPoints.length ?? 1) * (period === "day" ? 18 : 78));

  return (
    <div className="page-shell">
      <section className="page-header">
        <div>
          <div className="page-eyebrow">Historical Energy</div>
          <h1 className="page-title">Energy Consumption History</h1>
          <p className="page-copy">
            Inspect day, week, and month energy patterns with a date picker, scrollable chart, and period summary.
          </p>
        </div>
      </section>

      <section className="page-toolbar">
        <div className="segmented-control" aria-label="History period selector">
          {(["day", "week", "month"] as HistoryPeriod[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented-control-btn ${period === option ? "active" : ""}`}
              onClick={() => setPeriod(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <label className="field-group">
          <span className="field-label">Select date</span>
          <input
            className="field-input"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>
      </section>

      {(isLoading || isDeviceLoading) && !history ? (
        <div className="page-empty">Loading history...</div>
      ) : error ? (
        <div className="page-empty">{error}</div>
      ) : history ? (
        <>
          <section className="summary-grid">
            <article className="summary-card">
              <div className="summary-label">Total kWh</div>
              <div className="summary-value">{history.summary.totalKwh.toFixed(4)} kWh</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Estimated Cost</div>
              <div className="summary-value accent-amber">₱{history.summary.estimatedCostPhp.toFixed(2)}</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average Voltage</div>
              <div className="summary-value">{history.summary.averageVoltage.toFixed(1)} V</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average Current</div>
              <div className="summary-value">{history.summary.averageCurrent.toFixed(3)} A</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average Power</div>
              <div className="summary-value">{history.summary.averagePower.toFixed(1)} W</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Peak Power</div>
              <div className="summary-value accent-cyan">{history.summary.peakPower.toFixed(1)} W</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Min Voltage</div>
              <div className="summary-value">{history.summary.minVoltage.toFixed(1)} V</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Max Voltage</div>
              <div className="summary-value">{history.summary.maxVoltage.toFixed(1)} V</div>
            </article>
          </section>

          <section className="history-layout">
            <article className="history-panel history-panel-wide">
              <div className="panel-header-row">
                <div>
                  <div className="tile-label">Energy Timeline</div>
                  <div className="panel-copy">
                    Scroll horizontally to inspect the full selected {period}. Samples in range: {history.sampleCount}.
                  </div>
                </div>
              </div>

              <div className="history-chart-scroll">
                <div className="history-chart-frame">
                  <AreaChart width={chartWidth} height={340} data={history.chartPoints}>
                      <defs>
                        <linearGradient id="historyGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#06B6D4" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis stroke="#64748B" tick={{ fontSize: 11 }} unit=" kWh" />
                      <Tooltip
                        contentStyle={{
                          background: "#0F172A",
                          border: "1px solid #475569",
                          borderRadius: 10,
                        }}
                        formatter={(value: number) => [value.toFixed(4), history.chartMetric === "energy_kwh" ? "Meter energy" : "Daily consumption"]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.recordedAt ? new Date(payload[0].payload.recordedAt).toLocaleString() : ""}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#06B6D4"
                        strokeWidth={2}
                        fill="url(#historyGrad)"
                        dot={false}
                      />
                    </AreaChart>
                </div>
              </div>
            </article>

            <article className="history-panel">
              <div className="tile-label">Alerts In Range</div>
              <div className="panel-copy">Events recorded during the selected period.</div>
              {history.alerts.length === 0 ? (
                <div className="page-empty compact">No alerts for this period.</div>
              ) : (
                <div className="history-alert-list">
                  {history.alerts.map((alert) => (
                    <div key={alert.id} className="history-alert-item">
                      <div className="history-alert-type">{alert.type.replaceAll("_", " ")}</div>
                      <div className="history-alert-message">{alert.message}</div>
                      <div className="history-alert-time">{new Date(alert.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}