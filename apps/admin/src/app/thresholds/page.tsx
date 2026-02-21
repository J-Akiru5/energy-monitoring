"use client";

import { useEffect, useState } from "react";

interface Threshold {
  id: string;
  metric: string;
  min_value: number | null;
  max_value: number | null;
}

const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  voltage: { label: "Voltage", unit: "V" },
  current: { label: "Current", unit: "A" },
  power: { label: "Power", unit: "W" },
  frequency: { label: "Frequency", unit: "Hz" },
};

export default function ThresholdsPage() {
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    fetch("/api/thresholds")
      .then((r) => r.json())
      .then((d) => setThresholds(d.thresholds || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const updateThreshold = (metric: string, field: "min_value" | "max_value", value: string) => {
    setThresholds((prev) =>
      prev.map((t) =>
        t.metric === metric
          ? { ...t, [field]: value === "" ? null : parseFloat(value) }
          : t
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");

    try {
      const res = await fetch("/api/thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thresholds),
      });

      if (res.ok) {
        setSaveMsg("✓ Thresholds updated successfully.");
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

  return (
    <>
      <div className="page-header">
        <h2>Alert Thresholds</h2>
        <p>Define safe operating ranges. Readings outside these limits will trigger alerts.</p>
      </div>

      <div className="page-body">
        <div className="panel">
          <div className="panel-header">
            <h3>Threshold Configuration</h3>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Minimum</th>
                  <th>Maximum</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      Loading...
                    </td>
                  </tr>
                ) : thresholds.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      No thresholds configured. Run schema.sql to seed defaults.
                    </td>
                  </tr>
                ) : (
                  thresholds.map((t) => {
                    const meta = METRIC_LABELS[t.metric] || { label: t.metric, unit: "" };
                    return (
                      <tr key={t.metric}>
                        <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>{meta.label}</td>
                        <td>
                          <input
                            className="form-input"
                            type="number"
                            style={{ maxWidth: 140, background: "transparent" }}
                            value={t.min_value ?? ""}
                            onChange={(e) => updateThreshold(t.metric, "min_value", e.target.value)}
                            placeholder="—"
                          />
                        </td>
                        <td>
                          <input
                            className="form-input"
                            type="number"
                            style={{ maxWidth: 140, background: "transparent" }}
                            value={t.max_value ?? ""}
                            onChange={(e) => updateThreshold(t.metric, "max_value", e.target.value)}
                            placeholder="—"
                          />
                        </td>
                        <td className="mono">{meta.unit}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
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

        <div className="panel">
          <div className="panel-header">
            <h3>⚠️ Safety Note</h3>
          </div>
          <div className="panel-body" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            <p>
              Setting thresholds too narrow may cause excessive alerting. The default values are based on
              typical Philippine residential electrical standards (220V ± 10%, 60Hz ± 1Hz).
            </p>
            <p style={{ marginTop: 8 }}>
              <strong style={{ color: "var(--accent-amber)" }}>PZEM-004T Maximum Ratings:</strong>{" "}
              Voltage: 260V AC, Current: 100A (with external CT).
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
