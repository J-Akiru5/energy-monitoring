"use client";

import { useEffect, useState } from "react";

interface Device {
  id: string;
  hardware_id: string;
  name: string;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export default function SensorsPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d) => setDevices(d.devices || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDeactivate = async (deviceId: string) => {
    if (!confirm("Are you sure you want to deactivate this sensor? This will stop data ingestion.")) return;

    await fetch("/api/devices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, action: "deactivate" }),
    });

    setDevices((prev) =>
      prev.map((d) => (d.id === deviceId ? { ...d, is_active: false } : d))
    );
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    return new Date(iso).toLocaleString();
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
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Hardware ID</th>
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
                  devices.map((device) => (
                    <tr key={device.id}>
                      <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                        {device.name || "Unnamed"}
                      </td>
                      <td className="mono">{device.hardware_id}</td>
                      <td>
                        <span className={`status-badge ${device.is_active ? "active" : "inactive"}`}>
                          ● {device.is_active ? "Active" : "Inactive"}
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
