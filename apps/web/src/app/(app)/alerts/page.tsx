"use client";

import { useEffect, useState } from "react";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";

type AlertItem = {
  id:               string;
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
};

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

function AlertBadge({ alert }: { alert: AlertItem }) {
  if (alert.is_incident && !alert.ended_at) {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        padding: "2px 8px", borderRadius: 99,
        background: "rgba(239,68,68,0.18)", color: "#f87171",
        border: "1px solid rgba(239,68,68,0.35)", textTransform: "uppercase",
      }}>
        ● Ongoing
      </span>
    );
  }
  if (alert.is_incident && alert.ended_at) {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        padding: "2px 8px", borderRadius: 99,
        background: "rgba(34,197,94,0.15)", color: "#4ade80",
        border: "1px solid rgba(34,197,94,0.3)", textTransform: "uppercase",
      }}>
        ✓ Resolved
      </span>
    );
  }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
      padding: "2px 8px", borderRadius: 99,
      background: "rgba(250,204,21,0.15)", color: "#fbbf24",
      border: "1px solid rgba(250,204,21,0.3)", textTransform: "uppercase",
    }}>
      Spike
    </span>
  );
}

function AlertTimeRange({ alert }: { alert: AlertItem }) {
  const start = new Date(alert.created_at).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  if (!alert.is_incident) {
    return (
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
        🕐 {start} · transient spike
      </div>
    );
  }

  if (!alert.ended_at) {
    return (
      <div style={{ fontSize: 11, color: "#f87171", marginTop: 4, fontFamily: "var(--font-mono)" }}>
        ⏱ {start} → Ongoing ({formatOngoingDuration(alert.created_at)})
      </div>
    );
  }

  const end = new Date(alert.ended_at).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <div style={{ fontSize: 11, color: "#4ade80", marginTop: 4, fontFamily: "var(--font-mono)" }}>
      ⏱ {start} → {end}
      {alert.duration_seconds != null && (
        <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
          ({formatDuration(alert.duration_seconds)})
        </span>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { deviceId } = usePrimaryDevice();
  const [alerts,    setAlerts]    = useState<AlertItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const loadAlerts = async () => {
      try {
        const res = await fetch(`/api/alerts?deviceId=${deviceId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        setAlerts(data.alerts ?? []);
      } catch (err) {
        console.error("[alerts] Failed to load alerts:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadAlerts();
    const interval = setInterval(loadAlerts, 10_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [deviceId]);

  const dismissAlert = async (alertId: string) => {
    await fetch("/api/alerts", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ alertId }),
    });
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const incidents = alerts.filter((a)  => a.is_incident);
  const spikes    = alerts.filter((a)  => !a.is_incident);

  return (
    <div className="page-shell">
      <section className="page-header">
        <div>
          <div className="page-eyebrow">Notifications</div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-copy">
            Sustained faults are grouped as <strong>Incidents</strong> with start/end times.
            Transient spikes resolve on their own.
          </p>
        </div>
      </section>

      {isLoading ? (
        <div className="page-empty">Loading alerts...</div>
      ) : alerts.length === 0 ? (
        <div className="page-empty">No active alerts. System nominal.</div>
      ) : (
        <>
          {incidents.length > 0 && (
            <section className="stack-list">
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                Incidents ({incidents.length})
              </div>
              {incidents.map((alert) => (
                <article className="stack-card alert-card" key={alert.id}>
                  <div className="stack-card-head">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div className="history-alert-type">
                        {alert.type.replaceAll("_", " ")}
                        {alert.phase && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>· Phase {alert.phase}</span>}
                      </div>
                      <AlertBadge alert={alert} />
                    </div>
                    <button type="button" className="ghost-btn" onClick={() => dismissAlert(alert.id)}>
                      Dismiss
                    </button>
                  </div>
                  <div className="history-alert-message">{alert.message}</div>
                  <AlertTimeRange alert={alert} />
                </article>
              ))}
            </section>
          )}

          {spikes.length > 0 && (
            <section className="stack-list" style={{ marginTop: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                Transient Spikes ({spikes.length})
              </div>
              {spikes.map((alert) => (
                <article className="stack-card alert-card" key={alert.id} style={{ opacity: 0.85 }}>
                  <div className="stack-card-head">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="history-alert-type">
                        {alert.type.replaceAll("_", " ")}
                        {alert.phase && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>· Phase {alert.phase}</span>}
                      </div>
                      <AlertBadge alert={alert} />
                    </div>
                    <button type="button" className="ghost-btn" onClick={() => dismissAlert(alert.id)}>
                      Dismiss
                    </button>
                  </div>
                  <div className="history-alert-message">{alert.message}</div>
                  <AlertTimeRange alert={alert} />
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}