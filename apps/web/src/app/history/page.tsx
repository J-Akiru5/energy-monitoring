"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  type YAxisProps,
} from "recharts";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";
import {
  formatPhWindowLabel,
  phWindowSpansMonths,
  phMonthFullName,
} from "@/lib/phTime";

type HistoryPeriod = "day" | "week" | "month";
type HistoryMetric = "energy_kwh" | "power_w" | "current_amp" | "voltage";

type HistoryResponse = {
  period: HistoryPeriod;
  date: string;
  rangeStart: string;
  rangeEnd: string;
  chartMetric: HistoryMetric;
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
    liveSampleCount: number;
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

type BlackoutResponse = {
  period: HistoryPeriod;
  date: string;
  events: Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    durationFormatted: string;
    isOngoing: boolean;
  }>;
  stats: {
    totalEvents: number;
    completedEvents: number;
    totalDurationSeconds: number;
    totalDurationFormatted: string;
    averageDurationSeconds: number;
    averageDurationFormatted: string;
    longestDurationSeconds: number;
    longestDurationFormatted: string;
    shortestDurationSeconds: number;
    shortestDurationFormatted: string;
  };
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getPhTodayKey() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const METRIC_OPTIONS: Array<{
  key: HistoryMetric;
  label: string;
  yAxisUnit: string;
  tooltipLabel: string;
  digits: number;
}> = [
  {
    key: "energy_kwh",
    label: "Energy",
    yAxisUnit: " kWh",
    tooltipLabel: "Energy",
    digits: 4,
  },
  {
    key: "power_w",
    label: "Power",
    yAxisUnit: " W",
    tooltipLabel: "Power",
    digits: 1,
  },
  {
    key: "current_amp",
    label: "Current",
    yAxisUnit: " A",
    tooltipLabel: "Current",
    digits: 3,
  },
  {
    key: "voltage",
    label: "Voltage",
    yAxisUnit: " V",
    tooltipLabel: "Voltage",
    digits: 1,
  },
];

/**
 * Power is an instantaneous rate (W), not energy — kWh would be the wrong
 * unit. Large values switch to kW so they stay readable.
 */
function formatPower(watts: number) {
  return Math.abs(watts) >= 1000
    ? `${(watts / 1000).toFixed(2)} kW`
    : `${watts.toFixed(1)} W`;
}

export default function HistoryPage() {
  const { deviceId, isLoading: isDeviceLoading } = usePrimaryDevice();
  const [period, setPeriod] = useState<HistoryPeriod>("day");
  const [metric, setMetric] = useState<HistoryMetric>("energy_kwh");
  const [selectedDate, setSelectedDate] = useState(getPhTodayKey);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blackout monitoring state
  const [blackouts, setBlackouts] = useState<BlackoutResponse | null>(null);
  const [isLoadingBlackouts, setIsLoadingBlackouts] = useState(false);

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
          metric,
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
  }, [deviceId, period, selectedDate, metric]);

  // Fetch blackout data parallel to history data
  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const loadBlackouts = async () => {
      setIsLoadingBlackouts(true);
      try {
        const params = new URLSearchParams({
          deviceId,
          period,
          date: selectedDate,
        });
        const res = await fetch(`/api/blackouts?${params.toString()}`, {
          cache: "no-store",
        });

        if (!res.ok) throw new Error("Unable to load blackout data");
        const data = await res.json();
        if (!isMounted) return;
        setBlackouts(data);
      } catch (err) {
        if (!isMounted) return;
        console.error("Blackout fetch error:", err);
        setBlackouts(null);
      } finally {
        if (isMounted) setIsLoadingBlackouts(false);
      }
    };

    loadBlackouts();

    return () => {
      isMounted = false;
    };
  }, [deviceId, period, selectedDate]);

  // Chart title, units and axis follow the metric the loaded data was fetched
  // for, so switching metrics never draws the previous series on the new axis.
  const selectedMetric =
    METRIC_OPTIONS.find((option) => option.key === (history?.chartMetric ?? metric)) ??
    METRIC_OPTIONS[0];
  const timelineTitle = selectedMetric.key === "energy_kwh"
    ? period === "day"
      ? "Energy Timeline"
      : "Daily Energy Timeline"
    : `${selectedMetric.label} Timeline`;
  const timelineHelper = selectedMetric.key === "energy_kwh"
    ? period === "day"
      ? "meter reading (kWh)"
      : "daily consumption (kWh)"
    : period === "day"
      ? `${selectedMetric.label.toLowerCase()} readings`
      : `daily average ${selectedMetric.label.toLowerCase()}`;

  const chartWidth = Math.max(860, (history?.chartPoints.length ?? 1) * (period === "day" ? 18 : 78));

  const liveSampleCount = history?.summary.liveSampleCount ?? 0;
  const hasLiveSamples = liveSampleCount > 0;
  const chartMax = (history?.chartPoints ?? []).reduce((max, point) => Math.max(max, point.value), 0);
  const powerInKw = selectedMetric.key === "power_w" && chartMax >= 1000;
  const axisUnit = powerInKw ? " kW" : selectedMetric.yAxisUnit;
  const formatAxisValue = (value: number) =>
    String(
      powerInKw
        ? Number((value / 1000).toFixed(1))
        : selectedMetric.key === "voltage"
          ? Math.round(value)
          : value
    );
  const formatTooltipValue = (value: number) =>
    powerInKw
      ? `${(value / 1000).toFixed(2)} kW`
      : `${value.toFixed(selectedMetric.digits)}${selectedMetric.yAxisUnit}`;
  // Voltage barely moves (≈220–240 V); a zero-based axis flattens it into a line.
  const yAxisDomain: YAxisProps["domain"] =
    selectedMetric.key === "voltage"
      ? [
          (min: number) => Math.floor((min - 2) / 10) * 10,
          (max: number) => Math.ceil((max + 2) / 10) * 10,
        ]
      : [0, "auto"];

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
              onClick={() => {
                setPeriod(option);
              }}
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
              <div className="summary-value">
                {hasLiveSamples ? `${history.summary.averageVoltage.toFixed(1)} V` : "—"}
              </div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average Current</div>
              <div className="summary-value">
                {hasLiveSamples ? `${history.summary.averageCurrent.toFixed(3)} A` : "—"}
              </div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average Power</div>
              <div className="summary-value">
                {hasLiveSamples ? formatPower(history.summary.averagePower) : "—"}
              </div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Peak Power</div>
              <div className="summary-value accent-cyan">
                {hasLiveSamples ? formatPower(history.summary.peakPower) : "—"}
              </div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Min Voltage</div>
              <div className="summary-value">
                {hasLiveSamples ? `${history.summary.minVoltage.toFixed(1)} V` : "—"}
              </div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Max Voltage</div>
              <div className="summary-value">
                {hasLiveSamples ? `${history.summary.maxVoltage.toFixed(1)} V` : "—"}
              </div>
            </article>
          </section>

          <p className="summary-hint">
            Voltage, current and power statistics use the {liveSampleCount} of {history.sampleCount} recorded
            samples with live voltage; offline and blackout samples are excluded. Power is instantaneous
            (W / kW) — cumulative energy is the Total kWh above.
          </p>

          {history.rangeStart && history.rangeEnd && (
            <div className="panel-copy" style={{ marginTop: 10 }}>
              Window: {formatPhWindowLabel(history.rangeStart, history.rangeEnd)}
              {period === "week" && phWindowSpansMonths(history.rangeStart, history.rangeEnd) && (
                <span style={{ color: "var(--accent-amber)", marginLeft: 6 }}>
                  · includes days from {phMonthFullName(history.rangeStart)}
                </span>
              )}
            </div>
          )}

          <section className="history-layout">
            <article className="history-panel history-panel-wide">
              <div className="panel-header-row">
                <div>
                  <div className="tile-label">{timelineTitle}</div>
                  <div className="panel-copy">
                    Scroll horizontally to inspect the full selected {period} {timelineHelper}. Samples in range: {history.sampleCount}.
                    {period !== "day" && history.chartPoints.length > 0 && (
                      <span style={{ color: "var(--accent-cyan)", marginLeft: "6px" }}>
                        (Click on a day to view its detailed timeline)
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className="segmented-control history-metric-control"
                  role="group"
                  aria-label="Timeline metric selector"
                >
                  {METRIC_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={metric === option.key}
                      className={`segmented-control-btn ${metric === option.key ? "active" : ""}`}
                      onClick={() => setMetric(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {history.chartPoints.length === 0 ? (
                <div className="page-empty compact history-chart-empty">
                  No live {selectedMetric.label.toLowerCase()} readings were recorded for this {period}.
                </div>
              ) : (
              <div className="history-chart-scroll" style={{ opacity: isLoading ? 0.55 : 1 }}>
                <div className="history-chart-frame">
                  <AreaChart
                    width={chartWidth}
                    height={340}
                    data={history.chartPoints}
                    onClick={(state) => {
                      if (period === "day" || !state || !state.activePayload) return;
                      const payload = state.activePayload[0]?.payload;
                      if (!payload?.recordedAt) return;
                      
                      // Extract just the YYYY-MM-DD from the recordedAt timestamp
                      const clickedDateStr = payload.recordedAt.split("T")[0];
                      if (clickedDateStr) {
                        setPeriod("day");
                        setSelectedDate(clickedDateStr);
                      }
                    }}
                    style={{ cursor: period === "day" ? "default" : "pointer" }}
                  >
                      <defs>
                        <linearGradient id="historyGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#06B6D4" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis
                        stroke="#64748B"
                        tick={{ fontSize: 11 }}
                        unit={axisUnit}
                        domain={yAxisDomain}
                        allowDecimals={selectedMetric.key !== "voltage"}
                        tickFormatter={formatAxisValue}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#0F172A",
                          border: "1px solid #475569",
                          borderRadius: 10,
                        }}
                        formatter={(value: number) => [
                          formatTooltipValue(value),
                          history.chartMetric === "energy_kwh"
                            ? period === "day"
                              ? "Meter energy"
                              : "Daily consumption"
                            : selectedMetric.tooltipLabel,
                        ]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.recordedAt ? new Date(payload[0].payload.recordedAt).toLocaleString() : ""}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#06B6D4"
                        strokeWidth={2}
                        fill="url(#historyGrad)"
                        dot={history.chartPoints.length <= 2 ? { r: 3 } : false}
                      />
                    </AreaChart>
                </div>
              </div>
              )}
            </article>

            <article className="history-panel">
              <Link href="/alerts" className="tile-label" style={{ display: "inline-flex" }}>Alerts In Range</Link>
              <div className="panel-copy">Events recorded during the selected period.</div>
              {history.alerts.length === 0 ? (
                <div className="page-empty compact">No alerts for this period.</div>
              ) : (
                <div className="history-alert-list">
                  {history.alerts.map((alert) => (
                    <Link key={alert.id} href="/alerts" className="history-alert-item">
                      <div className="history-alert-type">{alert.type.replaceAll("_", " ")}</div>
                      <div className="history-alert-message">{alert.message}</div>
                      <div className="history-alert-time">{new Date(alert.created_at).toLocaleString()}</div>
                    </Link>
                  ))}
                </div>
              )}
            </article>

            {/* Blackout Monitoring Section */}
            <article className="history-panel history-panel-wide">
              <div className="panel-header-row">
                <div>
                  <div className="tile-label">Blackout Monitoring</div>
                  <div className="panel-copy">
                    Power outage events during the selected {period}.
                  </div>
                </div>
              </div>

              {isLoadingBlackouts ? (
                <div className="page-empty compact">Loading blackout data...</div>
              ) : blackouts && blackouts.stats.totalEvents > 0 ? (
                <>
                  {/* Statistics Cards */}
                  <div className="blackout-stats-grid">
                    <div className="blackout-stat-card">
                      <div className="blackout-stat-label">Total Events</div>
                      <div className="blackout-stat-value accent-rose">
                        {blackouts.stats.totalEvents}
                      </div>
                    </div>
                    <div className="blackout-stat-card">
                      <div className="blackout-stat-label">Total Downtime</div>
                      <div className="blackout-stat-value">
                        {blackouts.stats.totalDurationFormatted}
                      </div>
                    </div>
                    <div className="blackout-stat-card">
                      <div className="blackout-stat-label">Average Duration</div>
                      <div className="blackout-stat-value">
                        {blackouts.stats.averageDurationFormatted}
                      </div>
                    </div>
                    <div className="blackout-stat-card">
                      <div className="blackout-stat-label">Longest Outage</div>
                      <div className="blackout-stat-value accent-amber">
                        {blackouts.stats.longestDurationFormatted}
                      </div>
                    </div>
                  </div>

                  {/* Event Timeline */}
                  <div className="blackout-event-list">
                    {blackouts.events.map((event) => (
                      <div
                        key={event.id}
                        className={`blackout-event-item ${event.isOngoing ? "ongoing" : ""}`}
                      >
                        <div className="blackout-event-header">
                          <span className="blackout-event-status">
                            {event.isOngoing ? "ONGOING" : "RESOLVED"}
                          </span>
                          <span className="blackout-event-duration">
                            {event.durationFormatted}
                          </span>
                        </div>
                        <div className="blackout-event-times">
                          <div>
                            <span className="time-label">Started:</span>{" "}
                            {new Date(event.startedAt).toLocaleString()}
                          </div>
                          {event.endedAt && (
                            <div>
                              <span className="time-label">Ended:</span>{" "}
                              {new Date(event.endedAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="page-empty compact">
                  No blackout events recorded for this {period}.
                </div>
              )}
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}