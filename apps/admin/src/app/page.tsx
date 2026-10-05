"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Stats {
  activeDevices: number;
  totalReadings: number;
  unreadAlerts: number;
  systemStatus: "online" | "offline";
}

const REFRESH_INTERVAL_MS = 15_000;

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadStats = () =>
      fetch("/api/overview", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (isMounted) setStats(d);
        })
        .catch(console.error)
        .finally(() => {
          if (isMounted) setLoading(false);
        });

    loadStats();
    const interval = setInterval(loadStats, REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const isSystemOnline = stats?.systemStatus === "online";

  return (
    <>
      <div className="page-header">
        <h2>System Overview</h2>
        <p>Real-time status of the energy monitoring network.</p>
      </div>

      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Active Sensors</div>
            <div className="stat-value" style={{ color: "var(--accent-cyan)" }}>
              {loading ? "—" : stats?.activeDevices ?? 0}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Total Readings</div>
            <div className="stat-value" style={{ color: "var(--accent-blue)" }}>
              {loading ? "—" : (stats?.totalReadings ?? 0).toLocaleString()}
            </div>
          </div>

          <Link href="/alerts" className="stat-card clickable-card">
            <div className="stat-label">Unread Alerts</div>
            <div
              className="stat-value"
              style={{
                color:
                  (stats?.unreadAlerts ?? 0) > 0
                    ? "var(--accent-rose)"
                    : "var(--accent-green)",
              }}
            >
              {loading ? "—" : stats?.unreadAlerts ?? 0}
            </div>
          </Link>

          <div className="stat-card">
            <div className="stat-label">System Status</div>
            <div
              className="stat-value"
              style={{ color: isSystemOnline ? "var(--accent-green)" : "var(--accent-rose)" }}
            >
              {loading ? "—" : isSystemOnline ? "Online" : "Offline"}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Quick Actions</h3>
          </div>
          <div className="panel-body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href="/sensors" className="btn btn-primary">Manage Sensors</a>
            <a href="/thresholds" className="btn">Configure Thresholds</a>
            <a href="/billing" className="btn">Update Billing Rate</a>
            <a href="/reports" className="btn">View Reports</a>
          </div>
        </div>
      </div>
    </>
  );
}
