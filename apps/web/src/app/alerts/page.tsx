"use client";

import { useEffect, useState } from "react";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";

type AlertItem = {
  id: string;
  type: string;
  message: string;
  created_at: string;
  is_read: boolean;
};

export default function AlertsPage() {
  const { deviceId } = usePrimaryDevice();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
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
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    });
    setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
  };

  return (
    <div className="page-shell">
      <section className="page-header">
        <div>
          <div className="page-eyebrow">Notifications</div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-copy">Review active anomalies and dismiss them after acknowledgement.</p>
        </div>
      </section>

      {isLoading ? (
        <div className="page-empty">Loading alerts...</div>
      ) : alerts.length === 0 ? (
        <div className="page-empty">No active alerts. System nominal.</div>
      ) : (
        <section className="stack-list">
          {alerts.map((alert) => (
            <article className="stack-card alert-card" key={alert.id}>
              <div className="stack-card-head">
                <div>
                  <div className="history-alert-type">{alert.type.replaceAll("_", " ")}</div>
                  <div className="history-alert-time">{new Date(alert.created_at).toLocaleString()}</div>
                </div>
                <button type="button" className="ghost-btn" onClick={() => dismissAlert(alert.id)}>
                  Dismiss
                </button>
              </div>
              <div className="history-alert-message">{alert.message}</div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}