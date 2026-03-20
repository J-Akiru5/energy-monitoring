"use client";

import { useEffect, useState, useCallback } from "react";

interface RelayConfig {
  deviceId: string;
  relayEnabled: boolean;
  autoTripEnabled: boolean;
  autoResetEnabled: boolean;
  autoResetDelaySeconds: number;
  tripOnOvervoltage: boolean;
  tripOnUndervoltage: boolean;
  tripOnOvercurrent: boolean;
  tripOnBlackout: boolean;
  manualControlAllowed: boolean;
}

interface RelayState {
  deviceId: string;
  isTripped: boolean;
  lastTripAt: string | null;
  lastResetAt: string | null;
  tripReason: string | null;
}

interface RelayLog {
  id: number;
  action: string;
  triggerType: string | null;
  triggerValue: number | null;
  thresholdValue: number | null;
  initiatedBy: string | null;
  notes: string | null;
  createdAt: string;
}

interface Device {
  id: string;
  name: string;
}

export default function RelayPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [config, setConfig] = useState<RelayConfig | null>(null);
  const [state, setState] = useState<RelayState | null>(null);
  const [logs, setLogs] = useState<RelayLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Fetch devices on mount
  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d) => {
        const deviceList = d.devices || [];
        setDevices(deviceList);
        if (deviceList.length > 0) {
          setSelectedDevice(deviceList[0].id);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Fetch relay config, state, and logs when device changes
  const fetchRelayData = useCallback(async () => {
    if (!selectedDevice) return;

    try {
      const [configRes, stateRes, logsRes] = await Promise.all([
        fetch(`/api/relay/config?deviceId=${selectedDevice}`),
        fetch(`https://energy-monitoring-web.vercel.app/api/relay?deviceId=${selectedDevice}`),
        fetch(`/api/relay/logs?deviceId=${selectedDevice}`),
      ]);

      if (configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData.config || createDefaultConfig(selectedDevice));
      } else {
        setConfig(createDefaultConfig(selectedDevice));
      }

      if (stateRes.ok) {
        const stateData = await stateRes.json();
        setState(stateData.state);
      }

      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData.logs || []);
      }
    } catch (err) {
      console.error("Failed to fetch relay data:", err);
      setConfig(createDefaultConfig(selectedDevice));
    }
  }, [selectedDevice]);

  useEffect(() => {
    fetchRelayData();
  }, [fetchRelayData]);

  // Poll for state updates every 5 seconds
  useEffect(() => {
    if (!selectedDevice) return;
    const interval = setInterval(fetchRelayData, 5000);
    return () => clearInterval(interval);
  }, [selectedDevice, fetchRelayData]);

  const createDefaultConfig = (deviceId: string): RelayConfig => ({
    deviceId,
    relayEnabled: false,
    autoTripEnabled: false,
    autoResetEnabled: false,
    autoResetDelaySeconds: 300,
    tripOnOvervoltage: true,
    tripOnUndervoltage: true,
    tripOnOvercurrent: true,
    tripOnBlackout: false,
    manualControlAllowed: true,
  });

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setSaveMsg("");

    try {
      const res = await fetch("/api/relay/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        setSaveMsg("✓ Configuration saved successfully.");
      } else {
        const data = await res.json();
        setSaveMsg(`✗ Error: ${data.error}`);
      }
    } catch {
      setSaveMsg("✗ Network error.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 4000);
    }
  };

  const handleRelayAction = async (action: "MANUAL_TRIP" | "MANUAL_RESET") => {
    if (!selectedDevice) return;
    setActionInProgress(true);

    try {
      const res = await fetch("https://energy-monitoring-web.vercel.app/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: selectedDevice,
          action,
          trigger: action === "MANUAL_TRIP" ? "MANUAL" : undefined,
          initiatedBy: "ADMIN",
          notes: `Manual ${action === "MANUAL_TRIP" ? "trip" : "reset"} from admin dashboard`,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        setSaveMsg(`✓ Relay ${action === "MANUAL_TRIP" ? "tripped" : "reset"} successfully.`);
        fetchRelayData(); // Refresh logs
      } else {
        const data = await res.json();
        setSaveMsg(`✗ Error: ${data.error}`);
      }
    } catch {
      setSaveMsg("✗ Network error.");
    } finally {
      setActionInProgress(false);
      setTimeout(() => setSaveMsg(""), 4000);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const getActionColor = (action: string) => {
    if (action.includes("TRIP")) return "var(--accent-rose)";
    if (action.includes("RESET")) return "var(--accent-green)";
    return "var(--text-secondary)";
  };

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h2>Relay Control</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  if (devices.length === 0) {
    return (
      <>
        <div className="page-header">
          <h2>Relay Control</h2>
          <p>No devices found. Register a device first.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>🔌 Relay Control</h2>
        <p>
          Automatic circuit breaker for equipment protection. Trips relay on dangerous electrical conditions.
        </p>
      </div>

      <div className="page-body">
        {/* Device Selector */}
        <div className="panel">
          <div className="panel-header">
            <h3>Select Device</h3>
          </div>
          <div className="panel-body">
            <select
              className="form-input"
              value={selectedDevice || ""}
              onChange={(e) => setSelectedDevice(e.target.value)}
              style={{ maxWidth: 400 }}
            >
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ({device.id.slice(0, 8)}...)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Current State Panel */}
        <div className="panel">
          <div className="panel-header">
            <h3>Current Relay State</h3>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn btn-danger"
                onClick={() => handleRelayAction("MANUAL_TRIP")}
                disabled={actionInProgress || !config?.relayEnabled || state?.isTripped}
                style={{
                  background: "var(--accent-rose)",
                  opacity: actionInProgress || !config?.relayEnabled || state?.isTripped ? 0.5 : 1,
                }}
              >
                ⚡ Trip Relay
              </button>
              <button
                className="btn btn-success"
                onClick={() => handleRelayAction("MANUAL_RESET")}
                disabled={actionInProgress || !config?.relayEnabled || !state?.isTripped}
                style={{
                  background: "var(--accent-green)",
                  opacity: actionInProgress || !config?.relayEnabled || !state?.isTripped ? 0.5 : 1,
                }}
              >
                ✓ Reset Relay
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Status</div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: state?.isTripped ? "var(--accent-rose)" : "var(--accent-green)",
                  }}
                >
                  {state?.isTripped ? "🔴 TRIPPED" : "🟢 NORMAL"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  {state?.isTripped ? "Power disconnected" : "Power flowing"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Trip Reason</div>
                <div style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)" }}>
                  {state?.tripReason || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Last Trip</div>
                <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                  {formatDate(state?.lastTripAt || null)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Last Reset</div>
                <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                  {formatDate(state?.lastResetAt || null)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Configuration Panel */}
        <div className="panel">
          <div className="panel-header">
            <h3>Relay Configuration</h3>
            <button
              className="btn btn-primary"
              onClick={handleSaveConfig}
              disabled={saving || !config}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
          <div className="panel-body">
            {config && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Master Enable */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="checkbox"
                    id="relayEnabled"
                    checked={config.relayEnabled}
                    onChange={(e) => setConfig({ ...config, relayEnabled: e.target.checked })}
                    style={{ width: 20, height: 20 }}
                  />
                  <label htmlFor="relayEnabled" style={{ fontWeight: 500 }}>
                    Enable Relay Control
                  </label>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    (Master switch - must be ON for relay to function)
                  </span>
                </div>

                {/* Auto-Trip Enable */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="checkbox"
                    id="autoTripEnabled"
                    checked={config.autoTripEnabled}
                    onChange={(e) => setConfig({ ...config, autoTripEnabled: e.target.checked })}
                    disabled={!config.relayEnabled}
                    style={{ width: 20, height: 20 }}
                  />
                  <label htmlFor="autoTripEnabled" style={{ fontWeight: 500 }}>
                    Enable Auto-Trip on Alerts
                  </label>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    (Automatically trip relay when dangerous conditions detected)
                  </span>
                </div>

                {/* Trip Triggers */}
                <div style={{ marginLeft: 32, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                    Trip on these conditions:
                  </div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={config.tripOnOvervoltage}
                        onChange={(e) => setConfig({ ...config, tripOnOvervoltage: e.target.checked })}
                        disabled={!config.autoTripEnabled}
                      />
                      Overvoltage
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={config.tripOnUndervoltage}
                        onChange={(e) => setConfig({ ...config, tripOnUndervoltage: e.target.checked })}
                        disabled={!config.autoTripEnabled}
                      />
                      Undervoltage
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={config.tripOnOvercurrent}
                        onChange={(e) => setConfig({ ...config, tripOnOvercurrent: e.target.checked })}
                        disabled={!config.autoTripEnabled}
                      />
                      Overcurrent
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={config.tripOnBlackout}
                        onChange={(e) => setConfig({ ...config, tripOnBlackout: e.target.checked })}
                        disabled={!config.autoTripEnabled}
                      />
                      Blackout
                    </label>
                  </div>
                </div>

                {/* Auto-Reset */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="checkbox"
                    id="autoResetEnabled"
                    checked={config.autoResetEnabled}
                    onChange={(e) => setConfig({ ...config, autoResetEnabled: e.target.checked })}
                    disabled={!config.relayEnabled}
                    style={{ width: 20, height: 20 }}
                  />
                  <label htmlFor="autoResetEnabled" style={{ fontWeight: 500 }}>
                    Enable Auto-Reset
                  </label>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    (Automatically reset relay after delay - use with caution!)
                  </span>
                </div>

                {config.autoResetEnabled && (
                  <div style={{ marginLeft: 32, display: "flex", alignItems: "center", gap: 12 }}>
                    <label style={{ fontSize: 13 }}>Reset delay:</label>
                    <input
                      type="number"
                      className="form-input"
                      value={config.autoResetDelaySeconds}
                      onChange={(e) =>
                        setConfig({ ...config, autoResetDelaySeconds: parseInt(e.target.value) || 300 })
                      }
                      min={60}
                      max={3600}
                      style={{ width: 100 }}
                    />
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>seconds (min: 60, max: 3600)</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {saveMsg && (
            <div
              style={{
                padding: "12px 20px",
                fontSize: 13,
                color: saveMsg.startsWith("✓") ? "var(--accent-green)" : "var(--accent-rose)",
              }}
            >
              {saveMsg}
            </div>
          )}
        </div>

        {/* Safety Warning */}
        <div className="panel">
          <div className="panel-header">
            <h3>⚠️ Safety Warning</h3>
          </div>
          <div className="panel-body" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            <p>
              <strong style={{ color: "var(--accent-amber)" }}>HIGH VOLTAGE WARNING:</strong> The relay controls
              mains AC power. All physical installation MUST be performed by a licensed electrician.
            </p>
            <p style={{ marginTop: 8 }}>
              <strong>Auto-reset is dangerous.</strong> Only enable auto-reset if you are certain the fault
              condition will self-correct (e.g., brief undervoltage dips). For persistent faults, manual
              investigation and reset is recommended.
            </p>
            <p style={{ marginTop: 8 }}>
              <strong>WebSocket latency:</strong> Relay commands are delivered via Supabase Realtime with {"<"}1
              second latency. Ensure your ESP32 is connected to WiFi and subscribed to the relay_state table.
            </p>
          </div>
        </div>

        {/* Recent Logs */}
        <div className="panel">
          <div className="panel-header">
            <h3>Recent Relay Actions</h3>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Trigger</th>
                  <th>Value</th>
                  <th>Initiated By</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      No relay actions recorded yet.
                    </td>
                  </tr>
                ) : (
                  logs.slice(0, 20).map((log) => (
                    <tr key={log.id}>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDate(log.createdAt)}</td>
                      <td style={{ fontWeight: 500, color: getActionColor(log.action) }}>{log.action}</td>
                      <td>{log.triggerType || "—"}</td>
                      <td className="mono">
                        {log.triggerValue !== null ? `${log.triggerValue} / ${log.thresholdValue}` : "—"}
                      </td>
                      <td>{log.initiatedBy || "—"}</td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 200 }}>
                        {log.notes || "—"}
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
