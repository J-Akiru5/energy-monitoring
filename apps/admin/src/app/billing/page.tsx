"use client";

import { useEffect, useState } from "react";

export default function BillingPage() {
  const [rate, setRate] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    fetch("/api/billing")
      .then((r) => r.json())
      .then((d) => {
        setRate(d.rate_per_kwh);
        setInputValue(String(d.rate_per_kwh ?? ""));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed) || parsed <= 0) {
      setSaveMsg("✗ Enter a valid positive number.");
      return;
    }

    setSaving(true);
    setSaveMsg("");

    try {
      const res = await fetch("/api/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratePerKwh: parsed }),
      });

      if (res.ok) {
        setRate(parsed);
        setSaveMsg("✓ Billing rate updated.");
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
        <h2>Billing Rate</h2>
        <p>Configure the PHP per kWh rate used for cost estimation on the dashboard.</p>
      </div>

      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Current Rate</div>
            <div className="stat-value" style={{ color: "var(--accent-amber)" }}>
              {loading ? "—" : `₱${rate?.toFixed(4) ?? "—"}`}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              per kWh
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Update Rate</h3>
          </div>
          <div className="panel-body">
            <div className="form-group">
              <label>Rate per kWh (PHP)</label>
              <input
                className="form-input"
                type="number"
                step="0.0001"
                min="0"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="e.g., 11.8546"
                style={{ maxWidth: 300 }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Update Rate"}
              </button>
              {saveMsg && (
                <span
                  style={{
                    fontSize: 13,
                    color: saveMsg.startsWith("✓") ? "var(--accent-green)" : "var(--accent-rose)",
                  }}
                >
                  {saveMsg}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Rate Reference</h3>
          </div>
          <div className="panel-body" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            <p>
              The Philippine Electricity Market Corporation (PEMC) publishes hourly Wholesale Electricity
              Spot Market (WESM) prices. For residential consumers, check your latest Meralco bill for
              the "Generation Charge" component.
            </p>
            <p style={{ marginTop: 8 }}>
              <strong>Typical range (2024–2025):</strong> ₱9.50 – ₱13.00 per kWh depending on supply/demand.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
