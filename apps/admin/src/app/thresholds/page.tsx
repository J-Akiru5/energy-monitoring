"use client";

import { useEffect, useState } from "react";

interface Thresholds {
  overvoltage: number | null;
  undervoltage: number | null;
  overcurrent: number | null;
  high_power: number | null;
}

export default function ThresholdsPage() {
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    fetch("/api/thresholds")
      .then((r) => r.json())
      .then((d) => setThresholds(d.thresholds))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const updateThreshold = (field: keyof Thresholds, value: string) => {
    setThresholds((prev) =>
      prev ? { ...prev, [field]: value === "" ? null : parseFloat(value) } : null
    );
  };

  const handleSave = async () => {
    if (!thresholds) return;
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
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !thresholds}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric Name</th>
                  <th>Threshold Value</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      Loading...
                    </td>
                  </tr>
                ) : !thresholds ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      No thresholds configured. Run schema.sql to seed defaults.
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>Overvoltage (Max)</td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ maxWidth: 140, background: "transparent" }}
                          value={thresholds.overvoltage ?? ""}
                          onChange={(e) => updateThreshold("overvoltage", e.target.value)}
                          placeholder="—"
                        />
                      </td>
                      <td className="mono">V</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>Undervoltage (Min)</td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ maxWidth: 140, background: "transparent" }}
                          value={thresholds.undervoltage ?? ""}
                          onChange={(e) => updateThreshold("undervoltage", e.target.value)}
                          placeholder="—"
                        />
                      </td>
                      <td className="mono">V</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>Overcurrent (Max)</td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ maxWidth: 140, background: "transparent" }}
                          value={thresholds.overcurrent ?? ""}
                          onChange={(e) => updateThreshold("overcurrent", e.target.value)}
                          placeholder="—"
                        />
                      </td>
                      <td className="mono">A</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>High Power (Max)</td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ maxWidth: 140, background: "transparent" }}
                          value={thresholds.high_power ?? ""}
                          onChange={(e) => updateThreshold("high_power", e.target.value)}
                          placeholder="—"
                        />
                      </td>
                      <td className="mono">W</td>
                    </tr>
                  </>
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
