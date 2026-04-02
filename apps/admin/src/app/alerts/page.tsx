"use client";

import { useEffect, useState } from "react";

interface AlertItem {
  id:               string;
  device_id:        string;
  type:             string;
  message:          string;
  value:            number;
  created_at:       string;
  is_read:          boolean;
  // Incident time-range fields (migration 002)
  phase:            string | null;
  is_incident:      boolean;
  ended_at:         string | null;
  duration_seconds: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatOngoingDuration(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return formatDuration(seconds);
}

const TYPE_ICONS: Record<string, string> = {
  OVERVOLTAGE:   "⚡",
  UNDERVOLTAGE:  "🔋",
  OVERCURRENT:   "🔌",
  HIGH_POWER:    "💥",
  PZEM_OFFLINE:  "📡",
  BLACKOUT:      "🌑",
  DEVICE_OFFLINE:"📴",
};

function getIcon(type: string): string {
  return TYPE_ICONS[type] ?? "⚠️";
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [alerts,  setAlerts]  = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts || []))
      .catch(console.error)
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // Refresh every 15s so incident durations stay current
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const markRead = async (alertId: string) => {
    await fetch("/api/alerts", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ alertId }),
    });
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const markAllRead = async () => {
    await Promise.all(
      alerts.map((a) =>
        fetch("/api/alerts", {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ alertId: a.id }),
        })
      )
    );
    setAlerts([]);
  };

  const incidents = alerts.filter((a) => a.is_incident);
  const spikes    = alerts.filter((a) => !a.is_incident);

  return (
    <>
      <div className="page-header">
        <h2>Alerts</h2>
        <p>Sustained fault incidents and transient spikes across all sensors.</p>
      </div>

      <div className="page-body">
        {/* ── Incidents Panel ──────────────────────────────────── */}
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <h3>
              Incidents
              <span style={{ fontSize: 12, marginLeft: 8, color: incidents.length > 0 ? "var(--accent-rose)" : "var(--text-muted)" }}>
                ({incidents.length})
              </span>
            </h3>
            {alerts.length > 0 && (
              <button className="btn" onClick={markAllRead} style={{ fontSize: 12 }}>
                Dismiss All
              </button>
            )}
          </div>

          <div>
            {loading ? (
              <div className="alert-item" style={{ color: "var(--text-muted)" }}>Loading...</div>
            ) : incidents.length === 0 ? (
              <div className="alert-item" style={{ color: "var(--text-muted)", justifyContent: "center" }}>
                No active incidents.
              </div>
            ) : (
              incidents.map((alert) => (
                <div className="alert-item" key={alert.id}
                  style={{ borderLeft: alert.ended_at ? "3px solid #4ade80" : "3px solid #f87171" }}>
                  <span className="alert-icon">{getIcon(alert.type)}</span>
                  <div className="alert-content">
                    <div className="alert-title" style={{ color: "var(--accent-rose)", display: "flex", alignItems: "center", gap: 8 }}>
                      {alert.type.replace(/_/g, " ")}
                      {alert.phase && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Phase {alert.phase}</span>
                      )}
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
                        background: alert.ended_at ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
                        color: alert.ended_at ? "#4ade80" : "#f87171",
                        border: `1px solid ${alert.ended_at ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
                      }}>
                        {alert.ended_at ? "✓ Resolved" : "● Ongoing"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 2 }}>
                      {alert.message}
                    </div>
                    <div className="alert-meta" style={{ fontFamily: "var(--font-mono)" }}>
                      {/* Time range */}
                      {!alert.ended_at ? (
                        <>
                          ⏱ {new Date(alert.created_at).toLocaleString()} → Ongoing ({formatOngoingDuration(alert.created_at)})
                        </>
                      ) : (
                        <>
                          ⏱ {new Date(alert.created_at).toLocaleString()} → {new Date(alert.ended_at).toLocaleString()}
                          {alert.duration_seconds != null && (
                            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                              ({formatDuration(alert.duration_seconds)})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
                    onClick={() => markRead(alert.id)}
                  >
                    Dismiss
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Spikes Panel ──────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h3>
              Transient Spikes
              <span style={{ fontSize: 12, marginLeft: 8, color: "var(--text-muted)" }}>
                ({spikes.length})
              </span>
            </h3>
          </div>
          <div>
            {!loading && spikes.length === 0 ? (
              <div className="alert-item" style={{ color: "var(--text-muted)", justifyContent: "center" }}>
                No unread spikes. All sensors within thresholds.
              </div>
            ) : (
              spikes.map((alert) => (
                <div className="alert-item" key={alert.id} style={{ opacity: 0.85 }}>
                  <span className="alert-icon">{getIcon(alert.type)}</span>
                  <div className="alert-content">
                    <div className="alert-title" style={{ color: "var(--accent-rose)" }}>
                      {alert.type.replace(/_/g, " ")}
                      {alert.phase && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>Phase {alert.phase}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 2 }}>
                      {alert.message}
                    </div>
                    <div className="alert-meta">
                      Value: <span style={{ fontFamily: "var(--font-mono)" }}>{alert.value}</span>
                      {" · "}
                      🕐 {new Date(alert.created_at).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
                    onClick={() => markRead(alert.id)}
                  >
                    Dismiss
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
