"use client";

import { useEffect, useState } from "react";

interface Device {
  id: string;
  name: string;
  location: string | null;
  is_active: boolean;
  is_online: boolean;
  last_seen_at: string | null;
  created_at: string;
}

const REFRESH_INTERVAL_MS = 30_000;

export default function SensorsPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [offlineThresholdSeconds, setOfflineThresholdSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadDevices = () =>
      fetch("/api/devices", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!isMounted) return;
          setDevices(d.devices || []);
          setOfflineThresholdSeconds(d.offlineThresholdSeconds ?? null);
        })
        .catch(console.error)
        .finally(() => {
          if (isMounted) setLoading(false);
        });

    loadDevices();
    const interval = setInterval(loadDevices, REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleDeactivate = async (deviceId: string) => {
    if (!confirm("Are you sure you want to deactivate this sensor? This will stop data ingestion.")) return;

    await fetch("/api/devices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, action: "deactivate" }),
    });

    setDevices((prev) =>
      prev.map((d) =>
        d.id === deviceId ? { ...d, is_active: false, is_online: false } : d
      )
    );
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    return new Date(iso).toLocaleString();
  };

  const statusFor = (device: Device) => {
    if (!device.is_active) {
      return { className: "inactive", label: "Inactive" };
    }
    if (device.is_online) {
      return { className: "active", label: "Online" };
    }
    return { className: "offline", label: "Offline" };
  };

  return (
    <>
      <div className="page-header">
        <h2>Sensor Management</h2>
        <p>View and manage registered ESP32 devices in the network.</p>
      </div>

      <div className="page-body">
        <div className="panel">
          <div className="panel-header">
            <h3>Registered Devices</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {devices.length} device{devices.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="table-scroll table-scroll--wide">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Last Seen</th>
                  <th>Registered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      Loading...
                    </td>
                  </tr>
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      No devices registered. Run the mock sensor to auto-register.
                    </td>
                  </tr>
                ) : (
                  devices.map((device) => {
                    const status = statusFor(device);
                    return (
                      <tr key={device.id}>
                        <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                          {device.name || "Unnamed"}
                        </td>
                        <td>{device.location || "—"}</td>
                        <td>
                          <span className={`status-badge ${status.className}`}>
                            ● {status.label}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{formatDate(device.last_seen_at)}</td>
                        <td style={{ fontSize: 12 }}>{formatDate(device.created_at)}</td>
                        <td>
                          {device.is_active && (
                            <button
                              className="btn btn-danger"
                              style={{ padding: "4px 10px", fontSize: 11 }}
                              onClick={() => handleDeactivate(device.id)}
                            >
                              Deactivate
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {offlineThresholdSeconds !== null && (
            <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-muted)" }}>
              Status is derived from live telemetry: a device is Offline when no reading has
              arrived for more than {offlineThresholdSeconds} seconds. Refreshes automatically.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
