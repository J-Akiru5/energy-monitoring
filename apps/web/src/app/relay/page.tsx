"use client";

import { useEffect, useState, useCallback } from "react";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";

type RelayState = {
  deviceId: string;
  isTripped: boolean;
  lastTripAt: string | null;
  lastResetAt: string | null;
  tripReason: string | null;
};

type RelayConfig = {
  relayEnabled: boolean;
  autoTripEnabled: boolean;
  manualControlAllowed: boolean;
};

type ControlMode = "MANUAL" | "AUTOMATIC";

export default function RelayPage() {
  const { deviceId, isLoading: deviceLoading } = usePrimaryDevice();
  const [state, setState] = useState<RelayState | null>(null);
  const [config, setConfig] = useState<RelayConfig | null>(null);
  const [mode, setMode] = useState<ControlMode>("AUTOMATIC");
  const [actionInProgress, setActionInProgress] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  // Fetch relay state and config
  const fetchRelayData = useCallback(async () => {
    if (!deviceId) return;

    try {
      const [stateRes, configRes] = await Promise.all([
        fetch(`/api/relay?deviceId=${deviceId}`),
        fetch(`/api/relay/config?deviceId=${deviceId}`),
      ]);

      if (stateRes.ok) {
        const data = await stateRes.json();
        setState(data.state);
      }

      if (configRes.ok) {
        const data = await configRes.json();
        setConfig(data.config);
      }
    } catch (err) {
      console.error("Failed to fetch relay data:", err);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchRelayData();
  }, [fetchRelayData]);

  // Poll for updates every 3 seconds
  useEffect(() => {
    if (!deviceId) return;
    const interval = setInterval(fetchRelayData, 3000);
    return () => clearInterval(interval);
  }, [deviceId, fetchRelayData]);

  const handleRelayAction = async (action: "MANUAL_TRIP" | "MANUAL_RESET") => {
    if (!deviceId || mode !== "MANUAL") return;
    setActionInProgress(true);
    setMessage("");

    try {
      const res = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          action,
          trigger: action === "MANUAL_TRIP" ? "MANUAL" : undefined,
          initiatedBy: "USER",
          notes: `Manual ${action === "MANUAL_TRIP" ? "trip" : "reset"} from consumer app`,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        setMessage(
          `Relay ${action === "MANUAL_TRIP" ? "tripped" : "reset"} successfully.`
        );
        fetchRelayData();
      } else {
        const data = await res.json();
        setMessage(`Error: ${data.error}`);
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setActionInProgress(false);
      setTimeout(() => setMessage(""), 4000);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const formatTripReason = (reason: string | null) => {
    if (!reason) return "Unknown";
    const map: Record<string, string> = {
      OVERVOLTAGE: "Overvoltage",
      UNDERVOLTAGE: "Undervoltage",
      OVERCURRENT: "Overcurrent",
      BLACKOUT: "Blackout",
      MANUAL: "Manual Trip",
      LOCAL_OVERVOLTAGE: "Local Safety: Overvoltage",
      LOCAL_UNDERVOLTAGE: "Local Safety: Undervoltage",
    };
    return map[reason] || reason;
  };

  if (deviceLoading || loading) {
    return (
      <div className="page-shell">
        <section className="page-header">
          <div>
            <div className="page-eyebrow">Control</div>
            <h1 className="page-title">Relay Control</h1>
          </div>
        </section>
        <div className="page-empty">Loading...</div>
      </div>
    );
  }

  if (!config?.relayEnabled) {
    return (
      <div className="page-shell">
        <section className="page-header">
          <div>
            <div className="page-eyebrow">Control</div>
            <h1 className="page-title">Relay Control</h1>
          </div>
        </section>
        <div className="page-empty">
          Relay control is not enabled for this device.
          <br />
          Contact your administrator to enable relay functionality.
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <section className="page-header">
        <div>
          <div className="page-eyebrow">Control</div>
          <h1 className="page-title">Relay Control</h1>
          <p className="page-copy">
            Control your Normally Open relay remotely with hybrid safety protection.
            HIGH = Power ON, LOW = Power OFF.
          </p>
        </div>
      </section>

      {/* Current Status */}
      <section className="summary-grid compact-grid" style={{ marginBottom: 24 }}>
        <article
          className="summary-card"
          style={{
            gridColumn: "span 2",
            background: state?.isTripped
              ? "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))"
              : "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))",
            borderColor: state?.isTripped
              ? "rgba(239,68,68,0.3)"
              : "rgba(34,197,94,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: state?.isTripped
                  ? "rgba(239,68,68,0.2)"
                  : "rgba(34,197,94,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              {state?.isTripped ? "⚡" : "✓"}
            </div>
            <div>
              <div className="summary-label">Relay Status</div>
              <div
                className="summary-value"
                style={{
                  color: state?.isTripped
                    ? "var(--color-error)"
                    : "var(--color-success)",
                }}
              >
                {state?.isTripped ? "TRIPPED" : "NORMAL"}
              </div>
            </div>
          </div>
          <div className="summary-note">
            {state?.isTripped
              ? "Power is disconnected to protect equipment"
              : "Power is flowing normally"}
          </div>
        </article>

        {state?.isTripped && (
          <>
            <article className="summary-card">
              <div className="summary-label">Trip Reason</div>
              <div className="summary-value" style={{ fontSize: 16 }}>
                {formatTripReason(state.tripReason)}
              </div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Tripped At</div>
              <div className="summary-value" style={{ fontSize: 14 }}>
                {formatDate(state.lastTripAt)}
              </div>
            </article>
          </>
        )}
      </section>

      {/* Control Mode */}
      <section className="summary-grid compact-grid" style={{ marginBottom: 24 }}>
        <article className="summary-card" style={{ gridColumn: "span 2" }}>
          <div className="summary-label" style={{ marginBottom: 16 }}>
            Control Mode
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => setMode("AUTOMATIC")}
              style={{
                flex: 1,
                padding: "16px 12px",
                border: `2px solid ${mode === "AUTOMATIC" ? "var(--color-brand)" : "var(--border-primary)"}`,
                borderRadius: 12,
                background:
                  mode === "AUTOMATIC"
                    ? "rgba(59,130,246,0.1)"
                    : "transparent",
                cursor: "pointer",
                transition: "all 0.2s",
                color: "var(--text-primary)",
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>🤖</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Automatic</div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 4,
                }}
              >
                ESP32 handles safety
              </div>
            </button>
            <button
              onClick={() => setMode("MANUAL")}
              disabled={!config?.manualControlAllowed}
              style={{
                flex: 1,
                padding: "16px 12px",
                border: `2px solid ${mode === "MANUAL" ? "var(--color-brand)" : "var(--border-primary)"}`,
                borderRadius: 12,
                background:
                  mode === "MANUAL" ? "rgba(59,130,246,0.1)" : "transparent",
                cursor: config?.manualControlAllowed ? "pointer" : "not-allowed",
                opacity: config?.manualControlAllowed ? 1 : 0.5,
                transition: "all 0.2s",
                color: "var(--text-primary)",
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>🎛️</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Manual</div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 4,
                }}
              >
                You control the relay
              </div>
            </button>
          </div>

          {mode === "AUTOMATIC" && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: "rgba(59,130,246,0.1)",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              <strong>Automatic Mode Active</strong>
              <br />
              The ESP32 will automatically switch the relay LOW (Power OFF) if dangerous voltage
              conditions are detected. This protection works even without internet.
            </div>
          )}
        </article>
      </section>

      {/* Manual Controls */}
      {mode === "MANUAL" && (
        <section className="summary-grid compact-grid" style={{ marginBottom: 24 }}>
          <article className="summary-card" style={{ gridColumn: "span 2" }}>
            <div className="summary-label" style={{ marginBottom: 16 }}>
              Manual Controls
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => handleRelayAction("MANUAL_TRIP")}
                disabled={actionInProgress || state?.isTripped}
                style={{
                  flex: 1,
                  padding: "16px",
                  border: "none",
                  borderRadius: 12,
                  background: state?.isTripped
                    ? "var(--bg-tertiary)"
                    : "var(--color-error)",
                  color: state?.isTripped ? "var(--text-muted)" : "white",
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: state?.isTripped ? "not-allowed" : "pointer",
                  opacity: actionInProgress ? 0.7 : 1,
                }}
              >
                {actionInProgress ? "Processing..." : "⚡ Trip Relay"}
              </button>
              <button
                onClick={() => handleRelayAction("MANUAL_RESET")}
                disabled={actionInProgress || !state?.isTripped}
                style={{
                  flex: 1,
                  padding: "16px",
                  border: "none",
                  borderRadius: 12,
                  background: !state?.isTripped
                    ? "var(--bg-tertiary)"
                    : "var(--color-success)",
                  color: !state?.isTripped ? "var(--text-muted)" : "white",
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: !state?.isTripped ? "not-allowed" : "pointer",
                  opacity: actionInProgress ? 0.7 : 1,
                }}
              >
                {actionInProgress ? "Processing..." : "✓ Reset Relay"}
              </button>
            </div>

            {message && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: message.includes("Error")
                    ? "rgba(239,68,68,0.1)"
                    : "rgba(34,197,94,0.1)",
                  borderRadius: 8,
                  fontSize: 13,
                  color: message.includes("Error")
                    ? "var(--color-error)"
                    : "var(--color-success)",
                }}
              >
                {message}
              </div>
            )}

            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: "rgba(251,191,36,0.1)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--color-warning)",
              }}
            >
              <strong>Note:</strong> Manual mode lets you control the relay directly.
              The ESP32 local safety override will still function for dangerous
              voltage conditions regardless of this setting.
            </div>
          </article>
        </section>
      )}

      {/* How It Works */}
      <section className="summary-grid compact-grid">
        <article className="summary-card" style={{ gridColumn: "span 2" }}>
          <div className="summary-label" style={{ marginBottom: 12 }}>
            Hybrid Safety System
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}
          >
            <p style={{ marginBottom: 12 }}>
              Your relay has two layers of protection:
            </p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li style={{ marginBottom: 8 }}>
                <strong>Local (ESP32):</strong> Immediate hardware override for
                dangerous voltages - works even without internet connection
              </li>
              <li>
                <strong>Remote (This App):</strong> Manual control for
                convenience and non-emergency situations
              </li>
            </ul>
          </div>
        </article>
      </section>
    </div>
  );
}
