"use client";

import { useEffect, useState, useCallback } from "react";

interface Device {
  id: string;
  name: string;
}

interface PzemHealthEntry {
  phase: string;
  healthy: boolean;
  startedAt: string | null;
  inRecovery: boolean;
}

interface PzemConfig {
  mode: "auto" | "manual";
  manualSource: "A" | "B" | "C" | null;
}

interface PhaseMode {
  phaseMode: string | null;
}

function formatOngoingDuration(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const PHASE_COLORS: Record<string, string> = {
  A: "#fb7185",
  B: "#F59E0B",
  C: "#06B6D4",
};

export default function PzemStatusPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [health, setHealth] = useState<PzemHealthEntry[]>([]);
  const [config, setConfig] = useState<PzemConfig | null>(null);
  const [phaseMode, setPhaseMode] = useState<PhaseMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

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

  const fetchPzemData = useCallback(async () => {
    if (!selectedDevice) return;

    try {
      const [healthRes, configRes, overviewRes] = await Promise.all([
        fetch(`/api/devices/pzem-health?deviceId=${selectedDevice}`),
        fetch(`/api/devices/pzem-config?deviceId=${selectedDevice}`),
        fetch(`/api/overview?deviceId=${selectedDevice}`),
      ]);

      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealth(healthData.phases || []);
      }

      if (configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData);
      } else {
        setConfig({ mode: "auto", manualSource: null });
      }

      if (overviewRes.ok) {
        const overviewData = await overviewRes.json();
        setPhaseMode(overviewData.phaseMode || null);
      }
    } catch (err) {
      console.error("Failed to fetch PZEM data:", err);
      setConfig({ mode: "auto", manualSource: null });
    }
  }, [selectedDevice]);

  useEffect(() => {
    fetchPzemData();
  }, [fetchPzemData]);

  useEffect(() => {
    if (!selectedDevice) return;
    const interval = setInterval(fetchPzemData, 10_000);
    return () => clearInterval(interval);
  }, [selectedDevice, fetchPzemData]);

  const handleModeChange = async (newMode: "auto" | "manual") => {
    if (!selectedDevice || !config) return;
    setSaving(true);
    setSaveMsg("");

    try {
      const res = await fetch(`/api/devices/pzem-config?deviceId=${selectedDevice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode, manualSource: null }),
      });

      if (res.ok) {
        const data = await res.json();
        setConfig({ mode: data.mode, manualSource: data.manualSource });
        setSaveMsg("Mode updated successfully.");
      } else {
        const data = await res.json();
        setSaveMsg(`Error: ${data.error}`);
      }
    } catch {
      setSaveMsg("Network error.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 4000);
    }
  };

  const handleSourceSelect = async (source: "A" | "B" | "C") => {
    if (!selectedDevice || !config) return;
    setSaving(true);
    setSaveMsg("");

    try {
      const res = await fetch(`/api/devices/pzem-config?deviceId=${selectedDevice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual", manualSource: source }),
      });

      if (res.ok) {
        const data = await res.json();
        setConfig({ mode: data.mode, manualSource: data.manualSource });
        setSaveMsg(`Active source set to PZEM-${source}.`);
      } else {
        const data = await res.json();
        setSaveMsg(data.error);
      }
    } catch {
      setSaveMsg("Network error.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 6000);
    }
  };

  const isSinglePhase = phaseMode?.phaseMode === "SINGLE_PHASE";
  const allHealthy = health.every((p) => p.healthy);
  const onlineCount = health.filter((p) => p.healthy).length;

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h2>PZEM Status</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  if (devices.length === 0) {
    return (
      <>
        <div className="page-header">
          <h2>PZEM Status</h2>
          <p>No devices found. Register a device first.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>PZEM Sensor Status</h2>
        <p>
          Per-phase communication health and 1-phase source selection for PZEM power meters.
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

        {/* Per-Phase Health Panel */}
        <div className="panel">
          <div className="panel-header">
            <h3>
              Sensor Health
              <span
                style={{
                  fontSize: 12,
                  marginLeft: 8,
                  color: allHealthy ? "var(--accent-green)" : "var(--accent-rose)",
                }}
              >
                ({onlineCount}/3 online)
              </span>
            </h3>
          </div>
          <div className="panel-body">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 16,
              }}
            >
              {health.map((entry) => (
                <div
                  key={entry.phase}
                  style={{
                    border: `1px solid ${entry.healthy ? "rgba(63,185,80,0.3)" : "rgba(248,81,73,0.3)"}`,
                    borderRadius: 12,
                    padding: "16px 18px",
                    background: entry.healthy
                      ? "rgba(63,185,80,0.06)"
                      : "rgba(248,81,73,0.06)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: PHASE_COLORS[entry.phase] || "var(--text-primary)",
                      }}
                    >
                      PZEM-{entry.phase}
                    </div>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: entry.healthy
                          ? "rgba(63,185,80,0.15)"
                          : "rgba(248,81,73,0.14)",
                        color: entry.healthy ? "#6ee7b7" : "#fb7185",
                        border: `1px solid ${entry.healthy ? "rgba(63,185,80,0.4)" : "rgba(248,81,73,0.3)"}`,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: entry.healthy ? "#4ade80" : "#f87171",
                        }}
                      />
                      {entry.healthy ? "HEALTHY" : "OFFLINE"}
                    </span>
                  </div>

                  {entry.inRecovery && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--accent-amber)",
                        marginBottom: 4,
                      }}
                    >
                      Recovery in progress...
                    </div>
                  )}

                  {!entry.healthy && entry.startedAt && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      Offline since {formatOngoingDuration(entry.startedAt)}
                    </div>
                  )}

                  {entry.healthy && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      Communication OK
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 1-Phase Source Selection (only for single-phase devices) */}
        {isSinglePhase && (
          <div className="panel">
            <div className="panel-header">
              <h3>1-Phase Source Selection</h3>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                Only available in single-phase mode
              </span>
            </div>
            <div className="panel-body">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 24,
                  marginBottom: 20,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                    Mode
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: config?.mode === "auto" ? "var(--accent-cyan)" : "var(--accent-amber)",
                    }}
                  >
                    {config?.mode === "auto" ? "AUTO" : "MANUAL"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                    Active Source
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
                    {config?.mode === "auto"
                      ? "Priority: A -> B -> C"
                      : config?.manualSource
                        ? `PZEM-${config.manualSource}`
                        : "--"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <button
                  className="btn"
                  onClick={() => handleModeChange("auto")}
                  disabled={saving || config?.mode === "auto"}
                  style={{
                    background: config?.mode === "auto" ? "rgba(6,182,212,0.18)" : undefined,
                    borderColor: config?.mode === "auto" ? "rgba(6,182,212,0.4)" : undefined,
                    color: config?.mode === "auto" ? "#67e8f9" : undefined,
                    opacity: config?.mode === "auto" ? 1 : 0.7,
                  }}
                >
                  AUTO
                </button>
                <button
                  className="btn"
                  onClick={() => handleModeChange("manual")}
                  disabled={saving || config?.mode === "manual"}
                  style={{
                    background: config?.mode === "manual" ? "rgba(245,158,11,0.18)" : undefined,
                    borderColor: config?.mode === "manual" ? "rgba(245,158,11,0.4)" : undefined,
                    color: config?.mode === "manual" ? "#fbbf24" : undefined,
                    opacity: config?.mode === "manual" ? 1 : 0.7,
                  }}
                >
                  MANUAL
                </button>
              </div>

              {config?.mode === "manual" && (
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-secondary)",
                      marginBottom: 10,
                    }}
                  >
                    Select active source:
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    {(["A", "B", "C"] as const).map((source) => {
                      const sourceHealth = health.find((h) => h.phase === source);
                      const isOffline = sourceHealth && !sourceHealth.healthy;
                      const isSelected = config.manualSource === source;

                      return (
                        <button
                          key={source}
                          className="btn"
                          onClick={() => handleSourceSelect(source)}
                          disabled={saving || isOffline}
                          style={{
                            background: isSelected
                              ? `${PHASE_COLORS[source]}22`
                              : isOffline
                                ? "rgba(248,81,73,0.08)"
                                : undefined,
                            borderColor: isSelected
                              ? `${PHASE_COLORS[source]}66`
                              : isOffline
                                ? "rgba(248,81,73,0.3)"
                                : undefined,
                            color: isSelected
                              ? PHASE_COLORS[source]
                              : isOffline
                                ? "#fb7185"
                                : undefined,
                            opacity: isOffline ? 0.5 : 1,
                            cursor: isOffline ? "not-allowed" : "pointer",
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: isOffline ? "#f87171" : "#4ade80",
                              display: "inline-block",
                            }}
                          />
                          PZEM-{source}
                          {isOffline && (
                            <span style={{ fontSize: 10, marginLeft: 4 }}>(offline)</span>
                          )}
                          {isSelected && (
                            <span style={{ fontSize: 11, marginLeft: 4 }}>selected</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {saveMsg && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 14px",
                    fontSize: 13,
                    borderRadius: 8,
                    background: saveMsg.startsWith("Error") || saveMsg.startsWith("Network")
                      ? "rgba(248,81,73,0.1)"
                      : "rgba(16,185,129,0.1)",
                    border: `1px solid ${saveMsg.startsWith("Error") || saveMsg.startsWith("Network") ? "rgba(248,81,73,0.3)" : "rgba(16,185,129,0.3)"}`,
                    color: saveMsg.startsWith("Error") || saveMsg.startsWith("Network") ? "#fb7185" : "#6ee7b7",
                  }}
                >
                  {saveMsg}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Info: 3-Phase Mode */}
        {!isSinglePhase && (
          <div className="panel">
            <div className="panel-header">
              <h3>3-Phase Mode</h3>
            </div>
            <div className="panel-body" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              <p>
                In 3-phase mode, all three PZEM sensors operate independently.
                Each phase reports its own health status above. There is no
                &quot;active source&quot; concept -- each phase is always its own source.
              </p>
              <p style={{ marginTop: 8 }}>
                If a PZEM goes offline in 3-phase mode, the remaining phases
                continue reporting normally. The offline phase shows as OFFLINE
                above and triggers a PZEM_OFFLINE alert.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
