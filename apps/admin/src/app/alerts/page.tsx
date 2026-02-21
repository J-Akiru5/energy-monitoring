"use client";

import { useEffect, useState } from "react";

interface AlertItem {
  id: string;
  device_id: string;
  type: string;
  message: string;
  value: number;
  created_at: string;
  is_read: boolean;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (alertId: string) => {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    });
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const markAllRead = async () => {
    await Promise.all(
      alerts.map((a) =>
        fetch("/api/alerts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId: a.id }),
        })
      )
    );
    setAlerts([]);
  };

  const getAlertIcon = (type: string) => {
    if (type.includes("voltage")) return "⚡";
    if (type.includes("current")) return "🔌";
    if (type.includes("power")) return "💥";
    return "⚠️";
  };

  return (
    <>
      <div className="page-header">
        <h2>Alerts</h2>
        <p>Unread alerts from threshold violations across all sensors.</p>
      </div>

      <div className="page-body">
        <div className="panel">
          <div className="panel-header">
            <h3>
              Unread Alerts{" "}
              <span
                style={{
                  fontSize: 12,
                  color: alerts.length > 0 ? "var(--accent-rose)" : "var(--text-muted)",
                  marginLeft: 8,
                }}
              >
                ({alerts.length})
              </span>
            </h3>
            {alerts.length > 0 && (
              <button className="btn" onClick={markAllRead} style={{ fontSize: 12 }}>
                Mark All Read
              </button>
            )}
          </div>
          <div>
            {loading ? (
              <div className="alert-item" style={{ color: "var(--text-muted)" }}>
                Loading...
              </div>
            ) : alerts.length === 0 ? (
              <div
                className="alert-item"
                style={{ color: "var(--text-muted)", justifyContent: "center" }}
              >
                No unread alerts. All sensors operating within thresholds.
              </div>
            ) : (
              alerts.map((alert) => (
                <div className="alert-item" key={alert.id}>
                  <span className="alert-icon">{getAlertIcon(alert.type)}</span>
                  <div className="alert-content">
                    <div className="alert-title" style={{ color: "var(--accent-rose)" }}>
                      {alert.type.replace(/_/g, " ").toUpperCase()}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 2 }}>
                      {alert.message}
                    </div>
                    <div className="alert-meta">
                      Value: <span style={{ fontFamily: "var(--font-mono)" }}>{alert.value}</span>
                      {" · "}
                      {new Date(alert.created_at).toLocaleString()}
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
